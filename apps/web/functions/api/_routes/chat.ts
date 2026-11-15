import { Hono } from 'hono'
import type { Bindings } from '../_lib/types'
import type { ChatApiResponse } from '../../../src/data'
import { zChatApiRequest } from '../../../src/data'
import { runText } from '../_lib/ai-client'
import { mockChatReply } from '../_lib/mock'
import { parseAssistantTurn } from '../_lib/move-details'
import { SYSTEM_PROMPT, substituteVars } from '../_lib/prompts'

const chat = new Hono<{ Bindings: Bindings }>()

/**
 * One chat turn. The model answers with prose plus a JSON session block; the server strips the block and returns
 * `{ reply, moveDetails, finished }`, so a chat bubble never contains JSON and the client never parses message text.
 */
chat.post('/', async (c) => {
  try {
    const parsed = zChatApiRequest.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: 'messages must be an array of chat messages' }, 400)
    }
    const { messages, moveDetails: previous } = parsed.data

    const conversation = messages
      .map((msg) => `${msg.role === 'user' ? 'Customer' : 'Assistant'}: ${msg.content}`)
      .join('\n\n')

    const prompt = substituteVars(SYSTEM_PROMPT, { conversation })

    const { text, mode } = await runText(c.env, prompt, () => mockChatReply(messages))
    c.header('x-movers-ai-mode', mode)

    const turn = parseAssistantTurn(text, previous)
    const apiResponse: ChatApiResponse = {
      reply: turn.reply,
      moveDetails: turn.moveDetails,
      finished: turn.finished,
    }
    return c.json(apiResponse)
  } catch (error) {
    console.error('Chat API error:', error)
    return c.json({ error: error instanceof Error ? error.message : 'Internal server error' }, 500)
  }
})

export default chat
