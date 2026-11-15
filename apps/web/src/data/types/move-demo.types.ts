/**
 * Types for the estimate flow, the saved estimates (leads), movers and quote requests.
 * Derived from the Zod schemas in `z-common/z-move-demo.ts`, so frontend and backend share one contract.
 */
import type { z } from 'zod'
import type {
  zAnalysisResult,
  zAnalyzeRequest,
  zChatApiRequest,
  zChatApiResponse,
  zChatMessage,
  zConfidence,
  zContact,
  zCreateEstimateRequest,
  zDetectedItem,
  zEstimateRecord,
  zEstimateResult,
  zEstimateSource,
  zEstimatedBoxes,
  zLeadStatus,
  zLeadUpdate,
  zMoveDetails,
  zMoverInput,
  zMoverRecord,
  zMoverStatus,
  zPossibleDuplicate,
  zPrice,
  zPriceBreakdown,
  zPriceRequest,
  zPriceResult,
  zPublicMover,
  zQuoteRequestInput,
  zQuoteRequestRecord,
  zQuoteRequestStatus,
  zRole,
  zSpecialHandling,
} from '../z-common/z-move-demo'

export type Role = z.infer<typeof zRole>
export type ChatMessage = z.infer<typeof zChatMessage>
export type MoveDetails = z.infer<typeof zMoveDetails>
export type ChatApiRequest = z.infer<typeof zChatApiRequest>
export type ChatApiResponse = z.infer<typeof zChatApiResponse>
export type DetectedItem = z.infer<typeof zDetectedItem>
export type EstimatedBoxes = z.infer<typeof zEstimatedBoxes>
export type SpecialHandling = z.infer<typeof zSpecialHandling>
export type PossibleDuplicate = z.infer<typeof zPossibleDuplicate>
export type PriceBreakdown = z.infer<typeof zPriceBreakdown>
export type Confidence = z.infer<typeof zConfidence>
export type Price = z.infer<typeof zPrice>
export type EstimateResult = z.infer<typeof zEstimateResult>
export type AnalysisResult = z.infer<typeof zAnalysisResult>
export type AnalyzeRequest = z.infer<typeof zAnalyzeRequest>
export type PriceRequest = z.infer<typeof zPriceRequest>
export type PriceResult = z.infer<typeof zPriceResult>

export type EstimateSource = z.infer<typeof zEstimateSource>
export type LeadStatus = z.infer<typeof zLeadStatus>
export type Contact = z.infer<typeof zContact>
export type CreateEstimateRequest = z.infer<typeof zCreateEstimateRequest>
export type EstimateRecord = z.infer<typeof zEstimateRecord>
export type LeadUpdate = z.infer<typeof zLeadUpdate>
export type MoverStatus = z.infer<typeof zMoverStatus>
export type MoverInput = z.infer<typeof zMoverInput>
export type MoverRecord = z.infer<typeof zMoverRecord>
export type PublicMover = z.infer<typeof zPublicMover>
export type QuoteRequestInput = z.infer<typeof zQuoteRequestInput>
export type QuoteRequestStatus = z.infer<typeof zQuoteRequestStatus>
export type QuoteRequestRecord = z.infer<typeof zQuoteRequestRecord>
