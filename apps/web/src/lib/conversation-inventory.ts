import type { DetectedItem } from '../data'
import { canonicalItemType } from './item-aliases'

/** Absolute customer counts override image counts (including zero removals), never add them twice. */
export function aggregateConversationInventory(
  base: DetectedItem[],
  overrides: { type: string; count: number }[],
): DetectedItem[] {
  const counts = new Map<string, number>()
  for (const item of base) {
    const type = canonicalItemType(item.type)
    counts.set(type, (counts.get(type) ?? 0) + item.count)
  }
  for (const item of overrides) counts.set(canonicalItemType(item.type), item.count)
  return [...counts].filter(([, count]) => count > 0).map(([type, count]) => ({ type, count }))
}
