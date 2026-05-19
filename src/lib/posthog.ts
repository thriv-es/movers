import posthog from 'posthog-js'
import { IS_CLIENT, IS_PRODUCTION } from '@/config'

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST as string | undefined

if (IS_CLIENT && IS_PRODUCTION && POSTHOG_KEY) {
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST || 'https://eu.i.posthog.com',
  })
}

export { posthog }