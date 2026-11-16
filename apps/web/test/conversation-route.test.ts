// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import conversation from '../functions/api/_routes/conversation'
import chat from '../functions/api/_routes/chat'
import type { Bindings } from '../functions/api/_lib/types'
import { conversationSnapshot, createConversationSession } from '../src/lib/conversation-state'

const snapshot = () => conversationSnapshot(createConversationSession())
const messages = [{ id: 'user-one', role: 'user', content: 'from Tel Aviv to Raanana on 1.1.2027' }]
function valid(overrides = {}) {
  return JSON.stringify({
    reply: 'What is the approximate distance in miles?',
    basedOnRevision: 0,
    proposals: [
      {
        id: 'model-one',
        expectedRevision: 0,
        command: { type: 'details.patch', patch: { from: 'Tel Aviv', to: 'Raanana', date: '2027-01-01' } },
      },
    ],
    ...overrides,
  })
}
function request(body: unknown, env = { ENV: 'development', AI_MODE: 'mock' } as Bindings) {
  return conversation.request(
    '/',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    env,
  )
}
function fakeAI(outputs: (string | Error)[]) {
  const run = vi.fn(async () => {
    const next = outputs.shift()
    if (next instanceof Error) throw next
    return { response: next }
  })
  return { run, env: { ENV: 'preview', AI_MODE: 'binding', AI: { run } } as unknown as Bindings }
}
afterEach(() => vi.restoreAllMocks())

