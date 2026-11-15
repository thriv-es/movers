// @vitest-environment node
/**
 * Saved estimates, movers, quote requests and the admin API through the real Hono routes with the in-memory store.
 */
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Bindings } from '../functions/api/_lib/types'
import admin from '../functions/api/_routes/admin'
import estimates from '../functions/api/_routes/estimates'
import movers from '../functions/api/_routes/movers'
import quoteRequests from '../functions/api/_routes/quote-requests'
import { MemoryStore, newId, resetMemoryStore, slugify } from '../functions/api/_lib/store'

const env = (overrides: Record<string, unknown> = {}) => ({ ENV: 'development', PRICE_PER_BOX: '50', ...overrides })

function call(app: Hono<{ Bindings: Bindings }>, path: string, bindings: unknown, method = 'GET', body?: unknown) {
  return app.request(
    path,
    {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    bindings,
  )
}

const estimateBody = {
  moveDetails: {
    from: '1 Main St, Austin, TX',
    to: '2 Oak Ave, Dallas, TX',
    date: '2027-01-15',
    distanceMiles: 200,
    originFloor: 3,
    destinationFloor: 1,
    originElevator: false,
    destinationElevator: true,
  },
  analysis: {
    items: [{ type: 'sofa', count: 1 }],
    totalVolumeCubicFeet: 100,
    estimatedBoxes: { min: 5, max: 8 },
    boxesExplanation: 'x',
  },
  items: [
    { type: 'sofa', count: 1 },
    { type: 'boxes', count: 8 },
  ],
  price: { currency: 'USD', total: 1000, low: 800, high: 1200, breakdown: { a: 1000 }, confidence: 'medium' },
}

beforeEach(() => {
  resetMemoryStore()
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('estimates and quote requests', () => {
  it('saves an estimate, attaches contact, lists movers and logs quote requests', async () => {
    let res = await call(estimates, '/', env(), 'POST', estimateBody)
    expect(res.status).toBe(201)
    const { id, storage } = (await res.json()) as { id: string; storage: string }
    expect(id).toHaveLength(22)
    expect(storage).toBe('memory')

    res = await call(estimates, `/${id}`, env())
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('new')

    res = await call(estimates, `/${id}/contact`, env(), 'PATCH', {
      name: 'Ada',
      email: 'ada@example.com',
      phone: '',
      requestedDate: '2027-01-20',
    })
    expect(res.status).toBe(200)
    expect((await res.json()).reference).toBe(id)

    res = await call(movers, '/', env())
    const { movers: list } = (await res.json()) as { movers: { id: string; name: string; slug: string }[] }
    expect(list.length).toBeGreaterThanOrEqual(3)
    expect(Object.keys(list[0] ?? {}).sort()).toEqual(['id', 'name', 'serviceArea', 'slug'])

    const chosen = list.slice(0, 2).map((m) => m.id)
    res = await call(quoteRequests, '/', env(), 'POST', { estimateId: id, moverIds: chosen, note: 'Weekend please' })
    expect(res.status).toBe(201)
    const { requests, delivery } = (await res.json()) as {
      requests: { moverId: string; status: string }[]
      delivery: Record<string, string>
    }
    expect(requests.map((r) => r.moverId)).toEqual(chosen)
    expect(requests.every((r) => r.status === 'logged')).toBe(true)
    expect(Object.values(delivery)).toEqual(['logged', 'logged'])
    // the outgoing email is logged, never sent
    const logged = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]))
    expect(logged.filter((line) => line.includes('[outbound-email]'))).toHaveLength(2)
    expect(logged.join('\n')).toContain('Weekend please')

    res = await call(estimates, `/${id}`, env())
    expect((await res.json()).status).toBe('quoted')
  })

  it('validates input and unknown ids', async () => {
    expect((await call(estimates, '/', env(), 'POST', { nope: 1 })).status).toBe(400)
    expect((await call(estimates, '/missing', env())).status).toBe(404)
    expect((await call(estimates, '/missing/contact', env(), 'PATCH', { name: 'a', email: 'bad' })).status).toBe(400)
    expect((await call(quoteRequests, '/', env(), 'POST', { estimateId: 'missing', moverIds: ['x'] })).status).toBe(404)
    const saved = (await (await call(estimates, '/', env(), 'POST', estimateBody)).json()) as { id: string }
    expect((await call(quoteRequests, '/', env(), 'POST', { estimateId: saved.id, moverIds: ['x'] })).status).toBe(400)
    expect(
      (await call(quoteRequests, '/', env(), 'POST', { estimateId: saved.id, moverIds: ['a', 'b', 'c', 'd'] })).status,
    ).toBe(400)
  })
})

