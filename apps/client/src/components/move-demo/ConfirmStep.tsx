import type { DetectedItem } from '@workspace/data'
import { Button } from '@workspace/react-ui/components/ui/button'

interface ConfirmStepProps {
  items: DetectedItem[]
  onNext: () => void
}

export function ConfirmStep({ items, onNext }: ConfirmStepProps): JSX.Element {
  return (
    <div className="space-y-6">
      <h2 className="~text-xl/2xl font-bold">Confirm Your Inventory</h2>
      <p className="text-muted-foreground">
        Please review your inventory list. Once confirmed, we'll calculate your estimate.
      </p>

      <div className="border rounded-lg p-4 space-y-2">
        {items.length === 0 ? (
          <p className="text-muted-foreground">No items in inventory.</p>
        ) : (
          items.map((item, index) => (
            <div key={index} className="flex justify-between items-center py-2 border-b last:border-b-0">
              <span className="font-medium capitalize">{item.type}</span>
              <span className="text-muted-foreground">x{item.count}</span>
            </div>
          ))
        )}
      </div>

      <Button 
        onClick={() => {
          console.log('ConfirmStep: Confirm Inventory button clicked, calling onNext');
          onNext();
        }} 
        size="lg" 
        className="w-full"
      >
        Confirm Inventory
      </Button>
    </div>
  )
}

