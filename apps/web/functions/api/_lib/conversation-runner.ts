import type { ConversationSnapshot } from '../../../src/data/z-common/z-conversation'
import type { ChatMessage } from '../../../src/data/types/move-demo.types'
import { type ConversationResponse, parseConversationTurn, zConversationResponse } from './conversation-agent'
import { resolveConversationRoute } from './conversation-tools'

interface AgentInput {
  messages: ChatMessage[]
  snapshot: ConversationSnapshot
  /** The caller freezes its resolved Chat role; retry receives no failed text. */
  model: (retry: boolean) => Promise<string>
  key?: string
  fetcher?: (input: string | URL, init?: RequestInit) => Promise<Response>
}
/** One interpretation plus at most one malformed retry (2 <= the 4-call ceiling), then <=3 read-only tools. */
export async function runConversationAgent(input: AgentInput): Promise<ConversationResponse> {
  let turn: ConversationResponse | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await input.model(attempt > 0) // transport failures are not malformed-output retries
    try {
      turn = parseConversationTurn(text, input.snapshot, input.messages, true)
      break
    } catch {
      /* no partial result */
    }
  }
  if (!turn) throw new Error('Invalid conversation output')
  const detail = turn.proposals.find((proposal) => proposal.command.type === 'details.patch')
  const command = detail?.command.type === 'details.patch' ? detail.command : undefined
  const details = { ...input.snapshot.moveDetails, ...command?.patch }
  const useful = (value: string | null) => !!value?.trim() && /\p{L}/u.test(value)
  const nextAction = !useful(details.from)
    ? 'clarify_origin'
    : !useful(details.to)
      ? 'clarify_destination'
      : !input.snapshot.photos.length
        ? 'request_photos'
        : 'review'
  const route =
    details.from &&
    details.to &&
    useful(details.from) &&
    useful(details.to) &&
    (command?.patch.from !== undefined || command?.patch.to !== undefined)
      ? await resolveConversationRoute(
          { from: details.from, to: details.to, revision: input.snapshot.revision },
          input.key,
          input.fetcher,
        )
      : undefined
  if (command && route) {
    command.route = route
    if (route.status === 'ready' && route.precision === 'address') {
      command.patch.distanceMiles = route.distanceMiles
      command.facts = command.facts?.filter((fact) => fact.field !== 'distanceMiles')
    }
  }
  const priorQuestion = input.messages.filter((message) => message.role === 'assistant').at(-1)?.content
  if (turn.reply === priorQuestion && nextAction !== 'review') {
    turn.reply =
      nextAction === 'request_photos'
        ? 'Please attach photos of the rooms and large items in this chat.'
        : nextAction === 'clarify_origin'
          ? 'Which city is the pickup in? A street address is useful if known.'
          : 'Which city is the delivery in? A street address is useful if known.'
  }
  return zConversationResponse.parse({ ...turn, agent: { nextAction, ...(route ? { route } : {}) } })
}
