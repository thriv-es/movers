import type { EstimateResult } from '@/data'
import { ArrowRight, Package } from 'lucide-react'

interface PriceStepProps {
  estimateResult: EstimateResult | null
  onNext: () => void
}

const DISPLAY_FONT = "'Source Serif 4', 'Iowan Old Style', Georgia, serif"

const CONFIDENCE_LABEL: Record<string, string> = {
  high:   'High confidence',
  medium: 'Medium confidence',
  low:    'Low confidence',
}

const CONFIDENCE_COLOR: Record<string, string> = {
  high:   'var(--thrive)',
  medium: 'var(--sun)',
  low:    '#ef4444',
}

export function PriceStep({ estimateResult, onNext }: PriceStepProps): JSX.Element {
  if (!estimateResult) {
    return (
      <div className="py-8 text-center text-muted-foreground text-sm">
        No estimate available. Please try again.
      </div>
    )
  }

  const { price, estimatedBoxes, boxesExplanation } = estimateResult
  const confColor = CONFIDENCE_COLOR[price.confidence ?? 'medium'] ?? CONFIDENCE_COLOR['medium']

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="text-eyebrow mb-2">Step 04</p>
        <h2
          className="text-foreground leading-tight"
          style={{ fontFamily: DISPLAY_FONT, fontSize: '26px', fontWeight: 400, fontStyle: 'italic' }}
        >
          Your moving estimate
        </h2>
      </div>

      {/* Price hero */}
      <div
        className="rounded-xl px-6 py-8 text-center"
        style={{ backgroundColor: 'var(--thrive-soft)' }}
      >
        <p className="text-eyebrow mb-2">Total estimate</p>
        <p
          className="text-foreground leading-none mb-3"
          style={{ fontFamily: DISPLAY_FONT, fontSize: 'clamp(48px, 10vw, 72px)', fontWeight: 400 }}
        >
          ${price.total.toLocaleString()}
          <span className="text-muted-foreground text-lg font-normal ml-1">{price.currency}</span>
        </p>
        {price.confidence && (
          <span
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full"
            style={{ backgroundColor: `${confColor}20`, color: confColor }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: confColor }} />
            {CONFIDENCE_LABEL[price.confidence] ?? price.confidence}
          </span>
        )}
      </div>

      {/* Breakdown */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-sm font-semibold text-foreground">Breakdown</p>
        </div>
        <ul>
          {Object.entries(price.breakdown).map(([key, value]) => (
            <li key={key} className="flex justify-between items-center px-4 py-3 text-sm border-b border-border last:border-b-0">
              <span className="text-muted-foreground capitalize">{key}</span>
              <span className="font-medium text-foreground">${Number(value).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Explanation */}
      {price.explanation && (
        <div className="rounded-xl border border-border px-4 py-4">
          <p className="text-xs font-semibold text-foreground uppercase tracking-wide mb-2">How we calculated this</p>
          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{price.explanation}</p>
        </div>
      )}

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

      {/* Continue */}
      <button
        onClick={onNext}
        className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full font-medium text-base text-white btn-lift"
        style={{ backgroundColor: 'var(--thrive)' }}
      >
        Continue to scheduling
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  )
}
