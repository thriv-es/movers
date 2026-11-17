import { z } from 'zod'
import type { ConversationRoute } from '../../../src/data/z-common/z-conversation'

const zCandidate = z.object({
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
  formatted: z.string().trim().min(1).max(1000),
  result_type: z.enum([
    'unknown',
    'amenity',
    'building',
    'street',
    'suburb',
    'district',
    'postcode',
    'city',
    'county',
    'state',
    'country',
  ]),
  rank: z.object({ confidence: z.number().finite().min(0).max(1) }),
})
const zGeocodes = z.object({ results: z.array(zCandidate).max(3) })
const zRouting = z.object({
  results: z
    .array(
      z.object({ distance: z.number().finite().nonnegative().max(160934400), distance_units: z.literal('Meters') }),
    )
    .min(1)
    .max(3),
})
type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>

/** Fixed-origin, no redirects, bounded time AND streamed bytes. Never return provider bodies/errors. */
async function request(
  path: '/v1/geocode/search' | '/v1/routing',
  params: Record<string, string>,
  key: string,
  fetcher: Fetch,
): Promise<unknown> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new Error('Tool unavailable'))
        }, 3000)
      }),
      (async () => {
        const url = new URL(path, 'https://api.geoapify.com')
        url.search = new URLSearchParams({ ...params, apiKey: key }).toString()
        const response = await fetcher(url, { method: 'GET', redirect: 'manual', signal: controller.signal })
        if (!response.ok || !response.body || Number(response.headers.get('content-length')) > 65536)
          throw new Error('Tool unavailable')
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let bytes = 0
        let text = ''
        try {
          while (true) {
            const chunk = await reader.read()
            if (chunk.done) break
            bytes += chunk.value.byteLength
            if (bytes > 65536) throw new Error('Tool unavailable')
            text += decoder.decode(chunk.value, { stream: true })
          }
          return JSON.parse(text + decoder.decode()) as unknown
        } finally {
          void reader.cancel().catch(() => {})
        }
      })(),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    controller.abort()
  }
}

export async function resolveConversationRoute(
  endpoints: { from: string; to: string; revision: number },
  key?: string,
  fetcher: Fetch = fetch,
): Promise<ConversationRoute> {
  const base = {
    from: endpoints.from,
    to: endpoints.to,
    endpointRevision: endpoints.revision,
    precision: 'city' as const,
    attribution: 'Powered by Geoapify' as const,
  }
  if (!key?.trim()) return { ...base, status: 'unconfigured' }
  try {
    const chosen: z.infer<typeof zCandidate>[] = []
    for (const text of [endpoints.from, endpoints.to]) {
      const { results } = zGeocodes.parse(
        await request(
          '/v1/geocode/search',
          { text, format: 'json', limit: '3', bias: 'countrycode:none' },
          key,
          fetcher,
        ),
      )
      if (!results.length) return { ...base, status: 'unavailable' }
      const sorted = [...results].sort((a, b) => b.rank.confidence - a.rank.confidence)
      const best = sorted[0]
      if (
        !best ||
        best.rank.confidence < 0.6 ||
        sorted
          .slice(1)
          .some(
            (candidate) =>
              candidate.rank.confidence >= best.rank.confidence - 0.15 &&
              (candidate.lat !== best.lat || candidate.lon !== best.lon),
          )
      )
        return { ...base, status: 'ambiguous' }
      chosen.push(best)
    }
    const { results } = zRouting.parse(
      await request(
        '/v1/routing',
        {
          waypoints: chosen.map(({ lat, lon }) => `${lat},${lon}`).join('|'),
          mode: 'drive',
          format: 'json',
          units: 'metric',
        },
        key,
        fetcher,
      ),
    )
    const distance = results[0]?.distance
    if (distance === undefined) return { ...base, status: 'unavailable' }
    return {
      ...base,
      status: 'ready',
      precision:
        chosen.every((candidate) => candidate.result_type === 'building') &&
        [endpoints.from, endpoints.to].every((text) => /\d/.test(text))
          ? 'address'
          : 'city',
      distanceMiles: distance / 1609.344,
    }
  } catch {
    return { ...base, status: 'unavailable' }
  }
}
