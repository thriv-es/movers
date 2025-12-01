import { Hono } from 'hono';
import type { Bindings } from '../types';
import { AI_GATEWAY_URL } from '../types';
import type { AnalysisResult } from '@workspace/data';
import { zAnalysisResult } from '@workspace/data';
import { extractAndRepairJSON } from '../lib/json-utils';

const analyze = new Hono<{ Bindings: Bindings }>();

/**
 * POST /api/analyze
 * Analyzes images (by URL) and returns detected items, volume, and box estimates.
 * 
 * Request body:
 * {
 *   "imageUrls": ["https://...", "https://..."]
 * }
 * 
 * Response:
 * {
 *   "items": [{ "type": "sofa", "count": 1 }, ...],
 *   "totalVolumeCubicFeet": 450.5,
 *   "estimatedBoxes": { "min": 15, "max": 25 },
 *   "boxesExplanation": "5 packed boxes visible + ..."
 * }
 */
analyze.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const { imageUrls } = body;

    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      return c.json({ error: 'imageUrls must be a non-empty array' }, 400);
    }

    if (imageUrls.length > 10) {
      return c.json({ error: 'Maximum 10 images allowed' }, 400);
    }

    // Fetch images and convert to base64
    const imageBase64Array: string[] = [];
    for (const url of imageUrls) {
      try {
        // If it's a local R2 URL, fetch from the bucket
        const urlObj = new URL(url);
        if (urlObj.pathname.startsWith('/api/images/')) {
          // Decode URL-encoded characters (e.g., Hebrew filenames)
          const key = decodeURIComponent(urlObj.pathname.replace('/api/images/', ''));
          console.log(`DEBUG: Looking up R2 key: ${key}`);
          const object = await c.env.MOVERS_BUCKET.get(key);
          if (!object) {
            console.warn(`Image not found in R2: ${key}`);
            continue;
          }
          const arrayBuffer = await object.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);
          let binary = '';
          for (let i = 0; i < uint8Array.length; i++) {
            binary += String.fromCharCode(uint8Array[i]);
          }
          const base64 = btoa(binary);
          const contentType = object.httpMetadata?.contentType || 'image/jpeg';
          imageBase64Array.push(`data:${contentType};base64,${base64}`);
        } else {
          // External URL - fetch it
          const response = await fetch(url);
          if (!response.ok) {
            console.warn(`Failed to fetch image: ${url}`);
            continue;
          }
          const arrayBuffer = await response.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);
          let binary = '';
          for (let i = 0; i < uint8Array.length; i++) {
            binary += String.fromCharCode(uint8Array[i]);
          }
          const base64 = btoa(binary);
          const contentType = response.headers.get('content-type') || 'image/jpeg';
          imageBase64Array.push(`data:${contentType};base64,${base64}`);
        }
      } catch (fetchError) {
        console.error(`Error fetching image ${url}:`, fetchError);
      }
    }

    if (imageBase64Array.length === 0) {
      return c.json({ error: 'No valid images could be fetched' }, 400);
    }

    // Build prompt variables
    const promptVariables: Record<string, string> = {
      imageCount: imageBase64Array.length.toString(),
    };

    // Call AI Gateway with image_analysis_agent prompt
    console.log('DEBUG: image_analysis_agent request:', JSON.stringify({
      prompt_name: 'image_analysis_agent',
      prompt_variables: promptVariables,
      filesCount: imageBase64Array.length,
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
        prompt_name: 'image_analysis_agent',
        prompt_variables: promptVariables,
        files: imageBase64Array,
        model: 'gpt-4o',
        llm_provider: 'openai',
        max_tokens: 8000,
      }),
    });

    if (!gatewayResponse.ok) {
      const errorText = await gatewayResponse.text();
      console.error('DEBUG: image_analysis_agent FAILED:', {
        status: gatewayResponse.status,
        statusText: gatewayResponse.statusText,
        error: errorText,
      });
      throw new Error(`AI Gateway error: ${gatewayResponse.status} ${gatewayResponse.statusText} - ${errorText}`);
    }

    console.log('DEBUG: image_analysis_agent SUCCESS');
    const gatewayData = await gatewayResponse.json() as { completion: string | object };

    // Parse LLM response
    let llmData: {
      items: Array<{ type: string; count: number }>;
      total_volume_cubic_feet: number;
      estimated_boxes_min?: number;
      estimated_boxes_max?: number;
      boxes_explanation?: string;
    };

    try {
      if (typeof gatewayData.completion === 'object' && gatewayData.completion !== null) {
        llmData = gatewayData.completion as typeof llmData;
      } else {
        const completionText = typeof gatewayData.completion === 'string' ? gatewayData.completion : '';
        llmData = extractAndRepairJSON(completionText);
      }

      if (!llmData.items || !Array.isArray(llmData.items)) {
        throw new Error('Invalid response format: missing items array');
      }
      if (typeof llmData.total_volume_cubic_feet !== 'number') {
        throw new Error('Invalid response format: missing total_volume_cubic_feet');
      }
    } catch (parseError) {
      const errorPreview = typeof gatewayData.completion === 'string'
        ? gatewayData.completion.substring(0, 500)
        : JSON.stringify(gatewayData.completion).substring(0, 500);
      console.error('Failed to parse LLM response:', errorPreview);
      console.error('Parse error:', parseError);
      return c.json({ error: 'Failed to parse AI response' }, 500);
    }

    // Process items
    const items = llmData.items
      .map((item) => ({
        type: item.type || 'unknown',
        count: item.count || 1,
      }))
      .filter(item => item.type && item.type.trim() !== '' && item.count > 0);

    if (items.length === 0) {
      return c.json({ error: 'No items detected in images. Please upload photos with visible items.' }, 400);
    }

    // Calculate box estimates with fallback
    const totalVol = llmData.total_volume_cubic_feet;
    const estimatedBoxesMin = llmData.estimated_boxes_min ?? Math.max(5, Math.ceil((totalVol * 0.3) / 4));
    const estimatedBoxesMax = llmData.estimated_boxes_max ?? Math.max(10, Math.ceil((totalVol * 0.3) / 3));
    const boxesExplanation = llmData.boxes_explanation ?? 'Box estimate based on visible items and standard packing assumptions.';

    console.log('DEBUG: Analysis complete:', {
      itemCount: items.length,
      totalVolume: totalVol,
      boxesMin: estimatedBoxesMin,
      boxesMax: estimatedBoxesMax,
    });

    const result: AnalysisResult = {
      items,
      totalVolumeCubicFeet: totalVol,
      estimatedBoxes: { min: estimatedBoxesMin, max: estimatedBoxesMax },
      boxesExplanation,
    };

    // Validate with Zod
    const validatedResult = zAnalysisResult.parse(result);

    return c.json(validatedResult);
  } catch (error) {
    console.error('Analyze API error:', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      500
    );
  }
});

export default analyze;

