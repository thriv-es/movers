import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useConversationController } from '../src/lib/useConversationController'
import { createConversationSession } from '../src/lib/conversation-state'
import { loadConversationSession } from '../src/lib/conversation-session'
import { runConversationAgent } from '../functions/api/_lib/conversation-runner'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})
it.each([false, true])(
  'Refresh after a panel edit keeps old-user facts pending without new Send authority (reload: %s)',
  async (reload) => {
    const paths: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      paths.push(String(url))
      const request = JSON.parse(String(init?.body))
      return Response.json(
        await runConversationAgent({
          snapshot: request.snapshot,
          messages: request.messages,
          model: async () => ({
            mode: 'binding',
            text: JSON.stringify({
              reply: 'Could you share photos of the rooms and large items?',
              basedOnRevision: request.snapshot.revision,
              proposals: [
                {
                  id: 'details',
                  expectedRevision: request.snapshot.revision,
                  command: { type: 'details.patch', patch: { from: 'Tel Aviv', to: 'Raanana' } },
                },
              ],
            }),
          }),
        }),
      )
    })
    let hook = renderHook(() => useConversationController(createConversationSession))
    await act(async () => {
      await hook.result.current.sendMessage('from Tel Aviv to Raanana')
    })
    expect(hook.result.current.session.moveDetails.from).toBe('Tel Aviv')
    act(() => {
      hook.result.current.apply({ type: 'details.patch', patch: { from: 'Current panel origin' } }, 'panel')
    })
    if (reload) {
      hook.unmount()
      hook = renderHook(() => useConversationController(loadConversationSession))
    }
    const revision = hook.result.current.session.revision
    expect(hook.result.current.session.messages.at(-1)?.role).toBe('assistant')
    await act(async () => {
      await hook.result.current.retryChat()
    })
    expect(hook.result.current.chatFailed).toBe(false)
    expect(hook.result.current.session.moveDetails.from).toBe('Current panel origin')
    expect(hook.result.current.session.revision).toBe(revision)
    expect(hook.result.current.session.pendingProposals).toHaveLength(1)
    const proposal = hook.result.current.session.pendingProposals[0]
    expect(proposal.expectedRevision).toBe(revision)
    const sourceMessageId = hook.result.current.session.messages.find((message) => message.role === 'user')?.id
    expect(proposal.command).toMatchObject({
      facts: [
        { field: 'from', sourceMessageId, wording: 'from Tel Aviv to Raanana' },
        { field: 'to', sourceMessageId, wording: 'from Tel Aviv to Raanana' },
      ],
    })
    act(() => {
      hook.result.current.apply({ type: 'proposal.apply', proposalId: proposal.id }, 'inline')
    })
    expect(hook.result.current.session.moveDetails.from).toBe('Tel Aviv')
    expect(hook.result.current.session.messages.filter((message) => message.role === 'user')).toHaveLength(1)
    expect(paths).toEqual(['/api/conversation', '/api/conversation'])
  },
)
it('applies latest source-bound corrections with original Send even after explicit confirmation', async () => {
  for (const confirmed of [false, true]) {
    const state = createConversationSession()
    state.moveDetails.from = 'Tel Aviv'
    state.moveDetails.to = 'Raanana'
    state.detailsConfirmed = confirmed
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body))
      const message = request.messages.at(-1)
      return Response.json({
        reply: 'Please attach photos.',
        basedOnRevision: state.revision,
        proposals: [
          {
            id: 'proposal-one',
            expectedRevision: state.revision,
            command: {
              type: 'details.patch',
              patch: { from: 'Haifa' },
              facts: [
                {
                  field: 'from',
                  sourceMessageId: message.id,
                  wording: 'actually from Haifa',
                  uncertainty: 'certain',
                  precision: 'city',
                  correction: true,
                },
              ],
            },
          },
        ],
        agent: { nextAction: 'request_photos' },
      })
    })
    const hook = renderHook(() => useConversationController(() => state))
    await act(async () => {
      await hook.result.current.sendMessage('actually from Haifa')
    })
    expect(hook.result.current.session.nextAction).toBe('request_photos')
    expect(hook.result.current.session.moveDetails.from).toBe('Haifa')
    expect(hook.result.current.session.pendingProposals).toHaveLength(0)
    expect(hook.result.current.session.facts).toHaveLength(1)
    expect(hook.result.current.session.detailsConfirmed).toBe(false)
    hook.unmount()
    vi.restoreAllMocks()
  }
})
