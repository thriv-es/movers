// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { priceConfidence } from '../functions/api/_lib/price-confidence'
import { zPriceRequest } from '../src/data'

const request = {
  analysis: {
    items: [{ type: 'sofa', count: 1 }],
    totalVolumeCubicFeet: 80,
    estimatedBoxes: { min: 2, max: 4 },
    boxesExplanation: '',
    specialHandling: [],
    possibleDuplicates: [],
    unseenAreas: [],
  },
  moveDetails: {
    from: 'A',
    to: 'B',
    date: null,
    distanceMiles: 12,
    originFloor: 1,
    destinationFloor: 1,
    originElevator: true,
    destinationElevator: true,
  },
  review: { followUps: { garage: false, closets: false, appliances: false }, wholeMoveCovered: true },
}

describe('price confidence', () => {
  it.each([
    [{ excludedCount: 1, unresolvedCount: 0 }, 'medium'],
    [{ excludedCount: 0, unresolvedCount: 1 }, 'low'],
  ] as const)('caps confidence for photo evidence %j', (photoEvidence, level) => {
    const result = priceConfidence({ ...request, review: { ...request.review, photoEvidence } }, 'high')
    expect(result.level).toBe(level)
    expect(result.reasons.join(' ')).toMatch(/photo/i)
  })

  it('defaults legacy photo evidence to zero', () => {
    expect(zPriceRequest.parse(request).review.photoEvidence).toEqual({ excludedCount: 0, unresolvedCount: 0 })
  })
  it('allows high only for confirmed whole-move coverage, complete follow-ups and details', () => {
    expect(priceConfidence(request, 'high')).toEqual({ level: 'high', reasons: [] })
  })

  it('rates unanswered whole-move coverage low and names the missing answer', () => {
    const verdict = priceConfidence({ ...request, review: { ...request.review, wholeMoveCovered: null } }, 'high')
    expect(verdict.level).toBe('low')
    expect(verdict.reasons.join(' ')).toMatch(/whole move/i)
    expect(verdict.reasons.join(' ')).not.toMatch(/photos.*(prove|cover)/i)
  })

  it('rates any unanswered follow-up low and identifies it', () => {
    const verdict = priceConfidence(
      { ...request, review: { ...request.review, followUps: { ...request.review.followUps, garage: null } } },
      'high',
    )
    expect(verdict.level).toBe('low')
    expect(verdict.reasons.join(' ')).toMatch(/garage/i)
  })

  it('rates an explicit uncovered move low', () => {
    const verdict = priceConfidence({ ...request, review: { ...request.review, wholeMoveCovered: false } }, 'high')
    expect(verdict.level).toBe('low')
    expect(verdict.reasons.join(' ')).toMatch(/whole move/i)
  })

  it('rates unseen areas medium even with confirmed coverage without echoing arbitrary area names', () => {
    const verdict = priceConfidence(
      { ...request, analysis: { ...request.analysis, unseenAreas: ['<unsafe-area>'] } },
      'high',
    )
    expect(verdict.level).toBe('medium')
    expect(verdict.reasons.join(' ')).toMatch(/area|room/i)
    expect(verdict.reasons.join(' ')).not.toContain('<unsafe-area>')
  })

  it('rates one missing move field medium and names it', () => {
    const verdict = priceConfidence(
      { ...request, moveDetails: { ...request.moveDetails, distanceMiles: null } },
      'high',
    )
    expect(verdict.level).toBe('medium')
    expect(verdict.reasons.join(' ')).toMatch(/distance/i)
  })

  it('rates three missing move fields low and names each', () => {
    const verdict = priceConfidence(
      {
        ...request,
        moveDetails: { ...request.moveDetails, distanceMiles: null, originFloor: null, destinationElevator: null },
      },
      'high',
    )
    expect(verdict.level).toBe('low')
    expect(verdict.reasons.join(' ')).toMatch(/distance/i)
    expect(verdict.reasons.join(' ')).toMatch(/origin floor/i)
    expect(verdict.reasons.join(' ')).toMatch(/destination elevator/i)
  })

  it('never upgrades a lower model suggestion and explains the model limit', () => {
    const verdict = priceConfidence(request, 'low')
    expect(verdict.level).toBe('low')
    expect(verdict.reasons.join(' ')).toMatch(/model|price evaluation/i)
  })

  it('defaults legacy API callers to unanswered review rather than inferred coverage', () => {
    const parsed = zPriceRequest.parse({ analysis: request.analysis, moveDetails: request.moveDetails })
    expect(parsed.review).toEqual({
      photoEvidence: { excludedCount: 0, unresolvedCount: 0 },
      followUps: { garage: null, closets: null, appliances: null },
      wholeMoveCovered: null,
    })
    expect(priceConfidence(parsed, 'high').level).toBe('low')
  })
})
