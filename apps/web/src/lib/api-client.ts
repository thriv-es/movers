import type {
  AnalysisResult,
  ChatApiResponse,
  ChatMessage,
  Contact,
  CreateEstimateRequest,
  MoveDetails,
  PriceResult,
  ReviewCoverage,
  VisionStatus,
  PublicMover,
  QuoteRequestRecord,
} from '@/data'
import { zPhotoAssessment, zVisionStatus } from '@/data'
import { recordAiMode } from '@/lib/ai-mode-store'
import type { PhotoRef } from '@/lib/estimate-session'
import { z } from 'zod'
import { conversationContext } from './conversation-context'
import {
  zConversationProposal,
  zConversationRevision,
  type ConversationSnapshot,
} from '../data/z-common/z-conversation'

/** Frontend-only ingress contract: never import the Functions parser or mock here. */
export const zConversationResponse = z
  .object({
    reply: z.string().trim().min(1).max(3000),
    basedOnRevision: zConversationRevision,
    proposals: z.array(zConversationProposal).max(12),
  })
  .strict()
  .superRefine((response, context) => {
    const ids = new Set<string>()
    let details = false
    for (const proposal of response.proposals) {
      if (ids.has(proposal.id) || proposal.expectedRevision !== response.basedOnRevision)
        context.addIssue({ code: 'custom', message: 'Invalid proposal envelope' })
      ids.add(proposal.id)
      if (proposal.command.type === 'details.patch') {
        const date = proposal.command.patch.date
        if (
          details ||
          (date != null &&
            (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
              !Number.isFinite(Date.parse(date)) ||
              new Date(date).toISOString().slice(0, 10) !== date))
        )
          context.addIssue({ code: 'custom', message: 'Invalid detail proposal' })
        details = true
      }
    }
  })
export type ConversationResponse = z.infer<typeof zConversationResponse>

/**
 * API client for the estimator. Relative URLs are proxied to the Functions backend in dev and served
 * from the same origin in production.
 */

export class EstimateApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly photoAssessments: NonNullable<AnalysisResult['photoAssessments']> = [],
  ) {
    super(message)
  }
}

async function readError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as {
    error?: string
    code?: string
    photoAssessments?: unknown
  } | null
  const photos = zPhotoAssessment.array().safeParse(body?.photoAssessments)
  return new EstimateApiError(
    body?.error || `HTTP ${response.status}: ${response.statusText}`,
    body?.code,
    photos.success ? photos.data : [],
  )
}

export class ReanalyzeRequiredError extends EstimateApiError {
  constructor() {
    super('Photo analysis settings changed. Analyze your photos again.', 'REANALYZE_REQUIRED')
  }
}

export async function aiStatus(): Promise<VisionStatus> {
  const response = await fetch('/api/ai-status', { cache: 'no-store' })
  if (!response.ok) throw await readError(response)
  return zVisionStatus.parse(await response.json())
}

export async function checkVision(analysis: AnalysisResult): Promise<void> {
  const current = await aiStatus()
  if (!analysis.visionFingerprint || analysis.visionFingerprint !== current.visionFingerprint)
    throw new ReanalyzeRequiredError()
}

async function postJson<T>(
  path: string,
  body: unknown,
  options: { ai?: boolean; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options.signal,
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
export function chatApi(
  messages: ChatMessage[],
  moveDetails?: Partial<MoveDetails>,
  signal?: AbortSignal,
): Promise<ChatApiResponse> {
  return postJson<ChatApiResponse>('/api/chat', { messages, moveDetails }, { ai: true, signal })
}

/** Stateful conversation turns carry only the public snapshot and transcript. */
export async function conversationChatApi(
  messages: ChatMessage[],
  snapshot: ConversationSnapshot,
  signal?: AbortSignal,
): Promise<ConversationResponse> {
  const response = zConversationResponse.parse(
    await postJson<unknown>('/api/conversation', conversationContext(messages, snapshot), { ai: true, signal }),
  )
  if (response.basedOnRevision !== snapshot.revision) throw new Error('Stale conversation response')
  return response
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
export function analyzeApi(
  sessionId: string,
  photoRefs: PhotoRef[],
  moveDetails: MoveDetails,
  sample = false,
): Promise<AnalysisResult> {
  return postJson<AnalysisResult>('/api/analyze', { sessionId, photoRefs, moveDetails, sample }, { ai: true })
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
