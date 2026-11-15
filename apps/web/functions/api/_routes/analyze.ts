import { Hono } from 'hono'
import type { Bindings } from '../_lib/types'
import type { AnalysisResult } from '../../../src/data'
import { zAnalysisResult, zAnalyzeRequest } from '../../../src/data'
import { extractAndRepairJSON } from '../_lib/json-utils'
import { type AiImage, runVision } from '../_lib/ai-client'
import { mockAnalysisReply } from '../_lib/mock'
import { IMAGE_ANALYSIS_PROMPT } from '../_lib/prompts'
import { withSampleCache } from '../_lib/sample-cache'

const analyze = new Hono<{ Bindings: Bindings }>()

interface ModelAnalysis {
  items: Array<{ type: string; count: number }>
  total_volume_cubic_feet: number
  estimated_boxes_min?: number
  estimated_boxes_max?: number
  boxes_explanation?: string
  special_handling?: Array<{ item?: unknown; reason?: unknown }>
  possible_duplicates?: Array<{ item?: unknown; count?: unknown }>
  unseen_areas?: unknown[]
}

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
    const { value, cached } = await withSampleCache(sample, 'analyze', { count: images.length }, () =>
      runVision(c.env, IMAGE_ANALYSIS_PROMPT, images, () => mockAnalysisReply(images.length)),
    )
    c.header('x-movers-ai-mode', value.mode)
    if (cached) c.header('x-movers-sample-cache', 'hit')

    let llmData: ModelAnalysis
    try {
      llmData = extractAndRepairJSON(value.text)
      if (!llmData.items || !Array.isArray(llmData.items)) throw new Error('Missing items array')
      if (typeof llmData.total_volume_cubic_feet !== 'number') throw new Error('Missing total_volume_cubic_feet')
    } catch {
      console.warn('AI response not in expected format:', value.text.substring(0, 300))
      return c.json(
        {
          error: "We couldn't analyze these images. Please try uploading clearer photos of your items.",
          code: 'ANALYSIS_FAILED',
        },
        400,
      )
    }

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
