import { describe, expect, it } from 'vitest'
import { calculatePrice } from '../functions/api/_lib/pricing'

describe('calculatePrice', () => {
  it('prices 10 boxes at 50 as 500', () => {
    const price = calculatePrice({ items: [], estimatedBoxes: { min: 6, max: 10 }, pricePerBox: 50 })
    expect(price.total).toBe(500)
    expect(price.currency).toBe('USD')
    expect(price.breakdown).toEqual({ '10 box(es)': 500 })
  })

  it('returns an empty breakdown for zero boxes', () => {
    const price = calculatePrice({ items: [], estimatedBoxes: { min: 0, max: 0 }, pricePerBox: 50 })
    expect(price.total).toBe(0)
    expect(price.breakdown).toEqual({})
  })
})
