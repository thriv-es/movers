import { describe, expect, it } from 'vitest'
import { RANGE_BY_CONFIDENCE, calculatePrice, specialHandlingLines, withRange } from '../functions/api/_lib/pricing'

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

describe('withRange (MOVERS-8)', () => {
  const base = { currency: 'USD', total: 1234, breakdown: { a: 1234 } }

  it('keeps low <= total <= high and widens with lower confidence', () => {
    const high = withRange(base, 'high')
    const medium = withRange(base, 'medium')
    const low = withRange(base, 'low')
    for (const p of [high, medium, low]) {
      expect(p.low).toBeLessThanOrEqual(p.total)
      expect(p.high).toBeGreaterThanOrEqual(p.total)
      expect(p.low % 10).toBe(0)
      expect(p.high % 10).toBe(0)
    }
    expect(high.high - high.low).toBeLessThan(medium.high - medium.low)
    expect(medium.high - medium.low).toBeLessThan(low.high - low.low)
    expect(low.confidence).toBe('low')
    expect(RANGE_BY_CONFIDENCE.high).toBeLessThan(RANGE_BY_CONFIDENCE.low)
  })

  it('rounds to 50 for larger totals and never goes below zero', () => {
    const big = withRange({ ...base, total: 4321 }, 'medium')
    expect(big.low % 50).toBe(0)
    expect(big.high % 50).toBe(0)
    expect(withRange({ ...base, total: 0 }, 'low')).toMatchObject({ low: 0, high: 0 })
  })
})

describe('specialHandlingLines', () => {
  it('adds one line per item and sums repeats', () => {
    expect(
      specialHandlingLines([
        { item: 'piano', reason: 'a' },
        { item: 'safe', reason: 'b' },
        { item: 'piano', reason: 'c' },
      ]),
    ).toEqual({ 'Special handling: piano': 300, 'Special handling: safe': 150 })
  })
})
