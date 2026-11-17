import { z } from 'zod'
import {
  type ConversationCommand,
  type ConversationReadiness,
  type ConversationSnapshot,
  zConversationCommand,
  zConversationFact,
  zConversationRoute,
  zConversationAgentMetadata,
  zConversationId,
  zConversationMoveDetails,
  zConversationProposal,
  zConversationRevision,
} from '../data/z-common/z-conversation'
import {
  zAnalysisResult,
  zChatMessage,
  zContact,
  zDetectedItem,
  zPhotoAssessment,
  zPrice,
  zQuoteRequestRecord,
  zReviewCoverage,
} from '../data/z-common/z-move-demo'
import { conversationCompleteness } from './conversation-completeness'
import { aggregateConversationInventory } from './conversation-inventory'
import { ESTIMATE_STEPS, isBundledSampleUrl, newSession } from './estimate-session'
import { canonicalItemType } from './item-aliases'
import { clearedAnalysis, photoEvidence, reviewedAnalysis } from './review-photos'

const zValidatedAnalysis = zAnalysisResult.extend({ totalVolumeCubicFeet: z.number().finite().nonnegative() })
const zValidatedPrice = zPrice.refine(
  (price) => [price.total, price.low, price.high, ...Object.values(price.breakdown)].every(Number.isFinite),
  { message: 'Price amounts must be finite' },
)
const zSource = z.enum(['chat', 'panel', 'inline', 'system', 'agent'])
const envelope = { id: zConversationId, source: zSource, expectedRevision: zConversationRevision }
const zPhotoRef = z
  .object({ url: z.string().min(1).max(2048), receipt: z.string().min(1).max(128).nullable() })
  .strict()
export const zConversationPhoto = zPhotoRef.extend({ id: zConversationId }).strict()
export type ConversationPhoto = z.infer<typeof zConversationPhoto>
export const zOperationRequest = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('analyze') }).strict(),
  z.object({ kind: z.literal('price'), visionFingerprint: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('save') }).strict(),
  z.object({ kind: z.literal('schedule'), contact: zContact }).strict(),
  z
    .object({
      kind: z.literal('quotes'),
      moverIds: z
        .array(zConversationId)
        .min(1)
        .max(3)
        .refine((ids) => new Set(ids).size === ids.length),
      note: z.string().trim().max(1000),
    })
    .strict(),
])
export type ConversationOperationRequest = z.infer<typeof zOperationRequest>
export const zOperationResult = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('analyze'), analysis: zValidatedAnalysis }).strict(),
  z.object({ kind: z.literal('price'), price: zValidatedPrice }).strict(),
  z.object({ kind: z.literal('save'), estimateId: zConversationId }).strict(),
  z
    .object({ kind: z.literal('schedule'), reference: zConversationId, requestedDate: zContact.shape.requestedDate })
    .strict(),
  z.object({ kind: z.literal('quotes'), requests: z.array(zQuoteRequestRecord).min(1).max(3) }).strict(),
])
export type ConversationOperationResult = z.infer<typeof zOperationResult>
export const zConversationOperation = z
  .object({
    id: zConversationId,
    revision: zConversationRevision,
    request: zOperationRequest,
    status: z.enum(['pending', 'succeeded', 'failed', 'superseded', 'interrupted']),
    /** Closed codes only: never persist raw exception/model/contact text as status. */
    errorCode: z.enum(['request_failed', 'reanalyze_required', 'photo_link_failed']).optional(),
  })
  .strict()
export type ConversationOperation = z.infer<typeof zConversationOperation>
const zArea = z.enum(['details', 'photos', 'inventory', 'price', 'schedule', 'quotes'])
export const zConversationTimelineEntry = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('message'),
      id: z.string().min(1),
      revision: zConversationRevision,
      message: zChatMessage,
    })
    .strict(),
  z
    .object({
      kind: z.literal('event'),
      id: zConversationId,
      revision: zConversationRevision,
      area: zArea,
      event: z.enum([
        'migration',
        'details.updated',
        'details.confirmed',
        'photos.updated',
        'review.updated',
        'proposal.added',
        'proposal.dismissed',
        'action.requested',
        'operation.started',
        'operation.succeeded',
        'operation.failed',
        'vision.verified',
      ]),
      operationId: zConversationId.optional(),
    })
    .strict(),
])
export type ConversationTimelineEntry = z.infer<typeof zConversationTimelineEntry>

