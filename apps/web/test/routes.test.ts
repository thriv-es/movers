// @vitest-environment node
/**
 * Route-level checks of the AI honesty and production-safety rules, through the real Hono routes with fake bindings:
 * every AI answer is labelled with `x-movers-ai-mode`, the mock is served only in local development, and a
 * production-like environment without AI credentials returns an error instead of mocked data.
 */
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Bindings } from '../functions/api/_lib/types'
import analyze from '../functions/api/_routes/analyze'
import chat from '../functions/api/_routes/chat'
import price from '../functions/api/_routes/price'

const MODE_HEADER = 'x-movers-ai-mode'

const bucket = {
  get: async () => ({
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    httpMetadata: { contentType: 'image/png' },
  }),
}

function env(overrides: Record<string, unknown> = {}) {
  return { ENV: 'development', PRICE_PER_BOX: '50', CF_AIG_TOKEN: '', MOVERS_BUCKET: bucket, ...overrides }
}

function post(app: Hono<{ Bindings: Bindings }>, body: unknown, bindings: unknown) {
  return app.request(
    '/',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    bindings,
  )
}

const ANSWERS = [
  '123 Main St, Austin, TX 78701',
  '9 Oak Ave, Dallas, TX',
  '2027-01-15',
  '3rd floor, no elevator',
  '1st floor, elevator',
]
const moveDetails = (floor: number, elevator: boolean) => ({
  from: '123 Main St, Austin, TX',
  to: '9 Oak Ave, Dallas, TX',
  date: '2027-01-15',
  distanceMiles: 50,
  originFloor: floor,
  originElevator: elevator,
  destinationFloor: 1,
  destinationElevator: true,
})

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => vi.restoreAllMocks())

