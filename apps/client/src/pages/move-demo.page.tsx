import { useState, useCallback } from 'react'
import type {
  ChatMessage,
  DetectedItem,
  EstimateResult,
} from '@workspace/data'
import { PageLayout } from '@workspace/react-layout/page.layout'
import { IntroStep } from '@/components/move-demo/IntroStep'
import { ChatStep } from '@/components/move-demo/ChatStep'
import { UploadStep } from '@/components/move-demo/UploadStep'
import { ProcessingStep } from '@/components/move-demo/ProcessingStep'
import { ItemsStep } from '@/components/move-demo/ItemsStep'
import { EditStep } from '@/components/move-demo/EditStep'
import { ConfirmStep } from '@/components/move-demo/ConfirmStep'
import { PriceStep } from '@/components/move-demo/PriceStep'
import { ScheduleStep } from '@/components/move-demo/ScheduleStep'
import { estimateApi } from '@/lib/api-client'

export type Step =
  | 'intro'
  | 'chat'
  | 'upload'
  | 'processing'
  | 'items'
  | 'edit'
  | 'confirm'
  | 'price'
  | 'schedule'

export default function MoveDemoPage(): JSX.Element {
  const [currentStep, setCurrentStep] = useState<Step>('intro')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([])
  const [detectedItems, setDetectedItems] = useState<DetectedItem[]>([])
  const [estimateResult, setEstimateResult] = useState<EstimateResult | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  const handleNextStep = useCallback(() => {
    const steps: Step[] = [
      'intro',
      'chat',
      'upload',
      'processing',
      'items',
      'edit',
      'confirm',
      'price',
      'schedule',
    ]
    const currentIndex = steps.indexOf(currentStep)
    console.log('handleNextStep: currentStep=', currentStep, 'currentIndex=', currentIndex)
    if (currentIndex < steps.length - 1) {
      const nextStep = steps[currentIndex + 1]!
      console.log('handleNextStep: Moving to next step:', nextStep)
      setCurrentStep(nextStep)
    } else {
      console.log('handleNextStep: Already at last step')
    }
  }, [currentStep])

  const handleAnalysisComplete = useCallback((items: DetectedItem[], volume: number) => {
    setDetectedItems(items)
    
    // Create a partial estimate result with the analysis data
    // The full price calculation will happen later or we can trigger it here if needed
    // For now, we'll construct a basic estimate result to proceed to the items step
    
    // Estimate boxes based on volume (similar to backend logic for consistency)
    const estimatedBoxesMin = Math.max(5, Math.ceil((volume * 1.2) / 4))
    const estimatedBoxesMax = Math.max(10, Math.ceil((volume * 1.2) / 3))
    
    const initialEstimate: EstimateResult = {
      items,
      estimatedBoxes: {
        min: estimatedBoxesMin,
        max: estimatedBoxesMax
      },
      price: {
        currency: 'USD',
        total: 0, // Will be calculated in PriceStep
        breakdown: {},
        confidence: 'low'
      }
    }
    
    setEstimateResult(initialEstimate)
    setCurrentStep('items')
  }, [])

  const handleItemsUpdated = useCallback((items: DetectedItem[]) => {
    setDetectedItems(items)
    if (estimateResult) {
      setEstimateResult({
        ...estimateResult,
        items,
      })
    }
  }, [estimateResult])

  const renderStep = () => {
    console.log('renderStep: currentStep =', currentStep, 'estimateResult =', estimateResult ? 'exists' : 'null')
    switch (currentStep) {
      case 'intro':
        return <IntroStep onNext={handleNextStep} />
      case 'chat':
        return (
          <ChatStep
            messages={messages}
            onMessagesChange={setMessages}
            onNext={handleNextStep}
          />
        )
      case 'upload':
        return (
          <UploadStep
            files={uploadedFiles}
            onFilesChange={setUploadedFiles}
            onAnalysisComplete={handleAnalysisComplete}
          />
        )
      case 'processing':
        return <ProcessingStep />
      case 'items':
        return (
          <ItemsStep
            estimateResult={estimateResult}
            onEdit={() => setCurrentStep('edit')}
            onNext={() => setCurrentStep('price')}
          />
        )
      case 'edit':
        return (
          <EditStep
            items={detectedItems}
            onItemsChange={handleItemsUpdated}
            onNext={() => setCurrentStep('confirm')}
          />
        )
      case 'confirm':
        return (
          <ConfirmStep
            items={detectedItems}
            onNext={() => setCurrentStep('price')}
          />
        )
      case 'price':
        return (
          <PriceStep
            estimateResult={estimateResult}
            onNext={handleNextStep}
          />
        )
      case 'schedule':
        return <ScheduleStep />
      default:
        return <IntroStep onNext={handleNextStep} />
    }
  }

  return (
    <PageLayout className="max-w-4xl mx-auto">
      <div className="w-full">{renderStep()}</div>
    </PageLayout>
  )
}

