import { Hono } from 'hono'
import type { Bindings } from '../_lib/types'
import type { EstimateRecord } from '../../../src/data'
import { zLeadStatus, zLeadUpdate, zMoverInput, zQuoteRequestStatus } from '../../../src/data'
import { createStore, storeKind } from '../_lib/store'
import {
  type AiRole,
  type AiSelection,
  MODEL_CATALOG,
  readAiSettings,
  updateAiSettings,
  validateRoles,
} from '../_lib/ai-settings'
import { resolveRole } from '../_lib/ai-mode'

const admin = new Hono<{ Bindings: Bindings }>()

/** No sign-in yet, so the whole admin API disappears in production. Add auth before removing this. */
admin.use('*', async (c, next) => {
  if (c.env.ENV === 'production') return c.json({ error: 'Not found' }, 404)
  await next()
  return undefined
})

admin.get('/status', (c) => c.json({ storage: storeKind(c.env), env: c.env.ENV }))

// No authentication exists yet: these routes are available only on the loopback-bound local dev server.
admin.use('/ai-settings', async (c, next) => {
  const hostname = new URL(c.req.url).hostname
  if (c.env.ENV !== 'development' || (hostname !== 'localhost' && hostname !== '127.0.0.1')) {
    return c.json({ error: 'Not found' }, 404)
  }
  if (!c.env.MOVERS_DB) return c.json({ error: 'Local database unavailable' }, 503)
  await next()
  return undefined
})

async function settingsResponse(env: Bindings) {
  const db = env.MOVERS_DB as D1Database
  const settings = await readAiSettings(db)
  const [chat, price, vision] = await Promise.all([
    resolveRole(env, 'chat'),
    resolveRole(env, 'price'),
    resolveRole(env, 'vision'),
  ])
  return {
    settings:
      settings.revision === 0
        ? { revision: 0, roles: { chat: chat.selection, price: price.selection, vision: vision.selection } }
        : settings,
    effective: {
      chat: { mode: chat.mode, available: chat.available },
      price: { mode: price.mode, available: price.available },
      vision: { mode: vision.mode, available: vision.available },
    },
    catalog: MODEL_CATALOG,
  }
}

admin.get('/ai-settings', async (c) => c.json(await settingsResponse(c.env)))

admin.patch('/ai-settings', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || !Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 0) {
    return c.json({ error: 'Invalid AI settings' }, 400)
  }
  let roles: Record<AiRole, AiSelection>
  try {
    roles = validateRoles(body.roles)
  } catch {
    return c.json({ error: 'Invalid AI settings' }, 400)
  }
  const updated = await updateAiSettings(c.env.MOVERS_DB as D1Database, body.expectedRevision as number, roles)
  if (!updated) return c.json({ error: 'Settings changed; reload and retry.' }, 409)
  return c.json(await settingsResponse(c.env))
})

const csvCell = (value: string | number | null | undefined) => {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function leadsToCsv(leads: EstimateRecord[]): string {
  const header = [
    'id',
    'created_at',
    'status',
    'source',
    'from',
    'to',
    'distance_miles',
    'items',
    'low',
    'total',
    'high',
    'currency',
    'requested_date',
    'name',
    'email',
    'phone',
    'notes',
  ]
  const rows = leads.map((lead) =>
    [
      lead.id,
      lead.createdAt,
      lead.status,
      lead.source,
      lead.moveDetails.from,
      lead.moveDetails.to,
      lead.moveDetails.distanceMiles,
      lead.items.reduce((sum, item) => sum + item.count, 0),
      lead.price.low,
      lead.price.total,
      lead.price.high,
      lead.price.currency,
      lead.contact?.requestedDate,
      lead.contact?.name,
      lead.contact?.email,
      lead.contact?.phone,
      lead.notes,
    ]
      .map(csvCell)
      .join(','),
  )
  return [header.join(','), ...rows].join('\n')
}

admin.get('/leads.csv', async (c) => {
  const leads = await createStore(c.env).listEstimates()
  c.header('content-type', 'text/csv; charset=utf-8')
  c.header('content-disposition', 'attachment; filename="movers-leads.csv"')
  return c.body(leadsToCsv(leads))
})

admin.get('/leads', async (c) => {
  const status = zLeadStatus.safeParse(c.req.query('status'))
  const leads = await createStore(c.env).listEstimates(status.success ? { status: status.data } : undefined)
  return c.json({ leads })
})

admin.get('/leads/:id', async (c) => {
  const store = createStore(c.env)
  const lead = await store.getEstimate(c.req.param('id'))
  if (!lead) return c.json({ error: 'Lead not found' }, 404)
  const quoteRequests = await store.listQuoteRequests({ estimateId: lead.id })
  return c.json({ lead, quoteRequests })
})

admin.patch('/leads/:id', async (c) => {
  const parsed = zLeadUpdate.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid update', issues: parsed.error.issues }, 400)
  const lead = await createStore(c.env).updateEstimate(c.req.param('id'), parsed.data)
  if (!lead) return c.json({ error: 'Lead not found' }, 404)
  return c.json({ lead })
})

admin.get('/movers', async (c) => c.json({ movers: await createStore(c.env).listMovers() }))

admin.post('/movers', async (c) => {
  const parsed = zMoverInput.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid mover', issues: parsed.error.issues }, 400)
  const mover = await createStore(c.env).createMover(parsed.data)
  return c.json({ mover }, 201)
})

admin.patch('/movers/:id', async (c) => {
  const parsed = zMoverInput.partial().safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid mover', issues: parsed.error.issues }, 400)
  const mover = await createStore(c.env).updateMover(c.req.param('id'), parsed.data)
  if (!mover) return c.json({ error: 'Mover not found' }, 404)
  return c.json({ mover })
})

admin.get('/quote-requests', async (c) => c.json({ quoteRequests: await createStore(c.env).listQuoteRequests() }))

admin.patch('/quote-requests/:id', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { status?: unknown } | null
  const status = zQuoteRequestStatus.safeParse(body?.status)
  if (!status.success) return c.json({ error: 'Invalid status' }, 400)
  const request = await createStore(c.env).updateQuoteRequest(c.req.param('id'), status.data)
  if (!request) return c.json({ error: 'Quote request not found' }, 404)
  return c.json({ request })
})

export default admin
