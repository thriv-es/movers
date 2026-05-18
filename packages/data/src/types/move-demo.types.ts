/**
 * Types for the Move Estimate Demo application.
 * Shared between frontend and backend.
 */

export type Role = 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: Role
  content: string
}

export interface ChatApiResponse {
  content: string
  finished: boolean
}

export interface DetectedItem {
  type: string
  count: number
}

export interface EstimatedBoxes {
  min: number
  max: number
}

export interface MoveInfo {
  distance_miles: number | null
  origin_floor: number | null
  destination_floor: number | null
  origin_has_elevator: boolean | null
  destination_has_elevator: boolean | null
}

export interface PriceBreakdown {
  [key: string]: number
}

export interface Price {
  currency: string
  total: number
  breakdown: PriceBreakdown
  explanation?: string
  confidence?: 'high' | 'medium' | 'low'
}

export interface EstimateResult {
  items: DetectedItem[]
  estimatedBoxes: EstimatedBoxes
  boxesExplanation?: string
  price: Price
}

/**
 * Result from /api/analyze - image analysis step
 */
export interface AnalysisResult {
  items: DetectedItem[]
  totalVolumeCubicFeet: number
  estimatedBoxes: EstimatedBoxes
  boxesExplanation: string
}

/**
 * Request body for /api/price - pricing step
 */
export interface PriceRequest {
  analysis: AnalysisResult
  moveInfo: MoveInfo
}

/**
 * Result from /api/price - pricing step
 */
export interface PriceResult {
  price: Price
}

