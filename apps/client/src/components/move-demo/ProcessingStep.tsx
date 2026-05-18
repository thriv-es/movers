import { ScreenSpinner } from '@workspace/react-ui/components/ui/spinner'

export function ProcessingStep(): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center space-y-4 py-12">
      <ScreenSpinner />
      <h2 className="text-2xl font-bold">Analyzing Your Items</h2>
      <p className="text-muted-foreground text-center max-w-md">
        We're processing your photos and chat information to create a detailed inventory.
        This may take a moment...
      </p>
    </div>
  )
}

