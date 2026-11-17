import { Hono } from 'hono'
import type { Bindings } from '../_lib/types'
import type { AnalysisResult } from '../../../src/data'
import { zAnalysisResult, zAnalyzeRequest } from '../../../src/data'
import { type AiImage, runVision } from '../_lib/ai-client'
import { type ModelAnalysis, mergeAnalyses, parseModelAnalysis } from '../_lib/analysis-merge'
import { mockAnalysisReply } from '../_lib/mock'
import { IMAGE_ANALYSIS_PROMPT } from '../_lib/prompts'
import { withSampleCache } from '../_lib/sample-cache'

const analyze = new Hono<{ Bindings: Bindings }>()

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

async function fetchImages(c: { env: Bindings }, imageUrls: string[]): Promise<AiImage[]> {
  const images: AiImage[] = []
  for (const url of imageUrls) {
    try {
      const urlObj = new URL(url)
      let arrayBuffer: ArrayBuffer
      let mimeType: string

      if (urlObj.pathname.startsWith('/api/images/')) {
        const key = decodeURIComponent(urlObj.pathname.replace('/api/images/', ''))
        const object = await c.env.MOVERS_BUCKET.get(key)
        if (!object) {
          console.warn(`Image not found in R2: ${key}`)
          continue
        }
        arrayBuffer = await object.arrayBuffer()
        mimeType = object.httpMetadata?.contentType || 'image/jpeg'
      } else {
        const response = await fetch(url)
        if (!response.ok) {
          console.warn(`Failed to fetch image: ${url}`)
          continue
        }
        arrayBuffer = await response.arrayBuffer()
        mimeType = response.headers.get('content-type') || 'image/jpeg'
      }

      images.push({ data: new Uint8Array(arrayBuffer), mimeType })
    } catch (fetchError) {
      console.error(`Error fetching image ${url}:`, fetchError)
    }
  }
  return images
}

interface PhotoAnalysis {
  analysis: ModelAnalysis
  mode: string
}

/** A photo's answer was not the inventory JSON even after one retry. Thrown, so the sample cache never stores it. */
class AnalysisFormatError extends Error {}

/**
 * One vision call per photo (the model takes a single image), merged into one inventory. A photo whose answer is not
 * valid inventory JSON is asked once more; the model's output format is not deterministic.
 */
async function analyzePhotos(env: Bindings, images: AiImage[]): Promise<PhotoAnalysis> {
  const first = await runVision(env, IMAGE_ANALYSIS_PROMPT, images, () => mockAnalysisReply(images.length))
  const parts = first.texts.map(tryParse)

  // the mock answers once for all photos, so a retry only makes sense when there is one answer per photo
  if (first.texts.length === images.length) {
    for (const [index, part] of parts.entries()) {
      if (part || !images[index]) continue
      const retry = await runVision(env, IMAGE_ANALYSIS_PROMPT, [images[index]], () => mockAnalysisReply(1))
      parts[index] = tryParse(retry.texts[0] ?? '')
    }
  }

  const good = parts.filter((part): part is ModelAnalysis => part !== null)
  if (good.length !== parts.length) throw new AnalysisFormatError(`${parts.length - good.length} photo(s) not analyzed`)
  return { analysis: mergeAnalyses(good), mode: first.mode }
}

function tryParse(text: string): ModelAnalysis | null {
  try {
    return parseModelAnalysis(text)
  } catch {
    console.warn('AI response not in expected format:', text.substring(0, 300))
    return null
  }
}

analyze.post('/', async (c) => {
  try {
    const parsed = zAnalyzeRequest.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: 'imageUrls must be an array of 1 to 10 image URLs' }, 400)
    }
    const { imageUrls, sample } = parsed.data

    const images = await fetchImages(c, imageUrls)
    if (images.length === 0) {
      return c.json({ error: 'No valid images could be fetched' }, 400)
    }

    // the sample photos never change, so their analysis is keyed on the sample version and image count only
    let value: PhotoAnalysis
    let cached: boolean
    try {
      ;({ value, cached } = await withSampleCache(sample, 'analyze', { count: images.length }, () =>
        analyzePhotos(c.env, images),
      ))
    } catch (error) {
      if (!(error instanceof AnalysisFormatError)) throw error
      return c.json(
        {
          error: "We couldn't analyze these images. Please try uploading clearer photos of your items.",
          code: 'ANALYSIS_FAILED',
        },
        400,
      )
    }
    c.header('x-movers-ai-mode', value.mode)
    if (cached) c.header('x-movers-sample-cache', 'hit')

    const llmData = value.analysis

    const items = llmData.items
      .map((item) => ({ type: item.type || 'unknown', count: item.count || 1 }))
      .filter((item) => item.type && item.type.trim() !== '' && item.count > 0)

    if (items.length === 0) {
      return c.json({ error: 'No items detected in images. Please upload photos with visible items.' }, 400)
    }

    const totalVol = llmData.total_volume_cubic_feet
    const estimatedBoxesMin = llmData.estimated_boxes_min ?? Math.max(5, Math.ceil((totalVol * 0.3) / 4))
    const estimatedBoxesMax = llmData.estimated_boxes_max ?? Math.max(10, Math.ceil((totalVol * 0.3) / 3))
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
      items,
      totalVolumeCubicFeet: totalVol,
      estimatedBoxes: { min: estimatedBoxesMin, max: estimatedBoxesMax },
      boxesExplanation,
      specialHandling,
      possibleDuplicates,
      unseenAreas,
    }

    return c.json(zAnalysisResult.parse(result))
  } catch (error) {
    console.error('Analyze API error:', error)
    return c.json({ error: error instanceof Error ? error.message : 'Internal server error' }, 500)
  }
})

export default analyze
