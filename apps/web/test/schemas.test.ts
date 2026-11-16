import { describe, expect, it } from 'vitest'
import {
  EMPTY_MOVE_DETAILS,
  zAnalyzeRequest,
  zAnalysisResult,
  zChatApiResponse,
  zMoveDetails,
  zPrice,
  zQuoteRequestInput,
} from '../src/data'

describe('linked analyze contract', () => {
  const base = {
    sessionId: '11111111-1111-4111-8111-111111111111',
    photoRefs: [{ url: 'http://localhost/api/images/a.jpg', receipt: null }],
    moveDetails: EMPTY_MOVE_DETAILS,
    sample: false,
  }
  it('accepts receipt refs and confirmed details but strips chat', () => {
    expect(zAnalyzeRequest.parse({ ...base, messages: [{ content: 'private chat' }] })).toEqual(base)
  })
  it.each([
    { imageUrls: ['http://localhost/a.jpg'] },
    { ...base, sessionId: 'bad' },
    { ...base, photoRefs: [] },
    { ...base, photoRefs: Array(11).fill(base.photoRefs[0]) },
    { ...base, moveDetails: undefined },
  ])('rejects invalid or legacy analyze input', (body) => {
    expect(zAnalyzeRequest.safeParse(body).success).toBe(false)
  })
})

describe('zMoveDetails', () => {
  it('accepts all-null details and rejects a zero floor', () => {
    expect(
      zMoveDetails.safeParse({
        from: null,
        to: null,
        date: null,
        distanceMiles: null,
        originFloor: null,
        destinationFloor: null,
        originElevator: null,
        destinationElevator: null,
      }).success,
    ).toBe(true)
    expect(zMoveDetails.safeParse({ from: 'a', originFloor: 0 }).success).toBe(false)
  })
})

describe('zPrice (MOVERS-8)', () => {
  const base = { currency: 'USD', total: 100, breakdown: { a: 100 } }
  it('enforces low <= total <= high', () => {
    expect(zPrice.safeParse({ ...base, low: 80, high: 120 }).success).toBe(true)
    expect(zPrice.safeParse({ ...base, low: 100, high: 100 }).success).toBe(true)
    expect(zPrice.safeParse({ ...base, low: 120, high: 130 }).success).toBe(false)
    expect(zPrice.safeParse({ ...base, low: 80, high: 90 }).success).toBe(false)
    expect(zPrice.safeParse(base).success).toBe(false)
  })
})

describe('zAnalysisResult (MOVERS-23)', () => {
  it('defaults the extensions to empty arrays', () => {
    const parsed = zAnalysisResult.parse({
      items: [{ type: 'sofa', count: 1 }],
      totalVolumeCubicFeet: 10,
      estimatedBoxes: { min: 1, max: 2 },
      boxesExplanation: '',
    })
    expect(parsed.specialHandling).toEqual([])
    expect(parsed.possibleDuplicates).toEqual([])
    expect(parsed.unseenAreas).toEqual([])
  })
})

describe('zChatApiResponse', () => {
  it('requires reply, moveDetails and finished', () => {
    expect(zChatApiResponse.safeParse({ reply: 'hi', finished: false }).success).toBe(false)
  })
})

describe('zQuoteRequestInput', () => {
  it('allows one to three movers', () => {
    expect(zQuoteRequestInput.safeParse({ estimateId: 'e', moverIds: [] }).success).toBe(false)
    expect(zQuoteRequestInput.safeParse({ estimateId: 'e', moverIds: ['a', 'b', 'c', 'd'] }).success).toBe(false)
    expect(zQuoteRequestInput.parse({ estimateId: 'e', moverIds: ['a'] }).note).toBe('')
  })
})
