import { useState, useEffect } from 'react'
import type { DetectedItem } from '@workspace/data'
import { Button } from '@workspace/react-ui/components/ui/button'
import { Input } from '@workspace/react-ui/components/ui/input'
import { Plus, Trash2 } from 'lucide-react'

interface EditStepProps {
  items: DetectedItem[]
  onItemsChange: (items: DetectedItem[]) => void
  onNext: () => void
}

export function EditStep({ items, onItemsChange, onNext }: EditStepProps): JSX.Element {
  const [localItems, setLocalItems] = useState<DetectedItem[]>(items)

  useEffect(() => {
    setLocalItems(items)
  }, [items])

  const handleItemChange = (index: number, field: 'type' | 'count', value: string | number) => {
    const newItems = [...localItems]
    newItems[index] = {
      ...newItems[index]!,
      [field]: value,
    }
    setLocalItems(newItems)
  }

  const handleRemove = (index: number) => {
    const newItems = localItems.filter((_, i) => i !== index)
    setLocalItems(newItems)
  }

  const handleAdd = () => {
    setLocalItems([
      ...localItems,
      {
        type: '',
        count: 1,
      },
    ])
  }

  const handleSave = () => {
    // Filter out items with empty type
    const validItems = localItems.filter((item) => item.type.trim() !== '')
    console.log('EditStep: Save Changes clicked, calling onItemsChange and onNext');
    onItemsChange(validItems)
    onNext()
  }

  return (
    <div className="space-y-6">
      <h2 className="~text-xl/2xl font-bold">Edit Your Inventory</h2>
      <p className="text-muted-foreground">
        Review and edit the detected items. You can change names, counts, add items, or remove items.
      </p>

      <div className="space-y-3">
        {localItems.map((item, index) => (
          <div key={index} className="flex gap-2 items-center border rounded-lg p-3">
            <Input
              value={item.type}
              onChange={(e) => handleItemChange(index, 'type', e.target.value)}
              placeholder="Item type"
              className="flex-1"
            />
            <Input
              type="number"
              value={item.count}
              onChange={(e) => handleItemChange(index, 'count', Number.parseInt(e.target.value) || 1)}
              min="1"
              className="w-20"
            />
            <Button
              onClick={() => handleRemove(index)}
              variant="ghost"
              size="icon"
              aria-label="Remove item"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
      </div>

      <Button onClick={handleAdd} variant="outline" className="w-full">
        <Plus className="w-4 h-4 mr-2" />
        Add Item
      </Button>

      <Button onClick={handleSave} size="lg" className="w-full">
        Save Changes
      </Button>
    </div>
  )
}

