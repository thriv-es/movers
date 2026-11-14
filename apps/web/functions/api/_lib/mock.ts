/**
 * Deterministic, offline stand-ins for the three AI calls.
 *
 * Each function returns text in the same format the real model returns (see `prompts.ts`), so the routes keep a
 * single parsing path. Everything here is demo data: the routes label it with `x-movers-ai-mode: mock`.
 */
import type { PriceRequest } from '../../../src/data'
import { calculatePrice } from './pricing'

const FENCE = '```'

/** Shown wherever a mocked answer carries free text, so demo data is never mistaken for a real estimate. */
const DEMO_NOTE = 'Demo data: AI is mocked locally'

type ChatTurn = { role: 'user' | 'assistant'; content: string }

interface Place {
  address: string
  city: string
  state: string
}

interface Access {
  floor: number
  hasElevator: boolean
}

function parsePlace(answer: string): Place {
  const address = answer.trim()
  const parts = address
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const last = parts[parts.length - 1] ?? address
  const state = /^([A-Za-z]{2})(\s+\d{5}(-\d{4})?)?$/.exec(last)?.[1]
  if (state && parts.length >= 2) {
    return { address, city: parts[parts.length - 2] ?? last, state: state.toUpperCase() }
  }
  return { address: address || 'Unknown', city: last || 'Unknown', state: 'Unknown' }
}

function parseDate(answer: string): string {
  return /\b\d{4}-\d{2}-\d{2}\b/.exec(answer)?.[0] ?? (answer.trim() || 'Unknown')
}

function parseAccess(answer: string): Access {
  const floor = Number.parseInt(/\d+/.exec(answer)?.[0] ?? '1', 10)
  const hasElevator = !/\b(no|not|none|without|stairs|walk-?up)\b/i.test(answer)
  return { floor: Math.max(1, floor), hasElevator }
}

/** No geocoding offline: a coarse, fixed distance by how far apart the two places look. */
function estimateDistanceMiles(origin: Place, destination: Place): number {
  if (origin.state !== destination.state) return 450
  return origin.city.toLowerCase() === destination.city.toLowerCase() ? 15 : 120
}

const QUESTIONS = [
  `Hi! I'm the Movers estimate assistant. I'm running in offline demo mode, so my answers are scripted and the estimate you get is demo data.

In about 5 minutes you'll have an itemized moving estimate: a few questions, a few photos, then a price you can review and edit. Estimates may vary and final pricing is confirmed after an on-site assessment.

Let's get started. Where are you moving from? Street, city and state, please.`,
  'Thanks! And where are you moving to? Street, city and state, please.',
  "Got it. What's your move date? A format like 2027-01-15 works best.",
  'Which floor is your current place on, and is there an elevator?',
  'Almost done. Which floor is the new place on, and is there an elevator there?',
] as const

const READY_TEXT = `That's everything I need. When you're ready, click the "Continue to photo upload" button below.`

/**
 * Walks the fixed question list: the nth customer message is taken as the answer to the nth question, and the
 * conversation is ready for photos after the fifth answer.
 */
export function mockChatReply(messages: ChatTurn[]): string {
  const answers = messages.filter((message) => message.role === 'user').map((message) => message.content)
  const answered = Math.min(answers.length, QUESTIONS.length)
  const ready = answered === QUESTIONS.length

  const origin = answers[0] !== undefined ? parsePlace(answers[0]) : null
  const destination = answers[1] !== undefined ? parsePlace(answers[1]) : null
  const moveDate = answers[2] !== undefined ? parseDate(answers[2]) : null
  const originAccess = answers[3] !== undefined ? parseAccess(answers[3]) : null
  const destinationAccess = answers[4] !== undefined ? parseAccess(answers[4]) : null

  const session = {
    current_stage: ready ? 'photo_upload_guidance' : answered === 0 ? 'welcome' : 'information_collection',
    data_collected: {
      origin_address: origin?.address ?? null,
      origin_city: origin?.city ?? null,
      origin_state: origin?.state ?? null,
      destination_address: destination?.address ?? null,
      destination_city: destination?.city ?? null,
      destination_state: destination?.state ?? null,
      move_date: moveDate,
      estimated_distance_miles: origin && destination ? estimateDistanceMiles(origin, destination) : null,
      origin_floor: originAccess?.floor ?? null,
      origin_has_elevator: originAccess?.hasElevator ?? null,
      destination_floor: destinationAccess?.floor ?? null,
      destination_has_elevator: destinationAccess?.hasElevator ?? null,
      consent_given: false,
      photos_uploaded_count: 0,
      special_notes: DEMO_NOTE,
    },
    next_expected_action: ready ? 'Continue to photo upload' : 'Answer the question',
    readiness_for_next_stage: ready,
  }

  const text = ready ? READY_TEXT : QUESTIONS[answered]
  return `${text}\n\n${FENCE}json\n${JSON.stringify(session, null, 2)}\n${FENCE}`
}

