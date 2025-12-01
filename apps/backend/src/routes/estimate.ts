import { Hono } from 'hono';
import type { Bindings } from '../types';
import { AI_GATEWAY_URL } from '../types';
import type { ChatMessage, EstimateResult, MoveInfo } from '@workspace/data';
import { zChatMessage, zEstimateResult } from '@workspace/data';
import { calculatePrice } from '../lib/pricing';
import { extractAndRepairJSON } from '../lib/json-utils';

const estimate = new Hono<{ Bindings: Bindings }>();

estimate.post('/', async (c) => {
  try {
    const formData = await c.req.formData();
    const messagesJson = formData.get('messages');
    const imageEntries = formData.getAll('images');
    const images: File[] = [];
    for (const entry of imageEntries) {

      if (entry && typeof entry !== 'string' && 'arrayBuffer' in entry) {
        images.push(entry as File);
      }
    }

    if (!messagesJson || typeof messagesJson !== 'string') {
      return c.json({ error: 'messages field is required' }, 400);
    }

    if (!images || images.length === 0 || images.length > 5) {
      return c.json({ error: '1-5 images are required' }, 400);
    }

    // Parse and validate messages
    const messages = JSON.parse(messagesJson) as ChatMessage[];
    const validatedMessages = zChatMessage.array().parse(messages);

    // Convert images to base64 data URIs
    const imageBase64Array: string[] = [];
    for (const image of images) {
      const arrayBuffer = await image.arrayBuffer();
      // Convert ArrayBuffer to Uint8Array, then to base64
      const uint8Array = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < uint8Array.length; i++) {
        binary += String.fromCharCode(uint8Array[i]);
      }
      const base64 = btoa(binary);
      const mimeType = image.type || 'image/jpeg';
      imageBase64Array.push(`data:${mimeType};base64,${base64}`);
    }

    // Extract structured move info from assistant messages (system_prompt output)
    let moveInfoForVariables: Partial<MoveInfo> | null = null;
    const assistantMessages = validatedMessages.filter(msg => msg.role === 'assistant');
    const lastAssistantMessage = assistantMessages[assistantMessages.length - 1];
    
    if (lastAssistantMessage) {
      const jsonBlockMatch = lastAssistantMessage.content.match(/```json\s*([\s\S]*?)\s*```/);
      
      if (jsonBlockMatch) {
        try {
          const sessionData = JSON.parse(jsonBlockMatch[1]!) as {
            data_collected?: {
              origin_floor?: number;
              origin_has_elevator?: boolean;
              destination_floor?: number;
              destination_has_elevator?: boolean;
              estimated_distance_miles?: number;
            };
          };
          
          if (sessionData.data_collected) {
            const data = sessionData.data_collected;
            moveInfoForVariables = {
              distance_miles: data.estimated_distance_miles ?? null,
              origin_floor: data.origin_floor ?? null,
              destination_floor: data.destination_floor ?? null,
              origin_has_elevator: data.origin_has_elevator ?? null,
              destination_has_elevator: data.destination_has_elevator ?? null,
            };
          }
        } catch (e) {
          console.error('Failed to parse session data from last message:', e);
        }
      }
    }

    const filesField = imageBase64Array;

    const moveInfo: MoveInfo = moveInfoForVariables ? {
      distance_miles: moveInfoForVariables.distance_miles ?? null,
      origin_floor: moveInfoForVariables.origin_floor ?? null,
      destination_floor: moveInfoForVariables.destination_floor ?? null,
      origin_has_elevator: moveInfoForVariables.origin_has_elevator ?? null,
      destination_has_elevator: moveInfoForVariables.destination_has_elevator ?? null,
    } : {
      distance_miles: null,
      origin_floor: null,
      destination_floor: null,
      origin_has_elevator: null,
      destination_has_elevator: null,
    };
    
    // Build prompt variables for image analysis
    const promptVariables: Record<string, string> = {
      imageCount: images.length.toString(),
    };

    console.log('DEBUG: image_analysis_agent request:', JSON.stringify({
      prompt_name: 'image_analysis_agent',
      prompt_variables: promptVariables,
      filesCount: Array.isArray(filesField) ? filesField.length : 1,
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
        files: filesField,
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
    
    // Handle both string and object responses from AI Gateway
    let llmData: {
      items: Array<{ type: string; count: number }>;
      total_volume_cubic_feet: number;
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
      return c.json({ error: 'Failed to parse LLM response' }, 500);
    }

    const items = llmData.items.map((item) => ({
      type: item.type || 'unknown',
      count: item.count || 1,
    }));

    if (items.length === 0) {
      return c.json({ error: 'No items detected in images. Please upload photos with visible items.' }, 400);
    }

    const validItems = items.filter(item => item.type && item.type.trim() !== '' && item.count > 0);
    if (validItems.length === 0) {
      return c.json({ error: 'No valid items detected. Please try uploading different photos.' }, 400);
    }

    // Calculate estimated boxes from volume
    const totalVol = llmData.total_volume_cubic_feet;
    // Estimate: ~3-4 cu ft per box, add 20% buffer for packing materials
    const estimatedBoxesMin = Math.max(5, Math.ceil((totalVol * 1.2) / 4));
    const estimatedBoxesMax = Math.max(10, Math.ceil((totalVol * 1.2) / 3));

    const pricePromptVariables = {
      items: JSON.stringify(validItems),
      total_volume_cubic_feet: totalVol.toString(),
      estimated_boxes_min: estimatedBoxesMin.toString(),
      estimated_boxes_max: estimatedBoxesMax.toString(),
      distance_miles: moveInfo.distance_miles !== null ? moveInfo.distance_miles.toString() : 'null',
      origin_floor: moveInfo.origin_floor !== null ? moveInfo.origin_floor.toString() : 'null',
      destination_floor: moveInfo.destination_floor !== null ? moveInfo.destination_floor.toString() : 'null',
      origin_has_elevator: moveInfo.origin_has_elevator !== null ? moveInfo.origin_has_elevator.toString() : 'null',
      destination_has_elevator: moveInfo.destination_has_elevator !== null ? moveInfo.destination_has_elevator.toString() : 'null',
      price_per_box: (Number.parseFloat(c.env.PRICE_PER_BOX) || 50).toString(),
    };

    // Call price_evaluation prompt for LLM-based pricing
    console.log('DEBUG: price_evaluation request:', JSON.stringify({
      prompt_name: 'price_evaluation',
      prompt_variables: pricePromptVariables,
      max_tokens: 8000,
    }, null, 2));
    
    const priceGatewayResponse = await fetch(`${AI_GATEWAY_URL}/v1/completion`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${c.env.AI_GATEWAY_AUTH_TOKEN}`,
        'Content-Type': 'application/json',
        'nxty-project': c.env.AI_GATEWAY_PROJECT_NAME,
      },
      body: JSON.stringify({
        prompt_name: 'price_evaluation',
        prompt_variables: pricePromptVariables,
        max_tokens: 8000,
      }),
    });

    if (!priceGatewayResponse.ok) {
      const errorText = await priceGatewayResponse.text();
      console.error('DEBUG: price_evaluation FAILED:', {
        status: priceGatewayResponse.status,
        statusText: priceGatewayResponse.statusText,
        error: errorText,
      });
      // Fallback to simple pricing if LLM fails
      const priceResult = calculatePrice({
        items: validItems,
        estimatedBoxes: { min: estimatedBoxesMin, max: estimatedBoxesMax },
        pricePerBox: Number.parseFloat(c.env.PRICE_PER_BOX) || 50,
      });
      const estimateResult: EstimateResult = {
        items: validItems,
        estimatedBoxes: { min: estimatedBoxesMin, max: estimatedBoxesMax },
        price: priceResult,
      };
      const validatedResult = zEstimateResult.parse(estimateResult);
      return c.json(validatedResult);
    }

    const priceGatewayData = await priceGatewayResponse.json() as { completion: string | object };
    
    console.log('DEBUG: price_evaluation raw response:', JSON.stringify(priceGatewayData).substring(0, 1000));
    
    // Parse pricing response
    let priceData: {
      total: number;
      currency: string;
      breakdown: Record<string, number>;
      explanation?: string;
      confidence?: 'high' | 'medium' | 'low';
    };

    try {
      if (typeof priceGatewayData.completion === 'object' && priceGatewayData.completion !== null) {
        priceData = priceGatewayData.completion as typeof priceData;
      } else {
        const priceCompletionText = typeof priceGatewayData.completion === 'string' ? priceGatewayData.completion : '';
        priceData = extractAndRepairJSON(priceCompletionText);
      }
      
      // Validate pricing structure
      if (typeof priceData.total !== 'number') {
        throw new Error('Invalid price response: missing total');
      }
      if (!priceData.breakdown || typeof priceData.breakdown !== 'object') {
        throw new Error('Invalid price response: missing breakdown');
      }
    } catch (priceParseError) {
      const errorPreview = typeof priceGatewayData.completion === 'string' 
        ? priceGatewayData.completion.substring(0, 500)
        : JSON.stringify(priceGatewayData.completion).substring(0, 500);
      console.error('DEBUG: USING FALLBACK PRICING - parse failed');
      console.error('DEBUG: price_evaluation response preview:', errorPreview);
      console.error('DEBUG: parse error:', priceParseError);
      // Fallback to simple pricing
      const priceResult = calculatePrice({
        items: validItems,
        estimatedBoxes: { min: estimatedBoxesMin, max: estimatedBoxesMax },
        pricePerBox: Number.parseFloat(c.env.PRICE_PER_BOX) || 50,
      });
      const estimateResult: EstimateResult = {
        items: validItems,
        estimatedBoxes: { min: estimatedBoxesMin, max: estimatedBoxesMax },
        price: priceResult,
      };
      const validatedResult = zEstimateResult.parse(estimateResult);
      return c.json(validatedResult);
    }

    // Build price result from LLM response
    console.log('DEBUG: USING LLM PRICING - success!', {
      total: priceData.total,
      breakdownKeys: Object.keys(priceData.breakdown || {}),
      confidence: priceData.confidence,
    });
    
    const priceResult = {
      currency: priceData.currency || 'USD',
      total: priceData.total,
      breakdown: priceData.breakdown,
      explanation: priceData.explanation,
      confidence: priceData.confidence,
    };

    const estimateResult: EstimateResult = {
      items: validItems,
      estimatedBoxes: { min: estimatedBoxesMin, max: estimatedBoxesMax },
      price: priceResult,
    };

    // Validate with Zod
    const validatedResult = zEstimateResult.parse(estimateResult);

    return c.json(validatedResult);
  } catch (error) {
    console.error('Estimate API error:', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      500
    );
  }
});

export default estimate;

