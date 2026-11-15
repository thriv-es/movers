// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { runText } from '../functions/api/_lib/ai-client'
import { sampleCacheKey, writeSampleCache } from '../functions/api/_lib/sample-cache'
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

function request(sample = false, overrides: Record<string, unknown> = {}) {
  return price.request(
    '/',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ analysis, moveDetails, sample }),
    },
    { ENV: 'preview', PRICE_PER_BOX: '50', CF_AIG_TOKEN: 'synthetic-test-token', ...overrides },
  )
}

describe('price route model reply', () => {
  it('recomputes a cached sample price after the saved Pricing backend or model changes', async () => {
    let selected = { backend: 'gateway', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' }
    let revision = 1
    const db = {
      prepare: () => ({
        first: async () => ({
          revision,
          roles_json: JSON.stringify({
            chat: { backend: 'gateway', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
            price: selected,
            vision: { backend: 'gateway', model: '@cf/meta/llama-3.2-11b-vision-instruct' },
          }),
        }),
      }),
    } as unknown as D1Database
    vi.mocked(runText).mockClear()
    for (const [index, labor] of [100, 200, 300, 400].entries()) {
      vi.mocked(runText).mockResolvedValueOnce({
        mode: index < 2 ? 'gateway' : 'binding',
        text: JSON.stringify({ currency: 'USD', breakdown: { labor }, confidence: 'low' }),
      })
    }
    const env = {
      ENV: 'development',
      MOVERS_DB: db,
      AI: { run: async () => ({ response: '' }) },
      CF_AIG_TOKEN: 'synthetic-token',
    }
    const first = await request(true, env)
    const repeated = await request(true, env)
    expect(first.status).toBe(200)
    expect(repeated.headers.get('x-movers-sample-cache')).toBe('hit')
    expect(runText).toHaveBeenCalledTimes(1)
    selected = { backend: 'gateway', model: '@cf/meta/llama-3.1-8b-instruct-fp8-fast' }
    const newModel = await request(true, env)
    expect(newModel.headers.get('x-movers-sample-cache')).toBeNull()
    expect(((await newModel.json()) as { price: { total: number } }).price.total).toBe(200)
    selected = { ...selected, backend: 'binding' }
    const newBackend = await request(true, env)
    expect(newBackend.headers.get('x-movers-sample-cache')).toBeNull()
    expect(((await newBackend.json()) as { price: { total: number } }).price.total).toBe(300)
    revision = 2
    const newRevision = await request(true, env)
    expect(newRevision.headers.get('x-movers-sample-cache')).toBeNull()
    expect(((await newRevision.json()) as { price: { total: number } }).price.total).toBe(400)
    expect(runText).toHaveBeenCalledTimes(4)
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const unavailable = await request(true, { ...env, AI: undefined })
    expect(unavailable.status).toBe(500)
    expect(unavailable.headers.get('x-movers-sample-cache')).toBeNull()
    expect(await unavailable.json()).toEqual({ error: 'Workers AI binding unavailable' })
    expect(errorLog).toHaveBeenCalledWith(
      'Price API error:',
      expect.objectContaining({ message: 'Workers AI binding unavailable' }),
    )
    errorLog.mockRestore()
    expect(runText).toHaveBeenCalledTimes(4)
  })

  it('does not cache an unsaved local fallback mock as a recovered real sample quote', async () => {
    const db = { prepare: () => ({ first: async () => null }) } as unknown as D1Database
    const env = { ENV: 'development', MOVERS_DB: db, CF_AIG_TOKEN: 'synthetic-token', PRICE_PER_BOX: '51' }
    vi.mocked(runText).mockClear()
    vi.mocked(runText)
      .mockResolvedValueOnce({
        mode: 'mock',
        text: JSON.stringify({ currency: 'USD', breakdown: { labor: 100 }, confidence: 'low' }),
      })
      .mockResolvedValueOnce({
        mode: 'gateway',
        text: JSON.stringify({ currency: 'USD', breakdown: { labor: 200 }, confidence: 'low' }),
      })
    const fallback = await request(true, env)
    expect(fallback.status).toBe(200)
    expect(fallback.headers.get('x-movers-ai-mode')).toBe('mock')
    const recovered = await request(true, env)
    expect(recovered.status).toBe(200)
    expect(recovered.headers.get('x-movers-sample-cache')).toBeNull()
    expect(recovered.headers.get('x-movers-ai-mode')).toBe('gateway')
    expect(((await recovered.json()) as { price: { total: number } }).price.total).toBe(200)
    const repeated = await request(true, env)
    expect(repeated.headers.get('x-movers-sample-cache')).toBe('hit')
    expect(runText).toHaveBeenCalledTimes(2)
  })

  it('rejects an earlier cached fallback mock under an unsaved real-mode key', async () => {
    const db = { prepare: () => ({ first: async () => null }) } as unknown as D1Database
    const env = { ENV: 'development', MOVERS_DB: db, CF_AIG_TOKEN: 'synthetic-token', PRICE_PER_BOX: '53' }
    const key = await sampleCacheKey('price', {
      analysis,
      moveDetails: {
        from: moveDetails.from,
        to: moveDetails.to,
        date: moveDetails.date,
        distanceMiles: moveDetails.distanceMiles,
        originFloor: moveDetails.originFloor,
        destinationFloor: moveDetails.destinationFloor,
        originElevator: moveDetails.originElevator,
        destinationElevator: moveDetails.destinationElevator,
      },
      pricePerBox: 53,
      pricing: { mode: 'gateway', backend: 'gateway', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', revision: 0 },
    })
    await writeSampleCache(
      key,
      JSON.stringify({
        mode: 'mock',
        text: JSON.stringify({ currency: 'USD', breakdown: { labor: 100 }, confidence: 'low' }),
      }),
    )
    vi.mocked(runText).mockClear()
    vi.mocked(runText).mockResolvedValueOnce({
      mode: 'gateway',
      text: JSON.stringify({ currency: 'USD', breakdown: { labor: 200 }, confidence: 'low' }),
    })
    const recovered = await request(true, env)
    expect(recovered.status).toBe(200)
    expect(recovered.headers.get('x-movers-sample-cache')).toBeNull()
    expect(recovered.headers.get('x-movers-ai-mode')).toBe('gateway')
    expect(((await recovered.json()) as { price: { total: number } }).price.total).toBe(200)
    expect(runText).toHaveBeenCalledTimes(1)
  })

  it('caches a forced local offline mock as mock, without calling a provider', async () => {
    const db = { prepare: () => ({ first: async () => null }) } as unknown as D1Database
    const env = { ENV: 'development', MOVERS_DB: db, CF_AIG_TOKEN: '', AI_MODE: 'mock', PRICE_PER_BOX: '52' }
    vi.mocked(runText).mockClear()
    vi.mocked(runText).mockResolvedValueOnce({
      mode: 'mock',
      text: JSON.stringify({ currency: 'USD', breakdown: { labor: 100 }, confidence: 'low' }),
    })
    const first = await request(true, env)
    const repeated = await request(true, env)
    expect(first.status).toBe(200)
    expect(first.headers.get('x-movers-ai-mode')).toBe('mock')
    expect(repeated.headers.get('x-movers-sample-cache')).toBe('hit')
    expect(runText).toHaveBeenCalledTimes(1)
  })

  it('returns a retryable error without fabricated price for malformed JSON', async () => {
    const res = await request()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body).toEqual({ code: 'PRICE_UNAVAILABLE', error: 'Pricing is temporarily unavailable. Please retry.' })
    expect(body).not.toHaveProperty('price')
  })

  it('returns the same retryable error for invalid line items', async () => {
    vi.mocked(runText).mockResolvedValueOnce({
      text: JSON.stringify({ currency: 'USD', breakdown: { labor: -1 } }),
      mode: 'binding',
    })
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
      text: JSON.stringify({
        currency: 'USD',
        total: 3439,
        breakdown: { labor: 1500, travel: 1470 },
        confidence: 'high',
      }),
      mode: 'binding',
    })
    const res = await request()
    expect(res.status).toBe(200)
    // A legacy caller omitted review answers, so server-owned confidence is low despite the model's high suggestion.
    expect(await res.json()).toMatchObject({
      price: {
        currency: 'USD',
        total: 2970,
        breakdown: { labor: 1500, travel: 1470 },
        confidence: 'low',
        low: 2100,
        high: 3850,
        confidenceReasons: expect.arrayContaining([expect.stringMatching(/whole move/i)]),
      },
    })
  })
})
