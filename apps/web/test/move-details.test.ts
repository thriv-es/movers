import { describe, expect, it } from 'vitest'
import { mergeMoveDetails, parseAssistantTurn, sessionDataToMoveDetails } from '../functions/api/_lib/move-details'
import { EMPTY_MOVE_DETAILS } from '../src/data'

const block = (data: Record<string, unknown>, ready = false) =>
  JSON.stringify({ current_stage: 'x', data_collected: data, readiness_for_next_stage: ready }, null, 2)

describe('parseAssistantTurn (MOVERS-11)', () => {
  it('strips a fenced json block and maps the fields', () => {
    const text = `Thanks! Where to?\n\n\`\`\`json\n${block({
      origin_address: '1 Main St',
      origin_city: 'Austin',
      origin_state: 'TX',
      estimated_distance_miles: '120 miles',
      origin_floor: '3',
      origin_has_elevator: 'no',
    })}\n\`\`\``
    const turn = parseAssistantTurn(text)
    expect(turn.reply).toBe('Thanks! Where to?')
    expect(turn.moveDetails).toMatchObject({
      from: '1 Main St, Austin, TX',
      to: null,
      distanceMiles: 120,
      originFloor: 3,
      originElevator: false,
    })
    expect(turn.finished).toBe(false)
  })

  it('handles a bare trailing object and the "Your Response to Customer" prefix', () => {
    const text = `Your Response to Customer: Got it.\n${block({ move_date: '2027-01-15' })}`
    const turn = parseAssistantTurn(text)
    expect(turn.reply).toBe('Got it.')
    expect(turn.moveDetails.date).toBe('2027-01-15')
  })

  it('keeps earlier details when a turn omits them, and later values win', () => {
    const previous = { ...EMPTY_MOVE_DETAILS, from: 'A', distanceMiles: 10 }
    const turn = parseAssistantTurn(
      `Ok\n\`\`\`json\n${block({ destination_city: 'B', estimated_distance_miles: 20 })}\n\`\`\``,
      previous,
    )
    expect(turn.moveDetails).toMatchObject({ from: 'A', to: 'B', distanceMiles: 20 })
  })

  it('is finished when the model says so or every field is known', () => {
    expect(parseAssistantTurn(`Done\n\`\`\`json\n${block({}, true)}\n\`\`\``).finished).toBe(true)
    const full = {
      ...EMPTY_MOVE_DETAILS,
      from: 'A',
      to: 'B',
      date: '2027-01-01',
      distanceMiles: 5,
      originFloor: 1,
      destinationFloor: 1,
      originElevator: true,
      destinationElevator: true,
    }
    expect(parseAssistantTurn('Hi', full).finished).toBe(true)
    expect(parseAssistantTurn('Hi', { ...full, to: null }).finished).toBe(false)
  })

  it('returns empty details for text without a block', () => {
    const turn = parseAssistantTurn('Just prose, no data.')
    expect(turn.reply).toBe('Just prose, no data.')
    expect(turn.moveDetails).toEqual(EMPTY_MOVE_DETAILS)
  })
})

describe('sessionDataToMoveDetails', () => {
  it('turns junk into null', () => {
    expect(
      sessionDataToMoveDetails({ origin_floor: 'unknown', estimated_distance_miles: -4, move_date: 'N/A' }),
    ).toEqual(EMPTY_MOVE_DETAILS)
  })

  it('does not repeat the city when the address already has it', () => {
    expect(
      sessionDataToMoveDetails({
        origin_address: '1 Main St, Austin, TX 78701',
        origin_city: 'Austin',
        origin_state: 'TX',
      }).from,
    ).toBe('1 Main St, Austin, TX 78701')
  })
})

describe('mergeMoveDetails', () => {
  it('fills from previous and validates', () => {
    expect(mergeMoveDetails({ from: 'A' }, { ...EMPTY_MOVE_DETAILS, to: 'B' })).toMatchObject({ from: 'A', to: 'B' })
  })
})
