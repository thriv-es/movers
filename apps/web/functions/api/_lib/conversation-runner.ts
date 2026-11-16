import type { ConversationSnapshot } from '../../../src/data/z-common/z-conversation'
import type { ChatMessage } from '../../../src/data/types/move-demo.types'
import {
  type ConversationDecision,
  type ConversationResponse,
  parseConversationDecision,
  zConversationResponse,
} from './conversation-agent'
import type { ConversationModel, ConversationModelRequest, ConversationToolResult } from './conversation-decisions'
import { resolveConversationRoute } from './conversation-tools'

export type {
  ConversationModelRequest,
  ConversationModel,
  ConversationToolIntent,
  ConversationToolResult,
} from './conversation-decisions'
export interface AgentInput {
  messages: ChatMessage[]
  snapshot: ConversationSnapshot
  /** Caller freezes the resolved Chat role. Every result reports its EFFECTIVE mode. */
  model: ConversationModel
  key?: string
  fetcher?: (input: string | URL, init?: RequestInit) => Promise<Response>
}
const useful = (value: string | null) => !!value?.trim() && /\p{L}/u.test(value)
/** Explicit model intent -> <=3 fixed read-only provider calls -> model action continuation.
 * One malformed retry is shared across phases; no more than four total model calls.
 */
export async function runConversationAgent(input: AgentInput): Promise<ConversationResponse> {
  let calls = 0
  let retried = false
  let mockSeen = false
  const ask = async (request: Omit<ConversationModelRequest, 'retry'>): Promise<ConversationDecision> => {
    let retry = false
    while (calls < 4) {
      calls++
      const result = await input.model(structuredClone({ ...request, retry })) // transport failures never retry
      mockSeen ||= result.mode === 'mock'
      try {
        if (!['binding', 'gateway', 'mock'].includes(result.mode)) throw new Error('Invalid mode')
        const decision = parseConversationDecision(result.text, request.snapshot, input.messages)
        if (request.phase === 'continue' && (decision.tools.length || decision.response.proposals.length))
          throw new Error('Invalid continuation')
        const command = decision.response.proposals.find(
          (proposal) => proposal.command.type === 'details.patch',
        )?.command
        const details = { ...request.snapshot.moveDetails, ...(command?.type === 'details.patch' ? command.patch : {}) }
        if (
          decision.tools.length &&
          (!useful(details.from) ||
            !useful(details.to) ||
            (details.from?.length ?? 0) > 300 ||
            (details.to?.length ?? 0) > 300)
        )
          throw new Error('Invalid route context')
        return decision
      } catch {
        if (retried) throw new Error('Invalid conversation output')
        retried = true
        retry = true
      }
    }
    throw new Error('Invalid conversation output')
  }
  const initial = await ask({ phase: 'interpret', snapshot: input.snapshot, toolResults: [] })
  let final = initial
  const proposals = initial.response.proposals
  let toolResult: ConversationToolResult | undefined
  if (initial.tools.length) {
    let detail = proposals.find((proposal) => proposal.command.type === 'details.patch')
    const command = detail?.command.type === 'details.patch' ? detail.command : undefined
    const details = { ...input.snapshot.moveDetails, ...command?.patch }
    // Context is validated above; the model never supplies these endpoints, URLs or tool results.
    if (!details.from || !details.to) throw new Error('Invalid conversation output')
    const route = await resolveConversationRoute(
      { from: details.from, to: details.to, revision: input.snapshot.revision },
      mockSeen ? undefined : input.key,
      input.fetcher,
    )
    toolResult = { type: 'resolve_route', route }
    if (!detail) {
      detail = {
        id: `proposal-${crypto.randomUUID()}`,
        expectedRevision: input.snapshot.revision,
        command: { type: 'details.patch', patch: { distanceMiles: details.distanceMiles } },
      }
      proposals.push(detail)
    }
    if (detail.command.type === 'details.patch') {
      detail.command.route = route
      if (route.status === 'ready' && route.precision === 'address') {
        detail.command.patch.distanceMiles = route.distanceMiles
        detail.command.facts = detail.command.facts?.filter((fact) => fact.field !== 'distanceMiles')
      }
      const prior = input.snapshot.route
      const acceptedRoute =
        route.status === 'ready' && route.precision === 'address'
          ? route
          : prior?.status === 'ready' &&
              prior.precision === 'address' &&
              prior.from === details.from &&
              prior.to === details.to
            ? prior
            : route
      const snapshot = { ...input.snapshot, moveDetails: { ...details, ...detail.command.patch }, route: acceptedRoute }
      if (acceptedRoute.status === 'ready' && acceptedRoute.precision === 'address')
        snapshot.moveDetails.distanceMiles = acceptedRoute.distanceMiles ?? null
      final = await ask({ phase: 'continue', snapshot, toolResults: [toolResult] })
    }
  }
  let reply = final.response.reply
  let nextAction = final.response.agent?.nextAction
  if (!nextAction) throw new Error('Invalid conversation output')
  const priorQuestion = input.messages.filter((message) => message.role === 'assistant').at(-1)?.content
  if (reply === priorQuestion) {
    // First useful clarifications remain model-selected. Repeated optional date/street
    // questions must not trap intake or contradict the returned next-action guidance.
    if (final.clarification === 'date' || final.clarification === 'address_city') {
      const command = proposals.find((proposal) => proposal.command.type === 'details.patch')?.command
      const details = { ...input.snapshot.moveDetails, ...(command?.type === 'details.patch' ? command.patch : {}) }
      nextAction = !useful(details.from)
        ? 'clarify_origin'
        : !useful(details.to)
          ? 'clarify_destination'
          : !input.snapshot.photos.length
            ? 'request_photos'
            : 'review'
    }
    if (nextAction !== 'review') {
      reply =
        nextAction === 'request_photos'
          ? 'Please attach photos of the rooms and large items in this chat.'
          : nextAction === 'clarify_origin'
            ? 'Which city is the pickup in? A street address is useful if known.'
            : 'Which city is the delivery in? A street address is useful if known.'
    } else if (final.clarification)
      reply = 'Please use the move details and photo review controls to check what is already known.'
  }
  return zConversationResponse.parse({
    reply,
    basedOnRevision: input.snapshot.revision,
    proposals,
    agent: { nextAction, ...(toolResult ? { route: toolResult.route } : {}) },
  })
}
