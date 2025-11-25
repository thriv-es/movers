import { Button } from '@workspace/react-ui/components/ui/button'

interface IntroStepProps {
  onNext: () => void
}

export function IntroStep({ onNext }: IntroStepProps): JSX.Element {
  return (
    <div className="space-y-6">
      <h1 className="~text-2xl/4xl font-bold">Get Your Moving Estimate</h1>
      <div className="prose max-w-none ~text-sm/base">
        <p>
          Welcome! We'll help you get an accurate moving estimate in just a few simple steps.
        </p>
        <p>Here's what we'll do:</p>
        <ol>
          <li>Ask you a few questions about your move</li>
          <li>Have you upload photos of your items</li>
          <li>Analyze your inventory using AI</li>
          <li>Provide you with a detailed estimate</li>
          <li>Help you schedule your move</li>
        </ol>
        <p>This process takes about 5-10 minutes. Let's get started!</p>
      </div>
      <Button onClick={onNext} size="lg" className="w-full">
        Get Started
      </Button>
    </div>
  )
}

