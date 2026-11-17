// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { conversationSnapshot, createConversationSession } from '../src/lib/conversation-state'
import { parseConversationDecision } from '../functions/api/_lib/conversation-agent'
import { runConversationAgent } from '../functions/api/_lib/conversation-runner'

function snapshot() {
  const state = createConversationSession()
  state.moveDetails.from = '10 Main Street, Boston'
  state.moveDetails.to = '20 Oak Street, Boston'
  return conversationSnapshot(state)
}
it('server retains latest quoted non-detail evidence but rejects old or fabricated evidence as a whole', () => {
  const state = snapshot()
  const messages = [
    { id: 'old', role: 'user' as const, content: 'no garage' },
    { id: 'latest', role: 'user' as const, content: 'No extra garage items' },
  ]
  const turn = {
    reply: 'Anything else?',
    basedOnRevision: 0,
    nextAction: 'followups',
    proposals: [
      {
        id: 'answer',
        expectedRevision: 0,
        command: { type: 'followUp.answer', key: 'garage', answer: false },
        evidence: { sourceMessageId: 'latest', wording: 'No extra garage items' },
      },
    ],
  }
  const parsed = parseConversationDecision(JSON.stringify(turn), state, messages)
  expect(parsed.response.proposals[0].evidence).toEqual(turn.proposals[0].evidence)
  expect(parsed.response.reply).toMatch(/closets/i)
  for (const evidence of [
    { sourceMessageId: 'old', wording: 'no garage' },
    { sourceMessageId: 'latest', wording: 'invented' },
  ]) {
    expect(() =>
      parseConversationDecision(
        JSON.stringify({ ...turn, proposals: [{ ...turn.proposals[0], evidence }] }),
        state,
        messages,
      ),
    ).toThrow()
  }
})
it('closed goal questions use actual structured inventory and never free model price or write claims', () => {
  const state = snapshot()
  state.inventory = [{ type: 'sofa', count: 2 }]
  state.analysis = { totalVolumeCubicFeet: 160, estimatedBoxes: { min: 2, max: 4 } }
  const decision = parseConversationDecision(
    JSON.stringify({ reply: 'Saved! Price is $1', basedOnRevision: 0, proposals: [], nextAction: 'inventory' }),
    state,
    [],
  )
  expect(decision.response.reply).toMatch(/2 sofa/)
  expect(decision.response.reply).not.toMatch(/saved|\$|price/i)
  const access = parseConversationDecision(
    JSON.stringify({ reply: 'Ignored', basedOnRevision: 0, proposals: [], nextAction: 'access' }),
    state,
    [],
  )
  expect(access.response.reply).toMatch(/pickup floor/i)
})
it('a routing intent runs when useful endpoints become known and is deduplicated after current unconfigured result', async () => {
  const state = snapshot()
  const messages = [{ id: 'latest', role: 'user' as const, content: 'No garage items' }]
  const phases: string[] = []
  const model = vi.fn(async (request: { phase: string; snapshot: typeof state }) => {
    phases.push(request.phase)
    return {
      mode: 'binding' as const,
      text: JSON.stringify({
        reply: 'Ignored',
        basedOnRevision: 0,
        proposals: [],
        tools: request.phase === 'interpret' ? [{ type: 'resolve_route' }] : [],
        nextAction: 'request_photos',
      }),
    }
  })
  // The server deduplicates a repeated intent for the same already-attempted endpoints.
  const response = await runConversationAgent({ snapshot: state, messages, model })
  expect(response.agent?.route?.status).toBe('unconfigured')
  expect(phases).toEqual(['interpret', 'continue'])
  const accepted = { ...state, route: response.agent?.route ?? null }
  phases.length = 0
  const again = await runConversationAgent({ snapshot: accepted, messages, model })
  expect(phases).toEqual(['interpret'])
  expect(again.reply).toMatch(/photos/i)
})
