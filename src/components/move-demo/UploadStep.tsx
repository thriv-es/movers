import { useRef, useState } from 'react'
import { X, Loader2, Upload, Search, Calculator, ImagePlus, ArrowRight } from 'lucide-react'
import { uploadImages, analyzeApi, priceApi } from '@/lib/api-client'
import type { ChatMessage, EstimateResult, MoveInfo } from '@/data'

interface UploadStepProps {
  files: File[]
  messages: ChatMessage[]
  onFilesChange: (files: File[]) => void
  onEstimateComplete: (result: EstimateResult) => void
}

type ProcessingPhase = 'idle' | 'uploading' | 'analyzing' | 'pricing'

const DISPLAY_FONT = "'Source Serif 4', 'Iowan Old Style', Georgia, serif"

function extractMoveInfo(messages: ChatMessage[]): MoveInfo {
  const assistantMessages = messages.filter((msg) => msg.role === 'assistant')
  const last = assistantMessages[assistantMessages.length - 1]
  if (last) {
    const match = last.content.match(/```json\s*([\s\S]*?)\s*```/)
    if (match) {
      try {
        const data = JSON.parse(match[1]!) as { data_collected?: Record<string, number | boolean | null> }
        if (data.data_collected) {
          const d = data.data_collected
          return {
            distance_miles: (d['estimated_distance_miles'] as number) ?? null,
            origin_floor: (d['origin_floor'] as number) ?? null,
            destination_floor: (d['destination_floor'] as number) ?? null,
            origin_has_elevator: (d['origin_has_elevator'] as boolean) ?? null,
            destination_has_elevator: (d['destination_has_elevator'] as boolean) ?? null,
          }
        }
      } catch { /* ignore */ }
    }
  }
  return { distance_miles: null, origin_floor: null, destination_floor: null, origin_has_elevator: null, destination_has_elevator: null }
}

export function UploadStep({ files, messages, onFilesChange, onEstimateComplete }: UploadStepProps): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<ProcessingPhase>('idle')
  const [error, setError] = useState<string | null>(null)

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []).filter((f) => f.type.startsWith('image/'))
    onFilesChange([...files, ...selected].slice(0, 5))
    setError(null)
  }

  const handleRemove = (index: number) => {
    onFilesChange(files.filter((_, i) => i !== index))
  }

  const handleContinue = async () => {
    if (files.length === 0) return
    setError(null)
    try {
      setPhase('uploading')
      const imageUrls = await uploadImages(files)
      setPhase('analyzing')
      const analysis = await analyzeApi(imageUrls)
      setPhase('pricing')
      const moveInfo = extractMoveInfo(messages)
      const priceResult = await priceApi(analysis, moveInfo)
      onEstimateComplete({
        items: analysis.items,
        estimatedBoxes: analysis.estimatedBoxes,
        boxesExplanation: analysis.boxesExplanation,
        price: priceResult.price,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      setPhase('idle')
    }
  }

  const isProcessing = phase !== 'idle'
  const canContinue = files.length >= 1 && files.length <= 5 && !isProcessing

  const phaseLabel: Record<ProcessingPhase, string> = {
    idle: '',
    uploading: 'Uploading images…',
    analyzing: 'Analyzing your items with AI…',
    pricing: 'Calculating your estimate…',
  }

  const phaseIndex: Record<ProcessingPhase, number> = { idle: -1, uploading: 0, analyzing: 1, pricing: 2 }
  const phaseIcon: Record<ProcessingPhase, React.ReactNode> = {
    idle: null,
    uploading: <Upload className="w-4 h-4" />,
    analyzing: <Search className="w-4 h-4" />,
    pricing: <Calculator className="w-4 h-4" />,
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="text-eyebrow mb-2">Step 02</p>
        <h2
          className="text-foreground leading-tight mb-1.5"
          style={{ fontFamily: DISPLAY_FONT, fontSize: '26px', fontWeight: 400, fontStyle: 'italic' }}
        >
          Upload photos of your items
        </h2>
        <p className="text-muted-foreground text-sm">
          1–5 photos of your belongings. Any room, any angle.
        </p>
      </div>

      {/* Drop zone / add button */}
      {files.length < 5 && !isProcessing && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full rounded-xl border-2 border-dashed border-border hover:border-primary py-8 flex flex-col items-center gap-3 transition-colors duration-150 text-muted-foreground hover:text-foreground group"
          >
            <ImagePlus className="w-6 h-6 group-hover:scale-110 transition-transform duration-150" />
            <span className="text-sm font-medium">
              {files.length === 0 ? 'Select images' : 'Add more images'}
            </span>
            {files.length > 0 && (
              <span className="text-xs">{files.length} of 5 selected</span>
            )}
          </button>
        </>
      )}

      {/* Thumbnails grid */}
      {files.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {files.map((file, i) => (
            <div key={i} className="relative group rounded-lg overflow-hidden aspect-square border border-border">
              <img
                src={URL.createObjectURL(file)}
                alt={`Preview ${i + 1}`}
                className="w-full h-full object-cover"
              />
              {!isProcessing && (
                <button
                  onClick={() => handleRemove(i)}
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center bg-foreground/80 text-background opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Remove image"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg px-4 py-3 text-sm bg-destructive/10 text-destructive">
          {error}
        </div>
      )}

      {/* Processing state */}
      {isProcessing && (
        <div className="flex flex-col items-center py-6 gap-4">
          <div className="flex items-center gap-3 text-foreground">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--thrive)' }} />
            {phaseIcon[phase]}
            <span className="text-sm font-medium">{phaseLabel[phase]}</span>
          </div>
          <div className="flex gap-2">
            {(['uploading', 'analyzing', 'pricing'] as ProcessingPhase[]).map((p, i) => (
              <div
                key={p}
                className="w-2 h-2 rounded-full transition-all duration-300"
                style={{
                  backgroundColor: i <= phaseIndex[phase]
                    ? 'var(--thrive)'
                    : 'hsl(var(--muted))',
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Continue button */}
      {canContinue && (
        <button
          onClick={handleContinue}
          className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full font-medium text-base text-white btn-lift"
          style={{ backgroundColor: 'var(--thrive)' }}
        >
          Analyze my items
          <ArrowRight className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
