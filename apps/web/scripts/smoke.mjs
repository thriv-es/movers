#!/usr/bin/env node
/**
 * HTTP smoke test of the whole estimate flow against a running dev stack:
 * chat (until finished) -> upload -> analyze -> price.
 *
 *   pnpm dev                                  # in another terminal
 *   pnpm smoke                                # http://localhost:4610
 *   MOVERS_URL=http://localhost:4710 pnpm smoke
 *
 * Prints which AI mode answered each call (the `x-movers-ai-mode` header) and exits non-zero on any failure.
 * Optional: MOVERS_EXPECT_MODE=mock|binding|gateway fails the run when any AI call was answered by another mode;
 * MOVERS_SMOKE_IMAGE=/path/to/photo.jpg uploads that file instead of the embedded one.
 *
 * Plain Node 22+, no dependencies.
 */
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'

const BASE_URL = (process.env.MOVERS_URL ?? 'http://localhost:4610').replace(/\/+$/, '')
const EXPECT_MODE = process.env.MOVERS_EXPECT_MODE?.trim().toLowerCase() || null
const IMAGE_PATH = process.env.MOVERS_SMOKE_IMAGE || null

const MODE_HEADER = 'x-movers-ai-mode'
const AI_MODES = ['gateway', 'binding', 'mock']
const MAX_CHAT_TURNS = 10
const REQUEST_TIMEOUT_MS = 120_000

// The first answer carries every detail, so a real model can finish in a turn or two. The mock walks its five
// questions in order (origin, destination, date, origin access, destination access), which the next four answer.
const EVERYTHING =
  "Hi, yes I'm ready and I consent to the photo analysis. I'm moving on 2027-01-15 to 456 Oak Ave, Dallas, TX (1st floor, with an elevator) from a 3rd-floor apartment that has no elevator at 123 Main St, Austin, TX"
const ANSWERS = [
  EVERYTHING,
  '456 Oak Ave, Dallas, TX',
  '2027-01-15',
  'My current place is on floor 3 and there is no elevator',
  'The new place is on floor 1 and it has an elevator',
]

// 256x144 JPEG of a street scene with a moving truck, boxes and a sofa (from the landing art).
const EMBEDDED_JPEG_BASE64 = [
  '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',
].join('')

class SmokeFailure extends Error {}

function fail(message) {
  throw new SmokeFailure(message)
}

const modes = []

