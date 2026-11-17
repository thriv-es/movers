import { Badge } from '@movers/ui'
import { useSyncExternalStore } from 'react'
import { getAnyMocked, subscribeAiMode } from '@/lib/ai-mode-store'

/** Shown only when the offline mock answered at least one AI call. A mocked estimate is never presented as real. */
export function DemoBadge(): JSX.Element | null {
  const mocked = useSyncExternalStore(subscribeAiMode, getAnyMocked, () => false)
  if (!mocked) return null

  return (
    <Badge tone="tape" role="status" data-testid="demo-badge" title="The AI models are mocked locally">
      Demo data: AI is mocked locally
    </Badge>
  )
}
