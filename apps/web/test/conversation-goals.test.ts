import { describe, expect, it } from 'vitest'
import { conversationCompleteness } from '../src/lib/conversation-completeness'
import {
  createConversationSession,
  reduceConversation,
  conversationReadiness,
  type ConversationAction,
  type ConversationSession,
} from '../src/lib/conversation-state'
import { loadConversationSession, saveConversationSession } from '../src/lib/conversation-session'

let sequence = 0
function change(state: ConversationSession, input: Record<string, unknown>, source = 'panel') {
  return reduceConversation(state, {
    ...input,
    id: `goal-${++sequence}`,
    source,
    expectedRevision: state.revision,
  } as ConversationAction)
}
function goalReady(): ConversationSession {
  const state = createConversationSession()
  return {
    ...state,
    moveDetails: {
      from: '10 Main Street, Boston',
      to: '20 Oak Street, Boston',
      date: null,
      distanceMiles: 10,
      originFloor: 0,
      destinationFloor: 1,
      originElevator: null,
      destinationElevator: false,
    },
    photos: [{ id: 'photo-1', url: 'https://example.test/room.jpg', receipt: 'private' }],
    photoUrls: ['https://example.test/room.jpg'],
    photoRefs: [{ url: 'https://example.test/room.jpg', receipt: 'private' }],
    analysis: {
      visionRevision: 1,
      visionFingerprint: 'vision-one',
      items: [{ type: 'sofa', count: 2 }],
      totalVolumeCubicFeet: 160,
      estimatedBoxes: { min: 2, max: 4 },
      boxesExplanation: '',
      specialHandling: [],
      possibleDuplicates: [],
      unseenAreas: [],
      photoAssessments: [{ url: 'https://example.test/room.jpg', status: 'relevant', reason: 'Furniture' }],
    },
    items: [{ type: 'sofa', count: 2 }],
    followUps: { garage: false, closets: false, appliances: false },
    wholeMoveCovered: true,
    verifiedVisionFingerprint: 'vision-one',
  }
}
describe('goal-led domain evidence', () => {
  it.each([{ from: '30 New Street, Boston' }, { date: '2027-01-01' }, { destinationFloor: 2 }])(
    'detail corrections retain accepted analysis and review answers: %j',
    (patch) => {
      const state = goalReady()
      state.price = { currency: 'USD', total: 100, low: 90, high: 110, breakdown: {} }
      const next = change(state, { type: 'details.patch', patch })
      expect(next.analysis).toEqual(state.analysis)
      expect(next.items).toEqual(state.items)
      expect(next.followUps).toEqual(state.followUps)
      expect(next.wholeMoveCovered).toBe(true)
      expect(next.price).toBeNull()
      expect(next.detailsConfirmed).toBe(false)
    },
  )
  it('same-wording uncertainty corrections invalidate commercial evidence but retain accepted photos and transcript', () => {
    let state = goalReady()
    state = change(
      state,
      {
        type: 'message.append',
        message: {
          id: 'uncertain-origin',
          role: 'user',
          content: 'I am not sure whether 10 Main Street, Boston is the pickup',
        },
      },
      'chat',
    )
    state = {
      ...state,
      detailsConfirmed: true,
      price: { currency: 'USD', total: 100, low: 90, high: 110, breakdown: {} },
      estimateId: 'saved-before-correction',
      contact: { name: 'Synthetic', email: 'synthetic@example.test', phone: '5550100', requestedDate: '2027-01-01' },
      scheduleResult: { reference: 'saved-before-correction', requestedDate: '2027-01-01', status: 'requested' },
      quoteResult: { requests: [] },
    }
    const next = change(state, {
      type: 'details.patch',
      patch: { from: state.moveDetails.from },
      facts: [
        {
          field: 'from',
          sourceMessageId: 'uncertain-origin',
          wording: '10 Main Street, Boston',
          uncertainty: 'uncertain',
          precision: 'address',
          correction: true,
        },
      ],
    })
    expect(next.moveDetails).toEqual(state.moveDetails)
    expect(conversationCompleteness(next).ready).toBe(false)
    expect(next).toMatchObject({
      detailsConfirmed: false,
      price: null,
      estimateId: null,
      contact: null,
      scheduleResult: null,
      quoteResult: null,
    })
    expect(next.analysis).toEqual(state.analysis)
    expect(next.items).toEqual(state.items)
    expect(next.messages).toEqual(state.messages)
    expect(next.timeline.slice(0, state.timeline.length)).toEqual(state.timeline)
  })
  it('fact-only uncertainty corrections supersede in-flight price results', () => {
    let state = goalReady()
    state = change(
      state,
      {
        type: 'message.append',
        message: { id: 'uncertain-price', role: 'user', content: 'I am unsure about 10 Main Street, Boston' },
      },
      'chat',
    )
    state = change(
      state,
      {
        type: 'operation.started',
        operationId: 'pending-price',
        request: { kind: 'price', visionFingerprint: 'vision-one' },
      },
      'system',
    )
    expect(state.operations['pending-price'].status).toBe('pending')
    state = change(state, {
      type: 'details.patch',
      patch: { from: state.moveDetails.from },
      facts: [
        {
          field: 'from',
          sourceMessageId: 'uncertain-price',
          wording: '10 Main Street, Boston',
          uncertainty: 'uncertain',
          precision: 'address',
          correction: true,
        },
      ],
    })
    expect(state.operations['pending-price'].status).toBe('superseded')
    expect(
      change(
        state,
        {
          type: 'operation.succeeded',
          operationId: 'pending-price',
          result: { kind: 'price', price: { currency: 'USD', total: 100, low: 90, high: 110, breakdown: {} } },
        },
        'system',
      ),
    ).toBe(state)
  })
  it('rejects invalid dependent proposal batches without publishing any projected changes', () => {
    let state = goalReady()
    const uncertain = { id: 'photo-2', url: 'https://example.test/uncertain.jpg', receipt: 'private-2' }
    if (!state.analysis) throw new Error('Expected analyzed fixture')
    state = {
      ...state,
      photos: [...state.photos, uncertain],
      photoUrls: [...state.photoUrls, uncertain.url],
      photoRefs: [...state.photoRefs, { url: uncertain.url, receipt: uncertain.receipt }],
      analysis: {
        ...state.analysis,
        photoAssessments: [
          ...(state.analysis.photoAssessments ?? []),
          {
            url: uncertain.url,
            status: 'uncertain',
            reason: 'Check',
            candidates: { items: [{ type: 'sofa', count: 1 }], total_volume_cubic_feet: 80 },
          },
        ],
      },
    }
    const proposals = [
      {
        id: 'keep-2',
        expectedRevision: state.revision,
        command: { type: 'photo.decide', photoId: 'photo-2', decision: 'keep' },
      },
      {
        id: 'count-missing',
        expectedRevision: state.revision,
        command: { type: 'item.count', itemType: 'not-in-inventory', count: 3 },
      },
    ]
    expect(change(state, { type: 'proposal.addBatch', proposals }, 'agent')).toBe(state)
    expect(state.photoDecisions).toEqual({})
    expect(state.pendingProposals).toEqual([])
    expect(state.items).toEqual([{ type: 'sofa', count: 2 }])
  })
  it.each(['garage', 'closets', 'appliances', 'coverage'] as const)(
    'independent %s answers do not lock unresolved photo decisions or relax inventory gates',
    (key) => {
      const original = goalReady()
      if (!original.analysis) throw new Error('Expected analysis')
      const state = {
        ...original,
        analysis: {
          ...original.analysis,
          photoAssessments: [
            {
              url: original.photos[0].url,
              status: 'uncertain' as const,
              reason: 'Please check',
              candidates: { items: [{ type: 'sofa', count: 2 }], total_volume_cubic_feet: 160 },
            },
          ],
        },
        photoDecisionsLocked: false,
        followUps: { garage: null, closets: null, appliances: null },
        wholeMoveCovered: null,
      }
      const answered = change(
        state,
        key === 'coverage'
          ? { type: 'coverage.answer', answer: true }
          : { type: 'followUp.answer', key, answer: false },
      )
      expect(answered.photoDecisionsLocked).toBe(false)
      expect(change(answered, { type: 'item.count', itemType: 'sofa', count: 3 })).toBe(answered)
      const kept = change(answered, { type: 'photo.decide', photoId: state.photos[0].id, decision: 'keep' })
      expect(kept.photoDecisions[state.photos[0].url]).toBe('keep')
      if (key === 'coverage') expect(kept.wholeMoveCovered).toBe(true)
      else expect(kept.followUps[key]).toBe(false)
    },
  )
  it('named pre-photo inventory survives photos and analysis without alias double counting or invented volume', () => {
    let state = change(createConversationSession(), { type: 'item.add', item: { type: 'couch', count: 3 } })
    expect(state.items).toEqual([{ type: 'sofa', count: 3 }])
    state = change(state, { type: 'followUp.answer', key: 'garage', answer: false })
    state = change(state, { type: 'details.patch', patch: goalReady().moveDetails })
    state = change(state, { type: 'photo.add', photo: goalReady().photos[0] })
    expect(state.items).toEqual([{ type: 'sofa', count: 3 }])
    expect(state.followUps.garage).toBe(false)
    state = change(
      state,
      { type: 'operation.started', operationId: 'analysis-1', request: { kind: 'analyze' } },
      'system',
    )
    state = change(
      state,
      {
        type: 'operation.succeeded',
        operationId: 'analysis-1',
        result: { kind: 'analyze', analysis: goalReady().analysis },
      },
      'system',
    )
    expect(state.items).toEqual([{ type: 'sofa', count: 3 }])
    expect(state.analysis?.totalVolumeCubicFeet).toBe(160)
    state = change(state, {
      type: 'photo.add',
      photo: { id: 'photo-2', url: 'https://example.test/other.jpg', receipt: 'other' },
    })
    expect(state.analysis).toBeNull()
    expect(state.items).toEqual([{ type: 'sofa', count: 3 }])
    expect(state.followUps).toEqual({ garage: false, closets: null, appliances: null })
  })
  it('scores business completeness separately from confidence and explicit write confirmation', () => {
    const state = goalReady()
    expect(conversationCompleteness(state)).toEqual({ percent: 95, missing: [], ready: true })
    expect(conversationReadiness(state).canPrice).toBe(true)
    state.price = { currency: 'USD', total: 100, low: 90, high: 110, breakdown: {} }
    expect(conversationReadiness(state).canSave).toBe(false)
    expect(conversationReadiness(change(state, { type: 'details.confirm' })).canSave).toBe(true)
  })
  it.each([
    [
      'city',
      (s: ConversationSession) => {
        s.moveDetails.from = 'Boston'
      },
      /pickup street address/i,
    ],
    [
      'postal city',
      (s: ConversationSession) => {
        s.moveDetails.from = 'Boston, MA 02101'
      },
      /pickup street address/i,
    ],
    [
      'irrelevant photos',
      (s: ConversationSession) => {
        if (s.analysis?.photoAssessments?.[0]) s.analysis.photoAssessments[0].status = 'unrelated'
      },
      /relevant.*photo/i,
    ],
    [
      'access',
      (s: ConversationSession) => {
        s.moveDetails.destinationElevator = null
      },
      /delivery elevator/i,
    ],
    [
      'route',
      (s: ConversationSession) => {
        s.moveDetails.distanceMiles = null
        s.route = {
          status: 'unconfigured',
          from: s.moveDetails.from ?? '',
          to: s.moveDetails.to ?? '',
          endpointRevision: 0,
          precision: 'address',
          attribution: 'Powered by Geoapify',
        }
      },
      /routing.*not configured/i,
    ],
    [
      'coverage',
      (s: ConversationSession) => {
        s.wholeMoveCovered = false
      },
      /whole move/i,
    ],
    [
      'boxes',
      (s: ConversationSession) => {
        if (s.analysis) s.analysis.estimatedBoxes = { min: 4, max: 2 }
      },
      /box range/i,
    ],
  ] as const)('essential %s blocker cannot be bypassed by percentage', (_name, mutate, missing) => {
    const state = goalReady()
    mutate(state)
    const result = conversationCompleteness(state)
    expect(result.ready).toBe(false)
    expect(result.missing.join(' ')).toMatch(missing)
    expect(conversationReadiness(state).canPrice).toBe(false)
  })
  it('restores old v6 drafts with new defaults without trimming history or replaying work', () => {
    const state = goalReady()
    for (let i = 0; i < 250; i++) state.messages.push({ id: `old-${i}`, role: 'user', content: 'original wording' })
    const raw = JSON.parse(JSON.stringify(state))
    raw.inventoryOverrides = undefined
    raw.summaryAttemptRevision = undefined
    let saved = JSON.stringify(raw)
    const store = {
      getItem: () => saved,
      setItem: (_key: string, value: string) => {
        saved = value
      },
      removeItem() {},
    }
    const loaded = loadConversationSession(store)
    expect(loaded.messages).toHaveLength(250)
    expect(loaded.inventoryOverrides).toEqual([])
    saveConversationSession(loaded, store)
    expect(JSON.parse(saved).messages).toHaveLength(250)
  })
})
