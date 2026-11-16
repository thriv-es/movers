import { z } from 'zod'
import { type MoveDetails, zMoveDetails, zPhotoInventory } from '../../../src/data'
import { runVision } from './ai-client'
import { type AiMode, resolveRole } from './ai-mode'
import { type ModelAnalysis, mergeAnalyses, parseModelAnalysis } from './analysis-merge'
import { mockAnalysisReply } from './mock'
import type { LinkedPhoto } from './photo-links'
import { photoAssessmentPrompt } from './prompts'
import { withSampleCache } from './sample-cache'
import { visionStatus } from './vision-fingerprint'
import type { Bindings } from './types'

export type PhotoVerdict = 'relevant' | 'unrelated' | 'uncertain'
export interface PhotoAssessment {
  url: string
  status: PhotoVerdict | 'unlinked' | 'unavailable'
  reason: string
  candidates?: ModelAnalysis
}
export interface VisionAssessment {
  analysis: ModelAnalysis
  photos: PhotoAssessment[]
  mode: AiMode
  configRevision: number
  visionRevision: number
  visionFingerprint: string
  cached?: boolean
}

export class AnalysisFormatError extends Error {
  constructor() {
    super('Photo assessment format invalid after retry')
  }
}
export class NoUsableInventoryError extends Error {
  constructor(public readonly photos: PhotoAssessment[]) {
    super('No usable moving inventory')
  }
}

const envelope = z
  .object({
    verdict: z.enum(['relevant', 'unrelated', 'uncertain']),
    reason: z.string().trim().min(1).max(500),
    inventory: z.unknown().optional(),
  })
  .strict()
interface AssessedPhoto {
  verdict: PhotoVerdict
  inventory?: z.infer<typeof zPhotoInventory>
}

function privateDetailMatcher(details: MoveDetails): (text: string) => boolean {
  const normalize = (text: string) =>
    text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  const fragments = new Set<string>()
  for (const location of [details.from, details.to]) {
    if (!location) continue
    // Keep meaningful location phrases, including short street lines/cities/states. Do not blacklist
    // individual address words or house numbers: they can also be ordinary furniture attributes.
    for (const component of [location, ...location.split(/[,;\n]/)]) {
      const normalized = normalize(component)
      if (!/\p{L}/u.test(normalized)) continue
      fragments.add(normalized)
      fragments.add(normalized.replace(/^\d+\s+/, ''))
    }
  }
  if (details.date) {
    const date = normalize(details.date)
    if (date.includes(' ') || /\p{L}/u.test(date)) fragments.add(date)
  }
  // Explicit move-access phrases are context, unlike bare 2/200/true in a furniture label.
  for (const floor of [details.originFloor, details.destinationFloor]) {
    if (floor !== null) fragments.add(`floor ${floor}`)
  }
  if (details.distanceMiles !== null) {
    fragments.add(normalize(`distance ${details.distanceMiles}`))
    fragments.add(normalize(`${details.distanceMiles} miles`))
  }
  for (const elevator of [details.originElevator, details.destinationElevator]) {
    if (elevator !== null) fragments.add(`elevator ${elevator}`)
  }
  return (text) => {
    const normalized = ` ${normalize(text)} `
    return [...fragments].some((fragment) => normalized.includes(` ${fragment} `))
  }
}

function sanitizeInventory(
  inventory: z.infer<typeof zPhotoInventory>,
  isPrivate: (text: string) => boolean,
): z.infer<typeof zPhotoInventory> {
  // Item-level volumes are unavailable. Reject/retry the entire photo rather than dropping an item
  // while retaining its contribution to the model's total. Notes do not contribute to that total.
  if (inventory.items.some((item) => isPrivate(item.type))) throw new Error('Private context in inventory labels')
  return {
    ...inventory,
    ...(inventory.boxes_explanation !== undefined
      ? {
          // Explanations do not need request context; never forward free-form model prose.
          boxes_explanation: 'Box estimate based on visible movable items only.',
        }
      : {}),
    ...(inventory.special_handling
      ? {
          special_handling: inventory.special_handling
            .filter((entry) => !isPrivate(entry.item))
            .map((entry) => ({
              ...entry,
              reason: 'Needs special handling based on visible item characteristics.',
            })),
        }
      : {}),
    ...(inventory.possible_duplicates
      ? { possible_duplicates: inventory.possible_duplicates.filter((entry) => !isPrivate(entry.item)) }
      : {}),
    ...(inventory.unseen_areas ? { unseen_areas: inventory.unseen_areas.filter((area) => !isPrivate(area)) } : {}),
  }
}

function parseAssessment(text: string, isPrivate: (text: string) => boolean): AssessedPhoto | null {
  try {
    const data = envelope.parse(JSON.parse(text))
    if (data.verdict === 'unrelated') return { verdict: data.verdict }
    if (!data.inventory || typeof data.inventory !== 'object' || Array.isArray(data.inventory)) return null
    const parsed = zPhotoInventory.parse(parseModelAnalysis(JSON.stringify(data.inventory)))
    const inventory = sanitizeInventory({ ...parsed, items: mergeAnalyses([parsed]).items }, isPrivate)
    return { verdict: data.verdict, inventory }
  } catch {
    // Neither raw replies nor free-form model reasons are logged or returned: they may echo private details.
    return null
  }
}

