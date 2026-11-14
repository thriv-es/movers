/**
 * The one entry point the AI routes call. It picks the backend (see `ai-mode.ts`), runs the prompt, and returns the
 * model's text together with the mode that actually answered, so routes can label the response.
 */
import { generateText } from 'ai'
import { TEXT_MODEL, VISION_MODEL, createWorkersAI } from './ai'
import { type AiMode, resolveAiMode } from './ai-mode'
import type { Bindings } from './types'

export interface AiImage {
  data: Uint8Array
  mimeType: string
}

export interface AiResult {
  text: string
  mode: AiMode
}

type Backend = Exclude<AiMode, 'mock'>

/** The binding defaults to 256 output tokens, which truncates the JSON the prompts ask for. */
const BINDING_MAX_TOKENS = 2048

function requireBinding(env: Bindings): Ai {
  if (!env.AI) {
    throw new Error('The Workers AI binding is not available: add `[ai] binding = "AI"` to wrangler.toml')
  }
  return env.AI
}

/** Workers AI returns `{ response }`; some models hand back already-parsed JSON instead of a string. */
function readBindingText(output: unknown): string {
  const response = (output as { response?: unknown } | null)?.response
  const text = typeof response === 'string' ? response : response == null ? '' : JSON.stringify(response)
  if (!text.trim()) throw new Error('Workers AI returned an empty response')
  return text
}

function toDataUrl(image: AiImage): string {
  // chunked: spreading a whole photo into String.fromCharCode overflows the call stack
  const CHUNK = 0x8000
  let binary = ''
  for (let offset = 0; offset < image.data.length; offset += CHUNK) {
    binary += String.fromCharCode(...image.data.subarray(offset, offset + CHUNK))
  }
  return `data:${image.mimeType};base64,${btoa(binary)}`
}

async function run(env: Bindings, backends: Record<Backend, () => Promise<string>>, mock: () => string) {
  const { mode, allowMockFallback } = resolveAiMode(env)
  if (mode === 'mock') return { text: mock(), mode } satisfies AiResult

  try {
    return { text: await backends[mode](), mode } satisfies AiResult
  } catch (error) {
    if (!allowMockFallback) throw error
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`[ai] ${mode} call failed, answering with the offline mock (demo data). Reason: ${reason}`)
    return { text: mock(), mode: 'mock' } satisfies AiResult
  }
}

export function runText(env: Bindings, prompt: string, mock: () => string): Promise<AiResult> {
  return run(
    env,
    {
      gateway: async () => {
        const ai = createWorkersAI(env.CF_AIG_TOKEN)
        const { text } = await generateText({ model: ai(TEXT_MODEL), prompt })
        return text
      },
      binding: async () => {
        const output = await requireBinding(env).run(TEXT_MODEL, {
          messages: [{ role: 'user', content: prompt }],
          max_tokens: BINDING_MAX_TOKENS,
        })
        return readBindingText(output)
      },
    },
    mock,
  )
}

export function runVision(env: Bindings, prompt: string, images: AiImage[], mock: () => string): Promise<AiResult> {
  return run(
    env,
    {
      gateway: async () => {
        const ai = createWorkersAI(env.CF_AIG_TOKEN)
        const { text } = await generateText({
          model: ai(VISION_MODEL),
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                ...images.map((img) => ({
                  type: 'image' as const,
                  image: img.data,
                  mimeType: img.mimeType,
                })),
              ],
            },
          ],
        })
        return text
      },
      binding: async () => {
        const output = await requireBinding(env).run(VISION_MODEL, {
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                ...images.map((img) => ({ type: 'image_url', image_url: { url: toDataUrl(img) } })),
              ],
            },
          ],
          max_tokens: BINDING_MAX_TOKENS,
        })
        return readBindingText(output)
      },
    },
    mock,
  )
}
