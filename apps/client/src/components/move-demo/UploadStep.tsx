import { useRef, useState } from 'react'
import { Button } from '@workspace/react-ui/components/ui/button'
import { X, Loader2 } from 'lucide-react'
import { uploadImages, analyzeImages } from '@/lib/api-client'
import type { DetectedItem } from '@workspace/data'

interface UploadStepProps {
  files: File[]
  onFilesChange: (files: File[]) => void
  onAnalysisComplete: (items: DetectedItem[], volume: number) => void
}

export function UploadStep({ files, onFilesChange, onAnalysisComplete }: UploadStepProps): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
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

    setIsUploading(true)
    setError(null)

    try {
      // 1. Upload images
      const uploadedUrls = await uploadImages(files)
      
      setIsUploading(false)
      setIsAnalyzing(true)

      // 2. Analyze images
      const result = await analyzeImages(uploadedUrls)
      
      // 3. Pass results to parent
      onAnalysisComplete(result.items, result.total_volume_cubic_feet)
    } catch (err) {
      console.error('Upload/Analysis error:', err)
      setError(err instanceof Error ? err.message : 'An error occurred during processing')
      setIsUploading(false)
      setIsAnalyzing(false)
    }
  }

  const canContinue = files.length >= 1 && files.length <= 5 && !isUploading && !isAnalyzing

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
          disabled={files.length >= 5 || isUploading || isAnalyzing}
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
                disabled={isUploading || isAnalyzing}
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

      {(isUploading || isAnalyzing) && (
        <div className="flex flex-col items-center justify-center py-8 space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground">
            {isUploading ? 'Uploading images...' : 'Analyzing your items...'}
          </p>
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

