import { useRef, useState } from 'react'
import { Button } from '@workspace/react-ui/components/ui/button'
import { X, Loader2, Upload, Search, Calculator } from 'lucide-react'
import { uploadImages, analyzeApi, priceApi } from '@/lib/api-client'
import type { ChatMessage, EstimateResult, MoveInfo } from '@workspace/data'

interface UploadStepProps {
  files: File[]
  messages: ChatMessage[]
  onFilesChange: (files: File[]) => void
  onEstimateComplete: (result: EstimateResult) => void
}

type ProcessingStep = 'idle' | 'uploading' | 'analyzing' | 'pricing'

/**
 * Extracts move info from chat messages (from the assistant's JSON blocks)
 */
function extractMoveInfo(messages: ChatMessage[]): MoveInfo {
  const assistantMessages = messages.filter(msg => msg.role === 'assistant')
  const lastAssistantMessage = assistantMessages[assistantMessages.length - 1]
  
  if (lastAssistantMessage) {
    const jsonBlockMatch = lastAssistantMessage.content.match(/```json\s*([\s\S]*?)\s*```/)
    
    if (jsonBlockMatch) {
      try {
        const sessionData = JSON.parse(jsonBlockMatch[1]!) as {
          data_collected?: {
            origin_floor?: number
            origin_has_elevator?: boolean
            destination_floor?: number
            destination_has_elevator?: boolean
            estimated_distance_miles?: number
          }
        }
        
        if (sessionData.data_collected) {
          const data = sessionData.data_collected
          return {
            distance_miles: data.estimated_distance_miles ?? null,
            origin_floor: data.origin_floor ?? null,
            destination_floor: data.destination_floor ?? null,
            origin_has_elevator: data.origin_has_elevator ?? null,
            destination_has_elevator: data.destination_has_elevator ?? null,
          }
        }
      } catch (e) {
        console.error('Failed to parse session data from last message:', e)
      }
    }
  }
  
  // Default move info with all nulls
  return {
    distance_miles: null,
    origin_floor: null,
    destination_floor: null,
    origin_has_elevator: null,
    destination_has_elevator: null,
  }
}

export function UploadStep({ files, messages, onFilesChange, onEstimateComplete }: UploadStepProps): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [processingStep, setProcessingStep] = useState<ProcessingStep>('idle')
  const [error, setError] = useState<string | null>(null)

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || [])
    const imageFiles = selectedFiles.filter((file) => file.type.startsWith('image/'))
    const newFiles = [...files, ...imageFiles].slice(0, 5) // Max 5 files
    onFilesChange(newFiles)
    setError(null)
  }

  const handleRemove = (index: number) => {
    const newFiles = files.filter((_, i) => i !== index)
    onFilesChange(newFiles)
  }

  const handleContinue = async () => {
    if (files.length === 0) return

    setError(null)

    try {
      // Step 1: Upload images
      setProcessingStep('uploading')
      console.log('UploadStep: Step 1 - Uploading', files.length, 'images...')
      const imageUrls = await uploadImages(files)
      console.log('UploadStep: Upload complete, got', imageUrls.length, 'URLs')

      // Step 2: Analyze images
      setProcessingStep('analyzing')
      console.log('UploadStep: Step 2 - Analyzing images...')
      const analysis = await analyzeApi(imageUrls)
      console.log('UploadStep: Analysis complete:', {
        itemCount: analysis.items.length,
        volume: analysis.totalVolumeCubicFeet,
        boxes: analysis.estimatedBoxes,
      })

      // Step 3: Get pricing
      setProcessingStep('pricing')
      console.log('UploadStep: Step 3 - Getting price...')
      const moveInfo = extractMoveInfo(messages)
      const priceResult = await priceApi(analysis, moveInfo)
      console.log('UploadStep: Price complete:', {
        total: priceResult.price.total,
        confidence: priceResult.price.confidence,
      })

      // Combine into EstimateResult
      const result: EstimateResult = {
        items: analysis.items,
        estimatedBoxes: analysis.estimatedBoxes,
        boxesExplanation: analysis.boxesExplanation,
        price: priceResult.price,
      }

      onEstimateComplete(result)
    } catch (err) {
      console.error('Estimate error:', err)
      setError(err instanceof Error ? err.message : 'An error occurred during processing')
      setProcessingStep('idle')
    }
  }

  const isProcessing = processingStep !== 'idle'
  const canContinue = files.length >= 1 && files.length <= 5 && !isProcessing

  const getProgressMessage = () => {
    switch (processingStep) {
      case 'uploading':
        return 'Uploading images...'
      case 'analyzing':
        return 'Analyzing your items with AI...'
      case 'pricing':
        return 'Calculating your estimate...'
      default:
        return ''
    }
  }

  const getProgressIcon = () => {
    switch (processingStep) {
      case 'uploading':
        return <Upload className="w-5 h-5" />
      case 'analyzing':
        return <Search className="w-5 h-5" />
      case 'pricing':
        return <Calculator className="w-5 h-5" />
      default:
        return null
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="~text-xl/2xl font-bold">Upload Photos of Your Items</h2>
      <p className="text-muted-foreground">
        Upload 1-5 photos of your items. We'll analyze them to create your inventory.
      </p>

      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
        <Button
          onClick={() => fileInputRef.current?.click()}
          variant="outline"
          disabled={files.length >= 5 || isProcessing}
        >
          {files.length === 0 ? 'Select Images' : 'Add More Images'}
        </Button>
        {files.length > 0 && (
          <p className="text-sm text-muted-foreground mt-2">
            {files.length} of 5 images selected
          </p>
        )}
      </div>

      {files.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {files.map((file, index) => (
            <div key={index} className="relative group">
              <img
                src={URL.createObjectURL(file)}
                alt={`Preview ${index + 1}`}
                className="w-full h-32 object-cover rounded-lg border"
              />
              <button
                onClick={() => handleRemove(index)}
                className="absolute top-2 right-2 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Remove image"
                disabled={isProcessing}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-md text-sm">
          {error}
        </div>
      )}

      {isProcessing && (
        <div className="flex flex-col items-center justify-center py-8 space-y-4">
          <div className="flex items-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            {getProgressIcon()}
          </div>
          <p className="text-muted-foreground font-medium">
            {getProgressMessage()}
          </p>
          <div className="flex gap-2">
            <div className={`w-3 h-3 rounded-full ${processingStep === 'uploading' ? 'bg-primary' : 'bg-muted'}`} />
            <div className={`w-3 h-3 rounded-full ${processingStep === 'analyzing' ? 'bg-primary' : 'bg-muted'}`} />
            <div className={`w-3 h-3 rounded-full ${processingStep === 'pricing' ? 'bg-primary' : 'bg-muted'}`} />
          </div>
        </div>
      )}

      {canContinue && (
        <Button onClick={handleContinue} size="lg" className="w-full">
          Continue to Processing
        </Button>
      )}
    </div>
  )
}
