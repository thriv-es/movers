import { describe, expect, it } from 'vitest'
import type { AnalysisResult } from '../src/data'
import { zConversationProposal, zConversationSnapshot } from '../src/data/z-common/z-conversation'
import {
  type ConversationAction,
  type ConversationSession,
  conversationReadiness,
  conversationSnapshot,
  createConversationSession,
  reduceConversation,
  zConversationAction,
  zConversationSession,
} from '../src/lib/conversation-state'
import { SAMPLE_MOVE_DETAILS } from '../src/lib/estimate-session'

type Payload = ConversationAction extends infer A
  ? A extends ConversationAction
    ? Omit<A, 'id' | 'source' | 'expectedRevision'>
    : never
  : never
let sequence = 0
function send(state: ConversationSession, payload: Payload, source: ConversationAction['source'] = 'panel') {
  return reduceConversation(state, {
    ...payload,
    id: `action-${++sequence}`,
    source,
    expectedRevision: state.revision,
  } as ConversationAction)
}
const analysis: AnalysisResult = {
  visionRevision: 1,
  visionFingerprint: 'vision-one',
  items: [{ type: 'couch', count: 2 }],
  totalVolumeCubicFeet: 160,
  estimatedBoxes: { min: 2, max: 4 },
  boxesExplanation: '',
  specialHandling: [],
  possibleDuplicates: [{ item: 'sofa', count: 2 }],
  unseenAreas: [],
  photoAssessments: [{ url: 'https://example.test/room.jpg', status: 'relevant', reason: 'Furniture.' }],
}
function analyzed(value = analysis) {
  let state = createConversationSession()
  state = send(state, { type: 'details.patch', patch: SAMPLE_MOVE_DETAILS })
  state = send(state, { type: 'details.confirm' })
  state = send(state, {
    type: 'photo.add',
    photo: { id: 'photo-one', url: 'https://example.test/room.jpg', receipt: 'private-receipt' },
  })
  state = send(
    state,
    { type: 'operation.started', operationId: 'analysis-one', request: { kind: 'analyze' } },
    'system',
  )
  return send(
    state,
    { type: 'operation.succeeded', operationId: 'analysis-one', result: { kind: 'analyze', analysis: value } },
    'system',
  )
}
function ready() {
  let state = analyzed()
  state = send(state, { type: 'duplicate.resolve', itemType: 'couch', resolution: 'different' })
  for (const key of ['garage', 'closets', 'appliances'] as const)
    state = send(state, { type: 'followUp.answer', key, answer: false })
  state = send(state, { type: 'coverage.answer', answer: true })
  return send(state, { type: 'vision.verified', fingerprint: 'vision-one' }, 'system')
}
const price = { currency: 'USD', total: 100, low: 90, high: 110, breakdown: { labor: 100 } }

