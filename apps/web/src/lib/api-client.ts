import type {
  AnalysisResult,
  ChatApiResponse,
  ChatMessage,
  Contact,
  CreateEstimateRequest,
  MoveDetails,
  PriceResult,
  ReviewCoverage,
  PublicMover,
  QuoteRequestRecord,
} from '@/data'
import { recordAiMode } from '@/lib/ai-mode-store'
import type { PhotoRef } from '@/lib/estimate-session'

/**
 * API client for the estimator. Relative URLs are proxied to the Functions backend in dev and served
 * from the same origin in production.
 */

async function readError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null
  return new Error(body?.error || `HTTP ${response.status}: ${response.statusText}`)
}

async function postJson<T>(path: string, body: unknown, options: { ai?: boolean } = {}): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw await readError(response)
  if (options.ai) recordAiMode(response)
  return response.json() as Promise<T>
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw await readError(response)
  return response.json() as Promise<T>
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) throw await readError(response)
  return response.json() as Promise<T>
}

/** One chat turn: the server replies with plain text plus the structured move details it has so far. */
export function chatApi(messages: ChatMessage[], moveDetails?: Partial<MoveDetails>): Promise<ChatApiResponse> {
  return postJson<ChatApiResponse>('/api/chat', { messages, moveDetails }, { ai: true })
}

/**
 * Uploads one photo and returns its session-bound receipt. One request per photo preserves card progress.
 */
export function uploadImage(file: File, sessionId: string, onProgress?: (percent: number) => void): Promise<PhotoRef> {
  return new Promise<PhotoRef>((resolve, reject) => {
    const form = new FormData()
    form.append('sessionId', sessionId)
    form.append('images', file)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/images/upload')
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(Math.round((event.loaded / event.total) * 100))
    }
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'))
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        let message = `Upload failed (HTTP ${xhr.status})`
        try {
          const body = JSON.parse(xhr.responseText) as { error?: string }
          if (body.error) message = body.error
        } catch {
          // keep the generic message
        }
        reject(new Error(message))
        return
      }
      try {
        const body = JSON.parse(xhr.responseText) as { uploads?: PhotoRef[] }
        const ref = body.uploads?.[0]
        if (!ref || typeof ref.url !== 'string' || typeof ref.receipt !== 'string' || !ref.receipt) {
          throw new Error('Upload returned no photo receipt')
        }
        onProgress?.(100)
        resolve(ref)
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Upload returned an unexpected response'))
      }
    }
    xhr.send(form)
  })
}

/** Detects items in the uploaded photos. `sample` marks the bundled sample move so the server can cache it. */
export function analyzeApi(imageUrls: string[], sample = false): Promise<AnalysisResult> {
  return postJson<AnalysisResult>('/api/analyze', { imageUrls, sample }, { ai: true })
}

/** Prices the confirmed inventory for the given move details. */
export function priceApi(
  analysis: AnalysisResult,
  moveDetails: MoveDetails,
  review: ReviewCoverage,
  sample = false,
): Promise<PriceResult> {
  return postJson<PriceResult>('/api/price', { analysis, moveDetails, review, sample }, { ai: true })
}

export interface CreatedEstimate {
  id: string
  storage: 'd1' | 'memory'
}

/** Saves the estimate as a lead. */
export function createEstimate(request: CreateEstimateRequest): Promise<CreatedEstimate> {
  return postJson<CreatedEstimate>('/api/estimates', request)
}

export interface ContactResult {
  reference: string
  requestedDate: string
  note: string
}

/** Attaches the customer's contact details and requested date to a saved estimate. */
export function attachContact(estimateId: string, contact: Contact): Promise<ContactResult> {
  return patchJson<ContactResult>(`/api/estimates/${encodeURIComponent(estimateId)}/contact`, contact)
}

/** Movers the customer can ask for quotes. */
export async function listMovers(): Promise<PublicMover[]> {
  const body = await getJson<{ movers: PublicMover[] }>('/api/movers')
  return body.movers
}

export interface QuoteRequestsResult {
  requests: QuoteRequestRecord[]
  /** Delivery channel per mover id. v1 only logs the email, so every value is `logged`. */
  delivery: Record<string, 'logged' | string>
}

/** Asks up to three movers for a quote on a saved estimate. */
export function requestQuotes(estimateId: string, moverIds: string[], note = ''): Promise<QuoteRequestsResult> {
  return postJson<QuoteRequestsResult>('/api/quote-requests', { estimateId, moverIds, note })
}
