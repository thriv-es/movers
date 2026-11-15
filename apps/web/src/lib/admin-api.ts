/**
 * Typed fetch helpers for the local admin API (`/api/admin/...`).
 * Every helper throws an `Error` carrying the server's `error` message (or `HTTP <status>`) on a non-2xx response.
 */
import type {
  EstimateRecord,
  LeadStatus,
  LeadUpdate,
  MoverInput,
  MoverRecord,
  QuoteRequestRecord,
  QuoteRequestStatus,
} from '@/data'
// Mirror the local settings API contract without importing Worker files into the browser's TS rootDir.
export type AiRole = 'chat' | 'price' | 'vision'
export interface AiSelection {
  backend: 'gateway' | 'binding'
  model: string
}

export interface AdminAiSettings {
  settings: { revision: number; roles: Record<AiRole, AiSelection> }
  effective: Record<AiRole, { mode: 'gateway' | 'binding' | 'mock'; available: boolean }>
  catalog: Record<AiRole, readonly { model: string; label: string; caveat?: string }[]>
}

export interface AdminStatus {
  storage: 'd1' | 'memory'
  env: string
}

export interface LeadDetail {
  lead: EstimateRecord
  quoteRequests: QuoteRequestRecord[]
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (!text) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`Invalid JSON (HTTP ${response.status})`)
  }
}

function errorMessage(body: unknown, status: number): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const message = (body as { error?: unknown }).error
    if (typeof message === 'string' && message.length > 0) return message
  }
  return `HTTP ${status}`
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(path, { credentials: 'same-origin', ...init, headers })
  const body = await readJson<unknown>(response)
  if (!response.ok) throw new Error(errorMessage(body, response.status))
  return body as T
}

/** Returns `null` when admin is switched off (the server answers 404 or `{error}`). */
export async function adminStatus(): Promise<AdminStatus | null> {
  const response = await fetch('/api/admin/status', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
  if (response.status === 404) return null
  const body = await readJson<unknown>(response)
  if (!response.ok) throw new Error(errorMessage(body, response.status))
  if (typeof body === 'object' && body !== null && 'error' in body) return null
  return body as AdminStatus
}

export function adminAiSettings(): Promise<AdminAiSettings> {
  return request<AdminAiSettings>('/api/admin/ai-settings')
}

export function saveAdminAiSettings(
  expectedRevision: number,
  roles: Record<AiRole, AiSelection>,
): Promise<AdminAiSettings> {
  return request<AdminAiSettings>('/api/admin/ai-settings', {
    method: 'PATCH',
    body: JSON.stringify({ expectedRevision, roles }),
  })
}

export async function listLeads(status?: LeadStatus): Promise<EstimateRecord[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : ''
  const { leads } = await request<{ leads: EstimateRecord[] }>(`/api/admin/leads${query}`)
  return leads
}

export function getLead(id: string): Promise<LeadDetail> {
  return request<LeadDetail>(`/api/admin/leads/${encodeURIComponent(id)}`)
}

export async function updateLead(id: string, patch: LeadUpdate): Promise<EstimateRecord> {
  const { lead } = await request<{ lead: EstimateRecord }>(`/api/admin/leads/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  return lead
}

export async function listMovers(): Promise<MoverRecord[]> {
  const { movers } = await request<{ movers: MoverRecord[] }>('/api/admin/movers')
  return movers
}

export async function createMover(input: MoverInput): Promise<MoverRecord> {
  const { mover } = await request<{ mover: MoverRecord }>('/api/admin/movers', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return mover
}

export async function updateMover(id: string, patch: Partial<MoverInput>): Promise<MoverRecord> {
  const { mover } = await request<{ mover: MoverRecord }>(`/api/admin/movers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  return mover
}

export async function listQuoteRequests(): Promise<QuoteRequestRecord[]> {
  const { quoteRequests } = await request<{ quoteRequests: QuoteRequestRecord[] }>('/api/admin/quote-requests')
  return quoteRequests
}

export async function updateQuoteRequest(id: string, status: QuoteRequestStatus): Promise<QuoteRequestRecord> {
  const { request: updated } = await request<{ request: QuoteRequestRecord }>(
    `/api/admin/quote-requests/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify({ status }) },
  )
  return updated
}

/** Formats a whole-dollar amount in the estimate's currency. */
export function formatMoney(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
}

/** Formats an ISO timestamp as a local date and time. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

export function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
