// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { volunteeredDistance } from '../functions/api/_lib/conversation-facts'
import { runConversationAgent } from '../functions/api/_lib/conversation-runner'
import { conversationSnapshot, createConversationSession, reduceConversation } from '../src/lib/conversation-state'
import type { ConversationModelRequest } from '../functions/api/_lib/conversation-runner'

function state() {
  const value = createConversationSession()
  value.moveDetails.from = 'Dizengoff 100, Tel Aviv'
  value.moveDetails.to = 'Bezalel 2, Raanana'
  return value
}
function routedState() {
  const value = state()
  value.moveDetails.distanceMiles = 10
  value.route = {
    status: 'ready',
    from: 'Dizengoff 100, Tel Aviv',
    to: 'Bezalel 2, Raanana',
    distanceMiles: 10,
    precision: 'address',
    attribution: 'Powered by Geoapify',
    endpointRevision: 0,
  }
  return value
}
function packet(extra = {}) {
  return JSON.stringify({
    reply: 'Could you share photos of the rooms and large items?',
    basedOnRevision: 0,
    proposals: [],
    nextAction: 'request_photos',
    ...extra,
  })
}
const answer = (text: string, mode: 'binding' | 'mock' = 'binding') => ({ text, mode })
function provider() {
  const outputs = [
    { results: [{ lat: 32, lon: 34, formatted: 'Origin', result_type: 'building', rank: { confidence: 1 } }] },
    { results: [{ lat: 33, lon: 35, formatted: 'Destination', result_type: 'building', rank: { confidence: 1 } }] },
    { results: [{ distance: 16093.44, distance_units: 'Meters' }] },
  ]
  return vi.fn(async () => Response.json(outputs.shift()))
}
describe('review distance-token regressions', () => {
  it.each([
    ['1,000 miles', 1000],
    ['1,500 km', 932.0567883560009],
    ['1,000 meters', 0.621371192237334],
    ['1,000.5 miles', 1000.5],
    ['50.25 miles', 50.25],
    ['0 miles', 0],
    ['50km', 31.068559611866696],
    ['1,000miles', 1000],
  ] as const)('parses the complete supported numeric token: %s', (text, expected) => {
    expect(volunteeredDistance(text)).toBeCloseTo(expected, 10)
  })
  it.each([
    '1,00 miles',
    '1,000,00 miles',
    '1.000,5 km',
    '1..5 miles',
    '-1,000 miles',
    '−50 miles',
    '+50 miles',
    '1 000 miles',
    '50 miles and 70 km',
    '50 miles and -70 km',
    '1e3 miles',
    'abc50 miles',
  ])('rejects malformed/ambiguous numeric tokens without suffix parsing: %s', (text) => {
    expect(volunteeredDistance(text)).toBeNull()
  })
  it('keeps grouped distance correct through runner and revisioned reducer', async () => {
    const value = state()
    value.messages = [{ id: 'u', role: 'user', content: '1,000 miles' }]
    const response = await runConversationAgent({
      snapshot: conversationSnapshot(value),
      messages: value.messages,
      model: async () =>
        answer(
          packet({
            proposals: [
              { id: 'p', expectedRevision: 0, command: { type: 'details.patch', patch: { distanceMiles: 1000 } } },
            ],
          }),
        ),
    })
    const command = response.proposals[0].command
    const next = reduceConversation(value, { ...command, id: 'apply', source: 'chat', expectedRevision: 0 })
    expect(next.moveDetails.distanceMiles).toBe(1000)
  })
})
describe('review accepted-fact coherence', () => {
  it('prefers the accepted actual route over distance-only edits without competing fact evidence', () => {
    const value = routedState()
    value.messages = [{ id: 'u', role: 'user', content: '50 miles' }]
    const next = reduceConversation(value, {
      type: 'details.patch',
      patch: { distanceMiles: 50 },
      facts: [
        {
          field: 'distanceMiles',
          sourceMessageId: 'u',
          wording: '50 miles',
          uncertainty: 'certain',
          precision: 'exact',
          correction: true,
        },
      ],
      source: 'panel',
      id: 'distance',
      expectedRevision: 0,
    })
    expect(next.moveDetails.distanceMiles).toBe(10)
    expect(next.route).toEqual(value.route)
    expect(next.facts.filter((fact) => fact.field === 'distanceMiles')).toEqual([])
    expect(conversationSnapshot(next).route).toEqual(value.route)
  })
  it('keeps pending endpoint corrections separate from the accepted route until apply', () => {
    const value = routedState()
    const next = reduceConversation(value, {
      type: 'proposal.add',
      proposal: { id: 'p', expectedRevision: 0, command: { type: 'details.patch', patch: { from: 'Haifa' } } },
      source: 'agent',
      id: 'suggest',
      expectedRevision: 0,
    })
    expect(next.route).toEqual(value.route)
    expect(next.moveDetails.distanceMiles).toBe(10)
  })
  it('rejects simultaneous exact-date and date-window evidence in one patch', () => {
    const value = state()
    value.messages = [{ id: 'u', role: 'user', content: 'January, actually 2027-02-02' }]
    const next = reduceConversation(value, {
      type: 'details.patch',
      patch: { date: '2027-02-02' },
      facts: [
        {
          field: 'date',
          sourceMessageId: 'u',
          wording: '2027-02-02',
          uncertainty: 'certain',
          precision: 'exact',
          correction: true,
        },
        {
          field: 'dateWindow',
          sourceMessageId: 'u',
          wording: 'January',
          uncertainty: 'uncertain',
          precision: 'window',
          correction: false,
        },
      ],
      source: 'chat',
      id: 'both-dates',
      expectedRevision: 0,
    })
    expect(next).toBe(value)
  })
  it('supersedes exact date and date window as one slot on replacement or clearing', () => {
    const value = state()
    value.facts = [
      {
        field: 'dateWindow',
        sourceMessageId: 'u',
        wording: 'January',
        uncertainty: 'uncertain',
        precision: 'window',
        correction: false,
      },
    ]
    value.messages = [
      { id: 'u', role: 'user', content: 'January' },
      { id: 'u2', role: 'user', content: '2027-02-02' },
    ]
    const exact = reduceConversation(value, {
      type: 'details.patch',
      patch: { date: '2027-02-02' },
      facts: [
        {
          field: 'date',
          sourceMessageId: 'u2',
          wording: '2027-02-02',
          uncertainty: 'certain',
          precision: 'exact',
          correction: true,
        },
      ],
      source: 'chat',
      id: 'exact',
      expectedRevision: 0,
    })
    expect(exact.facts.map((fact) => fact.field)).toEqual(['date'])
    const cleared = reduceConversation(value, {
      type: 'details.patch',
      patch: { date: null },
      source: 'panel',
      id: 'clear',
      expectedRevision: 0,
    })
    expect(cleared.facts).toEqual([])
    const window = reduceConversation(exact, {
      type: 'details.patch',
      patch: { date: null },
      facts: value.facts,
      source: 'chat',
      id: 'window',
      expectedRevision: exact.revision,
    })
    expect(window.facts.map((fact) => fact.field)).toEqual(['dateWindow'])
  })
})
describe('repeated typed clarification recovery', () => {
  it.each([
    [
      'date',
      'Please clarify the date using YYYY-MM-DD.',
      'I do not know the date yet; let us upload photos',
      'request_photos',
    ],
    ['date', 'Please clarify the date using YYYY-MM-DD.', 'The date is still unknown', 'review'],
    [
      'address_city',
      'Please provide the complete street address and city for this replacement.',
      'I only know the cities and cannot provide a street yet; let us upload photos',
      'clarify_origin',
    ],
    [
      'address_city',
      'Please provide the complete street address and city for this replacement.',
      'I cannot provide the destination street yet',
      'clarify_destination',
    ],
  ])(
    'recovers from repeated optional %s with aligned photo guidance',
    async (clarification, previous, content, nextAction) => {
      const value = state()
      value.moveDetails.from = 'Tel Aviv'
      value.moveDetails.to = 'Raanana'
      const model = vi.fn(async () => answer(packet({ clarification, nextAction })))
      const result = await runConversationAgent({
        snapshot: conversationSnapshot(value),
        messages: [
          { id: 'a', role: 'assistant', content: previous },
          { id: 'u', role: 'user', content },
        ],
        model,
      })
      expect(result.reply).not.toBe(previous)
      expect(result.reply).toMatch(/photo/i)
      expect(result.reply).not.toMatch(/date|street/i)
      expect(result.agent?.nextAction).toBe('request_photos')
      expect(model).toHaveBeenCalledTimes(1)
    },
  )
  it('also recovers when the repeated typed clarification comes from tool continuation', async () => {
    const model = vi.fn(async (request: ConversationModelRequest) =>
      answer(
        packet(
          request.phase === 'interpret'
            ? { tools: [{ type: 'resolve_route' }] }
            : { nextAction: 'review', clarification: 'date' },
        ),
      ),
    )
    const result = await runConversationAgent({
      snapshot: conversationSnapshot(state()),
      messages: [
        { id: 'a', role: 'assistant', content: 'Please clarify the date using YYYY-MM-DD.' },
        { id: 'u', role: 'user', content: 'I do not know the date yet; let us upload photos' },
      ],
      model,
    })
    expect(result.reply).toMatch(/photo/i)
    expect(result.agent).toMatchObject({ nextAction: 'request_photos', route: { status: 'unconfigured' } })
    expect(model).toHaveBeenCalledTimes(2)
  })
  it('asks for genuinely missing endpoint context instead of bypassing it for photos', async () => {
    const value = state()
    value.moveDetails.to = null
    const previous = 'Please provide the complete street address and city for this replacement.'
    const result = await runConversationAgent({
      snapshot: conversationSnapshot(value),
      messages: [
        { id: 'a', role: 'assistant', content: previous },
        { id: 'u', role: 'user', content: 'I cannot provide a street yet' },
      ],
      model: async () => answer(packet({ nextAction: 'clarify_origin', clarification: 'address_city' })),
    })
    expect(result.reply).not.toBe(previous)
    expect(result.reply).not.toMatch(/photo/i)
    expect(result.reply).toMatch(/delivery|destination/i)
    expect(result.agent?.nextAction).toBe('clarify_destination')
  })
  it.each([
    ['date', 'review', /date.*YYYY-MM-DD/i],
    ['address_city', 'clarify_origin', /complete street address and city/i],
  ] as const)('preserves the first useful typed %s clarification', async (clarification, nextAction, wording) => {
    const result = await runConversationAgent({
      snapshot: conversationSnapshot(state()),
      messages: [
        { id: 'a', role: 'assistant', content: 'What would you like to clarify?' },
        { id: 'u', role: 'user', content: 'Please check the details' },
      ],
      model: async () => answer(packet({ clarification, nextAction })),
    })
    expect(result.reply).toMatch(wording)
    expect(result.agent?.nextAction).toBe(nextAction)
  })
})
describe('review model-selected action and tool continuation', () => {
  it.each(['Could you share photos of the rooms and large items?', 'Your booking is confirmed.'])(
    'preserves targeted clarification with both endpoints known: %s',
    async (reply) => {
      const fetcher = provider()
      const result = await runConversationAgent({
        snapshot: conversationSnapshot(state()),
        messages: [{ id: 'u', role: 'user', content: 'I meant the other address' }],
        key: 'key',
        fetcher,
        model: async () => answer(packet({ reply, nextAction: 'clarify_origin', clarification: 'address_city' })),
      })
      expect(result.agent?.nextAction).toBe('clarify_origin')
      expect(result.reply).toMatch(/complete street address and city/i)
      expect(fetcher).not.toHaveBeenCalled()
    },
  )
  it('does not auto-route an unchanged endpoint patch without a model tool intent', async () => {
    const fetcher = provider()
    await runConversationAgent({
      snapshot: conversationSnapshot(state()),
      messages: [{ id: 'u', role: 'user', content: 'Dizengoff 100, Tel Aviv' }],
      key: 'key',
      fetcher,
      model: async () =>
        answer(
          packet({
            proposals: [
              {
                id: 'p',
                expectedRevision: 0,
                command: { type: 'details.patch', patch: { from: 'Dizengoff 100, Tel Aviv' } },
              },
            ],
          }),
        ),
    })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('routes existing validated endpoints only on intent and returns actual results to continuation', async () => {
    const fetcher = provider()
    const requests: ConversationModelRequest[] = []
    const model = vi.fn(async (request: ConversationModelRequest) => {
      requests.push(request)
      return answer(
        packet(
          request.phase === 'interpret'
            ? { tools: [{ type: 'resolve_route' }] }
            : { nextAction: 'clarify_destination', clarification: 'address_city' },
        ),
      )
    })
    const result = await runConversationAgent({
      snapshot: conversationSnapshot(state()),
      messages: [{ id: 'u', role: 'user', content: 'Check the driving route' }],
      key: 'key',
      fetcher,
      model,
    })
    expect(requests.map((request) => request.phase)).toEqual(['interpret', 'continue'])
    expect(requests[1].toolResults).toMatchObject([
      { type: 'resolve_route', route: { status: 'ready', distanceMiles: 10 } },
    ])
    expect(result.agent).toMatchObject({
      nextAction: 'clarify_destination',
      route: { status: 'ready', distanceMiles: 10 },
    })
    expect(result.reply).toMatch(/complete street address and city/i)
    expect(result.proposals[0].command).toMatchObject({
      type: 'details.patch',
      patch: { distanceMiles: 10 },
      route: { status: 'ready' },
    })
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(model).toHaveBeenCalledTimes(2)
  })
  it('keeps missing routing nonblocking and gives the real unconfigured result to the model', async () => {
    const model = vi.fn(async (request: ConversationModelRequest) =>
      answer(packet(request.phase === 'interpret' ? { tools: [{ type: 'resolve_route' }] } : {})),
    )
    const result = await runConversationAgent({ snapshot: conversationSnapshot(state()), messages: [], model })
    expect(model.mock.calls[1][0].toolResults[0].route.status).toBe('unconfigured')
    expect(result.agent).toMatchObject({ nextAction: 'request_photos', route: { status: 'unconfigured' } })
    expect(result.reply).toMatch(/photo/i)
  })
  it('shares one malformed retry across interpretation and continuation, never more than four model calls or three provider calls', async () => {
    const fetcher = provider()
    const results = [
      'malformed-private-text',
      packet({ tools: [{ type: 'resolve_route' }] }),
      'malformed-again',
      packet(),
    ]
    const model = vi.fn(async () => answer(results.shift() ?? 'unexpected-call'))
    await expect(
      runConversationAgent({ snapshot: conversationSnapshot(state()), messages: [], key: 'key', fetcher, model }),
    ).rejects.toThrow('Invalid conversation output')
    expect(model).toHaveBeenCalledTimes(3)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(JSON.stringify(model.mock.calls)).not.toContain('malformed-private-text')
  })
  it('uses the one available malformed retry during continuation without repeating provider requests', async () => {
    const fetcher = provider()
    const outputs = [
      packet({ tools: [{ type: 'resolve_route' }] }),
      'bad-private-continuation',
      packet({ nextAction: 'clarify_origin', clarification: 'address_city' }),
    ]
    const model = vi.fn(async (_request: ConversationModelRequest) => answer(outputs.shift() ?? 'unexpected-call'))
    const result = await runConversationAgent({
      snapshot: conversationSnapshot(state()),
      messages: [],
      key: 'key',
      fetcher,
      model,
    })
    expect(model.mock.calls.map(([request]) => [request.phase, request.retry])).toEqual([
      ['interpret', false],
      ['continue', false],
      ['continue', true],
    ])
    expect(model.mock.calls[2][0].toolResults).toMatchObject([
      { type: 'resolve_route', route: { status: 'ready', distanceMiles: 10 } },
    ])
    expect(JSON.stringify(model.mock.calls)).not.toContain('bad-private-continuation')
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(result.agent?.nextAction).toBe('clarify_origin')
  })
  it('does not execute repeated tool requests or model-supplied endpoints/URLs/results', async () => {
    for (const tools of [
      [{ type: 'resolve_route', from: 'arbitrary', url: 'https://evil.test' }],
      [{ type: 'resolve_route', route: { status: 'ready', distanceMiles: 0 } }],
    ]) {
      const fetcher = provider()
      await expect(
        runConversationAgent({
          snapshot: conversationSnapshot(state()),
          messages: [],
          key: 'key',
          fetcher,
          model: async () => answer(packet({ tools })),
        }),
      ).rejects.toThrow()
      expect(fetcher).not.toHaveBeenCalled()
    }
    const fetcher = provider()
    const model = vi.fn(async () => answer(packet({ tools: [{ type: 'resolve_route' }] })))
    await expect(
      runConversationAgent({ snapshot: conversationSnapshot(state()), messages: [], key: 'key', fetcher, model }),
    ).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(model.mock.calls.length).toBeLessThanOrEqual(4)
  })
  it('blocks tools for mock interpretation and never re-enables them after a mock mode transition', async () => {
    for (const modes of [
      ['mock', 'binding'],
      ['binding', 'mock', 'binding'],
    ] as const) {
      const fetcher = provider()
      let call = 0
      const model = vi.fn(async () => {
        const mode = modes[call] ?? 'binding'
        const first = call++ === 0
        return answer(
          first && mode === 'binding'
            ? 'bad-json'
            : packet(call < modes.length ? { tools: [{ type: 'resolve_route' }] } : {}),
          mode,
        )
      })
      await runConversationAgent({ snapshot: conversationSnapshot(state()), messages: [], key: 'key', fetcher, model })
      expect(fetcher).not.toHaveBeenCalled()
    }
  })
  it('prefers an accepted actual route over a newly volunteered distance in the runner too', async () => {
    const value = routedState()
    value.messages = [{ id: 'u', role: 'user', content: '50 miles' }]
    const result = await runConversationAgent({
      snapshot: conversationSnapshot(value),
      messages: value.messages,
      model: async () =>
        answer(
          packet({
            proposals: [
              { id: 'p', expectedRevision: 0, command: { type: 'details.patch', patch: { distanceMiles: 50 } } },
            ],
          }),
        ),
    })
    const command = result.proposals[0].command
    expect(command).toMatchObject({ patch: { distanceMiles: 10 } })
    expect(command).not.toHaveProperty('facts.0')
  })
})
