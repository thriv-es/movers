import { describe, expect, it } from 'vitest'
import { normalizePriceReply, PriceFormatError } from '../functions/api/_lib/price-normalization'

describe('normalizePriceReply', () => {
  it('uses line items rather than the model total', () => {
    expect(
      normalizePriceReply({ total: 3439, currency: 'USD', breakdown: { labor: 1500, travel: 1470 } }, true),
    ).toMatchObject({ total: 2970, currency: 'USD', breakdown: { labor: 1500, travel: 1470 } })
  })

  it('sums cents without floating-point drift', () => {
    expect(normalizePriceReply({ currency: 'USD', breakdown: { a: 0.1, b: 0.2 } }, true).total).toBe(0.3)
  })

  it('merges case-insensitive, trimmed labels while keeping the first spelling', () => {
    expect(
      normalizePriceReply({ currency: 'USD', breakdown: { Labor: 10.25, ' labor ': 0.75 } }, true),
    ).toMatchObject({ total: 11, breakdown: { Labor: 11 } })
  })

  it.each([
    ['negative amount', { currency: 'USD', breakdown: { labor: -1 } }],
    ['non-finite amount', { currency: 'USD', breakdown: { labor: NaN } }],
    ['three-decimal amount', { currency: 'USD', breakdown: { labor: 1.001 } }],
    ['non-USD currency', { currency: 'EUR', breakdown: { labor: 1 } }],
    ['blank label', { currency: 'USD', breakdown: { ' ': 1 } }],
    ['overlong label', { currency: 'USD', breakdown: { ['x'.repeat(121)]: 1 } }],
    ['empty breakdown with items', { currency: 'USD', breakdown: {} }],
    ['array breakdown', { currency: 'USD', breakdown: [1] }],
    ['unsafe cents', { currency: 'USD', breakdown: { labor: Number.MAX_SAFE_INTEGER } }],
    ['unsafe total cents', { currency: 'USD', breakdown: { a: 50_000_000_000_000, b: 50_000_000_000_000 } }],
  ])('rejects %s', (_name, raw) => {
    expect(() => normalizePriceReply(raw, true)).toThrow(PriceFormatError)
  })

  it('requires a plain reply object', () => {
    expect(() => normalizePriceReply(null, false)).toThrow(PriceFormatError)
    expect(() => normalizePriceReply([], false)).toThrow(PriceFormatError)
  })

  it('permits an empty breakdown only when there are no items', () => {
    expect(normalizePriceReply({ currency: 'USD', breakdown: {} }, false)).toMatchObject({ total: 0, breakdown: {} })
  })

  it('bounds explanation and only accepts known confidence suggestions', () => {
    const result = normalizePriceReply(
      { currency: 'USD', breakdown: { labor: 1 }, explanation: 'x'.repeat(1001), confidence: 'maybe' },
      true,
    )
    expect(result.explanation).toHaveLength(1000)
    expect(result.confidence).toBeUndefined()
    expect(normalizePriceReply({ currency: 'USD', breakdown: {}, confidence: 'high' }, false).confidence).toBe('high')
  })
})