describe('local development with no AI credentials (offline mock)', () => {
  it('walks chat -> analyze -> price, labelling every answer as mock', async () => {
    const messages: { id: string; role: string; content: string }[] = []
    let res = await post(chat, { messages }, env())
    expect(res.status).toBe(200)
    expect(res.headers.get(MODE_HEADER)).toBe('mock')

    let finished = false
    const finishedFlags: boolean[] = []
    let details: Record<string, unknown> = {}
    for (const answer of ANSWERS) {
      messages.push({ id: String(messages.length), role: 'user', content: answer })
      res = await post(chat, { messages, moveDetails: details }, env())
      expect(res.status).toBe(200)
      expect(res.headers.get(MODE_HEADER)).toBe('mock')
      const json = (await res.json()) as { reply: string; moveDetails: Record<string, unknown>; finished: boolean }
      // MOVERS-11: the bubble text never carries the JSON block
      expect(json.reply).not.toMatch(/[{}]|```/)
      finished = json.finished
      details = json.moveDetails
      finishedFlags.push(finished)
      messages.push({ id: String(messages.length), role: 'assistant', content: json.reply })
    }
    expect(finishedFlags.slice(0, -1).every((f) => f === false)).toBe(true)
    expect(finished).toBe(true)
    expect(details).toMatchObject({
      from: expect.stringContaining('Austin'),
      to: expect.stringContaining('Dallas'),
      date: '2027-01-15',
      originFloor: 3,
      originElevator: false,
      destinationFloor: 1,
      destinationElevator: true,
    })
    expect(details.distanceMiles).toBeGreaterThan(0)

    res = await post(analyze, { imageUrls: ['http://localhost/api/images/a.png'] }, env())
    expect(res.status).toBe(200)
    expect(res.headers.get(MODE_HEADER)).toBe('mock')
    const analysis = (await res.json()) as {
      items: unknown[]
      totalVolumeCubicFeet: number
      specialHandling: { item: string }[]
      possibleDuplicates: unknown[]
      unseenAreas: string[]
    }
    expect(Array.isArray(analysis.items)).toBe(true)
    expect(analysis.totalVolumeCubicFeet).toBeGreaterThan(0)
    // MOVERS-23: the extensions are present and validated
    expect(analysis.specialHandling[0]?.item).toBe('upright piano')
    expect(Array.isArray(analysis.possibleDuplicates)).toBe(true)
    expect(analysis.unseenAreas.length).toBeGreaterThan(0)

    const totals: number[] = []
    for (const [floor, elevator] of [
      [1, false],
      [4, false],
      [4, true],
    ] as const) {
      res = await post(price, { analysis, moveDetails: moveDetails(floor, elevator) }, env())
      expect(res.status).toBe(200)
      expect(res.headers.get(MODE_HEADER)).toBe('mock')
      const { price: result } = (await res.json()) as {
        price: { total: number; low: number; high: number; confidence: string; breakdown: Record<string, number> }
      }
      const sum = Object.values(result.breakdown).reduce((a, b) => a + b, 0)
      expect(result.total).toBe(sum)
      // MOVERS-8: a range around the total; MOVERS-23: special items are a breakdown line
      expect(result.low).toBeLessThanOrEqual(result.total)
      expect(result.high).toBeGreaterThanOrEqual(result.total)
      expect(result.high).toBeGreaterThan(result.low)
      expect(result.breakdown['Special handling: upright piano']).toBeGreaterThan(0)
      totals.push(result.total)
    }
    // stairs cost more than no stairs; an elevator removes the surcharge
    expect(totals[1]).toBeGreaterThan(totals[0] as number)
    expect(totals[2]).toBeLessThan(totals[1] as number)
  })

  it('rejects an invalid price request with 400', async () => {
    const res = await post(price, { analysis: { items: [] }, moveDetails: {} }, env())
    expect(res.status).toBe(400)
  })

  it('confidence follows the unknown move details and widens the range', async () => {
    const analysisRes = await post(analyze, { imageUrls: ['http://localhost/api/images/a.png'] }, env())
    const analysis = await analysisRes.json()
    const known = (await (await post(price, { analysis, moveDetails: moveDetails(1, true) }, env())).json()) as {
      price: { total: number; low: number; high: number; confidence: string }
    }
    const unknown = (await (
      await post(
        price,
        {
          analysis,
          moveDetails: {
            ...moveDetails(1, true),
            distanceMiles: null,
            originFloor: null,
            destinationFloor: null,
            originElevator: null,
            destinationElevator: null,
          },
        },
        env(),
      )
    ).json()) as { price: { total: number; low: number; high: number; confidence: string } }
    // the mock says medium, and the fewer fields are known the lower confidence may go, never higher
    expect(['high', 'medium', 'low']).toContain(known.price.confidence)
    expect(unknown.price.confidence).toBe('low')
    const spread = (p: { total: number; low: number; high: number }) => (p.high - p.low) / p.total
    expect(spread(unknown.price)).toBeGreaterThanOrEqual(spread(known.price) - 0.01)
  })

  it('serves the sample move from cache on the second call (MOVERS-16)', async () => {
    const body = { imageUrls: ['http://localhost/api/images/sample-1.png'], sample: true }
    const first = await post(analyze, body, env())
    expect(first.status).toBe(200)
    const second = await post(analyze, body, env())
    expect(second.status).toBe(200)
    expect(second.headers.get('x-movers-sample-cache')).toBe('hit')
    expect(await second.json()).toEqual(await first.json())

    const own = await post(analyze, { imageUrls: body.imageUrls }, env())
    expect(own.headers.get('x-movers-sample-cache')).toBeNull()
  })
})

describe('anywhere but local development: the mock is never served', () => {
  const unsafe = [
    ['production', { ENV: 'production' }],
    ['production with AI_MODE=mock', { ENV: 'production', AI_MODE: 'mock' }],
    ['preview', { ENV: 'preview' }],
    ['ENV missing', { ENV: undefined }],
  ] as const

  for (const [name, overrides] of unsafe) {
    it(`${name}: all three routes fail without AI credentials and carry no mode header`, async () => {
      // never reach the real gateway from a test
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('Unauthorized', { status: 401 })),
      )
      const bindings = env(overrides)
      const calls = [
        post(chat, { messages: [] }, bindings),
        post(analyze, { imageUrls: ['http://localhost/api/images/a.png'] }, bindings),
        post(
          price,
          {
            analysis: { items: [], totalVolumeCubicFeet: 10, estimatedBoxes: { min: 1, max: 1 }, boxesExplanation: '' },
            moveDetails: moveDetails(1, true),
          },
          bindings,
        ),
      ]
      for (const res of await Promise.all(calls)) {
        expect(res.headers.get(MODE_HEADER)).not.toBe('mock')
        const text = await res.text()
        expect(text).not.toMatch(/Demo data|mock/i)
      }
      vi.unstubAllGlobals()
    })
  }

  it('a failing gateway call in preview is an error, not a mocked answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bad request', { status: 400 })),
    )
    const res = await post(chat, { messages: [] }, env({ ENV: 'preview', CF_AIG_TOKEN: 'real-token' }))
    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(res.headers.get(MODE_HEADER)).not.toBe('mock')
    vi.unstubAllGlobals()
  })
})
