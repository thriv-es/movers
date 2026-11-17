/**
 * Turns the assistant's raw answer (prose plus a JSON session block, see `SYSTEM_PROMPT`) into the structured
 * contract the client gets: a clean reply with no JSON in it, typed move details and a finished flag.
 *
 * Only the server ever sees the JSON block. The client never parses message text.
 */
import { EMPTY_MOVE_DETAILS, type MoveDetails, zMoveDetails } from '../../../src/data'

const FENCED_JSON = /```(?:json)?\s*([\s\S]*?)\s*```/g

interface SessionBlock {
  data_collected?: Record<string, unknown>
  readiness_for_next_stage?: boolean
}

export interface ParsedAssistantTurn {
  reply: string
  moveDetails: MoveDetails
  finished: boolean
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || /^(null|unknown|n\/a|none)$/i.test(trimmed)) return null
  return trimmed
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(/[^\d.-]/g, ''))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function asFloor(value: unknown): number | null {
  const n = asNumber(value)
  if (n === null) return null
  const floor = Math.round(n)
  return floor >= 1 ? floor : null
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (/^(true|yes)$/i.test(value.trim())) return true
    if (/^(false|no)$/i.test(value.trim())) return false
  }
  return null
}

function joinPlace(data: Record<string, unknown>, prefix: 'origin' | 'destination'): string | null {
  const address = asString(data[`${prefix}_address`])
  const city = asString(data[`${prefix}_city`])
  const state = asString(data[`${prefix}_state`])
  const parts: string[] = []
  if (address) parts.push(address)
  if (city && !address?.toLowerCase().includes(city.toLowerCase())) parts.push(city)
  if (state && !(address && new RegExp(`\\b${state}\\b`, 'i').test(address))) parts.push(state)
  return parts.length ? parts.join(', ') : null
}

/** Maps the prompt's `data_collected` shape onto `MoveDetails`. Missing or junk fields become null. */
export function sessionDataToMoveDetails(data: Record<string, unknown> | undefined): MoveDetails {
  if (!data) return { ...EMPTY_MOVE_DETAILS }
  const distance = asNumber(data.estimated_distance_miles)
  return {
    from: joinPlace(data, 'origin'),
    to: joinPlace(data, 'destination'),
    date: asString(data.move_date),
    distanceMiles: distance !== null && distance >= 0 ? distance : null,
    originFloor: asFloor(data.origin_floor),
    destinationFloor: asFloor(data.destination_floor),
    originElevator: asBoolean(data.origin_has_elevator),
    destinationElevator: asBoolean(data.destination_has_elevator),
  }
}

/** Later non-null values win; a turn that omits a field keeps what an earlier turn collected. */
export function mergeMoveDetails(previous: Partial<MoveDetails> | undefined, next: MoveDetails): MoveDetails {
  const merged: MoveDetails = { ...EMPTY_MOVE_DETAILS, ...previous }
  for (const key of Object.keys(next) as (keyof MoveDetails)[]) {
    const value = next[key]
    if (value !== null && value !== undefined) (merged as Record<string, unknown>)[key] = value
  }
  return zMoveDetails.parse(merged)
}

/** The fields the customer must have before photos make sense; everything else can stay unknown. */
export const REQUIRED_MOVE_FIELDS: (keyof MoveDetails)[] = ['from', 'to', 'distanceMiles']

export function isMoveReady(details: MoveDetails): boolean {
  return (
    details.from !== null &&
    details.to !== null &&
    details.date !== null &&
    details.distanceMiles !== null &&
    details.originFloor !== null &&
    details.destinationFloor !== null &&
    details.originElevator !== null &&
    details.destinationElevator !== null
  )
}

/**
 * Splits the model text into the reply and the session block. A bare trailing `{...}` object (a model that forgot the
 * fence) is treated the same way. Anything that looks like JSON is removed from the reply.
 */
export function parseAssistantTurn(text: string, previous?: Partial<MoveDetails>): ParsedAssistantTurn {
  let session: SessionBlock | null = null
  let reply = text

  const fenced = [...text.matchAll(FENCED_JSON)]
  for (const match of fenced) {
    if (!session) {
      try {
        session = JSON.parse(match[1] ?? '') as SessionBlock
      } catch {
        session = null
      }
    }
  }
  reply = reply.replace(FENCED_JSON, '')

  if (!session) {
    const bare = /\{[\s\S]*"data_collected"[\s\S]*\}\s*$/.exec(reply)
    if (bare) {
      try {
        session = JSON.parse(bare[0]) as SessionBlock
      } catch {
        session = null
      }
      reply = reply.slice(0, bare.index)
    }
  }

  reply = reply.replace(/^\s*Your Response to Customer:\s*/i, '').trim()

  const moveDetails = mergeMoveDetails(previous, sessionDataToMoveDetails(session?.data_collected))
  const finished = session?.readiness_for_next_stage === true || isMoveReady(moveDetails)

  return { reply, moveDetails, finished }
}