const reasons: Record<PhotoVerdict, string> = {
  relevant: 'Photo is consistent with the confirmed move; only detected movable items are included.',
  unrelated: 'Photo does not show inventory relevant to the confirmed move and was excluded.',
  uncertain: 'Photo relevance is uncertain. Candidate items were not added to the confirmed inventory.',
}

/** Link/byte validation belongs to the resolver and must finish before this function or any cache lookup. */
export async function assessPhotos(
  env: Bindings,
  linked: LinkedPhoto[],
  details: MoveDetails,
  sample: boolean,
): Promise<VisionAssessment> {
  const eligible = linked.filter((photo) => photo.status === 'eligible' && photo.image)
  if (!eligible.length) {
    throw new NoUsableInventoryError(
      linked.map(({ url, status, reason }) => ({
        url,
        status: status === 'eligible' ? 'unavailable' : status,
        reason,
      })),
    )
  }
  // Parse again to restrict prompt/cache context to confirmed fields, even for non-route callers.
  const confirmed = zMoveDetails.parse(details)
  const isPrivate = privateDetailMatcher(confirmed)
  const role = await resolveRole(env, 'vision')
  if (!role.available) throw new Error('Vision provider unavailable')
  const prompt = photoAssessmentPrompt(confirmed)
  const { value, cached } = await withSampleCache(
    sample,
    'analyze',
    {
      role: 'vision',
      // Bypass earlier v5 values that could contain unsanitized inventory text.
      inventoryPrivacyVersion: 2,
      backend: role.mode,
      model: role.selection.model,
      configRevision: role.revision,
      moveDetails: confirmed,
      // Only server-validated bundled identities; no receipts, customer URLs, or images enter the cache.
      photos: eligible.map((photo) => new URL(photo.url).pathname),
    },
    async () => {
      const assessments: AssessedPhoto[] = new Array(eligible.length)
      const modes: AiMode[] = new Array(eligible.length)
      let next = 0
      let failed = false
      let failure: unknown
      async function worker() {
        while (!failed && next < eligible.length) {
          const index = next++
          const image = eligible[index]?.image
          if (!image) continue
          try {
            let parsed: AssessedPhoto | null = null
            for (let attempt = 0; attempt < 2; attempt++) {
              const result = await runVision(
                env,
                prompt,
                [image],
                () =>
                  JSON.stringify({
                    verdict: 'relevant',
                    reason: 'Offline demo inventory; not a relevance assessment.',
                    inventory: JSON.parse(mockAnalysisReply(1)),
                  }),
                role,
              )
              modes[index] = result.mode
              parsed = result.texts.length === 1 ? parseAssessment(result.texts[0] ?? '', isPrivate) : null
              if (parsed) break
            }
            if (!parsed) throw new AnalysisFormatError()
            assessments[index] = parsed
          } catch (error) {
            // Stop dequeuing, but drain the at most three in-flight calls before failing the entire batch.
            if (!failed) failure = error
            failed = true
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, eligible.length) }, worker))
      if (failed) throw failure
      return { assessments, mode: modes.includes('mock') ? ('mock' as const) : role.mode }
    },
    (value) =>
      value.mode === role.mode &&
      value.assessments.some((photo) => photo.verdict === 'relevant' && photo.inventory?.items.length),
  )
  let index = 0
  const parts: ModelAnalysis[] = []
  const photos: PhotoAssessment[] = linked.map((photo) => {
    if (photo.status !== 'eligible' || !photo.image) {
      return {
        url: photo.url,
        status: photo.status === 'eligible' ? 'unavailable' : photo.status,
        reason: photo.reason,
      }
    }
    const assessment = value.assessments[index++]
    if (!assessment) throw new AnalysisFormatError()
    if (assessment.verdict === 'relevant' && assessment.inventory?.items.length) parts.push(assessment.inventory)
    return {
      url: photo.url,
      status: assessment.verdict,
      reason:
        value.mode === 'mock'
          ? 'Offline demo data only; photo relevance has not been established.'
          : reasons[assessment.verdict],
      ...(assessment.verdict === 'uncertain' ? { candidates: assessment.inventory } : {}),
    }
  })
  const hasCandidates = photos.some(
    (photo) => photo.status === 'uncertain' && (photo.candidates?.items.length ?? 0) > 0,
  )
  if (!parts.length && !hasCandidates) throw new NoUsableInventoryError(photos)
  return {
    analysis: parts.length
      ? mergeAnalyses(parts)
      : { items: [], total_volume_cubic_feet: 0, estimated_boxes_min: 0, estimated_boxes_max: 0 },
    photos,
    mode: value.mode,
    configRevision: role.revision,
    cached,
    ...(await visionStatus(role)),
  }
}
