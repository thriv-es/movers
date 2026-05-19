import { Hono } from 'hono';
import { generateText } from 'ai';
import type { Bindings } from '../_lib/types';
import type { ChatApiResponse } from '../../../src/data';
import { zChatMessage } from '../../../src/data';
import { createWorkersAI, TEXT_MODEL } from '../_lib/ai';
import { SYSTEM_PROMPT, substituteVars } from '../_lib/prompts';

const chat = new Hono<{ Bindings: Bindings }>();

chat.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const { messages } = body;

    if (!Array.isArray(messages)) {
      return c.json({ error: 'messages must be an array' }, 400);
    }

    const validatedMessages = zChatMessage.array().parse(messages);

    const conversation = validatedMessages
      .map((msg) => `${msg.role === 'user' ? 'Customer' : 'Assistant'}: ${msg.content}`)
      .join('\n\n');

    const prompt = substituteVars(SYSTEM_PROMPT, { conversation });

    const ai = createWorkersAI(c.env.CF_AIG_TOKEN);
    const { text } = await generateText({ model: ai(TEXT_MODEL), prompt });

    const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/);

    let parsedSessionData: {
      current_stage?: string;
      data_collected?: Record<string, unknown>;
      next_expected_action?: string;
      readiness_for_next_stage?: boolean;
    } | null = null;

    if (jsonBlockMatch) {
      try {
        parsedSessionData = JSON.parse(jsonBlockMatch[1]!);
      } catch (e) {
        console.error('Failed to parse JSON block:', e);
      }
    }

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

    const apiResponse: ChatApiResponse = { content: text.trim(), finished };
    return c.json(apiResponse);
  } catch (error) {
    console.error('Chat API error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal server error' }, 500);
  }
});

export default chat;