/** Reused domain schemas validate legacy values too; no arbitrary shallow state merge. */
export const zConversationDomain = z.object({
  sessionId: z.string().uuid(),
  step: z.enum(ESTIMATE_STEPS as ['chat', 'details', 'upload', 'review', 'estimate', 'schedule']),
  messages: z.array(zChatMessage),
  moveDetails: zConversationMoveDetails,
  chatFinished: z.boolean(),
  photoUrls: z.array(z.string()),
  photoRefs: z.array(zPhotoRef),
  needsPhotoReupload: z.boolean(),
  analysis: zValidatedAnalysis.nullable(),
  failedPhotoAssessments: z.array(zPhotoAssessment),
  photoDecisions: z.record(z.string(), z.enum(['keep', 'exclude'])),
  photoDecisionsLocked: z.boolean(),
  // Persisted inventory follows the existing domain contract, not new-command input limits.
  items: z.array(zDetectedItem),
  followUps: zReviewCoverage.shape.followUps,
  wholeMoveCovered: z.boolean().nullable(),
  price: zValidatedPrice.nullable(),
  estimateId: zConversationId.nullable(),
  contact: zContact.nullable(),
  sample: z.boolean(),
})
export const zConversationSession = zConversationDomain
  .extend({
    version: z.literal(6),
    revision: zConversationRevision,
    photos: z.array(zConversationPhoto).max(10),
    detailsConfirmed: z.boolean(),
    /** Deduplicates automatic read-only summary attempts, including across reload after failure. */
    summaryAttemptRevision: zConversationRevision.nullable().default(null),
    facts: z.array(zConversationFact).max(12).default([]),
    /** Customer-stated absolute inventory counts; independent of any photo analysis. */
    inventoryOverrides: z
      .array(z.object({ type: zDetectedItem.shape.type, count: z.number().int().nonnegative().max(10000) }).strict())
      .max(200)
      .default([]),
    nextAction: zConversationAgentMetadata.shape.nextAction.nullable().default(null),
    route: zConversationRoute.nullable().default(null),
    timeline: z.array(zConversationTimelineEntry),
    pendingProposals: z.array(zConversationProposal),
    operations: z.record(zConversationId, zConversationOperation),
    duplicateResolutions: z.record(z.string(), z.enum(['same', 'different'])),
    appliedActionIds: z.array(zConversationId),
    latestUpdate: z
      .object({ eventId: zConversationId, revision: zConversationRevision, area: zArea })
      .strict()
      .nullable(),
    suggestedFocus: z.enum(['chat', 'details', 'upload', 'review', 'estimate', 'schedule']),
    /** Ephemeral: a refresh must verify current server settings again. */
    verifiedVisionFingerprint: z.string().min(1).nullable(),
    requestedAction: z.enum(['analyze', 'price', 'schedule', 'quotes']).nullable(),
    scheduleResult: z
      .object({
        reference: zConversationId,
        requestedDate: zContact.shape.requestedDate,
        status: z.literal('requested'),
      })
      .strict()
      .nullable(),
    quoteResult: z
      .object({ requests: z.array(zQuoteRequestRecord) })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((state, context) => {
    const invalid = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message })
    if (
      state.route &&
      (state.route.from !== state.moveDetails.from ||
        state.route.to !== state.moveDetails.to ||
        state.route.endpointRevision > state.revision)
    )
      invalid('Stale route endpoints')
    if (
      new Set(state.photos.map((photo) => photo.id)).size !== state.photos.length ||
      new Set(state.photos.map((photo) => photo.url)).size !== state.photos.length
    )
      invalid('Duplicate photo references')
    if (
      state.sample &&
      state.photos.some(
        (photo) =>
          !isBundledSampleUrl(photo.url, typeof window === 'undefined' ? 'http://localhost' : window.location.origin),
      )
    )
      invalid('Sample photos must match the exact bundled allowlist')
    if (JSON.stringify(state.photoUrls) !== JSON.stringify(state.photos.map((photo) => photo.url)))
      invalid('Photo IDs and domain URLs must agree')
    if (
      state.photoRefs.some(
        (ref) => !state.photos.some((photo) => photo.url === ref.url && photo.receipt === ref.receipt),
      )
    )
      invalid('Unknown photo ref')
    if (new Set(state.appliedActionIds).size !== state.appliedActionIds.length) invalid('Duplicate applied action IDs')
    if (new Set(state.pendingProposals.map((proposal) => proposal.id)).size !== state.pendingProposals.length)
      invalid('Duplicate proposals')
    if (
      state.timeline.some((entry) => entry.revision > state.revision) ||
      (state.latestUpdate && state.latestUpdate.revision > state.revision)
    )
      invalid('Future timeline revision')
    if (
      Object.entries(state.operations).some(
        ([id, operation]) => id !== operation.id || operation.revision > state.revision,
      )
    )
      invalid('Invalid operation reference')
  })
export type ConversationSession = z.infer<typeof zConversationSession>

