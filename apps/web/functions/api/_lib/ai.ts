import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

const ACCOUNT_ID = '7a07e0c68a7370f303987cfa95cfcaa6'
const GATEWAY_ID = 'movers'
const GATEWAY_BASE = `https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_ID}/workers-ai/v1`

/**
 * Default text model for the chat and pricing routes. Override per deployment with the `CHAT_MODEL` and
 * `PRICE_MODEL` vars (wrangler.toml `[vars]` or the Pages dashboard); see `textModel()`.
 * Cheaper options on Workers AI: `@cf/meta/llama-3.1-8b-instruct-fp8-fast` (about 6x cheaper, faster).
 */
export const TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'

// Requires one-time acceptance in CF dashboard:
// Workers AI → Model catalog → llama-3.2-11b-vision-instruct → Accept
export const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct'

export type TextPurpose = 'chat' | 'price'

export interface ModelEnv {
  CHAT_MODEL?: string
  PRICE_MODEL?: string
}

/** The text model for a route: the matching var when set and non-empty, else `TEXT_MODEL`. */
export function textModel(env: ModelEnv, purpose: TextPurpose): string {
  const configured = purpose === 'chat' ? env.CHAT_MODEL : env.PRICE_MODEL
  const value = configured?.trim()
  return value ? value : TEXT_MODEL
}

export function createWorkersAI(apiKey: string) {
  return createOpenAICompatible({
    name: 'workers-ai',
    baseURL: GATEWAY_BASE,
    apiKey,
  })
}
