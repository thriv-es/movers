import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const ACCOUNT_ID = '7a07e0c68a7370f303987cfa95cfcaa6';
const GATEWAY_ID = 'movers';
const GATEWAY_BASE = `https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_ID}/workers-ai/v1`;

export const TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

// Requires one-time acceptance in CF dashboard:
// Workers AI → Model catalog → llama-3.2-11b-vision-instruct → Accept
export const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';

export function createWorkersAI(apiKey: string) {
  return createOpenAICompatible({
    name: 'workers-ai',
    baseURL: GATEWAY_BASE,
    apiKey,
  });
}