describe('revisioned conversation controller', () => {
  it('creates independent runtime-validated v6 sessions', () => {
    const first = createConversationSession()
    const second = createConversationSession()
    expect(first.version).toBe(6)
    expect(first.sessionId).not.toBe(second.sessionId)
    first.timeline.push({ kind: 'event', id: 'local', revision: 0, event: 'migration', area: 'details' })
    expect(second.timeline).toEqual([])
    expect(zConversationSession.safeParse(second).success).toBe(true)
    expect(zConversationSession.safeParse({ ...second, revision: -1 }).success).toBe(false)
    expect(zConversationSession.safeParse({ ...second, revision: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false)
    expect(zConversationSession.safeParse({ ...second, items: [{ type: 'sofa', count: 0 }] }).success).toBe(false)
  })

  it('rejects stale revisions, replayed IDs and malformed actions without mutation', () => {
    const state = createConversationSession()
    const action: ConversationAction = {
      id: 'edit-one',
      source: 'panel',
      expectedRevision: 0,
      type: 'details.patch',
      patch: { from: 'Boston' },
    }
    const next = reduceConversation(state, action)
    expect(next.revision).toBe(1)
    expect(reduceConversation(next, { ...action, id: 'stale' })).toBe(next)
    expect(reduceConversation(next, { ...action, expectedRevision: 1 })).toBe(next)
    for (const invalid of [
      { ...action, patch: { originFloor: 0 } },
      { ...action, patch: { distanceMiles: Number.POSITIVE_INFINITY } },
      { ...action, patch: { unknown: true } },
      { ...action, patch: { from: undefined } },
      { ...action, patch: {} },
      { ...action, type: 'item.count', itemType: 'sofa', count: -1 },
      { ...action, expectedRevision: 0.5 },
    ]) {
      expect(zConversationAction.safeParse(invalid).success).toBe(false)
      expect(reduceConversation(state, invalid as ConversationAction)).toBe(state)
    }
  })

  it('clears explicit null details and all dependent evidence while preserving prose', () => {
    let state = ready()
    state = send(
      state,
      { type: 'message.append', message: { id: 'hello', role: 'user', content: 'Keep chatting' } },
      'chat',
    )
    const changed = send(state, { type: 'details.patch', patch: { from: null } })
    expect(changed.moveDetails.from).toBeNull()
    expect(changed).toMatchObject({
      detailsConfirmed: false,
      analysis: null,
      items: [],
      duplicateResolutions: {},
      price: null,
      estimateId: null,
      contact: null,
      followUps: { garage: null, closets: null, appliances: null },
      wholeMoveCovered: null,
    })
    expect(changed.messages).toEqual([{ id: 'hello', role: 'user', content: 'Keep chatting' }])
    expect(conversationReadiness(changed).canAnalyze).toBe(false)
  })

  it('invalidates analysis when a photo is added or removed and rejects missing references', () => {
    const state = ready()
    expect(send(state, { type: 'photo.remove', photoId: 'missing' })).toBe(state)
    const removed = send(state, { type: 'photo.remove', photoId: 'photo-one' })
    expect(removed).toMatchObject({ analysis: null, items: [], photoUrls: [], photoRefs: [] })
    const added = send(state, {
      type: 'photo.add',
      photo: { id: 'photo-two', url: 'https://example.test/second.jpg', receipt: 'second-receipt' },
    })
    expect(added.analysis).toBeNull()
    expect(added.detailsConfirmed).toBe(true)
    expect(send(state, { type: 'photo.add', photo: state.photos[0] })).toBe(state)
  })

  it('keeps prose and structured events independent without invalidating pending work', () => {
    let state = ready()
    state = send(
      state,
      {
        type: 'operation.started',
        operationId: 'price-one',
        request: { kind: 'price', visionFingerprint: 'vision-one' },
      },
      'system',
    )
    const revision = state.revision
    state = send(
      state,
      { type: 'message.append', message: { id: 'message-one', role: 'assistant', content: 'Checking.' } },
      'chat',
    )
    expect(state.revision).toBe(revision)
    expect(state.analysis).not.toBeNull()
    expect(state.timeline.at(-1)?.kind).toBe('message')
    expect(state.timeline.some((entry) => entry.kind === 'event' && entry.event === 'operation.started')).toBe(true)
    state = send(
      state,
      { type: 'operation.succeeded', operationId: 'price-one', result: { kind: 'price', price } },
      'system',
    )
    expect(state.price).toEqual(price)
  })

  it('rejects superseded, unknown, wrong-kind and duplicate operation results', () => {
    let state = ready()
    state = send(
      state,
      {
        type: 'operation.started',
        operationId: 'price-one',
        request: { kind: 'price', visionFingerprint: 'vision-one' },
      },
      'system',
    )
    expect(
      send(
        state,
        {
          type: 'operation.started',
          operationId: 'price-two',
          request: { kind: 'price', visionFingerprint: 'vision-one' },
        },
        'system',
      ),
    ).toBe(state)
    expect(
      send(state, { type: 'operation.succeeded', operationId: 'unknown', result: { kind: 'price', price } }, 'system'),
    ).toBe(state)
    expect(
      send(
        state,
        { type: 'operation.succeeded', operationId: 'price-one', result: { kind: 'save', estimateId: 'lead' } },
        'system',
      ),
    ).toBe(state)
    const staleRevision = state.revision
    const edited = send(state, { type: 'item.count', itemType: 'sofa', count: 3 })
    expect(edited.operations['price-one'].status).toBe('superseded')
    expect(
      reduceConversation(edited, {
        id: 'late',
        source: 'system',
        expectedRevision: staleRevision,
        type: 'operation.succeeded',
        operationId: 'price-one',
        result: { kind: 'price', price },
      }),
    ).toBe(edited)
    expect(
      send(
        edited,
        { type: 'operation.succeeded', operationId: 'price-one', result: { kind: 'price', price } },
        'system',
      ),
    ).toBe(edited)
    const completed = send(
      state,
      { type: 'operation.succeeded', operationId: 'price-one', result: { kind: 'price', price } },
      'system',
    )
    expect(
      send(
        completed,
        { type: 'operation.succeeded', operationId: 'price-one', result: { kind: 'price', price } },
        'system',
      ),
    ).toBe(completed)
  })

  it('gates analysis on explicit confirmation and receipt-backed photos', () => {
    let state = createConversationSession()
    state = send(state, { type: 'details.patch', patch: SAMPLE_MOVE_DETAILS })
    expect(conversationReadiness(state).canAnalyze).toBe(false)
    state = send(state, { type: 'details.confirm' })
    expect(
      send(state, { type: 'operation.started', operationId: 'no-photos', request: { kind: 'analyze' } }, 'system'),
    ).toBe(state)
    state = send(state, {
      type: 'photo.add',
      photo: { id: 'legacy', url: 'https://example.test/old.jpg', receipt: null },
    })
    expect(conversationReadiness(state).canAnalyze).toBe(false)
  })

  it('never mixes own uploads into sample mode or grants receipt exemptions to sample lookalikes', () => {
    const state = { ...createConversationSession(), sample: true }
    expect(
      send(state, {
        type: 'photo.add',
        photo: { id: 'own-photo', url: 'https://example.test/own.jpg', receipt: 'own-receipt' },
      }),
    ).toBe(state)
    const sample = send(state, {
      type: 'photo.add',
      photo: { id: 'sample-photo', url: `${window.location.origin}/sample/living-room.jpg`, receipt: null },
    })
    expect(sample.photos).toHaveLength(1)
    expect(sample.needsPhotoReupload).toBe(false)
    expect(
      send(state, {
        type: 'photo.add',
        photo: { id: 'lookalike', url: `${window.location.origin}/sample/lookalike.jpg`, receipt: null },
      }),
    ).toBe(state)
  })

  it('requires current fingerprint, review answers, resolved duplicates and nonempty accepted inventory', () => {
    expect(conversationReadiness(analyzed()).canPrice).toBe(false)
    const state = ready()
    expect(conversationReadiness(state).canPrice).toBe(true)
    const empty = send(state, { type: 'item.remove', itemType: 'couch' })
    expect(conversationReadiness(empty).canPrice).toBe(false)
    expect(
      send(
        empty,
        {
          type: 'operation.started',
          operationId: 'empty-price',
          request: { kind: 'price', visionFingerprint: 'vision-one' },
        },
        'system',
      ),
    ).toBe(empty)
    expect(send(state, { type: 'vision.verified', fingerprint: 'wrong' }, 'system')).toBe(state)
    expect(conversationReadiness({ ...state, verifiedVisionFingerprint: null }).canPrice).toBe(false)
  })

  it('adds uncertain candidates only after Keep and never twice, retaining volume/box helper rules', () => {
    let state = analyzed({
      ...analysis,
      items: [],
      totalVolumeCubicFeet: 0,
      possibleDuplicates: [],
      estimatedBoxes: { min: 0, max: 0 },
      photoAssessments: [
        {
          url: 'https://example.test/room.jpg',
          status: 'uncertain',
          reason: 'Check',
          candidates: {
            items: [{ type: 'couch', count: 1 }],
            total_volume_cubic_feet: 80,
            estimated_boxes_min: 2,
            estimated_boxes_max: 3,
          },
        },
      ],
    })
    expect(conversationReadiness(state).unresolvedPhotos).toBe(1)
    expect(send(state, { type: 'item.add', item: { type: 'piano', count: 1 } })).toBe(state)
    state = send(state, { type: 'photo.decide', photoId: 'photo-one', decision: 'keep' })
    state = send(state, { type: 'photo.decide', photoId: 'photo-one', decision: 'keep' })
    expect(state.items).toEqual([{ type: 'sofa', count: 1 }])
    state = send(state, { type: 'item.count', itemType: 'couch', count: 2 })
    expect(send(state, { type: 'photo.decide', photoId: 'photo-one', decision: 'exclude' })).toBe(state)
    const snapshot = conversationSnapshot(state)
    expect(snapshot.inventory).toEqual([{ type: 'sofa', count: 2 }])
    expect(snapshot.analysis).toMatchObject({ totalVolumeCubicFeet: 80, estimatedBoxes: { min: 2, max: 3 } })
  })

  it('canonicalizes inventory, persists duplicate resolution and makes follow-up answers idempotent', () => {
    let state = analyzed()
    state = send(state, { type: 'duplicate.resolve', itemType: 'couch', resolution: 'same' })
    expect(state.items).toEqual([{ type: 'sofa', count: 1 }])
    expect(state.duplicateResolutions).toEqual({ sofa: 'same' })
    expect(send(state, { type: 'duplicate.resolve', itemType: 'missing', resolution: 'same' })).toBe(state)
    state = send(state, { type: 'followUp.answer', key: 'closets', answer: true })
    state = send(state, { type: 'followUp.answer', key: 'closets', answer: true })
    expect(state.items).toContainEqual({ type: 'boxes (full closets)', count: 4 })
    state = send(state, { type: 'followUp.answer', key: 'closets', answer: false })
    expect(state.items).toEqual([{ type: 'sofa', count: 1 }])
    expect(send(state, { type: 'item.count', itemType: 'missing', count: 1 })).toBe(state)
  })

  it('validates proposals and applies only current recognized user-accepted commands', () => {
    let state = ready()
    const proposal = {
      id: 'proposal-one',
      expectedRevision: state.revision,
      command: { type: 'item.remove' as const, itemType: 'sofa' },
    }
    expect(zConversationProposal.safeParse(proposal).success).toBe(true)
    expect(
      zConversationProposal.safeParse({ ...proposal, command: { type: 'operation.succeeded', price } }).success,
    ).toBe(false)
    expect(send(state, { type: 'item.remove', itemType: 'sofa' }, 'agent')).toBe(state)
    expect(
      send(
        state,
        { type: 'operation.started', operationId: 'fake', request: { kind: 'price', visionFingerprint: 'vision-one' } },
        'agent',
      ),
    ).toBe(state)
    state = send(state, { type: 'proposal.add', proposal }, 'agent')
    expect(state.items).toHaveLength(1)
    expect(send(state, { type: 'proposal.apply', proposalId: 'missing' })).toBe(state)
    state = send(state, { type: 'proposal.apply', proposalId: 'proposal-one' }, 'inline')
    expect(state.items).toEqual([])
    expect(state.pendingProposals).toEqual([])
    expect(send(state, { type: 'proposal.add', proposal }, 'agent')).toBe(state)
  })

  it('keeps request hints side-effect free and only accepts validated successful API results', () => {
    let state = ready()
    const hinted = send(state, { type: 'request.action', action: 'price' })
    expect(hinted.operations).toEqual(state.operations)
    expect(hinted.price).toBeNull()
    expect(hinted.revision).toBe(state.revision)
    state = send(
      state,
      { type: 'operation.started', operationId: 'price', request: { kind: 'price', visionFingerprint: 'vision-one' } },
      'system',
    )
    state = send(
      state,
      { type: 'operation.succeeded', operationId: 'price', result: { kind: 'price', price } },
      'system',
    )
    expect(conversationReadiness(state).canSave).toBe(true)
    state = send(state, { type: 'operation.started', operationId: 'save', request: { kind: 'save' } }, 'system')
    state = send(
      state,
      { type: 'operation.succeeded', operationId: 'save', result: { kind: 'save', estimateId: 'lead-one' } },
      'system',
    )
    const contact = {
      name: 'Synthetic Person',
      email: 'test@example.test',
      phone: '5550100',
      requestedDate: '2027-01-01',
    }
    state = send(
      state,
      { type: 'operation.started', operationId: 'schedule', request: { kind: 'schedule', contact } },
      'system',
    )
    state = send(
      state,
      {
        type: 'operation.succeeded',
        operationId: 'schedule',
        result: { kind: 'schedule', reference: 'lead-one', requestedDate: '2027-01-01' },
      },
      'system',
    )
    expect(state.contact).toEqual(contact)
    expect(state.scheduleResult).toEqual({ reference: 'lead-one', requestedDate: '2027-01-01', status: 'requested' })
    const edited = send(state, { type: 'item.add', item: { type: 'couch', count: 1 } })
    expect(edited).toMatchObject({
      price: null,
      estimateId: null,
      contact: null,
      scheduleResult: null,
      quoteResult: null,
    })
  })

  it('rejects nonfinite analysis and price values before accepting or persisting results', () => {
    const state = ready()
    expect(
      zConversationSession.safeParse({
        ...state,
        analysis: { ...analysis, totalVolumeCubicFeet: Number.POSITIVE_INFINITY },
      }).success,
    ).toBe(false)
    expect(
      zConversationAction.safeParse({
        id: 'bad-price',
        source: 'system',
        expectedRevision: state.revision,
        type: 'operation.succeeded',
        operationId: 'price',
        result: { kind: 'price', price: { ...price, total: Number.POSITIVE_INFINITY, high: Number.POSITIVE_INFINITY } },
      }).success,
    ).toBe(false)
  })

  it('keeps new item additions within command limits even though legacy storage accepts larger counts', () => {
    const state = { ...ready(), items: [{ type: 'sofa', count: 10000 }] }
    expect(send(state, { type: 'item.add', item: { type: 'couch', count: 1 } })).toBe(state)
  })

  it('invalidates prior analysis, review and dependent results when explicit reanalysis starts', () => {
    const state = {
      ...ready(),
      price,
      estimateId: 'old-lead',
      contact: { name: 'Synthetic', email: 'synthetic@example.test', phone: '5550100', requestedDate: '2027-01-01' },
      scheduleResult: { reference: 'old-lead', requestedDate: '2027-01-01', status: 'requested' as const },
      quoteResult: { requests: [] },
    }
    expect(conversationReadiness(state).canPrice).toBe(true)
    const started = send(
      state,
      { type: 'operation.started', operationId: 'reanalysis', request: { kind: 'analyze' } },
      'system',
    )
    expect(started).toMatchObject({
      analysis: null,
      items: [],
      photoDecisions: {},
      photoDecisionsLocked: false,
      duplicateResolutions: {},
      followUps: { garage: null, closets: null, appliances: null },
      wholeMoveCovered: null,
      verifiedVisionFingerprint: null,
      price: null,
      estimateId: null,
      contact: null,
      scheduleResult: null,
      quoteResult: null,
    })
    expect(started.revision).toBe(state.revision + 1)
    expect(started.operations.reanalysis).toMatchObject({ status: 'pending', revision: started.revision })
    expect(started.moveDetails).toEqual(state.moveDetails)
    expect(started.photos).toEqual(state.photos)
    expect(started.detailsConfirmed).toBe(true)
  })

  it.each(['photo_link_failed', 'request_failed', 'reanalyze_required'] as const)(
    'does not restore old pricing eligibility after reanalysis fails with %s',
    (errorCode) => {
      let state = ready()
      expect(conversationReadiness(state).canPrice).toBe(true)
      state = send(
        state,
        { type: 'operation.started', operationId: 'reanalysis', request: { kind: 'analyze' } },
        'system',
      )
      const assessments = [
        { url: 'https://example.test/room.jpg', status: 'unavailable' as const, reason: 'Sanitized failure evidence.' },
      ]
      state = send(
        state,
        {
          type: 'operation.failed',
          operationId: 'reanalysis',
          errorCode,
          ...(errorCode === 'photo_link_failed' ? { photoAssessments: assessments } : {}),
        },
        'system',
      )
      expect(state.operations.reanalysis.status).toBe('failed')
      expect(conversationReadiness(state).canPrice).toBe(false)
      expect(conversationReadiness(state).canSave).toBe(false)
      expect(state.analysis).toBeNull()
      expect(state.items).toEqual([])
      expect(state.verifiedVisionFingerprint).toBeNull()
      if (errorCode === 'photo_link_failed') expect(state.failedPhotoAssessments).toEqual(assessments)
      expect(send(state, { type: 'vision.verified', fingerprint: 'vision-one' }, 'system')).toBe(state)
      expect(
        send(
          state,
          {
            type: 'operation.started',
            operationId: 'old-evidence-price',
            request: { kind: 'price', visionFingerprint: 'vision-one' },
          },
          'system',
        ),
      ).toBe(state)
      state = send(
        state,
        { type: 'operation.started', operationId: 'fresh-analysis', request: { kind: 'analyze' } },
        'system',
      )
      state = send(
        state,
        { type: 'operation.succeeded', operationId: 'fresh-analysis', result: { kind: 'analyze', analysis } },
        'system',
      )
      expect(state.analysis).toEqual(analysis)
      expect(conversationReadiness(state).canPrice).toBe(false)
      state = send(state, { type: 'duplicate.resolve', itemType: 'sofa', resolution: 'different' })
      for (const key of ['garage', 'closets', 'appliances'] as const)
        state = send(state, { type: 'followUp.answer', key, answer: false })
      state = send(state, { type: 'coverage.answer', answer: true })
      state = send(state, { type: 'vision.verified', fingerprint: 'vision-one' }, 'system')
      expect(conversationReadiness(state).canPrice).toBe(true)
    },
  )

  it('retains relevant failure statuses without exposing reasons and permits an explicit retry with a new ID', () => {
    let state = analyzed()
    state = send(
      state,
      { type: 'operation.started', operationId: 'retry-analysis', request: { kind: 'analyze' } },
      'system',
    )
    const assessments = [
      { url: 'https://example.test/room.jpg', status: 'unavailable' as const, reason: 'Sanitized failure evidence.' },
    ]
    expect(
      send(
        state,
        {
          type: 'operation.failed',
          operationId: 'retry-analysis',
          errorCode: 'photo_link_failed',
          photoAssessments: [{ ...assessments[0], url: 'https://example.test/not-selected.jpg' }],
        },
        'system',
      ),
    ).toBe(state)
    const revision = state.revision
    state = send(
      state,
      {
        type: 'operation.failed',
        operationId: 'retry-analysis',
        errorCode: 'photo_link_failed',
        photoAssessments: assessments,
      },
      'system',
    )
    expect(state.revision).toBe(revision)
    expect(state.failedPhotoAssessments).toEqual(assessments)
    expect(state.operations['retry-analysis'].status).toBe('failed')
    // Fresh failure evidence takes precedence over an older successful verdict.
    expect(conversationSnapshot(state).photos[0].status).toBe('unavailable')
    expect(JSON.stringify(conversationSnapshot(state))).not.toContain('Sanitized failure evidence.')
    expect(
      send(state, { type: 'operation.started', operationId: 'retry-analysis', request: { kind: 'analyze' } }, 'system'),
    ).toBe(state)
    state = send(
      state,
      { type: 'operation.started', operationId: 'retry-again', request: { kind: 'analyze' } },
      'system',
    )
    expect(state.operations['retry-again'].status).toBe('pending')
  })

  it('validates quote recipients against the explicitly started request and persists only actual results', () => {
    let state = {
      ...ready(),
      price,
      estimateId: 'lead-one',
      contact: { name: 'Synthetic', email: 'synthetic@example.test', phone: '5550100', requestedDate: '2027-01-01' },
    }
    state = send(
      state,
      {
        type: 'operation.started',
        operationId: 'quotes',
        request: { kind: 'quotes', moverIds: ['mover-one'], note: 'Synthetic note' },
      },
      'system',
    ) as typeof state
    const request = {
      id: 'quote-one',
      estimateId: 'lead-one',
      moverId: 'mover-one',
      moverName: 'Synthetic Mover',
      note: 'Synthetic note',
      status: 'logged' as const,
      createdAt: '2026-11-16',
    }
    expect(
      send(
        state,
        {
          type: 'operation.succeeded',
          operationId: 'quotes',
          result: { kind: 'quotes', requests: [{ ...request, moverId: 'not-confirmed' }] },
        },
        'system',
      ),
    ).toBe(state)
    const completed = send(
      state,
      { type: 'operation.succeeded', operationId: 'quotes', result: { kind: 'quotes', requests: [request] } },
      'system',
    )
    expect(completed.quoteResult).toEqual({ requests: [request] })
    expect(conversationSnapshot(completed).status.quoteRequestCount).toBe(1)
    expect(JSON.stringify(conversationSnapshot(completed))).not.toContain('Synthetic note')
  })

  it('keeps agent snapshots free of receipts, URLs, contact, prose and raw assessment reasons', () => {
    const state = {
      ...ready(),
      contact: { name: 'Private Name', email: 'private@example.test', phone: '5559999', requestedDate: '2027-01-01' },
    }
    const snapshot = conversationSnapshot(state)
    expect(zConversationSnapshot.safeParse(snapshot).success).toBe(true)
    expect(snapshot.photos).toEqual([{ id: 'photo-one', status: 'relevant', decision: null }])
    for (const secret of [
      'private-receipt',
      'https://',
      'Private Name',
      'private@example.test',
      '5559999',
      'Furniture.',
    ])
      expect(JSON.stringify(snapshot)).not.toContain(secret)
    expect(snapshot).not.toHaveProperty('photoRefs')
    expect(snapshot).not.toHaveProperty('messages')
    expect(snapshot).not.toHaveProperty('contact')
  })
})