const commandActions = zConversationCommand.options.map((command) => command.extend(envelope).strict())
// The mapped union retains each command's discriminant and payload type.
export const zConversationAction = z.union([
  z.object({ ...envelope, type: z.literal('details.confirm') }).strict(),
  z.object({ ...envelope, type: z.literal('summary.attempt') }).strict(),
  z.object({ ...envelope, type: z.literal('photo.add'), photo: zConversationPhoto }).strict(),
  z
    .object({
      ...envelope,
      type: z.literal('photos.replace'),
      photos: z.array(zConversationPhoto).max(10),
      sample: z.boolean(),
    })
    .strict(),
  ...commandActions,
  z.object({ ...envelope, type: z.literal('photo.remove'), photoId: zConversationId }).strict(),
  z.object({ ...envelope, type: z.literal('message.append'), message: zChatMessage }).strict(),
  z
    .object({ ...envelope, type: z.literal('agent.guidance'), nextAction: zConversationAgentMetadata.shape.nextAction })
    .strict(),
  z.object({ ...envelope, type: z.literal('proposal.add'), proposal: zConversationProposal }).strict(),
  z
    .object({
      ...envelope,
      type: z.literal('proposal.addBatch'),
      proposals: z.array(zConversationProposal).min(1).max(12),
    })
    .strict(),
  z.object({ ...envelope, type: z.literal('proposal.apply'), proposalId: zConversationId }).strict(),
  z
    .object({
      ...envelope,
      type: z.literal('proposal.applyBatch'),
      proposalIds: z.array(zConversationId).min(1).max(12),
    })
    .strict(),
  z.object({ ...envelope, type: z.literal('proposal.dismiss'), proposalId: zConversationId }).strict(),
  z.object({ ...envelope, type: z.literal('vision.verified'), fingerprint: z.string().min(1) }).strict(),
  z
    .object({
      ...envelope,
      type: z.literal('operation.started'),
      operationId: zConversationId,
      request: zOperationRequest,
    })
    .strict(),
  z
    .object({
      ...envelope,
      type: z.literal('operation.succeeded'),
      operationId: zConversationId,
      result: zOperationResult,
    })
    .strict(),
  z
    .object({
      ...envelope,
      type: z.literal('operation.failed'),
      operationId: zConversationId,
      errorCode: z.enum(['request_failed', 'reanalyze_required', 'photo_link_failed']),
      photoAssessments: z.array(zPhotoAssessment).optional(),
    })
    .strict(),
])
export type ConversationAction = z.infer<typeof zConversationAction>

type DomainPatch = Partial<ConversationSession>
type Event = Extract<ConversationTimelineEntry, { kind: 'event' }>['event']
type Area = z.infer<typeof zArea>
const followUpKeys = ['garage', 'closets', 'appliances'] as const
const sameType = (a: string, b: string) => canonicalItemType(a) === canonicalItemType(b)
const hasDetails = (state: ConversationSession) =>
  zConversationMoveDetails.safeParse(state.moveDetails).success &&
  [state.moveDetails.from, state.moveDetails.to].every((value) => !!value?.trim() && /\p{L}/u.test(value)) &&
  state.moveDetails.distanceMiles !== null
const linked = (state: Pick<ConversationSession, 'sample'>, photo: ConversationPhoto) =>
  state.sample
    ? isBundledSampleUrl(photo.url, typeof window === 'undefined' ? 'http://localhost' : window.location.origin)
    : !!photo.receipt
const pending = (state: ConversationSession, kind?: ConversationOperationRequest['kind']) =>
  Object.values(state.operations).some(
    (operation) => operation.status === 'pending' && (!kind || operation.request.kind === kind),
  )

