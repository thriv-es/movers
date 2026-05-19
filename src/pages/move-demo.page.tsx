import { useState, useCallback } from 'react'
import type {
  ChatMessage,
  DetectedItem,
  EstimateResult,
} from '@/data'
import { IntroStep } from '@/components/move-demo/IntroStep'
import { ChatStep } from '@/components/move-demo/ChatStep'
import { UploadStep } from '@/components/move-demo/UploadStep'
import { ProcessingStep } from '@/components/move-demo/ProcessingStep'
import { ItemsStep } from '@/components/move-demo/ItemsStep'
import { EditStep } from '@/components/move-demo/EditStep'
import { ConfirmStep } from '@/components/move-demo/ConfirmStep'
import { PriceStep } from '@/components/move-demo/PriceStep'
import { ScheduleStep } from '@/components/move-demo/ScheduleStep'

import { PageSeo } from "@/components/seo";
import { CONFIG } from "@/config";

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

const FLOW: Step[] = ['intro', 'chat', 'upload', 'processing', 'items', 'edit', 'confirm', 'price', 'schedule']

const PROGRESS_STEPS = [
  { key: 'chat',     label: 'Your move' },
  { key: 'photos',   label: 'Photos' },
  { key: 'review',   label: 'Review' },
  { key: 'estimate', label: 'Estimate' },
  { key: 'schedule', label: 'Schedule' },
] as const

function getProgressIndex(step: Step): number {
  switch (step) {
    case 'chat':                   return 0
    case 'upload':                 return 1
    case 'items': case 'edit':
    case 'confirm': case 'processing': return 2
    case 'price':                  return 3
    case 'schedule':               return 4
    default:                       return -1
  }
}

const DISPLAY_FONT = "'Source Serif 4', 'Iowan Old Style', Georgia, serif"

export default function MoveDemoPage(): JSX.Element {
  const [currentStep, setCurrentStep] = useState<Step>('intro')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([])
  const [detectedItems, setDetectedItems] = useState<DetectedItem[]>([])
  const [estimateResult, setEstimateResult] = useState<EstimateResult | null>(null)

  const handleNextStep = useCallback(() => {
    const currentIndex = FLOW.indexOf(currentStep)
    if (currentIndex < FLOW.length - 1) {
      setCurrentStep(FLOW[currentIndex + 1]!)
    }
  }, [currentStep])

  const handleEstimateComplete = useCallback((result: EstimateResult) => {
    setDetectedItems(result.items)
    setEstimateResult(result)
    setCurrentStep('items')
  }, [])

  const handleItemsUpdated = useCallback((items: DetectedItem[]) => {
    setDetectedItems(items)
    if (estimateResult) {
      setEstimateResult({ ...estimateResult, items })
    }
  }, [estimateResult])

  const renderStep = () => {
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

  const progressIndex = getProgressIndex(currentStep)
  const showProgress = currentStep !== 'intro'

  return (
    <div className="min-h-[calc(100vh-8rem)] flex flex-col px-4 py-12 md:py-16">
      <PageSeo
        title="Get Your Free Moving Estimate — thriv.es movers"
        description="Start with a quick chat about your move, upload a few photos of your belongings, and get an AI-powered itemized estimate with full cost breakdown in minutes — no in-person visit needed."
        canonical={`${CONFIG.canonical}/estimate`}
        ogType="website"
        index={true}
        follow={true}
        jsonLd={{
          "@type": "HowTo",
          name: "Get an AI-Powered Moving Estimate",
          description:
            "How to get an instant itemized moving estimate using thriv.es movers: chat about your move, photograph your items, and receive a full price breakdown.",
          step: [
            {
              "@type": "HowToStep",
              name: "Tell us about your move",
              text: "Chat with our assistant about distance, floors, elevator access, and other details about your move.",
            },
            {
              "@type": "HowToStep",
              name: "Photograph your items",
              text: "Upload 1–5 photos of your belongings. Any room, any angle — our AI handles the rest.",
            },
            {
              "@type": "HowToStep",
              name: "Review itemized inventory",
              text: "Review and edit the AI-generated inventory of detected items.",
            },
            {
              "@type": "HowToStep",
              name: "Get your estimate",
              text: "Receive a full itemized breakdown with a confidence rating and total moving cost.",
            },
            {
              "@type": "HowToStep",
              name: "Schedule your move",
              text: "Pick a date and schedule your move when you're ready.",
            },
          ],
        }}
      />

      <div className="container max-w-xl mx-auto flex flex-col gap-8">
        {/* Progress indicator */}
        {showProgress && (
          <nav aria-label="Estimate progress">
            <ol className="flex items-center gap-0">
              {PROGRESS_STEPS.map((s, i) => {
                const isDone = i < progressIndex;
                const isActive = i === progressIndex;
                const isUpcoming = i > progressIndex;
                return (
                  <li
                    key={s.key}
                    className="flex items-center flex-1 last:flex-none"
                  >
                    <div className="flex flex-col items-center gap-1.5">
                      <span
                        className="flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-semibold transition-all duration-200"
                        style={{
                          backgroundColor: isDone
                            ? "var(--thrive)"
                            : isActive
                              ? "hsl(var(--foreground))"
                              : "hsl(var(--muted))",
                          color:
                            isDone || isActive
                              ? "#fff"
                              : "hsl(var(--muted-foreground))",
                        }}
                      >
                        {isDone ? "✓" : i + 1}
                      </span>
                      <span
                        className="text-[10px] font-semibold tracking-wide uppercase whitespace-nowrap"
                        style={{
                          color: isUpcoming
                            ? "hsl(var(--muted-foreground))"
                            : "hsl(var(--foreground))",
                        }}
                      >
                        {s.label}
                      </span>
                    </div>
                    {i < PROGRESS_STEPS.length - 1 && (
                      <div
                        className="h-px flex-1 mx-2 mb-4"
                        style={{
                          backgroundColor:
                            i < progressIndex
                              ? "var(--thrive)"
                              : "hsl(var(--border))",
                        }}
                      />
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
        )}

        {/* Step content */}
        <div
          className="card-thrive p-6 md:p-8"
          style={{ fontFamily: "Inter, sans-serif" }}
        >
          {renderStep()}
        </div>

        {/* Wordmark footnote */}
        <p className="text-center text-sm text-muted-foreground">
          <span
            className="italic font-normal"
            style={{ fontFamily: DISPLAY_FONT }}
          >
            thriv<span style={{ color: "var(--thrive)" }}>.</span>es
          </span>{" "}
          movers demo
        </p>
      </div>
    </div>
  );
}
