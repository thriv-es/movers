/**
 * Tiny subscribe/get store recording whether any AI answer in this session came from the offline mock.
 * The API labels every AI response with `x-movers-ai-mode`; `api-client.ts` feeds the header in here and
 * `DemoBadge` reads it. Once mocked data has been shown, it stays flagged for the rest of the session.
 */
export type AiMode = 'gateway' | 'binding' | 'mock'

export const AI_MODE_HEADER = 'x-movers-ai-mode'

let mocked = false
const listeners = new Set<() => void>()

export function recordAiMode(response: Pick<Response, 'headers'>): void {
  if (response.headers.get(AI_MODE_HEADER) === 'mock' && !mocked) {
    mocked = true
    for (const listener of listeners) listener()
  }
}

export function subscribeAiMode(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getAnyMocked(): boolean {
  return mocked
}

/** Test helper: reset between tests. */
export function resetAiModeStore(): void {
  mocked = false
  for (const listener of listeners) listener()
}
