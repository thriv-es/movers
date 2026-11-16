// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  mockConversationTurn,
  parseConversationTurn,
  zConversationRequest,
} from '../functions/api/_lib/conversation-agent'
import type { ConversationSnapshot } from '../src/data/z-common/z-conversation'
import { conversationSnapshot, createConversationSession } from '../src/lib/conversation-state'

function snapshot(): ConversationSnapshot {
  return conversationSnapshot(createConversationSession())
}
function turn(text: string, state = snapshot(), previousQuestion?: string) {
  return mockConversationTurn(
    [
      ...(previousQuestion ? [{ id: 'question', role: 'assistant' as const, content: previousQuestion }] : []),
      { id: 'answer', role: 'user', content: text },
    ],
    state,
  )
}
function patch(text: string, state = snapshot(), question?: string) {
  const response = turn(text, state, question)
  return response.proposals.find((p) => p.command.type === 'details.patch')?.command
}
function raw(command: unknown, state = snapshot(), overrides = {}) {
  return JSON.stringify({
    reply: 'Please review the proposed change.',
    basedOnRevision: state.revision,
    proposals: [{ id: 'model-one', expectedRevision: state.revision, command }],
    ...overrides,
  })
}

describe('state-aware offline conversation', () => {
  it('splits combined origin, destination and date into one patch and skips known questions', () => {
    const response = turn('from Tel Aviv to Raanana on 1.1.2027')
    expect(response.proposals).toHaveLength(1)
    expect(response.proposals[0].command).toEqual({
      type: 'details.patch',
      patch: { from: 'Tel Aviv', to: 'Raanana', date: '2027-01-01' },
    })
    expect(response.reply).toMatch(/distance/i)
    expect(response.reply).not.toMatch(/where|destination|what date/i)
  })

  it('extracts out-of-order fields without assigning by message number', () => {
    expect(patch('on 2027-01-01, to Raanana, from Tel Aviv')).toEqual({
      type: 'details.patch',
      patch: { from: 'Tel Aviv', to: 'Raanana', date: '2027-01-01' },
    })
    expect(patch('from Tel Aviv to Raanana')).toEqual({
      type: 'details.patch',
      patch: { from: 'Tel Aviv', to: 'Raanana' },
    })
  })

  it('uses panel state over historical transcript and retains partial values', () => {
    const state = snapshot()
    state.moveDetails = { ...state.moveDetails, from: 'Haifa', to: 'Raanana', date: '2027-02-02' }
    const response = mockConversationTurn(
      [
        { id: 'old', role: 'user', content: 'from Tel Aviv to Jerusalem on 1.1.2027' },
        { id: 'new', role: 'user', content: 'hello' },
      ],
      state,
    )
    expect(response.proposals).toEqual([])
    expect(response.reply).toMatch(/distance/i)
    expect(patch('distance is 12 miles', state)).toEqual({ type: 'details.patch', patch: { distanceMiles: 12 } })
  })

  it('keeps known city when an address fragment has an explicit side or question context', () => {
    const state = snapshot()
    state.moveDetails.from = 'Tel Aviv'
    state.moveDetails.to = 'Raanana'
    expect(patch('12 Herzl Street', state, 'What is the origin street address?')).toEqual({
      type: 'details.patch',
      patch: { from: '12 Herzl Street, Tel Aviv' },
    })
    expect(patch('destination address: 9 Oak Street', state)).toEqual({
      type: 'details.patch',
      patch: { to: '9 Oak Street, Raanana' },
    })
  })

  it('asks a targeted clarification for an address without an identified side', () => {
    const response = turn('12 Herzl Street')
    expect(response.proposals).toEqual([])
    expect(response.reply).toMatch(/origin.*destination/i)
  })

  it.each(['1/2/2027', '2.3.2027', '31.2.2027'])('does not invent an ambiguous or invalid date: %s', (date) => {
    const response = turn(`from Tel Aviv to Raanana on ${date}`)
    expect(response.proposals[0].command).toEqual({ type: 'details.patch', patch: { from: 'Tel Aviv', to: 'Raanana' } })
    expect(response.reply).toMatch(/date.*YYYY-MM-DD/i)
  })

  it('supports explicit corrections and clearing without filling omitted access or consent', () => {
    const state = snapshot()
    state.moveDetails.from = 'Tel Aviv'
    expect(patch('actually from Haifa', state)).toEqual({ type: 'details.patch', patch: { from: 'Haifa' } })
    expect(patch('clear destination', state)).toEqual({ type: 'details.patch', patch: { to: null } })
    expect(turn('yes', state).proposals).toEqual([])
  })

  it('extracts only explicit floors/elevators and refuses to interpret ground as a protocol floor', () => {
    expect(patch('origin floor 2, destination floor 3, origin elevator yes, destination elevator no')).toEqual({
      type: 'details.patch',
      patch: { originFloor: 2, destinationFloor: 3, originElevator: true, destinationElevator: false },
    })
    expect(patch('ground floor')).toBeUndefined()
  })

  it.each([
    ['12', 'What is the approximate distance in miles?', { distanceMiles: 12 }],
    ['2', 'What is the origin floor (positive floor number)?', { originFloor: 2 }],
    ['no', 'Is there a destination elevator?', { destinationElevator: false }],
    ['yes', 'Is there an origin elevator?', { originElevator: true }],
    ['Tel Aviv', 'What is the origin city or address?', { from: 'Tel Aviv' }],
  ])('attaches a short answer to its specific current detail question: %s', (answer, question, expected) => {
    expect(patch(answer, snapshot(), question)).toEqual({ type: 'details.patch', patch: expected })
  })

  it('supports explicit current review yes/no without inferring unrelated coverage', () => {
    const state = snapshot()
    state.analysis = { totalVolumeCubicFeet: 10, estimatedBoxes: { min: 1, max: 2 } }
    state.inventory = [{ type: 'sofa', count: 1 }]
    expect(
      turn('no', state, 'Are there additional garage items missing from this inventory?').proposals[0]?.command,
    ).toEqual({ type: 'followUp.answer', key: 'garage', answer: false })
    expect(
      turn('yes', state, 'Does this inventory cover the whole move? Please explicitly answer yes or no.').proposals[0]
        ?.command,
    ).toEqual({ type: 'coverage.answer', answer: true })
    expect(turn('yes', state, 'Please confirm the move details.').proposals).toEqual([])
  })

  it('asks rather than dropping an existing city when the old full address has no city separator', () => {
    const state = snapshot()
    state.moveDetails.from = '10 Main Street Tel Aviv'
    const result = turn('12 Herzl Street', state, 'What is the origin street address?')
    expect(result.proposals).toEqual([])
    expect(result.reply).toMatch(/city/i)
  })

  it('does not invent or echo a reference, price, receipt or successful booking in prose', () => {
    for (const reply of ['Your booking is confirmed, reference fake-one.', 'The price is $100.', 'Receipt: fake-one']) {
      expect(() =>
        parseConversationTurn(raw({ type: 'request.action', action: 'schedule' }, snapshot(), { reply }), snapshot()),
      ).toThrow()
    }
  })

  it.each(['distance is -12 miles', 'origin floor 1.5'])(
    'does not coerce invalid numeric details into invented positive values: %s',
    (text) => {
      expect(turn(text).proposals).toEqual([])
    },
  )

  it('moves through confirmation, attachments, analysis and review without asserting success', () => {
    const state = snapshot()
    state.moveDetails = {
      from: 'A',
      to: 'B',
      date: '2027-01-01',
      distanceMiles: 5,
      originFloor: 1,
      destinationFloor: 1,
      originElevator: false,
      destinationElevator: false,
    }
    expect(turn('hello', state).reply).toMatch(/confirm.*details/i)
    expect(turn('yes', state).proposals).toEqual([])
    state.detailsConfirmed = true
    expect(turn('hello', state).reply).toMatch(/attach|upload/i)
    state.photos = [{ id: 'photo-one', status: 'linked', decision: null }]
    expect(turn('hello', state).reply).toMatch(/analy/i)
    state.analysis = { totalVolumeCubicFeet: 10, estimatedBoxes: { min: 1, max: 2 } }
    state.photos[0].status = 'uncertain'
    expect(turn('hello', state).reply).toMatch(/keep.*exclude/i)
    expect(turn('keep photo-one', state).proposals[0].command).toEqual({
      type: 'photo.decide',
      photoId: 'photo-one',
      decision: 'keep',
    })
    state.photos[0].decision = 'keep'
    state.inventory = [{ type: 'sofa', count: 2 }]
    state.review.pendingDuplicates = [{ item: 'sofa', count: 2 }]
    expect(turn('hello', state).reply).toMatch(/same.*different/i)
    expect(turn('sofa are different', state).proposals[0].command).toEqual({
      type: 'duplicate.resolve',
      itemType: 'sofa',
      resolution: 'different',
    })
    state.review.pendingDuplicates = []
    expect(turn('hello', state).reply).toMatch(/garage/i)
    expect(turn('no garage items', state).proposals[0].command).toEqual({
      type: 'followUp.answer',
      key: 'garage',
      answer: false,
    })
    state.review.followUps = { garage: false, closets: false, appliances: false }
    expect(turn('hello', state).reply).toMatch(/whole move/i)
    expect(turn('the whole move is covered', state).proposals[0].command).toEqual({
      type: 'coverage.answer',
      answer: true,
    })
    state.review.wholeMoveCovered = true
    state.readiness.canPrice = true
    expect(turn('hello', state).reply).toMatch(/estimate/i)
    expect(turn('get estimate', state).proposals[0].command).toEqual({ type: 'request.action', action: 'price' })
    state.price = { currency: 'USD', total: 100, low: 90, high: 110 }
    state.status.estimateSaved = true
    expect(turn('hello', state).reply).toMatch(/contact.*date/i)
    state.status.dateRequested = true
    expect(turn('hello', state).reply).toMatch(/quote/i)
  })

  it('selects the next question after proposed item edits and invalidates the projected old price', () => {
    const state = snapshot()
    state.moveDetails = {
      from: 'A',
      to: 'B',
      date: '2027-01-01',
      distanceMiles: 5,
      originFloor: 1,
      destinationFloor: 1,
      originElevator: false,
      destinationElevator: false,
    }
    state.detailsConfirmed = true
    state.photos = [{ id: 'photo-one', status: 'relevant', decision: null }]
    state.analysis = { totalVolumeCubicFeet: 10, estimatedBoxes: { min: 1, max: 2 } }
    expect(turn('add 2 chairs', state).reply).toMatch(/garage/i)
    state.inventory = [{ type: 'sofa', count: 1 }]
    state.review.followUps = { garage: false, closets: false, appliances: false }
    state.review.wholeMoveCovered = true
    state.price = { currency: 'USD', total: 100, low: 90, high: 110 }
    state.status.estimateSaved = true
    expect(turn('set sofa count to 3', state).reply).toMatch(/estimate/i)
    expect(state.inventory).toEqual([{ type: 'sofa', count: 1 }])
    expect(state.price.total).toBe(100)
  })

  it('proposes explicit item changes but leaves ambiguous destructive changes for clarification', () => {
    const state = snapshot()
    state.analysis = { totalVolumeCubicFeet: 10, estimatedBoxes: { min: 0, max: 1 } }
    state.inventory = [{ type: 'sofa', count: 1 }]
    expect(turn('add 2 chairs', state).proposals[0].command).toEqual({
      type: 'item.add',
      item: { type: 'chairs', count: 2 },
    })
    expect(turn('set sofa count to 3', state).proposals[0].command).toEqual({
      type: 'item.count',
      itemType: 'sofa',
      count: 3,
    })
    expect(turn('remove sofa', state).proposals[0].command).toEqual({ type: 'item.remove', itemType: 'sofa' })
    expect(turn('remove it', state).proposals).toEqual([])
    expect(turn('add 0 chairs', state).proposals).toEqual([])
  })
})

