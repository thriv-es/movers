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

  const handleStartProcessing = useCallback(async () => {
    setIsProcessing(true)
    setCurrentStep('processing')

    try {
      const result = await estimateApi(messages, uploadedFiles)
      setEstimateResult(result)
      setDetectedItems(result.items)
      setCurrentStep('items')
    } catch (error) {
      console.error('Estimate API error:', error)
      alert(`Error processing estimate: ${error instanceof Error ? error.message : 'Unknown error'}`)
      setCurrentStep('upload')
    } finally {
      setIsProcessing(false)
    }
  }, [messages, uploadedFiles])

  const handleItemsUpdated = useCallback((items: DetectedItem[]) => {
    setDetectedItems(items)
    if (estimateResult) {
      // Recalculate price with updated items
      // In a real app, this would call the backend, but for demo we'll keep the same box estimate
      setEstimateResult({
        ...estimateResult,
        items,
        // Note: Price would need to be recalculated on backend with updated items
        // For now, we keep the existing price structure
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
            onNext={handleStartProcessing}
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

