import type { EstimateResult } from '@workspace/data'
import { Button } from '@workspace/react-ui/components/ui/button'

interface PriceStepProps {
  estimateResult: EstimateResult | null
  onNext: () => void
}

export function PriceStep({ estimateResult, onNext }: PriceStepProps): JSX.Element {
  console.log('PriceStep: Component rendered, estimateResult =', estimateResult ? 'exists' : 'null')
  
  if (!estimateResult) {
    console.warn('PriceStep: estimateResult is null, showing error message')
    return (
      <div>
        <p>No estimate available. Please try again.</p>
      </div>
    )
  }

  const { price, estimatedBoxes } = estimateResult

  // Debug: Log price object to see if explanation exists
  console.log('PriceStep: price object:', { 
    total: price.total, 
    hasExplanation: !!price.explanation, 
    explanation: price.explanation?.substring(0, 100),
    confidence: price.confidence,
    breakdown: Object.keys(price.breakdown || {})
  })

  return (
    <div className="space-y-6">
      <h2 className="~text-xl/2xl font-bold">Your Moving Estimate</h2>

      <div className="border rounded-lg p-6 space-y-4">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">Total Estimate</p>
          <p className="text-4xl font-bold">
            {price.currency} ${price.total.toLocaleString()}
          </p>
        </div>

        {price.explanation ? (
          <div className="border-t pt-4">
            <h3 className="font-semibold mb-2">How We Calculated Your Estimate</h3>
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {price.explanation}
            </p>
            {price.confidence && (
              <p className="text-xs text-muted-foreground mt-2">
                Confidence level: <span className="capitalize">{price.confidence}</span>
              </p>
            )}
          </div>
        ) : (
          <div className="border-t pt-4">
            <p className="text-sm text-muted-foreground italic">
              Price calculated based on estimated box count. Detailed breakdown available after review.
            </p>
          </div>
        )}

        <div className="border-t pt-4">
          <h3 className="font-semibold mb-3">Breakdown</h3>
          <div className="space-y-2">
            {Object.entries(price.breakdown).map(([key, value]) => (
              <div key={key} className="flex justify-between">
                <span className="text-muted-foreground">{key}</span>
                <span className="font-medium">${value.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">📦</span>
            <p className="text-sm font-medium">
              Estimated boxes: {estimatedBoxes.min} - {estimatedBoxes.max}
            </p>
          </div>
          {estimateResult.boxesExplanation && (
            <p className="text-sm text-muted-foreground ml-7">
              {estimateResult.boxesExplanation}
            </p>
          )}
        </div>
      </div>

      <Button 
        onClick={() => {
          console.log('PriceStep: Continue button clicked, calling onNext');
          onNext();
        }} 
        size="lg" 
        className="w-full"
      >
        Continue to Scheduling
      </Button>
    </div>
  )
}

