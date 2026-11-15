import { Hono } from 'hono'
import type { Bindings } from '../_lib/types'
import type { PriceResult } from '../../../src/data'
import { zPriceRequest, zPriceResult } from '../../../src/data'
import { withRange } from '../_lib/pricing'
import { priceConfidence } from '../_lib/price-confidence'
import { extractAndRepairJSON } from '../_lib/json-utils'
import { normalizePriceReply, PriceFormatError } from '../_lib/price-normalization'
import { runText } from '../_lib/ai-client'
import { mockPriceReply } from '../_lib/mock'
import { PRICE_EVALUATION_PROMPT, substituteVars } from '../_lib/prompts'
import { withSampleCache } from '../_lib/sample-cache'

const price = new Hono<{ Bindings: Bindings }>()

const show = (value: number | boolean | string | null) => (value === null ? 'null' : String(value))

price.post('/', async (c) => {
  try {
    const body = await c.req.json().catch(() => null)
    const parsed = zPriceRequest.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid price request', issues: parsed.error.issues }, 400)
    }
    const validatedRequest = parsed.data
    const { analysis, moveDetails, sample } = validatedRequest
    const pricePerBox = Number.parseFloat(c.env.PRICE_PER_BOX) || 50

    const prompt = substituteVars(PRICE_EVALUATION_PROMPT, {
      items: JSON.stringify(analysis.items),
      special_handling: JSON.stringify(analysis.specialHandling),
      total_volume_cubic_feet: analysis.totalVolumeCubicFeet.toString(),
      estimated_boxes_min: analysis.estimatedBoxes.min.toString(),
      estimated_boxes_max: analysis.estimatedBoxes.max.toString(),
      distance_miles: show(moveDetails.distanceMiles),
      origin_floor: show(moveDetails.originFloor),
      destination_floor: show(moveDetails.destinationFloor),
      origin_has_elevator: show(moveDetails.originElevator),
      destination_has_elevator: show(moveDetails.destinationElevator),
      price_per_box: pricePerBox.toString(),
    })

    const { value, cached } = await withSampleCache(sample, 'price', { analysis, moveDetails, pricePerBox }, () =>
      runText(c.env, prompt, () => mockPriceReply(validatedRequest, pricePerBox), 'price'),
    )
    c.header('x-movers-ai-mode', value.mode)
    if (cached) c.header('x-movers-sample-cache', 'hit')

    let priceData: ReturnType<typeof normalizePriceReply>
    try {
      let raw: unknown
      try {
        raw = extractAndRepairJSON(value.text)
      } catch {
        throw new PriceFormatError('Invalid price JSON')
      }
      priceData = normalizePriceReply(raw, analysis.items.length > 0)
    } catch (error) {
      if (!(error instanceof PriceFormatError)) throw error
      return c.json({ code: 'PRICE_UNAVAILABLE', error: 'Pricing is temporarily unavailable. Please retry.' }, 503)
    }

    const verdict = priceConfidence(validatedRequest, priceData.confidence)
    const { currency, total, breakdown, explanation } = priceData
    const priced = withRange(
      { currency, total, breakdown, explanation, confidenceReasons: verdict.reasons },
      verdict.level,
    )

    return c.json(zPriceResult.parse({ price: priced } satisfies PriceResult))
  } catch (error) {
    console.error('Price API error:', error)
    return c.json({ error: error instanceof Error ? error.message : 'Internal server error' }, 500)
  }
})

export default price
