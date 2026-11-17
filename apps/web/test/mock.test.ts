import { describe, expect, it } from 'vitest'
import { extractAndRepairJSON } from '../functions/api/_lib/json-utils'
import { mockAnalysisReply, mockChatReply, mockPriceReply } from '../functions/api/_lib/mock'
import { zMoveDetails, zPrice } from '../src/data'
import { sessionDataToMoveDetails } from '../functions/api/_lib/move-details'
import type { PriceRequest } from '../src/data'

type Turn = { role: 'user' | 'assistant'; content: string }

/** Same extraction as the chat route (`parseAssistantTurn`); the client never sees this block. */
function sessionData(reply: string) {
  const match = reply.match(/```json\s*([\s\S]*?)\s*```/)
  expect(match, 'reply must contain a fenced json block').not.toBeNull()
  return JSON.parse(match?.[1] ?? '') as {
    current_stage: string
    data_collected: Record<string, unknown>
    next_expected_action: string
    readiness_for_next_stage: boolean
  }
}

/** Plays a whole conversation against the mock: it asks, the customer answers. */
function converse(answers: string[]): { turns: Turn[]; replies: string[] } {
  const turns: Turn[] = []
  const replies = [mockChatReply(turns)]
  for (const answer of answers) {
    turns.push({ role: 'assistant', content: replies[replies.length - 1] ?? '' })
    turns.push({ role: 'user', content: answer })
    replies.push(mockChatReply(turns))
  }
  return { turns, replies }
}

const FIVE_ANSWERS = [
  '123 Main St, Austin, TX',
  '456 Oak Ave, Dallas, TX',
  '2027-01-15',
  '3rd floor, no elevator',
  'Floor 2 and yes, there is an elevator',
]

const request: PriceRequest = {
  analysis: {
    items: [{ type: 'sofa', count: 1 }],
    totalVolumeCubicFeet: 200,
    estimatedBoxes: { min: 6, max: 10 },
    boxesExplanation: 'test',
    specialHandling: [],
    possibleDuplicates: [],
    unseenAreas: [],
  },
  moveDetails: {
    from: '123 Main St, Austin, TX',
    to: '456 Oak Ave, Dallas, TX',
    date: '2027-01-15',
    distanceMiles: 120,
    originFloor: 1,
    destinationFloor: 1,
    originElevator: true,
    destinationElevator: true,
  },
}

/** The mock answers without a range; the route adds `low`/`high`. Here the total stands in for both. */
function priceOf(req: PriceRequest, pricePerBox = 50) {
  const raw = extractAndRepairJSON(mockPriceReply(req, pricePerBox))
  return zPrice.parse({ ...raw, low: raw.total, high: raw.total })
}

function sum(breakdown: Record<string, number>): number {
  return Object.values(breakdown).reduce((total, value) => total + value, 0)
}

describe('mockChatReply', () => {
  it('is ready after five answers with every field the chat route requires', () => {
    const { replies } = converse(FIVE_ANSWERS)
    const data = sessionData(replies[replies.length - 1] ?? '')
    const d = data.data_collected

    expect(data.readiness_for_next_stage).toBe(true)
    // every field `sessionDataToMoveDetails` reads
    for (const field of [
      'origin_address',
      'origin_city',
      'origin_state',
      'destination_address',
      'destination_city',
      'destination_state',
      'move_date',
    ]) {
      expect(d[field], field).toBeTruthy()
    }
    for (const field of ['origin_floor', 'origin_has_elevator', 'destination_floor', 'destination_has_elevator']) {
      expect(d[field], field).not.toBeNull()
      expect(d[field], field).not.toBeUndefined()
    }

    expect(d).toMatchObject({
      origin_city: 'Austin',
      origin_state: 'TX',
      destination_city: 'Dallas',
      destination_state: 'TX',
      move_date: '2027-01-15',
      origin_floor: 3,
      origin_has_elevator: false,
      destination_floor: 2,
      destination_has_elevator: true,
    })
  })

  it('collects move details the route can send to /api/price', () => {
    const { replies } = converse(FIVE_ANSWERS)
    const d = sessionData(replies[replies.length - 1] ?? '').data_collected
    const details = zMoveDetails.parse(sessionDataToMoveDetails(d))
    expect(details.distanceMiles).toBeGreaterThan(0)
    expect(details.from).toContain('Austin')
    expect(details.originFloor).toBe(3)
  })

  it('pulls the street address out of a chatty first answer', () => {
    const chatty = [
      "I'm moving on 2027-01-15 to 456 Oak Ave, Dallas, TX (1st floor, with an elevator) from a 3rd-floor apartment that has no elevator at 123 Main St, Austin, TX 78701",
      'Going to 456 Oak Ave, Dallas, TX.',
    ]
    const { replies } = converse(chatty)
    const d = sessionData(replies[replies.length - 1] ?? '').data_collected
    expect(d).toMatchObject({
      origin_address: '123 Main St, Austin, TX 78701',
      origin_city: 'Austin',
      origin_state: 'TX',
      destination_address: '456 Oak Ave, Dallas, TX',
      destination_city: 'Dallas',
    })
  })

  it('is not ready on the first reply, nor before the fifth answer', () => {
    const { replies } = converse(FIVE_ANSWERS.slice(0, 4))
    expect(replies).toHaveLength(5)
    for (const reply of replies) {
      expect(sessionData(reply).readiness_for_next_stage).toBe(false)
    }
  })

  it('puts the customer-facing text before the json block and asks a question each turn', () => {
    const { replies } = converse(FIVE_ANSWERS.slice(0, 4))
    for (const reply of replies) {
      const text = reply.slice(0, reply.indexOf('```json')).trim()
      expect(text).toMatch(/\?/)
      expect(text).not.toMatch(/[{}]/)
    }
  })

  it('still produces valid move info from answers it cannot parse', () => {
    const { replies } = converse(['somewhere', 'elsewhere', 'soon', 'dunno', 'no idea'])
    const data = sessionData(replies[replies.length - 1] ?? '')
    const d = data.data_collected
    expect(data.readiness_for_next_stage).toBe(true)
    expect(d.origin_state).toBeTruthy()
    expect(d.move_date).toBeTruthy()
    expect(d.origin_floor).toBe(1)
    expect(d.destination_floor).toBe(1)
  })

  it('is deterministic', () => {
    expect(converse(FIVE_ANSWERS).replies).toEqual(converse(FIVE_ANSWERS).replies)
  })
})

