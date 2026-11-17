import type React from 'react'
import { HelmetProvider } from 'react-helmet-async'

import { Toaster } from '@/ui/components/ui/toaster'
import { ThemeContextProvider } from '@/ui/components/layout/theme-context-provider'

export interface AppContextProvidersProps extends React.PropsWithChildren {}

/**
 * React context providers to serve as high-level parents of this app's component tree.
 */
export function AppContextProviders({ children }: AppContextProvidersProps): JSX.Element {
  return (
    <ThemeContextProvider>
      {/* @ts-ignore react-helmet-async v2 class component incompatibility with @types/react 18.3 */}
      <HelmetProvider>{children}</HelmetProvider>
      <Toaster />
    </ThemeContextProvider>
  )
}