export function createConversationSession(): ConversationSession {
  return zConversationSession.parse({
    ...newSession(),
    version: 6,
    revision: 0,
    photos: [],
    detailsConfirmed: false,
    timeline: [],
    pendingProposals: [],
    operations: {},
    duplicateResolutions: {},
    appliedActionIds: [],
    latestUpdate: null,
    suggestedFocus: 'details',
    verifiedVisionFingerprint: null,
    requestedAction: null,
    scheduleResult: null,
    quoteResult: null,
  })
}
function canonicalItems(items: ConversationSession['items']): ConversationSession['items'] {
  const grouped = new Map<string, number>()
  for (const item of items) {
    const type = canonicalItemType(item.type)
    grouped.set(type, (grouped.get(type) ?? 0) + item.count)
  }
  return [...grouped].map(([type, count]) => ({ type, count }))
}
/** The exact reviewed volume/box rules; inventory corrections do not invent volume constants. */
export function conversationAnalysis(state: ConversationSession): ConversationSession['analysis'] {
  if (!state.analysis) return null
  return { ...reviewedAnalysis(state.analysis, state.photoDecisions), items: state.items }
}
function unresolvedDuplicates(state: ConversationSession) {
  return (conversationAnalysis(state)?.possibleDuplicates ?? []).filter(
    (duplicate) =>
      state.items.some((item) => sameType(item.type, duplicate.item)) &&
      !state.duplicateResolutions[canonicalItemType(duplicate.item)],
  )
}
export function conversationReadiness(state: ConversationSession): ConversationReadiness {
  const detailsComplete = hasDetails(state)
  const canRequestPhotos = [state.moveDetails.from, state.moveDetails.to].every(
    (value) => !!value?.trim() && /\p{L}/u.test(value),
  )
  const photosReady =
    state.photos.length > 0 && !state.needsPhotoReupload && state.photos.every((photo) => linked(state, photo))
  const unresolvedPhotos = photoEvidence(state.analysis, state.photoDecisions).unresolvedCount
  const duplicates = unresolvedDuplicates(state).length
  const unansweredFollowUps = followUpKeys.filter((key) => state.followUps[key] === null)
  const visionCurrent =
    !!state.analysis?.visionFingerprint && state.verifiedVisionFingerprint === state.analysis.visionFingerprint
  const evidenceReady =
    conversationCompleteness(state).ready &&
    detailsComplete &&
    photosReady &&
    !!state.analysis &&
    !unresolvedPhotos &&
    !duplicates &&
    state.items.length > 0 &&
    unansweredFollowUps.length === 0 &&
    state.wholeMoveCovered !== null &&
    visionCurrent
  return {
    detailsComplete,
    canRequestPhotos,
    canAnalyze: photosReady && !pending(state),
    canPrice: evidenceReady && !pending(state),
    canSave: evidenceReady && state.detailsConfirmed && !!state.price && !state.estimateId && !pending(state),
    canSchedule: !!state.price && !!state.estimateId && !pending(state),
    canQuote: !!state.price && !!state.estimateId && !!state.contact && !pending(state),
    unresolvedPhotos,
    unresolvedDuplicates: duplicates,
    unansweredFollowUps,
    coverageAnswered: state.wholeMoveCovered !== null,
    visionCurrent,
  }
}
const clearPrice = (): DomainPatch => ({
  price: null,
  estimateId: null,
  contact: null,
  scheduleResult: null,
  quoteResult: null,
})
const clearEvidence = (): DomainPatch => ({
  ...zConversationDomain.partial().parse(clearedAnalysis()),
  duplicateResolutions: {},
  verifiedVisionFingerprint: null,
  scheduleResult: null,
  quoteResult: null,
})
function clearPhotoEvidence(state: ConversationSession): DomainPatch {
  return {
    ...clearEvidence(),
    detailsConfirmed: false,
    items: aggregateConversationInventory([], state.inventoryOverrides),
    followUps: state.followUps,
    wholeMoveCovered: state.wholeMoveCovered,
  }
}
function photoPatch(state: ConversationSession, photos: ConversationPhoto[]): DomainPatch {
  return {
    photos,
    photoUrls: photos.map((photo) => photo.url),
    photoRefs: photos.filter((photo) => linked(state, photo)).map(({ url, receipt }) => ({ url, receipt })),
    needsPhotoReupload: photos.some((photo) => !linked(state, photo)),
    ...clearPhotoEvidence(state),
  }
}
function commandPatch(state: ConversationSession, command: ConversationCommand): DomainPatch | null {
  switch (command.type) {
    case 'details.patch': {
      let facts = command.facts ?? []
      if (
        facts.filter((fact) => fact.field === 'date' || fact.field === 'dateWindow').length > 1 ||
        facts.some((fact) => fact.field === 'dateWindow' && command.patch.date !== null)
      )
        return null
      if (
        facts.some(
          (fact) =>
            !state.messages.some(
              (message) =>
                message.role === 'user' &&
                message.id === fact.sourceMessageId &&
                message.content.includes(fact.wording),
            ),
        )
      )
        return null
      const moveDetails = { ...state.moveDetails, ...command.patch }
      const endpointChanged = moveDetails.from !== state.moveDetails.from || moveDetails.to !== state.moveDetails.to
      if (
        command.route &&
        (command.route.from !== moveDetails.from ||
          command.route.to !== moveDetails.to ||
          command.route.endpointRevision !== state.revision)
      )
        return null
      const addressRoute = (
        route: ConversationSession['route'] | undefined,
      ): route is NonNullable<ConversationSession['route']> =>
        route?.status === 'ready' && route.precision === 'address'
      const route = addressRoute(command.route)
        ? command.route
        : !endpointChanged && addressRoute(state.route)
          ? state.route
          : (command.route ?? (endpointChanged ? null : state.route))
      if (endpointChanged) moveDetails.distanceMiles = command.patch.distanceMiles ?? null
      if (addressRoute(route)) {
        moveDetails.distanceMiles = route?.distanceMiles ?? null
        facts = facts.filter((fact) => fact.field !== 'distanceMiles')
      }
      const changed = JSON.stringify(moveDetails) !== JSON.stringify(state.moveDetails)
      const replaced = new Set([
        ...Object.keys(command.patch),
        ...facts.map((fact) => fact.field),
        ...(endpointChanged || addressRoute(route) ? ['distanceMiles'] : []),
        ...('date' in command.patch ? ['date', 'dateWindow'] : []),
      ])
      const nextFacts = [...state.facts.filter((fact) => !replaced.has(fact.field)), ...facts]
      const factsChanged = JSON.stringify(nextFacts) !== JSON.stringify(state.facts)
      return {
        ...(changed || factsChanged ? { ...clearPrice(), detailsConfirmed: false } : {}),
        ...(changed ? { moveDetails } : {}),
        ...(factsChanged ? { facts: nextFacts } : {}),
        ...(route !== state.route ? { route } : {}),
      }
    }
    case 'request.action':
      return { requestedAction: command.action }
    case 'photo.decide': {
      const photo = state.photos.find((photo) => photo.id === command.photoId)
      if (
        !photo ||
        !state.analysis ||
        state.photoDecisionsLocked ||
        !state.analysis.photoAssessments?.some(
          (assessment) => assessment.url === photo.url && assessment.status === 'uncertain',
        )
      )
        return null
      if (state.photoDecisions[photo.url] === command.decision) return {}
      const photoDecisions = { ...state.photoDecisions, [photo.url]: command.decision }
      return {
        ...clearPrice(),
        photoDecisions,
        items: aggregateConversationInventory(
          photoEvidence(state.analysis, photoDecisions).unresolvedCount === 0
            ? reviewedAnalysis(state.analysis, photoDecisions).items
            : state.analysis.items,
          state.inventoryOverrides,
        ),
        duplicateResolutions: {},
      }
    }
    default: {
      if (
        state.analysis &&
        photoEvidence(state.analysis, state.photoDecisions).unresolvedCount > 0 &&
        ['item.add', 'item.count', 'item.remove', 'duplicate.resolve'].includes(command.type)
      )
        return null
      const items = canonicalItems(state.items)
      const base = { ...clearPrice(), detailsConfirmed: false, photoDecisionsLocked: !!state.analysis }
      const override = (type: string, count: number) => {
        const inventoryOverrides = [
          ...state.inventoryOverrides.filter((item) => !sameType(item.type, type)),
          { type: canonicalItemType(type), count },
        ]
        return { inventoryOverrides, items: aggregateConversationInventory(items, inventoryOverrides) }
      }
      switch (command.type) {
        case 'item.add': {
          const combined = canonicalItems([...items, command.item])
          const added = combined.find((item) => sameType(item.type, command.item.type))
          if (!added || !zConversationCommand.safeParse({ type: 'item.add', item: added }).success) return null
          return { ...base, ...override(command.item.type, added.count) }
        }
        case 'item.count':
        case 'item.remove': {
          if (!items.some((item) => sameType(item.type, command.itemType))) return null
          return {
            ...base,
            ...override(command.itemType, command.type === 'item.remove' ? 0 : command.count),
          }
        }
        case 'duplicate.resolve': {
          const type = canonicalItemType(command.itemType)
          if (!items.some((item) => sameType(item.type, type))) return null
          if (state.duplicateResolutions[type])
            return state.duplicateResolutions[type] === command.resolution ? {} : null
          if (!unresolvedDuplicates(state).some((duplicate) => sameType(duplicate.item, type))) return null
          return {
            ...base,
            duplicateResolutions: { ...state.duplicateResolutions, [type]: command.resolution },
            ...(command.resolution === 'same' ? override(type, 1) : { items }),
          }
        }
        case 'followUp.answer': {
          if (state.followUps[command.key] === command.answer) return {}
          return {
            ...base,
            followUps: { ...state.followUps, [command.key]: command.answer },
          }
        }
        case 'coverage.answer':
          return state.wholeMoveCovered === command.answer ? {} : { ...base, wholeMoveCovered: command.answer }
      }
    }
  }
}
function areaFor(command: ConversationCommand): Area {
  return command.type === 'details.patch'
    ? 'details'
    : command.type === 'photo.decide'
      ? 'photos'
      : command.type === 'request.action'
        ? command.action === 'analyze'
          ? 'photos'
          : command.action
        : 'inventory'
}
function operationArea(kind: ConversationOperationRequest['kind']): Area {
  return kind === 'analyze' ? 'photos' : kind === 'save' ? 'price' : kind
}
function canStart(state: ConversationSession, request: ConversationOperationRequest) {
  const readiness = conversationReadiness(state)
  switch (request.kind) {
    case 'analyze':
      return readiness.canAnalyze
    case 'price':
      return readiness.canPrice && request.visionFingerprint === state.analysis?.visionFingerprint
    case 'save':
      return readiness.canSave
    case 'schedule':
      return readiness.canSchedule && !!request.contact.phone.trim()
    case 'quotes':
      return readiness.canQuote
  }
}
function resultPatch(
  state: ConversationSession,
  operation: ConversationOperation,
  result: ConversationOperationResult,
): DomainPatch | null {
  if (operation.request.kind !== result.kind) return null
  switch (result.kind) {
    case 'analyze': {
      const urls = new Set(state.photos.map((photo) => photo.url))
      if (
        result.analysis.photoAssessments?.some((photo) => !urls.has(photo.url)) ||
        result.analysis.photoLinkStatuses?.some((photo) => !urls.has(photo.url))
      )
        return null
      return {
        ...clearPhotoEvidence(state),
        analysis: result.analysis,
        items: aggregateConversationInventory(result.analysis.items, state.inventoryOverrides),
      }
    }
    case 'price':
      return { ...clearPrice(), price: result.price }
    case 'save':
      return { estimateId: result.estimateId }
    case 'schedule': {
      if (
        operation.request.kind !== 'schedule' ||
        result.reference !== state.estimateId ||
        result.requestedDate !== operation.request.contact.requestedDate
      )
        return null
      return {
        contact: operation.request.contact,
        scheduleResult: { reference: result.reference, requestedDate: result.requestedDate, status: 'requested' },
      }
    }
    case 'quotes': {
      if (operation.request.kind !== 'quotes') return null
      const ids = operation.request.moverIds
      if (
        result.requests.length !== ids.length ||
        new Set(result.requests.map((record) => record.moverId)).size !== ids.length ||
        result.requests.some((record) => record.estimateId !== state.estimateId || !ids.includes(record.moverId))
      )
        return null
      return { quoteResult: { requests: result.requests } }
    }
  }
}

