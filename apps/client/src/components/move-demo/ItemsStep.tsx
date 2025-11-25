import type { EstimateResult } from '@workspace/data'
import { Button } from '@workspace/react-ui/components/ui/button'

interface ItemsStepProps {
  estimateResult: EstimateResult | null
  onEdit: () => void
  onNext: () => void
}

export function ItemsStep({ estimateResult, onEdit, onNext }: ItemsStepProps): JSX.Element {
  if (!estimateResult) {
    return (
      <div>
        <p>No items detected. Please try again.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h2 className="~text-xl/2xl font-bold">Detected Items</h2>
      <p className="text-muted-foreground">
        We've identified the following items in your photos:
      </p>

      <div className="border rounded-lg p-4 space-y-2">
        {estimateResult.items.length === 0 ? (
          <p className="text-muted-foreground">No items detected.</p>
        ) : (
          estimateResult.items.map((item, index) => (
            <div key={index} className="flex justify-between items-center py-2 border-b last:border-b-0">
              <span className="font-medium capitalize">{item.type}</span>
              <span className="text-muted-foreground">x{item.count}</span>
            </div>
          ))
        )}
      </div>

      <div className="bg-muted p-4 rounded-lg">
        <p className="text-sm text-muted-foreground">
          Estimated boxes needed: {estimateResult.estimatedBoxes.min} - {estimateResult.estimatedBoxes.max}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <Button onClick={onEdit} variant="outline" className="flex-1">
          Edit Items
        </Button>
        <Button 
          onClick={() => {
            console.log('ItemsStep: Continue button clicked, calling onNext');
            onNext();
          }} 
          className="flex-1"
        >
          Continue
        </Button>
      </div>
    </div>
  )
}

