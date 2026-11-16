// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { runConversationAgent } from '../functions/api/_lib/conversation-runner'
import { conversationSnapshot, createConversationSession, reduceConversation } from '../src/lib/conversation-state'
const snap = () => conversationSnapshot(createConversationSession())
const answer = (text: string) => ({ text, mode: 'binding' as const })
function output(snapshot: ReturnType<typeof snap>, patch: Record<string, unknown> = {}, extra = {}) {
  return JSON.stringify({
    reply: 'Could you share photos of the rooms and large items?',
    basedOnRevision: snapshot.revision,
    proposals: Object.keys(patch).length
      ? [{ id: 'local', expectedRevision: snapshot.revision, command: { type: 'details.patch', patch } }]
      : [],
    ...extra,
  })
}
async function interpreted(content: string, patch: Record<string, unknown>, snapshot = snap(), extra = {}) {
  return runConversationAgent({
    messages: [{ id: 'user-one', role: 'user', content }],
    snapshot,
    model: async (request) =>
      answer(request.phase === 'continue' ? output(request.snapshot) : output(snapshot, patch, extra)),
  })
}
describe('validated bounded conversation runner', () => {
  it('normalizes volunteered km, mile and miles on the server, not model arithmetic', async () => {
    for (const [content, expected] of [
      ['50 km', 31.068559611866696],
      ['50 mile', 50],
      ['50 miles', 50],
    ] as const) {
      const result = await interpreted(content, { distanceMiles: 999 })
      expect(result.proposals[0].command).toMatchObject({
        patch: { distanceMiles: expected },
        facts: [{ sourceMessageId: 'user-one', wording: content }],
      })
      expect(result.reply).not.toMatch(/distance/i)
    }
  })
  it('retains a fuller address on city-only repetition and does not invent a date from a window', async () => {
    const snapshot = snap()
    snapshot.moveDetails.from = 'Dizengoff 100, Tel Aviv'
    snapshot.moveDetails.to = 'Bezalel 2, Raanana'
    const result = await interpreted('tel aviv', { from: 'Tel Aviv' }, snapshot)
    expect(result.proposals).toEqual([])
    expect(result.agent?.nextAction).toBe('request_photos')
    expect(result.reply).toMatch(/photo/i)
    const window = await interpreted('sometime in January', { date: null }, snapshot, {
      facts: [
        {
          field: 'dateWindow',
          sourceMessageId: 'user-one',
          wording: 'sometime in January',
          uncertainty: 'uncertain',
          precision: 'window',
          correction: false,
        },
      ],
    })
    expect(window.proposals[0].command).toMatchObject({ patch: { date: null }, facts: [{ field: 'dateWindow' }] })
  })
  it('validates evidence against actual user text and never allows model-created successful routes', async () => {
    await expect(
      interpreted('hello', { from: 'Haifa' }, snap(), {
        facts: [
          {
            field: 'from',
            sourceMessageId: 'invented',
            wording: 'Haifa',
            uncertainty: 'certain',
            precision: 'city',
            correction: false,
          },
        ],
      }),
    ).rejects.toThrow('Invalid conversation output')
    const model = vi.fn(async () =>
      answer(
        JSON.stringify({
          reply: 'Photos?',
          basedOnRevision: 0,
          proposals: [
            {
              id: 'one',
              expectedRevision: 0,
              command: { type: 'details.patch', patch: { from: 'Haifa' }, route: { status: 'ready' } },
            },
          ],
        }),
      ),
    )
    await expect(runConversationAgent({ messages: [], snapshot: snap(), model })).rejects.toThrow()
    expect(model).toHaveBeenCalledTimes(2)
  })
  it('does not treat blank or numeric-only endpoint text as useful photo context', async () => {
    for (const from of ['   ', '123']) {
      const snapshot = snap()
      snapshot.moveDetails.from = from
      snapshot.moveDetails.to = 'Raanana'
      const response = await interpreted('hello', {}, snapshot)
      expect(response.agent?.nextAction).toBe('clarify_origin')
      expect(response.reply).toMatch(/origin|pickup/i)
      expect(response.reply).not.toMatch(/photo/i)
    }
  })
  it('rejects a patch without any user source instead of persisting an untraceable fact', async () => {
    const snapshot = snap()
    await expect(
      runConversationAgent({ messages: [], snapshot, model: async () => answer(output(snapshot, { from: 'Haifa' })) }),
    ).rejects.toThrow('Invalid conversation output')
  })
  it('uses at most one malformed retry, with no raw output echo or provider-failure retry', async () => {
    const model = vi.fn(async () => answer('private invalid output'))
    await expect(runConversationAgent({ messages: [], snapshot: snap(), model })).rejects.toThrow(
      'Invalid conversation output',
    )
    expect(model).toHaveBeenCalledTimes(2)
    expect(model.mock.calls.flat().join(' ')).not.toContain('private invalid output')
    const failed = vi.fn(async () => {
      throw new Error('provider failed')
    })
    await expect(runConversationAgent({ messages: [], snapshot: snap(), model: failed })).rejects.toThrow()
    expect(failed).toHaveBeenCalledTimes(1)
  })
  it('falls back from repeated questions and injected commercial claims to one photo request', async () => {
    const snapshot = snap()
    snapshot.moveDetails.from = 'Tel Aviv'
    snapshot.moveDetails.to = 'Raanana'
    for (const reply of [
      'What is the distance in miles?',
      'Your booking is confirmed.',
      'The total is $100.',
      'What is the origin city?',
      'Everything is arranged: movers will arrive tomorrow.',
      'Could you share photos after the booking was confirmed?',
      'Could you share photos now that arrangements succeeded?',
    ]) {
      const result = await interpreted('not sure', {}, snapshot, { reply })
      expect(result.reply).toMatch(/photo/i)
      expect(result.reply).not.toMatch(/distance|confirmed|\$|arranged|origin city/i)
      expect(result.reply).not.toBe(reply)
      expect(result.agent?.nextAction).toBe('request_photos')
    }
  })
  it('integrates only backend route distance and leaves ambiguous/unconfigured routing nonblocking', async () => {
    const snapshot = snap()
    snapshot.moveDetails.from = 'Tel Aviv'
    const noKey = await interpreted('moving to Raanana', { to: 'Raanana' }, snapshot, {
      tools: [{ type: 'resolve_route' }],
    })
    expect(noKey.agent?.route).toMatchObject({ status: 'unconfigured' })
    expect(noKey.reply).toMatch(/photo/i)
    const fetcher = vi.fn(async () =>
      Response.json({
        results: [
          { lat: 32, lon: 34, formatted: 'Springfield', result_type: 'city', rank: { confidence: 1 } },
          { lat: 40, lon: 42, formatted: 'Springfield', result_type: 'city', rank: { confidence: 1 } },
        ],
      }),
    )
    const result = await runConversationAgent({
      messages: [{ id: 'user-one', role: 'user', content: 'to Springfield' }],
      snapshot,
      key: 'key',
      fetcher,
      model: async (request) =>
        answer(
          request.phase === 'continue'
            ? output(request.snapshot)
            : output(snapshot, { to: 'Springfield' }, { tools: [{ type: 'resolve_route' }] }),
        ),
    })
    expect(result.agent?.route).toMatchObject({ status: 'ambiguous' })
    expect(result.reply).toMatch(/photo/i)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(result.proposals[0].command).not.toHaveProperty('patch.distanceMiles')
  })
  it('only promotes an actual address-accurate route distance, never a city approximation, into pricing inputs', async () => {
    for (const precision of ['building', 'city']) {
      const snapshot = snap()
      snapshot.moveDetails.from = 'Dizengoff 100, Tel Aviv'
      const outputs = [
        {
          results: [{ lat: 32, lon: 34, formatted: 'provider label', result_type: precision, rank: { confidence: 1 } }],
        },
        {
          results: [{ lat: 33, lon: 35, formatted: 'provider label', result_type: precision, rank: { confidence: 1 } }],
        },
        { results: [{ distance: 16093.44, distance_units: 'Meters' }] },
      ]
      const fetcher = vi.fn(async () => Response.json(outputs.shift()))
      const response = await runConversationAgent({
        messages: [{ id: 'user-one', role: 'user', content: 'to Bezalel 2, Raanana' }],
        snapshot,
        key: 'key',
        fetcher,
        model: async (request) =>
          answer(
            request.phase === 'continue'
              ? output(request.snapshot)
              : output(snapshot, { to: 'Bezalel 2, Raanana' }, { tools: [{ type: 'resolve_route' }] }),
          ),
      })
      expect(response.agent?.route).toMatchObject({
        status: 'ready',
        distanceMiles: 10,
        precision: precision === 'building' ? 'address' : 'city',
      })
      const command = response.proposals[0].command
      expect(command.type === 'details.patch' && command.patch.distanceMiles).toBe(
        precision === 'building' ? 10 : undefined,
      )
      expect(fetcher).toHaveBeenCalledTimes(3)
    }
  })
  it('recovers from the same missing-origin answer instead of repeating the question', async () => {
    const snapshot = snap()
    const response = await runConversationAgent({
      snapshot,
      messages: [
        { id: 'question', role: 'assistant', content: 'What is the origin city or address?' },
        { id: 'user-one', role: 'user', content: 'not sure' },
      ],
      model: async () => answer(output(snapshot)),
    })
    expect(response.reply).not.toBe('What is the origin city or address?')
    expect(response.reply).toMatch(/pickup/i)
  })
  it('interprets the required sequential scripted transcript without address loss or distance loops', async () => {
    let state = createConversationSession()
    const cases = [
      ['tel aviv', { from: 'Tel Aviv' }],
      [
        'dizingoff 100 tel-aviv moving to raanana to bezalel street 2',
        { from: 'dizingoff 100 tel-aviv', to: 'bezalel street 2, raanana' },
      ],
      ['2027-01-11', { date: '2027-01-11' }],
      ['50 km', { distanceMiles: 50 }],
      ['50 mile', { distanceMiles: 50 }],
      ['origin ground floor', { originFloor: 0 }],
    ] as const
    for (const [index, [content, patch]] of cases.entries()) {
      const message = { id: 'user-one', role: 'user' as const, content }
      state.messages = [message]
      const snapshot = conversationSnapshot(state)
      const response = await interpreted(content, patch, snapshot)
      expect(response.reply).not.toMatch(/distance/i)
      const command = response.proposals[0]?.command
      if (command)
        state = reduceConversation(state, {
          ...command,
          id: `apply-${index}`,
          source: 'chat',
          expectedRevision: state.revision,
        })
    }
    expect(state.moveDetails).toMatchObject({
      from: 'dizingoff 100 tel-aviv',
      to: 'bezalel street 2, raanana',
      date: '2027-01-11',
      distanceMiles: 50,
      originFloor: 0,
    })
  })
})
