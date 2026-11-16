import { describe, expect, it, vi } from 'vitest'
import * as domain from '../src/lib/conversation-state'
import { zConversationResponse } from '../src/lib/api-client'
import { conversationContext } from '../src/lib/conversation-context'
import { cases, evaluateDialogues, integrateReply, parseOptions } from '../scripts/evaluate-conversation.mjs'
import { runConversationAgent } from '../functions/api/_lib/conversation-runner'

const runtime = { ...domain, zConversationResponse, conversationContext }
const options = () => parseOptions(['--live', '--base-url', 'http://127.0.0.1:5650', '--case', 'freeform'])
const reply = (state, patch = {}) => ({
  reply: 'Please add room photos.',
  basedOnRevision: state.revision,
  agent: { nextAction: 'request_photos' },
  proposals: [{ id: 'details', expectedRevision: state.revision, command: { type: 'details.patch', patch } }],
})

describe('conversation evaluator opt-in and privacy boundaries', () => {
  it('requires explicit live opt-in and loopback base with bounded options', () => {
    for (const argv of [
      [],
      ['--live'],
      ['--base-url', 'http://127.0.0.1:5650'],
      ['--live', '--base-url', 'https://example.test'],
      ['--live', '--base-url', 'http://127.0.0.1.evil.test'],
      ['--live', '--base-url', 'http://secret@127.0.0.1:5650'],
      ['--live', '--base-url', 'http://127.0.0.1:5650/api'],
      ['--live', '--base-url', 'http://127.0.0.1:5650', '--timeout-ms', '999999'],
      ['--live', '--base-url', 'http://127.0.0.1:5650', '--case', 'not-a-case'],
    ])
      expect(() => parseOptions(argv)).toThrow()
    expect(options()).toMatchObject({ baseUrl: 'http://127.0.0.1:5650', timeoutMs: 30000 })
  })
  it('rejects incomplete optional flags rather than expanding an intended bounded selection', () => {
    for (const flag of ['--case', '--max-cases', '--timeout-ms'])
      expect(() => parseOptions(['--live', '--base-url', 'http://127.0.0.1:5650', flag])).toThrow()
  })
  it('declares the requested synthetic semantic cases, including an explicit real tool decision request', () => {
    expect(cases.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        'freeform',
        'kilometers',
        'miles',
        'correction',
        'unknown-date',
        'ambiguous-city',
        'repeated-answer',
        'injection',
        'route-tool',
      ]),
    )
    expect(cases.find((entry) => entry.id === 'route-tool').messages.join(' ')).toMatch(/calculate.*driving distance/i)
  })
  it('uses the production reducer and original-Send boundary, never auto-applies commercial hints or confirmed corrections', () => {
    let state = domain.createConversationSession()
    state = domain.reduceConversation(state, {
      id: 'user-action',
      type: 'message.append',
      source: 'chat',
      expectedRevision: 0,
      message: { id: 'user', role: 'user', content: 'Tel Aviv to Raanana' },
    })
    const next = integrateReply(runtime, state, reply(state, { from: 'Tel Aviv', to: 'Raanana' }), true)
    expect(next.moveDetails).toMatchObject({ from: 'Tel Aviv', to: 'Raanana' })
    expect(next.revision).toBe(1)
    expect(integrateReply(runtime, state, reply(state, { from: 'Tel Aviv' }), false).moveDetails.from).toBeNull()
    const confirmed = { ...next, detailsConfirmed: true }
    expect(integrateReply(runtime, confirmed, reply(confirmed, { from: 'Haifa' }), true).moveDetails.from).toBe(
      'Tel Aviv',
    )
    const commercial = {
      ...reply(next),
      proposals: [{ id: 'hint', expectedRevision: 1, command: { type: 'request.action', action: 'schedule' } }],
    }
    expect(integrateReply(runtime, next, commercial, true).operations).toEqual({})
    expect(() => integrateReply(runtime, next, reply(state, { from: 'Stale' }), true)).toThrow()
  })
  it('refuses mock/unknown backends and reports unavailable, not a live pass', async () => {
    for (const mode of ['mock', '']) {
      const fetcher = vi.fn(async () =>
        Response.json({ secret: 'RAW_PRIVATE' }, { headers: { 'x-movers-ai-mode': mode } }),
      )
      const result = await evaluateDialogues(options(), runtime, fetcher)
      expect(result.pass).toBe(false)
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(result)).not.toContain('RAW_PRIVATE')
    }
  })
  it('posts only conversation with valid snapshots, integrates all turns, and emits aggregate checks without text', async () => {
    const payloads: any[] = []
    const fetcher = vi.fn(async (url, init) => {
      expect(url).toBe('http://127.0.0.1:5650/api/conversation')
      expect(init.method).toBe('POST')
      expect(init.redirect).toBe('error')
      const data = JSON.parse(init.body)
      payloads.push(data)
      const latest = data.messages.filter((message) => message.role === 'user').at(-1).content
      const patch =
        latest === 'tel aviv'
          ? { from: 'Tel Aviv' }
          : latest === '2027-01-11'
            ? { date: '2027-01-11' }
            : { from: 'dizingoff 100 tel-aviv', to: 'bezalel street 2, raanana' }
      return Response.json(reply(data.snapshot, patch), { headers: { 'x-movers-ai-mode': 'binding' } })
    })
    const result = await evaluateDialogues(options(), runtime, fetcher)
    expect(result.pass).toBe(true)
    expect(payloads).toHaveLength(3)
    expect(payloads[2].snapshot.moveDetails).toMatchObject({
      from: 'dizingoff 100 tel-aviv',
      to: 'bezalel street 2, raanana',
    })
    expect(payloads[2].messages).toHaveLength(5)
    const text = JSON.stringify(result)
    for (const forbidden of ['tel aviv', 'dizingoff', 'Please add', 'receipt', 'photoUrl', 'secret'])
      expect(text).not.toContain(forbidden)
    expect(result.cases[0].checks).toEqual(
      expect.arrayContaining([
        { name: 'full_endpoints_preserved', pass: true },
        { name: 'exact_date', pass: true },
      ]),
    )
  })
  it('fails semantic regressions rather than treating any HTTP200 as fluency proof', async () => {
    const result = await evaluateDialogues(options(), runtime, async () =>
      Response.json(
        { reply: 'How many miles is your move?', basedOnRevision: 0, proposals: [] },
        { headers: { 'x-movers-ai-mode': 'binding' } },
      ),
    )
    expect(result.pass).toBe(false)
    expect(JSON.stringify(result)).not.toContain('How many miles')
  })
  it('scores every synthetic case through the real bounded runner/facts/reducer and unconfigured tool continuation', async () => {
    let continuations = 0
    const result = await evaluateDialogues(
      parseOptions(['--live', '--base-url', 'http://127.0.0.1:5650']),
      runtime,
      async (_url, init) => {
        const { messages, snapshot } = JSON.parse(init.body)
        const latest = messages.at(-1).content
        const output = await runConversationAgent({
          messages,
          snapshot,
          model: async (request) => {
            let patch: Record<string, string | number | null> | null = null
            if (request.phase === 'continue') {
              continuations++
              expect(request.toolResults[0]?.route.status).toBe('unconfigured')
            } else if (latest === 'tel aviv') patch = { from: 'Tel Aviv' }
            else if (latest.startsWith('dizingoff'))
              patch = { from: 'dizingoff 100 tel-aviv', to: 'bezalel street 2, raanana' }
            else if (latest === '2027-01-11') patch = { date: latest }
            else if (latest === '50 km' || latest === '50 mile') patch = { distanceMiles: 50 }
            else if (latest.startsWith('Change only')) patch = { from: '10 Herzl Street, Haifa' }
            else if (latest.startsWith('Moving from Springfield')) patch = { from: 'Springfield', to: 'Springfield' }
            return {
              mode: 'binding',
              text: JSON.stringify({
                reply: 'Please add room photos.',
                basedOnRevision: snapshot.revision,
                nextAction: latest.startsWith('Moving from Springfield')
                  ? 'clarify_origin'
                  : patch?.to || request.snapshot.moveDetails.to
                    ? 'request_photos'
                    : 'clarify_destination',
                proposals: patch
                  ? [{ id: 'details', expectedRevision: snapshot.revision, command: { type: 'details.patch', patch } }]
                  : [],
                tools:
                  request.phase === 'interpret' && latest.includes('calculate the driving distance')
                    ? [{ type: 'resolve_route' }]
                    : [],
              }),
            }
          },
        })
        return Response.json(output, { headers: { 'x-movers-ai-mode': 'binding' } })
      },
    )
    expect(result.cases).toHaveLength(9)
    expect(result.cases.filter((entry) => !entry.pass)).toEqual([])
    expect(result.pass).toBe(true)
    expect(continuations).toBe(1)
  })
  it.each([
    { from: null, to: null, text: 'Please add room photos.', want: false },
    { from: 'Springfield', to: 'Springfield', text: 'Please add room photos.', want: false },
    { from: 'Springfield', to: 'Springfield', text: 'Please share photos of the rooms at each address.', want: false },
    { from: 'Springfield', to: 'Springfield', text: 'Could you share photos at the pickup address?', want: false },
    { from: 'Springfield', to: 'Springfield', text: 'Which photos show each address?', want: false },
    { from: 'Springfield', to: 'Springfield', text: 'Please provide pictures of both cities.', want: false },
    {
      from: 'Springfield',
      to: 'Springfield',
      text: 'Please specify the state or country for each Springfield. Room photos can come now.',
      want: true,
    },
    { from: 'Springfield', to: 'Springfield', text: 'Which state or country is each Springfield in?', want: true },
    {
      from: 'Springfield',
      to: 'Springfield',
      text: 'Please provide the complete street address and city for this replacement.',
      want: true,
    },
    {
      from: 'Springfield',
      to: 'Springfield',
      text: 'Several cities are named Springfield; state or country would disambiguate them. You can share photos meanwhile.',
      want: true,
    },
  ])(
    'requires retained Springfield evidence and useful ambiguity response: $text / $from',
    async ({ from, to, text, want }) => {
      const result = await evaluateDialogues(
        { ...options(), caseId: 'ambiguous-city' },
        runtime,
        async (_url, init) => {
          const { snapshot } = JSON.parse(init.body)
          return Response.json(
            {
              reply: text,
              basedOnRevision: snapshot.revision,
              agent: { nextAction: text.startsWith('Which') ? 'clarify_origin' : 'request_photos' },
              proposals: from
                ? [
                    {
                      id: 'locations',
                      expectedRevision: snapshot.revision,
                      command: { type: 'details.patch', patch: { from, to } },
                    },
                  ]
                : [],
            },
            { headers: { 'x-movers-ai-mode': 'binding' } },
          )
        },
      )
      expect(result.pass).toBe(want)
      if (want)
        expect(result.cases[0].checks).toEqual(
          expect.arrayContaining([
            { name: 'ambiguous_places_retained', pass: true },
            { name: 'useful_ambiguity_response', pass: true },
          ]),
        )
    },
  )
  it.each([
    { text: 'What is your move date? You can add photos later.', want: false },
    { text: 'Please provide a move date before adding photos.', want: false },
    { text: 'Please provide a move date so we can add photos later.', want: false },
    { text: 'Please share the move date later before we can continue with photos.', want: false },
    { text: 'You can provide the date later so we can add photos.', want: false },
    { text: 'A move date is required before photos can be added later.', want: false },
    { text: 'Update the move date before we can add photos later.', want: false },
    { text: 'It is optional to provide a date later. Please add photos now.', want: true },
    { text: 'No move date is required. Please add photos now.', want: true },
    { text: 'You can share the date later if you learn it. Please add photos now.', want: true },
    { text: 'Please add photos now. You may update the move date whenever you know it.', want: true },
    { text: 'When are you moving? Room photos can follow.', want: false },
    { text: 'Tell me which day you move; photos can follow.', want: false },
    { text: 'Do you have a moving date yet? Please add photos.', want: false },
    { text: 'Your moving date? Please add photos.', want: false },
    { text: 'Please add photos. When you know the move date, update the manifest later.', want: true },
    { text: 'You do not need to know the date yet. Please add room photos.', want: true },
    { text: 'Please add room photos. If you learn the date later, update the manifest.', want: true },
    { text: 'Please add photos of the rooms you are moving.', want: true },
  ])('proves repeated optional clarification stops, not merely a photo keyword: $text', async ({ text, want }) => {
    const result = await evaluateDialogues({ ...options(), caseId: 'repeated-answer' }, runtime, async (_url, init) => {
      const { snapshot } = JSON.parse(init.body)
      return Response.json(
        {
          reply: text,
          basedOnRevision: snapshot.revision,
          agent: { nextAction: 'request_photos' },
          proposals: snapshot.moveDetails.from
            ? []
            : [
                {
                  id: 'locations',
                  expectedRevision: snapshot.revision,
                  command: {
                    type: 'details.patch',
                    patch: { from: 'Dizengoff 100, Tel Aviv', to: 'Bezalel 2, Raanana' },
                  },
                },
              ],
        },
        { headers: { 'x-movers-ai-mode': 'binding' } },
      )
    })
    expect(result.pass).toBe(want)
    expect(result.cases[0].checks).toContainEqual({ name: 'no_progress_recovery', pass: want })
  })
  it.each([
    { from: '100 Aviv', to: '2 bezalel raanana', want: false },
    { from: '100 Tel Aviv', to: '2 bezalel raanana', want: false },
    { from: 'Dizengoff 2100, Tel Aviv', to: 'Bezalel 2, Raanana', want: false },
    { from: 'Dizengoff 100, Tel Aviv', to: 'Bezalel 12, Raanana', want: false },
    { from: 'Dizengoff 100, Tel Aviv', to: 'Raanana 2', want: false },
    { from: 'dizingoff 100 tel-aviv', to: 'bezalel street 2, raanana', want: true },
    { from: '100 Dizengoff St., Tel-Aviv', to: '2 Betzalel Street, Ra’anana', want: true },
    { from: '100 Dizingof, TelAviv', to: '2 Betsalel, Ra anana', want: true },
    { from: 'דיזנגוף 100, תל אביב', to: 'בצלאל 2, רעננה', want: true },
  ])('requires full meaningful street, exact house number and city: $from → $to', async ({ from, to, want }) => {
    const result = await evaluateDialogues(options(), runtime, async (_url, init) => {
      const { snapshot } = JSON.parse(init.body)
      return Response.json(reply(snapshot, { from, to, date: '2027-01-11' }), {
        headers: { 'x-movers-ai-mode': 'binding' },
      })
    })
    expect(result.pass).toBe(want)
    expect(result.cases[0].checks).toContainEqual({ name: 'full_endpoints_preserved', pass: want })
  })
  it('sanitizes request exceptions and bounds a stalled request', async () => {
    const result = await evaluateDialogues(
      { ...options(), timeoutMs: 10 },
      runtime,
      async (_url, init) =>
        new Promise((_done, reject) => init.signal.addEventListener('abort', () => reject(new Error('private-token')))),
    )
    expect(result.pass).toBe(false)
    expect(JSON.stringify(result)).not.toContain('private-token')
  })
})
