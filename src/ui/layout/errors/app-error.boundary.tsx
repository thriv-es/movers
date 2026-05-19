import type React from 'react'
import type { ErrorInfo } from 'react'
import { ErrorBoundary, type ErrorBoundaryPropsWithComponent, type FallbackProps } from 'react-error-boundary'

import { Typography } from '#components/ui/typography'
import { Button } from '#components/ui/button'

export interface AppErrorBoundaryProps
  extends React.PropsWithChildren,
    Omit<ErrorBoundaryPropsWithComponent, 'FallbackComponent'> {
  FallbackComponent?: React.ComponentType<FallbackProps>
}

export function ErrorFallback({ error, resetErrorBoundary }: FallbackProps): JSX.Element {
  return (
    <div role="alert" className="~p-4/6 ~gap-2/4">
      <Typography.H2 className="~text-lg/xl font-bold text-destructive-foreground">Something went wrong</Typography.H2>
      <pre className="~text-sm/base">{error.message}</pre>
      <Button onClick={resetErrorBoundary}>Try again</Button>
    </div>
  )
}

export function AppErrorBoundary({
  FallbackComponent = ErrorFallback,
  onError = handleError,
  children,
  ...restProps
}: AppErrorBoundaryProps): JSX.Element {
  return (
    // @ts-ignore react-error-boundary v4 class component incompatibility with @types/react 18.3
    <ErrorBoundary FallbackComponent={FallbackComponent} onError={onError} {...restProps}>
      {children}
    </ErrorBoundary>
  )
}

const handleError = (error: Error, info: ErrorInfo): void => {
  console.error(error, info)
}
