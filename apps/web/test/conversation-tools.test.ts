// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveConversationRoute } from '../functions/api/_lib/conversation-tools'
const endpoints = { from: 'Dizengoff 100, Tel Aviv', to: 'Bezalel 2, Raanana', revision: 7 }
const candidate = (lat: number, lon: number, label = 'A', result_type = 'building', confidence = 1) => ({
  lat,
  lon,
  formatted: label,
  result_type,
  rank: { confidence },
})
function provider(
  first = [candidate(32, 34)],
  second = [candidate(33, 35)],
  routing: unknown = { results: [{ distance: 16093.44, distance_units: 'Meters' }] },
) {
  const outputs = [{ results: first }, { results: second }, routing]
  return vi.fn(async () => Response.json(outputs.shift()))
}
afterEach(() => vi.useRealTimers())
describe('bounded read-only Geoapify tools', () => {
  it('does no network without a server key', async () => {
    const fetch = provider()
    expect(await resolveConversationRoute(endpoints, undefined, fetch)).toMatchObject({ status: 'unconfigured' })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('uses only fixed GET destinations and validates actual meter distance', async () => {
    const fetch = provider()
    const route = await resolveConversationRoute(endpoints, 'test-key', fetch)
    expect(route).toMatchObject({
      status: 'ready',
      distanceMiles: 10,
      precision: 'address',
      endpointRevision: 7,
      attribution: 'Powered by Geoapify',
      from: endpoints.from,
      to: endpoints.to,
    })
    expect(fetch).toHaveBeenCalledTimes(3)
    const urls = fetch.mock.calls.map((call) => new URL(String(call[0])))
    expect(urls.map((url) => url.origin)).toEqual(Array(3).fill('https://api.geoapify.com'))
    expect(urls.map((url) => url.pathname)).toEqual(['/v1/geocode/search', '/v1/geocode/search', '/v1/routing'])
    expect(urls[0].searchParams.get('bias')).toBe('countrycode:none')
    expect(urls[0].searchParams.get('limit')).toBe('3')
    expect(urls[2].searchParams.get('waypoints')).toBe('32,34|33,35')
    expect(urls[2].searchParams.get('units')).toBe('metric')
    expect(fetch.mock.calls.every((call) => call[1]?.method === 'GET' && call[1]?.redirect === 'manual')).toBe(true)
  })
  it('rejects redirect responses without following them (Worker-compatible manual mode)', async () => {
    const fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.redirect !== 'manual') throw new Error('Worker unsupported redirect mode')
      return new Response(null, { status: 302, headers: { location: 'https://other.test/' } })
    })
    expect(await resolveConversationRoute(endpoints, 'key', fetch)).toMatchObject({ status: 'unavailable' })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][1]?.redirect).toBe('manual')
  })
  it('does not pick the first of competing plausible Springfields', async () => {
    const fetch = provider([candidate(32, 34, 'Springfield'), candidate(40, 42, 'Springfield')])
    expect(await resolveConversationRoute({ ...endpoints, from: 'Springfield' }, 'key', fetch)).toMatchObject({
      status: 'ambiguous',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('labels a city-level route approximate without rewriting user addresses', async () => {
    expect(
      await resolveConversationRoute(endpoints, 'key', provider([candidate(32, 34, 'Other label', 'city')])),
    ).toMatchObject({ status: 'ready', precision: 'city', from: endpoints.from })
  })
  it('cannot label city-only user context address-accurate even if the provider returns a building', async () => {
    expect(await resolveConversationRoute({ ...endpoints, from: 'Tel Aviv' }, 'key', provider())).toMatchObject({
      status: 'ready',
      precision: 'city',
    })
  })
  it.each([
    { results: [{ distance: -1, distance_units: 'Meters' }] },
    { results: [{ distance: 100, distance_units: 'Miles' }] },
    { results: [] },
    { results: [{ distance: '100', distance_units: 'Meters' }] },
  ])('rejects malformed routing data', async (routing) => {
    expect(await resolveConversationRoute(endpoints, 'key', provider(undefined, undefined, routing))).toMatchObject({
      status: 'unavailable',
    })
  })
  it('rejects invalid coordinates and oversized streamed responses', async () => {
    expect(await resolveConversationRoute(endpoints, 'key', provider([candidate(91, 34)]))).toMatchObject({
      status: 'unavailable',
    })
    const fetch = vi.fn(async () => new Response(' '.repeat(65537)))
    expect(await resolveConversationRoute(endpoints, 'key', fetch)).toMatchObject({ status: 'unavailable' })
  })
  it('times out a hung fetch at 3 seconds even if the provider ignores abort', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(() => new Promise<Response>(() => {}))
    const result = resolveConversationRoute(endpoints, 'key', fetch)
    await vi.advanceTimersByTimeAsync(3000)
    expect(await result).toMatchObject({ status: 'unavailable' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