async function request(label, path, init, { ai = false } = {}) {
  const started = Date.now()
  let response
  try {
    response = await fetch(`${BASE_URL}${path}`, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch (error) {
    const reason = error?.cause?.code ?? error?.cause?.message ?? error?.message ?? String(error)
    fail(`${label}: cannot reach ${BASE_URL}${path} (${reason}). Is the dev stack running? Start it with \`pnpm dev\`.`)
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  const mode = response.headers.get(MODE_HEADER)
  const text = await response.text()
  console.log(`  ${label.padEnd(10)} ${response.status}  ${ai ? `mode=${mode ?? '(none)'}` : ''}  ${seconds}s`)

  if (!response.ok) fail(`${label}: HTTP ${response.status} ${text.slice(0, 500)}`)
  if (ai) {
    if (!AI_MODES.includes(mode)) fail(`${label}: missing or unknown ${MODE_HEADER} header: ${mode}`)
    if (EXPECT_MODE && mode !== EXPECT_MODE) fail(`${label}: answered by "${mode}", expected "${EXPECT_MODE}"`)
    modes.push([label, mode])
  }

  try {
    return JSON.parse(text)
  } catch {
    fail(`${label}: response is not JSON: ${text.slice(0, 200)}`)
  }
}

function postJson(label, path, body, options) {
  const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  return request(label, path, init, options)
}

/** Same extraction as the browser (`extractMoveInfo` in src/components/move-demo/UploadStep.tsx). */
function extractMoveInfo(messages) {
  const last = messages.filter((message) => message.role === 'assistant').at(-1)
  const match = last?.content.match(/```json\s*([\s\S]*?)\s*```/)
  let collected = {}
  try {
    collected = JSON.parse(match?.[1] ?? '{}').data_collected ?? {}
  } catch {
    /* same as the browser: fall through to nulls */
  }
  return {
    distance_miles: collected.estimated_distance_miles ?? null,
    origin_floor: collected.origin_floor ?? null,
    destination_floor: collected.destination_floor ?? null,
    origin_has_elevator: collected.origin_has_elevator ?? null,
    destination_has_elevator: collected.destination_has_elevator ?? null,
  }
}

async function chat() {
  const messages = []
  for (let turn = 0; turn <= MAX_CHAT_TURNS; turn++) {
    const reply = await postJson(`chat[${turn}]`, '/api/chat', { messages }, { ai: true })
    if (typeof reply.content !== 'string' || !reply.content.trim()) fail(`chat[${turn}]: empty content`)
    if (typeof reply.finished !== 'boolean') fail(`chat[${turn}]: "finished" is not a boolean`)
    messages.push({ id: `smoke-${turn}-assistant`, role: 'assistant', content: reply.content })
    if (reply.finished) return messages
    messages.push({ id: `smoke-${turn}-user`, role: 'user', content: ANSWERS[turn] ?? EVERYTHING })
  }
  fail(`chat: not finished after ${MAX_CHAT_TURNS} answers`)
}

async function loadImage() {
  if (!IMAGE_PATH) {
    return { bytes: Buffer.from(EMBEDDED_JPEG_BASE64, 'base64'), name: 'smoke.jpg', type: 'image/jpeg' }
  }
  const types = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }
  const type = types[extname(IMAGE_PATH).toLowerCase()] ?? 'image/jpeg'
  return { bytes: await readFile(IMAGE_PATH), name: basename(IMAGE_PATH), type }
}

async function upload() {
  const image = await loadImage()
  const form = new FormData()
  form.append('images', new Blob([image.bytes], { type: image.type }), image.name)
  const urls = await request('upload', '/api/images/upload', { method: 'POST', body: form })
  if (!Array.isArray(urls) || urls.length !== 1) fail(`upload: expected one URL, got ${JSON.stringify(urls)}`)
  console.log(`             ${image.name}, ${image.bytes.length} bytes`)
  return urls
}

async function main() {
  console.log(`Movers smoke test against ${BASE_URL}${EXPECT_MODE ? ` (expecting mode "${EXPECT_MODE}")` : ''}`)

  const messages = await chat()
  const moveInfo = extractMoveInfo(messages)
  console.log(`             move info: ${JSON.stringify(moveInfo)}`)

  const imageUrls = await upload()

  const analysis = await postJson('analyze', '/api/analyze', { imageUrls }, { ai: true })
  if (!Array.isArray(analysis.items) || analysis.items.length === 0) fail('analyze: no items')
  if (typeof analysis.totalVolumeCubicFeet !== 'number') fail('analyze: totalVolumeCubicFeet is not a number')
  if (typeof analysis.estimatedBoxes?.max !== 'number') fail('analyze: estimatedBoxes.max is not a number')
  const items = analysis.items.map((item) => `${item.count} ${item.type}`).join(', ')
  console.log(`             ${analysis.items.length} item types (${items}), ${analysis.totalVolumeCubicFeet} cu ft`)

  const { price } = await postJson('price', '/api/price', { analysis, moveInfo }, { ai: true })
  if (typeof price?.total !== 'number' || !(price.total > 0)) fail('price: total is not a positive number')
  if (!price.breakdown || typeof price.breakdown !== 'object') fail('price: no breakdown')
  console.log(`             ${price.currency} ${price.total} (${Object.keys(price.breakdown).length} lines)`)

  const chatModes = [...new Set(modes.filter(([label]) => label.startsWith('chat')).map(([, mode]) => mode))]
  const modeOf = (name) => modes.find(([label]) => label === name)?.[1]
  console.log(`\nAI modes: chat=${chatModes.join('+')} analyze=${modeOf('analyze')} price=${modeOf('price')}`)
  if (modes.some(([, mode]) => mode === 'mock')) console.log('Note: the mock answered at least one call (demo data).')
  console.log('SMOKE OK')
}

main().catch((error) => {
  console.error(`\nSMOKE FAILED: ${error instanceof SmokeFailure ? error.message : (error?.stack ?? error)}`)
  process.exit(1)
})
