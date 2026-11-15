import { describe, expect, it } from 'vitest'
import { type ModelAnalysis, mergeAnalyses, parseModelAnalysis } from '../functions/api/_lib/analysis-merge'

const livingRoom: ModelAnalysis = {
  items: [
    { type: 'Sofa', count: 1 },
    { type: 'floor lamp', count: 2 },
  ],
  total_volume_cubic_feet: 120,
  estimated_boxes_min: 4,
  estimated_boxes_max: 8,
  boxes_explanation: 'Books and decor.',
  special_handling: [{ item: 'TV', reason: 'Fragile screen' }],
  possible_duplicates: [],
  unseen_areas: ['kitchen', 'closets'],
}

const bedroom: ModelAnalysis = {
  items: [
    { type: 'bed', count: 1 },
    { type: 'sofa', count: 1 },
    { type: 'floor lamp', count: 1 },
  ],
  total_volume_cubic_feet: 80,
  estimated_boxes_min: 6,
  estimated_boxes_max: 10,
  boxes_explanation: 'Clothes and linens.',
  special_handling: [
    { item: 'tv', reason: 'Wall mounted' },
    { item: 'mirror', reason: 'Glass' },
  ],
  possible_duplicates: [{ item: 'floor lamp', count: 2 }],
  unseen_areas: ['Kitchen', 'garage'],
}

describe('parseModelAnalysis', () => {
  it('reads the inventory JSON out of a fenced answer', () => {
    const parsed = parseModelAnalysis(
      'Here you go:\n```json\n{"items":[{"type":"sofa","count":1}],"total_volume_cubic_feet":40}\n```',
    )
    expect(parsed.items).toEqual([{ type: 'sofa', count: 1 }])
    expect(parsed.total_volume_cubic_feet).toBe(40)
  })

  it('rejects prose and inventories without items or volume', () => {
    expect(() => parseModelAnalysis('I see a sofa and two lamps.')).toThrow()
    expect(() => parseModelAnalysis('{"total_volume_cubic_feet":40}')).toThrow(/items/)
    expect(() => parseModelAnalysis('{"items":[]}')).toThrow(/total_volume/)
  })
})

describe('mergeAnalyses', () => {
  it('returns a single inventory untouched', () => {
    expect(mergeAnalyses([livingRoom])).toBe(livingRoom)
  })

  it('adds up items by type (case-insensitive), volumes and box estimates', () => {
    const merged = mergeAnalyses([livingRoom, bedroom])
    expect(merged.items).toEqual([
      { type: 'Sofa', count: 2 },
      { type: 'floor lamp', count: 3 },
      { type: 'bed', count: 1 },
    ])
    expect(merged.total_volume_cubic_feet).toBe(200)
    expect(merged.estimated_boxes_min).toBe(10)
    expect(merged.estimated_boxes_max).toBe(18)
    expect(merged.boxes_explanation).toBe('Books and decor. Clothes and linens.')
  })

  it('concatenates and deduplicates the notes', () => {
    const merged = mergeAnalyses([livingRoom, bedroom])
    expect(merged.special_handling).toEqual([
      { item: 'TV', reason: 'Fragile screen' },
      { item: 'mirror', reason: 'Glass' },
    ])
    expect(merged.possible_duplicates).toEqual([{ item: 'floor lamp', count: 2 }])
    expect(merged.unseen_areas).toEqual(['kitchen', 'closets', 'garage'])
  })

  it('leaves the box estimate out when a photo has none, so the route derives it from the volume', () => {
    const { estimated_boxes_min: _min, estimated_boxes_max: _max, ...noBoxes } = bedroom
    const merged = mergeAnalyses([livingRoom, noBoxes])
    expect(merged.estimated_boxes_min).toBeUndefined()
    expect(merged.estimated_boxes_max).toBeUndefined()
  })

  it('counts an item without a count once and skips items without a type', () => {
    const merged = mergeAnalyses([
      {
        items: [
          { type: 'chair', count: 0 },
          { type: '', count: 3 },
        ],
        total_volume_cubic_feet: 5,
      },
      { items: [{ type: 'chair', count: 3 }], total_volume_cubic_feet: 5 },
    ])
    expect(merged.items).toEqual([{ type: 'chair', count: 4 }])
  })

  it('refuses an empty set', () => {
    expect(() => mergeAnalyses([])).toThrow()
  })
})
