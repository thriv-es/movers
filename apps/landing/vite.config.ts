import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Vite config for the Movers landing page (a static single page).
 *
 * The port is fixed and strict: 4600 = landing, 4610 = estimator (see apps/web).
 * strictPort makes a collision fail loudly instead of silently moving to another port.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    open: false,
    host: '127.0.0.1',
    port: 4600,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4600,
    strictPort: true,
  },
})
