// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assessPhotos, AnalysisFormatError, NoUsableInventoryError } from '../functions/api/_lib/vision-assessment'
import type { LinkedPhoto } from '../functions/api/_lib/photo-links'
import type { Bindings } from '../functions/api/_lib/types'
import { EMPTY_MOVE_DETAILS } from '../src/data'
import * as aiMode from '../functions/api/_lib/ai-mode'

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

  it.each(['unrelated', 'uncertain', 'empty', 'excluded'])(
    'rejects %s-only inventory without merging uncertain candidates',
    async (kind) => {
      const run = vi.fn(async () => ({
        response:
          kind === 'empty'
            ? JSON.stringify({
                verdict: 'relevant',
                reason: 'empty room',
                inventory: { items: [], total_volume_cubic_feet: 0 },
              })
            : reply(kind),
      }))
      const linked =
        kind === 'excluded' ? [{ url: 'bad', status: 'unlinked' as const, reason: 'Re-upload' }] : photos(1)
      await expect(assessPhotos(bindings(run), linked, EMPTY_MOVE_DETAILS, false)).rejects.toBeInstanceOf(
        NoUsableInventoryError,
      )
      expect(run).toHaveBeenCalledTimes(kind === 'excluded' ? 0 : 1)
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
