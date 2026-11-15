import React from 'react'
import ReactDOM from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'

// Self-hosted fonts: display, body and captions, the same set as the landing.
import '@fontsource/bowlby-one'
import '@fontsource-variable/fredoka'
import '@fontsource-variable/inter'
import './style/tailwind.css'
// The comic design system shared with the landing, then the estimator's own layout rules.
import '@movers/ui/tokens.css'
import '@movers/ui/components.css'
import './style/estimator.css'

import '@/lib/posthog'

import App from './App'
import { IS_CLIENT } from '@/config'

const mountNode = document.getElementById('root')

if (!mountNode) {
  throw new Error("React mount point 'root' not found in document.")
}

/**
 * Refresh the page if a dynamic import fails.
 * @see https://vitejs.dev/guide/build#load-error-handling
 */
if (IS_CLIENT) {
  window.addEventListener('vite:preloadError', (_event) => {
    window.location.reload()
  })
}

ReactDOM.createRoot(mountNode).render(
  <React.StrictMode>
    <HelmetProvider>
      <App />
    </HelmetProvider>
  </React.StrictMode>,
)
