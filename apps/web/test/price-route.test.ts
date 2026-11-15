// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { runText } from '../functions/api/_lib/ai-client'
import price from '../functions/api/_routes/price'

vi.mock('../functions/api/_lib/ai-client', () => ({
  runText: vi.fn(async () => ({ text: '{bad', mode: 'binding' })),
}))

const analysis = {
  items: [{ type: 'sofa', count: 1 }],
  totalVolumeCubicFeet: 10,
  estimatedBoxes: { min: 1, max: 1 },
  boxesExplanation: '',
  specialHandling: [],
  possibleDuplicates: [],
  unseenAreas: [],
}
const moveDetails = {
  from: '123 Main St, Austin, TX',
  to: '9 Oak Ave, Dallas, TX',
  date: '2027-01-15',
  distanceMiles: 50,
  originFloor: 1,
  originElevator: true,
  destinationFloor: 1,
  destinationElevator: true,
}

function request() {
  return price.request(
    '/',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ analysis, moveDetails, sample: false }) },
    { ENV: 'preview', PRICE_PER_BOX: '50' },
  )
}

describe('price route model reply', () => {
  it('returns a retryable error without fabricated price for malformed JSON', async () => {
    const res = await request()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body).toEqual({ code: 'PRICE_UNAVAILABLE', error: 'Pricing is temporarily unavailable. Please retry.' })
    expect(body).not.toHaveProperty('price')
  })

  it('returns the same retryable error for invalid line items', async () => {
    vi.mocked(runText).mockResolvedValueOnce({ text: JSON.stringify({ currency: 'USD', breakdown: { labor: -1 } }), mode: 'binding' })
    const res = await request()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body).toEqual({ code: 'PRICE_UNAVAILABLE', error: 'Pricing is temporarily unavailable. Please retry.' })
    expect(body).not.toHaveProperty('price')
  })

  it('returns no price when a prototype-shadowing line would be dropped downstream', async () => {
    const breakdown = JSON.parse('{"__proto__":1,"labor":2}') as Record<string, number>
    vi.mocked(runText).mockResolvedValueOnce({ text: JSON.stringify({ currency: 'USD', breakdown }), mode: 'binding' })
    const res = await request()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body).toEqual({ code: 'PRICE_UNAVAILABLE', error: 'Pricing is temporarily unavailable. Please retry.' })
    expect(body).not.toHaveProperty('price')
  })

  it('ranges the server-summed total rather than the model total', async () => {
    vi.mocked(runText).mockResolvedValueOnce({
      text: JSON.stringify({ currency: 'USD', total: 3439, breakdown: { labor: 1500, travel: 1470 }, confidence: 'high' }),
      mode: 'binding',
    })
    const res = await request()
    expect(res.status).toBe(200)
    // A legacy caller omitted review answers, so server-owned confidence is low despite the model's high suggestion.
    expect(await res.json()).toMatchObject({
      price: {
        currency: 'USD', total: 2970, breakdown: { labor: 1500, travel: 1470 },
        confidence: 'low', low: 2100, high: 3850,
        confidenceReasons: expect.arrayContaining([expect.stringMatching(/whole move/i)]),
      },
    })
  })
})
