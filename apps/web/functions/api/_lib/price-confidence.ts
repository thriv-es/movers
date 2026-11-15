import type { Confidence, PriceRequest } from '../../../src/data'

const levels: Confidence[] = ['high', 'medium', 'low']
const missingFields = {
  distanceMiles: 'Move distance is unknown.',
  originFloor: 'Origin floor is unknown.',
  destinationFloor: 'Destination floor is unknown.',
  originElevator: 'Origin elevator availability is unknown.',
  destinationElevator: 'Destination elevator availability is unknown.',
} as const

/** The server owns the confidence ceiling; a lower model suggestion may only reduce it. */
export function priceConfidence(request: PriceRequest, suggested: unknown): { level: Confidence; reasons: string[] } {
  const reasons: string[] = []
  const { analysis, moveDetails, review } = request
  const missing = (Object.keys(missingFields) as Array<keyof typeof missingFields>)
    .filter((field) => moveDetails[field] === null)
  reasons.push(...missing.map((field) => missingFields[field]))

  if (review.wholeMoveCovered !== true) {
    reasons.push(
      review.wholeMoveCovered === null
        ? 'Whole move coverage has not been confirmed.'
        : 'The whole move is not covered by this inventory.',
    )
  }
  for (const key of ['garage', 'closets', 'appliances'] as const) {
    if (review.followUps[key] === null) reasons.push(`${key[0]!.toUpperCase()}${key.slice(1)} follow-up has not been answered.`)
  }
  if (analysis.unseenAreas.length > 0) reasons.push('Some areas were not shown in the photos; confirm their inventory.')

  const unanswered = Object.values(review.followUps).some((answer) => answer === null)
  const byRules: Confidence = review.wholeMoveCovered !== true || unanswered || missing.length >= 3
    ? 'low'
    : missing.length > 0 || analysis.unseenAreas.length > 0
      ? 'medium'
      : 'high'
  const model = suggested === 'high' || suggested === 'medium' || suggested === 'low' ? suggested : byRules
  if (levels.indexOf(model) > levels.indexOf(byRules)) reasons.push('The price evaluation suggested lower confidence.')
  return { level: levels[Math.max(levels.indexOf(byRules), levels.indexOf(model))] ?? 'low', reasons }
}
