// @vitest-environment node
/**
 * Route-level checks of the AI honesty and production-safety rules, through the real Hono routes with fake bindings:
 * every AI answer is labelled with `x-movers-ai-mode`, the mock is served only in local development, and a
 * production-like environment without AI credentials returns an error instead of mocked data.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

// biome-ignore lint/suspicious/noExplicitAny: Hono's app type is not needed for these calls
function post(app: any, body: unknown, bindings: unknown) {
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
const moveInfo = (floor: number, elevator: boolean) => ({
  distance_miles: 50,
  origin_floor: floor,
  origin_has_elevator: elevator,
  destination_floor: 1,
  destination_has_elevator: true,
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
    for (const answer of ANSWERS) {
      messages.push({ id: String(messages.length), role: 'user', content: answer })
      res = await post(chat, { messages }, env())
      expect(res.status).toBe(200)
      expect(res.headers.get(MODE_HEADER)).toBe('mock')
      const json = (await res.json()) as { content: string; finished: boolean }
      finished = json.finished
      finishedFlags.push(finished)
      messages.push({ id: String(messages.length), role: 'assistant', content: json.content })
    }
    expect(finishedFlags.slice(0, -1).every((f) => f === false)).toBe(true)
    expect(finished).toBe(true)

    res = await post(analyze, { imageUrls: ['http://localhost/api/images/a.png'] }, env())
    expect(res.status).toBe(200)
    expect(res.headers.get(MODE_HEADER)).toBe('mock')
    const analysis = (await res.json()) as { items: unknown[]; totalVolumeCubicFeet: number }
    expect(Array.isArray(analysis.items)).toBe(true)
    expect(analysis.totalVolumeCubicFeet).toBeGreaterThan(0)

    const totals: number[] = []
    for (const [floor, elevator] of [
      [1, false],
      [4, false],
      [4, true],
    ] as const) {
      res = await post(price, { analysis, moveInfo: moveInfo(floor, elevator) }, env())
      expect(res.status).toBe(200)
      expect(res.headers.get(MODE_HEADER)).toBe('mock')
      const { price: result } = (await res.json()) as { price: { total: number; breakdown: Record<string, number> } }
      const sum = Object.values(result.breakdown).reduce((a, b) => a + b, 0)
      expect(result.total).toBe(sum)
      totals.push(result.total)
    }
    // stairs cost more than no stairs; an elevator removes the surcharge
    expect(totals[1]).toBeGreaterThan(totals[0] as number)
    expect(totals[2]).toBeLessThan(totals[1] as number)
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
            analysis: { items: [], totalVolumeCubicFeet: 10, estimatedBoxes: 1, boxesExplanation: '' },
            moveInfo: moveInfo(1, true),
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
