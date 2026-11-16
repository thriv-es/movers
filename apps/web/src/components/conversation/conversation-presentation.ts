import type { ConversationCommand, ConversationReadiness, ConversationRoute } from '../../data/z-common/z-conversation'
import type { ConversationSession } from '../../lib/conversation-state'

export type ConversationStage = 'details' | 'photos' | 'review' | 'price' | 'requests'

/** Presentation only: never grants operation authority or changes domain readiness. */
export function conversationStage(
  session: ConversationSession,
  readiness: ConversationReadiness,
): ConversationStage | null {
  if (session.needsPhotoReupload || readiness.unresolvedPhotos) return 'photos'
  if (session.analysis) {
    if (readiness.unresolvedDuplicates || readiness.unansweredFollowUps.length || !readiness.coverageAnswered)
      return 'review'
    if (!session.detailsConfirmed) return 'details'
    return session.estimateId && session.price ? 'requests' : 'price'
  }
  if (session.photos.length) return 'photos'
  if (
    readiness.canRequestPhotos &&
    session.nextAction !== 'clarify_origin' &&
    session.nextAction !== 'clarify_destination'
  )
    return 'photos'
  return null
}

const labels: Record<string, string> = {
  from: 'Moving from',
  to: 'Moving to',
  date: 'Move date',
  distanceMiles: 'Distance (miles)',
  originFloor: 'Floor at origin',
  destinationFloor: 'Floor at destination',
  originElevator: 'Elevator at origin',
  destinationElevator: 'Elevator at destination',
}

/** Avoid rendering URLs, credentials, or arbitrary protocol fields as new presentation. */
export function displayFact(value: string | number | boolean | null): string {
  if (value === null) return 'Not set'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string' && /https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}|bearer\s|receipt[=:]/i.test(value))
    return 'Value available in the shared manifest'
  return String(value)
}

export function routeSummary(route: ConversationRoute): string {
  const result =
    route.status === 'unconfigured'
      ? 'Driving route is not configured.'
      : route.status === 'unavailable'
        ? 'Driving route is currently unavailable.'
        : route.status === 'ambiguous'
          ? 'Route endpoints are ambiguous; clarify the locations.'
          : route.precision === 'city'
            ? `Approximate city-to-city route: ${route.distanceMiles?.toFixed(1)} miles. Not an address-level pricing distance.`
            : `Address-level driving route: ${route.distanceMiles?.toFixed(1)} miles.`
  return `${result} ${route.attribution}`
}

export function proposalSummary(command: ConversationCommand): string[] {
  switch (command.type) {
    case 'details.patch':
      return [
        ...Object.entries(command.patch).map(
          ([key, value]) => `${labels[key] ?? 'Move detail'}: ${displayFact(value)}`,
        ),
        ...(command.facts
          ?.filter((fact) => fact.field === 'dateWindow')
          .map((fact) => `Possible date window: ${displayFact(fact.wording)} (not an exact date)`) ?? []),
        ...(command.route ? [routeSummary(command.route)] : []),
      ]
    case 'item.add':
      return [`Add ${command.item.count} × ${displayFact(command.item.type)}.`]
    case 'item.count':
      return [`Set ${displayFact(command.itemType)} count to ${command.count}.`]
    case 'item.remove':
      return [`Remove ${displayFact(command.itemType)} from inventory.`]
    case 'photo.decide':
      return [`${command.decision === 'keep' ? 'Keep' : 'Exclude'} the selected photo.`]
    case 'duplicate.resolve':
      return [
        `Treat ${displayFact(command.itemType)} sightings as ${command.resolution === 'same' ? 'the same item' : 'different items'}.`,
      ]
    case 'followUp.answer':
      return [`Extra items in ${command.key}: ${command.answer ? 'Yes' : 'No'}.`]
    case 'coverage.answer':
      return [`Whole move covered: ${command.answer ? 'Yes' : 'No'}.`]
    case 'request.action':
      return [
        `Show the explicit ${command.action === 'analyze' ? 'photo analysis' : command.action === 'price' ? 'estimate' : command.action === 'schedule' ? 'date request' : 'quote request'} controls. This does not submit anything.`,
      ]
  }
}
