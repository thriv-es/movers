import { Hono } from 'hono'
import type { Bindings } from '../_lib/types'
import { zContact, zCreateEstimateRequest } from '../../../src/data'
import { createStore, storeKind } from '../_lib/store'

const estimates = new Hono<{ Bindings: Bindings }>()

/** Saves a priced estimate as an anonymous lead and returns its id for the session. */
estimates.post('/', async (c) => {
  const parsed = zCreateEstimateRequest.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid estimate', issues: parsed.error.issues }, 400)
  const record = await createStore(c.env).createEstimate(parsed.data)
  return c.json({ id: record.id, storage: storeKind(c.env) }, 201)
})

estimates.get('/:id', async (c) => {
  const record = await createStore(c.env).getEstimate(c.req.param('id'))
  if (!record) return c.json({ error: 'Estimate not found' }, 404)
  return c.json(record)
})

/** Attaches the customer's contact and requested date (the Schedule step). */
estimates.patch('/:id/contact', async (c) => {
  const parsed = zContact.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid contact', issues: parsed.error.issues }, 400)
  const store = createStore(c.env)
  const current = await store.getEstimate(c.req.param('id'))
  if (!current) return c.json({ error: 'Estimate not found' }, 404)
  const status = current.status === 'new' ? 'contacted' : current.status
  const record = await store.updateEstimate(current.id, { contact: parsed.data, status })
  return c.json({
    reference: record?.id,
    requestedDate: parsed.data.requestedDate,
    note: 'Demo booking: no mover has been dispatched. Your reference is the estimate id.',
  })
})

export default estimates
