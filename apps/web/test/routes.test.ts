// @vitest-environment node
/**
 * Route-level checks of the AI honesty and production-safety rules, through the real Hono routes with fake bindings:
 * every AI answer is labelled with `x-movers-ai-mode`, the mock is served only in local development, and a
 * production-like environment without AI credentials returns an error instead of mocked data.
 */
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Bindings } from '../functions/api/_lib/types'
import { EMPTY_MOVE_DETAILS } from '../src/data'

const sessionId = '11111111-1111-4111-8111-111111111111'
const receiptA = 'a'.repeat(43)
const receiptB = 'b'.repeat(43)
import { png, truncatedContainers } from './image-fixtures'
const hashes = new Map<string, string>()
for (const [receipt, key] of [
  [receiptA, 'a.png'],
  [receiptB, 'b.png'],
]) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(receipt))
  hashes.set([...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join(''), key)
}
const DB = {
  prepare: (sql: string) => ({
    first: async () => null,
    bind: (hash: string) => ({
      first: async () =>
        sql.includes('photo_receipts')
          ? { session_id: sessionId, object_key: hashes.get(hash), expires_at: '2099-01-01T00:00:00.000Z' }
          : null,
    }),
  }),
}
const analyzeBody = (urls = ['http://localhost/api/images/a.png'], sample = false) => ({
  sessionId,
  moveDetails: EMPTY_MOVE_DETAILS,
  photoRefs: urls.map((url) => ({ url, receipt: sample ? null : url.endsWith('b.png') ? receiptB : receiptA })),
  sample,
})
import { sampleCacheKey } from '../functions/api/_lib/sample-cache'
import analyze from '../functions/api/_routes/analyze'
import chat from '../functions/api/_routes/chat'
import images from '../functions/api/_routes/images'
import price from '../functions/api/_routes/price'

const MODE_HEADER = 'x-movers-ai-mode'

const bucket = {
  get: async () => ({
    arrayBuffer: async () => png.buffer,
    httpMetadata: { contentType: 'image/png' },
  }),
}

