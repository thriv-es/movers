import { Hono } from 'hono';
import { generateText } from 'ai';
import type { Bindings } from '../_lib/types';
import type { AnalysisResult } from '../../../src/data';
import { zAnalysisResult } from '../../../src/data';
import { extractAndRepairJSON } from '../_lib/json-utils';
import { createWorkersAI, VISION_MODEL } from '../_lib/ai';
import { IMAGE_ANALYSIS_PROMPT } from '../_lib/prompts';

const analyze = new Hono<{ Bindings: Bindings }>();

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

    type ImagePart = { data: Uint8Array; mimeType: string };
    const images: ImagePart[] = [];

    for (const url of imageUrls) {
      try {
        const urlObj = new URL(url);
        let arrayBuffer: ArrayBuffer;
        let mimeType: string;

        if (urlObj.pathname.startsWith('/api/images/')) {
          const key = decodeURIComponent(urlObj.pathname.replace('/api/images/', ''));
          const object = await c.env.MOVERS_BUCKET.get(key);
          if (!object) {
            console.warn(`Image not found in R2: ${key}`);
            continue;
          }
          arrayBuffer = await object.arrayBuffer();
          mimeType = object.httpMetadata?.contentType || 'image/jpeg';
        } else {
          const response = await fetch(url);
          if (!response.ok) {
            console.warn(`Failed to fetch image: ${url}`);
            continue;
          }
          arrayBuffer = await response.arrayBuffer();
          mimeType = response.headers.get('content-type') || 'image/jpeg';
        }

        images.push({ data: new Uint8Array(arrayBuffer), mimeType });
      } catch (fetchError) {
        console.error(`Error fetching image ${url}:`, fetchError);
      }
    }

    if (images.length === 0) {
      return c.json({ error: 'No valid images could be fetched' }, 400);
    }

    const ai = createWorkersAI(c.env.CF_AIG_TOKEN);
    const { text } = await generateText({
      model: ai(VISION_MODEL),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: IMAGE_ANALYSIS_PROMPT },
            ...images.map((img) => ({
              type: 'image' as const,
              image: img.data,
              mimeType: img.mimeType,
            })),
          ],
        },
      ],
    });

    let llmData: {
      items: Array<{ type: string; count: number }>;
      total_volume_cubic_feet: number;
      estimated_boxes_min?: number;
      estimated_boxes_max?: number;
      boxes_explanation?: string;
    };

    try {
      llmData = extractAndRepairJSON(text);
      if (!llmData.items || !Array.isArray(llmData.items)) throw new Error('Missing items array');
      if (typeof llmData.total_volume_cubic_feet !== 'number') throw new Error('Missing total_volume_cubic_feet');
    } catch (parseError) {
      console.warn('AI response not in expected format:', text.substring(0, 300));
      return c.json(
        { error: "We couldn't analyze these images. Please try uploading clearer photos of your items.", code: 'ANALYSIS_FAILED' },
        400,
      );
    }

    const items = llmData.items
      .map((item) => ({ type: item.type || 'unknown', count: item.count || 1 }))
      .filter((item) => item.type && item.type.trim() !== '' && item.count > 0);

    if (items.length === 0) {
      return c.json({ error: 'No items detected in images. Please upload photos with visible items.' }, 400);
    }

    const totalVol = llmData.total_volume_cubic_feet;
    const estimatedBoxesMin = llmData.estimated_boxes_min ?? Math.max(5, Math.ceil((totalVol * 0.3) / 4));
    const estimatedBoxesMax = llmData.estimated_boxes_max ?? Math.max(10, Math.ceil((totalVol * 0.3) / 3));
    const boxesExplanation = llmData.boxes_explanation ?? 'Box estimate based on visible items and standard packing assumptions.';

    const result: AnalysisResult = {
      items,
      totalVolumeCubicFeet: totalVol,
      estimatedBoxes: { min: estimatedBoxesMin, max: estimatedBoxesMax },
      boxesExplanation,
    };

    return c.json(zAnalysisResult.parse(result));
  } catch (error) {
    console.error('Analyze API error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal server error' }, 500);
  }
});

export default analyze;