/** Pure reducer: rejection returns the exact input object; callers can visibly report conflicts. */
export function reduceConversation(state: ConversationSession, input: ConversationAction): ConversationSession {
  const parsed = zConversationAction.safeParse(input)
  if (!parsed.success || !zConversationSession.safeParse(state).success) return state
  const action = parsed.data
  if (action.expectedRevision !== state.revision || state.appliedActionIds.includes(action.id)) return state
  if (
    action.source === 'agent' &&
    !['proposal.add', 'proposal.addBatch', 'message.append', 'agent.guidance'].includes(action.type)
  )
    return state
  if ((action.type.startsWith('operation.') || action.type === 'vision.verified') && action.source !== 'system')
    return state
  if (action.type === 'proposal.applyBatch') {
    if (
      !['panel', 'inline', 'chat'].includes(action.source) ||
      new Set(action.proposalIds).size !== action.proposalIds.length
    )
      return state
    const proposals = action.proposalIds.map((id) => state.pendingProposals.find((proposal) => proposal.id === id))
    if (proposals.some((proposal) => !proposal || proposal.expectedRevision !== state.revision)) return state
    let cursor = state
    for (const [index, proposal] of proposals.entries()) {
      if (!proposal) return state
      const command =
        proposal.command.type === 'details.patch' && proposal.command.route
          ? { ...proposal.command, route: { ...proposal.command.route, endpointRevision: cursor.revision } }
          : proposal.command
      const rebased = { ...proposal, command, expectedRevision: cursor.revision }
      const before = { ...cursor, pendingProposals: [rebased] }
      const next = reduceConversation(before, {
        type: 'proposal.apply',
        proposalId: proposal.id,
        id: `${action.id.slice(0, 110)}-${index}`,
        source: action.source,
        expectedRevision: cursor.revision,
      })
      if (next === before) return state // transaction: never publish a partial batch
      cursor = next
    }
    const remaining = state.pendingProposals
      .filter((proposal) => !action.proposalIds.includes(proposal.id))
      .map((proposal) => ({ ...proposal, expectedRevision: cursor.revision }))
    return { ...cursor, pendingProposals: remaining, appliedActionIds: [...cursor.appliedActionIds, action.id] }
  }
  let patch: DomainPatch = {}
  let event: Event = 'review.updated'
  let area: Area = 'inventory'
  let dataChanged = false
  let operationId: string | undefined
  let message: z.infer<typeof zChatMessage> | undefined
  const command = zConversationCommand.safeParse(
    Object.fromEntries(Object.entries(action).filter(([key]) => !['id', 'source', 'expectedRevision'].includes(key))),
  )
  if (command.success) {
    const change = commandPatch(state, command.data)
    if (!change) return state
    patch = change
    area = areaFor(command.data)
    event =
      command.data.type === 'details.patch'
        ? 'details.updated'
        : command.data.type === 'request.action'
          ? 'action.requested'
          : 'review.updated'
    dataChanged = command.data.type !== 'request.action' && Object.keys(change).length > 0
  } else {
    switch (action.type) {
      case 'summary.attempt': {
        if (action.source !== 'system') return state
        // Restored/legacy drafts may carry commercial results whose factual readiness changed.
        // Early summary must withhold those results in the domain, not only in the UI.
        const ineligible =
          !conversationCompleteness(state).ready &&
          !!(state.price || state.estimateId || state.contact || state.scheduleResult || state.quoteResult)
        dataChanged = ineligible
        patch = {
          ...(ineligible ? { ...clearPrice(), detailsConfirmed: false } : {}),
          summaryAttemptRevision: state.revision + (ineligible ? 1 : 0),
        }
        event = 'action.requested'
        area = 'price'
        break
      }
      case 'details.confirm':
        if (!hasDetails(state)) return state
        patch = { detailsConfirmed: true }
        dataChanged = !state.detailsConfirmed
        event = 'details.confirmed'
        area = 'details'
        break
      case 'photos.replace':
        patch = { ...photoPatch({ ...state, sample: action.sample }, action.photos), sample: action.sample }
        dataChanged = true
        event = 'photos.updated'
        area = 'photos'
        break
      case 'photo.add':
        if (
          state.photos.length >= 10 ||
          state.photos.some((photo) => photo.id === action.photo.id || photo.url === action.photo.url)
        )
          return state
        patch = photoPatch(state, [...state.photos, action.photo])
        dataChanged = true
        event = 'photos.updated'
        area = 'photos'
        break
      case 'photo.remove':
        if (!state.photos.some((photo) => photo.id === action.photoId)) return state
        patch = photoPatch(
          state,
          state.photos.filter((photo) => photo.id !== action.photoId),
        )
        dataChanged = true
        event = 'photos.updated'
        area = 'photos'
        break
      case 'agent.guidance':
        if (action.source !== 'agent') return state
        patch = { nextAction: action.nextAction }
        event = 'action.requested'
        area = 'details'
        break
      case 'message.append':
        if (state.messages.some((entry) => entry.id === action.message.id)) return state
        message = action.message
        patch = { messages: [...state.messages, message] }
        break
      case 'proposal.addBatch': {
        const proposals = action.proposals
        const first = proposals[0]
        if (!first) return state
        if (
          new Set(proposals.map((proposal) => proposal.id)).size !== proposals.length ||
          proposals.some(
            (proposal) =>
              proposal.expectedRevision !== state.revision ||
              state.pendingProposals.some((pending) => pending.id === proposal.id),
          )
        )
          return state
        // Validate the complete batch against sequentially projected facts. A photo decision may
        // unlock a later inventory edit. This projection grants no authority and is never published.
        let projected = state
        for (const [index, proposal] of proposals.entries()) {
          const command =
            proposal.command.type === 'details.patch' && proposal.command.route
              ? { ...proposal.command, route: { ...proposal.command.route, endpointRevision: projected.revision } }
              : proposal.command
          const next = reduceConversation(projected, {
            ...command,
            id: `${action.id.slice(0, 100)}-check-${index}`,
            source: 'chat',
            expectedRevision: projected.revision,
          })
          if (next === projected) return state
          projected = next
        }
        patch = { pendingProposals: [...state.pendingProposals, ...proposals] }
        event = 'proposal.added'
        area = areaFor(first.command)
        break
      }
      case 'proposal.add': {
        if (
          action.proposal.expectedRevision !== state.revision ||
          state.pendingProposals.some((proposal) => proposal.id === action.proposal.id) ||
          !commandPatch(state, action.proposal.command)
        )
          return state
        patch = { pendingProposals: [...state.pendingProposals, action.proposal] }
        event = 'proposal.added'
        area = areaFor(action.proposal.command)
        break
      }
      case 'proposal.apply': {
        if (action.source !== 'panel' && action.source !== 'inline' && action.source !== 'chat') return state
        const proposal = state.pendingProposals.find((proposal) => proposal.id === action.proposalId)
        if (!proposal || proposal.expectedRevision !== state.revision) return state
        const change = commandPatch(state, proposal.command)
        if (!change) return state
        patch = { ...change, pendingProposals: state.pendingProposals.filter((entry) => entry.id !== proposal.id) }
        dataChanged = proposal.command.type !== 'request.action' && Object.keys(change).length > 0
        area = areaFor(proposal.command)
        event = proposal.command.type === 'request.action' ? 'action.requested' : 'review.updated'
        break
      }
      case 'proposal.dismiss':
        if (!state.pendingProposals.some((proposal) => proposal.id === action.proposalId)) return state
        patch = { pendingProposals: state.pendingProposals.filter((proposal) => proposal.id !== action.proposalId) }
        event = 'proposal.dismissed'
        break
      case 'vision.verified':
        if (!state.analysis?.visionFingerprint || state.analysis.visionFingerprint !== action.fingerprint) return state
        patch = { verifiedVisionFingerprint: action.fingerprint }
        event = 'vision.verified'
        area = 'photos'
        break
      case 'operation.started':
        if (state.operations[action.operationId] || !canStart(state, action.request)) return state
        operationId = action.operationId
        // Explicit analysis supersedes prior evidence, even if the new request later fails.
        dataChanged = action.request.kind === 'analyze'
        patch = {
          ...(dataChanged
            ? { ...clearPhotoEvidence(state), failedPhotoAssessments: state.failedPhotoAssessments }
            : {}),
          operations: {
            ...state.operations,
            [operationId]: {
              id: operationId,
              revision: state.revision + (dataChanged ? 1 : 0),
              status: 'pending',
              request: action.request,
            },
          },
          requestedAction: null,
        }
        event = 'operation.started'
        area = operationArea(action.request.kind)
        break
      case 'operation.succeeded':
      case 'operation.failed': {
        operationId = action.operationId
        const operation = state.operations[operationId]
        if (!operation || operation.status !== 'pending' || operation.revision !== state.revision) return state
        area = operationArea(operation.request.kind)
        if (action.type === 'operation.succeeded') {
          const change = resultPatch(state, operation, action.result)
          if (!change) return state
          patch = {
            ...change,
            operations: { ...state.operations, [operationId]: { ...operation, status: 'succeeded' } },
          }
          dataChanged = true
          event = 'operation.succeeded'
        } else {
          const assessments = action.photoAssessments ?? []
          if (
            assessments.length &&
            (operation.request.kind !== 'analyze' ||
              assessments.some((photo) => !state.photos.some((ref) => ref.url === photo.url)))
          )
            return state
          patch = {
            operations: {
              ...state.operations,
              [operationId]: { ...operation, status: 'failed', errorCode: action.errorCode },
            },
            ...(operation.request.kind === 'analyze' ? { failedPhotoAssessments: assessments } : {}),
            ...(action.errorCode === 'reanalyze_required' ? clearPhotoEvidence(state) : {}),
          }
          dataChanged = action.errorCode === 'reanalyze_required'
          event = 'operation.failed'
        }
        break
      }
      default:
        return state
    }
  }
  const revision = state.revision + (dataChanged ? 1 : 0)
  const operations = patch.operations ?? state.operations
  if (dataChanged) {
    patch.operations = Object.fromEntries(
      Object.entries(operations).map(([id, operation]) => [
        id,
        operation.status === 'pending' && operation.revision !== revision
          ? { ...operation, status: 'superseded' as const }
          : operation,
      ]),
    )
    // Read-only pricing and acknowledged commercial results change no factual scope. Keep
    // unresolved suggestions pending, rebased only across this known scope-preserving result.
    patch.pendingProposals =
      action.type === 'operation.succeeded' && action.result.kind !== 'analyze'
        ? state.pendingProposals.map((proposal) => ({
            ...proposal,
            expectedRevision: revision,
            command:
              proposal.command.type === 'details.patch' && proposal.command.route
                ? { ...proposal.command, route: { ...proposal.command.route, endpointRevision: revision } }
                : proposal.command,
          }))
        : []
    patch.requestedAction = null
  }
  const entry: ConversationTimelineEntry = message
    ? { kind: 'message', id: action.id, revision, message }
    : { kind: 'event', id: action.id, revision, event, area, ...(operationId ? { operationId } : {}) }
  const next: ConversationSession = {
    ...state,
    ...patch,
    revision,
    appliedActionIds: [...state.appliedActionIds, action.id],
    timeline: [...state.timeline, entry],
    latestUpdate: message ? state.latestUpdate : { eventId: action.id, revision, area },
  }
  return zConversationSession.safeParse(next).success ? next : state
}

