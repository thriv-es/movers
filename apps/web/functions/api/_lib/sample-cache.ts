/**
 * Caches the model answers for the bundled sample move (MOVERS-16), so repeated sample runs do not each spend two
 * model calls. Uses the Workers Cache API where it exists and a module-level map elsewhere (tests, Node).
 *
 * Keys are synthetic URLs: the sample version plus a digest of the request, so an edited sample inventory is priced
 * for real while the untouched sample is served from cache.
 */

/** Bump when the sample answers change shape or content, so stale cache entries are not served. */
export const SAMPLE_VERSION = 'v2'

const ORIGIN = 'https://sample.movers.invalid'
const TTL_SECONDS = 60 * 60 * 24 * 30

const memory = new Map<string, string>()

async function digest(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function sampleCacheKey(route: string, payload: unknown): Promise<string> {
  const hash = await digest(JSON.stringify(payload))
  return `${ORIGIN}/${SAMPLE_VERSION}/${route}/${hash}`
}

function workersCache(): Cache | null {
  const caches = (globalThis as { caches?: { default?: Cache } }).caches
  return caches?.default ?? null
}

export async function readSampleCache(key: string): Promise<string | null> {
  const cache = workersCache()
  if (cache) {
    try {
      const hit = await cache.match(key)
      if (hit) return await hit.text()
    } catch {
      // local runtimes without a working cache fall through to memory
    }
  }
  return memory.get(key) ?? null
}

export async function writeSampleCache(key: string, text: string): Promise<void> {
  memory.set(key, text)
  const cache = workersCache()
  if (!cache) return
  try {
    await cache.put(
      key,
      new Response(text, {
        headers: { 'content-type': 'text/plain', 'cache-control': `public, max-age=${TTL_SECONDS}` },
      }),
    )
  } catch {
    // the memory copy is enough for this process
  }
}

/** Serves `compute()` from the cache when `sample` is set; otherwise runs it every time. */
export async function withSampleCache<T>(
  sample: boolean | undefined,
  route: string,
  payload: unknown,
  compute: () => Promise<T>,
): Promise<{ value: T; cached: boolean }> {
  if (!sample) return { value: await compute(), cached: false }
  const key = await sampleCacheKey(route, payload)
  const hit = await readSampleCache(key)
  if (hit !== null) {
    try {
      return { value: JSON.parse(hit) as T, cached: true }
    } catch {
      // a corrupt entry is recomputed below
    }
  }
  const value = await compute()
  await writeSampleCache(key, JSON.stringify(value))
  return { value, cached: false }
}
