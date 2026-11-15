import { expect, it } from 'vitest'
import { evaluate, score } from '../scripts/evaluate-vision.mjs'

it('scores visible items and count error', () => {
  const result = score([{ type: 'sofa', count: 1 }], [{ type: 'couch', count: 1 }, { type: 'piano', count: 1 }], { couch: 'sofa' })
  expect(result).toMatchObject({ truePositives: 1, falsePositives: 1, falseNegatives: 0, precision: 0.5, recall: 1, countError: 0 })
})

it('counts quantity misses without counting unrelated false positives as count error', () => {
  expect(score([{ type: 'sofa', count: 4 }], [{ type: 'SOFA', count: 1 }, { type: 'lamp', count: 2 }])).toEqual({
    truePositives: 1, falsePositives: 2, falseNegatives: 3, countError: 3, precision: 1 / 3, recall: 0.25,
  })
})

const golden = { photos: [
  { file: 'living-room.jpg', expected: [{ type: 'sofa', count: 1 }], ignored: ['tv'] },
  { file: 'bedroom.jpg', expected: [{ type: 'bed', count: 1 }], ignored: ['lamp'] },
  { file: 'kitchen.jpg', expected: [{ type: 'dining chair', count: 2 }], ignored: [] },
] }
const baseline = {
  mode: 'mock', model: 'test fixture', sampleVersion: 'v3', recordedAt: '2026-11-15T16:00:00.000Z',
  analyses: [
    { file: 'living-room.jpg', parseOk: true, items: [
      { type: 'couch', count: 1 }, { type: 'SOFA', count: 1 }, { type: 'tv', count: 1 }, { type: 'piano', count: 1 },
    ], latencyMs: null, costUsd: null },
    { file: 'bedroom.jpg', parseOk: false, latencyMs: null, costUsd: null },
    { file: 'kitchen.jpg', parseOk: true, items: [{ type: 'dining chairs', count: 2 }], latencyMs: null, costUsd: null },
  ],
}

it('filters ignored labels per photo, counts raw duplicate/alias entries, and treats parse failures as misses', () => {
  const result = evaluate(golden, baseline, { couch: 'sofa', 'dining chairs': 'dining chair' })
  expect(result).toMatchObject({
    mode: 'mock', model: 'test fixture', sampleVersion: 'v3', recordedAt: baseline.recordedAt,
    aggregate: { truePositives: 3, falsePositives: 2, falseNegatives: 1,
      precision: 0.6, recall: 0.75, countError: 2, parseFailures: 1,
      rawDuplicateLabels: 1, rawAliasLabels: 2, latencyMs: null, costUsd: null },
    photos: [
      { file: 'living-room.jpg', parseOk: true, truePositives: 1, falsePositives: 2,
        countError: 1, rawDuplicateLabels: 1, rawAliasLabels: 1 },
      { file: 'bedroom.jpg', parseOk: false, falseNegatives: 1, countError: 1 },
      { file: 'kitchen.jpg', parseOk: true, truePositives: 2, rawAliasLabels: 1 },
    ],
  })
})

it('rejects missing or duplicate photo entries and invalid counts', () => {
  const missing = structuredClone(golden)
  missing.photos.pop()
  expect(() => evaluate(missing, baseline)).toThrow(/photos|kitchen/i)

  const duplicate = structuredClone(baseline)
  duplicate.analyses[2].file = 'living-room.jpg'
  expect(() => evaluate(golden, duplicate)).toThrow(/analyses|kitchen|duplicate/i)

  const invalidCount = structuredClone(golden)
  invalidCount.photos[0].expected[0].count = 0
  expect(() => evaluate(invalidCount, baseline)).toThrow(/count/i)

  const failedWithItems = structuredClone(baseline)
  failedWithItems.analyses[1].items = [{ type: 'bed', count: 1 }]
  expect(() => evaluate(golden, failedWithItems)).toThrow(/parseOk|items/i)
})
