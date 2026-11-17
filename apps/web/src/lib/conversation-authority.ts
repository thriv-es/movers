import type { ConversationProposal } from '../data/z-common/z-conversation'
import type { ChatMessage } from '../data'

/** Call only under original, still-current Send authority. Matching old transcript is insufficient. */
export function groundedConversationProposal(proposal: ConversationProposal, latest: ChatMessage | undefined): boolean {
  if (latest?.role !== 'user') return false
  const quoted = (source: { sourceMessageId: string; wording: string }) =>
    source.sourceMessageId === latest.id && latest.content.includes(source.wording)
  const command = proposal.command
  if (command.type === 'request.action') return true // intent only; no write authorization
  if (command.type === 'details.patch') {
    return Object.keys(command.patch).every((field) =>
      field === 'distanceMiles' && command.route
        ? true
        : command.facts?.some(
            (fact) => (fact.field === field || (field === 'date' && fact.field === 'dateWindow')) && quoted(fact),
          ),
    )
  }
  return !!proposal.evidence && quoted(proposal.evidence)
}
