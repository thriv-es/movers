import { z } from 'zod'

/**
 * Zod schemas for the estimate flow.
 * Used for runtime validation in both frontend and backend.
 */

export const zRole = z.enum(['user', 'assistant'])

export const zChatMessage = z.object({
  id: z.string(),
  role: zRole,
  content: z.string(),
})

/**
 * What the assistant has learned about the move. Every field is nullable: the chat fills them in one answer at a
 * time, and the customer can correct any of them on the details card before pricing.
 */
export const zMoveDetails = z.object({
  from: z.string().nullable(),
  to: z.string().nullable(),
  date: z.string().nullable(),
  distanceMiles: z.number().nonnegative().nullable(),
  originFloor: z.number().int().positive().nullable(),
  destinationFloor: z.number().int().positive().nullable(),
  originElevator: z.boolean().nullable(),
  destinationElevator: z.boolean().nullable(),
})

export const EMPTY_MOVE_DETAILS: z.infer<typeof zMoveDetails> = {
  from: null,
  to: null,
  date: null,
  distanceMiles: null,
  originFloor: null,
  destinationFloor: null,
  originElevator: null,
  destinationElevator: null,
}

export const zChatApiRequest = z.object({
  messages: zChatMessage.array(),
  /** Details collected so far, so a turn in which the model omits a field does not lose it. */
  moveDetails: zMoveDetails.partial().optional(),
})

export const zChatApiResponse = z.object({
  reply: z.string(),
  moveDetails: zMoveDetails,
  finished: z.boolean(),
})

export const zDetectedItem = z.object({
  type: z.string(),
  count: z.number().int().positive(),
})

export const zEstimatedBoxes = z.object({
  min: z.number().int().nonnegative(),
  max: z.number().int().nonnegative(),
})

export const zSpecialHandling = z.object({
  item: z.string(),
  reason: z.string(),
})

export const zPossibleDuplicate = z.object({
  item: z.string(),
  count: z.number().int().positive(),
})

export const zPriceBreakdown = z.record(z.string(), z.number().nonnegative())

export const zConfidence = z.enum(['high', 'medium', 'low'])

export const zPrice = z
  .object({
    currency: z.string().default('USD'),
    total: z.number().nonnegative(),
    low: z.number().nonnegative(),
    high: z.number().nonnegative(),
    breakdown: zPriceBreakdown,
    explanation: z.string().optional(),
    confidence: zConfidence.optional(),
  })
  .refine((p) => p.low <= p.total && p.total <= p.high, { message: 'low <= total <= high' })

export const zAnalysisResult = z.object({
  items: z.array(zDetectedItem),
  totalVolumeCubicFeet: z.number().nonnegative(),
  estimatedBoxes: zEstimatedBoxes,
  boxesExplanation: z.string(),
  /** Items that need extra movers, crating or a specialist. */
  specialHandling: z.array(zSpecialHandling).default([]),
  /** Items the model may have counted twice across photos. */
  possibleDuplicates: z.array(zPossibleDuplicate).default([]),
  /** Rooms or storage the photos did not show. */
  unseenAreas: z.array(z.string()).default([]),
})

export const zEstimateResult = z.object({
  items: z.array(zDetectedItem),
  estimatedBoxes: zEstimatedBoxes,
  boxesExplanation: z.string().optional(),
  price: zPrice,
})

export const zAnalyzeRequest = z.object({
  imageUrls: z.array(z.string()).min(1).max(10),
  /** The bundled sample move: results are cached so repeated runs do not spend model calls. */
  sample: z.boolean().optional(),
})

export const zPriceRequest = z.object({
  analysis: zAnalysisResult,
  moveDetails: zMoveDetails,
  sample: z.boolean().optional(),
})

export const zPriceResult = z.object({
  price: zPrice,
})

// ---------------------------------------------------------------------------
// Saved estimates (leads), movers and quote requests
// ---------------------------------------------------------------------------

export const zEstimateSource = z.enum(['own', 'sample'])
export const zLeadStatus = z.enum(['new', 'contacted', 'quoted', 'won', 'lost'])

export const zContact = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).optional().default(''),
  requestedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
})

export const zCreateEstimateRequest = z.object({
  source: zEstimateSource.default('own'),
  moveDetails: zMoveDetails,
  analysis: zAnalysisResult,
  items: z.array(zDetectedItem),
  price: zPrice,
  photoKeys: z.array(z.string()).default([]),
})

export const zEstimateRecord = zCreateEstimateRequest.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  contact: zContact.nullable(),
  status: zLeadStatus,
  notes: z.string(),
})

export const zMoverStatus = z.enum(['active', 'inactive'])

export const zMoverInput = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  website: z.string().trim().max(200).optional().default(''),
  serviceArea: z.string().trim().max(200).optional().default(''),
  status: zMoverStatus.default('active'),
})

export const zMoverRecord = zMoverInput.extend({
  id: z.string(),
  slug: z.string(),
  createdAt: z.string(),
})

/** What the customer sees when choosing movers to ask for quotes. */
export const zPublicMover = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  serviceArea: z.string(),
})

export const zQuoteRequestInput = z.object({
  estimateId: z.string(),
  moverIds: z.array(z.string()).min(1).max(3),
  note: z.string().trim().max(1000).optional().default(''),
})

export const zQuoteRequestStatus = z.enum(['logged', 'replied'])

export const zQuoteRequestRecord = z.object({
  id: z.string(),
  estimateId: z.string(),
  moverId: z.string(),
  moverName: z.string(),
  note: z.string(),
  status: zQuoteRequestStatus,
  createdAt: z.string(),
})

export const zLeadUpdate = z.object({
  status: zLeadStatus.optional(),
  notes: z.string().max(5000).optional(),
})
