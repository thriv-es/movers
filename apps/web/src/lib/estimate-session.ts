import type { AnalysisResult, ChatMessage, Contact, DetectedItem, MoveDetails, Price, ReviewCoverage } from '@/data'
import { EMPTY_MOVE_DETAILS } from '@/data'

/**
 * The customer's progress through the estimator, kept in sessionStorage so a refresh or a phone
 * switching apps mid-upload does not throw the work away (MOVERS-12).
 */

export type EstimateStep = 'chat' | 'details' | 'upload' | 'review' | 'estimate' | 'schedule'

export const ESTIMATE_STEPS: EstimateStep[] = ['chat', 'details', 'upload', 'review', 'estimate', 'schedule']

/** Bump when the shape changes; v3 drafts are migrated below. */
export const SESSION_VERSION = 4

export const SESSION_KEY = 'movers.estimate'

export type FollowUpKey = 'garage' | 'closets' | 'appliances'

/** Answers to the three review follow-ups; null until answered. */
export type FollowUpAnswers = ReviewCoverage['followUps']

export const EMPTY_FOLLOW_UPS: FollowUpAnswers = { garage: null, closets: null, appliances: null }

export interface EstimateSession {
  version: number
  step: EstimateStep
  messages: ChatMessage[]
  moveDetails: MoveDetails
  chatFinished: boolean
  /** Public URLs of the uploaded (or bundled sample) photos. */
  photoUrls: string[]
  analysis: AnalysisResult | null
  /** The inventory as the customer confirmed it; starts as the detected items. */
  items: DetectedItem[]
  followUps: FollowUpAnswers
  wholeMoveCovered: boolean | null
  price: Price | null
  estimateId: string | null
  contact: Contact | null
  /** True when the bundled sample move is being used instead of the customer's own photos. */
  sample: boolean
}

export const EMPTY_SESSION: EstimateSession = {
  version: SESSION_VERSION,
  step: 'chat',
  messages: [],
  moveDetails: EMPTY_MOVE_DETAILS,
  chatFinished: false,
  photoUrls: [],
  analysis: null,
  items: [],
  followUps: EMPTY_FOLLOW_UPS,
  wholeMoveCovered: null,
  price: null,
  estimateId: null,
  contact: null,
  sample: false,
}

/** The bundled sample move: a two-bedroom flat, third floor without an elevator, 120 miles away. */
export const SAMPLE_MOVE_DETAILS: MoveDetails = {
  from: 'Boston, MA',
  to: 'Hartford, CT',
  date: null,
  distanceMiles: 120,
  originFloor: 3,
  destinationFloor: 1,
  originElevator: false,
  destinationElevator: true,
}

export const SAMPLE_PHOTO_PATHS = ['/sample/living-room.jpg', '/sample/bedroom.jpg', '/sample/kitchen.jpg']

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function storage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

function isStep(value: unknown): value is EstimateStep {
  return typeof value === 'string' && (ESTIMATE_STEPS as string[]).includes(value)
}

/**
 * Reads a saved session. v3 drafts keep the inventory and photos but must be repriced after review;
 * unsupported versions and invalid steps are discarded.
 */
export function loadSession(store: StorageLike | null = storage()): EstimateSession {
  if (!store) return EMPTY_SESSION
  const raw = store.getItem(SESSION_KEY)
  if (!raw) return EMPTY_SESSION
  try {
    const parsed = JSON.parse(raw) as Partial<EstimateSession> | null
    if (!parsed || typeof parsed !== 'object' || !isStep(parsed.step)) {
      store.removeItem(SESSION_KEY)
      return EMPTY_SESSION
    }
    if (parsed.version === 3) {
      return {
        ...EMPTY_SESSION, ...parsed, version: SESSION_VERSION,
        step: parsed.analysis ? 'review' : 'upload',
        price: null, estimateId: null, wholeMoveCovered: null,
      }
    }
    if (parsed.version !== SESSION_VERSION) {
      store.removeItem(SESSION_KEY)
      return EMPTY_SESSION
    }
    return { ...EMPTY_SESSION, ...parsed, version: SESSION_VERSION }
  } catch {
    store.removeItem(SESSION_KEY)
    return EMPTY_SESSION
  }
}

export function saveSession(session: EstimateSession, store: StorageLike | null = storage()): void {
  if (!store) return
  try {
    store.setItem(SESSION_KEY, JSON.stringify({ ...session, version: SESSION_VERSION }))
  } catch {
    // quota or private mode: the flow still works for this page load
  }
}

export function clearSession(store: StorageLike | null = storage()): void {
  store?.removeItem(SESSION_KEY)
}

/** A fresh session preloaded with the sample move. */
export function sampleSession(origin: string): EstimateSession {
  return {
    ...EMPTY_SESSION,
    step: 'upload',
    chatFinished: true,
    moveDetails: SAMPLE_MOVE_DETAILS,
    photoUrls: SAMPLE_PHOTO_PATHS.map((path) => `${origin}${path}`),
    sample: true,
  }
}
