import type { DetectedItem } from '@/data'
import { ArrowRight, CheckCircle } from 'lucide-react'

interface ConfirmStepProps {
  items: DetectedItem[]
  onNext: () => void
}

const DISPLAY_FONT = "'Source Serif 4', 'Iowan Old Style', Georgia, serif"

export function ConfirmStep({ items, onNext }: ConfirmStepProps): JSX.Element {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="text-eyebrow mb-2">Step 03 · Confirm</p>
        <h2
          className="text-foreground leading-tight mb-1.5"
          style={{ fontFamily: DISPLAY_FONT, fontSize: '26px', fontWeight: 400, fontStyle: 'italic' }}
        >
          Confirm your inventory
        </h2>
        <p className="text-muted-foreground text-sm">
          Once confirmed we'll calculate your estimate.
        </p>
      </div>

      {/* Items */}
      <div className="rounded-xl border border-border overflow-hidden">
        {items.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No items in inventory.</p>
        ) : (
          <ul>
            {items.map((item, i) => (
              <li
                key={i}
                className="flex justify-between items-center px-4 py-3 text-sm border-b border-border last:border-b-0"
              >
                <span className="font-medium text-foreground capitalize">{item.type}</span>
                <span className="text-muted-foreground">×{item.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Confirm button */}
      <button
        onClick={onNext}
        className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full font-medium text-base text-white btn-lift"
        style={{ backgroundColor: 'var(--thrive)' }}
      >
        <CheckCircle className="w-4 h-4" />
        Confirm inventory
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  )
}
