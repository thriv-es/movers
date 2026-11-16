import { describe, expect, it } from 'vitest'
import { zConversationProposal, zConversationSnapshot } from '../src/data/z-common/z-conversation'
import { loadConversationSession, saveConversationSession } from '../src/lib/conversation-session'
import {
  conversationReadiness,
  conversationSnapshot,
  createConversationSession,
  reduceConversation,
} from '../src/lib/conversation-state'
import { newSession, SAMPLE_MOVE_DETAILS, SESSION_KEY } from '../src/lib/estimate-session'

class Store {
  value: string | null = null
  getItem(key: string) {
    expect(key).toBe('movers.estimate')
    return this.value
  }
  setItem(key: string, value: string) {
    expect(key).toBe('movers.estimate')
    this.value = value
  }
  removeItem(key: string) {
    expect(key).toBe('movers.estimate')
    this.value = null
  }
}
const analysis = {
  visionRevision: 1,
  visionFingerprint: 'vision-one',
  items: [{ type: 'sofa', count: 2 }],
  totalVolumeCubicFeet: 160,
  estimatedBoxes: { min: 2, max: 4 },
  boxesExplanation: '',
  specialHandling: [],
  possibleDuplicates: [{ item: 'sofa', count: 2 }],
  unseenAreas: [],
}

