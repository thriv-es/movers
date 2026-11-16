import { expect, it } from 'vitest'
import { conversationPrompt } from '../functions/api/_lib/conversation-prompts'
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
