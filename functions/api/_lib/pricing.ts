import type { DetectedItem, EstimatedBoxes } from '../../../src/data';

export interface PriceCalculationInput {
  items: DetectedItem[];
  estimatedBoxes: EstimatedBoxes;
  pricePerBox: number;
}

export function calculatePrice(input: PriceCalculationInput) {
  const { estimatedBoxes, pricePerBox } = input;
  const boxesCost = estimatedBoxes.max * pricePerBox;
  const breakdown: Record<string, number> = {};
  if (estimatedBoxes.max > 0) {
    breakdown[`${estimatedBoxes.max} box(es)`] = boxesCost;
  }
  return { currency: 'USD', total: boxesCost, breakdown };
}
