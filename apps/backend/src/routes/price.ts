import { Hono } from 'hono';
import type { Bindings } from '../types';
import { AI_GATEWAY_URL } from '../types';
import type { PriceRequest, PriceResult, Price } from '@workspace/data';
import { zPriceRequest, zPriceResult } from '@workspace/data';
import { calculatePrice } from '../lib/pricing';
import { extractAndRepairJSON } from '../lib/json-utils';

const price = new Hono<{ Bindings: Bindings }>();

/**
 * POST /api/price
 * Calculates pricing based on analysis results and move information.
 * 
 * Request body:
 * {
 *   "analysis": {
 *     "items": [...],
 *     "totalVolumeCubicFeet": 450.5,
 *     "estimatedBoxes": { "min": 15, "max": 25 },
 *     "boxesExplanation": "..."
 *   },
 *   "moveInfo": {
 *     "distance_miles": 50,
 *     "origin_floor": 2,
 *     "destination_floor": 1,
 *     "origin_has_elevator": false,
 *     "destination_has_elevator": true
 *   }
 * }
 * 
 * Response:
 * {
 *   "price": {
 *     "currency": "USD",
 *     "total": 2500,
 *     "breakdown": { ... },
 *     "explanation": "...",
 *     "confidence": "high"
 *   }
 * }
 */
price.post('/', async (c) => {
  try {
    const body = await c.req.json();

    // Validate request body
    const validatedRequest = zPriceRequest.parse(body) as PriceRequest;
    const { analysis, moveInfo } = validatedRequest;

    // Build prompt variables for price_evaluation
    const pricePromptVariables = {
      items: JSON.stringify(analysis.items),
      total_volume_cubic_feet: analysis.totalVolumeCubicFeet.toString(),
      estimated_boxes_min: analysis.estimatedBoxes.min.toString(),
      estimated_boxes_max: analysis.estimatedBoxes.max.toString(),
      distance_miles: moveInfo.distance_miles !== null ? moveInfo.distance_miles.toString() : 'null',
      origin_floor: moveInfo.origin_floor !== null ? moveInfo.origin_floor.toString() : 'null',
      destination_floor: moveInfo.destination_floor !== null ? moveInfo.destination_floor.toString() : 'null',
      origin_has_elevator: moveInfo.origin_has_elevator !== null ? moveInfo.origin_has_elevator.toString() : 'null',
      destination_has_elevator: moveInfo.destination_has_elevator !== null ? moveInfo.destination_has_elevator.toString() : 'null',
      price_per_box: (Number.parseFloat(c.env.PRICE_PER_BOX) || 50).toString(),
    };

    console.log('DEBUG: price_evaluation request:', JSON.stringify({
      prompt_name: 'price_evaluation',
      prompt_variables: pricePromptVariables,
      max_tokens: 8000,
    }, null, 2));

    const gatewayResponse = await fetch(`${AI_GATEWAY_URL}/v1/completion`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${c.env.AI_GATEWAY_AUTH_TOKEN}`,
        'Content-Type': 'application/json',
        'nxty-project': c.env.AI_GATEWAY_PROJECT_NAME,
      },
      body: JSON.stringify({
        prompt_name: 'price_evaluation',
        prompt_variables: pricePromptVariables,
        model: 'gpt-4o',
        llm_provider: 'openai',
        max_tokens: 8000,
      }),
    });

    if (!gatewayResponse.ok) {
      const errorText = await gatewayResponse.text();
      console.error('DEBUG: price_evaluation FAILED:', {
        status: gatewayResponse.status,
        statusText: gatewayResponse.statusText,
        error: errorText,
      });
      // Fallback to simple pricing if LLM fails
      const fallbackPrice = calculatePrice({
        items: analysis.items,
        estimatedBoxes: analysis.estimatedBoxes,
        pricePerBox: Number.parseFloat(c.env.PRICE_PER_BOX) || 50,
      });
      const result: PriceResult = { price: fallbackPrice };
      return c.json(zPriceResult.parse(result));
    }

    const gatewayData = await gatewayResponse.json() as { completion: string | object };
    console.log('DEBUG: price_evaluation raw response:', JSON.stringify(gatewayData).substring(0, 1000));

    // Parse pricing response
    let priceData: {
      total: number;
      currency: string;
      breakdown: Record<string, number>;
      explanation?: string;
      confidence?: 'high' | 'medium' | 'low';
    };

    try {
      if (typeof gatewayData.completion === 'object' && gatewayData.completion !== null) {
        priceData = gatewayData.completion as typeof priceData;
      } else {
        const completionText = typeof gatewayData.completion === 'string' ? gatewayData.completion : '';
        priceData = extractAndRepairJSON(completionText);
      }

      if (typeof priceData.total !== 'number') {
        throw new Error('Invalid price response: missing total');
      }
      if (!priceData.breakdown || typeof priceData.breakdown !== 'object') {
        throw new Error('Invalid price response: missing breakdown');
      }
    } catch (parseError) {
      const errorPreview = typeof gatewayData.completion === 'string'
        ? gatewayData.completion.substring(0, 500)
        : JSON.stringify(gatewayData.completion).substring(0, 500);
      console.error('DEBUG: USING FALLBACK PRICING - parse failed');
      console.error('DEBUG: price_evaluation response preview:', errorPreview);
      console.error('DEBUG: parse error:', parseError);
      // Fallback to simple pricing
      const fallbackPrice = calculatePrice({
        items: analysis.items,
        estimatedBoxes: analysis.estimatedBoxes,
        pricePerBox: Number.parseFloat(c.env.PRICE_PER_BOX) || 50,
      });
      const result: PriceResult = { price: fallbackPrice };
      return c.json(zPriceResult.parse(result));
    }

    console.log('DEBUG: USING LLM PRICING - success!', {
      total: priceData.total,
      breakdownKeys: Object.keys(priceData.breakdown || {}),
      confidence: priceData.confidence,
    });

    const priceResult: Price = {
      currency: priceData.currency || 'USD',
      total: priceData.total,
      breakdown: priceData.breakdown,
      explanation: priceData.explanation,
      confidence: priceData.confidence,
    };

    const result: PriceResult = { price: priceResult };
    const validatedResult = zPriceResult.parse(result);

    return c.json(validatedResult);
  } catch (error) {
    console.error('Price API error:', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      500
    );
  }
});

export default price;

