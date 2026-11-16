import { z } from 'zod'
import { isBundledSampleUrl, loadSession, SESSION_KEY } from './estimate-session'
import {
  type ConversationSession,
  createConversationSession,
  zConversationDomain,
  zConversationSession,
} from './conversation-state'

export interface ConversationStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}
function storage(): ConversationStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}
function discard(store: ConversationStorage) {
  try {
    store.removeItem(SESSION_KEY)
  } catch {
    // Storage denial must not prevent a new in-memory conversation.
  }
  return createConversationSession()
}

export function loadConversationSession(store: ConversationStorage | null = storage()): ConversationSession {
  if (!store) return createConversationSession()
  let raw: string | null
  try {
    raw = store.getItem(SESSION_KEY)
  } catch {
    return createConversationSession()
  }
  if (!raw) return createConversationSession()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !('version' in parsed)) return discard(store)
    // Never pass v6 to loadSession: that loader intentionally removes unknown versions.
    if (parsed.version === 6) {
      const saved = zConversationSession.safeParse(parsed)
      if (!saved.success) return discard(store)
      return {
        ...saved.data,
        verifiedVisionFingerprint: null,
        operations: Object.fromEntries(
          Object.entries(saved.data.operations).map(([id, operation]) => [
            id,
            operation.status === 'pending' ? { ...operation, status: 'interrupted' as const } : operation,
          ]),
        ),
      }
    }
    if (parsed.version !== 3 && parsed.version !== 4 && parsed.version !== 5) return discard(store)
    // Use existing v3/v4 receipt/sample migration, but do not let it rewrite the stored draft.
    let rejected = false
    const legacy = loadSession({
      getItem: () => raw,
      setItem: () => {},
      removeItem: () => {
        rejected = true
      },
    })
    if (rejected) return discard(store)
    const originalId = 'sessionId' in parsed ? z.string().uuid().safeParse(parsed.sessionId) : null
    const base = createConversationSession()
    const domain = zConversationDomain.safeParse({
      ...legacy,
      sessionId: originalId?.success ? originalId.data : base.sessionId,
    })
    if (!domain.success) return discard(store)
    const urls = [...new Set([...domain.data.photoUrls, ...domain.data.photoRefs.map((ref) => ref.url)])]
    const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin
    const sample = domain.data.sample && urls.length > 0 && urls.every((url) => isBundledSampleUrl(url, origin))
    const photos = urls.map((url, index) => ({
      id: `photo-${index + 1}`,
      url,
      receipt: domain.data.photoRefs.find((ref) => ref.url === url)?.receipt ?? null,
    }))
    const migrated = zConversationSession.safeParse({
      ...base,
      ...domain.data,
      version: 6,
      sample,
      photos,
      photoUrls: urls,
      needsPhotoReupload: domain.data.needsPhotoReupload || photos.some((photo) => !photo.receipt && !sample),
      // A legacy route or chatFinished is not evidence of an explicit details confirmation.
      detailsConfirmed: false,
      suggestedFocus: domain.data.step,
      timeline: [
        ...domain.data.messages.map((message, index) => ({
          kind: 'message',
          id: `legacy-message-${index + 1}`,
          revision: 0,
          message,
        })),
        { kind: 'event', id: 'migration-v6', revision: 0, event: 'migration', area: 'details' },
      ],
      latestUpdate: { eventId: 'migration-v6', revision: 0, area: 'details' },
    })
    return migrated.success ? migrated.data : discard(store)
  } catch {
    return discard(store)
  }
}

export function saveConversationSession(
  state: ConversationSession,
  store: ConversationStorage | null = storage(),
): void {
  if (!store) return
  const parsed = zConversationSession.safeParse(state)
  if (!parsed.success) return
  try {
    store.setItem(SESSION_KEY, JSON.stringify(parsed.data))
  } catch {
    // Quota/private mode: preserve the current in-memory state; never log customer data.
  }
}
