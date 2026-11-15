/**
 * Persistence for saved estimates (leads), movers and quote requests.
 *
 * `createStore(env)` returns a D1-backed store when the `MOVERS_DB` binding exists and an in-memory store otherwise,
 * so tests and a bare `wrangler pages dev` need no SQLite. Both implement the same `Store` interface, and every record
 * that leaves the store is validated with the shared zod schemas.
 */
import type {
  Contact,
  CreateEstimateRequest,
  EstimateRecord,
  LeadStatus,
  MoverInput,
  MoverRecord,
  QuoteRequestRecord,
  QuoteRequestStatus,
} from '../../../src/data'
import { zEstimateRecord, zMoverRecord, zQuoteRequestRecord } from '../../../src/data'
import type { Bindings } from './types'

export interface EstimatePatch {
  contact?: Contact
  status?: LeadStatus
  notes?: string
}

export interface Store {
  listEstimates(filter?: { status?: LeadStatus }): Promise<EstimateRecord[]>
  getEstimate(id: string): Promise<EstimateRecord | null>
  createEstimate(input: CreateEstimateRequest): Promise<EstimateRecord>
  updateEstimate(id: string, patch: EstimatePatch): Promise<EstimateRecord | null>

  listMovers(filter?: { status?: 'active' | 'inactive' }): Promise<MoverRecord[]>
  getMover(id: string): Promise<MoverRecord | null>
  createMover(input: MoverInput): Promise<MoverRecord>
  updateMover(id: string, input: Partial<MoverInput>): Promise<MoverRecord | null>

  listQuoteRequests(filter?: { estimateId?: string }): Promise<QuoteRequestRecord[]>
  createQuoteRequests(estimateId: string, moverIds: string[], note: string): Promise<QuoteRequestRecord[]>
  updateQuoteRequest(id: string, status: QuoteRequestStatus): Promise<QuoteRequestRecord | null>
}

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** 22 URL-safe random characters (about 131 bits). */
export function newId(): string {
  const bytes = new Uint8Array(22)
  crypto.getRandomValues(bytes)
  let id = ''
  for (const byte of bytes) id += ID_ALPHABET[byte % ID_ALPHABET.length]
  return id
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'mover'
  )
}

const now = () => new Date().toISOString()

/** Movers every fresh database starts with, so the quote picker and the admin have something to show. */
export const SEED_MOVERS: MoverInput[] = [
  {
    name: 'Blue Crate Movers',
    email: 'quotes@bluecrate.example',
    website: 'https://bluecrate.example',
    serviceArea: 'Boston and the North Shore',
    status: 'active',
  },
  {
    name: 'Harbor Line Moving',
    email: 'hello@harborline.example',
    website: 'https://harborline.example',
    serviceArea: 'New England, long distance',
    status: 'active',
  },
  {
    name: 'Two Guys and a Dolly',
    email: 'book@twoguysdolly.example',
    website: '',
    serviceArea: 'Greater Hartford',
    status: 'active',
  },
]

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

export class MemoryStore implements Store {
  private estimates = new Map<string, EstimateRecord>()
  private movers = new Map<string, MoverRecord>()
  private quoteRequests = new Map<string, QuoteRequestRecord>()

  constructor(seed: MoverInput[] = SEED_MOVERS) {
    for (const mover of seed) void this.createMover(mover)
  }

  private uniqueSlug(name: string): string {
    const base = slugify(name)
    let slug = base
    let n = 2
    while ([...this.movers.values()].some((m) => m.slug === slug)) slug = `${base}-${n++}`
    return slug
  }

