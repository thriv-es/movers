/**
 * Parses and merges the vision model's per-photo inventories into one (see `runVision`: the model takes one image
 * per request). Pure functions, so the merge rules are unit tested without a model.
 */
import { canonicalItemType } from '../../../src/lib/item-aliases'
import { extractAndRepairJSON } from './json-utils'

export interface ModelAnalysis {
  items: Array<{ type: string; count: number }>
  total_volume_cubic_feet: number
  estimated_boxes_min?: number
  estimated_boxes_max?: number
  boxes_explanation?: string
  special_handling?: Array<{ item?: unknown; reason?: unknown }>
  possible_duplicates?: Array<{ item?: unknown; count?: unknown }>
  unseen_areas?: unknown[]
}

/** The model's answer for one photo, or a throw when it is not the inventory JSON the prompt asks for. */
export function parseModelAnalysis(text: string): ModelAnalysis {
  const data = extractAndRepairJSON(text) as Partial<ModelAnalysis>
  if (!data.items || !Array.isArray(data.items)) throw new Error('Missing items array')
  if (typeof data.total_volume_cubic_feet !== 'number') throw new Error('Missing total_volume_cubic_feet')
  return data as ModelAnalysis
}

const key = (value: unknown) => (typeof value === 'string' ? value.trim().toLowerCase() : '')

function uniqueBy<T>(entries: T[], by: (entry: T) => string): T[] {
  const seen = new Set<string>()
  return entries.filter((entry) => {
    const k = by(entry)
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/**
 * One inventory for the whole set of photos: item counts and volumes add up, box estimates add up when every photo
 * has one, notes are concatenated and deduplicated. Each photo is a different room, so items are not matched across
 * photos; a room shot twice can double count, which the prompt's `possible_duplicates` already flags per photo.
 */
export function mergeAnalyses(parts: ModelAnalysis[]): ModelAnalysis {
  if (parts.length === 0) throw new Error('No analyses to merge')
  const items = new Map<string, { type: string; count: number }>()
  for (const part of parts) {
    for (const item of part.items) {
      const k = typeof item?.type === 'string' ? canonicalItemType(item.type) : ''
      if (!k) continue
      const count = typeof item.count === 'number' && item.count > 0 ? item.count : 1
      const existing = items.get(k)
      if (existing) existing.count += count
      else items.set(k, { type: k, count })
    }
  }
  if (parts.length === 1) return { ...parts[0]!, items: [...items.values()] }

  const everyHas = (field: 'estimated_boxes_min' | 'estimated_boxes_max') =>
    parts.every((part) => typeof part[field] === 'number')
  const sum = (field: 'estimated_boxes_min' | 'estimated_boxes_max') =>
    parts.reduce((total, part) => total + (part[field] ?? 0), 0)

  const explanations = uniqueBy(
    parts.map((part) => (typeof part.boxes_explanation === 'string' ? part.boxes_explanation.trim() : '')),
    (text) => text.toLowerCase(),
  )

  return {
    items: [...items.values()],
    total_volume_cubic_feet: parts.reduce((total, part) => total + part.total_volume_cubic_feet, 0),
    ...(everyHas('estimated_boxes_min') ? { estimated_boxes_min: sum('estimated_boxes_min') } : {}),
    ...(everyHas('estimated_boxes_max') ? { estimated_boxes_max: sum('estimated_boxes_max') } : {}),
    ...(explanations.length > 0 ? { boxes_explanation: explanations.join(' ') } : {}),
    special_handling: uniqueBy(
      parts.flatMap((part) => (Array.isArray(part.special_handling) ? part.special_handling : [])),
      (entry) => key(entry?.item),
    ),
    possible_duplicates: uniqueBy(
      parts.flatMap((part) => (Array.isArray(part.possible_duplicates) ? part.possible_duplicates : [])),
      (entry) => key(entry?.item),
    ),
    unseen_areas: uniqueBy(
      parts.flatMap((part) => (Array.isArray(part.unseen_areas) ? part.unseen_areas : [])),
      (entry) => key(entry),
    ),
  }
}
