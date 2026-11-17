import { Hono } from 'hono'
import type { Bindings } from '../_lib/types'
import { zQuoteRequestInput } from '../../../src/data'
import { composeQuoteRequestEmail, deliverEmail } from '../_lib/outbound-email'
import { createStore } from '../_lib/store'

const quoteRequests = new Hono<{ Bindings: Bindings }>()

/** One request per chosen mover (at most three). The email to each mover is composed and logged, not sent. */
quoteRequests.post('/', async (c) => {
  const parsed = zQuoteRequestInput.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid quote request', issues: parsed.error.issues }, 400)
  const { estimateId, moverIds, note } = parsed.data
  const store = createStore(c.env)

  const estimate = await store.getEstimate(estimateId)
  if (!estimate) return c.json({ error: 'Estimate not found' }, 404)

  const uniqueIds = [...new Set(moverIds)]
  const movers = (await Promise.all(uniqueIds.map((id) => store.getMover(id)))).filter(
    (m): m is NonNullable<typeof m> => m !== null && m.status === 'active',
  )
  if (movers.length === 0) return c.json({ error: 'No active movers matched the ids' }, 400)

  const created = await store.createQuoteRequests(
    estimateId,
    movers.map((m) => m.id),
    note,
  )
  if (estimate.status === 'new' || estimate.status === 'contacted') {
    await store.updateEstimate(estimateId, { status: 'quoted' })
  }

  const delivery: Record<string, 'logged'> = {}
  for (const mover of movers) {
    delivery[mover.id] = await deliverEmail(composeQuoteRequestEmail(estimate, mover, note))
  }

  return c.json({ requests: created, delivery }, 201)
})

export default quoteRequests
