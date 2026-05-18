import { z } from 'zod'

/**
 * Zod schemas for Move Estimate Demo types.
 * Used for runtime validation in both frontend and backend.
 */

export const zRole = z.enum(['user', 'assistant'])

export const zChatMessage = z.object({
  id: z.string(),
  role: zRole,
  content: z.string(),
})

export const zChatApiResponse = z.object({
  content: z.string(),
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

export const zMoveInfo = z.object({
  distance_miles: z.number().nonnegative().nullable(),
  origin_floor: z.number().int().positive().nullable(),
  destination_floor: z.number().int().positive().nullable(),
  origin_has_elevator: z.boolean().nullable(),
  destination_has_elevator: z.boolean().nullable(),
})

export const zPriceBreakdown = z.record(z.string(), z.number().nonnegative())

export const zPrice = z.object({
  currency: z.string().default('USD'),
  total: z.number().nonnegative(),
  breakdown: zPriceBreakdown,
  explanation: z.string().optional(),
  confidence: z.enum(['high', 'medium', 'low']).optional(),
})

export const zEstimateResult = z.object({
  items: z.array(zDetectedItem),
  estimatedBoxes: zEstimatedBoxes,
  boxesExplanation: z.string().optional(),
  price: zPrice,
})

export const zAnalysisResult = z.object({
  items: z.array(zDetectedItem),
  totalVolumeCubicFeet: z.number().nonnegative(),
  estimatedBoxes: zEstimatedBoxes,
  boxesExplanation: z.string(),
})

export const zPriceRequest = z.object({
  analysis: zAnalysisResult,
  moveInfo: zMoveInfo,
})

export const zPriceResult = z.object({
  price: zPrice,
})

