import { Hono } from 'hono'
import type { Bindings } from '../_lib/types'
import type { Confidence, PriceRequest, PriceResult } from '../../../src/data'
import { zPriceRequest, zPriceResult } from '../../../src/data'
import { calculatePrice, specialHandlingLines, withRange } from '../_lib/pricing'
import { extractAndRepairJSON } from '../_lib/json-utils'
import { runText } from '../_lib/ai-client'
import { mockPriceReply } from '../_lib/mock'
import { PRICE_EVALUATION_PROMPT, substituteVars } from '../_lib/prompts'
import { withSampleCache } from '../_lib/sample-cache'

const price = new Hono<{ Bindings: Bindings }>()

const show = (value: number | boolean | string | null) => (value === null ? 'null' : String(value))

/** The number of move details the customer left unknown decides the confidence, and so the width of the range. */
function confidenceFromDetails(request: PriceRequest, suggested: unknown): Confidence {
  const { moveDetails } = request
  const unknown = [
    moveDetails.distanceMiles,
    moveDetails.originFloor,
    moveDetails.destinationFloor,
    moveDetails.originElevator,
    moveDetails.destinationElevator,
  ].filter((v) => v === null).length
  const byFields: Confidence = unknown === 0 ? 'high' : unknown <= 2 ? 'medium' : 'low'
  const order: Confidence[] = ['high', 'medium', 'low']
  const model = suggested === 'high' || suggested === 'medium' || suggested === 'low' ? suggested : byFields
  // the less confident of the two wins
  return order[Math.max(order.indexOf(byFields), order.indexOf(model))] ?? 'low'
}

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

    let priceData: {
      total: number
      currency: string
      breakdown: Record<string, number>
      explanation?: string
      confidence?: unknown
    }

    try {
      priceData = extractAndRepairJSON(value.text)
      if (typeof priceData.total !== 'number') throw new Error('Missing total')
      if (!priceData.breakdown || typeof priceData.breakdown !== 'object') throw new Error('Missing breakdown')
    } catch (parseError) {
      console.error('Price parse failed, using fallback:', parseError)
      const boxes = calculatePrice({ items: analysis.items, estimatedBoxes: analysis.estimatedBoxes, pricePerBox })
      const breakdown = { ...boxes.breakdown, ...specialHandlingLines(analysis.specialHandling) }
      const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0)
      const fallback = withRange(
        {
          currency: boxes.currency,
          total,
          breakdown,
          explanation: 'A simplified estimate from the box count and special items; the pricing model did not answer.',
        },
        'low',
      )
      return c.json(zPriceResult.parse({ price: fallback } satisfies PriceResult))
    }

    const confidence = confidenceFromDetails(validatedRequest, priceData.confidence)
    const priced = withRange(
      {
        currency: priceData.currency || 'USD',
        total: priceData.total,
        breakdown: priceData.breakdown,
        explanation: priceData.explanation,
      },
      confidence,
    )

    return c.json(zPriceResult.parse({ price: priced } satisfies PriceResult))
  } catch (error) {
    console.error('Price API error:', error)
    return c.json({ error: error instanceof Error ? error.message : 'Internal server error' }, 500)
  }
})

export default price
