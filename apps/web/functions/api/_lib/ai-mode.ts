import { VISION_MODEL, textModel } from './ai'
import { type AiRole, type AiSelection, type AiSettings, readSavedAiSettings } from './ai-settings'
import type { Bindings } from './types'

/**
 * Pure AI mode resolution: which backend answers the AI routes.
 *
 * - gateway: Cloudflare AI Gateway with `CF_AIG_TOKEN` (the production path)
 * - binding: Workers AI through the `AI` binding (local dev uses the `wrangler login` session)
 * - mock: deterministic offline answers, always labelled as demo data; local dev only (`ENV === 'development'`)
 */
export type AiMode = 'gateway' | 'binding' | 'mock'

export interface AiEnv {
  CF_AIG_TOKEN?: string
  AI?: unknown
  AI_MODE?: string
  ENV?: string
}

export interface AiModeDecision {
  mode: AiMode
  /** When true, a failed gateway/binding call is answered by the mock instead of an error. */
  allowMockFallback: boolean
}

/** The value shipped in `.dev.vars.example`; copying that file unchanged must not count as a token. */
export const PLACEHOLDER_TOKEN = 'your_cloudflare_ai_gateway_token_here'

const FORCED_MODES: readonly AiMode[] = ['gateway', 'binding', 'mock']

function isTokenSet(token: string | undefined): boolean {
  const value = token?.trim()
  return !!value && value !== PLACEHOLDER_TOKEN
}

/**
 * The offline mock is demo data, so it fails closed: it is reachable only when `ENV` is explicitly `development`
 * (`wrangler.toml` sets that for local dev). A preview or production deploy, or one where `ENV` is missing, never
 * serves mocked quotes: a failed call is an error, and a forced `AI_MODE=mock` is ignored.
 */
export function resolveAiMode(env: AiEnv): AiModeDecision {
  const isLocalDev = env.ENV === 'development'

  const requested = env.AI_MODE?.trim().toLowerCase()
  const forced = FORCED_MODES.find((mode) => mode === requested)
  if (forced === 'gateway' || forced === 'binding') return { mode: forced, allowMockFallback: false }
  if (forced === 'mock' && isLocalDev) return { mode: 'mock', allowMockFallback: false }

  // auto (also: a forced mock outside local dev)
  if (isTokenSet(env.CF_AIG_TOKEN)) return { mode: 'gateway', allowMockFallback: isLocalDev }
  if (env.AI) return { mode: 'binding', allowMockFallback: isLocalDev }
  if (isLocalDev) return { mode: 'mock', allowMockFallback: false }
  return { mode: 'gateway', allowMockFallback: false }
}

/** Read local selections per call so a later D1 revision cannot reuse a stale model. */
export async function resolveRole(
  env: Bindings,
  role: AiRole,
): Promise<{ selection: AiSelection; mode: AiMode; available: boolean; revision: number }> {
  const defaultMode = resolveAiMode(env).mode
  const forcedMock = env.ENV === 'development' && env.AI_MODE?.trim().toLowerCase() === 'mock'
  let settings: AiSettings | null = null
  if (env.ENV === 'development' && env.MOVERS_DB) {
    try {
      settings = await readSavedAiSettings(env.MOVERS_DB)
    } catch (error) {
      if (!forcedMock) throw error
    }
  }
  const selection: AiSelection = settings
    ? settings.roles[role]
    : {
        backend: defaultMode === 'binding' ? 'binding' : 'gateway',
        model: role === 'vision' ? VISION_MODEL : textModel(env, role),
      }
  const mode = forcedMock ? 'mock' : (settings?.roles[role].backend ?? defaultMode)
  const available = mode === 'mock' || (mode === 'gateway' ? isTokenSet(env.CF_AIG_TOKEN) : !!env.AI)
  return { selection, mode, available, revision: settings?.revision ?? 0 }
}
