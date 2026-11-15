import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const FILES = ['living-room.jpg', 'bedroom.jpg', 'kitchen.jpg']
const FIXTURES = new URL('../test/fixtures/vision/', import.meta.url)
const ALIASES = { couch: 'sofa', chairs: 'dining chair', 'dining chairs': 'dining chair' }

export function score(expected, predicted, aliases = {}) {
  const counts = (items) => {
    const map = new Map()
    for (const item of items) {
      const type = item.type.trim().toLowerCase()
      const key = aliases[type] ?? type
      map.set(key, (map.get(key) ?? 0) + item.count)
    }
    return map
  }
  const gold = counts(expected)
  const actual = counts(predicted)
  let truePositives = 0, falsePositives = 0, falseNegatives = 0, countError = 0
  for (const key of new Set([...gold.keys(), ...actual.keys()])) {
    const want = gold.get(key) ?? 0, got = actual.get(key) ?? 0
    truePositives += Math.min(want, got)
    falsePositives += Math.max(0, got - want)
    falseNegatives += Math.max(0, want - got)
    if (gold.has(key)) countError += Math.abs(want - got)
  }
  return { truePositives, falsePositives, falseNegatives, countError,
    precision: truePositives / (truePositives + falsePositives || 1),
    recall: truePositives / (truePositives + falseNegatives || 1) }
}

function requireItems(items, label) {
  if (!Array.isArray(items) || items.some((item) =>
    !item || typeof item.type !== 'string' || !item.type.trim() || !Number.isSafeInteger(item.count) || item.count <= 0
  )) throw new Error(`${label}: items must have a nonempty type and positive integer count`)
}

function requireThree(entries, label) {
  if (!Array.isArray(entries) || entries.length !== FILES.length ||
      new Set(entries.map((entry) => entry?.file)).size !== FILES.length ||
      entries.some((entry) => !FILES.includes(entry?.file))) {
    throw new Error(`${label}: expected exactly ${FILES.join(', ')}`)
  }
}

function validate(golden, baseline) {
  requireThree(golden?.photos, 'golden photos')
  requireThree(baseline?.analyses, 'baseline analyses')
  for (const photo of golden.photos) {
    requireItems(photo.expected, `${photo.file} expected`)
    if (!Array.isArray(photo.ignored) || photo.ignored.some((type) => typeof type !== 'string' || !type.trim())) {
      throw new Error(`${photo.file} ignored must be an array of nonempty labels`)
    }
  }
  for (const analysis of baseline.analyses) {
    if (typeof analysis.parseOk !== 'boolean') throw new Error(`${analysis.file} parseOk must be boolean`)
    if (analysis.parseOk) requireItems(analysis.items, `${analysis.file} items`)
    else if (analysis.items !== undefined && (!Array.isArray(analysis.items) || analysis.items.length)) {
      throw new Error(`${analysis.file} parseOk:false cannot contain scored items`)
    }
    for (const field of ['latencyMs', 'costUsd']) {
      const value = analysis[field]
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
        throw new Error(`${analysis.file} ${field} must be nonnegative or null`)
      }
    }
  }
  for (const field of ['mode', 'model', 'sampleVersion', 'recordedAt']) {
    if (typeof baseline[field] !== 'string' || !baseline[field].trim()) throw new Error(`baseline ${field} is required`)
  }
  if (Number.isNaN(Date.parse(baseline.recordedAt))) throw new Error('baseline recordedAt must be a date')
}

const canonical = (type, aliases) => {
  const key = type.trim().toLowerCase()
  return aliases[key] ?? key
}

/** Micro-average item counts over the fixed, manually labeled three-photo sample. */
export function evaluate(golden, baseline, aliases = {}) {
  validate(golden, baseline)
  const photos = golden.photos.map((photo) => {
    const analysis = baseline.analyses.find((entry) => entry.file === photo.file)
    const raw = analysis.parseOk ? analysis.items : []
    const seen = new Set()
    let rawDuplicateLabels = 0, rawAliasLabels = 0
    for (const item of raw) {
      const type = item.type.trim().toLowerCase()
      if (Object.hasOwn(aliases, type)) rawAliasLabels++
      const key = canonical(type, aliases)
      if (seen.has(key)) rawDuplicateLabels++
      seen.add(key)
    }
    const ignored = new Set(photo.ignored.map((type) => canonical(type, aliases)))
    const predicted = raw.filter((item) => !ignored.has(canonical(item.type, aliases)))
    return {
      file: photo.file, parseOk: analysis.parseOk, ...score(photo.expected, predicted, aliases),
      rawDuplicateLabels, rawAliasLabels, latencyMs: analysis.latencyMs, costUsd: analysis.costUsd,
    }
  })
  const totals = ['truePositives', 'falsePositives', 'falseNegatives', 'countError', 'rawDuplicateLabels', 'rawAliasLabels']
  const aggregate = Object.fromEntries(totals.map((key) => [key, photos.reduce((sum, photo) => sum + photo[key], 0)]))
  const { truePositives: tp, falsePositives: fp, falseNegatives: fn } = aggregate
  Object.assign(aggregate, {
    precision: tp / (tp + fp || 1), recall: tp / (tp + fn || 1),
    parseFailures: photos.filter((photo) => !photo.parseOk).length,
    latencyMs: photos.every((photo) => photo.latencyMs !== null)
      ? photos.reduce((sum, photo) => sum + photo.latencyMs, 0) : null,
    costUsd: photos.every((photo) => photo.costUsd !== null)
      ? photos.reduce((sum, photo) => sum + photo.costUsd, 0) : null,
  })
  return { mode: baseline.mode, model: baseline.model, sampleVersion: baseline.sampleVersion,
    recordedAt: baseline.recordedAt, aggregate, photos }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const golden = JSON.parse(await readFile(new URL('golden.json', FIXTURES), 'utf8'))
    const baseline = JSON.parse(await readFile(new URL('baseline.json', FIXTURES), 'utf8'))
    console.log(JSON.stringify(evaluate(golden, baseline, ALIASES), null, 2))
  } catch (error) {
    console.error(`Vision evaluation failed: ${error.message}`)
    process.exitCode = 1
  }
}
