// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assessPhotos, AnalysisFormatError, NoUsableInventoryError } from '../functions/api/_lib/vision-assessment'
import type { LinkedPhoto } from '../functions/api/_lib/photo-links'
import type { Bindings } from '../functions/api/_lib/types'
import { EMPTY_MOVE_DETAILS } from '../src/data'
import * as aiMode from '../functions/api/_lib/ai-mode'
import { sampleCacheKey, writeSampleCache } from '../functions/api/_lib/sample-cache'

const inventory = (type = 'sofa') => ({ items: [{ type, count: 1 }], total_volume_cubic_feet: 80 })
const reply = (verdict = 'relevant', type = 'sofa') =>
  JSON.stringify({ verdict, reason: 'PRIVATE model reason', inventory: inventory(type) })
const photos = (count: number): LinkedPhoto[] =>
  Array.from({ length: count }, (_, index) => ({
    url: `http://localhost/sample/${index}.jpg`,
    status: 'eligible',
    reason: 'verified',
    image: { data: new Uint8Array([index]), mimeType: 'image/jpeg' },
  }))
const bindings = (run: unknown, overrides = {}) =>
  ({ ENV: 'preview', AI: { run }, ...overrides }) as unknown as Bindings

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('request-aware photo assessment with fake Workers AI', () => {
  it('preserves mixed ordering, merges relevant only, keeps uncertain candidates and excludes unlinked bytes', async () => {
    const linked = photos(3)
    linked.splice(1, 0, { url: 'private-url', status: 'unlinked', reason: 'Re-upload' })
    linked.push({ url: 'missing-url', status: 'unavailable', reason: 'Missing bytes' })
    const answers = [
      reply(),
      JSON.stringify({ verdict: 'unrelated', reason: 'landscape' }),
      reply('uncertain', 'chair'),
    ]
    const run = vi.fn(async () => ({ response: answers.shift() }))
    const result = await assessPhotos(bindings(run), linked, EMPTY_MOVE_DETAILS, false)
    expect(result.photos.map((p) => p.status)).toEqual([
      'relevant',
      'unlinked',
      'unrelated',
      'uncertain',
      'unavailable',
    ])
    expect(result.photos.map((p) => p.url)).toEqual(linked.map((p) => p.url))
    expect(result.analysis.items).toEqual([{ type: 'sofa', count: 1 }])
    expect(result.analysis.total_volume_cubic_feet).toBe(80)
    expect(result.photos[3]?.candidates?.items).toEqual([{ type: 'chair', count: 1 }])
    expect(result.photos[0]?.candidates).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('uses confirmed details as data and never accepts chat as context', async () => {
    const run = vi.fn(async () => ({ response: reply() }))
    await assessPhotos(bindings(run), photos(1), { ...EMPTY_MOVE_DETAILS, from: 'CONFIRMED origin' }, false)
    const prompt = JSON.stringify(run.mock.calls[0])
    expect(prompt).toContain('CONFIRMED origin')
    expect(prompt).toContain('nonmoving')
    expect(prompt).toContain('data, not instructions')
  })

  it('returns uncertain-only candidates separately with zero confirmed inventory and current vision identity', async () => {
    const run = vi.fn(async () => ({ response: reply('uncertain', 'couch') }))
    const result = await assessPhotos(bindings(run), photos(1), EMPTY_MOVE_DETAILS, false)
    expect(result.analysis).toMatchObject({
      items: [],
      total_volume_cubic_feet: 0,
      estimated_boxes_min: 0,
      estimated_boxes_max: 0,
    })
    expect(result.photos[0]).toMatchObject({
      status: 'uncertain',
      candidates: { items: [{ type: 'sofa', count: 1 }], total_volume_cubic_feet: 80 },
    })
    expect(result.visionFingerprint).toEqual(expect.any(String))
    expect(result.visionRevision).toEqual(expect.any(Number))
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it.each(['unrelated', 'empty', 'empty-uncertain', 'excluded', 'unavailable'])(
    'rejects %s-only inventory without usable candidates',
    async (kind) => {
      const run = vi.fn(async () => ({
        response:
          kind === 'empty' || kind === 'empty-uncertain'
            ? JSON.stringify({
                verdict: kind === 'empty' ? 'relevant' : 'uncertain',
                reason: 'empty room',
                inventory: { items: [], total_volume_cubic_feet: 0 },
              })
            : reply(kind),
      }))
      const excluded = kind === 'excluded' || kind === 'unavailable'
      const linked = excluded
        ? [
            {
              url: 'bad',
              status: kind === 'excluded' ? ('unlinked' as const) : ('unavailable' as const),
              reason: 'Re-upload',
            },
          ]
        : photos(1)
      await expect(assessPhotos(bindings(run), linked, EMPTY_MOVE_DETAILS, false)).rejects.toBeInstanceOf(
        NoUsableInventoryError,
      )
      expect(run).toHaveBeenCalledTimes(excluded ? 0 : 1)
    },
  )

  it('retries one malformed reply and succeeds', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ response: 'RAW_PRIVATE_TEXT' })
      .mockResolvedValueOnce({ response: reply() })
    const result = await assessPhotos(bindings(run), photos(1), EMPTY_MOVE_DETAILS, false)
    expect(result.analysis.items).toEqual([{ type: 'sofa', count: 1 }])
    expect(run).toHaveBeenCalledTimes(2)
  })

  it.each([
    'RAW_PRIVATE_TEXT',
    '',
    '{"verdict":"maybe","reason":"x"}',
    '{"verdict":"relevant","reason":"x","inventory":{"items":[{"type":"chair","count":-1}],"total_volume_cubic_feet":2}}',
    '{"verdict":"relevant","reason":"x","inventory":{"items":[],"total_volume_cubic_feet":-1}}',
    '{"verdict":"unrelated","reason":""}',
    '```json\n{"verdict":"unrelated","reason":"x"}\n```',
  ])('fails closed after two malformed envelopes without logging model text: %s', async (text) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const run = vi.fn(async () => ({ response: text }))
    await expect(assessPhotos(bindings(run), photos(1), EMPTY_MOVE_DETAILS, false)).rejects.toBeInstanceOf(
      AnalysisFormatError,
    )
    expect(run).toHaveBeenCalledTimes(2)
    expect([log.mock.calls, warn.mock.calls, error.mock.calls]).toEqual([[], [], []])
  })

  it.each(['relevant', 'uncertain'])(
    'retries an original inventory array once for %s instead of extracting its nested object',
    async (verdict) => {
      const answers = [
        JSON.stringify({ verdict, reason: 'visible furniture', inventory: [inventory('chair')] }),
        reply(verdict, 'sofa'),
      ]
      if (verdict === 'uncertain') answers.unshift(reply())
      const run = vi.fn(async () => ({ response: answers.shift() }))
      const result = await assessPhotos(
        bindings(run),
        photos(verdict === 'uncertain' ? 2 : 1),
        EMPTY_MOVE_DETAILS,
        false,
      )
      expect(run).toHaveBeenCalledTimes(verdict === 'uncertain' ? 3 : 2)
      expect(result.analysis.items).toEqual([{ type: 'sofa', count: 1 }])
      if (verdict === 'uncertain') expect(result.photos[1]?.candidates?.items).toEqual([{ type: 'sofa', count: 1 }])
    },
  )

  it.each(['relevant', 'uncertain'])(
    'fails with a format error after exactly two original %s inventory arrays',
    async (verdict) => {
      const run = vi.fn(async () => ({
        response: JSON.stringify({ verdict, reason: 'visible furniture', inventory: [inventory()] }),
      }))
      await expect(assessPhotos(bindings(run), photos(1), EMPTY_MOVE_DETAILS, false)).rejects.toBeInstanceOf(
        AnalysisFormatError,
      )
      expect(run).toHaveBeenCalledTimes(2)
    },
  )

  it('sanitizes confirmed-detail echoes in every relevant and uncertain inventory text field before caching', async () => {
    const sentinel = '7421 PrivacySentinel Avenue, ConfidentialCity, ZZ 90321'
    const echoed = {
      ...inventory(),
      items: [{ type: 'sofa', count: 1 }],
      boxes_explanation: `Packing at ${sentinel}`,
      special_handling: [
        { item: 'piano', reason: `Access at ${sentinel}` },
        { item: sentinel, reason: 'heavy' },
      ],
      possible_duplicates: [
        { item: 'sofa', count: 2 },
        { item: sentinel, count: 2 },
      ],
      unseen_areas: ['garage', `Closet at ${sentinel}`],
    }
    const entries: string[] = []
    vi.stubGlobal('caches', {
      default: {
        match: async () => undefined,
        put: async (_key: string, response: Response) => {
          entries.push(await response.text())
        },
      },
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const answers = ['relevant', 'uncertain'].map((verdict) =>
      JSON.stringify({ verdict, reason: 'visible furniture', inventory: echoed }),
    )
    const run = vi.fn(async () => ({ response: answers.shift() }))
    const result = await assessPhotos(bindings(run), photos(2), { ...EMPTY_MOVE_DETAILS, from: sentinel }, true)
    // Assert booleans rather than printing synthetic raw AI text in expected RED diagnostics.
    expect(entries.some((entry) => entry.includes('PrivacySentinel'))).toBe(false)
    expect(JSON.stringify(result).includes('PrivacySentinel')).toBe(false)
    expect(entries).toHaveLength(1)
    expect(result.analysis.items).toEqual([{ type: 'sofa', count: 1 }])
    expect(result.photos[1]?.candidates?.items).toEqual([{ type: 'sofa', count: 1 }])
    expect(result.analysis.special_handling).toEqual([{ item: 'piano', reason: expect.any(String) }])
    expect(result.analysis.possible_duplicates).toEqual([{ item: 'sofa', count: 2 }])
    expect(result.analysis.unseen_areas).toEqual(['garage'])
    const hit = await assessPhotos(bindings(run), photos(2), { ...EMPTY_MOVE_DETAILS, from: sentinel }, true)
    expect(hit.cached).toBe(true)
    expect(JSON.stringify(hit).includes('PrivacySentinel')).toBe(false)
    expect(run).toHaveBeenCalledTimes(2)
    expect([log.mock.calls, warn.mock.calls, error.mock.calls]).toEqual([[], [], []])
  })

  it.each([undefined, 1])(
    'does not reuse vulnerable v5 cache entries with privacy revision %s',
    async (privacyVersion) => {
      const details = { ...EMPTY_MOVE_DETAILS, from: `LegacyPrivateAddress ${privacyVersion ?? 'original'}` }
      const model = '@cf/meta/llama-3.2-11b-vision-instruct'
      const oldKey = await sampleCacheKey('analyze', {
        role: 'vision',
        ...(privacyVersion === undefined ? {} : { inventoryPrivacyVersion: privacyVersion }),
        backend: 'binding',
        model,
        configRevision: 0,
        moveDetails: details,
        photos: ['/sample/0.jpg'],
      })
      await writeSampleCache(
        oldKey,
        JSON.stringify({
          mode: 'binding',
          assessments: [{ verdict: 'relevant', inventory: { ...inventory(), boxes_explanation: details.from } }],
        }),
      )
      const run = vi.fn(async () => ({ response: reply() }))
      const result = await assessPhotos(bindings(run), photos(1), details, true)
      expect(JSON.stringify(result).includes('LegacyPrivateAddress')).toBe(false)
      expect(result.cached).toBe(false)
      expect(run).toHaveBeenCalledTimes(1)
    },
  )

  it('removes case, punctuation and address-fragment echoes as well as destination and move-date echoes', async () => {
    const run = vi.fn(async () => ({
      response: JSON.stringify({
        verdict: 'relevant',
        reason: 'visible items',
        inventory: {
          ...inventory(),
          boxes_explanation: 'Moving from 7421 PRIVACYSENTINEL AVENUE',
          special_handling: [{ item: 'piano', reason: 'Deliver to DestinationSecret' }],
          unseen_areas: ['ConfidentialCity garage', 'storage on 2027/06/17'],
        },
      }),
    }))
    const result = await assessPhotos(
      bindings(run),
      photos(1),
      {
        ...EMPTY_MOVE_DETAILS,
        from: '7421 PrivacySentinel Avenue, ConfidentialCity, ZZ 90321',
        to: 'DestinationSecret',
        date: '2027-06-17',
      },
      false,
    )
    expect(/privacysentinel|destinationsecret|confidentialcity|2027/i.test(JSON.stringify(result))).toBe(false)
    expect(result.analysis.items).toEqual([{ type: 'sofa', count: 1 }])
  })

  it.each([
    { component: 'short street line', echo: '12 Elm St' },
    { component: 'street name phrase', echo: 'Elm St' },
    { component: 'short city', echo: 'Rye' },
    { component: 'state component', echo: 'NY' },
  ])('protects the $component in relevant inventory and uncertain candidates', async ({ echo }) => {
    const answers = ['relevant', 'uncertain'].map((verdict) =>
      JSON.stringify({
        verdict,
        reason: 'visible furniture',
        inventory: {
          ...inventory(),
          boxes_explanation: `Packing at ${echo}`,
          special_handling: [{ item: 'piano', reason: `Access at ${echo}` }],
          possible_duplicates: [{ item: `cabinet at ${echo}`, count: 2 }],
          unseen_areas: [`Storage at ${echo}`],
        },
      }),
    )
    const run = vi.fn(async () => ({ response: answers.shift() }))
    const result = await assessPhotos(
      bindings(run),
      photos(2),
      { ...EMPTY_MOVE_DETAILS, from: '12 Elm St, Rye, NY' },
      false,
    )
    expect(JSON.stringify(result).includes(echo)).toBe(false)
    expect(result.analysis.items).toEqual([{ type: 'sofa', count: 1 }])
    expect(result.analysis.total_volume_cubic_feet).toBe(80)
    expect(result.photos[1]?.candidates?.items).toEqual([{ type: 'sofa', count: 1 }])
    expect(result.photos[1]?.candidates?.total_volume_cubic_feet).toBe(80)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it.each([false, true])(
    'preserves numeric furniture attributes, counts and volume with confirmed details (mixed: %s)',
    async (mixed) => {
      const items = [
        { type: '2-seater sofa', count: 2 },
        ...(mixed
          ? [
              { type: '200 cm table', count: 1 },
              { type: '12-drawer dresser', count: 1 },
            ]
          : []),
      ]
      const volume = mixed ? 240 : 160
      const answers = ['relevant', 'uncertain'].map((verdict) =>
        JSON.stringify({
          verdict,
          reason: 'visible furniture',
          inventory: {
            items,
            total_volume_cubic_feet: volume,
            special_handling: [{ item: '2-seater sofa', reason: 'Requires wrapping' }],
            possible_duplicates: [{ item: '2-seater sofa', count: 2 }],
            unseen_areas: ['2-car garage'],
          },
        }),
      )
      const run = vi.fn(async () => ({ response: answers.shift() }))
      const result = await assessPhotos(
        bindings(run),
        photos(2),
        {
          from: '12 Elm St, Rye, NY',
          to: '9 Oak Ave, New York, NY',
          date: '2027-06-17',
          distanceMiles: 200,
          originFloor: 2,
          destinationFloor: 3,
          originElevator: false,
          destinationElevator: true,
        },
        false,
      )
      expect(result.analysis.items).toEqual(items)
      expect(result.analysis.total_volume_cubic_feet).toBe(volume)
      expect(result.photos[1]?.candidates?.items).toEqual(items)
      expect(result.photos[1]?.candidates?.total_volume_cubic_feet).toBe(volume)
      expect(result.analysis.special_handling).toEqual([{ item: '2-seater sofa', reason: expect.any(String) }])
      expect(result.analysis.possible_duplicates).toEqual([{ item: '2-seater sofa', count: 2 }])
      expect(result.analysis.unseen_areas).toEqual(['2-car garage'])
      expect(run).toHaveBeenCalledTimes(2)
    },
  )

  it.each(['relevant', 'uncertain'])(
    'retries complete %s inventory instead of dropping a private item label but retaining its volume',
    async (verdict) => {
      const answers = [
        JSON.stringify({
          verdict,
          reason: 'visible furniture',
          inventory: {
            items: [
              { type: 'sofa', count: 1 },
              { type: 'chair at 12 Elm St', count: 1 },
            ],
            total_volume_cubic_feet: 120,
          },
        }),
        reply(verdict),
      ]
      if (verdict === 'uncertain') answers.unshift(reply())
      const run = vi.fn(async () => ({ response: answers.shift() }))
      const result = await assessPhotos(
        bindings(run),
        photos(verdict === 'uncertain' ? 2 : 1),
        { ...EMPTY_MOVE_DETAILS, from: '12 Elm St, Rye, NY' },
        false,
      )
      expect(result.analysis.items).toEqual([{ type: 'sofa', count: 1 }])
      expect(result.analysis.total_volume_cubic_feet).toBe(80)
      if (verdict === 'uncertain') {
        expect(result.photos[1]?.candidates?.items).toEqual([{ type: 'sofa', count: 1 }])
        expect(result.photos[1]?.candidates?.total_volume_cubic_feet).toBe(80)
      }
      expect(run).toHaveBeenCalledTimes(verdict === 'uncertain' ? 3 : 2)
    },
  )

  it.each(['relevant', 'uncertain'])(
    'fails closed after two private item labels in %s inventory without caching partial totals',
    async (verdict) => {
      const entries: string[] = []
      vi.stubGlobal('caches', {
        default: {
          match: async () => undefined,
          put: async (_key: string, response: Response) => {
            entries.push(await response.text())
          },
        },
      })
      const run = vi.fn(async () => ({
        response: JSON.stringify({
          verdict,
          reason: 'visible furniture',
          inventory: {
            items: [
              { type: 'sofa', count: 1 },
              { type: 'chair at 12 Elm St', count: 1 },
            ],
            total_volume_cubic_feet: 120,
          },
        }),
      }))
      await expect(
        assessPhotos(
          bindings(run),
          photos(1),
          { ...EMPTY_MOVE_DETAILS, from: '12 Elm St, Rye, NY', to: `private-label-${verdict}` },
          true,
        ),
      ).rejects.toBeInstanceOf(AnalysisFormatError)
      expect(run).toHaveBeenCalledTimes(2)
      expect(entries).toEqual([])
    },
  )

  it('sanitizes numeric and boolean confirmed context echoed into arbitrary text, not structured inventory numbers', async () => {
    const run = vi.fn(async () => ({
      response: JSON.stringify({
        verdict: 'relevant',
        reason: 'visible furniture',
        inventory: {
          ...inventory(),
          boxes_explanation: 'Move distance 471.5 miles',
          special_handling: [{ item: 'piano', reason: 'Origin floor 4 and elevator true' }],
          unseen_areas: ['Elevator true'],
        },
      }),
    }))
    const result = await assessPhotos(
      bindings(run),
      photos(1),
      { ...EMPTY_MOVE_DETAILS, distanceMiles: 471.5, originFloor: 4, originElevator: true },
      false,
    )
    expect(/471|floor 4|true/i.test(JSON.stringify(result.analysis))).toBe(false)
    expect(result.analysis.items).toEqual([{ type: 'sofa', count: 1 }])
    expect(result.analysis.total_volume_cubic_feet).toBe(80)
  })

  it('surfaces explicitly selected provider failure without mock fallback or malformed retry', async () => {
    const run = vi.fn(async () => {
      throw new Error('PRIVATE provider text')
    })
    await expect(
      assessPhotos(bindings(run, { ENV: 'development', AI_MODE: 'binding' }), photos(1), EMPTY_MOVE_DETAILS, false),
    ).rejects.toThrow('request failed')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('never exceeds three simultaneous single-image calls and preserves order despite completion order', async () => {
    let active = 0
    let peak = 0
    const run = vi.fn(async (_model: string, input: { messages: { content: unknown[] }[] }) => {
      expect(input.messages[0]?.content).toHaveLength(2)
      const index = run.mock.calls.length - 1
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, index === 0 ? 20 : 1))
      active--
      return { response: reply('relevant', `item ${index}`) }
    })
    const result = await assessPhotos(bindings(run), photos(7), EMPTY_MOVE_DETAILS, false)
    expect(peak).toBe(3)
    expect(result.analysis.items.map((item) => item.type)).toEqual([
      'item 0',
      'item 1',
      'item 2',
      'item 3',
      'item 4',
      'item 5',
      'item 6',
    ])
  })

  it('isolates sample models and stores no URLs, input details, bytes or raw model reasons in cache entries', async () => {
    const entries: { key: string; value: string }[] = []
    vi.stubGlobal('caches', {
      default: {
        match: async () => undefined,
        put: async (key: string, response: Response) => {
          entries.push({ key, value: await response.text() })
        },
      },
    })
    const role = {
      mode: 'binding' as const,
      available: true,
      revision: 918,
      selection: { backend: 'binding' as const, model: 'model-one' },
    }
    vi.spyOn(aiMode, 'resolveRole').mockImplementation(async () => structuredClone(role))
    const run = vi.fn(async (_model: string) => ({ response: reply() }))
    const linked = photos(1)
    const details = { ...EMPTY_MOVE_DETAILS, from: 'PRIVATE confirmed source' }
    const first = await assessPhotos(bindings(run), linked, details, true)
    expect(first.cached).toBe(false)
    // Equivalent canonical sample identity at another request origin may reuse semantic data,
    // but response identities are always reconstructed from this request.
    const otherOrigin = linked.map((photo) => ({ ...photo, url: photo.url.replace('localhost', 'preview.invalid') }))
    const hit = await assessPhotos(bindings(run), otherOrigin, details, true)
    expect(hit.cached).toBe(true)
    expect(hit.photos[0]?.url).toBe('http://preview.invalid/sample/0.jpg')
    role.selection.model = 'model-two'
    expect((await assessPhotos(bindings(run), linked, details, true)).cached).toBe(false)
    expect(run.mock.calls.map((call) => call[0])).toEqual(['model-one', 'model-two'])
    expect(entries).toHaveLength(2)
    expect(entries[0]?.key).toMatch(/^https:\/\/sample\.movers\.invalid\/v5\/analyze\/[a-f0-9]{64}$/)
    expect(JSON.stringify(entries)).not.toMatch(/PRIVATE|localhost|preview.invalid|mimeType|image\/jpeg/)
  })

  it.each(['malformed', 'unrelated'])('does not cache a %s failure as successful inventory', async (kind) => {
    const run = vi.fn(async () => ({
      response: kind === 'malformed' ? 'bad reply' : JSON.stringify({ verdict: 'unrelated', reason: 'landscape' }),
    }))
    const details = { ...EMPTY_MOVE_DETAILS, from: `cache failure ${kind}` }
    await expect(assessPhotos(bindings(run), photos(1), details, true)).rejects.toBeInstanceOf(
      kind === 'malformed' ? AnalysisFormatError : NoUsableInventoryError,
    )
    run.mockImplementation(async () => ({ response: reply() }))
    expect((await assessPhotos(bindings(run), photos(1), details, true)).cached).toBe(false)
    expect((await assessPhotos(bindings(run), photos(1), details, true)).cached).toBe(true)
    expect(run).toHaveBeenCalledTimes(kind === 'malformed' ? 3 : 2)
  })

  it('drains in-flight calls and stops dequeuing after provider failure instead of returning partial inventory', async () => {
    let active = 0
    let call = 0
    const run = vi.fn(async () => {
      const current = call++
      active++
      await new Promise((resolve) => setTimeout(resolve, current === 0 ? 1 : 10))
      active--
      if (current === 0) throw new Error('PRIVATE provider failure')
      return { response: reply() }
    })
    await expect(assessPhotos(bindings(run), photos(6), EMPTY_MOVE_DETAILS, false)).rejects.toThrow('request failed')
    expect(run).toHaveBeenCalledTimes(3)
    expect(active).toBe(0)
  })

  it('labels deterministic offline assessments as demo data', async () => {
    const result = await assessPhotos(
      { ENV: 'development', AI_MODE: 'mock' } as Bindings,
      photos(1),
      EMPTY_MOVE_DETAILS,
      false,
    )
    expect(result.mode).toBe('mock')
    expect(result.photos[0]).toMatchObject({ status: 'relevant', reason: expect.stringMatching(/offline|demo/i) })
  })
})
