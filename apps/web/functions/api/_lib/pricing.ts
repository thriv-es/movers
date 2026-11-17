import type { Confidence, DetectedItem, EstimatedBoxes, Price, SpecialHandling } from '../../../src/data'

export interface PriceCalculationInput {
  items: DetectedItem[]
  estimatedBoxes: EstimatedBoxes
  pricePerBox: number
}

export function calculatePrice(input: PriceCalculationInput) {
  const { estimatedBoxes, pricePerBox } = input
  const boxesCost = estimatedBoxes.max * pricePerBox
  const breakdown: Record<string, number> = {}
  if (estimatedBoxes.max > 0) {
    breakdown[`${estimatedBoxes.max} box(es)`] = boxesCost
  }
  return { currency: 'USD', total: boxesCost, breakdown }
}

/** How wide the range is around the total, by confidence (MOVERS-8). */
export const RANGE_BY_CONFIDENCE: Record<Confidence, number> = { high: 0.1, medium: 0.2, low: 0.3 }

const roundTo = (value: number, step: number) => Math.round(value / step) * step

/** Adds `low` and `high` around `total`, rounded to a readable step, keeping `low <= total <= high`. */
export function withRange(
  price: Omit<Price, 'low' | 'high'> & Partial<Pick<Price, 'low' | 'high'>>,
  confidence: Confidence = price.confidence ?? 'low',
): Price {
  const spread = RANGE_BY_CONFIDENCE[confidence]
  const step = price.total >= 2000 ? 50 : 10
  const low = Math.min(price.total, Math.max(0, roundTo(price.total * (1 - spread), step)))
  const high = Math.max(price.total, roundTo(price.total * (1 + spread), step))
  return { ...price, confidence, low, high }
}

/** Flat surcharge per item that needs extra movers, crating or a specialist; used by the mock and the fallback. */
export const SPECIAL_ITEM_SURCHARGE = 150

export function specialHandlingLines(specialHandling: SpecialHandling[]): Record<string, number> {
  const lines: Record<string, number> = {}
  for (const entry of specialHandling) {
    const label = `Special handling: ${entry.item}`
    lines[label] = (lines[label] ?? 0) + SPECIAL_ITEM_SURCHARGE
  }
  return lines
}
