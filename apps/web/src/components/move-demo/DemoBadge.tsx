import { useSyncExternalStore } from 'react'
import { getAnyMocked, subscribeAiMode } from '@/lib/ai-mode-store'

/** Shown only when the offline mock answered at least one AI call. A mocked estimate is never presented as real. */
export function DemoBadge(): JSX.Element | null {
  const mocked = useSyncExternalStore(subscribeAiMode, getAnyMocked, () => false)
  if (!mocked) return null

  return (
    <div
      role="status"
      data-testid="demo-badge"
      className="mx-auto mb-6 w-fit rounded-full border border-amber-400 bg-amber-50 px-4 py-1.5 text-sm font-medium text-amber-900"
    >
      Demo data: AI is mocked locally
    </div>
  )
}