/** A fixed, plausible living-room inventory. It does not look at the photos. */
export function mockAnalysisReply(imageCount: number): string {
  const photos = `${imageCount} photo${imageCount === 1 ? '' : 's'}`
  return JSON.stringify(
    {
      items: [
        { type: 'sofa', count: 1 },
        { type: 'armchair', count: 1 },
        { type: 'coffee table', count: 1 },
        { type: 'bookshelf', count: 1 },
        { type: 'tv', count: 1 },
        { type: 'floor lamp', count: 2 },
        { type: 'dining table', count: 1 },
        { type: 'chairs', count: 4 },
        { type: 'small_moving_box_packed', count: 6 },
      ],
      total_volume_cubic_feet: 320,
      estimated_boxes_min: 12,
      estimated_boxes_max: 18,
      boxes_explanation: `${DEMO_NOTE}. This is a sample inventory, not an analysis of your ${photos}. 6 packed boxes plus an estimated 6-12 more for books, kitchenware and linens. Large furniture is wrapped, not boxed.`,
    },
    null,
    2,
  )
}

const DOLLARS_PER_MILE = 2
const DOLLARS_PER_FLIGHT = 75
const ASSUMED_DISTANCE_MILES = 100

function stairsSurcharge(floor: number | null, hasElevator: boolean | null): number {
  if (hasElevator !== false || floor === null || floor <= 1) return 0
  return (floor - 1) * DOLLARS_PER_FLIGHT
}

/** The existing `calculatePrice` box cost plus flat distance and stairs surcharges. */
export function mockPriceReply(request: PriceRequest, pricePerBox: number): string {
  const { analysis, moveInfo } = request
  const boxes = calculatePrice({ items: analysis.items, estimatedBoxes: analysis.estimatedBoxes, pricePerBox })
  const breakdown: Record<string, number> = { ...boxes.breakdown }

  const miles = moveInfo.distance_miles ?? ASSUMED_DISTANCE_MILES
  const transportation = Math.round(miles * DOLLARS_PER_MILE)
  if (transportation > 0) breakdown['Transportation (distance)'] = transportation

  const originStairs = stairsSurcharge(moveInfo.origin_floor, moveInfo.origin_has_elevator)
  if (originStairs > 0) breakdown['Stairs surcharge (origin)'] = originStairs

  const destinationStairs = stairsSurcharge(moveInfo.destination_floor, moveInfo.destination_has_elevator)
  if (destinationStairs > 0) breakdown['Stairs surcharge (destination)'] = destinationStairs

  const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0)
  const distanceNote = moveInfo.distance_miles === null ? ` (distance unknown, ${ASSUMED_DISTANCE_MILES} assumed)` : ''

  return JSON.stringify(
    {
      currency: boxes.currency,
      total,
      breakdown,
      explanation: `${DEMO_NOTE}, so this is a demo estimate and not a real quote. It adds the box cost, $${DOLLARS_PER_MILE} per mile over ${miles} miles${distanceNote} and $${DOLLARS_PER_FLIGHT} per flight of stairs where there is no elevator.`,
      confidence: 'low',
    },
    null,
    2,
  )
}
