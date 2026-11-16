import type { AnalysisResult, ChatMessage, Contact, DetectedItem, MoveDetails, Price, ReviewCoverage } from '@/data'
import { EMPTY_MOVE_DETAILS } from '@/data'
import { SAMPLE_PHOTO_PATHS, samplePhotoPath } from '../data/sample-photos'
import { canonicalItemType } from './item-aliases'
export interface PhotoRef {
  url: string
  receipt: string | null
}

/**
 * The customer's progress through the estimator, kept in sessionStorage so a refresh or a phone
 * switching apps mid-upload does not throw the work away (MOVERS-12).
 */

export type EstimateStep = 'chat' | 'details' | 'upload' | 'review' | 'estimate' | 'schedule'

export const ESTIMATE_STEPS: EstimateStep[] = ['chat', 'details', 'upload', 'review', 'estimate', 'schedule']

/** Bump when the shape changes; v3/v4 drafts are migrated below. */
export const SESSION_VERSION = 5

export const SESSION_KEY = 'movers.estimate'

export type FollowUpKey = 'garage' | 'closets' | 'appliances'

/** Answers to the three review follow-ups; null until answered. */
export type FollowUpAnswers = ReviewCoverage['followUps']

export const EMPTY_FOLLOW_UPS: FollowUpAnswers = { garage: null, closets: null, appliances: null }

export interface EstimateSession {
  version: number
  sessionId: string
  step: EstimateStep
  messages: ChatMessage[]
  moveDetails: MoveDetails
  chatFinished: boolean
  /** Public URLs of the uploaded (or bundled sample) photos. */
  photoUrls: string[]
  photoRefs: PhotoRef[]
  /** Legacy own-photo thumbnails need new uploads before analysis. */
  needsPhotoReupload: boolean
  analysis: AnalysisResult | null
  photoDecisions: Record<string, 'keep' | 'exclude'>
  photoDecisionsLocked: boolean
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
  sessionId: crypto.randomUUID(),
  step: 'chat',
  messages: [],
  moveDetails: EMPTY_MOVE_DETAILS,
  chatFinished: false,
  photoUrls: [],
  photoRefs: [],
  needsPhotoReupload: false,
  analysis: null,
  photoDecisions: {},
  photoDecisionsLocked: false,
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

export { SAMPLE_PHOTO_PATHS } from '../data/sample-photos'

export function isBundledSampleUrl(value: string, origin: string = window.location.origin): boolean {
  return samplePhotoPath(value, origin) !== null
}

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

export function newSession(): EstimateSession {
  return { ...EMPTY_SESSION, sessionId: crypto.randomUUID() }
}

/** Reads a saved session; legacy own-photo URLs remain visible but never become verified refs. */
export function loadSession(store: StorageLike | null = storage()): EstimateSession {
  if (!store) return newSession()
  const raw = store.getItem(SESSION_KEY)
  if (!raw) return newSession()
  try {
    const parsed = JSON.parse(raw) as Partial<EstimateSession> | null
    if (!parsed || typeof parsed !== 'object' || !isStep(parsed.step)) {
      store.removeItem(SESSION_KEY)
      return newSession()
    }
    if (parsed.version === 3 || parsed.version === 4) {
      const photoUrls = Array.isArray(parsed.photoUrls)
        ? parsed.photoUrls.filter((url): url is string => typeof url === 'string')
        : []
      const sample = parsed.sample === true && photoUrls.length > 0 && photoUrls.every((url) => isBundledSampleUrl(url))
      const needsPhotoReupload =
        !sample &&
        (photoUrls.length > 0 ||
          !!parsed.analysis ||
          !!parsed.price ||
          parsed.step === 'review' ||
          parsed.step === 'estimate' ||
          parsed.step === 'schedule')
      return {
        ...EMPTY_SESSION,
        ...parsed,
        version: SESSION_VERSION,
        sessionId: crypto.randomUUID(),
        photoUrls,
        sample,
        photoRefs: sample ? photoUrls.map((url) => ({ url, receipt: null })) : [],
        needsPhotoReupload,
        ...(needsPhotoReupload
          ? {
              step: 'upload' as const,
              analysis: null,
              items: [],
              followUps: { ...EMPTY_FOLLOW_UPS },
              wholeMoveCovered: null,
              price: null,
              estimateId: null,
              contact: null,
            }
          : parsed.version === 3
            ? {
                step: parsed.analysis ? ('review' as const) : ('upload' as const),
                price: null,
                estimateId: null,
                wholeMoveCovered: null,
              }
            : {}),
      }
    }
    if (parsed.version !== SESSION_VERSION) {
      store.removeItem(SESSION_KEY)
      return newSession()
    }
    return { ...EMPTY_SESSION, ...parsed, version: SESSION_VERSION }
  } catch {
    store.removeItem(SESSION_KEY)
    return newSession()
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
    ...newSession(),
    step: 'upload',
    chatFinished: true,
    moveDetails: SAMPLE_MOVE_DETAILS,
    photoUrls: SAMPLE_PHOTO_PATHS.map((path) => `${origin}${path}`),
    photoRefs: SAMPLE_PHOTO_PATHS.map((path) => ({ url: `${origin}${path}`, receipt: null })),
    sample: true,
  }
}
