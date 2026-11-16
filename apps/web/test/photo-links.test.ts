// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolvePhotoLinks } from '../functions/api/_lib/photo-links'
import { issuePhotoReceipt } from '../functions/api/_lib/photo-receipts'
import type { Bindings } from '../functions/api/_lib/types'

const origin = 'http://127.0.0.1:5610'
const jpeg = new Uint8Array([255, 216, 255, 224, 0, 2, 255, 217])
function setup() {
  const records = new Map<string, { session_id: string; object_key: string; expires_at: string }>()
  const db = {
    prepare: (sql: string) => ({
      bind: (hash: string, sessionId: string, key: string, _issuedAt: string, expiresAt: string) => ({
        run: async () => {
          records.set(hash, { session_id: sessionId, object_key: key, expires_at: expiresAt })
        },
        first: async () => (sql.startsWith('SELECT') ? (records.get(hash) ?? null) : null),
      }),
    }),
  }
  const get = vi.fn(async () => ({ arrayBuffer: async () => jpeg.buffer, httpMetadata: { contentType: 'image/jpeg' } }))
  return {
    env: { MOVERS_DB: db, MOVERS_BUCKET: { get } } as unknown as Bindings & { MOVERS_DB: D1Database },
    records,
    get,
  }
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
describe('photo link gate', () => {
  it.each([
    'valid',
    'wrong session',
    'wrong key',
    'expired',
    'missing receipt',
    'invalid receipt',
    'unknown receipt',
    'missing object',
  ])('%s receipt/object', async (kind) => {
    const { env, records, get } = setup()
    const receipt = await issuePhotoReceipt(env.MOVERS_DB, 'session-a', 'a.jpg')
    if (kind === 'expired') for (const record of records.values()) record.expires_at = '2000-01-01T00:00:00.000Z'
    if (kind === 'missing object') get.mockResolvedValueOnce(null as never)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const result = await resolvePhotoLinks(
      env,
      `${origin}/api/analyze`,
      kind === 'wrong session' ? 'session-b' : 'session-a',
      [
        {
          url: `${origin}/api/images/${kind === 'wrong key' ? 'b.jpg' : 'a.jpg'}`,
          receipt:
            kind === 'missing receipt'
              ? null
              : kind === 'invalid receipt'
                ? 'x'
                : kind === 'unknown receipt'
                  ? 'x'.repeat(43)
                  : receipt,
        },
      ],
      false,
    )
    expect(result[0]?.status).toBe(
      kind === 'valid' ? 'eligible' : kind === 'missing object' ? 'unavailable' : 'unlinked',
    )
    expect(get).toHaveBeenCalledTimes(['valid', 'missing object'].includes(kind) ? 1 : 0)
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([
    'https://other.example/api/images/a.jpg',
    'http://127.0.0.1:5611/api/images/a.jpg',
    '//127.0.0.1:5610/api/images/a.jpg',
    `${origin}/api/images/a.jpg?x=1`,
    'http://user:pass@127.0.0.1:5610/api/images/a.jpg',
    `${origin}/api/images/x/../a.jpg`,
    `${origin}/api/images/%2fsecret`,
    `${origin}/api/images/a.jpg#x`,
    `${origin}/api/images/%ZZ`,
    `${origin}/sample/not-real.jpg`,
    `${origin}/sample/%6civing-room.jpg`,
    `${origin}/sample/living-room.jpg?x=1`,
  ])('rejects unexpected URL %s before IO', async (url) => {
    const { env, get } = setup()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    for (const sample of [false, true]) {
      expect(
        (await resolvePhotoLinks(env, `${origin}/api/analyze`, 'session-a', [{ url, receipt: 'x' }], sample))[0]
          ?.status,
      ).toBe('unlinked')
    }
    expect(get).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('fetches only exact server-constructed sample URLs without redirect following, preserving order', async () => {
    const { env } = setup()
    const fetch = vi.fn(async () => new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } }))
    vi.stubGlobal('fetch', fetch)
    const urls = [`${origin}/sample/kitchen.jpg`, 'https://other.example/a.jpg', `${origin}/sample/bedroom.jpg`]
    const result = await resolvePhotoLinks(
      env,
      `${origin}/api/analyze`,
      'session-a',
      urls.map((url) => ({ url, receipt: null })),
      true,
    )
    expect(result.map(({ url, status }) => ({ url, status }))).toEqual(
      urls.map((url, i) => ({ url, status: i === 1 ? 'unlinked' : 'eligible' })),
    )
    expect(fetch.mock.calls).toEqual([
      [`${origin}/sample/kitchen.jpg`, { redirect: 'error' }],
      [`${origin}/sample/bedroom.jpg`, { redirect: 'error' }],
    ])
  })
  it('does not read R2 without D1 and excludes corrupt or unreadable own bytes', async () => {
    const { env, get } = setup()
    const receipt = await issuePhotoReceipt(env.MOVERS_DB, 'session-a', 'a.jpg')
    const refs = [{ url: `${origin}/api/images/a.jpg`, receipt }]
    expect(
      (await resolvePhotoLinks({ ...env, MOVERS_DB: undefined }, origin, 'session-a', refs, false))[0]?.status,
    ).toBe('unlinked')
    expect(get).not.toHaveBeenCalled()
    get.mockResolvedValueOnce({
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      httpMetadata: { contentType: 'image/jpeg' },
    })
    expect((await resolvePhotoLinks(env, origin, 'session-a', refs, false))[0]?.status).toBe('unavailable')
    get.mockRejectedValueOnce(new Error('private bucket error'))
    expect((await resolvePhotoLinks(env, origin, 'session-a', refs, false))[0]?.status).toBe('unavailable')
  })
  it.each(['empty', 'html', 'mismatch', 'oversize', 'read error', 'redirect'])(
    'excludes unavailable sample bytes: %s',
    async (kind) => {
      const { env } = setup()
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          if (kind === 'read error') throw new Error('sensitive URL')
          if (kind === 'redirect') return new Response(null, { status: 302 })
          return new Response(
            kind === 'empty' ? new Uint8Array() : kind === 'oversize' ? new Uint8Array(10 * 1024 * 1024 + 1) : jpeg,
            {
              headers: {
                'content-type': kind === 'html' ? 'text/html' : kind === 'mismatch' ? 'image/png' : 'image/jpeg',
              },
            },
          )
        }),
      )
      expect(
        (
          await resolvePhotoLinks(
            env,
            `${origin}/api/analyze`,
            'session-a',
            [{ url: `${origin}/sample/living-room.jpg`, receipt: null }],
            true,
          )
        )[0]?.status,
      ).toBe('unavailable')
    },
  )
})
