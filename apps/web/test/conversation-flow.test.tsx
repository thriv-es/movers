import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HelmetProvider } from 'react-helmet-async'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EstimatePage from '../src/pages/estimate.page'
import {
  conversationSnapshot,
  createConversationSession,
  type ConversationSession,
} from '../src/lib/conversation-state'
import { SESSION_KEY, sampleSession } from '../src/lib/estimate-session'
import type { ConversationCommand } from '../src/data/z-common/z-conversation'
import { conversationChatApi, chatApi } from '../src/lib/api-client'

function packet(commands: ConversationCommand[] = [], revision = 0, reply = 'Check the suggested updates.') {
  return {
    reply,
    basedOnRevision: revision,
    proposals: commands.map((command, index) => ({ id: `suggestion-${index}`, expectedRevision: revision, command })),
  }
}
function send(text: string) {
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
}

const analysis = {
  visionRevision: 1,
  visionFingerprint: 'current-vision',
  items: [{ type: 'sofa', count: 1 }],
  totalVolumeCubicFeet: 80,
  estimatedBoxes: { min: 2, max: 4 },
  boxesExplanation: '',
  specialHandling: [],
  possibleDuplicates: [],
  unseenAreas: [],
}
const price = {
  currency: 'USD',
  total: 100,
  low: 90,
  high: 110,
  breakdown: { labor: 100 },
  confidence: 'high' as const,
}
const mover = { id: 'mover-1', name: 'Synthetic Mover', slug: 'synthetic', serviceArea: 'Boston' }
function ready(patch: Partial<ConversationSession> = {}): ConversationSession {
  return {
    ...createConversationSession(),
    moveDetails: sampleSession(window.location.origin).moveDetails,
    detailsConfirmed: true,
    timeline: (patch.messages ?? []).map((message, index) => ({
      kind: 'message',
      id: `entry-${index}`,
      revision: 0,
      message,
    })),
    photos: [{ id: 'photo-1', url: 'https://example.test/room.jpg', receipt: 'test-receipt' }],
    photoUrls: ['https://example.test/room.jpg'],
    photoRefs: [{ url: 'https://example.test/room.jpg', receipt: 'test-receipt' }],
    analysis,
    items: analysis.items,
    followUps: { garage: false, closets: false, appliances: false },
    wholeMoveCovered: true,
    ...patch,
  }
}
function mount(state?: ConversationSession) {
  if (state) window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(state))
  return render(
    <StrictMode>
      <HelmetProvider>
        <MemoryRouter>
          <EstimatePage />
        </MemoryRouter>
      </HelmetProvider>
    </StrictMode>,
  )
}
const draft = (): ConversationSession => JSON.parse(window.sessionStorage.getItem(SESSION_KEY) ?? '{}')
function reopenStage(name: RegExp) {
  const button = screen.queryByRole('button', { name })
  if (button) fireEvent.click(button)
}
const confirmPrice = () => {
  if (!screen.queryByRole('button', { name: 'Confirm inventory and get estimate' }))
    reopenStage(/Review estimate requirements/)
  return screen.getByRole('button', { name: 'Confirm inventory and get estimate' })
}
const contact = {
  name: 'Synthetic Customer',
  email: 'synthetic@example.test',
  phone: '555-0101',
  requestedDate: '2027-01-20',
}
const writeCases = [
  { kind: 'save', path: '/api/estimates' },
  { kind: 'schedule', path: '/api/estimates/saved-id/contact' },
  { kind: 'quotes', path: '/api/quote-requests' },
] as const
async function beginWrite(kind: (typeof writeCases)[number]['kind']) {
  if (kind === 'save') fireEvent.click(screen.getByRole('button', { name: 'Retry save' }))
  else if (kind === 'schedule') {
    for (const [label, value] of [
      ['Your name', contact.name],
      ['Email', contact.email],
      ['Phone', contact.phone],
      ['Preferred move date', contact.requestedDate],
    ])
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: 'Request this date' }))
  } else {
    fireEvent.click(screen.getByRole('button', { name: 'Choose movers' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /Synthetic Mover/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Send quote requests' }))
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
function api(handler?: (path: string, request?: RequestInit) => Promise<Response> | undefined) {
  const fetch = vi.fn(async (path: string, request?: RequestInit) => {
    const custom = handler?.(path, request)
    if (custom) return custom
    if (path === '/api/ai-status') return Response.json({ visionRevision: 99, visionFingerprint: 'current-vision' })
    if (path === '/api/price') return Response.json({ price })
    if (path === '/api/estimates') return Response.json({ id: 'saved-id', storage: 'memory' })
    if (path.endsWith('/contact'))
      return Response.json({ reference: 'saved-id', requestedDate: '2027-01-20', note: 'Requested' })
    if (path === '/api/movers') return Response.json({ movers: [mover] })
    if (path === '/api/quote-requests')
      return Response.json({
        requests: [
          {
            id: 'quote-1',
            estimateId: 'saved-id',
            moverId: 'mover-1',
            moverName: mover.name,
            note: '',
            status: 'logged',
            createdAt: '2026-11-16T12:00:00Z',
          },
        ],
        delivery: { 'mover-1': 'logged' },
      })
    if (path === '/api/analyze') return Response.json(analysis)
    if (path === '/api/conversation')
      return Response.json({
        reply: 'Thanks. Check the move manifest.',
        basedOnRevision: JSON.parse(request?.body as string).snapshot.revision,
        proposals: [],
      })
    throw new Error('Unexpected synthetic endpoint')
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}
function controlledUploads() {
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL() {
        return 'blob:controlled-upload'
      }
      static revokeObjectURL() {}
    },
  )
  vi.stubGlobal('createImageBitmap', undefined)
  const pending: (() => void)[] = []
  let number = 0
  class XHR {
    upload = { onprogress: null }
    status = 200
    responseText = ''
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    open() {}
    send() {
      const index = ++number
      this.responseText = JSON.stringify({
        uploads: [{ url: `https://example.test/selection-${index}.jpg`, receipt: `selection-receipt-${index}` }],
      })
      pending.push(() => this.onload?.())
    }
  }
  vi.stubGlobal('XMLHttpRequest', XHR)
  const select = () =>
    fireEvent.change(screen.getByLabelText('Choose from library'), {
      target: { files: [new File(['synthetic'], 'room.jpg', { type: 'image/jpeg' })] },
    })
  return { pending, select }
}
async function rebuildEstimate() {
  reopenStage(/Review move details/)
  fireEvent.click(screen.getByRole('button', { name: 'Confirm move details' }))
  fireEvent.click(screen.getByRole('button', { name: 'Analyse 1 photo' }))
  await waitFor(() => expect(draft().analysis).not.toBeNull())
  for (const label of ['Garage', 'Closets', 'Appliances'])
    fireEvent.click(within(screen.getByRole('group', { name: label })).getByRole('button', { name: 'No' }))
  fireEvent.click(within(screen.getByRole('group', { name: /whole move/i })).getByRole('button', { name: 'Yes' }))
  fireEvent.click(confirmPrice())
  await waitFor(() => expect(draft().estimateId).toBe('saved-id'))
}

beforeEach(() => {
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
})
afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('contextual conversation stages', () => {
  it('starts with a direct greeting and no bottom-of-feed card stack', () => {
    api()
    mount()
    expect(screen.queryByText(/roughly how far/i)).not.toBeInTheDocument()
    for (const name of ['Confirm move details', 'Conversation photos', 'Estimate confirmation', 'Date request'])
      expect(screen.queryByRole('region', { name })).not.toBeInTheDocument()
  })
  it('requests photos with accepted endpoints alone and does not enable pricing', () => {
    api()
    const state = createConversationSession()
    mount({
      ...state,
      moveDetails: { ...state.moveDetails, from: 'Tel Aviv', to: 'Raanana' },
      nextAction: 'request_photos',
    })
    expect(screen.getByRole('region', { name: 'Conversation photos' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Confirm move details' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Estimate confirmation' })).not.toBeInTheDocument()
  })
  it('collapses completed photos and review into reachable summaries', () => {
    api()
    mount(ready())
    expect(screen.queryByRole('region', { name: 'Conversation photos' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Inventory questions' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Reopen photos/i }))
    expect(screen.getByRole('region', { name: 'Conversation photos' })).toBeInTheDocument()
  })
  it('keeps incomplete review visible despite a model photo action', () => {
    api()
    mount(ready({ nextAction: 'request_photos', wholeMoveCovered: null }))
    expect(screen.getByRole('region', { name: 'Inventory questions' })).toBeInTheDocument()
  })
  it('honors a genuine endpoint clarification without gating upload-first photo decisions', () => {
    api()
    const state = createConversationSession()
    mount({
      ...state,
      moveDetails: { ...state.moveDetails, from: 'Springfield', to: 'Boston' },
      nextAction: 'clarify_origin',
    })
    expect(screen.queryByRole('region', { name: 'Conversation photos' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Choose from library')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Move manifest' })).toBeInTheDocument()
  })
  it('distinguishes accepted date-window evidence from a pending exact-date proposal and replaces the single slot on Accept', () => {
    api()
    mount(
      ready({
        moveDetails: { ...ready().moveDetails, date: null },
        messages: [{ id: 'date-source', role: 'user', content: 'I meant 2027-01-11 instead of early January.' }],
        facts: [
          {
            field: 'dateWindow',
            sourceMessageId: 'date-source',
            wording: 'early January',
            uncertainty: 'uncertain',
            precision: 'window',
            correction: false,
          },
        ],
        pendingProposals: [
          {
            id: 'exact-date',
            expectedRevision: 0,
            command: {
              type: 'details.patch',
              patch: { date: '2027-01-11' },
              facts: [
                {
                  field: 'date',
                  sourceMessageId: 'date-source',
                  wording: '2027-01-11',
                  uncertainty: 'certain',
                  precision: 'exact',
                  correction: true,
                },
              ],
            },
          },
        ],
      }),
    )
    expect(screen.getByText(/Accepted date window.*early January/)).toBeInTheDocument()
    expect(screen.getByText('Suggested update — not yet accepted')).toBeInTheDocument()
    expect(screen.getByText('Move date: 2027-01-11')).toBeInTheDocument()
    expect(screen.getByLabelText('Move date')).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: 'Accept suggestion' }))
    expect(screen.queryByText(/Accepted date window/)).not.toBeInTheDocument()
    expect(screen.getByText(/Accepted date evidence: 2027-01-11/)).toBeInTheDocument()
    expect(screen.getByLabelText('Move date')).toHaveValue('2027-01-11')
  })
  it('supports ground floor zero in the shared panel', () => {
    api()
    mount()
    for (const label of ['Floor at origin', 'Floor at destination']) {
      expect(screen.getByLabelText(label)).toHaveAttribute('min', '0')
      fireEvent.change(screen.getByLabelText(label), { target: { value: '0' } })
    }
    expect(draft().moveDetails).toMatchObject({ originFloor: 0, destinationFloor: 0 })
  })
  it('shows readable pending proposals instead of command JSON', () => {
    api()
    const state = createConversationSession()
    mount({
      ...state,
      pendingProposals: [
        { id: 'pending', expectedRevision: 0, command: { type: 'details.patch', patch: { from: 'Tel Aviv' } } },
      ],
    })
    expect(screen.getByText('Moving from: Tel Aviv')).toBeInTheDocument()
    expect(document.querySelector('.conv-proposal')).toBeNull()
  })
})

describe('persistent estimator conversation', () => {
  it('keeps one feed/composer and shared manifest; mount, rerender and reload never POST', () => {
    const fetch = api()
    const view = mount(ready())
    const composer = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.change(composer, { target: { value: 'draft stays' } })
    expect(screen.getByRole('log', { name: 'Move conversation' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Progress' })).not.toBeInTheDocument()
    const panel = screen.getByRole('region', { name: 'Move manifest' })
    expect(panel.querySelector('input[type=file]')).toBeNull()
    expect(document.querySelectorAll('input[type=file]')).toHaveLength(2)
    fireEvent.change(within(panel).getByLabelText('Distance (miles)'), { target: { value: '42' } })
    expect(screen.getByRole('textbox', { name: 'Message' })).toBe(composer)
    expect(composer).toHaveValue('draft stays')
    expect(draft()).toMatchObject({ moveDetails: { distanceMiles: 42 }, analysis: null, price: null })
    view.unmount()
    mount()
    expect(
      fetch.mock.calls.filter(([, request]) => request?.method === 'POST' || request?.method === 'PATCH'),
    ).toHaveLength(0)
  })

  it('analyzes only explicitly and accepts the post-start revision, preserving the composer draft', async () => {
    const pending = deferred<Response>()
    const fetch = api((path) => (path === '/api/analyze' ? pending.promise : undefined))
    mount(ready())
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'still writing' } })
    reopenStage(/Reopen photos/)
    fireEvent.click(screen.getByRole('button', { name: 'Analyse again' }))
    expect(draft().analysis).toBeNull()
    expect(draft().revision).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: /analysing/i }))
    expect(fetch.mock.calls.filter(([path]) => path === '/api/analyze')).toHaveLength(1)
    await act(async () => pending.resolve(Response.json(analysis)))
    expect(draft().analysis).toEqual(analysis)
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('still writing')
    const body = JSON.parse(fetch.mock.calls.find(([path]) => path === '/api/analyze')?.[1]?.body as string)
    expect(body).toMatchObject({
      photoRefs: [{ url: 'https://example.test/room.jpg', receipt: 'test-receipt' }],
      moveDetails: { distanceMiles: 120 },
      sample: false,
    })
    expect(body).not.toHaveProperty('messages')
  })

  it('rejects late analysis and chat replies after a panel edit without losing the transcript or draft', async () => {
    const pending = deferred<Response>()
    const chat = deferred<Response>()
    api((path) => (path === '/api/analyze' ? pending.promise : path === '/api/conversation' ? chat.promise : undefined))
    mount(ready())
    reopenStage(/Reopen photos/)
    fireEvent.click(screen.getByRole('button', { name: 'Analyse again' }))
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'next draft' } })
    fireEvent.change(screen.getByLabelText('Distance (miles)'), { target: { value: '99' } })
    await act(async () => {
      pending.resolve(Response.json(analysis))
      chat.resolve(
        Response.json({
          reply: 'stale reply',
          basedOnRevision: 1,
          proposals: [
            {
              id: 'late-details',
              expectedRevision: 1,
              command: { type: 'details.patch', patch: { from: 'Stale origin' } },
            },
          ],
        }),
      )
    })
    expect(draft()).toMatchObject({ analysis: null, moveDetails: { distanceMiles: 99 } })
    expect(screen.queryByText('stale reply')).not.toBeInTheDocument()
    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.getByLabelText('Message')).toHaveValue('next draft')
    expect(screen.getByRole('alert')).toHaveTextContent(/changed|stale/i)
  })

  it('requires explicit confirmation, checks freshness, prices and saves once, then explicitly requests date and selected quotes', async () => {
    const fetch = api()
    mount(ready())
    const composer = screen.getByLabelText('Message')
    fireEvent.change(composer, { target: { value: 'keep this draft' } })
    fireEvent.click(confirmPrice())
    fireEvent.click(confirmPrice())
    await waitFor(() => expect(draft().estimateId).toBe('saved-id'))
    expect(fetch.mock.calls.filter(([path]) => path === '/api/price')).toHaveLength(1)
    expect(fetch.mock.calls.filter(([path]) => path === '/api/estimates')).toHaveLength(1)
    expect(screen.getByLabelText('Message')).toBe(composer)
    expect(composer).toHaveValue('keep this draft')
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Synthetic Customer' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'synthetic@example.test' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '555-0101' } })
    fireEvent.change(screen.getByLabelText('Preferred move date'), { target: { value: '2027-01-20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Request this date' }))
    await waitFor(() => expect(draft().scheduleResult?.status).toBe('requested'))
    expect(screen.getByText(/not a confirmed booking/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Choose movers' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /Synthetic Mover/i }))
    expect(fetch.mock.calls.filter(([path]) => path === '/api/quote-requests')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Send quote requests' }))
    await waitFor(() => expect(draft().quoteResult?.requests).toHaveLength(1))
    expect(fetch.mock.calls.filter(([path]) => path.endsWith('/contact'))).toHaveLength(1)
    expect(fetch.mock.calls.filter(([path]) => path === '/api/quote-requests')).toHaveLength(1)
    expect(screen.getByLabelText('Message')).toHaveValue('keep this draft')
  })

  it('distinguishes save failure and retries save without repricing; does not retry an interrupted write on reload', async () => {
    let saves = 0
    const fetch = api((path) =>
      path === '/api/estimates' && ++saves === 1
        ? Promise.resolve(Response.json({ error: 'Unavailable' }, { status: 503 }))
        : undefined,
    )
    const view = mount(ready())
    fireEvent.click(confirmPrice())
    expect(await screen.findByRole('alert')).toHaveTextContent(/save failed/i)
    expect(draft().price).toEqual(price)
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }))
    await waitFor(() => expect(draft().estimateId).toBe('saved-id'))
    expect(fetch.mock.calls.filter(([path]) => path === '/api/price')).toHaveLength(1)
    view.unmount()
    const saved = draft()
    saved.estimateId = null
    saved.operations.interrupted = {
      id: 'interrupted',
      revision: saved.revision,
      request: { kind: 'save' },
      status: 'pending',
    }
    mount(saved)
    expect(screen.getByText(/unknown outcome/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry save' })).not.toBeInTheDocument()
    expect(fetch.mock.calls.filter(([path]) => path === '/api/estimates')).toHaveLength(2)
  })

  it.each(
    writeCases.flatMap((write) =>
      ['pagehide abort', 'unmount abort', 'transport loss', 'response body loss', 'pagehide success'].map(
        (boundary) => ({
          ...write,
          boundary,
        }),
      ),
    ),
  )(
    'preserves unknown $kind evidence after $boundary without blind retry on reload',
    async ({ kind, path, boundary }) => {
      const pending = deferred<Response>()
      const fetch = api((endpoint) => (endpoint === path ? pending.promise : undefined))
      const view = mount(ready({ price, estimateId: kind === 'save' ? null : 'saved-id', contact }))
      await beginWrite(kind)
      await waitFor(() => expect(fetch.mock.calls.filter(([endpoint]) => endpoint === path)).toHaveLength(1))
      const operation = Object.values(draft().operations).find((entry) => entry.request.kind === kind)
      if (!operation) throw new Error('Explicit action did not start its write')
      expect(operation.status).toBe('pending')
      // Navigation can abort the transport before React unmounts the old document.
      if (boundary.startsWith('pagehide')) fireEvent(window, new Event('pagehide'))
      if (boundary === 'unmount abort') view.unmount()
      await act(async () => {
        if (boundary === 'pagehide success')
          pending.resolve(
            Response.json({
              id: 'saved-id',
              storage: 'memory',
              reference: 'saved-id',
              requestedDate: contact.requestedDate,
              requests: [
                {
                  id: 'quote-1',
                  estimateId: 'saved-id',
                  moverId: 'mover-1',
                  moverName: mover.name,
                  note: '',
                  status: 'logged',
                  createdAt: '2026-11-16T12:00:00Z',
                },
              ],
              delivery: { 'mover-1': 'logged' },
            }),
          )
        else if (boundary === 'response body loss') {
          const response = Response.json({})
          vi.spyOn(response, 'json').mockRejectedValue(new DOMException('Response interrupted', 'AbortError'))
          pending.resolve(response)
        } else
          pending.reject(
            boundary === 'transport loss'
              ? new TypeError('Failed to fetch')
              : new DOMException('Navigation', 'AbortError'),
          )
      })
      expect(draft().operations[operation.id].status).toBe('pending')
      const retry = screen.queryByRole('button', { name: `Retry ${kind}` })
      if (retry) expect(retry).toBeDisabled()
      if (boundary === 'transport loss' || boundary === 'response body loss')
        expect(screen.getByRole('alert')).toHaveTextContent(/unknown outcome/i)
      if (boundary.startsWith('pagehide')) {
        fireEvent(window, new Event('pageshow'))
        expect(screen.getByRole('alert')).toHaveTextContent(/unknown outcome/i)
      }
      if (boundary !== 'unmount abort') view.unmount()
      mount()
      expect(draft().operations[operation.id].status).toBe('interrupted')
      expect(screen.getByText(/interrupted — unknown outcome/i)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: `Retry ${kind}` })).not.toBeInTheDocument()
      if (kind !== 'save') await beginWrite(kind)
      expect(fetch.mock.calls.filter(([endpoint]) => endpoint === path)).toHaveLength(1)
    },
  )

  it.each(
    (['analyze', 'price'] as const).flatMap((kind) =>
      (['success', 'HTTP rejection', 'transport rejection'] as const).map((outcome) => ({ kind, outcome })),
    ),
  )('settles hidden $kind $outcome and restores explicit controls without saving', async ({ kind, outcome }) => {
    const pending = deferred<Response>()
    let attempts = 0
    const path = `/api/${kind}`
    const fetch = api((endpoint) => (endpoint === path && ++attempts === 1 ? pending.promise : undefined))
    mount(ready())
    const control = () => {
      if (kind === 'analyze') reopenStage(/Reopen photos/)
      return screen.getByRole('button', {
        name: kind === 'analyze' ? /^Analyse / : draft().price ? 'Retry save' : 'Confirm inventory and get estimate',
      })
    }
    fireEvent.click(control())
    await waitFor(() => expect(fetch.mock.calls.filter(([endpoint]) => endpoint === path)).toHaveLength(1))
    fireEvent(window, new Event('pagehide'))
    await act(async () => {
      if (outcome === 'transport rejection') pending.reject(new TypeError('Failed to fetch'))
      else
        pending.resolve(
          outcome === 'HTTP rejection'
            ? Response.json({ error: 'Unavailable' }, { status: 503 })
            : Response.json(kind === 'analyze' ? analysis : { price }),
        )
    })
    expect(Object.values(draft().operations).find((operation) => operation.request.kind === kind)?.status).toBe(
      outcome === 'success' ? 'succeeded' : 'failed',
    )
    fireEvent.click(control())
    expect(fetch.mock.calls.filter(([endpoint]) => endpoint === path)).toHaveLength(1)
    expect(fetch.mock.calls.filter(([endpoint]) => endpoint === '/api/estimates')).toHaveLength(0)
    fireEvent(window, new Event('pageshow'))
    expect(control()).toBeEnabled()
    expect(fetch.mock.calls.filter(([endpoint]) => endpoint === '/api/estimates')).toHaveLength(0)
    expect(draft().estimateId).toBeNull()
    if (outcome === 'success')
      expect(kind === 'analyze' ? draft().analysis : draft().price).toEqual(kind === 'analyze' ? analysis : price)
    fireEvent.click(control())
    await waitFor(() => {
      if (kind === 'price') expect(draft().estimateId).toBe('saved-id')
      else
        expect(
          Object.values(draft().operations).filter(
            (operation) => operation.request.kind === kind && operation.status === 'succeeded',
          ),
        ).toHaveLength(outcome === 'success' ? 2 : 1)
    })
    expect(fetch.mock.calls.filter(([endpoint]) => endpoint === '/api/estimates')).toHaveLength(
      kind === 'price' ? 1 : 0,
    )
  })

  it.each(['success', 'rejection'])('settles hidden mover loader %s and restores Choose movers', async (outcome) => {
    const pending = deferred<Response>()
    let attempts = 0
    const fetch = api((path) => (path === '/api/movers' && ++attempts === 1 ? pending.promise : undefined))
    mount(ready({ price, estimateId: 'saved-id', contact }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose movers' }))
    fireEvent(window, new Event('pagehide'))
    await act(async () => {
      if (outcome === 'success') pending.resolve(Response.json({ movers: [mover] }))
      else pending.reject(new TypeError('Failed to fetch'))
    })
    fireEvent.click(screen.getByRole('button', { name: 'Choose movers' }))
    expect(fetch.mock.calls.filter(([path]) => path === '/api/movers')).toHaveLength(1)
    fireEvent(window, new Event('pageshow'))
    expect(screen.getByRole('button', { name: 'Choose movers' })).toBeEnabled()
    if (outcome === 'success') expect(screen.getByRole('checkbox', { name: /Synthetic Mover/i })).toBeInTheDocument()
    else expect(screen.getByRole('alert')).toHaveTextContent(/Unable to load movers/i)
    fireEvent.click(screen.getByRole('button', { name: 'Choose movers' }))
    expect(await screen.findByRole('checkbox', { name: /Synthetic Mover/i })).not.toBeChecked()
    expect(fetch.mock.calls.filter(([path]) => path === '/api/movers')).toHaveLength(2)
    expect(
      fetch.mock.calls.filter(([, request]) => request?.method === 'POST' || request?.method === 'PATCH'),
    ).toHaveLength(0)
  })

  it.each(['preflight', 'price'])(
    'does not resume the %s-to-save chain across a pagehide/pageshow cycle',
    async (stage) => {
      const pending = deferred<Response>()
      let attempts = 0
      const path = stage === 'preflight' ? '/api/ai-status' : '/api/price'
      const fetch = api((endpoint) => (endpoint === path && ++attempts === 1 ? pending.promise : undefined))
      mount(ready())
      fireEvent.click(confirmPrice())
      await waitFor(() => expect(fetch.mock.calls.filter(([endpoint]) => endpoint === path)).toHaveLength(1))
      fireEvent(window, new Event('pagehide'))
      fireEvent(window, new Event('pageshow'))
      await act(async () =>
        pending.resolve(
          Response.json(
            stage === 'preflight' ? { visionRevision: 99, visionFingerprint: 'current-vision' } : { price },
          ),
        ),
      )
      expect(fetch.mock.calls.filter(([endpoint]) => endpoint === '/api/estimates')).toHaveLength(0)
      expect(fetch.mock.calls.filter(([endpoint]) => endpoint === '/api/price')).toHaveLength(stage === 'price' ? 1 : 0)
      expect(Object.values(draft().operations).every((operation) => operation.status !== 'pending')).toBe(true)
      fireEvent.click(stage === 'price' ? screen.getByRole('button', { name: 'Retry save' }) : confirmPrice())
      await waitFor(() => expect(draft().estimateId).toBe('saved-id'))
      expect(fetch.mock.calls.filter(([endpoint]) => endpoint === '/api/estimates')).toHaveLength(1)
      expect(fetch.mock.calls.filter(([endpoint]) => endpoint === '/api/price')).toHaveLength(1)
    },
  )

  it.each(['analysis', 'pricing', 'movers', 'chat'])('does not start %s while the page is leaving', async (kind) => {
    const fetch = api()
    mount(ready(kind === 'movers' ? { price, estimateId: 'saved-id', contact } : {}))
    if (kind === 'analysis') reopenStage(/Reopen photos/)
    fireEvent(window, new Event('pagehide'))
    await act(async () => {
      if (kind === 'analysis') {
        fireEvent.click(screen.getByRole('button', { name: 'Analyse again' }))
      } else if (kind === 'pricing') fireEvent.click(confirmPrice())
      else if (kind === 'movers') fireEvent.click(screen.getByRole('button', { name: 'Choose movers' }))
      else send('Synthetic hidden-page message')
    })
    expect(fetch.mock.calls).toHaveLength(0)
    expect(Object.values(draft().operations)).toHaveLength(0)
  })

  it('restores the composer after a pagehide-aborted reply without starting writes', async () => {
    const pending = deferred<Response>()
    const fetch = api((path, request) => {
      if (path !== '/api/conversation') return undefined
      request?.signal?.addEventListener('abort', () => pending.reject(new DOMException('Navigation', 'AbortError')))
      return pending.promise
    })
    mount(ready())
    send('Synthetic message before navigation')
    await act(async () => fireEvent(window, new Event('pagehide')))
    fireEvent(window, new Event('pageshow'))
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Synthetic return draft' } })
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
    expect(draft().messages.some((message) => message.content === 'Synthetic message before navigation')).toBe(true)
    expect(
      fetch.mock.calls.filter(([, request]) => request?.method === 'POST' || request?.method === 'PATCH'),
    ).toHaveLength(1)
  })

  it.each(writeCases)('keeps acknowledged $kind rejection explicitly retryable', async ({ kind, path }) => {
    let attempts = 0
    const fetch = api((endpoint) =>
      endpoint === path && ++attempts === 1
        ? Promise.resolve(Response.json({ error: 'Unavailable' }, { status: 503 }))
        : undefined,
    )
    mount(ready({ price, estimateId: kind === 'save' ? null : 'saved-id', contact }))
    await beginWrite(kind)
    await waitFor(() =>
      expect(Object.values(draft().operations).find((entry) => entry.request.kind === kind)?.status).toBe('failed'),
    )
    expect(fetch.mock.calls.filter(([endpoint]) => endpoint === path)).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: `Retry ${kind}` }))
    await waitFor(() =>
      expect(
        Object.values(draft().operations).some((entry) => entry.request.kind === kind && entry.status === 'succeeded'),
      ).toBe(true),
    )
    expect(fetch.mock.calls.filter(([endpoint]) => endpoint === path)).toHaveLength(2)
    expect(fetch.mock.calls.filter(([endpoint]) => endpoint === '/api/price')).toHaveLength(0)
  })

  it('does not save a late price after coverage edits', async () => {
    const pending = deferred<Response>()
    const fetch = api((path) => (path === '/api/price' ? pending.promise : undefined))
    mount(ready())
    fireEvent.click(confirmPrice())
    await waitFor(() => expect(fetch.mock.calls.some(([path]) => path === '/api/price')).toBe(true))
    reopenStage(/Reopen review/)
    fireEvent.click(within(screen.getByRole('group', { name: /whole move/i })).getByRole('button', { name: 'No' }))
    await act(async () => pending.resolve(Response.json({ price })))
    expect(draft()).toMatchObject({ wholeMoveCovered: false, price: null, estimateId: null })
    expect(fetch.mock.calls.some(([path]) => path === '/api/estimates')).toBe(false)
  })

  it.each(['check', 'price'])('blocks stale vision at %s, never saves, and retains conversation', async (stage) => {
    const fetch = api((path) => {
      if (stage === 'check' && path === '/api/ai-status')
        return Promise.resolve(Response.json({ visionRevision: 2, visionFingerprint: 'changed' }))
      if (stage === 'price' && path === '/api/price')
        return Promise.resolve(Response.json({ code: 'REANALYZE_REQUIRED' }, { status: 409 }))
      return undefined
    })
    mount(ready())
    fireEvent.click(confirmPrice())
    await screen.findByText(/analyze your photos again/i)
    expect(fetch.mock.calls.some(([path]) => path === '/api/estimates')).toBe(false)
    expect(screen.getByRole('log', { name: 'Move conversation' })).toBeInTheDocument()
    expect(screen.getByLabelText('Message')).toBeEnabled()
    if (stage === 'price') expect(draft().analysis).toBeNull()
  })

  it('keeps uncertain candidates separate, durable choices and duplicate/missing questions update the same inventory', async () => {
    api()
    const uncertain = {
      url: 'https://example.test/room.jpg',
      status: 'uncertain' as const,
      reason: 'Please check.',
      candidates: {
        items: [{ type: 'couch', count: 2 }],
        total_volume_cubic_feet: 160,
        estimated_boxes_min: 3,
        estimated_boxes_max: 5,
      },
    }
    const view = mount(
      ready({
        analysis: {
          ...analysis,
          items: [],
          totalVolumeCubicFeet: 0,
          estimatedBoxes: { min: 0, max: 0 },
          photoAssessments: [uncertain],
          possibleDuplicates: [{ item: 'sofa', count: 2 }],
        },
        items: [],
        followUps: { garage: null, closets: null, appliances: null },
        wholeMoveCovered: null,
      }),
    )
    expect(confirmPrice()).toBeDisabled()
    expect(screen.getByLabelText('Add something we missed')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Keep photo 1' }))
    expect(draft().items).toEqual([{ type: 'sofa', count: 2 }])
    fireEvent.click(screen.getByRole('button', { name: 'Same sofa' }))
    expect(draft().items).toEqual([{ type: 'sofa', count: 1 }])
    for (const key of ['Garage', 'Closets', 'Appliances'])
      fireEvent.click(within(screen.getByRole('group', { name: key })).getByRole('button', { name: 'No' }))
    fireEvent.click(within(screen.getByRole('group', { name: /whole move/i })).getByRole('button', { name: 'Yes' }))
    expect(confirmPrice()).toBeEnabled()
    view.unmount()
    mount()
    reopenStage(/Reopen photos/)
    expect(screen.getByRole('button', { name: 'Keep photo 1' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Keep photo 1' })).toBeDisabled()
    expect(draft().duplicateResolutions).toEqual({ sofa: 'same' })
    expect(draft().wholeMoveCovered).toBe(true)
  })

  it('applies multi-field chat details in one revision, preserves known partial details, and never acts on prose', async () => {
    const fetch = api((path) =>
      path === '/api/conversation'
        ? Promise.resolve(
            Response.json({
              reply: 'I saved and booked it. Get a price now.',
              basedOnRevision: 0,
              proposals: [
                {
                  id: 'details-1',
                  expectedRevision: 0,
                  command: {
                    type: 'details.patch',
                    patch: { to: 'Synthetic destination', date: '2027-01-01' },
                  },
                },
              ],
            }),
          )
        : undefined,
    )
    mount(
      ready({
        analysis: null,
        items: [],
        moveDetails: { ...createConversationSession().moveDetails, from: 'Synthetic origin' },
        detailsConfirmed: false,
      }),
    )
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'destination and date together' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(draft().moveDetails.to).toBe('Synthetic destination'))
    expect(draft().moveDetails).toMatchObject({
      from: 'Synthetic origin',
      to: 'Synthetic destination',
      date: '2027-01-01',
    })
    expect(draft().revision).toBe(1)
    expect(screen.getByText('What we know so far')).toBeInTheDocument()
    expect(screen.getByLabelText('Moving from')).toHaveValue('Synthetic origin')
    expect(screen.getByLabelText('Move date')).toHaveValue('2027-01-01')
    expect(fetch.mock.calls.filter(([path]) => path !== '/api/conversation')).toHaveLength(0)
    const request = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)
    expect(request.snapshot).toMatchObject({ version: 6, revision: 0, moveDetails: { from: 'Synthetic origin' } })
    expect(JSON.stringify(request.snapshot)).not.toContain('test-receipt')
    expect(JSON.stringify(request.snapshot)).not.toContain('example.test/room.jpg')
  })

  it('immediately fills the exact combined answer in the shared summary through one validated proposal', async () => {
    const fetch = api((path) =>
      path === '/api/conversation'
        ? Promise.resolve(
            Response.json(
              packet(
                [{ type: 'details.patch', patch: { from: 'Tel Aviv', to: 'Raanana', date: '2027-01-01' } }],
                0,
                'Please add photos of the rooms you are moving.',
              ),
              { headers: { 'x-movers-ai-mode': 'mock' } },
            ),
          )
        : undefined,
    )
    mount(createConversationSession())
    send('from Tel Aviv to Raanana on 1.1.2027')
    await screen.findByText('Please add photos of the rooms you are moving.')
    expect(screen.getByLabelText('Moving from')).toHaveValue('Tel Aviv')
    expect(screen.getByLabelText('Moving to')).toHaveValue('Raanana')
    expect(screen.getByLabelText('Move date')).toHaveValue('2027-01-01')
    expect(screen.getByText('What we know so far')).toBeInTheDocument()
    expect(screen.getByText('Demo data: AI is mocked locally')).toBeInTheDocument()
    expect(screen.getByText(/Move details updated in the shared manifest/)).toBeInTheDocument()
    expect(draft()).toMatchObject({
      revision: 1,
      pendingProposals: [],
      moveDetails: { from: 'Tel Aviv', to: 'Raanana', date: '2027-01-01', distanceMiles: null },
    })
    expect(draft().timeline.filter((entry) => entry.kind === 'event' && entry.event === 'proposal.added')).toHaveLength(
      1,
    )
    expect(new Set(draft().appliedActionIds).size).toBe(draft().appliedActionIds.length)
    expect(draft().appliedActionIds).not.toContain('suggestion-0')
    expect(fetch.mock.calls.map(([path]) => path)).toEqual(['/api/conversation'])
    const body = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)
    expect(Object.keys(body).sort()).toEqual(['messages', 'snapshot'])
  })

  it('sends already edited state and preserves omission while applying an explicit null correction', async () => {
    const fetch = api((path) =>
      path === '/api/conversation'
        ? Promise.resolve(Response.json(packet([{ type: 'details.patch', patch: { from: null } }], 1)))
        : undefined,
    )
    mount(ready())
    fireEvent.change(screen.getByLabelText('Moving to'), { target: { value: 'Edited destination' } })
    send('clear origin')
    await waitFor(() => expect(draft().moveDetails.from).toBeNull())
    expect(draft().moveDetails).toMatchObject({ to: 'Edited destination', distanceMiles: null })
    expect(draft().revision).toBe(2)
    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string).snapshot).toMatchObject({
      revision: 1,
      moveDetails: { to: 'Edited destination' },
    })
  })

  it.each([
    ['legacy payload', { reply: 'Rejected', moveDetails: { from: 'Untrusted' }, finished: true }],
    ['unknown field', { ...packet(), contact: { email: 'private@example.test' } }],
    ['malformed reply', { ...packet(), reply: '' }],
    ['wrong revision', packet([{ type: 'details.patch', patch: { from: 'Untrusted' } }], 9)],
    [
      'wrong proposal revision',
      {
        ...packet(),
        proposals: [
          { id: 'bad-revision', expectedRevision: 9, command: { type: 'details.patch', patch: { from: 'Untrusted' } } },
        ],
      },
    ],
    [
      'private patch',
      {
        ...packet(),
        proposals: [
          {
            id: 'private',
            expectedRevision: 0,
            command: { type: 'details.patch', patch: { from: 'Untrusted', receipt: 'private' } },
          },
        ],
      },
    ],
    [
      'invalid count',
      {
        ...packet(),
        proposals: [
          { id: 'bad-count', expectedRevision: 0, command: { type: 'item.count', itemType: 'sofa', count: 0 } },
        ],
      },
    ],
    ['invalid date', packet([{ type: 'details.patch', patch: { date: '2027-02-30' } }])],
    [
      'invalid reference after valid proposal',
      packet([
        { type: 'coverage.answer', answer: false },
        { type: 'item.remove', itemType: 'not-present' },
      ]),
    ],
    [
      'duplicate proposal ID',
      {
        ...packet(),
        proposals: [0, 1].map(() => ({
          id: 'same',
          expectedRevision: 0,
          command: { type: 'request.action', action: 'price' },
        })),
      },
    ],
    [
      'two details patches',
      packet([
        { type: 'details.patch', patch: { from: 'A' } },
        { type: 'details.patch', patch: { to: 'B' } },
      ]),
    ],
  ])('rejects %s atomically with retry guidance and no legacy fallback', async (_name, response) => {
    const fetch = api((path) => (path === '/api/conversation' ? Promise.resolve(Response.json(response)) : undefined))
    const state = ready()
    mount(state)
    send('synthetic answer')
    await screen.findByRole('button', { name: 'Retry reply' })
    expect(draft()).toMatchObject({
      revision: 0,
      moveDetails: state.moveDetails,
      items: state.items,
      pendingProposals: [],
      wholeMoveCovered: true,
    })
    expect(draft().messages.filter((message) => message.role === 'assistant')).toHaveLength(0)
    expect(fetch.mock.calls.map(([path]) => path)).toEqual(['/api/conversation'])
  })

  it.each<ConversationCommand>([
    { type: 'item.add', item: { type: 'chair', count: 1 } },
    { type: 'item.count', itemType: 'sofa', count: 2 },
    { type: 'item.remove', itemType: 'sofa' },
    { type: 'coverage.answer', answer: false },
    { type: 'followUp.answer', key: 'garage', answer: true },
    { type: 'photo.decide', photoId: 'photo-1', decision: 'exclude' },
    { type: 'duplicate.resolve', itemType: 'sofa', resolution: 'same' },
  ])('holds $type for explicit inline acceptance and supports dismissal', async (command) => {
    api((path) => (path === '/api/conversation' ? Promise.resolve(Response.json(packet([command]))) : undefined))
    const state = ready({
      analysis: {
        ...analysis,
        possibleDuplicates: [{ item: 'sofa', count: 2 }],
        photoAssessments:
          command.type === 'photo.decide'
            ? [{ url: 'https://example.test/room.jpg', status: 'uncertain', reason: 'Review' }]
            : [],
      },
    })
    mount(state)
    send('synthetic proposed change')
    await screen.findByRole('button', { name: 'Accept suggestion' })
    expect(draft()).toMatchObject({ revision: 0, items: state.items, wholeMoveCovered: true, photoDecisions: {} })
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss suggestion' }))
    expect(draft().pendingProposals).toHaveLength(0)
    expect(draft().revision).toBe(0)
    send('synthetic proposed change again')
    fireEvent.click(await screen.findByRole('button', { name: 'Accept suggestion' }))
    expect(draft().pendingProposals).toHaveLength(0)
    expect(draft().revision).toBe(1)
  })

  it.each(['accept', 'panel edit'] as const)(
    'visibly expires the remaining batch after %s without rebasing or automatic refresh',
    async (change) => {
      const fetch = api((path) =>
        path === '/api/conversation'
          ? Promise.resolve(
              Response.json(
                packet([
                  { type: 'item.count', itemType: 'sofa', count: 2 },
                  { type: 'coverage.answer', answer: false },
                ]),
              ),
            )
          : undefined,
      )
      mount(ready())
      send('change count and coverage')
      const [accept] = await screen.findAllByRole('button', { name: 'Accept suggestion' })
      if (!accept) throw new Error('Missing suggestion control')
      if (change === 'accept') fireEvent.click(accept)
      else fireEvent.change(screen.getByLabelText('Distance (miles)'), { target: { value: '42' } })
      expect(screen.getByText(/suggestions expired/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Refresh suggestions' })).toBeEnabled()
      expect(screen.queryByRole('button', { name: 'Accept suggestion' })).not.toBeInTheDocument()
      expect(draft().wholeMoveCovered).toBe(change === 'accept' ? true : null)
      expect(fetch.mock.calls.map(([path]) => path)).toEqual(['/api/conversation'])
    },
  )

  it.each(['analyze', 'price', 'schedule', 'quotes'] as const)(
    'accepting a %s action hint and prose never executes an operation',
    async (action) => {
      const fetch = api((path) =>
        path === '/api/conversation'
          ? Promise.resolve(
              Response.json(
                packet(
                  [{ type: 'request.action', action }],
                  0,
                  'Untrusted prose claiming a saved estimate and requested date.',
                ),
              ),
            )
          : undefined,
      )
      mount(ready())
      send(`please ${action}`)
      fireEvent.click(await screen.findByRole('button', { name: 'Accept suggestion' }))
      expect(draft().requestedAction).toBe(action)
      expect(draft()).toMatchObject({
        revision: 0,
        price: null,
        estimateId: null,
        scheduleResult: null,
        quoteResult: null,
        operations: {},
      })
      expect(screen.getByText(/use the explicit.*control/i)).toBeInTheDocument()
      expect(fetch.mock.calls.map(([path]) => path)).toEqual(['/api/conversation'])
    },
  )

  it('keeps a mixed detail/action batch pending until acceptance and expires its remaining suggestion', async () => {
    const fetch = api((path) =>
      path === '/api/conversation'
        ? Promise.resolve(
            Response.json(
              packet([
                { type: 'details.patch', patch: { from: 'New origin' } },
                { type: 'request.action', action: 'analyze' },
              ]),
            ),
          )
        : undefined,
    )
    mount(ready())
    send('change origin and analyze')
    const [accept] = await screen.findAllByRole('button', { name: 'Accept suggestion' })
    if (!accept) throw new Error('Missing suggestion control')
    expect(draft().moveDetails.from).toBe('Boston, MA')
    expect(draft().revision).toBe(0)
    fireEvent.click(accept)
    expect(draft().moveDetails.from).toBe('New origin')
    expect(draft().requestedAction).toBeNull()
    expect(screen.getByText(/suggestions expired/i)).toBeInTheDocument()
    expect(fetch.mock.calls.map(([path]) => path)).toEqual(['/api/conversation'])
  })

  it('retrying a reply keeps its user message once and leaves a pending explicit analysis intact', async () => {
    const pending = deferred<Response>()
    let replies = 0
    const fetch = api((path) => {
      if (path === '/api/analyze') return pending.promise
      if (path === '/api/conversation')
        return Promise.resolve(
          ++replies === 1
            ? Response.json({ error: 'Unavailable', retryable: true }, { status: 502 })
            : Response.json(packet([], 1, 'Use the existing analysis control.')),
        )
      return undefined
    })
    mount(ready())
    reopenStage(/Reopen photos/)
    fireEvent.click(screen.getByRole('button', { name: 'Analyse again' }))
    send('synthetic question during analysis')
    const operations = draft().operations
    fireEvent.click(await screen.findByRole('button', { name: 'Retry reply' }))
    await screen.findByText('Use the existing analysis control.')
    expect(draft().operations).toEqual(operations)
    expect(draft().messages.filter((message) => message.role === 'user')).toHaveLength(1)
    expect(fetch.mock.calls.filter(([path]) => path === '/api/analyze')).toHaveLength(1)
    const requests = fetch.mock.calls
      .filter(([path]) => path === '/api/conversation')
      .map(([, request]) => JSON.parse(request?.body as string))
    expect(requests).toHaveLength(2)
    expect(requests[0]).toEqual(requests[1])
    await act(async () => pending.resolve(Response.json(analysis)))
    expect(draft().analysis).toEqual(analysis)
  })

  it.each(['Retry reply', 'Refresh suggestions'] as const)(
    '%s does not reauthorize a failed old answer after panel edits, even when its new packet matches the current revision',
    async (control) => {
      let attempts = 0
      const fetch = api((path, request) => {
        if (path !== '/api/conversation') return undefined
        attempts += 1
        if (attempts === 1)
          return Promise.resolve(Response.json({ error: 'Unavailable', retryable: true }, { status: 502 }))
        const revision = JSON.parse(request?.body as string).snapshot.revision
        // A current-revision, well-formed response can still describe an old submitted command.
        return Promise.resolve(
          Response.json(
            packet(
              [{ type: 'details.patch', patch: { from: 'Tel Aviv', to: 'Raanana', date: '2027-01-01' } }],
              revision,
              'Review this extracted answer.',
            ),
          ),
        )
      })
      const state = createConversationSession()
      if (control === 'Refresh suggestions')
        state.pendingProposals = [
          {
            id: 'earlier-suggestion',
            expectedRevision: 0,
            command: { type: 'request.action', action: 'analyze' },
          },
        ]
      mount(state)
      send('from Tel Aviv to Raanana on 1.1.2027')
      await screen.findByRole('button', { name: 'Retry reply' })
      fireEvent.change(screen.getByLabelText('Moving from'), { target: { value: 'Haifa' } })
      fireEvent.change(screen.getByLabelText('Moving to'), { target: { value: 'Jerusalem' } })
      fireEvent.change(screen.getByLabelText('Move date'), { target: { value: '2028-02-02' } })
      const revision = draft().revision
      fireEvent.click(screen.getByRole('button', { name: control }))
      await screen.findByText('Review this extracted answer.')
      expect(draft()).toMatchObject({
        revision,
        moveDetails: { from: 'Haifa', to: 'Jerusalem', date: '2028-02-02' },
        operations: {},
      })
      expect(screen.getByLabelText('Moving from')).toHaveValue('Haifa')
      expect(screen.getByLabelText('Moving to')).toHaveValue('Jerusalem')
      expect(screen.getByLabelText('Move date')).toHaveValue('2028-02-02')
      expect(draft().messages.filter((message) => message.role === 'user')).toHaveLength(1)
      const requests = fetch.mock.calls.map(([path, request]) => ({ path, body: JSON.parse(request?.body as string) }))
      expect(requests.map(({ path }) => path)).toEqual(['/api/conversation', '/api/conversation'])
      expect(requests[1]?.body.snapshot).toMatchObject({
        revision,
        moveDetails: { from: 'Haifa', to: 'Jerusalem', date: '2028-02-02' },
      })
      expect(requests[1]?.body.messages).toEqual(requests[0]?.body.messages)
      expect(draft().pendingProposals).toMatchObject([
        { expectedRevision: revision, command: { type: 'details.patch' } },
      ])
      fireEvent.click(screen.getByRole('button', { name: 'Accept suggestion' }))
      expect(draft()).toMatchObject({
        revision: revision + 1,
        pendingProposals: [],
        moveDetails: { from: 'Tel Aviv', to: 'Raanana', date: '2027-01-01' },
        operations: {},
      })
      expect(fetch).toHaveBeenCalledTimes(2)
    },
  )

  it('allows a failed combined answer to autoapply on retry only while its original submitted revision is unchanged', async () => {
    let attempts = 0
    const fetch = api((path) =>
      path === '/api/conversation'
        ? Promise.resolve(
            ++attempts === 1
              ? Response.json({ error: 'Unavailable', retryable: true }, { status: 502 })
              : Response.json(
                  packet(
                    [{ type: 'details.patch', patch: { from: 'Tel Aviv', to: 'Raanana', date: '2027-01-01' } }],
                    0,
                    'Please add photos of the rooms you are moving.',
                  ),
                ),
          )
        : undefined,
    )
    mount(createConversationSession())
    send('from Tel Aviv to Raanana on 1.1.2027')
    fireEvent.click(await screen.findByRole('button', { name: 'Retry reply' }))
    await screen.findByText('Please add photos of the rooms you are moving.')
    expect(draft()).toMatchObject({
      revision: 1,
      pendingProposals: [],
      moveDetails: { from: 'Tel Aviv', to: 'Raanana', date: '2027-01-01' },
      operations: {},
    })
    expect(draft().messages.filter((message) => message.role === 'user')).toHaveLength(1)
    expect(fetch.mock.calls.map(([path]) => path)).toEqual(['/api/conversation', '/api/conversation'])
  })

  it('validates packets at adapter ingress while leaving legacy chatApi compatible', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...packet(), receipt: 'private' }))
      .mockResolvedValueOnce(Response.json({ reply: 'legacy', moveDetails: {}, finished: false }))
    vi.stubGlobal('fetch', fetch)
    await expect(conversationChatApi([], conversationSnapshot(ready()))).rejects.toThrow()
    await expect(chatApi([])).resolves.toMatchObject({ reply: 'legacy', finished: false })
    expect(fetch.mock.calls.map(([path]) => path)).toEqual(['/api/conversation', '/api/chat'])
  })

  it('blocks pricing while a selected photo is still uploading and supports failure/retry/removal without losing chat', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL() {
          return 'blob:test-upload'
        }
        static revokeObjectURL() {}
      },
    )
    vi.stubGlobal('createImageBitmap', undefined)
    let uploads = 0
    const pending: { finish: () => void }[] = []
    class XHR {
      upload = { onprogress: null }
      status = 200
      responseText = JSON.stringify({ uploads: [{ url: 'https://example.test/new.jpg', receipt: 'new-receipt' }] })
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      open() {}
      send() {
        const attempt = ++uploads
        pending.push({
          finish: () => {
            if (attempt === 1) this.onerror?.()
            else this.onload?.()
          },
        })
      }
    }
    vi.stubGlobal('XMLHttpRequest', XHR)
    const fetch = api()
    mount(ready())
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'upload draft' } })
    fireEvent.change(screen.getByLabelText('Choose from library'), {
      target: { files: [new File(['synthetic'], 'room.jpg', { type: 'image/jpeg' })] },
    })
    await waitFor(() => expect(pending).toHaveLength(1))
    expect(confirmPrice()).toBeDisabled()
    await act(async () => pending[0]?.finish())
    expect(draft().photos).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Retry upload' }))
    await waitFor(() => expect(pending).toHaveLength(2))
    await act(async () => pending[1]?.finish())
    expect(draft()).toMatchObject({
      analysis: null,
      price: null,
      photoRefs: [
        { url: 'https://example.test/room.jpg', receipt: 'test-receipt' },
        { url: 'https://example.test/new.jpg', receipt: 'new-receipt' },
      ],
    })
    fireEvent.click(
      within(screen.getByAltText('new.jpg').closest('li') as HTMLElement).getByRole('button', { name: 'Remove' }),
    )
    expect(draft().photos).toHaveLength(1)
    expect(screen.getByLabelText('Message')).toHaveValue('upload draft')
    expect(fetch.mock.calls).toHaveLength(0)
  })

  it.each(['keep', 'exclude'] as const)(
    'prices only accepted %s candidate totals and evidence, not raw analysis',
    async (decision) => {
      const fetch = api()
      const candidate = {
        url: 'https://example.test/extra.jpg',
        status: 'uncertain' as const,
        reason: 'Check this photo.',
        candidates: {
          items: [{ type: 'couch', count: 2 }],
          total_volume_cubic_feet: 160,
          estimated_boxes_min: 3,
          estimated_boxes_max: 5,
        },
      }
      mount(
        ready({
          photos: [...ready().photos, { id: 'extra', url: candidate.url, receipt: 'extra-receipt' }],
          photoUrls: [...ready().photoUrls, candidate.url],
          photoRefs: [...ready().photoRefs, { url: candidate.url, receipt: 'extra-receipt' }],
          analysis: { ...analysis, photoAssessments: [candidate] },
        }),
      )
      fireEvent.click(screen.getByRole('button', { name: `${decision === 'keep' ? 'Keep' : 'Exclude'} photo 2` }))
      for (const key of ['Garage', 'Closets', 'Appliances'])
        fireEvent.click(within(screen.getByRole('group', { name: key })).getByRole('button', { name: 'No' }))
      fireEvent.click(within(screen.getByRole('group', { name: /whole move/i })).getByRole('button', { name: 'Yes' }))
      fireEvent.click(confirmPrice())
      await waitFor(() => expect(draft().estimateId).toBe('saved-id'))
      const payload = JSON.parse(fetch.mock.calls.find(([path]) => path === '/api/price')?.[1]?.body as string)
      expect(payload).toMatchObject({
        analysis: {
          items: [{ type: 'sofa', count: decision === 'keep' ? 3 : 1 }],
          totalVolumeCubicFeet: decision === 'keep' ? 240 : 80,
          estimatedBoxes: decision === 'keep' ? { min: 5, max: 9 } : { min: 2, max: 4 },
        },
        review: { photoEvidence: { unresolvedCount: 0, excludedCount: decision === 'keep' ? 0 : 1 } },
      })
      expect(draft().analysis?.items).toEqual([{ type: 'sofa', count: 1 }])
    },
  )

  it('keeps uncertain-only inventory empty until all decisions resolve, then blocks exclude-all across reload until an explicit add', () => {
    const fetch = api()
    const photos = [
      { id: 'a', url: 'https://example.test/a.jpg', receipt: 'a-receipt' },
      { id: 'b', url: 'https://example.test/b.jpg', receipt: 'b-receipt' },
    ]
    const view = mount(
      ready({
        photos,
        photoUrls: photos.map((photo) => photo.url),
        photoRefs: photos.map(({ url, receipt }) => ({ url, receipt })),
        analysis: {
          ...analysis,
          items: [],
          totalVolumeCubicFeet: 0,
          estimatedBoxes: { min: 0, max: 0 },
          photoAssessments: photos.map((photo) => ({
            url: photo.url,
            status: 'uncertain',
            reason: 'Check.',
            candidates: { items: [{ type: 'table', count: 1 }], total_volume_cubic_feet: 20 },
          })),
        },
        items: [],
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Exclude photo 1' }))
    expect(draft().items).toEqual([])
    expect(screen.getByLabelText('Add something we missed')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Exclude photo 2' }))
    expect(draft().items).toEqual([])
    expect(confirmPrice()).toBeDisabled()
    view.unmount()
    mount()
    expect(confirmPrice()).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Add something we missed'), { target: { value: 'table' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true }))
    expect(draft().items).toEqual([{ type: 'table', count: 1 }])
    reopenStage(/Reopen photos/)
    expect(screen.getByRole('button', { name: 'Keep photo 1' })).toBeDisabled()
    expect(fetch.mock.calls).toHaveLength(0)
  })

  it.each(['request_failed', 'photo_link_failed'])(
    'retains sanitized %s analysis failure evidence on reload, then clears it only after accepted retry',
    async (code) => {
      const pending = deferred<Response>()
      let tries = 0
      const fetch = api((path) =>
        path === '/api/analyze'
          ? ++tries === 1
            ? Promise.resolve(
                Response.json(
                  {
                    code:
                      code === 'photo_link_failed'
                        ? 'PHOTO_REUPLOAD_REQUIRED'
                        : code === 'reanalyze_required'
                          ? 'REANALYZE_REQUIRED'
                          : 'NO_USABLE_PHOTOS',
                    photoAssessments: [
                      {
                        url: 'https://example.test/room.jpg',
                        status: 'uncertain',
                        reason: 'Check this room.',
                        candidates: { items: [], total_volume_cubic_feet: 0 },
                      },
                    ],
                  },
                  { status: 400 },
                ),
              )
            : pending.promise
          : undefined,
      )
      const view = mount(ready({ price, estimateId: 'old-id' }))
      reopenStage(/Reopen photos/)
      fireEvent.click(screen.getByRole('button', { name: 'Analyse again' }))
      await screen.findByText(/Photo 1: Check this room/)
      expect(draft()).toMatchObject({ analysis: null, items: [], price: null, estimateId: null, photoDecisions: {} })
      expect(draft().failedPhotoAssessments[0]).not.toHaveProperty('candidates')
      expect(Object.values(draft().operations).at(-1)?.errorCode).toBe(code)
      expect(screen.queryByRole('button', { name: 'Keep photo 1' })).not.toBeInTheDocument()
      view.unmount()
      mount()
      expect(screen.getByText(/Photo 1: Check this room/)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Analyse 1 photo' }))
      expect(screen.getByText(/Photo 1: Check this room/)).toBeInTheDocument()
      await act(async () => pending.resolve(Response.json(analysis)))
      expect(draft()).toMatchObject({
        analysis,
        failedPhotoAssessments: [],
        photoDecisions: {},
        followUps: { garage: null, closets: null, appliances: null },
        wholeMoveCovered: null,
      })
      expect(fetch.mock.calls.some(([path]) => path === '/api/price' || path === '/api/estimates')).toBe(false)
    },
  )

  it.each(['details', 'photos'])('clears durable failure reasons and evidence after %s changes', (change) => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    api()
    mount(
      ready({
        failedPhotoAssessments: [
          { url: 'https://example.test/room.jpg', status: 'unrelated', reason: 'No inventory.' },
        ],
        price,
        estimateId: 'old-id',
      }),
    )
    if (change === 'details') fireEvent.change(screen.getByLabelText('Moving from'), { target: { value: '' } })
    else {
      reopenStage(/Reopen photos/)
      fireEvent.click(
        within(screen.getByRole('list', { name: 'Selected photos' })).getByRole('button', { name: 'Remove' }),
      )
    }
    expect(draft()).toMatchObject({
      failedPhotoAssessments: [],
      analysis: null,
      items: [],
      photoDecisions: {},
      price: null,
      estimateId: null,
      followUps: { garage: null, closets: null, appliances: null },
      wholeMoveCovered: null,
    })
    if (change === 'details') expect(draft().moveDetails.from).toBeNull()
    expect(screen.queryByText(/Photo 1: No inventory/)).not.toBeInTheDocument()
  })

  it('uses the shared alias/count/add/remove commands and locks photo decisions after inventory edits', () => {
    api()
    mount(
      ready({
        items: [
          { type: 'Couch', count: 1 },
          { type: 'Sofa', count: 5 },
          { type: 'piano', count: 2 },
        ],
        price,
        estimateId: 'old-id',
        analysis: { ...analysis, specialHandling: [{ item: 'couch', reason: 'Needs extra movers' }] },
      }),
    )
    expect(screen.getByLabelText('sofa count')).toHaveTextContent('6')
    expect(screen.queryByLabelText('Couch count')).not.toBeInTheDocument()
    expect(screen.getByText('couch: Needs extra movers')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Add something we missed'), { target: { value: 'couch' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(draft().items).toEqual([
      { type: 'sofa', count: 7 },
      { type: 'piano', count: 2 },
    ])
    fireEvent.click(screen.getByRole('button', { name: 'One more sofa' }))
    expect(draft().items[0]?.count).toBe(8)
    fireEvent.click(screen.getByRole('button', { name: 'One fewer sofa' }))
    expect(draft().items[0]?.count).toBe(7)
    fireEvent.click(within(screen.getByLabelText('sofa count')).getByRole('button', { name: 'Remove' }))
    expect(draft()).toMatchObject({
      items: [{ type: 'piano', count: 2 }],
      price: null,
      estimateId: null,
      photoDecisionsLocked: true,
    })
  })

  it.each(['success', 'failure', 'stale'])(
    'revalidates restored saved estimates on explicit date request (%s), never on mount',
    async (result) => {
      const pending = deferred<Response>()
      const fetch = api((path) => (path === '/api/ai-status' ? pending.promise : undefined))
      mount(ready({ price, estimateId: 'saved-id' }))
      expect(fetch.mock.calls).toHaveLength(0)
      for (const [label, value] of [
        ['Your name', 'Synthetic'],
        ['Email', 'synthetic@example.test'],
        ['Phone', '555-0101'],
        ['Preferred move date', '2027-01-20'],
      ])
        fireEvent.change(screen.getByLabelText(label ?? ''), { target: { value } })
      fireEvent.click(screen.getByRole('button', { name: 'Request this date' }))
      expect(screen.getByRole('button', { name: 'Request this date' })).toBeDisabled()
      expect(fetch.mock.calls.some(([path]) => path.endsWith('/contact'))).toBe(false)
      await act(async () =>
        pending.resolve(
          result === 'failure'
            ? Response.json({}, { status: 503 })
            : Response.json({
                visionRevision: 100,
                visionFingerprint: result === 'stale' ? 'changed' : 'current-vision',
              }),
        ),
      )
      if (result === 'success') expect(draft().scheduleResult?.status).toBe('requested')
      else {
        expect(draft().scheduleResult).toBeNull()
        expect(screen.getByRole('alert')).toHaveTextContent(
          result === 'stale' ? /analyze your photos again/i : /unable to check/i,
        )
      }
      expect(fetch.mock.calls.some(([path]) => path === '/api/price' || path === '/api/estimates')).toBe(false)
    },
  )

  it('retries a failed reply without double-adding the user message, and cancellation ignores a late reply', async () => {
    let replies = 0
    const late = deferred<Response>()
    api((path) =>
      path === '/api/conversation'
        ? ++replies === 1
          ? Promise.resolve(Response.json({}, { status: 503 }))
          : replies === 2
            ? Promise.resolve(Response.json({ reply: 'Recovered', basedOnRevision: 0, proposals: [] }))
            : late.promise
        : undefined,
    )
    mount(ready())
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Retry reply' }))
    await screen.findByText('Recovered')
    expect(draft().messages.filter((message) => message.role === 'user')).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'another' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel reply' }))
    await act(async () => late.resolve(Response.json({ reply: 'Too late', basedOnRevision: 0, proposals: [] })))
    expect(screen.queryByText('Too late')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Message')).toBeEnabled()
  })

  it('uploads at most ten selected photos, keeps receipts, and never resurrects a removed pending upload', async () => {
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL() {
          return 'blob:batch'
        }
        static revokeObjectURL() {}
      },
    )
    vi.stubGlobal('createImageBitmap', undefined)
    const pending: (() => void)[] = []
    let count = 0
    class XHR {
      upload = { onprogress: null }
      status = 200
      responseText = ''
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      open() {}
      send() {
        const number = ++count
        this.responseText = JSON.stringify({
          uploads: [{ url: `https://example.test/batch-${number}.jpg`, receipt: `receipt-${number}` }],
        })
        pending.push(() => this.onload?.())
      }
    }
    vi.stubGlobal('XMLHttpRequest', XHR)
    api()
    mount(ready({ photos: [], photoRefs: [], photoUrls: [], analysis: null, items: [] }))
    fireEvent.change(screen.getByLabelText('Choose from library'), {
      target: {
        files: Array.from(
          { length: 11 },
          (_, index) => new File(['synthetic'], `room-${index}.jpg`, { type: 'image/jpeg' }),
        ),
      },
    })
    await waitFor(() => expect(pending).toHaveLength(10))
    fireEvent.click(
      within(screen.getByRole('list', { name: 'Selected photos' }).firstElementChild as HTMLElement).getByRole(
        'button',
        { name: 'Remove' },
      ),
    )
    await act(async () => {
      for (const finish of pending) finish()
    })
    expect(draft().photos).toHaveLength(9)
    expect(draft().photoRefs.every((ref) => !!ref.receipt)).toBe(true)
    expect(draft().photoUrls).not.toContain('https://example.test/batch-1.jpg')
    expect(screen.getByLabelText('Message')).toBeInTheDocument()
  })

  it('preserves history and trailing-card reader positions and measures short visual viewports without outer scrolling', async () => {
    const viewport = Object.assign(new EventTarget(), { height: 420, offsetTop: 0 })
    vi.stubGlobal('visualViewport', viewport)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const log = document.querySelector('.conv-feed')
      return { top: this.hasAttribute('data-conversation-anchor') ? 1140 - (log?.scrollTop ?? 0) : 140 } as DOMRect
    })
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(3000)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200)
    api()
    mount(
      ready({
        messages: Array.from({ length: 80 }, (_, index) => ({
          id: `message-${index}`,
          role: 'user',
          content: `Synthetic message ${index}`,
        })),
        items: Array.from({ length: 50 }, (_, index) => ({ type: `synthetic item ${index}`, count: 1 })),
      }),
    )
    const log = screen.getByRole('log', { name: 'Move conversation' })
    expect(within(log).getByText('Synthetic message 79')).toBeInTheDocument()
    const scroll = vi.mocked(log.scrollTo)
    const outer = vi.spyOn(window, 'scrollTo')
    expect(screen.getByRole('main').style.getPropertyValue('--est-chat-height')).toBe('280px')
    log.scrollTop = 100
    fireEvent.scroll(log)
    scroll.mockClear()
    fireEvent.change(screen.getByLabelText('Distance (miles)'), { target: { value: '50' } })
    expect(scroll).not.toHaveBeenCalled()
    log.scrollTop = 2790
    fireEvent.scroll(log)
    fireEvent.change(screen.getByLabelText('Distance (miles)'), { target: { value: '51' } })
    expect(log.scrollTop).toBe(2790)
    expect(scroll).not.toHaveBeenCalled()
    expect(outer).not.toHaveBeenCalled()
    viewport.height = 300
    fireEvent(viewport, new Event('resize'))
    expect(screen.getByRole('main').style.getPropertyValue('--est-chat-height')).toBe('160px')
  })

  it('does not discard a pending write through Start over or permit another save', async () => {
    const pending = deferred<Response>()
    const fetch = api((path) => (path === '/api/estimates' ? pending.promise : undefined))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mount(ready())
    const sessionId = draft().sessionId
    fireEvent.click(confirmPrice())
    await waitFor(() => expect(fetch.mock.calls.some(([path]) => path === '/api/estimates')).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }))
    expect(draft().sessionId).toBe(sessionId)
    expect(screen.getByRole('alert')).toHaveTextContent(/finish|in progress/i)
    await act(async () => pending.resolve(Response.json({ id: 'saved-id', storage: 'memory' })))
    expect(draft().estimateId).toBe('saved-id')
    expect(fetch.mock.calls.filter(([path]) => path === '/api/estimates')).toHaveLength(1)
  })

  it('retains legacy excluded-photo linkage reasons without treating eligible links as relevance or exposing URLs', () => {
    api()
    mount(
      ready({
        analysis: {
          ...analysis,
          photoLinkStatuses: [
            { url: 'https://example.test/room.jpg', status: 'unlinked', reason: 'Re-upload this room.' },
          ],
        },
      }),
    )
    reopenStage(/Reopen photos/)
    expect(screen.getByText('Photo 1: Re-upload this room.')).toBeInTheDocument()
    expect(screen.queryByText(/https:\/\/example\.test/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Keep photo 1' })).not.toBeInTheDocument()
  })

  it.each(['preflight', 'price-result'] as const)(
    'blocks dependent writes when an attachment is selected during %s',
    async (phase) => {
      const pending = deferred<Response>()
      const fetch = api((path) =>
        (phase === 'preflight' ? path === '/api/ai-status' : path === '/api/price') ? pending.promise : undefined,
      )
      const { pending: uploads, select } = controlledUploads()
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      mount(ready())
      fireEvent.click(confirmPrice())
      await waitFor(() =>
        expect(
          fetch.mock.calls.some(([path]) => path === (phase === 'preflight' ? '/api/ai-status' : '/api/price')),
        ).toBe(true),
      )
      select()
      await waitFor(() => expect(uploads).toHaveLength(1))
      await act(async () =>
        pending.resolve(
          Response.json(phase === 'preflight' ? { visionRevision: 1, visionFingerprint: 'current-vision' } : { price }),
        ),
      )
      expect(fetch.mock.calls.filter(([path]) => path === '/api/price')).toHaveLength(phase === 'preflight' ? 0 : 1)
      expect(fetch.mock.calls.filter(([path]) => path === '/api/estimates')).toHaveLength(0)
      expect(screen.getByRole('alert')).toHaveTextContent(/pending uploads|finish.*uploads/i)
      expect(draft().estimateId).toBeNull()
    },
  )

  it.each([0, 1])('accepts receipts across overlapping upload selections, completion order %s first', async (first) => {
    const { pending, select } = controlledUploads()
    api()
    mount(ready({ analysis: null, items: [], photos: [], photoRefs: [], photoUrls: [] }))
    select()
    select()
    await waitFor(() => expect(pending).toHaveLength(2))
    await act(async () => pending[first]?.())
    await act(async () => pending[1 - first]?.())
    expect(draft().photos).toHaveLength(2)
    expect(
      draft()
        .photoRefs.map((ref) => ref.receipt)
        .sort(),
    ).toEqual(['selection-receipt-1', 'selection-receipt-2'])
    expect(screen.queryByRole('button', { name: 'Retry upload' })).not.toBeInTheDocument()
  })

  it('does not rebase an older upload cohort over unrelated edits or a newer selection', async () => {
    const { pending, select } = controlledUploads()
    api()
    mount(ready({ analysis: null, items: [], photos: [], photoRefs: [], photoUrls: [] }))
    select()
    select()
    await waitFor(() => expect(pending).toHaveLength(2))
    await act(async () => pending[0]?.())
    fireEvent.change(screen.getByLabelText('Distance (miles)'), { target: { value: '44' } })
    select()
    await waitFor(() => expect(pending).toHaveLength(3))
    await act(async () => pending[2]?.())
    await act(async () => pending[1]?.())
    expect(draft().photoRefs.map((ref) => ref.receipt)).toEqual(['selection-receipt-1', 'selection-receipt-3'])
    expect(draft().moveDetails.distanceMiles).toBe(44)
    expect(screen.getByRole('button', { name: 'Retry upload' })).toBeInTheDocument()
  })

  it.each([null, '2027-01-01'])(
    'uses the current accepted move date after pricing, not the mounted default %s',
    async (initialDate) => {
      const fetch = api((path, request) =>
        path.endsWith('/contact')
          ? Promise.resolve(
              Response.json({
                reference: 'saved-id',
                requestedDate: JSON.parse(request?.body as string).requestedDate,
                note: 'Requested',
              }),
            )
          : undefined,
      )
      mount(ready({ moveDetails: { ...ready().moveDetails, date: initialDate } }))
      fireEvent.change(screen.getByLabelText('Move date'), { target: { value: '2027-02-02' } })
      await rebuildEstimate()
      expect(screen.getByLabelText('Preferred move date')).toHaveValue('2027-02-02')
      for (const [label, value] of [
        ['Your name', 'Synthetic'],
        ['Email', 'synthetic@example.test'],
        ['Phone', '555-0101'],
      ])
        fireEvent.change(screen.getByLabelText(label ?? ''), { target: { value } })
      fireEvent.click(screen.getByRole('button', { name: 'Request this date' }))
      await waitFor(() => expect(draft().scheduleResult?.requestedDate).toBe('2027-02-02'))
      expect(
        JSON.parse(fetch.mock.calls.find(([path]) => path.endsWith('/contact'))?.[1]?.body as string).requestedDate,
      ).toBe('2027-02-02')
    },
  )

  it.each(['2027-01-20', ''])(
    'preserves an intentionally edited request date %s across accepted move-date changes',
    async (editedDate) => {
      const fetch = api()
      mount(ready({ price, estimateId: 'saved-id', moveDetails: { ...ready().moveDetails, date: '2027-01-01' } }))
      fireEvent.change(screen.getByLabelText('Preferred move date'), { target: { value: editedDate } })
      fireEvent.change(screen.getByLabelText('Move date'), { target: { value: '2027-02-02' } })
      await rebuildEstimate()
      expect(screen.getByLabelText('Preferred move date')).toHaveValue(editedDate)
      if (editedDate) {
        for (const [label, value] of [
          ['Your name', 'Synthetic'],
          ['Email', 'synthetic@example.test'],
          ['Phone', '555-0101'],
        ])
          fireEvent.change(screen.getByLabelText(label ?? ''), { target: { value } })
        fireEvent.click(screen.getByRole('button', { name: 'Request this date' }))
        await waitFor(() => expect(draft().scheduleResult?.requestedDate).toBe('2027-01-20'))
        expect(
          JSON.parse(fetch.mock.calls.find(([path]) => path.endsWith('/contact'))?.[1]?.body as string).requestedDate,
        ).toBe(editedDate)
      }
    },
  )

  it.each(['fresh', 'long-history', 'review-cards'] as const)(
    'follows the readable conversation anchor instead of trailing cards in %s',
    async (context) => {
      const pending = deferred<Response>()
      api((path) => (path === '/api/conversation' ? pending.promise : undefined))
      vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(5000)
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300)
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
        const log = document.querySelector('.conv-feed')
        const top = this.hasAttribute('data-conversation-anchor')
          ? (this.textContent?.includes('New synthetic reply')
              ? 1800
              : this.textContent?.includes('New synthetic question')
                ? 1600
                : context === 'fresh'
                  ? 0
                  : 1000) -
            (log?.scrollTop ?? 0) +
            20
          : 20
        return { top } as DOMRect
      })
      Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
        configurable: true,
        value: vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
          this.scrollTop = options.top ?? 0
          this.dispatchEvent(new Event('scroll'))
        }),
      })
      mount(
        context === 'fresh'
          ? createConversationSession()
          : ready({
              messages: Array.from({ length: 80 }, (_, index) => ({
                id: `history-${index}`,
                role: index === 79 ? 'assistant' : 'user',
                content: `History ${index}`,
              })),
              ...(context === 'review-cards'
                ? {
                    analysis: {
                      ...analysis,
                      unseenAreas: Array.from({ length: 20 }, (_, index) => `Unseen area ${index}`),
                    },
                  }
                : {}),
            }),
      )
      const log = screen.getByRole('log', { name: 'Move conversation' })
      const composer = screen.getByLabelText('Message')
      expect(log.scrollTop).toBe(context === 'fresh' ? 0 : 1000)
      fireEvent.change(composer, { target: { value: 'New synthetic question' } })
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
      expect(log.scrollTop).toBe(1600)
      await act(async () =>
        pending.resolve(
          Response.json({ reply: 'New synthetic reply', basedOnRevision: draft().revision, proposals: [] }),
        ),
      )
      expect(log.scrollTop).toBe(1800)
      expect(screen.getByText('New synthetic reply')).toBeInTheDocument()
      expect(screen.getByLabelText('Message')).toBe(composer)
      expect(screen.queryByRole('region', { name: 'Conversation photos' })).not.toBeInTheDocument()
      if (context !== 'fresh') reopenStage(/Reopen review/)
      const scroll = vi.mocked(log.scrollTo)
      log.scrollTop = 100
      fireEvent.scroll(log)
      scroll.mockClear()
      fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Reader draft' } })
      expect(scroll).not.toHaveBeenCalled()
      log.scrollTop = 2500
      fireEvent.scroll(log)
      if (context !== 'fresh') {
        reopenStage(/Reopen review/)
        fireEvent.click(within(screen.getByRole('group', { name: /whole move/i })).getByRole('button', { name: 'No' }))
      }
      fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Reading the cards' } })
      expect(log.scrollTop).toBe(2500)
      expect(scroll).not.toHaveBeenCalled()
    },
  )

  it.each(['draft edit', 'manifest change', 'card answer'] as const)(
    'preserves a bottom-of-card-stack reader during %s, then resumes on explicit Send',
    async (change) => {
      const pending = deferred<Response>()
      api((path) => (path === '/api/conversation' ? pending.promise : undefined))
      vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(5000)
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300)
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
        const log = document.querySelector('.conv-feed')
        const anchorTop = this.textContent?.includes('Resumed synthetic reply')
          ? 1800
          : this.textContent?.includes('Explicit synthetic Send')
            ? 1600
            : 1000
        return {
          top: this.hasAttribute('data-conversation-anchor') ? anchorTop - (log?.scrollTop ?? 0) + 20 : 20,
        } as DOMRect
      })
      Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
        configurable: true,
        value: vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
          this.scrollTop = options.top ?? 0
          this.dispatchEvent(new Event('scroll'))
        }),
      })
      mount(
        ready({
          messages: Array.from({ length: 80 }, (_, index) => ({
            id: `reader-history-${index}`,
            role: index === 79 ? 'assistant' : 'user',
            content: `Synthetic reader history ${index}`,
          })),
          analysis: {
            ...analysis,
            possibleDuplicates: Array.from({ length: 20 }, (_, index) => ({
              item: `synthetic item ${index}`,
              count: 2,
            })),
          },
          items: Array.from({ length: 50 }, (_, index) => ({ type: `synthetic item ${index}`, count: 2 })),
        }),
      )
      const log = screen.getByRole('log', { name: 'Move conversation' })
      const composer = screen.getByLabelText('Message')
      expect(log.scrollTop).toBe(1000)
      log.scrollTop = 4700
      fireEvent.scroll(log)
      const scroll = vi.mocked(log.scrollTo)
      scroll.mockClear()
      if (change === 'draft edit') fireEvent.change(composer, { target: { value: 'Unsent reader draft' } })
      else if (change === 'manifest change')
        fireEvent.change(screen.getByLabelText('Distance (miles)'), { target: { value: '44' } })
      else {
        reopenStage(/Reopen review/)
        fireEvent.click(within(screen.getByRole('group', { name: /whole move/i })).getByRole('button', { name: 'No' }))
      }
      expect(log.scrollTop).toBe(4700)
      expect(scroll).not.toHaveBeenCalled()
      expect(screen.getByLabelText('Message')).toBe(composer)
      fireEvent.change(composer, { target: { value: 'Explicit synthetic Send' } })
      expect(scroll).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
      expect(log.scrollTop).toBe(1600)
      await act(async () =>
        pending.resolve(
          Response.json({ reply: 'Resumed synthetic reply', basedOnRevision: draft().revision, proposals: [] }),
        ),
      )
      expect(log.scrollTop).toBe(1800)
      expect(screen.getByText('Resumed synthetic reply')).toBeInTheDocument()
      expect(screen.getByLabelText('Message')).toBe(composer)
    },
  )

  it('keeps actionable local HEIC guidance without forwarding or displaying raw upload failures', async () => {
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL() {
          return 'blob:heic'
        }
        static revokeObjectURL() {}
      },
    )
    const xhr = vi.fn()
    vi.stubGlobal('XMLHttpRequest', xhr)
    api()
    mount(ready({ analysis: null, items: [], photos: [], photoRefs: [], photoUrls: [] }))
    fireEvent.change(screen.getByLabelText('Choose from library'), {
      target: { files: [new File(['synthetic'], 'room.heic', { type: 'image/heic' })] },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(/HEIC.*JPEG/i)
    expect(xhr).not.toHaveBeenCalled()
    expect(draft().photoRefs).toEqual([])
    expect(screen.getByLabelText('Message')).toBeEnabled()
  })

  it('opens a modal right drawer, closes with Escape and returns focus without replacing chat or draft', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    }))
    api()
    mount(ready())
    const composer = screen.getByLabelText('Message')
    fireEvent.change(composer, { target: { value: 'drawer draft' } })
    const trigger = screen.getByRole('button', { name: /open move manifest/i })
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Move manifest' })).toHaveAttribute('aria-modal', 'true')
    expect(composer).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
    expect(composer).toHaveValue('drawer draft')
  })
})