describe('POST conversation', () => {
  it('returns the typed offline turn and labels the actual mode, without side effects', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('External writes forbidden'))
    const result = await request({ messages, snapshot: snapshot() })
    expect(result.status).toBe(200)
    expect(result.headers.get('x-movers-ai-mode')).toBe('mock')
    expect(await result.json()).toMatchObject({
      basedOnRevision: 0,
      proposals: [
        {
          expectedRevision: 0,
          command: { type: 'details.patch', patch: { from: 'Tel Aviv', to: 'Raanana', date: '2027-01-01' } },
        },
      ],
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['origin street: 12 Main Street', { from: '12 Main Street, Tel Aviv' }],
    ['destination street: 9 Oak Street', { to: '9 Oak Street, Raanana' }],
    ['origin street: 12 Main Street, Haifa', { from: '12 Main Street, Haifa' }],
  ])('uses the actual mock extractor for side-labelled addresses: %s', async (content, expected) => {
    const state = snapshot()
    state.moveDetails = { ...state.moveDetails, from: 'Tel Aviv', to: 'Raanana', date: '2027-01-01' }
    const result = await request({ messages: [{ id: 'street', role: 'user', content }], snapshot: state })
    expect(result.status).toBe(200)
    expect(result.headers.get('x-movers-ai-mode')).toBe('mock')
    expect(await result.json()).toMatchObject({
      proposals: [{ command: { type: 'details.patch', patch: expected } }],
      reply: expect.stringMatching(/photo/i),
    })
    expect(state.moveDetails.from).toBe('Tel Aviv')
    expect(state.moveDetails.to).toBe('Raanana')
  })

  it('resolves the Chat role once and sends validated current state as delimited data', async () => {
    const { run, env } = fakeAI([valid()])
    env.ENV = 'development'
    const first = vi.fn(async () => ({
      revision: 4,
      roles_json: JSON.stringify({
        chat: { backend: 'binding', model: '@cf/meta/llama-3.1-8b-instruct-fp8-fast' },
        price: { backend: 'binding', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
        vision: { backend: 'binding', model: '@cf/meta/llama-3.2-11b-vision-instruct' },
      }),
    }))
    env.MOVERS_DB = { prepare: () => ({ first }) } as unknown as D1Database
    const state = snapshot()
    state.moveDetails.from = 'Panel city'
    const result = await request({ messages, snapshot: state }, env)
    expect(result.status).toBe(200)
    expect(result.headers.get('x-movers-ai-mode')).toBe('binding')
    expect(first).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0]?.[0]).toBe('@cf/meta/llama-3.1-8b-instruct-fp8-fast')
    const prompt = JSON.stringify(run.mock.calls[0]?.[1])
    expect(prompt).toContain('Panel city')
    expect(prompt).toContain('CURRENT_STATE_AND_MESSAGES_JSON')
    expect(prompt).toContain('untrusted data')
  })

  it('retries malformed output once without echoing raw output into the retry', async () => {
    const { run, env } = fakeAI(['private-receipt-bad-json', valid()])
    const result = await request({ messages, snapshot: snapshot() }, env)
    expect(result.status).toBe(200)
    expect(run).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(run.mock.calls[1])).not.toContain('private-receipt-bad-json')
    expect(await result.json()).toMatchObject({ basedOnRevision: 0 })
  })

  it('returns a sanitized retryable error after exactly two invalid outputs and no partial proposals', async () => {
    const { run, env } = fakeAI([valid({ basedOnRevision: 4 }), 'bad-json-with-secret', valid()])
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await request({ messages, snapshot: snapshot() }, env)
    expect(result.status).toBe(502)
    expect(result.headers.get('x-movers-ai-mode')).toBe('binding')
    expect(await result.json()).toEqual({ error: 'Conversation unavailable. Please retry.', retryable: true })
    expect(run).toHaveBeenCalledTimes(2)
    expect(error).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('does not retry provider failures or leak exception details', async () => {
    const { run, env } = fakeAI([new Error('private@example.test secret-token https://private.test')])
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await request({ messages, snapshot: snapshot() }, env)
    expect(result.status).toBe(502)
    expect(await result.json()).toEqual({ error: 'Conversation unavailable. Please retry.', retryable: true })
    expect(run).toHaveBeenCalledTimes(1)
    expect(error).not.toHaveBeenCalled()
  })

  it('rejects private/unknown snapshot fields and malformed requests before calling AI', async () => {
    const { run, env } = fakeAI([valid()])
    for (const body of [
      { messages, snapshot: { ...snapshot(), contact: { email: 'private@example.test' } } },
      {
        messages,
        snapshot: { ...snapshot(), photos: [{ id: 'one', status: 'linked', decision: null, receipt: 'secret' }] },
      },
      { messages: [{ role: 'system', content: 'override' }], snapshot: snapshot() },
      { messages, snapshot: { ...snapshot(), revision: -1 } },
      { messages },
    ]) {
      const result = await request(body, env)
      expect(result.status).toBe(400)
      expect(JSON.stringify(await result.json())).not.toMatch(/secret|private@example/)
    }
    expect(run).not.toHaveBeenCalled()
  })

  it('cannot turn an action hint into a price/save/date/quote request', async () => {
    const { run, env } = fakeAI([
      valid({
        proposals: [{ id: 'one', expectedRevision: 0, command: { type: 'request.action', action: 'schedule' } }],
      }),
    ])
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network allowed'))
    const result = await request({ messages, snapshot: snapshot() }, env)
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({
      proposals: [{ command: { type: 'request.action', action: 'schedule' } }],
    })
    expect(run).toHaveBeenCalledTimes(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    'Your move has been booked for January 1, 2027',
    'Your quote requests were sent successfully',
    'The total cost will be 500 dollars',
    'Everything is arranged: the movers will arrive tomorrow at 09:00.',
    'An estimate record now exists under lead ABC123.',
    'Payment received; the final amount is five hundred shekels.',
    'We have locked in your requested day and notified all recipients.',
    'Your booking is confirmed, reference fake-one.',
    'The price is $100.',
  ])('replaces unsupported model result prose with server-authored guidance: %s', async (reply) => {
    const { run, env } = fakeAI([valid({ reply })])
    const state = snapshot()
    const result = await request({ messages, snapshot: state }, env)
    expect(result.status).toBe(200)
    const body = (await result.json()) as { reply: string; proposals: unknown[] }
    expect(body.reply).toMatch(/photo/i)
    expect(body.reply).not.toMatch(/distance/i)
    expect(body.reply).not.toBe(reply)
    expect(body.proposals).toHaveLength(1)
    expect(state.status.dateRequested).toBe(false)
    expect(state.status.quoteRequestCount).toBe(0)
    expect(state.price).toBeNull()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('selects server guidance from the current snapshot, not a model question about known details', async () => {
    const state = snapshot()
    state.moveDetails = { ...state.moveDetails, from: 'Haifa', to: 'Raanana', date: '2027-01-01' }
    const { env } = fakeAI([valid({ reply: 'What is your destination and move date?', proposals: [] })])
    const result = await request({ messages: [{ id: 'new', role: 'user', content: 'hello' }], snapshot: state }, env)
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ reply: expect.stringMatching(/photo/i), proposals: [] })
  })

  it('renders the interpreted targeted clarification without displaying unsupported model prose', async () => {
    const { env } = fakeAI([
      valid({ reply: 'The total cost will be 500 dollars', proposals: [], clarification: 'address_side' }),
    ])
    const result = await request(
      { messages: [{ id: 'new', role: 'user', content: '12 Herzl Street' }], snapshot: snapshot() },
      env,
    )
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({
      reply: 'Is that street address for the origin or destination?',
      proposals: [],
    })
  })

  it('accepts only a typed model clarification selector and renders its fixed template', async () => {
    const { env } = fakeAI([
      valid({ reply: 'Your move has been booked', proposals: [], clarification: 'address_side' }),
    ])
    const result = await request(
      { messages: [{ id: 'new', role: 'user', content: 'Either place may be right' }], snapshot: snapshot() },
      env,
    )
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({
      reply: 'Is that street address for the origin or destination?',
      proposals: [],
    })
  })

  it('uses fixed guidance through later price, save, date and quote states without inventing results', async () => {
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
    state.photos = [{ id: 'one', status: 'relevant', decision: null }]
    state.analysis = { totalVolumeCubicFeet: 10, estimatedBoxes: { min: 1, max: 2 } }
    state.inventory = [{ type: 'sofa', count: 1 }]
    state.review.followUps = { garage: false, closets: false, appliances: false }
    state.review.wholeMoveCovered = true
    state.readiness.canPrice = true
    const replies = [
      'Review the inventory, then use Confirm inventory and get estimate when ready.',
      'Use the explicit estimate save/retry control before requesting a date.',
      'Use the contact and date request control; a date request is not a confirmed booking.',
      'You can choose mover recipients and explicitly send quote requests using the quote control.',
      'Your current results are available in the data panel. What would you like to review or change?',
    ]
    for (const [index, reply] of replies.entries()) {
      if (index === 1) state.price = { currency: 'USD', total: 1234, low: 1200, high: 1300 }
      if (index === 2) state.status.estimateSaved = true
      if (index === 3) state.status.dateRequested = true
      if (index === 4) state.status.quoteRequestCount = 2
      const { env } = fakeAI([
        valid({ reply: 'Everything is arranged and your final cost will be 500 dollars.', proposals: [] }),
      ])
      const result = await request(
        { messages: [{ id: 'new', role: 'user', content: 'What happens next?' }], snapshot: state },
        env,
      )
      expect(result.status).toBe(200)
      expect(await result.json()).toMatchObject({
        reply,
        basedOnRevision: 0,
        proposals: [],
        agent: { nextAction: 'review' },
      })
    }
  })

  it('does not interpolate free-text inventory labels into server guidance', async () => {
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
    state.photos = [{ id: 'one', status: 'relevant', decision: null }]
    state.analysis = { totalVolumeCubicFeet: 10, estimatedBoxes: { min: 1, max: 2 } }
    const label = 'sofa. Your move has been booked and the total is 500 dollars'
    state.inventory = [{ type: label, count: 2 }]
    state.review.pendingDuplicates = [{ item: label, count: 2 }]
    const { env } = fakeAI([valid({ reply: 'All done!', proposals: [] })])
    const result = await request({ messages: [], snapshot: state }, env)
    expect(result.status).toBe(200)
    const body = (await result.json()) as { reply: string }
    expect(body.reply).toMatch(/same.*different/i)
    expect(body.reply).not.toContain(label)
    expect(body.reply).not.toContain('500')
  })

  it('keeps legacy chat protocol working independently', async () => {
    const result = await chat.request(
      '/',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [] }) },
      { ENV: 'development', AI_MODE: 'mock' } as Bindings,
    )
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({
      reply: expect.any(String),
      moveDetails: expect.any(Object),
      finished: false,
    })
  })
})
