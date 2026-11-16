import { Hono } from 'hono'
import { runText } from '../_lib/ai-client'
import { resolveRole } from '../_lib/ai-mode'
import { mockConversationTurn, zConversationRequest } from '../_lib/conversation-agent'
import { runConversationAgent } from '../_lib/conversation-runner'
import { conversationPrompt } from '../_lib/conversation-prompts'
import type { Bindings } from '../_lib/types'

const conversation = new Hono<{ Bindings: Bindings }>()

conversation.post('/', async (c) => {
  // Never log the request, provider exceptions, validation details or raw model output.
  const raw = await c.req.text().catch(() => '')
  let body: unknown
  try {
    if (raw.length > 128000) return c.json({ error: 'Invalid conversation request', retryable: false }, 400)
    body = JSON.parse(raw)
  } catch {
    return c.json({ error: 'Invalid conversation request', retryable: false }, 400)
  }
  const parsed = zConversationRequest.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Invalid conversation request', retryable: false }, 400)
  const { messages, snapshot } = parsed.data
  c.header('Cache-Control', 'no-store')
  try {
    // Freeze the Chat role for this request, including its one malformed-output retry.
    const role = await resolveRole(c.env, 'chat')
    c.header('x-movers-ai-mode', role.mode)
    let effectiveMock = false
    const response = await runConversationAgent({
      messages,
      snapshot,
      // The runner gates tools on each effective result mode, not the pre-fallback role.
      key: c.env.GEOAPIFY_API_KEY,
      model: async (request) => {
        const result = await runText(
          c.env,
          conversationPrompt(messages, request.snapshot, request.retry, request),
          () => {
            const mock = mockConversationTurn(messages, request.snapshot)
            return JSON.stringify(request.phase === 'continue' ? { ...mock, proposals: [] } : mock)
          },
          'chat',
          role,
        )
        effectiveMock ||= result.mode === 'mock'
        c.header('x-movers-ai-mode', effectiveMock ? 'mock' : result.mode)
        return result
      },
    })
    return c.json(response)
  } catch {
    // Sanitized, retryable failure: no proposals or partial state changes escape.
  }
  return c.json({ error: 'Conversation unavailable. Please retry.', retryable: true }, 502)
})

export default conversation
