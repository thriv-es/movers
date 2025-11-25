import type { DetectedItem, EstimatedBoxes } from '@workspace/data'

export interface PriceCalculationInput {
  items: DetectedItem[]
  estimatedBoxes: EstimatedBoxes
  pricePerBox: number
}

export interface PriceBreakdown {
  [key: string]: number
}

export interface PriceResult {
  currency: string
  total: number
  breakdown: PriceBreakdown
}

/**
 * Calculates the moving estimate price based on box estimates.
 * Formula: estimated_boxes.max * pricePerBox
 */
export function calculatePrice(input: PriceCalculationInput): PriceResult {
  const { estimatedBoxes, pricePerBox } = input

  // Calculate cost based on boxes only
  const boxesCost = estimatedBoxes.max * pricePerBox

  const breakdown: PriceBreakdown = {}
  if (estimatedBoxes.max > 0) {
    breakdown[`${estimatedBoxes.max} box(es)`] = boxesCost
  }

  const total = boxesCost

  return {
    currency: 'USD',
    total,
    breakdown,
  }
}

