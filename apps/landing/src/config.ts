/**
 * Where the landing page sends people.
 *
 * `VITE_APP_URL` is read at build time; without it every "Get an estimate" link opens the
 * estimator of the local dev stack (`pnpm dev` serves it on port 4610).
 */
export const APP_URL: string = import.meta.env.VITE_APP_URL ?? 'http://localhost:4610/estimate'

export const GITHUB_URL = 'https://github.com/thriv-es/movers'
