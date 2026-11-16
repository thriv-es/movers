import type { AnalysisResult, DetectedItem } from '@/data'
import type { EstimateSession } from './estimate-session'
import { canonicalItemType } from './item-aliases'
import { analysisBoxes } from './analysis-boxes'

type Decisions = EstimateSession['photoDecisions']

export function photoEvidence(analysis: AnalysisResult | null, decisions: Decisions) {
  let excludedCount = 0
  let unresolvedCount = 0
  if (analysis?.photoAssessments) {
    for (const photo of analysis.photoAssessments) {
      if (photo.status === 'uncertain') {
        if (decisions[photo.url] === 'exclude') excludedCount++
        else if (decisions[photo.url] !== 'keep') unresolvedCount++
      } else if (photo.status !== 'relevant') excludedCount++
    }
  } else excludedCount = analysis?.photoLinkStatuses?.filter((photo) => photo.status !== 'eligible').length ?? 0
  return { excludedCount, unresolvedCount }
}

/** Always derive from the original relevant inventory: changing a decision cannot double-add candidates. */
export function reviewedAnalysis(analysis: AnalysisResult, decisions: Decisions): AnalysisResult {
  const kept =
    analysis.photoAssessments?.flatMap((photo) =>
      photo.status === 'uncertain' && decisions[photo.url] === 'keep' && photo.candidates ? [photo.candidates] : [],
    ) ?? []
  if (kept.length === 0) return analysis
  const grouped = new Map<string, DetectedItem>()
  for (const item of [...analysis.items, ...kept.flatMap((part) => part.items)]) {
    const type = canonicalItemType(item.type)
    grouped.set(type, { type, count: (grouped.get(type)?.count ?? 0) + item.count })
  }
  const boxes = kept.map((part) =>
    analysisBoxes(part.total_volume_cubic_feet, part.estimated_boxes_min, part.estimated_boxes_max),
  )
  return {
    ...analysis,
    items: [...grouped.values()],
    totalVolumeCubicFeet:
      analysis.totalVolumeCubicFeet + kept.reduce((sum, part) => sum + part.total_volume_cubic_feet, 0),
    estimatedBoxes: {
      min: analysis.estimatedBoxes.min + boxes.reduce((sum, part) => sum + part.min, 0),
      max: analysis.estimatedBoxes.max + boxes.reduce((sum, part) => sum + part.max, 0),
    },
    specialHandling: [...analysis.specialHandling, ...kept.flatMap((part) => part.special_handling ?? [])],
    possibleDuplicates: [...analysis.possibleDuplicates, ...kept.flatMap((part) => part.possible_duplicates ?? [])],
    unseenAreas: [...new Set([...analysis.unseenAreas, ...kept.flatMap((part) => part.unseen_areas ?? [])])],
  }
}

/** Preserve confirmed details/photos, but discard all dependent evidence and customer edits. */
export function clearedAnalysis(): Partial<EstimateSession> {
  return {
    analysis: null,
    items: [],
    photoDecisions: {},
    photoDecisionsLocked: false,
    followUps: { garage: null, closets: null, appliances: null },
    wholeMoveCovered: null,
    price: null,
    estimateId: null,
    contact: null,
  }
}
