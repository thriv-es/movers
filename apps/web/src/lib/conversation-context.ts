import type { ConversationSnapshot } from '../data/z-common/z-conversation'
import type { ChatMessage } from '../data/types/move-demo.types'

// Match the conversation ingress limits. These apply to wire context, not the durable timeline.
export const CONVERSATION_MESSAGE_LIMIT = 12000
const MESSAGE_COUNT_LIMIT = 200
const BODY_LIMIT = 128000
export class ConversationContextError extends Error {}

/** Keep the authoritative snapshot and latest turn whole; only discard older wire context. */
export function conversationContext(messages: ChatMessage[], snapshot: ConversationSnapshot) {
  const recent: ChatMessage[] = []
  const body = () => ({ messages: recent, snapshot })
  const fits = () => JSON.stringify(body()).length <= BODY_LIMIT
  if (!fits())
    throw new ConversationContextError(
      'The move context is too large for chat. Your manifest is unchanged; use its edit controls.',
    )
  for (let index = messages.length - 1; index >= 0 && recent.length < MESSAGE_COUNT_LIMIT; index--) {
    const message = messages[index]
    if (!message) break
    const valid = message.content.length <= CONVERSATION_MESSAGE_LIMIT && message.id.length <= 128
    if (!valid) {
      if (index === messages.length - 1)
        throw new ConversationContextError(
          'Please send a message of 12,000 characters or fewer. Your history is unchanged.',
        )
      // Do not skip a legacy invalid turn and accidentally attach an older question to a newer answer.
      break
    }
    recent.unshift({ id: message.id, role: message.role, content: message.content })
    if (!fits()) {
      recent.shift()
      // The immediate question is required context for short answers; never silently drop it for budget.
      if (index === messages.length - 1 || (index === messages.length - 2 && message.role === 'assistant'))
        throw new ConversationContextError(
          'The move context and latest message exceed the chat limit. Nothing was changed; shorten the message or use the manifest controls.',
        )
      break
    }
  }
  return body()
}
