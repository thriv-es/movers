import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
// Never load project .env/.dev.vars or inherited provider credentials.
process.chdir(here)
process.env.WRANGLER_SEND_METRICS = 'false'
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false'
process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV = 'false'
const { getPlatformProxy } = await import('wrangler')
const { createServer: createViteServer } = await import('vite')
const platform = await getPlatformProxy({
  configPath: resolve(here, 'wrangler.toml'),
  envFiles: ['no-secrets'],
  remoteBindings: false,
  persist: false,
})
// Fail closed if a real route ever attempts an external fetch (including an accidental Gateway call).
const localFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (!['http://127.0.0.1:5630', 'http://127.0.0.1:5631'].includes(url.origin)) {
    throw new Error(`External fetch forbidden in offline E2E: ${url.origin}`)
  }
  return localFetch(input, init)
}
const db = platform.env.MOVERS_DB
for (const migration of ['0001_init.sql', '0002_ai_settings.sql', '0003_photo_receipts.sql']) {
  const sql = await readFile(resolve(root, 'migrations', migration), 'utf8')
  // D1 exec accepts one statement per line; migrations contain only ordinary DDL.
  for (const statement of sql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .filter((part) => part.trim())) {
    await db.prepare(statement).run()
  }
}

const vite = await createViteServer({
  configFile: resolve(root, 'vite.config.ts'),
  root,
  envDir: here,
  define: { 'process.env.NODE_ENV': JSON.stringify('development') },
  server: {
    host: '127.0.0.1',
    port: 5630,
    strictPort: true,
    open: false,
    proxy: {
      '/api': { target: 'http://127.0.0.1:5631', changeOrigin: false },
      '/__e2e': { target: 'http://127.0.0.1:5631' },
    },
    fs: { allow: [resolve(root, '../..')] },
  },
})
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
let uploads = []
let calls = []
let requests = []
let scenario = 'normal'
let chatDelay = 0
const byDigest = new Map()
const inventory = (type = 'scripted chair') => ({
  items: [{ type, count: 1 }],
  total_volume_cubic_feet: 20,
  estimated_boxes_min: 1,
  estimated_boxes_max: 2,
  special_handling: [],
  possible_duplicates: [],
  unseen_areas: [],
})
const env = {
  MOVERS_DB: db,
  // Node File streams lack workerd's known-length annotation. Buffer only at the RPC boundary;
  // the production upload handler and actual local R2 put/get remain unchanged.
  MOVERS_BUCKET: new Proxy(platform.env.MOVERS_BUCKET, {
    get(target, key) {
      if (key === 'put')
        return async (name, value, options) =>
          target.put(name, value instanceof ReadableStream ? await new Response(value).arrayBuffer() : value, options)
      if (key === 'get')
        return async (...args) => {
          const object = await target.get(...args)
          if (!object) return null
          // RPC cannot serialize Node's Headers. Use the real stored metadata on this side.
          return new Proxy(object, {
            get(stored, property) {
              if (property === 'writeHttpMetadata')
                return (headers) => {
                  const names = {
                    contentType: 'content-type',
                    contentLanguage: 'content-language',
                    contentDisposition: 'content-disposition',
                    contentEncoding: 'content-encoding',
                    cacheControl: 'cache-control',
                    cacheExpiry: 'expires',
                  }
                  for (const [name, value] of Object.entries(stored.httpMetadata ?? {}))
                    headers.set(names[name], String(value))
                }
              const value = stored[property]
              return typeof value === 'function' ? value.bind(stored) : value
            },
          })
        }
      const value = target[key]
      return typeof value === 'function' ? value.bind(target) : value
    },
  }),
  ENV: 'development',
  AI_MODE: 'binding',
  PRICE_PER_BOX: '50',
  AI: {
    async run(_model, input) {
      const content = input.messages[0].content
      if (Array.isArray(content)) {
        const image = content.find((part) => part.type === 'image_url')
        const hash = digest(Buffer.from(image.image_url.url.split(',')[1], 'base64'))
        const file = byDigest.get(hash)
        if (!file) throw new Error('Fake AI received bytes not recorded by upload middleware')
        calls.push({ file, hash })
        if (scenario === 'malformed') return { response: '{invalid assessment' }
        if (scenario === 'retry-once' && calls.filter((call) => call.hash === hash).length === 1)
          return { response: '' }
        if (scenario === 'provider-failure') throw new Error('Scripted provider outage')
        const index = Number(/movers-e2e-(\d+)/.exec(file)?.[1])
        const verdict = index >= 9 ? 'uncertain' : index >= 7 ? 'unrelated' : 'relevant'
        const item = [
          'sofa',
          'bed',
          'desk',
          'dining table',
          'microwave',
          'tool chest',
          '',
          '',
          'armchair',
          'bookshelf',
        ][index - 1]
        return {
          response: JSON.stringify({
            verdict,
            reason: 'Scripted fake AI, not image ground truth.',
            ...(verdict === 'unrelated' ? {} : { inventory: inventory(item) }),
          }),
        }
      }
      if (chatDelay) await new Promise((done) => setTimeout(done, chatDelay))
      if (content.includes('total_volume_cubic_feet'))
        return {
          response: JSON.stringify({
            currency: 'USD',
            total: 650,
            breakdown: { 'Synthetic transport': 650 },
            explanation: 'Scripted offline price, not a quote.',
            confidence: 'low',
          }),
        }
      return {
        response: `Synthetic offline assistant reply. ${'More fixture details for the transcript. '.repeat(30)}`,
      }
    },
  },
}
const app = new Hono()
app.get('/__e2e/health', (c) => c.json({ ready: true, fakeAI: true }))
app.post('/__e2e/reset', async (c) => {
  for (const table of ['photo_receipts', 'quote_requests', 'estimates', 'movers', 'ai_settings'])
    await db.prepare(`DELETE FROM ${table}`).run()
  const objects = await env.MOVERS_BUCKET.list()
  if (objects.objects.length) await env.MOVERS_BUCKET.delete(objects.objects.map(({ key }) => key))
  // Seed a single synthetic mover before concurrent lead-save/list requests (not the production seed path).
  await db
    .prepare('INSERT INTO movers (id, slug, name, email, service_area, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(
      'e2e-mover',
      'e2e-fixture',
      'Synthetic Fixture Movers',
      'mover@example.invalid',
      'Test area',
      '2026-01-01T00:00:00.000Z',
    )
    .run()
  uploads = []
  calls = []
  requests = []
  byDigest.clear()
  scenario = 'normal'
  chatDelay = 0
  return c.json({ reset: true })
})
app.post('/__e2e/scenario', async (c) => {
  const body = await c.req.json()
  if (!['normal', 'malformed', 'retry-once', 'provider-failure'].includes(body.name))
    return c.json({ error: 'Unknown scenario' }, 400)
  scenario = body.name
  chatDelay = body.chatDelay === 750 ? 750 : 0
  return c.json({ scenario })
})
app.post('/__e2e/change-vision', async (c) => {
  const roles = {
    chat: { backend: 'binding', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
    vision: { backend: 'gateway', model: '@cf/meta/llama-3.2-11b-vision-instruct' },
    price: { backend: 'binding', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
  }
  await db
    .prepare('INSERT OR REPLACE INTO ai_settings (id, revision, roles_json) VALUES (1, 1, ?)')
    .bind(JSON.stringify(roles))
    .run()
  return c.json({ changed: true })
})
app.get('/__e2e/state', async (c) =>
  c.json({
    uploads,
    calls,
    requests,
    receipts: await db.prepare('SELECT COUNT(*) AS count FROM photo_receipts').first('count'),
    estimates: await db.prepare('SELECT COUNT(*) AS count FROM estimates').first('count'),
    objects: (await env.MOVERS_BUCKET.list()).objects.length,
  }),
)
app.use('/api/*', async (c, next) => {
  await next()
  requests.push({ path: c.req.path, method: c.req.method, status: c.res.status })
})
app.use('/api/images/upload', async (c, next) => {
  const form = await c.req.raw.clone().formData()
  for (const file of form.getAll('images')) {
    const hash = digest(Buffer.from(await file.arrayBuffer()))
    uploads.push({ file: file.name, hash, bytes: file.size })
    byDigest.set(hash, file.name)
  }
  await next()
})
for (const name of ['ai-status', 'chat', 'images', 'analyze', 'price', 'estimates', 'movers', 'quote-requests']) {
  const route = await vite.ssrLoadModule(resolve(root, `functions/api/_routes/${name}.ts`))
  app.route(`/api/${name}`, route.default)
}
// No production entry point imports this app or its scenario/reset endpoints.
const api = createServer(async (incoming, outgoing) => {
  try {
    const request = new Request(`http://127.0.0.1:5630${incoming.url}`, {
      method: incoming.method,
      headers: incoming.headers,
      ...(incoming.method === 'GET' || incoming.method === 'HEAD' ? {} : { body: incoming, duplex: 'half' }),
    })
    const response = await app.fetch(request, env)
    outgoing.writeHead(response.status, Object.fromEntries(response.headers))
    outgoing.end(Buffer.from(await response.arrayBuffer()))
  } catch (error) {
    console.error(error)
    outgoing.writeHead(500).end('Offline harness failure')
  }
})
let closing = false
async function close() {
  if (closing) return
  closing = true
  await vite.close()
  await new Promise((done) => api.close(done))
  await platform.dispose()
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => close().then(() => process.exit(0)))
try {
  await new Promise((done, reject) => {
    api.once('error', reject)
    api.listen(5631, '127.0.0.1', done)
  })
  await vite.listen()
  console.log('Offline E2E ready: 127.0.0.1:5630 / 5631; real routes, ephemeral D1/R2, fake AI')
} catch (error) {
  await close()
  throw error
}
