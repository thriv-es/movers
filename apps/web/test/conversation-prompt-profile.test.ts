import { expect, it } from 'vitest'
import { conversationPrompt } from '../functions/api/_lib/conversation-prompts'
import { parseConversationDecision } from '../functions/api/_lib/conversation-agent'
import { runConversationAgent } from '../functions/api/_lib/conversation-runner'
import { conversationSnapshot, createConversationSession } from '../src/lib/conversation-state'

const messages = [
  {
    id: 'distance-request',
    role: 'user' as const,
    content: 'Please calculate the driving distance using your route tool.',
  },
]
const session = createConversationSession()
const snapshot = conversationSnapshot({
  ...session,
  moveDetails: { ...session.moveDetails, from: 'Dizengoff 100, Tel Aviv', to: 'Bezalel 2, Raanana' },
})
const example = (prompt: string) =>
  JSON.parse(prompt.split('\n').find((line) => line.startsWith('{') && line.endsWith('}')) ?? '{}')

it('provides a closed tool-selection interpretation example and a frozen continuation example through the actual runner', async () => {
  const phases: string[] = []
  const result = await runConversationAgent({
    messages,
    snapshot,
    model: async (request) => {
      phases.push(request.phase)
      const decision = example(conversationPrompt(messages, request.snapshot, request.retry, request))
      expect(decision.basedOnRevision).toBe(snapshot.revision)
      if (request.phase === 'interpret') expect(decision.tools).toEqual([{ type: 'resolve_route' }])
      else {
        expect(decision.proposals).toEqual([])
        expect(decision.tools).toEqual([])
        expect(decision.facts ?? []).toEqual([])
        expect(request.toolResults[0]?.route.status).toBe('unconfigured')
      }
      return { mode: 'binding', text: JSON.stringify(decision) }
    },
  })
  expect(phases).toEqual(['interpret', 'continue'])
  expect(result.agent?.route?.status).toBe('unconfigured')
  expect(result.agent?.nextAction).toBe('request_photos')
})
it.each([false, true])(
  'provides nonempty exact extraction envelopes that pass the actual parser with the hypothetical source (retry %s)',
  (retry) => {
    const captured = { ...snapshot, revision: 7 }
    const prompt = conversationPrompt(messages, captured, retry, {
      phase: 'interpret',
      retry,
      snapshot: captured,
      toolResults: [],
    })
    const values = prompt
      .split('\n')
      .filter((line) => line.startsWith('{') && line.endsWith('}'))
      .map((line) => JSON.parse(line))
    const source = values.find((value) => value.role === 'user' && typeof value.id === 'string')
    const extraction = values.find((value) => value.proposals?.length > 0 && value.facts?.length > 0)
    expect(source).toBeDefined()
    expect(extraction).toBeDefined()
    const parsed = parseConversationDecision(JSON.stringify(extraction), captured, [source])
    expect(parsed.response.basedOnRevision).toBe(7)
    expect(parsed.response.proposals).toHaveLength(1)
    expect(parsed.response.proposals[0]).toMatchObject({
      expectedRevision: 7,
      command: {
        type: 'details.patch',
        patch: { from: 'Dizengoff 100, Tel Aviv', to: 'Bezalel 2, Raanana', date: '2027-01-11' },
      },
    })
    const command = parsed.response.proposals[0].command
    if (command.type !== 'details.patch') throw new Error('Missing details example')
    expect(command.facts).toHaveLength(3)
    for (const fact of command.facts ?? []) {
      expect(fact.sourceMessageId).toBe(source.id)
      expect(source.content).toContain(fact.wording)
      expect(fact).toMatchObject({ uncertainty: 'certain', correction: false })
    }
    expect(parsed.tools).toEqual([])
  },
)
it.each([
  { retry: false, field: 'distanceMiles' },
  { retry: true, field: 'distanceMiles' },
  { retry: false, field: 'date' },
  { retry: true, field: 'date' },
])('single-field $field example stays nested, sourced and read-only (retry $retry)', ({ retry, field }) => {
  const captured = { ...snapshot, revision: 7, moveDetails: { ...snapshot.moveDetails, date: '2027-01-11' } }
  const before = structuredClone(captured)
  const values = conversationPrompt(messages, captured, retry, {
    phase: 'interpret',
    retry,
    snapshot: captured,
    toolResults: [],
  })
    .split('\n')
    .filter((line) => line.startsWith('{') && line.endsWith('}'))
    .map((line) => JSON.parse(line))
  const decision = values.find((value) => {
    const patch = value.proposals?.[0]?.command?.patch
    return patch && Object.keys(patch).length === 1 && field in patch
  })
  expect(decision).toBeDefined()
  const source = values.find((value) => value.role === 'user' && value.id === decision.facts[0].sourceMessageId)
  expect(source).toBeDefined()
  const parsed = parseConversationDecision(JSON.stringify(decision), captured, [source])
  expect(parsed.tools).toEqual([])
  expect(parsed.response.proposals).toHaveLength(1)
  const command = parsed.response.proposals[0].command
  if (command.type !== 'details.patch') throw new Error('Missing nested details command')
  expect(Object.keys(command.patch)).toEqual([field])
  expect(command.facts).toHaveLength(1)
  expect(command.facts?.[0].sourceMessageId).toBe(source.id)
  expect(source.content).toContain(command.facts?.[0].wording)
  if (field === 'distanceMiles') {
    expect(source.content).toBe('50 km')
    expect(command.patch.distanceMiles).toBeCloseTo(31.0685596118667, 10)
  } else {
    expect(command.patch.date).toBeNull()
    expect(command.facts?.[0]).toMatchObject({ field: 'date', precision: 'unknown', correction: true })
  }
  expect(captured).toEqual(before)
  const malformed = structuredClone(decision)
  const { patch, ...envelope } = malformed.proposals[0].command
  malformed.proposals[0].command = { ...envelope, ...patch }
  expect(() => parseConversationDecision(JSON.stringify(malformed), captured, [source])).toThrow()
})
it.each([false, true])(
  'retains both uncertain city labels in the ambiguous prompt example through the actual protocol (retry %s)',
  async (retry) => {
    const captured = conversationSnapshot(createConversationSession())
    const values = conversationPrompt([], captured, retry)
      .split('\n')
      .filter((line) => line.startsWith('{') && line.endsWith('}'))
      .map((line) => JSON.parse(line))
    const decision = values.find((value) => value.clarification === 'geo_identity')
    expect(decision).toBeDefined()
    const source = values.find((value) => value.role === 'user' && value.id === decision.facts[0].sourceMessageId)
    expect(source.content).toBe('Moving from Springfield to Springfield; I do not know which state.')
    const response = await runConversationAgent({
      snapshot: captured,
      messages: [source],
      model: async () => ({ mode: 'binding', text: JSON.stringify(decision) }),
    })
    expect(response.proposals).toHaveLength(1)
    expect(response.proposals[0].command).toMatchObject({
      type: 'details.patch',
      patch: { from: 'Springfield', to: 'Springfield' },
      facts: [
        {
          field: 'from',
          wording: 'Springfield',
          sourceMessageId: source.id,
          uncertainty: 'uncertain',
          precision: 'city',
          correction: false,
        },
        {
          field: 'to',
          wording: 'Springfield',
          sourceMessageId: source.id,
          uncertainty: 'uncertain',
          precision: 'city',
          correction: false,
        },
      ],
    })
    expect(response.agent?.nextAction).toBe('clarify_origin')
    expect(response.reply).toMatch(/state|country/i)
    expect(response.reply).not.toMatch(/photo/i)
    expect(decision.tools).toEqual([])
  },
)
it('does not show any nonempty extraction example in continuation', () => {
  const prompt = conversationPrompt(messages, snapshot, false, {
    phase: 'continue',
    retry: false,
    snapshot,
    toolResults: [],
  })
  const decisions = prompt
    .split('\n')
    .filter((line) => line.startsWith('{') && line.endsWith('}'))
    .map((line) => JSON.parse(line))
    .filter((value) => Array.isArray(value.proposals))
  expect(decisions).toHaveLength(1)
  const parsed = parseConversationDecision(JSON.stringify(decisions[0]), snapshot, messages)
  expect(parsed.response.proposals).toEqual([])
  expect(parsed.tools).toEqual([])
})
it('keeps the continuation example read-only even on a malformed-output retry', () => {
  const decision = example(
    conversationPrompt(messages, snapshot, true, {
      phase: 'continue',
      retry: true,
      snapshot,
      toolResults: [
        {
          type: 'resolve_route',
          route: {
            status: 'unconfigured',
            from: snapshot.moveDetails.from ?? '',
            to: snapshot.moveDetails.to ?? '',
            endpointRevision: snapshot.revision,
            precision: 'city',
            attribution: 'Powered by Geoapify',
          },
        },
      ],
    }),
  )
  expect(decision.proposals).toEqual([])
  expect(decision.tools).toEqual([])
  expect(decision.facts ?? []).toEqual([])
})
