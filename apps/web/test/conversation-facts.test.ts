// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  conversationReadiness,
  conversationSnapshot,
  createConversationSession,
  reduceConversation,
  zConversationSession,
} from '../src/lib/conversation-state'
import { loadConversationSession } from '../src/lib/conversation-session'
import { zConversationReadiness } from '../src/data/z-common/z-conversation'
import { zAnalyzeRequest } from '../src/data/z-common/z-move-demo'

const evidence = {
  field: 'from',
  sourceMessageId: 'user-one',
  wording: 'Dizengoff 100, Tel Aviv',
  uncertainty: 'certain',
  precision: 'address',
  correction: false,
} as const
function context() {
  const state = createConversationSession()
  state.moveDetails.from = 'Dizengoff 100, Tel Aviv'
  state.moveDetails.to = 'Bezalel 2, Raanana'
  return state
}
describe('photo context and revisioned facts', () => {
  it('preserves volunteered ground floor through the actual analysis request schema', () => {
    const state = context()
    state.moveDetails.originFloor = 0
    expect(
      zAnalyzeRequest.safeParse({
        sessionId: state.sessionId,
        moveDetails: state.moveDetails,
        photoRefs: [{ url: 'https://example.test/photo', receipt: 'private-receipt' }],
      }).success,
    ).toBe(true)
  })
  it('requests photos before distance/date/access or confirmation are available', () => {
    expect(conversationReadiness(context())).toMatchObject({ canRequestPhotos: true, canPrice: false })
    const state = context()
    state.moveDetails.from = '  '
    expect(conversationReadiness(state)).toMatchObject({ canRequestPhotos: false, canAnalyze: false })
    const { canRequestPhotos: _, ...old } = conversationReadiness(context())
    expect(zConversationReadiness.parse(old).canRequestPhotos).toBe(false)
  })
  it('allows explicit analysis with linked photos and context, not price-complete details', () => {
    const state = context()
    state.photos = [{ id: 'photo-one', url: 'https://example.test/image', receipt: 'private-receipt' }]
    state.photoUrls = state.photos.map((p) => p.url)
    state.photoRefs = state.photos.map(({ url, receipt }) => ({ url, receipt }))
    expect(conversationReadiness(state)).toMatchObject({ canAnalyze: true, canPrice: false })
    const next = reduceConversation(state, {
      id: 'analyze',
      source: 'system',
      expectedRevision: 0,
      type: 'operation.started',
      operationId: 'op',
      request: { kind: 'analyze' },
    })
    expect(next.operations.op.status).toBe('pending')
  })
  it('migrates valid old v6 sessions without losing the complete transcript', () => {
    const old = context() as unknown as Record<string, unknown>
    old.facts = undefined
    old.route = undefined
    old.nextAction = undefined
    old.messages = Array.from({ length: 230 }, (_, n) => ({ id: `m-${n}`, role: 'user', content: `message ${n}` }))
    const restored = loadConversationSession({
      getItem: () => JSON.stringify(old),
      setItem() {},
      removeItem() {
        throw new Error('must not discard')
      },
    })
    expect(restored.messages).toHaveLength(230)
    expect(restored.facts).toEqual([])
    expect(restored.route).toBeNull()
  })
  it('applies provenance atomically and invalidates route/distance after either endpoint changes', () => {
    const state = context()
    state.messages = [{ id: 'user-one', role: 'user', content: 'Dizengoff 100, Tel Aviv' }]
    const next = reduceConversation(state, {
      id: 'patch',
      source: 'chat',
      expectedRevision: 0,
      type: 'details.patch',
      patch: { from: state.moveDetails.from },
      facts: [evidence],
    })
    expect(next.facts).toEqual([evidence])
    expect(conversationSnapshot(next)).not.toHaveProperty('facts')
    const routed = zConversationSession.parse({
      ...next,
      moveDetails: { ...next.moveDetails, distanceMiles: 10 },
      route: {
        status: 'ready',
        from: next.moveDetails.from,
        to: next.moveDetails.to,
        distanceMiles: 10,
        precision: 'address',
        attribution: 'Powered by Geoapify',
        endpointRevision: next.revision,
      },
    })
    for (const side of ['from', 'to'] as const) {
      const changed = reduceConversation(routed, {
        id: `change-${side}`,
        source: 'panel',
        expectedRevision: routed.revision,
        type: 'details.patch',
        patch: { [side]: 'Haifa' },
      })
      expect(changed.route).toBeNull()
      expect(changed.moveDetails.distanceMiles).toBeNull()
      expect(changed.detailsConfirmed).toBe(false)
    }
  })
  it('does not restore stale route endpoints and clears dependent distance provenance on correction', () => {
    const state = context()
    const route = {
      status: 'ready',
      from: 'old origin',
      to: state.moveDetails.to,
      distanceMiles: 10,
      precision: 'address',
      attribution: 'Powered by Geoapify',
      endpointRevision: 0,
    }
    expect(zConversationSession.safeParse({ ...state, route }).success).toBe(false)
    state.facts = [{ ...evidence, field: 'distanceMiles', wording: '10 miles', precision: 'exact' }]
    state.messages = [{ id: 'user-one', role: 'user', content: '10 miles' }]
    const changed = reduceConversation(state, {
      id: 'clear-distance-evidence',
      source: 'panel',
      expectedRevision: 0,
      type: 'details.patch',
      patch: { to: 'Haifa' },
    })
    expect(changed.facts).toEqual([])
  })
  it('retains a newly volunteered distance in the same explicit endpoint edit, not a stale distance', () => {
    const state = context()
    state.moveDetails.distanceMiles = 10
    const next = reduceConversation(state, {
      id: 'new-distance',
      source: 'panel',
      expectedRevision: 0,
      type: 'details.patch',
      patch: { from: 'Haifa', distanceMiles: 50 },
    })
    expect(next.moveDetails.distanceMiles).toBe(50)
  })
  it('rejects invented provenance and stale route endpoints without a partial patch', () => {
    const state = context()
    const invalid = reduceConversation(state, {
      id: 'bad',
      source: 'chat',
      expectedRevision: 0,
      type: 'details.patch',
      patch: { from: 'Haifa' },
      facts: [evidence],
    })
    expect(invalid).toBe(state)
  })
})
