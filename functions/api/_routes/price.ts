import { Hono } from 'hono';
import { generateText } from 'ai';
import type { Bindings } from '../_lib/types';
import type { PriceRequest, PriceResult, Price } from '../../../src/data';
import { zPriceRequest, zPriceResult } from '../../../src/data';
import { calculatePrice } from '../_lib/pricing';
import { extractAndRepairJSON } from '../_lib/json-utils';
import { createWorkersAI, TEXT_MODEL } from '../_lib/ai';
import { PRICE_EVALUATION_PROMPT, substituteVars } from '../_lib/prompts';

const price = new Hono<{ Bindings: Bindings }>();

price.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const validatedRequest = zPriceRequest.parse(body) as PriceRequest;
    const { analysis, moveInfo } = validatedRequest;
    const pricePerBox = Number.parseFloat(c.env.PRICE_PER_BOX) || 50;

    const prompt = substituteVars(PRICE_EVALUATION_PROMPT, {
      items: JSON.stringify(analysis.items),
      total_volume_cubic_feet: analysis.totalVolumeCubicFeet.toString(),
      estimated_boxes_min: analysis.estimatedBoxes.min.toString(),
      estimated_boxes_max: analysis.estimatedBoxes.max.toString(),
      distance_miles: moveInfo.distance_miles !== null ? moveInfo.distance_miles.toString() : 'null',
      origin_floor: moveInfo.origin_floor !== null ? moveInfo.origin_floor.toString() : 'null',
      destination_floor: moveInfo.destination_floor !== null ? moveInfo.destination_floor.toString() : 'null',
      origin_has_elevator: moveInfo.origin_has_elevator !== null ? moveInfo.origin_has_elevator.toString() : 'null',
      destination_has_elevator: moveInfo.destination_has_elevator !== null ? moveInfo.destination_has_elevator.toString() : 'null',
      price_per_box: pricePerBox.toString(),
    });

    const ai = createWorkersAI(c.env.CF_AIG_TOKEN);
    const { text } = await generateText({ model: ai(TEXT_MODEL), prompt });

    let priceData: {
      total: number;
      currency: string;
      breakdown: Record<string, number>;
      explanation?: string;
      confidence?: 'high' | 'medium' | 'low';
    };

    try {
      priceData = extractAndRepairJSON(text);
      if (typeof priceData.total !== 'number') throw new Error('Missing total');
      if (!priceData.breakdown || typeof priceData.breakdown !== 'object') throw new Error('Missing breakdown');
    } catch (parseError) {
      console.error('Price parse failed, using fallback:', parseError);
      const fallbackPrice = calculatePrice({ items: analysis.items, estimatedBoxes: analysis.estimatedBoxes, pricePerBox });
      return c.json(zPriceResult.parse({ price: fallbackPrice } satisfies PriceResult));
    }

    const priceResult: Price = {
      currency: priceData.currency || 'USD',
      total: priceData.total,
      breakdown: priceData.breakdown,
      explanation: priceData.explanation,
      confidence: priceData.confidence,
    };

    return c.json(zPriceResult.parse({ price: priceResult } satisfies PriceResult));
  } catch (error) {
    console.error('Price API error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal server error' }, 500);
  }
});

export default price;