  async listEstimates(filter?: { status?: LeadStatus }): Promise<EstimateRecord[]> {
    return [...this.estimates.values()]
      .filter((e) => !filter?.status || e.status === filter.status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async getEstimate(id: string): Promise<EstimateRecord | null> {
    return this.estimates.get(id) ?? null
  }

  async createEstimate(input: CreateEstimateRequest): Promise<EstimateRecord> {
    const stamp = now()
    const record = zEstimateRecord.parse({
      ...input,
      id: newId(),
      createdAt: stamp,
      updatedAt: stamp,
      contact: null,
      status: 'new',
      notes: '',
    })
    this.estimates.set(record.id, record)
    return record
  }

  async updateEstimate(id: string, patch: EstimatePatch): Promise<EstimateRecord | null> {
    const current = this.estimates.get(id)
    if (!current) return null
    const record = zEstimateRecord.parse({
      ...current,
      contact: patch.contact ?? current.contact,
      status: patch.status ?? current.status,
      notes: patch.notes ?? current.notes,
      updatedAt: now(),
    })
    this.estimates.set(id, record)
    return record
  }

  async listMovers(filter?: { status?: 'active' | 'inactive' }): Promise<MoverRecord[]> {
    return [...this.movers.values()]
      .filter((m) => !filter?.status || m.status === filter.status)
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async getMover(id: string): Promise<MoverRecord | null> {
    return this.movers.get(id) ?? null
  }

  async createMover(input: MoverInput): Promise<MoverRecord> {
    const record = zMoverRecord.parse({ ...input, id: newId(), slug: this.uniqueSlug(input.name), createdAt: now() })
    this.movers.set(record.id, record)
    return record
  }

  async updateMover(id: string, input: Partial<MoverInput>): Promise<MoverRecord | null> {
    const current = this.movers.get(id)
    if (!current) return null
    const record = zMoverRecord.parse({ ...current, ...input })
    this.movers.set(id, record)
    return record
  }

  async listQuoteRequests(filter?: { estimateId?: string }): Promise<QuoteRequestRecord[]> {
    return [...this.quoteRequests.values()]
      .filter((q) => !filter?.estimateId || q.estimateId === filter.estimateId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async createQuoteRequests(estimateId: string, moverIds: string[], note: string): Promise<QuoteRequestRecord[]> {
    const created: QuoteRequestRecord[] = []
    for (const moverId of moverIds) {
      const mover = this.movers.get(moverId)
      if (!mover) continue
      const record = zQuoteRequestRecord.parse({
        id: newId(),
        estimateId,
        moverId,
        moverName: mover.name,
        note,
        status: 'logged',
        createdAt: now(),
      })
      this.quoteRequests.set(record.id, record)
      created.push(record)
    }
    return created
  }

  async updateQuoteRequest(id: string, status: QuoteRequestStatus): Promise<QuoteRequestRecord | null> {
    const current = this.quoteRequests.get(id)
    if (!current) return null
    const record = { ...current, status }
    this.quoteRequests.set(id, record)
    return record
  }
}

// ---------------------------------------------------------------------------
// D1 store
// ---------------------------------------------------------------------------

interface EstimateRow {
  id: string
  created_at: string
  updated_at: string
  source: string
  status: string
  move_details: string
  analysis: string
  items: string
  price: string
  photo_keys: string
  contact: string | null
  notes: string
}

interface MoverRow {
  id: string
  slug: string
  name: string
  email: string
  website: string
  service_area: string
  status: string
  created_at: string
}

interface QuoteRequestRow {
  id: string
  estimate_id: string
  mover_id: string
  mover_name: string
  note: string
  status: string
  created_at: string
}

const parseJson = (text: string | null) => (text === null ? null : JSON.parse(text))

function rowToEstimate(row: EstimateRow): EstimateRecord {
  return zEstimateRecord.parse({
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: row.source,
    status: row.status,
    moveDetails: parseJson(row.move_details),
    analysis: parseJson(row.analysis),
    items: parseJson(row.items),
    price: parseJson(row.price),
    photoKeys: parseJson(row.photo_keys) ?? [],
    contact: parseJson(row.contact),
    notes: row.notes,
  })
}

function rowToMover(row: MoverRow): MoverRecord {
  return zMoverRecord.parse({
    id: row.id,
    slug: row.slug,
    name: row.name,
    email: row.email,
    website: row.website,
    serviceArea: row.service_area,
    status: row.status,
    createdAt: row.created_at,
  })
}

function rowToQuoteRequest(row: QuoteRequestRow): QuoteRequestRecord {
  return zQuoteRequestRecord.parse({
    id: row.id,
    estimateId: row.estimate_id,
    moverId: row.mover_id,
    moverName: row.mover_name,
    note: row.note,
    status: row.status,
    createdAt: row.created_at,
  })
}

const QUOTE_SELECT =
  'SELECT q.id, q.estimate_id, q.mover_id, m.name AS mover_name, q.note, q.status, q.created_at FROM quote_requests q JOIN movers m ON m.id = q.mover_id'

export class D1Store implements Store {
  private seeded = false

  constructor(private readonly db: D1Database) {}

  /** Inserts the seed movers once into an empty `movers` table. */
  private async ensureSeed(): Promise<void> {
    if (this.seeded) return
    this.seeded = true
    const count = await this.db.prepare('SELECT COUNT(*) AS n FROM movers').first<{ n: number }>()
    if ((count?.n ?? 0) > 0) return
    for (const mover of SEED_MOVERS) await this.createMover(mover)
  }

  async listEstimates(filter?: { status?: LeadStatus }): Promise<EstimateRecord[]> {
    const statement = filter?.status
      ? this.db.prepare('SELECT * FROM estimates WHERE status = ? ORDER BY created_at DESC').bind(filter.status)
      : this.db.prepare('SELECT * FROM estimates ORDER BY created_at DESC')
    const { results } = await statement.all<EstimateRow>()
    return results.map(rowToEstimate)
  }

  async getEstimate(id: string): Promise<EstimateRecord | null> {
    const row = await this.db.prepare('SELECT * FROM estimates WHERE id = ?').bind(id).first<EstimateRow>()
    return row ? rowToEstimate(row) : null
  }

  async createEstimate(input: CreateEstimateRequest): Promise<EstimateRecord> {
    const stamp = now()
    const record = zEstimateRecord.parse({
      ...input,
      id: newId(),
      createdAt: stamp,
      updatedAt: stamp,
      contact: null,
      status: 'new',
      notes: '',
    })
    await this.db
      .prepare(
        'INSERT INTO estimates (id, created_at, updated_at, source, status, move_details, analysis, items, price, photo_keys, contact, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)',
      )
      .bind(
        record.id,
        record.createdAt,
        record.updatedAt,
        record.source,
        record.status,
        JSON.stringify(record.moveDetails),
        JSON.stringify(record.analysis),
        JSON.stringify(record.items),
        JSON.stringify(record.price),
        JSON.stringify(record.photoKeys),
        record.notes,
      )
      .run()
    return record
  }

  async updateEstimate(id: string, patch: EstimatePatch): Promise<EstimateRecord | null> {
    const current = await this.getEstimate(id)
    if (!current) return null
    const record = zEstimateRecord.parse({
      ...current,
      contact: patch.contact ?? current.contact,
      status: patch.status ?? current.status,
      notes: patch.notes ?? current.notes,
      updatedAt: now(),
    })
    await this.db
      .prepare('UPDATE estimates SET updated_at = ?, status = ?, notes = ?, contact = ? WHERE id = ?')
      .bind(record.updatedAt, record.status, record.notes, record.contact ? JSON.stringify(record.contact) : null, id)
      .run()
    return record
  }

  async listMovers(filter?: { status?: 'active' | 'inactive' }): Promise<MoverRecord[]> {
    await this.ensureSeed()
    const statement = filter?.status
      ? this.db.prepare('SELECT * FROM movers WHERE status = ? ORDER BY name').bind(filter.status)
      : this.db.prepare('SELECT * FROM movers ORDER BY name')
    const { results } = await statement.all<MoverRow>()
    return results.map(rowToMover)
  }

  async getMover(id: string): Promise<MoverRecord | null> {
    const row = await this.db.prepare('SELECT * FROM movers WHERE id = ?').bind(id).first<MoverRow>()
    return row ? rowToMover(row) : null
  }

  async createMover(input: MoverInput): Promise<MoverRecord> {
    const base = slugify(input.name)
    const { results } = await this.db
      .prepare('SELECT slug FROM movers WHERE slug = ? OR slug LIKE ?')
      .bind(base, `${base}-%`)
      .all<{ slug: string }>()
    const taken = new Set(results.map((r) => r.slug))
    let slug = base
    let n = 2
    while (taken.has(slug)) slug = `${base}-${n++}`
    const record = zMoverRecord.parse({ ...input, id: newId(), slug, createdAt: now() })
    await this.db
      .prepare(
        'INSERT INTO movers (id, slug, name, email, website, service_area, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        record.id,
        record.slug,
        record.name,
        record.email,
        record.website,
        record.serviceArea,
        record.status,
        record.createdAt,
      )
      .run()
    return record
  }

  async updateMover(id: string, input: Partial<MoverInput>): Promise<MoverRecord | null> {
    const current = await this.getMover(id)
    if (!current) return null
    const record = zMoverRecord.parse({ ...current, ...input })
    await this.db
      .prepare('UPDATE movers SET name = ?, email = ?, website = ?, service_area = ?, status = ? WHERE id = ?')
      .bind(record.name, record.email, record.website, record.serviceArea, record.status, id)
      .run()
    return record
  }

  async listQuoteRequests(filter?: { estimateId?: string }): Promise<QuoteRequestRecord[]> {
    const statement = filter?.estimateId
      ? this.db.prepare(`${QUOTE_SELECT} WHERE q.estimate_id = ? ORDER BY q.created_at DESC`).bind(filter.estimateId)
      : this.db.prepare(`${QUOTE_SELECT} ORDER BY q.created_at DESC`)
    const { results } = await statement.all<QuoteRequestRow>()
    return results.map(rowToQuoteRequest)
  }

  async createQuoteRequests(estimateId: string, moverIds: string[], note: string): Promise<QuoteRequestRecord[]> {
    const created: QuoteRequestRecord[] = []
    for (const moverId of moverIds) {
      const mover = await this.getMover(moverId)
      if (!mover) continue
      const record = zQuoteRequestRecord.parse({
        id: newId(),
        estimateId,
        moverId,
        moverName: mover.name,
        note,
        status: 'logged',
        createdAt: now(),
      })
      await this.db
        .prepare(
          'INSERT INTO quote_requests (id, estimate_id, mover_id, note, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .bind(record.id, record.estimateId, record.moverId, record.note, record.status, record.createdAt)
        .run()
      created.push(record)
    }
    return created
  }

  async updateQuoteRequest(id: string, status: QuoteRequestStatus): Promise<QuoteRequestRecord | null> {
    await this.db.prepare('UPDATE quote_requests SET status = ? WHERE id = ?').bind(status, id).run()
    const row = await this.db.prepare(`${QUOTE_SELECT} WHERE q.id = ?`).bind(id).first<QuoteRequestRow>()
    return row ? rowToQuoteRequest(row) : null
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let memory: MemoryStore | null = null

/** The in-memory store survives across requests in one worker instance; tests call `resetMemoryStore()`. */
export function resetMemoryStore(): void {
  memory = null
}

export function createStore(env: Pick<Bindings, 'MOVERS_DB'>): Store {
  if (env.MOVERS_DB) return new D1Store(env.MOVERS_DB)
  memory ??= new MemoryStore()
  return memory
}

/** `memory` when records live in this process only, `d1` when they are in the database. */
export function storeKind(env: Pick<Bindings, 'MOVERS_DB'>): 'memory' | 'd1' {
  return env.MOVERS_DB ? 'd1' : 'memory'
}
