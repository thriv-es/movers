import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useConversationController } from '../src/lib/useConversationController'
import { createConversationSession } from '../src/lib/conversation-state'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})
it('applies source-bound facts with sole initial Send but keeps confirmed corrections explicit', async () => {
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
    expect(hook.result.current.session.moveDetails.from).toBe(confirmed ? 'Tel Aviv' : 'Haifa')
    expect(hook.result.current.session.pendingProposals).toHaveLength(confirmed ? 1 : 0)
    expect(hook.result.current.session.facts).toHaveLength(confirmed ? 0 : 1)
    hook.unmount()
    vi.restoreAllMocks()
  }
})