export function conversationSnapshot(state: ConversationSession): ConversationSnapshot {
  const analysis = conversationAnalysis(state)
  return {
    version: 6,
    revision: state.revision,
    moveDetails: { ...state.moveDetails },
    route: state.route ? { ...state.route } : null,
    detailsConfirmed: state.detailsConfirmed,
    sample: state.sample,
    photos: state.photos.map((photo) => ({
      id: photo.id,
      status: !linked(state, photo)
        ? 'reupload'
        : (state.failedPhotoAssessments.find((assessment) => assessment.url === photo.url)?.status ??
          state.analysis?.photoAssessments?.find((assessment) => assessment.url === photo.url)?.status ??
          'linked'),
      decision: state.photoDecisions[photo.url] ?? null,
    })),
    inventory: state.items.map((item) => ({ ...item })),
    analysis: analysis
      ? { totalVolumeCubicFeet: analysis.totalVolumeCubicFeet, estimatedBoxes: { ...analysis.estimatedBoxes } }
      : null,
    review: {
      followUps: { ...state.followUps },
      wholeMoveCovered: state.wholeMoveCovered,
      duplicateResolutions: { ...state.duplicateResolutions },
      pendingDuplicates: unresolvedDuplicates(state).map((duplicate) => ({
        item: duplicate.item,
        count: duplicate.count,
      })),
    },
    price: state.price
      ? { currency: state.price.currency, total: state.price.total, low: state.price.low, high: state.price.high }
      : null,
    status: {
      estimateSaved: !!state.estimateId,
      dateRequested: !!state.scheduleResult,
      quoteRequestCount: state.quoteResult?.requests.length ?? 0,
      pendingOperations: Object.values(state.operations)
        .filter((operation) => operation.status === 'pending')
        .map((operation) => operation.request.kind),
      interruptedOperations: Object.values(state.operations)
        .filter((operation) => operation.status === 'interrupted')
        .map((operation) => operation.request.kind),
    },
    readiness: conversationReadiness(state),
  }
}
