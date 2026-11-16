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
let conversationFailure = false
let conversationMode = 'normal'
let conversationCalls = 0
let conversationCommands = null
let saveFailures = 0
let emailLogsSuppressed = 0
const log = console.log
console.log = (...args) => {
  // The inherited mail stub logs bodies. Never retain even synthetic contact/body text in artifacts.
  if (typeof args[0] === 'string' && args[0].startsWith('[outbound-email]')) emailLogsSuppressed++
  else log(...args)
}
const gates = new Map()
const entered = []
let inFlight = 0
async function drain() {
  for (const gate of gates.values()) gate.release()
  gates.clear()
  const deadline = Date.now() + 5000
  while (inFlight && Date.now() < deadline) await new Promise((done) => setTimeout(done, 10))
  if (inFlight) throw new Error('Offline requests did not drain')
}
async function hold(key) {
  const gate = gates.get(key)
  if (gate) {
    entered.push(key)
    await gate.promise
  }
}
const byDigest = new Map()
const inventory = (type = 'scripted chair') => ({
  // A real count-changing duplicate review: Same sofa reduces two scripted sightings to one.
  items: [{ type, count: type === 'sofa' ? 2 : 1 }],
  total_volume_cubic_feet: 20,
  estimated_boxes_min: 1,
  estimated_boxes_max: 2,
  special_handling: [],
  possible_duplicates: type === 'sofa' ? [{ item: 'sofa', count: 2 }] : [],
  unseen_areas: ['garage', 'closets'],
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
          'unrelated beach umbrella',
          'unrelated food platter',
          'armchair',
          'bookshelf',
        ][index - 1]
        return {
          response: JSON.stringify({
            verdict,
            reason: 'Scripted fake AI, not image ground truth.',
            // Distractor inventory in unrelated envelopes must be discarded by the real verdict gate.
            inventory: inventory(item),
          }),
        }
      }
      if (content.includes('CURRENT_STATE_AND_MESSAGES_JSON')) {
        const { snapshot, messages } = JSON.parse(
          content.split('CURRENT_STATE_AND_MESSAGES_JSON\n')[1].split('\nEND_CURRENT_STATE_AND_MESSAGES_JSON')[0],
        )
        // Provider-level script, not API fulfillment: the real parser/authorship/revision checks still run.
        conversationCalls++
        await hold('conversation')
        if (chatDelay) await new Promise((done) => setTimeout(done, chatDelay))
        if (conversationFailure) throw new Error('Scripted conversation outage')
        if (conversationMode === 'malformed' || (conversationMode === 'retry-once' && conversationCalls === 1))
          return { response: 'synthetic-private-envelope-invalid-json' }
        // Refresh keeps the transcript, including the prior assistant's proposal guidance.
        const answer = messages.findLast((message) => message.role === 'user')?.content ?? ''
        let commands = conversationCommands ?? []
        if (conversationCommands === null) {
          let patch
          if (answer === 'from Tel Aviv to Raanana on 1.1.2027')
            patch = { from: 'Tel Aviv', to: 'Raanana', date: '2027-01-01' }
          else if (answer === 'origin street: 12 Main Street')
            patch = { from: `12 Main Street, ${snapshot.moveDetails.from}` }
          else if (answer === 'origin address: 9 Oak Street, Haifa') patch = { from: '9 Oak Street, Haifa' }
          else if (answer === '15 miles') patch = { distanceMiles: 15 }
          commands = patch ? [{ type: 'details.patch', patch }] : []
        }
        return {
          response: JSON.stringify({
            reply: 'Scripted provider envelope, never displayed.',
            basedOnRevision: snapshot.revision,
            proposals: commands.map((command, index) => ({
              id: `script-${index}`,
              expectedRevision: snapshot.revision,
              command,
            })),
          }),
        }
      }
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
const migratedTables = (
  await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
).results.map(({ name }) => name)
app.get('/__e2e/health', (c) =>
  c.json({ ready: true, fakeAI: true, migrations: ['0001', '0002', '0003'], tables: migratedTables }),
)
app.post('/__e2e/gate', async (c) => {
  const { key, release } = await c.req.json()
  if (release) {
    gates.get(key)?.release()
    gates.delete(key)
  } else {
    let releaseGate
    const promise = new Promise((done) => {
      releaseGate = done
    })
    gates.set(key, { promise, release: releaseGate })
  }
  return c.json({ ok: true })
})
app.post('/__e2e/drain', async (c) => {
  await drain()
  return c.json({ drained: true })
})
app.post('/__e2e/reset', async (c) => {
  const options = await c.req.json().catch(() => ({}))
  await drain()
  entered.length = 0
  for (const table of ['photo_receipts', 'quote_requests', 'estimates', 'movers', 'ai_settings'])
    await db.prepare(`DELETE FROM ${table}`).run()
  const objects = await env.MOVERS_BUCKET.list()
  if (objects.objects.length) await env.MOVERS_BUCKET.delete(objects.objects.map(({ key }) => key))
  // Ordinary UI tests isolate the inherited seed race; fresh-state tests explicitly opt out.
  if (options.seed !== false) {
    for (const suffix of ['a', 'b'])
      await db
        .prepare('INSERT INTO movers (id, slug, name, email, service_area, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(
          `e2e-mover-${suffix}`,
          `e2e-fixture-${suffix}`,
          `Synthetic Fixture Movers ${suffix}`,
          `mover-${suffix}@example.invalid`,
          'Test area',
          '2026-01-01T00:00:00.000Z',
        )
        .run()
  }
  uploads = []
  calls = []
  requests = []
  byDigest.clear()
  scenario = 'normal'
  chatDelay = 0
  conversationFailure = false
  conversationMode = 'normal'
  conversationCalls = 0
  conversationCommands = null
  saveFailures = 0
  emailLogsSuppressed = 0
  return c.json({ reset: true })
})
app.post('/__e2e/scenario', async (c) => {
  const body = await c.req.json()
  if (!['normal', 'malformed', 'retry-once', 'provider-failure'].includes(body.name))
    return c.json({ error: 'Unknown scenario' }, 400)
  scenario = body.name
  chatDelay = body.chatDelay === 750 ? 750 : 0
  conversationFailure = body.conversationFailure === true
  conversationMode = ['malformed', 'retry-once'].includes(body.conversationMode) ? body.conversationMode : 'normal'
  conversationCommands = body.commands ?? null
  saveFailures = body.saveFailures === 1 ? 1 : 0
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
    conversationCalls,
    entered,
    emailLogsSuppressed,
    movers: await db.prepare('SELECT COUNT(*) AS count FROM movers').first('count'),
    quotes: await db.prepare('SELECT COUNT(*) AS count FROM quote_requests').first('count'),
    receipts: await db.prepare('SELECT COUNT(*) AS count FROM photo_receipts').first('count'),
    estimates: await db.prepare('SELECT COUNT(*) AS count FROM estimates').first('count'),
    objects: (await env.MOVERS_BUCKET.list()).objects.length,
  }),
)
app.use('/api/*', async (c, next) => {
  inFlight++
  try {
    const key = `${c.req.method} ${c.req.path}`
    await hold(`before:${key}`)
    if (key === 'POST /api/estimates' && saveFailures-- > 0) {
      // Test-local D1 fault; production handler still runs and returns its real save-failure response.
      await db.prepare('ALTER TABLE estimates RENAME TO unavailable_estimates').run()
      try {
        await next()
      } finally {
        await db.prepare('ALTER TABLE unavailable_estimates RENAME TO estimates').run()
      }
    } else await next()
    await hold(`after:${key}`)
    requests.push({ path: c.req.path, method: c.req.method, status: c.res.status })
  } finally {
    inFlight--
  }
})
app.use('/api/images/upload', async (c, next) => {
  const form = await c.req.raw.clone().formData()
  for (const file of form.getAll('images')) {
    const hash = digest(Buffer.from(await file.arrayBuffer()))
    uploads.push({ file: file.name, hash, bytes: file.size })
    byDigest.set(hash, file.name)
  }
  await hold(`upload:${form.getAll('images')[0]?.name}`)
  await next()
})
for (const name of [
  'ai-status',
  'conversation',
  'images',
  'analyze',
  'price',
  'estimates',
  'movers',
  'quote-requests',
]) {
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
