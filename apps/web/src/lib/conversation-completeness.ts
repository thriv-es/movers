import type { ConversationSession } from './conversation-state'
import { canonicalItemType } from './item-aliases'
import { photoEvidence, reviewedAnalysis } from './review-photos'

/** Business information, not model confidence or authorization to write. Date is optional. */
export function conversationCompleteness(state: ConversationSession): {
  percent: number
  missing: string[]
  ready: boolean
} {
  const missing: string[] = []
  let percent = 0
  for (const [field, label] of [
    ['from', 'Pickup'],
    ['to', 'Delivery'],
  ] as const) {
    const value = state.moveDetails[field]
    const fact = state.facts.find((entry) => entry.field === field)
    const known = !!value?.trim() && /\p{L}/u.test(value)
    // Legacy/panel values have no precision fact. A postcode in a city label is not a street.
    const street = value?.split(',')[0]?.trim() ?? ''
    const streetShaped =
      /^\d{1,6}[a-z]?\s+\p{L}/iu.test(street) ||
      (/\p{L}/u.test(street) && /\s\d{1,4}[a-z]?$/i.test(street) && value?.includes(','))
    const address = known && (fact ? fact.precision === 'address' : streetShaped)
    percent += address ? 20 : known ? 10 : 0
    if (!known) missing.push(`${label} city and street address`)
    else if (!address) missing.push(`${label} street address`)
    if (fact?.uncertainty === 'uncertain') missing.push(`${label} geographic identity needs clarification`)
  }
  for (const [side, label] of [
    ['origin', 'Pickup'],
    ['destination', 'Delivery'],
  ] as const) {
    const floor = state.moveDetails[`${side}Floor`]
    const elevator = state.moveDetails[`${side}Elevator`]
    if (floor === null) missing.push(`${label} floor`)
    else if (floor > 0 && elevator === null) {
      percent += 5
      missing.push(`${label} elevator availability`)
    } else percent += 10
  }
  const photosReady =
    state.photos.length > 0 &&
    !state.needsPhotoReupload &&
    state.photos.every((photo) => state.sample || !!photo.receipt)
  const analysis = state.analysis ? reviewedAnalysis(state.analysis, state.photoDecisions) : null
  const evidence = photoEvidence(state.analysis, state.photoDecisions)
  const relevantPhotos = analysis?.photoAssessments
    ? analysis.photoAssessments.some(
        (photo) =>
          photo.status === 'relevant' || (photo.status === 'uncertain' && state.photoDecisions[photo.url] === 'keep'),
      )
    : !!analysis?.items.length
  if (analysis && !relevantPhotos) missing.push('Relevant or explicitly kept photos of the inventory')
  if (!photosReady) missing.push('Linked photos of the move')
  if (!analysis || !state.items.length) missing.push('Photo-derived inventory analysis')
  if (photosReady && analysis && relevantPhotos && state.items.length) percent += 10
  if (evidence.unresolvedCount) missing.push('Keep or exclude each uncertain photo')
  const duplicates = (analysis?.possibleDuplicates ?? []).filter(
    (entry) =>
      state.items.some((item) => canonicalItemType(item.type) === canonicalItemType(entry.item)) &&
      !state.duplicateResolutions[canonicalItemType(entry.item)],
  )
  if (duplicates.length) missing.push('Resolve possible duplicate inventory items')
  if (analysis && !evidence.unresolvedCount && !duplicates.length) percent += 5
  for (const key of ['garage', 'closets', 'appliances'] as const) {
    if (state.followUps[key] === null) missing.push(`Answer whether additional ${key} items are included`)
    else percent += 2
  }
  if (state.wholeMoveCovered !== true) missing.push('Confirm inventory covers the whole move')
  else percent += 4
  const boxes = analysis?.estimatedBoxes
  if (boxes && Number.isInteger(boxes.min) && Number.isInteger(boxes.max) && boxes.min >= 0 && boxes.max >= boxes.min)
    percent += 10
  else missing.push('Valid photo-derived packing box range')
  if (state.moveDetails.date) percent += 5
  // A supplied distance or accepted address route is factual evidence; never invent a fallback.
  if (state.moveDetails.distanceMiles === null) {
    missing.push(
      state.route?.status === 'unconfigured'
        ? 'Driving route unavailable: routing is not configured'
        : state.route?.status === 'unavailable'
          ? 'Driving route unavailable: route lookup failed'
          : state.route?.status === 'ambiguous'
            ? 'Driving route needs unambiguous endpoints'
            : 'Driving route distance is not available',
    )
  }
  return { percent, missing, ready: missing.length === 0 }
}