function env(overrides: Record<string, unknown> = {}) {
  return {
    ENV: 'development',
    PRICE_PER_BOX: '50',
    CF_AIG_TOKEN: '',
    MOVERS_BUCKET: bucket,
    MOVERS_DB: DB,
    ...overrides,
  }
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

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('photo upload availability', () => {
  it('returns 503 without D1 instead of creating an unverified object', async () => {
    const form = new FormData()
    form.set('sessionId', '11111111-1111-4111-8111-111111111111')
    form.set('images', new File(['photo'], 'room.jpg', { type: 'image/jpeg' }))
    const put = vi.fn()
    const res = await images.request(
      '/upload',
      { method: 'POST', body: form },
      env({ MOVERS_BUCKET: { put }, MOVERS_DB: undefined }),
    )
    expect(res.status).toBe(503)
    expect(put).not.toHaveBeenCalled()
  })
})

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

    res = await post(analyze, analyzeBody(), env())
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
      expect(Object.values(result.breakdown).every((amount) => Number.isFinite(amount))).toBe(true)
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

  it('treats omitted legacy review as unknown coverage and emits concrete confidence reasons', async () => {
    const analysis = {
      items: [{ type: 'sofa', count: 1 }],
      totalVolumeCubicFeet: 80,
      estimatedBoxes: { min: 2, max: 4 },
      boxesExplanation: '',
      specialHandling: [],
      possibleDuplicates: [],
      unseenAreas: [],
    }
    const legacy = await post(price, { analysis, moveDetails: moveDetails(1, true) }, env())
    expect(legacy.status).toBe(200)
    const body = (await legacy.json()) as { price: { confidence: string; confidenceReasons: string[] } }
    expect(body.price.confidence).toBe('low')
    expect(body.price.confidenceReasons.join(' ')).toMatch(/whole move|garage/i)
    const reviewed = await post(
      price,
      {
        analysis,
        moveDetails: moveDetails(1, true),
        review: { followUps: { garage: false, closets: false, appliances: false }, wholeMoveCovered: true },
      },
      env(),
    )
    expect(reviewed.status).toBe(200)
    const reviewedBody = (await reviewed.json()) as { price: { confidence: string; confidenceReasons: string[] } }
    expect(reviewedBody.price.confidenceReasons).toEqual(expect.any(Array))
    expect(reviewedBody.price.confidence).not.toBe('low')
  })

  it('rejects an invalid price request with 400', async () => {
    const res = await post(price, { analysis: { items: [] }, moveDetails: {} }, env())
    expect(res.status).toBe(400)
  })

  it('confidence follows the unknown move details and widens the range', async () => {
    const analysisRes = await post(analyze, analyzeBody(), env())
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

  it('uses a new sample cache namespace after the analysis changes', async () => {
    expect(await sampleCacheKey('analyze', { count: 1 })).toContain('/v5/analyze/')
  })

  it('serves the sample move from cache on the second call (MOVERS-16)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(png, { headers: { 'content-type': 'image/png' } })),
    )
    const body = analyzeBody(['http://localhost/sample/living-room.jpg'], true)
    const first = await post(analyze, body, env())
    expect(first.status).toBe(200)
    const second = await post(analyze, body, env())
    expect(second.status).toBe(200)
    expect(second.headers.get('x-movers-sample-cache')).toBe('hit')
    expect(await second.json()).toEqual(await first.json())

    const own = await post(analyze, analyzeBody(), env())
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
        post(analyze, analyzeBody(), bindings),
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

describe('photo linkage route boundary', () => {
  it.each(truncatedContainers)(
    'excludes malformed $name from a mixed batch without aborting valid inventory',
    async ({ bytes, mimeType }) => {
      const validDataUrl = `data:image/png;base64,${btoa(String.fromCharCode(...png))}`
      const run = vi.fn(async (_model: string, input: unknown) => {
        const url = (input as { messages: { content: { image_url?: { url: string } }[] }[] }).messages[0]?.content[1]
          ?.image_url?.url
        if (url !== validDataUrl) throw new Error('Malformed image reached provider')
        return {
          response: JSON.stringify({
            verdict: 'relevant',
            reason: 'Moving furniture',
            inventory: { items: [{ type: 'sofa', count: 1 }], total_volume_cubic_feet: 100 },
          }),
        }
      })
      const get = vi.fn(async (key: string) =>
        key === 'b.png'
          ? { arrayBuffer: async () => bytes.buffer, httpMetadata: { contentType: mimeType } }
          : bucket.get(),
      )
      const res = await post(
        analyze,
        analyzeBody(['http://localhost/api/images/a.png', 'http://localhost/api/images/b.png']),
        env({ ENV: 'preview', AI: { run }, MOVERS_BUCKET: { get } }),
      )
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({
        items: [{ type: 'sofa', count: 1 }],
        photoLinkStatuses: [
          expect.objectContaining({ status: 'eligible' }),
          expect.objectContaining({ status: 'unavailable' }),
        ],
      })
      expect(run).toHaveBeenCalledTimes(1)
      expect(console.error).not.toHaveBeenCalled()
    },
  )
  it('rejects legacy requests safely without reading bytes or calling AI', async () => {
    const get = vi.fn()
    const run = vi.fn()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const res = await post(
      analyze,
      { imageUrls: ['https://other.example/private.jpg'] },
      env({ MOVERS_BUCKET: { get }, AI: { run } }),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'PHOTO_REUPLOAD_REQUIRED' })
    expect(get).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('preserves mixed exclusions in input order and sends only eligible bytes to AI without logging sensitive data', async () => {
    const run = vi.fn(async () => ({
      response: JSON.stringify({
        verdict: 'relevant',
        reason: 'Moving furniture',
        inventory: { items: [{ type: 'sofa', count: 1 }], total_volume_cubic_feet: 100 },
      }),
    }))
    const get = vi.fn(async (key: string) => (key === 'b.png' ? null : bucket.get()))
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const body = analyzeBody([
      'https://other.example/private.jpg',
      'http://localhost/api/images/a.png',
      'http://localhost/api/images/b.png',
    ])
    const res = await post(analyze, body, env({ AI: { run }, MOVERS_BUCKET: { get } }))
    expect(res.status).toBe(200)
    expect(((await res.json()) as { photoLinkStatuses: unknown }).photoLinkStatuses).toEqual([
      expect.objectContaining({ url: body.photoRefs[0]?.url, status: 'unlinked' }),
      expect.objectContaining({
        url: body.photoRefs[1]?.url,
        status: 'eligible',
        reason: expect.stringContaining('relevance has not been assessed'),
      }),
      expect.objectContaining({ url: body.photoRefs[2]?.url, status: 'unavailable' }),
    ])
    expect(run).toHaveBeenCalledTimes(1)
    expect(get.mock.calls).toEqual([['a.png'], ['b.png']])
    expect(fetch).not.toHaveBeenCalled()
    expect(console.warn).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
  })
  it('returns NO_USABLE_PHOTOS for all excluded and never calls AI or external fetch', async () => {
    const run = vi.fn()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const res = await post(
      analyze,
      analyzeBody(['http://127.0.0.1:5611/api/images/a.png', 'https://other.example/a.jpg']),
      env({ AI: { run } }),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      code: 'NO_USABLE_PHOTOS',
      photoLinkStatuses: [
        expect.objectContaining({ status: 'unlinked' }),
        expect.objectContaining({ status: 'unlinked' }),
      ],
    })
    expect(run).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('revalidates sample links before cached results and separates canonical sample identity', async () => {
    const fetch = vi.fn(async () => new Response(png, { headers: { 'content-type': 'image/png' } }))
    vi.stubGlobal('fetch', fetch)
    const living = analyzeBody(['http://localhost/sample/living-room.jpg'], true)
    const kitchen = analyzeBody(['http://localhost/sample/kitchen.jpg'], true)
    const first = await post(analyze, living, env())
    expect(first.status).toBe(200)
    const different = await post(analyze, kitchen, env())
    expect(different.headers.get('x-movers-sample-cache')).toBeNull()
    fetch.mockResolvedValueOnce(new Response(null, { status: 404 }))
    const missing = await post(analyze, living, env())
    expect(missing.status).toBe(400)
    expect(await missing.json()).toMatchObject({ code: 'NO_USABLE_PHOTOS' })
  })
})

describe('semantic photo route responses', () => {
  it('returns all assessment statuses and only uncertain candidates without leaking model reason, details or receipts', async () => {
    const answers = ['relevant', 'uncertain'].map((verdict) =>
      JSON.stringify({
        verdict,
        reason: 'PRIVATE model echoed customer details',
        inventory: {
          items: [{ type: verdict === 'relevant' ? 'sofa' : 'chair', count: 1 }],
          total_volume_cubic_feet: 80,
          secret: 'PRIVATE',
        },
      }),
    )
    const AI = { run: vi.fn(async () => ({ response: answers.shift() })) }
    const body = {
      ...analyzeBody([
        'http://localhost/api/images/a.png',
        'http://localhost/api/images/b.png',
        'https://outside.invalid/photo',
      ]),
      moveDetails: { ...EMPTY_MOVE_DETAILS, from: 'PRIVATE confirmed details' },
      messages: [{ content: 'CHAT MUST NOT REACH VISION' }],
    }
    const res = await post(analyze, body, env({ ENV: 'preview', AI }))
    expect(res.status).toBe(200)
    const text = await res.text()
    const result = JSON.parse(text)
    expect(result.items).toEqual([{ type: 'sofa', count: 1 }])
    expect(result.photoAssessments.map((p: { status: string }) => p.status)).toEqual([
      'relevant',
      'uncertain',
      'unlinked',
    ])
    expect(result.photoAssessments[1].candidates.items).toEqual([{ type: 'chair', count: 1 }])
    expect(result.photoAssessments[0].candidates).toBeUndefined()
    expect(text).not.toMatch(/PRIVATE|receipt/)
    expect(JSON.stringify(AI.run.mock.calls)).not.toContain('CHAT MUST NOT REACH VISION')
  })

  it.each(['unrelated', 'uncertain', 'empty'])(
    'returns retryable NO_USABLE_PHOTOS with %s assessments',
    async (kind) => {
      const AI = {
        run: vi.fn(async () => ({
          response: JSON.stringify({
            verdict: kind === 'empty' ? 'relevant' : kind,
            reason: 'PRIVATE',
            inventory: { items: kind === 'empty' ? [] : [{ type: 'chair', count: 1 }], total_volume_cubic_feet: 0 },
          }),
        })),
      }
      const res = await post(analyze, analyzeBody(), env({ ENV: 'preview', AI }))
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({
        code: 'NO_USABLE_PHOTOS',
        photoAssessments: [{ status: kind === 'empty' ? 'relevant' : kind }],
      })
    },
  )

  it('returns sanitized 503 and safe statuses for explicitly selected provider failures', async () => {
    const AI = {
      run: vi.fn(async () => {
        throw new Error('PRIVATE provider details')
      }),
    }
    const res = await post(analyze, analyzeBody(), env({ AI_MODE: 'binding', AI }))
    expect(res.status).toBe(503)
    expect(res.headers.get(MODE_HEADER)).toBeNull()
    const text = await res.text()
    expect(text).not.toMatch(/PRIVATE|receipt/)
    expect(JSON.parse(text)).toMatchObject({ photoAssessments: [{ status: 'unavailable' }] })
    expect(AI.run).toHaveBeenCalledTimes(1)
  })

  it('separates sample cache by resolved vision backend, model, revision, details and canonical identities, pinning settings per request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(png, { headers: { 'content-type': 'image/png' } })),
    )
    const run = vi.fn(async () => ({
      response: JSON.stringify({
        verdict: 'relevant',
        reason: 'furniture',
        inventory: { items: [{ type: 'sofa', count: 1 }], total_volume_cubic_feet: 80 },
      }),
    }))
    let revision = 301
    const roles = {
      chat: { backend: 'binding', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
      price: { backend: 'binding', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
      vision: { backend: 'binding', model: '@cf/meta/llama-3.2-11b-vision-instruct' },
    }
    const read = vi.fn(async () => ({ revision, roles_json: JSON.stringify(roles) }))
    const bindings = env({ AI: { run }, MOVERS_DB: { prepare: () => ({ first: read }) } })
    const body = analyzeBody(['http://localhost/sample/bedroom.jpg', 'http://localhost/sample/kitchen.jpg'], true)
    const first = await post(analyze, body, bindings)
    expect(first.status).toBe(200)
    expect(read).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledTimes(2)
    const hit = await post(analyze, body, bindings)
    expect(hit.headers.get('x-movers-sample-cache')).toBe('hit')
    revision++
    expect((await post(analyze, body, bindings)).headers.get('x-movers-sample-cache')).toBeNull()
    expect(run).toHaveBeenCalledTimes(4)
    const changed = { ...body, moveDetails: { ...EMPTY_MOVE_DETAILS, from: 'confirmed new origin' } }
    expect((await post(analyze, changed, bindings)).headers.get('x-movers-sample-cache')).toBeNull()
    expect(run).toHaveBeenCalledTimes(6)
    roles.vision.backend = 'gateway'
    const unavailable = await post(analyze, body, bindings)
    expect(unavailable.status).toBe(503)
    expect(unavailable.headers.get('x-movers-sample-cache')).toBeNull()
  })
})

describe('photo analysis through the Workers AI binding (one image per call)', () => {
  const inventory = (type: string, volume: number) =>
    JSON.stringify({
      verdict: 'relevant',
      reason: 'Moving furniture',
      inventory: { items: [{ type, count: 1 }], total_volume_cubic_feet: volume, unseen_areas: ['garage'] },
    })

  it('analyzes each photo separately, retries a photo whose answer is not JSON, and merges the inventories', async () => {
    const answers = [inventory('couch', 100), 'Sorry, I cannot see a kitchen here.', inventory('fridge', 60)]
    const AI = { run: vi.fn(async () => ({ response: answers.shift() ?? '' })) }
    const bindings = env({ ENV: 'preview', AI })

    const res = await post(
      analyze,
      analyzeBody(['http://localhost/api/images/a.png', 'http://localhost/api/images/b.png']),
      bindings,
    )
    expect(res.status).toBe(200)
    expect(res.headers.get(MODE_HEADER)).toBe('binding')
    expect(AI.run).toHaveBeenCalledTimes(3)
    const body = (await res.json()) as { items: unknown; totalVolumeCubicFeet: number; unseenAreas: string[] }
    expect(body.items).toEqual([
      { type: 'sofa', count: 1 },
      { type: 'fridge', count: 1 },
    ])
    expect(body.totalVolumeCubicFeet).toBe(160)
    expect(body.unseenAreas).toEqual(['garage'])
  })

  it('validates a normalized one-photo alias in the response', async () => {
    const AI = { run: vi.fn(async () => ({ response: inventory('couch', 100) })) }
    const res = await post(analyze, analyzeBody(), env({ ENV: 'preview', AI }))
    expect(res.status).toBe(200)
    expect((await res.json()) as { items: unknown }).toMatchObject({ items: [{ type: 'sofa', count: 1 }] })
  })

  it.each(['constructor', '__proto__'])('returns a valid inventory for the %s label', async (type) => {
    const AI = { run: vi.fn(async () => ({ response: inventory(type, 100) })) }
    const res = await post(analyze, analyzeBody(), env({ ENV: 'preview', AI }))
    expect(res.status).toBe(200)
    expect((await res.json()) as { items: unknown }).toMatchObject({ items: [{ type, count: 1 }] })
  })

  it('reports ANALYSIS_FAILED when a photo is still not analyzed after the retry', async () => {
    const AI = { run: vi.fn(async () => ({ response: 'no JSON here' })) }
    const res = await post(analyze, analyzeBody(), env({ ENV: 'preview', AI }))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('ANALYSIS_FAILED')
    expect(AI.run).toHaveBeenCalledTimes(2)
  })
})
