import { Hono } from 'hono';
import type { Bindings } from '../types';
import { AI_GATEWAY_URL } from '../types';
import type { ChatApiResponse } from '@workspace/data';
import { zChatMessage } from '@workspace/data';

const chat = new Hono<{ Bindings: Bindings }>();

chat.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const { messages } = body;

    if (!Array.isArray(messages)) {
      return c.json({ error: 'messages must be an array' }, 400);
    }

    // Validate messages with Zod
    const validatedMessages = zChatMessage.array().parse(messages);

    // Build conversation context for prompt variables
    const conversation = validatedMessages
      .map((msg) => `${msg.role === 'user' ? 'Customer' : 'Assistant'}: ${msg.content}`)
      .join('\n\n');

    // Call AI Gateway completion endpoint
    const gatewayResponse = await fetch(`${AI_GATEWAY_URL}/v1/completion`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${c.env.AI_GATEWAY_AUTH_TOKEN}`,
        'Content-Type': 'application/json',
        'nxty-project': c.env.AI_GATEWAY_PROJECT_NAME,
      },
      body: JSON.stringify({
        prompt_name: 'system_prompt',
        prompt_variables: {
          conversation,
        },
      }),
    });

    if (!gatewayResponse.ok) {
      const errorText = await gatewayResponse.text();
      throw new Error(`AI Gateway error: ${gatewayResponse.status} ${gatewayResponse.statusText} - ${errorText}`);
    }

    const gatewayData = await gatewayResponse.json() as { completion: string };
    
    // The gateway returns 'completion' field, and the response may contain JSON in markdown code blocks
    const completionText = gatewayData.completion || '';
    
    // Extract the assistant message - it's the text before any JSON code blocks
    // Look for JSON code blocks (```json ... ```)
    const jsonBlockMatch = completionText.match(/```json\s*([\s\S]*?)\s*```/);
    
    let assistantMessage = completionText;
    let parsedSessionData: {
      current_stage?: string;
      data_collected?: Record<string, unknown>;
      next_expected_action?: string;
      readiness_for_next_stage?: boolean;
    } | null = null;
    
    if (jsonBlockMatch) {
      // Extract text before the JSON block for display
      assistantMessage = completionText.substring(0, jsonBlockMatch.index).trim();
      
      // Parse the JSON block
      try {
        parsedSessionData = JSON.parse(jsonBlockMatch[1]!);
      } catch (e) {
        console.error('Failed to parse JSON block:', e);
      }
    }
    
    // Determine if finished based on readiness_for_next_stage from prompt output
    // OR as a fallback, check if all required fields are collected
    const dataCollected = parsedSessionData?.data_collected;
    const isReadyByFields = !!(
      dataCollected?.origin_address &&
      dataCollected?.origin_city &&
      dataCollected?.origin_state &&
      dataCollected?.destination_address &&
      dataCollected?.destination_city &&
      dataCollected?.destination_state &&
      dataCollected?.move_date &&
      dataCollected?.origin_floor != null &&
      dataCollected?.origin_has_elevator != null &&
      dataCollected?.destination_floor != null &&
      dataCollected?.destination_has_elevator != null
    );
    
    const finished = parsedSessionData?.readiness_for_next_stage === true || isReadyByFields;

    // Return FULL content (with JSON) so it's available when messages are sent to /api/estimate
    // Frontend will strip JSON for display purposes
    const apiResponse: ChatApiResponse = {
      content: completionText.trim(), // Keep full content with JSON
      finished,
    };

    return c.json(apiResponse);
  } catch (error) {
    console.error('Chat API error:', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      500
    );
  }
});

export default chat;
