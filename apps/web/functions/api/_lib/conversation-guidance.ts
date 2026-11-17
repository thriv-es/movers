import type {
  ConversationAgentMetadata,
  ConversationCommand,
  ConversationSnapshot,
} from '../../../src/data/z-common/z-conversation'
import { canonicalItemType } from '../../../src/lib/item-aliases'

/** Closed goals choose questions; only actual structured facts may be rendered. Never show free model claims. */
export function goalConversationQuestion(
  action: ConversationAgentMetadata['nextAction'],
  snapshot: ConversationSnapshot,
  commands: ConversationCommand[] = [],
): string | undefined {
  const state = structuredClone(snapshot)
  for (const command of commands) {
    if (command.type === 'details.patch') state.moveDetails = { ...state.moveDetails, ...command.patch }
    if (command.type === 'followUp.answer') state.review.followUps[command.key] = command.answer
    if (command.type === 'coverage.answer') state.review.wholeMoveCovered = command.answer
    if (command.type === 'item.add') {
      const prior = state.inventory.find(
        (item) => canonicalItemType(item.type) === canonicalItemType(command.item.type),
      )
      if (prior) prior.count += command.item.count
      else state.inventory.push(command.item)
    }
    if (command.type === 'item.count')
      state.inventory = state.inventory.map((item) =>
        canonicalItemType(item.type) === canonicalItemType(command.itemType) ? { ...item, count: command.count } : item,
      )
    if (command.type === 'item.remove')
      state.inventory = state.inventory.filter(
        (item) => canonicalItemType(item.type) !== canonicalItemType(command.itemType),
      )
  }
  if (action === 'access') {
    for (const [side, label] of [
      ['origin', 'pickup'],
      ['destination', 'delivery'],
    ] as const) {
      const floor = state.moveDetails[`${side}Floor`]
      if (floor === null) return `What is the ${label} floor? Ground floor is 0.`
      if (floor > 0 && state.moveDetails[`${side}Elevator`] === null)
        return `Is there a usable elevator at the ${label} on floor ${floor}?`
    }
    return 'Access details are recorded. Is there anything else about building access we should know?'
  }
  if (action === 'followups') {
    const key = (['garage', 'closets', 'appliances'] as const).find((key) => state.review.followUps[key] === null)
    return key
      ? `Are there additional ${key} items missing from this inventory?`
      : 'Those inventory areas are recorded. Does this inventory cover the whole move?'
  }
  if (action === 'coverage')
    return state.review.wholeMoveCovered === true
      ? 'Whole-move coverage is recorded. Is there anything to correct in the inventory?'
      : 'Does this inventory cover the whole move? Please include any remaining rooms or storage.'
  if (action === 'inventory') {
    const uncertain = state.photos.find((photo) => photo.status === 'uncertain' && photo.decision === null)
    if (uncertain) return `Should photo ${uncertain.id} be kept or excluded from the inventory?`
    const named = state.inventory
      .filter((item) => /^[\p{L}\p{N} ()'-]{1,80}$/u.test(item.type))
      .slice(0, 3)
      .map((item) => `${item.count} ${item.type}`)
      .join(', ')
    return named
      ? `The current inventory lists ${named}. Are any named items or counts missing or incorrect?`
      : 'Which named items and counts should be included? Photos help estimate volume and packing boxes.'
  }
  if (action === 'summary') {
    if (state.moveDetails.distanceMiles === null)
      return state.route?.status === 'unconfigured'
        ? 'Routing is not configured, so a price is not available yet. You can review known facts and missing essentials in the summary.'
        : 'A driving route is not available yet. You can review known facts and missing essentials in the summary.'
    return 'You can review the move summary and any missing essentials. Is there anything you would like to correct?'
  }
  return undefined
}

/** Narrow vocabulary permits phrasing variety, not arbitrary model-authored assertions. */
const photoWords = new Set(
  'could can would you please share attach upload add send some a few clear photos photo pictures picture of the your rooms room and large bulky items furniture belongings in this chat for inventory'.split(
    ' ',
  ),
)
export function safePhotoRequest(reply: string): boolean {
  if (
    reply.length > 160 ||
    !/^(could|can|would|please)\b/i.test(reply) ||
    !reply.endsWith('?') ||
    !/\b(photos?|pictures?)\b/i.test(reply)
  )
    return false
  return (
    /^[a-z ,?]+$/i.test(reply) &&
    reply
      .toLowerCase()
      .replace(/[?,]/g, '')
      .split(/\s+/)
      .every((word) => photoWords.has(word))
  )
}
