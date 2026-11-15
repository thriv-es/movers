import { createElement } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReviewStep } from '../src/components/estimate/ReviewStep'
import { type ModelAnalysis, mergeAnalyses, parseModelAnalysis } from '../functions/api/_lib/analysis-merge'
import { IMAGE_ANALYSIS_PROMPT } from '../functions/api/_lib/prompts'
import { canonicalItemType } from '../src/lib/item-aliases'

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

describe('canonicalItemType', () => {
  it.each(['constructor', '__proto__'])('keeps %s as a plain item label', (type) => {
    expect(canonicalItemType(type)).toBe(type)
  })
})

describe('mergeAnalyses', () => {
  it('normalizes a single inventory by value without changing its totals or notes', () => {
    expect(mergeAnalyses([livingRoom])).toEqual({
      ...livingRoom,
      items: [{ type: 'sofa', count: 1 }, { type: 'floor lamp', count: 2 }],
    })
  })

  it('normalizes a one-photo couch alias without changing its count', () => {
    expect(mergeAnalyses([{ items: [{ type: ' couch ', count: 3 }], total_volume_cubic_feet: 10 }]).items)
      .toEqual([{ type: 'sofa', count: 3 }])
  })

  it('combines couch and sofa across photos without losing counts', () => {
    expect(mergeAnalyses([
      { items: [{ type: 'couch', count: 1 }], total_volume_cubic_feet: 10 },
      { items: [{ type: 'sofa', count: 1 }], total_volume_cubic_feet: 10 },
    ]).items).toEqual([{ type: 'sofa', count: 2 }])
  })

  it('adds up items by type (case-insensitive), volumes and box estimates', () => {
    const merged = mergeAnalyses([livingRoom, bedroom])
    expect(merged.items).toEqual([
      { type: 'sofa', count: 2 },
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

describe('review inventory aliases', () => {
  it('adds a couch to the edited sofa row without replacing its name or count', () => {
    const onItemsChange = vi.fn()
    render(createElement(ReviewStep, {
      analysis: {
        items: [{ type: 'sofa', count: 1 }], totalVolumeCubicFeet: 10,
        estimatedBoxes: { min: 1, max: 2 }, boxesExplanation: '',
        specialHandling: [], possibleDuplicates: [], unseenAreas: [],
      },
      items: [{ type: 'Sofa', count: 2 }],
      followUps: { garage: false, closets: false, appliances: false },
      wholeMoveCovered: true,
      onWholeMoveCovered: vi.fn(), onItemsChange, onFollowUp: vi.fn(), onBack: vi.fn(), onConfirm: vi.fn(),
    }))
    fireEvent.change(screen.getByLabelText('Add something we missed'), { target: { value: ' couch ' } })
    fireEvent.change(screen.getByLabelText('Count'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onItemsChange).toHaveBeenCalledWith([{ type: 'Sofa', count: 5 }])
  })
})

describe('image inventory prompt', () => {
  it('does not seed the model with a concrete sample inventory and excludes tiny loose clutter', () => {
    expect(IMAGE_ANALYSIS_PROMPT).not.toContain('{"type": "sofa", "count": 1}')
    expect(IMAGE_ANALYSIS_PROMPT).toMatch(/tiny loose clutter/i)
    expect(IMAGE_ANALYSIS_PROMPT).toContain('possible_duplicates')
    expect(IMAGE_ANALYSIS_PROMPT).toContain('unseen_areas')
  })
})