describe('strict conversation proposal boundary', () => {
  it('accepts explicit null and generates local IDs instead of trusting the model ID', () => {
    const result = parseConversationTurn(raw({ type: 'details.patch', patch: { from: null } }), snapshot())
    expect(result.proposals[0].command).toEqual({ type: 'details.patch', patch: { from: null } })
    expect(result.proposals[0].id).not.toBe('model-one')
    expect(result.proposals[0].id).toMatch(/^[a-zA-Z0-9_-]{1,128}$/)
  })

  it.each([
    { type: 'operation.succeeded', result: { kind: 'save', estimateId: 'fake' } },
    { type: 'details.confirm' },
    { type: 'details.patch', patch: { receipt: 'secret' } },
    { type: 'details.patch', patch: {} },
    { type: 'details.patch', patch: { date: '2027-02-31' } },
    { type: 'details.patch', patch: { date: '2.3.2027' } },
    { type: 'item.add', item: { type: 'chair', count: 0 } },
    { type: 'item.count', itemType: 'chair', count: -1 },
    { type: 'item.count', itemType: 'chair', count: 1.5 },
    { type: 'item.count', itemType: 'unknown', count: 1 },
    { type: 'item.remove', itemType: 'unknown' },
    { type: 'photo.decide', photoId: 'unknown', decision: 'keep' },
    { type: 'duplicate.resolve', itemType: 'unknown', resolution: 'same' },
    { type: 'request.action', action: 'book', reference: 'fake' },
  ])('rejects invalid command batches: %j', (command) => {
    expect(() => parseConversationTurn(raw(command), snapshot())).toThrow()
  })

  it('rejects additions whose canonical current total would exceed the protocol count limit', () => {
    const state = snapshot()
    state.inventory = [{ type: 'couch', count: 9999 }]
    expect(() =>
      parseConversationTurn(raw({ type: 'item.add', item: { type: 'sofa', count: 2 } }, state), state),
    ).toThrow()
  })

  it('validates references against current inventory, uncertainty and duplicates', () => {
    const state = snapshot()
    state.inventory = [{ type: 'couch', count: 2 }]
    state.photos = [{ id: 'photo-one', status: 'relevant', decision: null }]
    expect(
      parseConversationTurn(raw({ type: 'item.count', itemType: 'sofa', count: 3 }, state), state).proposals,
    ).toHaveLength(1)
    expect(() =>
      parseConversationTurn(raw({ type: 'photo.decide', photoId: 'photo-one', decision: 'keep' }, state), state),
    ).toThrow()
    expect(() =>
      parseConversationTurn(raw({ type: 'duplicate.resolve', itemType: 'sofa', resolution: 'same' }, state), state),
    ).toThrow()
  })

  it.each([
    { basedOnRevision: 2 },
    { reply: '   ' },
    { reply: 'https://private.test/receipt' },
    { price: { total: 1 } },
    { receipt: 'private' },
    { proposals: [{ id: 'bad/url', expectedRevision: 0, command: { type: 'coverage.answer', answer: true } }] },
    { proposals: [{ id: 'one', expectedRevision: 1, command: { type: 'coverage.answer', answer: true } }] },
    { proposals: [1, 2] },
  ])('rejects stale, unsafe or malformed envelopes: %j', (overrides) => {
    expect(() =>
      parseConversationTurn(raw({ type: 'coverage.answer', answer: true }, snapshot(), overrides), snapshot()),
    ).toThrow()
  })

  it('rejects multiple same-revision detail patches rather than silently losing fields', () => {
    const proposal = { id: 'one', expectedRevision: 0, command: { type: 'details.patch', patch: { from: 'A' } } }
    expect(() =>
      parseConversationTurn(
        JSON.stringify({
          reply: 'Review changes.',
          basedOnRevision: 0,
          proposals: [proposal, { ...proposal, id: 'two' }],
        }),
        snapshot(),
      ),
    ).toThrow()
  })

  it('does not allow unknown snapshot secrets to pass validation, including nested data', () => {
    for (const state of [
      { ...snapshot(), contact: { email: 'private@example.test' } },
      {
        ...snapshot(),
        photos: [{ id: 'one', status: 'linked', decision: null, receipt: 'secret', url: 'https://private.test' }],
      },
      { ...snapshot(), moveDetails: { ...snapshot().moveDetails, bytes: 'secret' } },
      {
        ...snapshot(),
        review: { ...snapshot().review, followUps: { garage: null, closets: null, appliances: null, key: 'secret' } },
      },
    ])
      expect(zConversationRequest.safeParse({ messages: [], snapshot: state }).success).toBe(false)
  })
})
