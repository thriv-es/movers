import { useState, useEffect } from 'react'
import type { DetectedItem } from '@/data'
import { Plus, Trash2, ArrowRight } from 'lucide-react'

interface EditStepProps {
  items: DetectedItem[]
  onItemsChange: (items: DetectedItem[]) => void
  onNext: () => void
}

const DISPLAY_FONT = "'Source Serif 4', 'Iowan Old Style', Georgia, serif"

export function EditStep({ items, onItemsChange, onNext }: EditStepProps): JSX.Element {
  const [localItems, setLocalItems] = useState<DetectedItem[]>(items)

  useEffect(() => { setLocalItems(items) }, [items])

  const handleChange = (i: number, field: 'type' | 'count', value: string | number) => {
    const next = [...localItems]
    next[i] = { ...next[i]!, [field]: value }
    setLocalItems(next)
  }

  const handleRemove = (i: number) => setLocalItems(localItems.filter((_, idx) => idx !== i))
  const handleAdd = () => setLocalItems([...localItems, { type: '', count: 1 }])

  const handleSave = () => {
    onItemsChange(localItems.filter((item) => item.type.trim() !== ''))
    onNext()
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="text-eyebrow mb-2">Step 03 · Edit</p>
        <h2
          className="text-foreground leading-tight mb-1.5"
          style={{ fontFamily: DISPLAY_FONT, fontSize: '26px', fontWeight: 400, fontStyle: 'italic' }}
        >
          Edit your inventory
        </h2>
        <p className="text-muted-foreground text-sm">
          Adjust names, counts, or add anything the AI missed.
        </p>
      </div>

      {/* Item rows */}
      <div className="space-y-2">
        {localItems.map((item, i) => (
          <div
            key={i}
            className="flex gap-2 items-center rounded-xl border border-border px-3 py-2.5"
          >
            <input
              value={item.type}
              onChange={(e) => handleChange(i, 'type', e.target.value)}
              placeholder="Item name"
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <input
              type="number"
              value={item.count}
              onChange={(e) => handleChange(i, 'count', parseInt(e.target.value) || 1)}
              min="1"
              className="w-14 bg-transparent text-sm text-center text-foreground focus:outline-none rounded-md border border-border px-2 py-1"
            />
            <button
              onClick={() => handleRemove(i)}
              className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              aria-label="Remove item"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Add item */}
      <button
        onClick={handleAdd}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full font-medium text-sm border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors"
      >
        <Plus className="w-4 h-4" />
        Add item
      </button>

      {/* Save */}
      <button
        onClick={handleSave}
        className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full font-medium text-base text-white btn-lift"
        style={{ backgroundColor: 'var(--thrive)' }}
      >
        Save changes
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  )
}
