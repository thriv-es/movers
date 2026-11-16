import { Hono } from 'hono'
import { resolveRole } from '../_lib/ai-mode'
import type { Bindings } from '../_lib/types'
import { visionStatus } from '../_lib/vision-fingerprint'

const status = new Hono<{ Bindings: Bindings }>()
status.get('/', async (c) => {
  c.header('Cache-Control', 'no-store')
  try {
    return c.json(await visionStatus(await resolveRole(c.env, 'vision')))
  } catch {
    return c.json({ error: 'Unable to check photo analysis settings. Please retry.' }, 503)
  }
})
export default status
