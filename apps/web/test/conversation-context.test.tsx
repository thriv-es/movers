import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { zConversationRequest } from '../functions/api/_lib/conversation-agent'
import { conversationChatApi } from '../src/lib/api-client'
import { loadConversationSession, saveConversationSession } from '../src/lib/conversation-session'
import { conversationSnapshot, createConversationSession } from '../src/lib/conversation-state'
import { SESSION_KEY } from '../src/lib/estimate-session'
import { useConversationController } from '../src/lib/useConversationController'

const message = (id: string, content: string, role: 'user' | 'assistant' = 'user') => ({ id, role, content })
function transport() {
  const bodies: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_path, init) => {
      bodies.push(init.body)
      const body = JSON.parse(init.body)
      return Response.json({
        reply: 'What is the origin city or address?',
        basedOnRevision: body.snapshot.revision,
        proposals: [],
      })
    }),
  )
  return bodies
}
afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
  vi.unstubAllGlobals()
})

describe('bounded conversation transport without timeline loss', () => {
  it('sends recent context for over 200 persisted turns and retains the latest answer/question and entire timeline', async () => {
    const bodies = transport()
    const messages = Array.from({ length: 220 }, (_, index) => message(`old-${index}`, `History ${index}`))
    messages.push(message('question', 'What is the origin city or address?', 'assistant'))
    const initial = {
      ...createConversationSession(),
      messages,
      timeline: messages.map((entry) => ({ kind: 'message' as const, id: entry.id, revision: 0, message: entry })),
    }
    const { result } = renderHook(() => useConversationController(() => initial))
    await act(() => result.current.sendMessage('Tel Aviv'))
    const body = JSON.parse(bodies[0] ?? '{}')
    expect(zConversationRequest.safeParse(body).success).toBe(true)
    expect(body.messages.length).toBeLessThanOrEqual(200)
    expect(body.messages.slice(-2)).toEqual([
      messages.at(-1),
      expect.objectContaining({ role: 'user', content: 'Tel Aviv' }),
    ])
    expect(body.snapshot).toEqual(conversationSnapshot(initial))
    expect(result.current.session.messages.slice(0, 221)).toEqual(messages)
    expect(result.current.session.timeline.slice(0, 221)).toEqual(initial.timeline)
    expect(loadConversationSession().messages).toHaveLength(223)
  })

  it('rejects a 12001-character new command before append/storage/network, preserves draft, then accepts a short command', async () => {
    const bodies = transport()
    const { result } = renderHook(() => useConversationController())
    const before = window.sessionStorage.getItem(SESSION_KEY)
    act(() => result.current.setDraft('x'.repeat(12001)))
    await act(() => result.current.sendMessage())
    expect(bodies).toHaveLength(0)
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBe(before)
    expect(result.current.session.messages).toEqual([])
    expect(result.current.error).toMatch(/12000|12,000/)
    expect(result.current.draft).toHaveLength(12001)
    await act(() => result.current.sendMessage('hello'))
    expect(bodies).toHaveLength(1)
    expect(result.current.error).toBeNull()
    expect(result.current.session.messages.map((entry) => entry.content)).toEqual([
      'hello',
      'What is the origin city or address?',
    ])
  })

  it('does not let a reloaded oversized historical message poison a fresh short request or erase history', async () => {
    const bodies = transport()
    const messages = [
      message('legacy', 'x'.repeat(12001)),
      message('question', 'What is the destination city or address?', 'assistant'),
    ]
    saveConversationSession({
      ...createConversationSession(),
      messages,
      timeline: messages.map((entry) => ({ kind: 'message', id: entry.id, revision: 0, message: entry })),
    })
    const { result } = renderHook(() => useConversationController())
    await act(() => result.current.sendMessage('Raanana'))
    expect(zConversationRequest.safeParse(JSON.parse(bodies[0] ?? '{}')).success).toBe(true)
    expect(JSON.parse(bodies[0]).messages).toEqual([messages[1], expect.objectContaining({ content: 'Raanana' })])
    expect(loadConversationSession().messages[0]).toEqual(messages[0])
    expect(result.current.session.timeline[0]).toMatchObject({ message: messages[0] })
  })

  it('budgets the exact escaped JSON including the full snapshot and never truncates the latest command', async () => {
    const bodies = transport()
    const state = conversationSnapshot(createConversationSession())
    state.inventory = [{ type: 'legacy'.repeat(4000), count: 10001 }]
    state.review.duplicateResolutions = { ['legacy'.repeat(4000)]: 'different' }
    const messages = Array.from({ length: 30 }, (_, index) => message(`old-${index}`, '\u0000'.repeat(12000)))
    messages.push(
      message('question', 'What is the origin city or address?', 'assistant'),
      message('latest', '\u0001'.repeat(12000)),
    )
    const original = structuredClone(messages)
    await conversationChatApi(messages, state)
    expect(bodies[0].length).toBeLessThanOrEqual(128000)
    const body = JSON.parse(bodies[0])
    expect(zConversationRequest.safeParse(body).success).toBe(true)
    expect(Object.keys(body).sort()).toEqual(['messages', 'snapshot'])
    expect(body.snapshot).toEqual(state)
    expect(body.messages.slice(-2)).toEqual(original.slice(-2))
    expect(messages).toEqual(original)
  })

  it('retains bounded latest-turn retry authorization but does not grant it again after reload', async () => {
    const initial = createConversationSession()
    initial.messages = Array.from({ length: 205 }, (_, index) => message(`old-${index}`, 'Old history'))
    initial.timeline = initial.messages.map((entry) => ({ kind: 'message', id: entry.id, revision: 0, message: entry }))
    let fail = true
    const bodies: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_path, init) => {
        const body = JSON.parse(init.body)
        expect(zConversationRequest.safeParse(body).success).toBe(true)
        bodies.push(body)
        if (fail) throw new Error('Offline')
        return Response.json({
          reply: 'Review the proposed update.',
          basedOnRevision: body.snapshot.revision,
          proposals: [
            {
              id: `proposal-${bodies.length}`,
              expectedRevision: body.snapshot.revision,
              command: {
                type: 'details.patch',
                patch: { from: 'Tel Aviv' },
                facts: [
                  {
                    field: 'from',
                    sourceMessageId: body.messages.filter((entry: { role: string }) => entry.role === 'user').at(-1).id,
                    wording: 'Tel Aviv',
                    uncertainty: 'certain',
                    precision: 'city',
                    correction: false,
                  },
                ],
              },
            },
          ],
        })
      }),
    )
    const hook = renderHook(() => useConversationController(() => initial))
    await act(() => hook.result.current.sendMessage('from Tel Aviv'))
    expect(hook.result.current.chatFailed).toBe(true)
    fail = false
    await act(() => hook.result.current.retryChat())
    expect(hook.result.current.session.moveDetails.from).toBe('Tel Aviv')
    expect(hook.result.current.session.messages.filter((entry) => entry.content === 'from Tel Aviv')).toHaveLength(1)
    hook.unmount()
    const reloaded = renderHook(() => useConversationController())
    act(() => reloaded.result.current.apply({ type: 'details.patch', patch: { from: 'Panel city' } }, 'panel'))
    await act(() => reloaded.result.current.retryChat())
    expect(reloaded.result.current.session.moveDetails.from).toBe('Panel city')
    expect(reloaded.result.current.session.pendingProposals).toHaveLength(1)
  })

  it('accepts exactly 12000 characters without truncating them', async () => {
    const bodies = transport()
    const { result } = renderHook(() => useConversationController())
    await act(() => result.current.sendMessage('x'.repeat(12000)))
    expect(JSON.parse(bodies[0]).messages[0].content).toBe('x'.repeat(12000))
    expect(loadConversationSession().messages[0].content).toBe('x'.repeat(12000))
  })

  it('stops at oversized legacy context instead of attaching an unrelated older question', async () => {
    const bodies = transport()
    await conversationChatApi(
      [
        message('old-question', 'What is the origin city or address?', 'assistant'),
        message('long-id'.repeat(30), 'Historical answer'),
        message('oversized-question', 'x'.repeat(12001), 'assistant'),
        message('latest', 'hello'),
      ],
      conversationSnapshot(createConversationSession()),
    )
    expect(JSON.parse(bodies[0]).messages).toEqual([message('latest', 'hello')])
  })

  it('does not drop the immediate question to squeeze a short answer into an unfit body', async () => {
    const bodies = transport()
    const messages = [message('question', '\u0000'.repeat(12000), 'assistant')]
    const initial = {
      ...createConversationSession(),
      items: [{ type: 'x'.repeat(60000), count: 1 }],
      messages,
      timeline: messages.map((entry) => ({ kind: 'message' as const, id: entry.id, revision: 0, message: entry })),
    }
    const { result } = renderHook(() => useConversationController(() => initial))
    const before = window.sessionStorage.getItem(SESSION_KEY)
    await act(() => result.current.sendMessage('yes'))
    expect(bodies).toEqual([])
    expect(result.current.session).toEqual(initial)
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBe(before)
    expect(result.current.error).toMatch(/context.*limit/i)
  })

  it('rejects an unfit authoritative snapshot before appending a new command instead of dropping domain data', async () => {
    const bodies = transport()
    const initial = { ...createConversationSession(), items: [{ type: 'x'.repeat(128000), count: 1 }] }
    const { result } = renderHook(() => useConversationController(() => initial))
    const before = window.sessionStorage.getItem(SESSION_KEY)
    await act(() => result.current.sendMessage('hello'))
    expect(bodies).toEqual([])
    expect(result.current.session).toEqual(initial)
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBe(before)
    expect(result.current.error).toMatch(/context|large|limit/i)
  })
})
