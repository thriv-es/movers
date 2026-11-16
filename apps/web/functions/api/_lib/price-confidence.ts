import type { Confidence, PriceRequest, ReviewCoverage } from '../../../src/data'

const levels: Confidence[] = ['high', 'medium', 'low']
const missingFields = {
  distanceMiles: 'Move distance is unknown.',
  originFloor: 'Origin floor is unknown.',
  destinationFloor: 'Destination floor is unknown.',
  originElevator: 'Origin elevator availability is unknown.',
  destinationElevator: 'Destination elevator availability is unknown.',
} as const

/** The server owns the confidence ceiling; a lower model suggestion may only reduce it. */
export function priceConfidence(
  request: Omit<PriceRequest, 'review'> & { review: ReviewCoverage },
  suggested: unknown,
): { level: Confidence; reasons: string[] } {
  const reasons: string[] = []
  const { analysis, moveDetails, review } = request
  const missing = (Object.keys(missingFields) as Array<keyof typeof missingFields>).filter(
    (field) => moveDetails[field] === null,
  )
  reasons.push(...missing.map((field) => missingFields[field]))

  if (review.wholeMoveCovered !== true) {
    reasons.push(
      review.wholeMoveCovered === null
        ? 'Whole move coverage has not been confirmed.'
        : 'The whole move is not covered by this inventory.',
    )
  }
  for (const key of ['garage', 'closets', 'appliances'] as const) {
    if (review.followUps[key] === null)
      reasons.push(`${key[0]!.toUpperCase()}${key.slice(1)} follow-up has not been answered.`)
  }
  if (analysis.unseenAreas.length > 0) reasons.push('Some areas were not shown in the photos; confirm their inventory.')

  const { excludedCount = 0, unresolvedCount = 0 } = review.photoEvidence ?? {}
  // A legacy evidence payload must not hide exclusions already present in the analysis.
  const assessedExcluded =
    analysis.photoAssessments?.filter((photo) => ['unrelated', 'unlinked', 'unavailable'].includes(photo.status))
      .length ??
    analysis.photoLinkStatuses?.filter((photo) => photo.status !== 'eligible').length ??
    0
  const excluded = Math.max(excludedCount, assessedExcluded)
  if (excluded > 0)
    reasons.push('Some photos were excluded from the inventory; their contents are not covered by photo evidence.')
  if (unresolvedCount > 0) reasons.push('Some photo relevance decisions remain unresolved.')
  const unanswered = Object.values(review.followUps).some((answer) => answer === null)
  const byRules: Confidence =
    unresolvedCount > 0 || review.wholeMoveCovered !== true || unanswered || missing.length >= 3
      ? 'low'
      : excluded > 0 || missing.length > 0 || analysis.unseenAreas.length > 0
        ? 'medium'
        : 'high'
  const model = suggested === 'high' || suggested === 'medium' || suggested === 'low' ? suggested : byRules
  if (levels.indexOf(model) > levels.indexOf(byRules)) reasons.push('The price evaluation suggested lower confidence.')
  return { level: levels[Math.max(levels.indexOf(byRules), levels.indexOf(model))] ?? 'low', reasons }
}
