import type { EstimateResult } from '@/data'
import { Package, ArrowRight, Pencil } from 'lucide-react'

interface ItemsStepProps {
  estimateResult: EstimateResult | null
  onEdit: () => void
  onNext: () => void
}

const DISPLAY_FONT = "'Source Serif 4', 'Iowan Old Style', Georgia, serif"

export function ItemsStep({ estimateResult, onEdit, onNext }: ItemsStepProps): JSX.Element {
  if (!estimateResult) {
    return (
      <div className="py-8 text-center text-muted-foreground text-sm">
        No items detected. Please try again.
      </div>
    )
  }

  const { items, estimatedBoxes, boxesExplanation } = estimateResult

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="text-eyebrow mb-2">Step 03</p>
        <h2
          className="text-foreground leading-tight mb-1.5"
          style={{ fontFamily: DISPLAY_FONT, fontSize: '26px', fontWeight: 400, fontStyle: 'italic' }}
        >
          Detected items
        </h2>
        <p className="text-muted-foreground text-sm">
          Our AI identified the following from your photos. Edit anything that looks off.
        </p>
      </div>

      {/* Items list */}
      <div className="rounded-xl border border-border overflow-hidden">
        {items.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No items detected.</p>
        ) : (
          <ul>
            {items.map((item, i) => (
              <li
                key={i}
                className="flex justify-between items-center px-4 py-3 text-sm border-b border-border last:border-b-0"
              >
                <span className="font-medium text-foreground capitalize">{item.type}</span>
                <span
                  className="text-xs font-semibold px-2 py-1 rounded-full"
                  style={{ backgroundColor: 'var(--thrive-soft)', color: 'var(--thrive)' }}
                >
                  ×{item.count}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Box estimate */}
      <div
        className="flex items-start gap-3 rounded-xl px-4 py-3.5"
        style={{ backgroundColor: 'hsl(var(--muted))' }}
      >
        <Package className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--thrive)' }} />
        <div>
          <p className="text-sm font-medium text-foreground">
            Estimated boxes: {estimatedBoxes.min}–{estimatedBoxes.max}
          </p>
          {boxesExplanation && (
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{boxesExplanation}</p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onEdit}
          className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full font-medium text-sm border border-border text-foreground hover:bg-muted transition-colors duration-150"
        >
          <Pencil className="w-3.5 h-3.5" />
          Edit items
        </button>
        <button
          onClick={onNext}
          className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full font-medium text-sm text-white btn-lift"
          style={{ backgroundColor: 'var(--thrive)' }}
        >
          Continue
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
