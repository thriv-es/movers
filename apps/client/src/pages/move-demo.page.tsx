import { useState, useCallback } from 'react'
import type {
  ChatMessage,
  DetectedItem,
  EstimateResult,
} from '@workspace/data'
import { PageLayout } from '@workspace/react-ui/layout'
import { IntroStep } from '@/components/move-demo/IntroStep'
import { ChatStep } from '@/components/move-demo/ChatStep'
import { UploadStep } from '@/components/move-demo/UploadStep'
import { ProcessingStep } from '@/components/move-demo/ProcessingStep'
import { ItemsStep } from '@/components/move-demo/ItemsStep'
import { EditStep } from '@/components/move-demo/EditStep'
import { ConfirmStep } from '@/components/move-demo/ConfirmStep'
import { PriceStep } from '@/components/move-demo/PriceStep'
import { ScheduleStep } from '@/components/move-demo/ScheduleStep'

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

  const handleEstimateComplete = useCallback((result: EstimateResult) => {
    console.log('handleEstimateComplete: Received full estimate result:', {
      itemsCount: result.items.length,
      priceTotal: result.price.total,
      confidence: result.price.confidence
    })
    setDetectedItems(result.items)
    setEstimateResult(result)
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
            messages={messages}
            onFilesChange={setUploadedFiles}
            onEstimateComplete={handleEstimateComplete}
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