describe('conversation session persistence and migration', () => {
  it('preserves v5 domain fields and session identity without inventing confirmations or submissions', () => {
    const store = new Store()
    const old = {
      ...newSession(),
      step: 'schedule',
      messages: [{ id: 'old-message', role: 'assistant', content: 'Welcome' }],
      moveDetails: SAMPLE_MOVE_DETAILS,
      chatFinished: true,
      photoUrls: ['https://example.test/room.jpg'],
      photoRefs: [{ url: 'https://example.test/room.jpg', receipt: 'private-receipt' }],
      analysis,
      failedPhotoAssessments: [{ url: 'https://example.test/room.jpg', status: 'unavailable', reason: 'Unavailable.' }],
      photoDecisions: {},
      photoDecisionsLocked: true,
      items: [{ type: 'sofa', count: 1 }],
      followUps: { garage: true, closets: false, appliances: false },
      wholeMoveCovered: true,
      price: { currency: 'USD', total: 100, low: 90, high: 110, breakdown: { labor: 100 } },
      estimateId: 'existing-lead',
      contact: { name: 'Synthetic', email: 'synthetic@example.test', phone: '5550100', requestedDate: '2027-01-01' },
      sample: false,
    }
    store.setItem(SESSION_KEY, JSON.stringify(old))
    const loaded = loadConversationSession(store)
    expect(loaded).toMatchObject({
      ...old,
      version: 6,
      detailsConfirmed: false,
      scheduleResult: null,
      quoteResult: null,
      suggestedFocus: 'schedule',
    })
    expect(loaded.timeline.filter((entry) => entry.kind === 'message')).toHaveLength(1)
    expect(loaded.timeline.filter((entry) => entry.kind === 'event' && entry.event === 'migration')).toHaveLength(1)
    expect(loaded.pendingProposals).toEqual([])
    expect(loaded.operations).toEqual({})
    expect(conversationReadiness(loaded).canPrice).toBe(false)
    saveConversationSession(loaded, store)
    expect(loadConversationSession(store)).toEqual(loaded)
  })

  it.each([1, 10001])('preserves valid v5 custom inventory beyond new-command limits, count %s', (count) => {
    const store = new Store()
    const longLabel = `Custom inventory ${'x'.repeat(201)}`
    const old = {
      ...newSession(),
      moveDetails: SAMPLE_MOVE_DETAILS,
      photoUrls: ['https://example.test/room.jpg'],
      photoRefs: [{ url: 'https://example.test/room.jpg', receipt: 'private-receipt' }],
      analysis: { ...analysis, possibleDuplicates: [{ item: longLabel, count }] },
      items: [{ type: longLabel, count }],
    }
    const raw = JSON.stringify(old)
    store.value = raw
    const loaded = loadConversationSession(store)
    expect(loaded.sessionId).toBe(old.sessionId)
    expect(loaded.moveDetails).toEqual(SAMPLE_MOVE_DETAILS)
    expect(loaded.photoRefs).toEqual(old.photoRefs)
    expect(loaded.items).toEqual([{ type: longLabel, count }])
    expect(loaded.detailsConfirmed).toBe(false)
    expect(store.value).toBe(raw)
    const snapshot = conversationSnapshot(loaded)
    expect(zConversationSnapshot.safeParse(snapshot).success).toBe(true)
    expect(snapshot.inventory).toEqual([{ type: longLabel, count }])
    expect(snapshot.review.pendingDuplicates).toEqual([{ item: longLabel, count }])
    saveConversationSession(loaded, store)
    expect(loadConversationSession(store)).toEqual(loaded)
    const proposal = { id: 'new-item', expectedRevision: loaded.revision }
    expect(
      zConversationProposal.safeParse({
        ...proposal,
        command: { type: 'item.add', item: { type: longLabel, count: 1 } },
      }).success,
    ).toBe(false)
    expect(
      zConversationProposal.safeParse({
        ...proposal,
        command: { type: 'item.add', item: { type: 'sofa', count: 10001 } },
      }).success,
    ).toBe(false)
  })

  it.each([3, 4])('reuses v%s migration, retains a valid ID and requires own-photo reupload', (version) => {
    const store = new Store()
    const old = {
      ...newSession(),
      version,
      step: 'estimate',
      moveDetails: SAMPLE_MOVE_DETAILS,
      photoUrls: ['https://example.test/old.jpg'],
      analysis,
      sample: false,
    }
    store.value = JSON.stringify(old)
    const loaded = loadConversationSession(store)
    expect(loaded).toMatchObject({
      version: 6,
      sessionId: old.sessionId,
      photoUrls: old.photoUrls,
      photoRefs: [],
      needsPhotoReupload: true,
      analysis: null,
      items: [],
      price: null,
      detailsConfirmed: false,
    })
    expect(loaded.photos).toEqual([{ id: 'photo-1', url: 'https://example.test/old.jpg', receipt: null }])
    expect(conversationReadiness(loaded).canAnalyze).toBe(false)
    const removed = reduceConversation(loaded, {
      id: 'remove',
      source: 'inline',
      expectedRevision: loaded.revision,
      type: 'photo.remove',
      photoId: 'photo-1',
    })
    expect(removed.needsPhotoReupload).toBe(false)
  })

  it('replaces an invalid legacy session ID without discarding otherwise valid move details', () => {
    const store = new Store()
    store.value = JSON.stringify({ ...newSession(), sessionId: 'invalid', moveDetails: SAMPLE_MOVE_DETAILS })
    const loaded = loadConversationSession(store)
    expect(loaded.sessionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(loaded.moveDetails).toEqual(SAMPLE_MOVE_DETAILS)
  })

  it('uses the exact sample allowlist rather than granting receipt exemptions to lookalikes', () => {
    const store = new Store()
    store.value = JSON.stringify({
      ...newSession(),
      version: 4,
      sample: true,
      photoUrls: [`${window.location.origin}/sample/living-room.jpg`],
    })
    expect(loadConversationSession(store)).toMatchObject({ sample: true, needsPhotoReupload: false })
    store.value = JSON.stringify({
      ...newSession(),
      version: 4,
      sample: true,
      photoUrls: [`${window.location.origin}/sample/lookalike.jpg`],
    })
    expect(loadConversationSession(store)).toMatchObject({ sample: false, needsPhotoReupload: true })
  })

  it('recognizes v6 before the legacy loader and durably preserves duplicate answers and action IDs', () => {
    const store = new Store()
    let state = createConversationSession()
    state = {
      ...state,
      analysis,
      items: [{ type: 'sofa', count: 1 }],
      duplicateResolutions: { sofa: 'same' },
      followUps: { garage: false, closets: true, appliances: false },
      detailsConfirmed: true,
      appliedActionIds: ['already-applied'],
    }
    saveConversationSession(state, store)
    const loaded = loadConversationSession(store)
    expect(loaded).toEqual(state)
    expect(JSON.parse(store.value ?? 'null').version).toBe(6)
    expect(
      reduceConversation(loaded, {
        id: 'already-applied',
        source: 'panel',
        expectedRevision: 0,
        type: 'details.patch',
        patch: { from: 'Elsewhere' },
      }),
    ).toBe(loaded)
  })

  it('turns pending operations into interrupted/unknown outcomes and clears freshness on reload, never resubmits', () => {
    const store = new Store()
    const state = {
      ...createConversationSession(),
      verifiedVisionFingerprint: 'vision-one',
      operations: {
        pending: { id: 'pending', revision: 0, status: 'pending' as const, request: { kind: 'save' as const } },
      },
    }
    saveConversationSession(state, store)
    const loaded = loadConversationSession(store)
    expect(loaded.operations.pending.status).toBe('interrupted')
    expect(loaded.verifiedVisionFingerprint).toBeNull()
    expect(
      reduceConversation(loaded, {
        id: 'late-result',
        source: 'system',
        expectedRevision: 0,
        type: 'operation.succeeded',
        operationId: 'pending',
        result: { kind: 'save', estimateId: 'possibly-saved' },
      }),
    ).toBe(loaded)
  })

  it('rejects malformed v6 state instead of trusting nested data or downgrading through legacy loading', () => {
    const store = new Store()
    store.value = JSON.stringify({
      ...createConversationSession(),
      revision: 'invalid',
      items: [{ type: 'sofa', count: -1 }],
    })
    expect(loadConversationSession(store).items).toEqual([])
    expect(store.value).toBeNull()
    store.value = '{bad-json'
    expect(loadConversationSession(store).version).toBe(6)
    expect(store.value).toBeNull()
  })

  it('handles denied storage access, unavailable storage and quota without losing in-memory work', () => {
    const unavailable = {
      getItem() {
        throw new Error('denied')
      },
      setItem() {
        throw new Error('quota')
      },
      removeItem() {
        throw new Error('denied')
      },
    }
    expect(loadConversationSession(unavailable).version).toBe(6)
    expect(loadConversationSession(null).version).toBe(6)
    expect(() => saveConversationSession(createConversationSession(), unavailable)).not.toThrow()
  })
})
