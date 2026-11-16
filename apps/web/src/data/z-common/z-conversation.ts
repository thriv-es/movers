import { z } from 'zod'
import { zDetectedItem, zEstimatedBoxes, zMoveDetails, zPossibleDuplicate, zReviewCoverage } from './z-move-demo'

/** Local identifiers are never URLs, bucket keys or receipt tokens. */
export const zConversationId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
export const zConversationRevision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const zItemType = z.string().trim().min(1).max(200)
// References may name valid persisted legacy labels; reducer/parser still require current membership.
// This does not relax new-item labels, counts or aggregate-add limits.
const zExistingItemType = zDetectedItem.shape.type
const zItem = zDetectedItem.extend({ type: zItemType, count: z.number().int().positive().max(10000) }).strict()
export const zConversationMoveDetails = zMoveDetails.extend({
  distanceMiles: z.number().finite().nonnegative().nullable(),
})
const zDetailsPatch = zConversationMoveDetails
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0 && Object.values(patch).every((value) => value !== undefined), {
    message: 'A patch must contain explicit values; use null to clear a detail',
  })

/** Only proposals, never assertions that an external operation succeeded. */
export const zConversationCommand = z.discriminatedUnion('type', [
  z.object({ type: z.literal('details.patch'), patch: zDetailsPatch }).strict(),
  z.object({ type: z.literal('item.add'), item: zItem }).strict(),
  z
    .object({
      type: z.literal('item.count'),
      itemType: zExistingItemType,
      count: z.number().int().positive().max(10000),
    })
    .strict(),
  z.object({ type: z.literal('item.remove'), itemType: zExistingItemType }).strict(),
  z
    .object({ type: z.literal('photo.decide'), photoId: zConversationId, decision: z.enum(['keep', 'exclude']) })
    .strict(),
  z
    .object({
      type: z.literal('duplicate.resolve'),
      itemType: zExistingItemType,
      resolution: z.enum(['same', 'different']),
    })
    .strict(),
  z
    .object({
      type: z.literal('followUp.answer'),
      key: z.enum(['garage', 'closets', 'appliances']),
      answer: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal('coverage.answer'), answer: z.boolean() }).strict(),
  z.object({ type: z.literal('request.action'), action: z.enum(['analyze', 'price', 'schedule', 'quotes']) }).strict(),
])
export type ConversationCommand = z.infer<typeof zConversationCommand>

export const zConversationProposal = z
  .object({
    id: zConversationId,
    expectedRevision: zConversationRevision,
    command: zConversationCommand,
  })
  .strict()
export type ConversationProposal = z.infer<typeof zConversationProposal>

export const zConversationReadiness = z
  .object({
    detailsComplete: z.boolean(),
    canAnalyze: z.boolean(),
    canPrice: z.boolean(),
    canSave: z.boolean(),
    canSchedule: z.boolean(),
    canQuote: z.boolean(),
    unresolvedPhotos: z.number().int().nonnegative(),
    unresolvedDuplicates: z.number().int().nonnegative(),
    unansweredFollowUps: z.array(z.enum(['garage', 'closets', 'appliances'])),
    coverageAnswered: z.boolean(),
    visionCurrent: z.boolean(),
  })
  .strict()
export type ConversationReadiness = z.infer<typeof zConversationReadiness>

/** Deliberate allowlist: no transcript, contact, refs, receipt, assessment prose or URL fields. */
export const zConversationSnapshot = z
  .object({
    version: z.literal(6),
    revision: zConversationRevision,
    moveDetails: zConversationMoveDetails,
    detailsConfirmed: z.boolean(),
    sample: z.boolean(),
    photos: z.array(
      z
        .object({
          id: zConversationId,
          status: z.enum(['linked', 'reupload', 'relevant', 'unrelated', 'uncertain', 'unlinked', 'unavailable']),
          decision: z.enum(['keep', 'exclude']).nullable(),
        })
        .strict(),
    ),
    // A snapshot describes existing domain inventory, including valid legacy labels/counts.
    inventory: z.array(zDetectedItem.strict()),
    analysis: z
      .object({ totalVolumeCubicFeet: z.number().nonnegative(), estimatedBoxes: zEstimatedBoxes })
      .strict()
      .nullable(),
    review: z
      .object({
        followUps: zReviewCoverage.shape.followUps,
        wholeMoveCovered: z.boolean().nullable(),
        duplicateResolutions: z.record(z.string(), z.enum(['same', 'different'])),
        pendingDuplicates: z.array(zPossibleDuplicate.strict()),
      })
      .strict(),
    price: z
      .object({
        currency: z.string(),
        total: z.number().nonnegative(),
        low: z.number().nonnegative(),
        high: z.number().nonnegative(),
      })
      .strict()
      .nullable(),
    status: z
      .object({
        estimateSaved: z.boolean(),
        dateRequested: z.boolean(),
        quoteRequestCount: z.number().int().nonnegative(),
        pendingOperations: z.array(z.enum(['analyze', 'price', 'save', 'schedule', 'quotes'])),
        interruptedOperations: z.array(z.enum(['analyze', 'price', 'save', 'schedule', 'quotes'])),
      })
      .strict(),
    readiness: zConversationReadiness,
  })
  .strict()
export type ConversationSnapshot = z.infer<typeof zConversationSnapshot>