describe('mockAnalysisReply', () => {
  it('parses to an inventory the analyze route accepts', () => {
    const data = extractAndRepairJSON(mockAnalysisReply(2))
    // mirrors the checks in functions/api/_routes/analyze.ts
    expect(Array.isArray(data.items)).toBe(true)
    expect(data.items.length).toBeGreaterThan(0)
    expect(typeof data.total_volume_cubic_feet).toBe('number')
    for (const item of data.items) {
      expect(typeof item.type).toBe('string')
      expect(item.type.trim()).not.toBe('')
      expect(Number.isInteger(item.count)).toBe(true)
      expect(item.count).toBeGreaterThan(0)
    }
    expect(Number.isInteger(data.estimated_boxes_min)).toBe(true)
    expect(Number.isInteger(data.estimated_boxes_max)).toBe(true)
    expect(data.estimated_boxes_max).toBeGreaterThanOrEqual(data.estimated_boxes_min)
    expect(typeof data.boxes_explanation).toBe('string')
  })

  it('flags a special item, a possible duplicate and unseen areas (MOVERS-23)', () => {
    const data = extractAndRepairJSON(mockAnalysisReply(2))
    expect(data.special_handling).toEqual([{ item: 'upright piano', reason: expect.any(String) }])
    expect(data.possible_duplicates).toEqual([{ item: 'floor lamp', count: 2 }])
    expect(data.unseen_areas.length).toBeGreaterThan(0)
    expect(extractAndRepairJSON(mockAnalysisReply(1)).possible_duplicates).toEqual([])
  })

  it('says it is demo data and names the photo count', () => {
    expect(extractAndRepairJSON(mockAnalysisReply(2)).boxes_explanation).toMatch(/demo/i)
    expect(extractAndRepairJSON(mockAnalysisReply(2)).boxes_explanation).toContain('2 photos')
    expect(extractAndRepairJSON(mockAnalysisReply(1)).boxes_explanation).toContain('1 photo')
  })
})

describe('mockPriceReply', () => {
  it('total equals the sum of its breakdown', () => {
    const price = priceOf(request)
    expect(Object.keys(price.breakdown).length).toBeGreaterThan(0)
    expect(price.total).toBe(sum(price.breakdown))
    expect(price.currency).toBe('USD')
  })

  it('includes the calculatePrice box cost', () => {
    expect(priceOf(request).breakdown['10 box(es)']).toBe(500)
    expect(priceOf(request, 20).breakdown['10 box(es)']).toBe(200)
  })

  it('rises when floors without an elevator are added', () => {
    const base = priceOf(request)
    const originStairs = priceOf({
      ...request,
      moveDetails: { ...request.moveDetails, originFloor: 3, originElevator: false },
    })
    const bothStairs = priceOf({
      ...request,
      moveDetails: {
        ...request.moveDetails,
        originFloor: 3,
        originElevator: false,
        destinationFloor: 2,
        destinationElevator: false,
      },
    })
    expect(originStairs.total).toBeGreaterThan(base.total)
    expect(bothStairs.total).toBeGreaterThan(originStairs.total)
    expect(bothStairs.total).toBe(sum(bothStairs.breakdown))
  })

  it('does not charge for stairs when there is an elevator', () => {
    const withElevator = priceOf({
      ...request,
      moveDetails: { ...request.moveDetails, originFloor: 5, originElevator: true },
    })
    expect(withElevator.total).toBe(priceOf(request).total)
  })

  it('rises with distance and copes with unknown move info', () => {
    const far = priceOf({ ...request, moveDetails: { ...request.moveDetails, distanceMiles: 600 } })
    expect(far.total).toBeGreaterThan(priceOf(request).total)

    const unknown = priceOf({
      ...request,
      moveDetails: {
        from: null,
        to: null,
        date: null,
        distanceMiles: null,
        originFloor: null,
        destinationFloor: null,
        originElevator: null,
        destinationElevator: null,
      },
    })
    expect(unknown.total).toBe(sum(unknown.breakdown))
  })

  it('adds a surcharge line per special item', () => {
    const withPiano = priceOf({
      ...request,
      analysis: { ...request.analysis, specialHandling: [{ item: 'upright piano', reason: 'heavy' }] },
    })
    expect(withPiano.breakdown['Special handling: upright piano']).toBe(150)
    expect(withPiano.total).toBe(priceOf(request).total + 150)
  })

  it('says it is a demo estimate', () => {
    expect(priceOf(request).explanation).toMatch(/demo/i)
  })
})
