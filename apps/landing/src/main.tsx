import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Self-hosted fonts, so the page looks the same offline: display, body and captions.
import '@fontsource/bowlby-one'
import '@fontsource-variable/fredoka'
import '@fontsource-variable/inter'

import { LandingPage } from './LandingPage'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

createRoot(container).render(
  <StrictMode>
    <LandingPage />
  </StrictMode>,
)