describe('admin API', () => {
  it('lists, filters, updates leads and exports CSV', async () => {
    const saved = (await (await call(estimates, '/', env(), 'POST', estimateBody)).json()) as { id: string }
    await call(estimates, '/', env(), 'POST', { ...estimateBody, source: 'sample' })

    let res = await call(admin, '/leads', env())
    expect(res.status).toBe(200)
    expect((await res.json()).leads).toHaveLength(2)

    res = await call(admin, `/leads/${saved.id}`, env(), 'PATCH', { status: 'won', notes: 'Signed, "yes"' })
    expect(res.status).toBe(200)
    expect((await res.json()).lead).toMatchObject({ status: 'won', notes: 'Signed, "yes"' })

    res = await call(admin, '/leads?status=won', env())
    expect((await res.json()).leads).toHaveLength(1)
    res = await call(admin, '/leads?status=bogus', env())
    expect((await res.json()).leads).toHaveLength(2)

    res = await call(admin, `/leads/${saved.id}`, env())
    expect((await res.json()).lead.id).toBe(saved.id)
    expect((await call(admin, '/leads/missing', env())).status).toBe(404)

    res = await call(admin, '/leads.csv', env())
    expect(res.headers.get('content-type')).toContain('text/csv')
    const csv = await res.text()
    expect(csv.split('\n')).toHaveLength(3)
    expect(csv).toContain('"Signed, ""yes"""')
    expect(csv.split('\n')[0]).toContain('id,created_at,status')
  })

  it('creates and edits movers, lists quote requests, reports storage', async () => {
    let res = await call(admin, '/movers', env(), 'POST', { name: 'Blue Crate Movers', email: 'x@y.example' })
    expect(res.status).toBe(201)
    const { mover } = (await res.json()) as { mover: { id: string; slug: string; status: string } }
    // slug stays unique against the seeded mover of the same name
    expect(mover.slug).toBe('blue-crate-movers-2')
    expect(mover.status).toBe('active')

    res = await call(admin, `/movers/${mover.id}`, env(), 'PATCH', { status: 'inactive' })
    expect((await res.json()).mover.status).toBe('inactive')
    // inactive movers leave the public list
    const pub = (await (await call(movers, '/', env())).json()) as { movers: { id: string }[] }
    expect(pub.movers.some((m) => m.id === mover.id)).toBe(false)

    expect((await call(admin, '/movers', env(), 'POST', { name: '', email: 'nope' })).status).toBe(400)
    expect((await call(admin, '/movers/missing', env(), 'PATCH', { name: 'x' })).status).toBe(404)

    res = await call(admin, '/quote-requests', env())
    expect((await res.json()).quoteRequests).toEqual([])
    res = await call(admin, '/status', env())
    expect(await res.json()).toEqual({ storage: 'memory', env: 'development' })
  })

  it('is a 404 in production, for every path', async () => {
    for (const path of ['/leads', '/leads.csv', '/movers', '/quote-requests', '/status']) {
      const res = await call(admin, path, env({ ENV: 'production' }))
      expect(res.status, path).toBe(404)
    }
    expect(
      (await call(admin, '/movers', env({ ENV: 'production' }), 'POST', { name: 'a', email: 'a@b.c' })).status,
    ).toBe(404)
    // the customer-facing routes keep working
    expect((await call(movers, '/', env({ ENV: 'production' }))).status).toBe(200)
  })
})

describe('store helpers', () => {
  it('newId is 22 url-safe chars and unique', () => {
    const ids = new Set(Array.from({ length: 50 }, newId))
    expect(ids.size).toBe(50)
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9]{22}$/)
  })

  it('slugify', () => {
    expect(slugify('  Two Guys & a Dolly! ')).toBe('two-guys-a-dolly')
    expect(slugify('***')).toBe('mover')
  })

  it('MemoryStore can start empty', async () => {
    expect(await new MemoryStore([]).listMovers()).toEqual([])
  })
})
