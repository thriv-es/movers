import { Hono } from 'hono'
import type { Bindings } from '../_lib/types'
import type { AnalysisResult } from '../../../src/data'
import { zAnalysisResult, zAnalyzeRequest, zPhotoAssessment } from '../../../src/data'
import { AnalysisFormatError, NoUsableInventoryError, assessPhotos } from '../_lib/vision-assessment'
import { resolvePhotoLinks } from '../_lib/photo-links'
import { analysisBoxes } from '../../../src/lib/analysis-boxes'

const analyze = new Hono<{ Bindings: Bindings }>()

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

analyze.post('/', async (c) => {
  try {
    const parsed = zAnalyzeRequest.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json(
        {
          error: 'Re-upload your photos and analyze again with the confirmed move details.',
          code: 'PHOTO_REUPLOAD_REQUIRED',
        },
        400,
      )
    }
    const { sessionId, photoRefs, moveDetails, sample } = parsed.data
    const linked = await resolvePhotoLinks(c.env, c.req.url, sessionId, photoRefs, sample === true)
    const photoLinkStatuses = linked.map(({ url, status, reason }) => ({ url, status, reason }))
    // Validation always runs before role resolution and sample cache lookup.
    let value: Awaited<ReturnType<typeof assessPhotos>>
    try {
      value = await assessPhotos(c.env, linked, moveDetails, sample === true)
    } catch (error) {
      const photoAssessments =
        error instanceof NoUsableInventoryError
          ? error.photos
          : linked.map((photo) => ({
              url: photo.url,
              status: photo.status === 'eligible' ? ('unavailable' as const) : photo.status,
              reason:
                photo.status === 'eligible'
                  ? 'Photo assessment could not be completed. Please try again.'
                  : photo.reason,
            }))
      if (error instanceof NoUsableInventoryError) {
        return c.json(
          {
            error:
              'No confirmed movable inventory found. Please upload clearer photos of the items being moved and try again.',
            code: 'NO_USABLE_PHOTOS',
            photoLinkStatuses,
            photoAssessments,
          },
          400,
        )
      }
      if (error instanceof AnalysisFormatError) {
        return c.json(
          {
            error: "We couldn't analyze these images. Please try again with clearer photos of your items.",
            code: 'ANALYSIS_FAILED',
            photoLinkStatuses,
            photoAssessments,
          },
          400,
        )
      }
      return c.json(
        { error: 'Photo analysis is temporarily unavailable. Please try again.', photoLinkStatuses, photoAssessments },
        503,
      )
    }
    c.header('x-movers-ai-mode', value.mode)
    if (value.cached) c.header('x-movers-sample-cache', 'hit')

    const llmData = value.analysis

    const items = llmData.items
      .map((item) => ({ type: item.type || 'unknown', count: item.count || 1 }))
      .filter((item) => item.type && item.type.trim() !== '' && item.count > 0)

    const totalVol = llmData.total_volume_cubic_feet
    const estimatedBoxes = analysisBoxes(totalVol, llmData.estimated_boxes_min, llmData.estimated_boxes_max)
    const boxesExplanation =
      llmData.boxes_explanation ?? 'Box estimate based on visible items and standard packing assumptions.'

    const specialHandling = (Array.isArray(llmData.special_handling) ? llmData.special_handling : [])
      .map((e) => ({ item: str(e?.item), reason: str(e?.reason) || 'Needs special handling' }))
      .filter((e) => e.item !== '')
    const possibleDuplicates = (Array.isArray(llmData.possible_duplicates) ? llmData.possible_duplicates : [])
      .map((e) => ({ item: str(e?.item), count: typeof e?.count === 'number' ? Math.round(e.count) : 2 }))
      .filter((e) => e.item !== '' && e.count > 0)
    const unseenAreas = (Array.isArray(llmData.unseen_areas) ? llmData.unseen_areas : []).map(str).filter(Boolean)

    const result: AnalysisResult = {
      visionRevision: value.visionRevision,
      visionFingerprint: value.visionFingerprint,
      photoAssessments: zPhotoAssessment.array().parse(value.photos),
      photoLinkStatuses,
      items,
      totalVolumeCubicFeet: totalVol,
      estimatedBoxes,
      boxesExplanation,
      specialHandling,
      possibleDuplicates,
      unseenAreas,
    }

    return c.json(zAnalysisResult.parse(result))
  } catch {
    return c.json({ error: 'Photo analysis is temporarily unavailable. Please try again.' }, 500)
  }
})

export default analyze
