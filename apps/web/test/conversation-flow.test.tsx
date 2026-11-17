import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { HelmetProvider } from 'react-helmet-async'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EstimatePage from '../src/pages/estimate.page'
import {
  conversationSnapshot,
  createConversationSession,
  type ConversationSession,
} from '../src/lib/conversation-state'
import { useConversationController, type ConversationController } from '../src/lib/useConversationController'
import { SESSION_KEY } from '../src/lib/estimate-session'
import type { ConversationCommand } from '../src/data/z-common/z-conversation'
import { conversationChatApi, chatApi } from '../src/lib/api-client'

// Fake API responses test controller orchestration, not AI accuracy. Browser tests cover actual routes.
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
const contact = {
  name: 'Synthetic Customer',
  email: 'synthetic@example.invalid',
  phone: '5550101',
  requestedDate: '2027-01-20',
}
const mover = { id: 'mover-1', name: 'Synthetic Mover', slug: 'synthetic', serviceArea: 'Boston' }
const quote = {
  id: 'quote-1',
  estimateId: 'saved-id',
  moverId: mover.id,
  moverName: mover.name,
  note: '',
  status: 'logged',
  createdAt: '2026-11-16T12:00:00Z',
}
function ready(patch: Partial<ConversationSession> = {}): ConversationSession {
  const messages = patch.messages ?? []
  return {
    ...createConversationSession(),
    moveDetails: {
      from: '12 Main Street, Boston, MA',
      to: '9 Oak Street, Hartford, CT',
      date: null,
      distanceMiles: 120,
      originFloor: 0,
      destinationFloor: 1,
      originElevator: null,
      destinationElevator: true,
    },
    detailsConfirmed: true,
    timeline: messages.map((message, index) => ({ kind: 'message', id: `entry-${index}`, revision: 0, message })),
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
function packet(commands: ConversationCommand[] = [], revision = 0, reply = 'Check the suggested updates.') {
  return {
    reply,
    basedOnRevision: revision,
    proposals: commands.map((command, index) => ({ id: `suggestion-${index}`, expectedRevision: revision, command })),
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
  const fetch = vi.fn(async (path: string, request?: RequestInit): Promise<Response> => {
    const custom = handler?.(path, request)
    if (custom) return custom
    if (path === '/api/ai-status') return Response.json({ visionRevision: 99, visionFingerprint: 'current-vision' })
    if (path === '/api/price') return Response.json({ price })
    if (path === '/api/estimates') return Response.json({ id: 'saved-id', storage: 'memory' })
    if (path.endsWith('/contact'))
      return Response.json({ reference: 'saved-id', requestedDate: contact.requestedDate, note: 'Requested' })
    if (path === '/api/movers') return Response.json({ movers: [mover] })
    if (path === '/api/quote-requests') return Response.json({ requests: [quote], delivery: { [mover.id]: 'logged' } })
    if (path === '/api/analyze') return Response.json(analysis)
    if (path === '/api/conversation')
      return Response.json(packet([], JSON.parse(request?.body as string).snapshot.revision))
    throw new Error('Unexpected synthetic endpoint')
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}
type Fetch = ReturnType<typeof api>
const calls = (fetch: Fetch, path: string) => fetch.mock.calls.filter(([endpoint]) => endpoint === path)
const writes = (fetch: Fetch) =>
  fetch.mock.calls.filter(
    ([path, request]) =>
      ['POST', 'PATCH'].includes(request?.method ?? '') &&
      ['/api/estimates', '/api/quote-requests'].some((prefix) => path.startsWith(prefix)),
  )
const stored = (): ConversationSession => JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '{}')
function hook(state = ready()) {
  return renderHook(() => useConversationController(() => state), { wrapper: StrictMode })
}
function mount(state?: ConversationSession) {
  if (state) sessionStorage.setItem(SESSION_KEY, JSON.stringify(state))
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
function send(text: string) {
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Send', exact: true }))
}
const writeCases = [
  { kind: 'save', path: '/api/estimates' },
  { kind: 'schedule', path: '/api/estimates/saved-id/contact' },
  { kind: 'quotes', path: '/api/quote-requests' },
] as const
async function displayBooking(result: { current: ConversationController }) {
  await act(async () => {
    await result.current.openSummary()
  })
  act(() => result.current.bookMove())
}
async function beginWrite(result: { current: ConversationController }, kind: (typeof writeCases)[number]['kind']) {
  // No reconstructed customer UI: retained quote/date capabilities invoke the real controller directly.
  if (kind === 'save') return result.current.bookContact(contact)
  return kind === 'schedule' ? result.current.submitContact(contact) : result.current.submitQuotes([mover.id], '')
}
function uploads() {
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
  const pending: { done: () => void; fail: () => void }[] = []
  class XHR {
    upload = { onprogress: null }
    status = 200
    responseText = ''
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    open() {}
    send() {
      const index = pending.length + 1
      this.responseText = JSON.stringify({
        uploads: [{ url: `https://example.test/selection-${index}.jpg`, receipt: `selection-receipt-${index}` }],
      })
      pending.push({ done: () => this.onload?.(), fail: () => this.onerror?.() })
    }
  }
  vi.stubGlobal('XMLHttpRequest', XHR)
  const file = () => new File(['synthetic'], 'room.jpg', { type: 'image/jpeg' })
  return { pending, file }
}
beforeEach(() => {
  sessionStorage.clear()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
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
      unobserve() {}
      disconnect() {}
    },
  )
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('goal-driven actual customer UI', () => {
  it('starts with one AI question, persistent composer, native photo inputs and a read-only manifest', () => {
    const fetch = api()
    mount()
    expect(screen.getByRole('log')).toHaveTextContent('Where are you moving from and to?')
    expect(screen.queryByText(/roughly how far/i)).not.toBeInTheDocument()
    const panel = screen.getByRole('region', { name: 'Move manifest', exact: true })
    expect(panel.querySelectorAll('input, select, textarea, button')).toHaveLength(0)
    expect(document.querySelectorAll('input[type=file]')).toHaveLength(2)
    expect(screen.getByLabelText('Choose from library')).toHaveAttribute('type', 'file')
    expect(screen.getByLabelText('Take photo')).toHaveAttribute('capture', 'environment')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('keeps attachments inline and describes attachment count without claiming all are analysed', () => {
    api()
    mount(ready())
    expect(screen.getByRole('region', { name: 'Conversation photos' })).toHaveTextContent('1 photo attached')
    expect(
      screen.queryByRole('button', { name: /Reopen photos|Reopen review|Confirm move details/ }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Move manifest', exact: true })).toHaveTextContent('sofa')
  })
  it.each(['clarify_origin', 'request_photos'] as const)(
    'keeps native upload available during %s without inventing readiness',
    (nextAction) => {
      api()
      mount({ ...createConversationSession(), nextAction })
      expect(screen.getByLabelText('Choose from library')).not.toBeDisabled()
      fireEvent.click(screen.getByRole('button', { name: 'Price summary' }))
      expect(screen.getByRole('dialog', { name: 'Your move estimate' })).toHaveTextContent('We won’t guess a price')
      expect(screen.getByRole('button', { name: 'Book this move' })).toBeDisabled()
    },
  )
  it('shows readable pending changes behind Review suggested changes and accepts one date slot', () => {
    api()
    const state = ready({
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
    })
    mount(state)
    expect(screen.getByText('early January (date window)')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Review suggested changes'))
    expect(screen.getByText('Move date: 2027-01-11')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Accept suggestion' }))
    expect(stored().moveDetails.date).toBe('2027-01-11')
    expect(screen.queryByText('early January (date window)')).not.toBeInTheDocument()
    expect(screen.getByText('2027-01-11', { exact: true })).toBeInTheDocument()
  })
  it('retains one feed/composer across summary, update, rerender and reload without writes', async () => {
    const fetch = api()
    const view = mount(ready())
    const composer = screen.getByLabelText('Message')
    const feed = screen.getByRole('log')
    fireEvent.change(composer, { target: { value: 'draft stays' } })
    fireEvent.click(screen.getByRole('button', { name: 'Price summary' }))
    await screen.findByRole('button', { name: 'Book this move' })
    fireEvent.click(screen.getByRole('button', { name: 'Update this session' }))
    expect(screen.getByLabelText('Message')).toBe(composer)
    expect(screen.getByRole('log')).toBe(feed)
    expect(composer).toHaveValue('draft stays')
    expect(writes(fetch)).toEqual([])
    view.unmount()
    mount()
    expect(writes(fetch)).toEqual([])
  })
  it.each(['save', 'schedule', 'quotes'] as const)(
    'retained interrupted %s blocks new-session reset without reposting',
    async (kind) => {
      const fetch = api()
      const state = ready({ price })
      state.operations.unknown = {
        id: 'unknown',
        revision: 0,
        status: 'interrupted',
        request:
          kind === 'save'
            ? { kind }
            : kind === 'schedule'
              ? { kind, contact }
              : { kind, moverIds: [mover.id], note: '' },
      }
      mount(state)
      fireEvent.click(screen.getByRole('button', { name: 'Price summary' }))
      expect(await screen.findByRole('button', { name: 'Start a new session' })).toBeDisabled()
      expect(stored().sessionId).toBe(state.sessionId)
      expect(writes(fetch)).toEqual([])
    },
  )
  it.each(['2027-01-20', ''])(
    'preserves intentional preferred-date edit %s across accepted move-date changes',
    async (date) => {
      api()
      mount(
        ready({
          price,
          moveDetails: { ...ready().moveDetails, date: '2027-01-01' },
          pendingProposals: [
            { id: 'date', expectedRevision: 0, command: { type: 'details.patch', patch: { date: '2027-02-02' } } },
          ],
        }),
      )
      fireEvent.click(screen.getByRole('button', { name: 'Price summary' }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Book this move' })).toBeEnabled())
      fireEvent.click(screen.getByRole('button', { name: 'Book this move' }))
      fireEvent.change(screen.getByLabelText('Preferred move date'), { target: { value: date } })
      fireEvent.click(screen.getByRole('button', { name: 'Update this session' }))
      fireEvent.click(screen.getByText('Review suggested changes'))
      fireEvent.click(screen.getByRole('button', { name: 'Accept suggestion' }))
      fireEvent.click(screen.getByRole('button', { name: 'Price summary' }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Book this move' })).toBeEnabled())
      fireEvent.click(screen.getByRole('button', { name: 'Book this move' }))
      expect(screen.getByLabelText('Preferred move date')).toHaveValue(date)
    },
  )
  it.each([null, '2027-01-01'])(
    'untouched booking date follows current accepted date rather than mounted %s',
    async (date) => {
      api()
      mount(
        ready({
          moveDetails: { ...ready().moveDetails, date },
          pendingProposals: [
            { id: 'date', expectedRevision: 0, command: { type: 'details.patch', patch: { date: '2027-02-02' } } },
          ],
        }),
      )
      fireEvent.click(screen.getByText('Review suggested changes'))
      fireEvent.click(screen.getByRole('button', { name: 'Accept suggestion' }))
      fireEvent.click(screen.getByRole('button', { name: 'Price summary' }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Book this move' })).toBeEnabled())
      fireEvent.click(screen.getByRole('button', { name: 'Book this move' }))
      expect(screen.getByLabelText('Preferred move date')).toHaveValue('2027-02-02')
    },
  )
  it('HEIC failure gives local actionable guidance without exposing raw upload failure', async () => {
    api()
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL() {
          return 'blob:heic'
        }
        static revokeObjectURL() {}
      },
    )
    mount()
    fireEvent.change(screen.getByLabelText('Choose from library'), {
      target: { files: [new File(['not an image'], 'private.heic', { type: 'image/heic' })] },
    })
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/HEIC|JPEG/i))
    expect(document.body.textContent).not.toMatch(/private.heic|stack|responseText/)
    expect(stored().photoRefs).toEqual([])
  })
})

describe('actual controller revision and write orchestration (no replacement UI)', () => {
  it('analysis uses post-start revision and feeds accepted structure into next Chat without consuming draft', async () => {
    const pending = deferred<Response>()
    const fetch = api((path) => (path === '/api/analyze' ? pending.promise : undefined))
    const { result } = hook()
    act(() => result.current.setDraft('still writing'))
    let work: Promise<void> | undefined
    act(() => {
      work = result.current.analyzePhotos()
    })
    act(() => {
      void result.current.analyzePhotos()
    })
    expect(result.current.session.revision).toBe(1)
    expect(result.current.session.analysis).toBeNull()
    expect(calls(fetch, '/api/analyze')).toHaveLength(1)
    await act(async () => {
      pending.resolve(Response.json(analysis))
      await work
    })
    expect(result.current.session.analysis).toEqual(analysis)
    expect(result.current.draft).toBe('still writing')
    const body = JSON.parse(calls(fetch, '/api/analyze')[0][1]?.body as string)
    expect(body).toMatchObject({ photoRefs: ready().photoRefs, moveDetails: { distanceMiles: 120 }, sample: false })
    expect(body).not.toHaveProperty('messages')
    const chat = JSON.parse(calls(fetch, '/api/conversation')[0][1]?.body as string)
    expect(chat.snapshot.inventory).toEqual(analysis.items)
    expect(chat.snapshot.analysis).toMatchObject({ totalVolumeCubicFeet: 80, estimatedBoxes: { min: 2, max: 4 } })
    expect(writes(fetch)).toEqual([])
  })
  it('rejects late analysis and chat replies after an actual domain edit, preserving history and draft', async () => {
    const pending = deferred<Response>()
    const chat = deferred<Response>()
    api((path) => (path === '/api/analyze' ? pending.promise : path === '/api/conversation' ? chat.promise : undefined))
    const { result } = hook()
    let work: Promise<void> | undefined
    let reply: Promise<void> | undefined
    act(() => {
      work = result.current.analyzePhotos()
      reply = result.current.sendMessage('hello')
    })
    act(() => {
      result.current.setDraft('next draft')
      result.current.apply({ type: 'details.patch', patch: { distanceMiles: 99 } }, 'panel')
    })
    await act(async () => {
      pending.resolve(Response.json(analysis))
      chat.resolve(Response.json(packet([], 1, 'stale reply')))
      await work
      await reply
    })
    expect(result.current.session).toMatchObject({ analysis: null, moveDetails: { distanceMiles: 99 } })
    expect(result.current.session.messages.map((message) => message.content)).toEqual(['hello'])
    expect(result.current.draft).toBe('next draft')
    expect(result.current.error).toMatch(/changed|stale/i)
  })
  it('read-only summary and Book view never save; explicit callback verifies, confirms, saves and contacts once', async () => {
    const fetch = api()
    const { result } = hook(ready({ detailsConfirmed: false }))
    await act(async () => {
      await result.current.openSummary()
    })
    expect(calls(fetch, '/api/price')).toHaveLength(1)
    expect(writes(fetch)).toEqual([])
    act(() => result.current.bookMove())
    expect(writes(fetch)).toEqual([])
    await act(async () => {
      await result.current.bookContact(contact)
      await result.current.bookContact(contact)
    })
    expect(result.current.session.detailsConfirmed).toBe(true)
    expect(result.current.session.scheduleResult?.status).toBe('requested')
    expect(calls(fetch, '/api/estimates')).toHaveLength(1)
    expect(calls(fetch, '/api/estimates/saved-id/contact')).toHaveLength(1)
    expect(calls(fetch, '/api/quote-requests')).toHaveLength(0)
  })
  it('acknowledged save failure retries only save through an explicit callback, never reprices', async () => {
    let saves = 0
    const fetch = api((path) =>
      path === '/api/estimates' && ++saves === 1
        ? Promise.resolve(Response.json({ error: 'Unavailable' }, { status: 503 }))
        : undefined,
    )
    const { result } = hook()
    await act(async () => {
      await result.current.openSummary()
    })
    act(() => result.current.bookMove())
    await act(async () => {
      await result.current.bookContact(contact)
    })
    expect(result.current.error).toMatch(/save failed/i)
    expect(result.current.session.price).toEqual(price)
    await act(async () => {
      await result.current.bookContact(contact)
    })
    expect(result.current.session.estimateId).toBe('saved-id')
    expect(calls(fetch, '/api/price')).toHaveLength(1)
    expect(calls(fetch, '/api/estimates')).toHaveLength(2)
  })
  it.each(
    writeCases.flatMap((write) =>
      ['pagehide abort', 'unmount abort', 'transport loss', 'response body loss', 'pagehide success'].map(
        (boundary) => ({ ...write, boundary }),
      ),
    ),
  )(
    'preserves unknown $kind after $boundary and blocks blind retry across reload',
    async ({ kind, path, boundary }) => {
      const pending = deferred<Response>()
      const fetch = api((endpoint) => (endpoint === path ? pending.promise : undefined))
      const view = hook(ready({ price, estimateId: kind === 'save' ? null : 'saved-id', contact }))
      let work: Promise<void> | undefined
      // Every retained commercial entry point requires fresh displayed booking scope.
      await displayBooking(view.result)
      act(() => {
        work =
          kind === 'save'
            ? view.result.current.bookContact(contact)
            : kind === 'schedule'
              ? view.result.current.submitContact(contact)
              : view.result.current.submitQuotes([mover.id], '')
      })
      await waitFor(() => expect(calls(fetch, path)).toHaveLength(1))
      const operation = Object.values(stored().operations).find((op) => op.request.kind === kind)
      if (!operation) throw new Error('Explicit write did not start')
      expect(operation.status).toBe('pending')
      if (boundary.startsWith('pagehide')) fireEvent(window, new Event('pagehide'))
      if (boundary === 'unmount abort') view.unmount()
      await act(async () => {
        if (boundary === 'pagehide success')
          pending.resolve(
            Response.json({
              id: 'saved-id',
              reference: 'saved-id',
              requestedDate: contact.requestedDate,
              requests: [quote],
              delivery: { [mover.id]: 'logged' },
            }),
          )
        else if (boundary === 'response body loss') {
          const response = Response.json({})
          vi.spyOn(response, 'json').mockRejectedValue(new DOMException('Interrupted', 'AbortError'))
          pending.resolve(response)
        } else
          pending.reject(
            boundary === 'transport loss'
              ? new TypeError('Failed to fetch')
              : new DOMException('Navigation', 'AbortError'),
          )
        await work
      })
      expect(stored().operations[operation.id].status).toBe('pending')
      if (boundary === 'transport loss' || boundary === 'response body loss')
        expect(view.result.current.error).toMatch(/unknown outcome/i)
      if (boundary.startsWith('pagehide')) {
        fireEvent(window, new Event('pageshow'))
        expect(view.result.current.error).toMatch(/unknown outcome/i)
      }
      if (boundary !== 'unmount abort') view.unmount()
      const restored = renderHook(() => useConversationController())
      expect(restored.result.current.session.operations[operation.id].status).toBe('interrupted')
      await displayBooking(restored.result)
      await act(async () => {
        await beginWrite(restored.result, kind)
      })
      expect(calls(fetch, path)).toHaveLength(1)
    },
  )
  it.each(
    (['analyze', 'price'] as const).flatMap((kind) =>
      (['success', 'HTTP rejection', 'transport rejection'] as const).map((outcome) => ({ kind, outcome })),
    ),
  )('settles hidden $kind $outcome without resuming dependent writes', async ({ kind, outcome }) => {
    const pending = deferred<Response>()
    let attempts = 0
    const path = `/api/${kind}`
    const fetch = api((endpoint) => (endpoint === path && ++attempts === 1 ? pending.promise : undefined))
    const { result } = hook()
    let work: Promise<void> | undefined
    act(() => {
      work = kind === 'analyze' ? result.current.analyzePhotos() : result.current.openSummary()
    })
    await waitFor(() => expect(calls(fetch, path)).toHaveLength(1))
    fireEvent(window, new Event('pagehide'))
    await act(async () => {
      if (outcome === 'transport rejection') pending.reject(new TypeError('Disconnected'))
      else
        pending.resolve(
          outcome === 'HTTP rejection'
            ? Response.json({ error: 'Unavailable' }, { status: 503 })
            : Response.json(kind === 'analyze' ? analysis : { price }),
        )
      await work
    })
    expect(Object.values(result.current.session.operations).at(-1)?.status).toBe(
      outcome === 'success' ? 'succeeded' : 'failed',
    )
    fireEvent(window, new Event('pageshow'))
    expect(result.current.busy).toBe(false)
    expect(writes(fetch)).toEqual([])
  })
  it.each(['success', 'rejection'])(
    'settles hidden retained mover loader %s and permits another explicit load',
    async (outcome) => {
      const pending = deferred<Response>()
      let attempts = 0
      const fetch = api((path) => (path === '/api/movers' && ++attempts === 1 ? pending.promise : undefined))
      const { result } = hook()
      let work: Promise<void>
      act(() => {
        work = result.current.loadMovers()
      })
      fireEvent(window, new Event('pagehide'))
      await act(async () => {
        if (outcome === 'success') pending.resolve(Response.json({ movers: [mover] }))
        else pending.reject(new TypeError('Disconnected'))
        await work
      })
      fireEvent(window, new Event('pageshow'))
      expect(result.current.moversBusy).toBe(false)
      await act(async () => {
        await result.current.loadMovers()
      })
      expect(calls(fetch, '/api/movers')).toHaveLength(2)
      expect(writes(fetch)).toEqual([])
    },
  )
  it.each(['preflight', 'save-result'])('pagehide/pageshow never resumes callback chain held at %s', async (stage) => {
    const pending = deferred<Response>()
    const path = stage === 'preflight' ? '/api/ai-status' : '/api/estimates'
    let hold = false
    const fetch = api((endpoint) => (hold && endpoint === path ? pending.promise : undefined))
    const { result } = hook()
    await act(async () => {
      await result.current.openSummary()
    })
    act(() => result.current.bookMove())
    hold = true
    let work: Promise<void>
    act(() => {
      work = result.current.bookContact(contact)
    })
    await waitFor(() => expect(calls(fetch, path).length).toBeGreaterThan(0))
    fireEvent(window, new Event('pagehide'))
    fireEvent(window, new Event('pageshow'))
    await act(async () => {
      pending.resolve(
        Response.json(
          stage === 'preflight' ? { visionRevision: 1, visionFingerprint: 'current-vision' } : { id: 'saved-id' },
        ),
      )
      await work
    })
    expect(calls(fetch, '/api/estimates/saved-id/contact')).toHaveLength(0)
    expect(calls(fetch, '/api/estimates')).toHaveLength(stage === 'preflight' ? 0 : 1)
  })
  it.each(['analysis', 'pricing', 'movers', 'chat'] as const)(
    'starts no %s while the page is leaving',
    async (kind) => {
      const fetch = api()
      const { result } = hook()
      fireEvent(window, new Event('pagehide'))
      await act(async () => {
        if (kind === 'analysis') await result.current.analyzePhotos()
        else if (kind === 'pricing') await result.current.openSummary()
        else if (kind === 'movers') await result.current.loadMovers()
        else await result.current.sendMessage('Hello')
      })
      expect(fetch).not.toHaveBeenCalled()
    },
  )
  it.each(writeCases)(
    'acknowledged $kind rejection is explicitly retryable, unlike unknown transport loss',
    async ({ kind, path }) => {
      let attempts = 0
      const fetch = api((endpoint) =>
        endpoint === path && ++attempts === 1
          ? Promise.resolve(Response.json({ error: 'Unavailable' }, { status: 503 }))
          : undefined,
      )
      const { result } = hook(ready({ price, estimateId: kind === 'save' ? null : 'saved-id', contact }))
      await displayBooking(result)
      await act(async () => {
        await beginWrite(result, kind)
      })
      expect(Object.values(result.current.session.operations).at(-1)?.status).toBe('failed')
      await act(async () => {
        await beginWrite(result, kind)
      })
      expect(calls(fetch, path)).toHaveLength(2)
      expect(Object.values(result.current.session.operations).at(-1)?.status).toBe('succeeded')
    },
  )
  it('coverage edits reject late pricing without restoring any dependent lead', async () => {
    const pending = deferred<Response>()
    const fetch = api((path) => (path === '/api/price' ? pending.promise : undefined))
    const { result } = hook()
    let work: Promise<void>
    act(() => {
      work = result.current.openSummary()
    })
    await waitFor(() => expect(calls(fetch, '/api/price')).toHaveLength(1))
    act(() => {
      result.current.apply({ type: 'coverage.answer', answer: false })
    })
    await act(async () => {
      pending.resolve(Response.json({ price }))
      await work
    })
    expect(result.current.session.price).toBeNull()
    expect(result.current.session.estimateId).toBeNull()
    expect(writes(fetch)).toEqual([])
  })
  it.each(['check', 'price'])('stale vision at %s cannot restore a price or save', async (stage) => {
    const fetch = api((path) =>
      stage === 'check' && path === '/api/ai-status'
        ? Promise.resolve(Response.json({ visionRevision: 2, visionFingerprint: 'changed' }))
        : stage === 'price' && path === '/api/price'
          ? Promise.resolve(Response.json({ error: 'Changed', code: 'REANALYZE_REQUIRED' }, { status: 409 }))
          : undefined,
    )
    const { result } = hook()
    await act(async () => {
      await result.current.openSummary()
    })
    expect(result.current.session.price).toBeNull()
    expect(result.current.session.analysis).toEqual(stage === 'check' ? analysis : null)
    expect(result.current.session.verifiedVisionFingerprint).toBeNull()
    expect(writes(fetch)).toEqual([])
    expect(result.current.error).toMatch(/changed|again/i)
  })
  it.each(['success', 'failure', 'stale'])(
    'revalidates restored saved estimate on summary review and fresh explicit contact (%s)',
    async (outcome) => {
      let submitting = false
      const fetch = api((path) =>
        path === '/api/ai-status' && submitting
          ? Promise.resolve(
              outcome === 'failure'
                ? Response.json({}, { status: 503 })
                : Response.json({
                    visionRevision: 1,
                    visionFingerprint: outcome === 'stale' ? 'changed' : 'current-vision',
                  }),
            )
          : undefined,
      )
      const { result } = hook(ready({ price, estimateId: 'saved-id' }))
      expect(fetch).not.toHaveBeenCalled()
      await displayBooking(result)
      expect(calls(fetch, '/api/ai-status')).toHaveLength(1)
      submitting = true
      await act(async () => {
        await result.current.submitContact(contact)
      })
      expect(calls(fetch, '/api/ai-status')).toHaveLength(outcome === 'success' ? 3 : 2)
      expect(calls(fetch, '/api/estimates/saved-id/contact')).toHaveLength(outcome === 'success' ? 1 : 0)
    },
  )
})

describe('source-bound Send, retry and safe proposals', () => {
  it.each(['current', 'wrong-message', 'missing-facts'] as const)(
    'only current grounded details auto-apply (%s)',
    async (mode) => {
      const fetch = api((path, request) => {
        if (path !== '/api/conversation') return
        const body = JSON.parse(request?.body as string)
        const latest = body.messages.at(-1)
        return Promise.resolve(
          Response.json(
            packet(
              [
                {
                  type: 'details.patch',
                  patch: {
                    from: '12 Main Street, Boston, MA',
                    to: '9 Oak Street, Hartford, CT',
                    date: '2027-01-11',
                    originFloor: 0,
                  },
                  ...(mode === 'missing-facts'
                    ? {}
                    : {
                        facts: ['from', 'to', 'date', 'originFloor'].map((field) => ({
                          field,
                          sourceMessageId: mode === 'current' ? latest.id : 'older-answer',
                          wording: latest.content,
                          precision: field === 'from' || field === 'to' ? 'address' : 'exact',
                          uncertainty: 'certain',
                          correction: false,
                        })),
                      }),
                } as ConversationCommand,
              ],
              body.snapshot.revision,
            ),
          ),
        )
      })
      const state = createConversationSession()
      state.messages = [
        { id: 'older-answer', role: 'user', content: 'Pickup and delivery are stated here, January 11, ground floor.' },
      ]
      const { result } = hook(state)
      await act(async () => {
        await result.current.sendMessage('Pickup and delivery are stated here, January 11, ground floor.')
      })
      expect(result.current.session.revision).toBe(mode === 'current' ? 1 : 0)
      expect(result.current.session.pendingProposals).toHaveLength(mode === 'current' ? 0 : 1)
      expect(writes(fetch)).toEqual([])
      if (mode === 'current')
        expect(result.current.session.moveDetails).toMatchObject({
          from: '12 Main Street, Boston, MA',
          to: '9 Oak Street, Hartford, CT',
          originFloor: 0,
          date: '2027-01-11',
        })
    },
  )
  it('current source-bound factual answers apply as one validated batch while prose alone cannot mutate', async () => {
    const fetch = api((path, request) => {
      if (path !== '/api/conversation') return
      const body = JSON.parse(request?.body as string)
      const latest = body.messages.at(-1)
      return Promise.resolve(
        Response.json({
          ...packet(
            [
              { type: 'followUp.answer', key: 'garage', answer: false },
              { type: 'coverage.answer', answer: true },
            ],
            body.snapshot.revision,
          ),
          proposals: packet(
            [
              { type: 'followUp.answer', key: 'garage', answer: false },
              { type: 'coverage.answer', answer: true },
            ],
            body.snapshot.revision,
          ).proposals.map((proposal) => ({
            ...proposal,
            evidence: { sourceMessageId: latest.id, wording: latest.content },
          })),
        }),
      )
    })
    const { result } = hook(
      ready({
        wholeMoveCovered: null,
        followUps: { garage: null, closets: false, appliances: false },
        moveDetails: { ...ready().moveDetails, distanceMiles: null },
      }),
    )
    await act(async () => {
      await result.current.sendMessage('No garage extras. This covers the whole move.')
    })
    expect(result.current.session.revision).toBe(2)
    expect(result.current.session.pendingProposals).toHaveLength(0)
    expect(result.current.session.wholeMoveCovered).toBe(true)
    expect(result.current.session.followUps.garage).toBe(false)
    expect(writes(fetch)).toEqual([])
  })
  it.each(['unchanged', 'domain edit', 'cancelled', 'analysis refresh'] as const)(
    'old Send authority after failure: %s',
    async (change) => {
      let failed = true
      const fetch = api((path, request) => {
        if (path !== '/api/conversation') return
        if (failed) return Promise.resolve(Response.json({}, { status: 502 }))
        const body = JSON.parse(request?.body as string)
        const latest = body.messages.findLast((message: { role: string }) => message.role === 'user')
        return Promise.resolve(
          Response.json(
            packet(
              [
                {
                  type: 'details.patch',
                  patch: { from: '11 Old Street, Boston' },
                  facts: [
                    {
                      field: 'from',
                      sourceMessageId: latest.id,
                      wording: latest.content,
                      precision: 'address',
                      uncertainty: 'certain',
                      correction: false,
                    },
                  ],
                },
              ],
              body.snapshot.revision,
            ),
          ),
        )
      })
      const { result } = hook(ready({ moveDetails: { ...ready().moveDetails, distanceMiles: null } }))
      await act(async () => {
        await result.current.sendMessage('11 Old Street, Boston')
      })
      expect(result.current.chatFailed).toBe(true)
      if (change === 'domain edit')
        act(() => {
          result.current.apply({ type: 'details.patch', patch: { to: '22 New Street, Hartford' } }, 'panel')
        })
      if (change === 'cancelled') act(() => result.current.cancel())
      failed = false
      await act(async () => {
        if (change === 'analysis refresh') await result.current.analyzePhotos()
        else await result.current.retryChat()
      })
      expect(result.current.session.moveDetails.from).toBe(
        change === 'unchanged' ? '11 Old Street, Boston' : ready().moveDetails.from,
      )
      expect(result.current.session.messages.filter((message) => message.role === 'user')).toHaveLength(1)
      expect(writes(fetch)).toEqual([])
    },
  )
  it.each(['analyze', 'price', 'schedule', 'quotes'] as const)(
    'accepting an ungrounded %s action hint never executes it',
    async (action) => {
      const fetch = api((path) =>
        path === '/api/conversation'
          ? Promise.resolve(
              Response.json(packet([{ type: 'request.action', action }], 0, 'I saved and booked everything.')),
            )
          : undefined,
      )
      const state = ready({ pendingProposals: packet([{ type: 'request.action', action }]).proposals })
      const { result } = hook(state)
      act(() => {
        result.current.apply({ type: 'proposal.apply', proposalId: 'suggestion-0' })
      })
      expect(result.current.session.requestedAction).toBe(action)
      expect(fetch).not.toHaveBeenCalled()
      expect(result.current.session.estimateId).toBeNull()
    },
  )
  it.each(['accept', 'domain edit'] as const)(
    'expires the remaining proposal batch after %s without rebase or automatic refresh',
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
      const { result } = hook()
      await act(async () => {
        await result.current.sendMessage('Review this')
      })
      act(() => {
        result.current.apply(
          change === 'accept'
            ? { type: 'proposal.apply', proposalId: 'suggestion-0' }
            : { type: 'details.patch', patch: { distanceMiles: 99 } },
          'panel',
        )
      })
      expect(result.current.session.pendingProposals).toHaveLength(0)
      expect(result.current.suggestionsExpired).toBe(true)
      expect(calls(fetch, '/api/conversation')).toHaveLength(1)
      expect(writes(fetch)).toEqual([])
    },
  )
  it.each<ConversationCommand>([
    { type: 'item.add', item: { type: 'chair', count: 1 } },
    { type: 'item.count', itemType: 'sofa', count: 2 },
    { type: 'item.remove', itemType: 'sofa' },
    { type: 'coverage.answer', answer: false },
    { type: 'followUp.answer', key: 'garage', answer: true },
    { type: 'photo.decide', photoId: 'photo-1', decision: 'exclude' },
    { type: 'duplicate.resolve', itemType: 'sofa', resolution: 'same' },
  ])('ungrounded $type is held for explicit acceptance or dismissal', async (command) => {
    api((path) => (path === '/api/conversation' ? Promise.resolve(Response.json(packet([command]))) : undefined))
    const state = ready({
      analysis: {
        ...analysis,
        possibleDuplicates: [{ item: 'sofa', count: 2 }],
        photoAssessments:
          command.type === 'photo.decide'
            ? [{ url: ready().photos[0].url, status: 'uncertain', reason: 'Review' }]
            : [],
      },
    })
    const { result } = hook(state)
    await act(async () => {
      await result.current.sendMessage('Proposed change')
    })
    expect(result.current.session.revision).toBe(0)
    expect(result.current.session.items).toEqual(state.items)
    act(() => {
      result.current.apply({ type: 'proposal.dismiss', proposalId: 'suggestion-0' })
    })
    expect(result.current.session.revision).toBe(0)
    expect(result.current.session.pendingProposals).toHaveLength(0)
    await act(async () => {
      await result.current.sendMessage('Propose again')
    })
    act(() => {
      result.current.apply({ type: 'proposal.apply', proposalId: 'suggestion-0' })
    })
    expect(result.current.session.revision).toBe(1)
  })
  it.each([
    ['legacy payload', { reply: 'Rejected', moveDetails: { from: 'Untrusted' }, finished: true }],
    ['private field', { ...packet(), contact }],
    ['empty reply', { ...packet(), reply: '' }],
    ['wrong revision', packet([{ type: 'details.patch', patch: { from: 'Untrusted' } }], 9)],
    [
      'wrong proposal revision',
      {
        ...packet(),
        proposals: [
          { id: 'bad', expectedRevision: 9, command: { type: 'details.patch', patch: { from: 'Untrusted' } } },
        ],
      },
    ],
    [
      'private patch',
      {
        ...packet(),
        proposals: [
          {
            id: 'bad',
            expectedRevision: 0,
            command: { type: 'details.patch', patch: { from: 'Untrusted', receipt: 'private' } },
          },
        ],
      },
    ],
    ['invalid count', packet([{ type: 'item.count', itemType: 'sofa', count: 0 }])],
    ['invalid date', packet([{ type: 'details.patch', patch: { date: '2027-02-30' } }])],
    [
      'invalid reference after valid proposal',
      packet([
        { type: 'coverage.answer', answer: false },
        { type: 'item.remove', itemType: 'missing' },
      ]),
    ],
    [
      'duplicate ID',
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
  ])('rejects %s atomically at adapter ingress with no fallback', async (_name, response) => {
    const fetch = api((path) => (path === '/api/conversation' ? Promise.resolve(Response.json(response)) : undefined))
    const state = ready()
    const { result } = hook(state)
    await act(async () => {
      await result.current.sendMessage('Synthetic answer')
    })
    expect(result.current.chatFailed).toBe(true)
    expect(result.current.session).toMatchObject({
      revision: 0,
      moveDetails: state.moveDetails,
      items: state.items,
      pendingProposals: [],
      wholeMoveCovered: true,
    })
    expect(result.current.session.messages.filter((message) => message.role === 'assistant')).toHaveLength(0)
    expect(fetch.mock.calls.map(([path]) => path)).toEqual(['/api/conversation'])
  })
  it('validates adapter packets while legacy chatApi remains compatible', async () => {
    const fetch = api(() =>
      Promise.resolve(Response.json({ reply: 'Legacy reply', moveDetails: { from: 'Boston' }, finished: false })),
    )
    await expect(conversationChatApi([], conversationSnapshot(createConversationSession()))).rejects.toThrow()
    await expect(chatApi([])).resolves.toMatchObject({ reply: 'Legacy reply' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('cancellation ignores a late reply; retry never double-adds the submitted user turn', async () => {
    const pending = deferred<Response>()
    let attempt = 0
    const fetch = api((path) =>
      path === '/api/conversation'
        ? ++attempt === 1
          ? Promise.resolve(Response.json({}, { status: 502 }))
          : pending.promise
        : undefined,
    )
    const { result } = hook()
    await act(async () => {
      await result.current.sendMessage('hello')
    })
    let work: Promise<void>
    act(() => {
      work = result.current.retryChat()
    })
    act(() => result.current.cancel())
    await act(async () => {
      pending.resolve(Response.json(packet([], 0, 'late')))
      await work
    })
    expect(result.current.session.messages.map((message) => message.content)).toEqual(['hello'])
    expect(result.current.chatBusy).toBe(false)
    expect(calls(fetch, '/api/conversation')).toHaveLength(2)
  })
})

describe('photo receipts, evidence, uploads and inventory', () => {
  it.each(
    (['photoAssessments', 'photoLinkStatuses'] as const).flatMap((source) =>
      (['unlinked', 'unavailable'] as const).map((status) => ({ source, status })),
    ),
  )('partial $source $status failures remain durable and removal clears stale analysis', async ({ source, status }) => {
    const photos = [
      ...ready().photos,
      { id: 'photo-2', url: 'https://example.test/failed.jpg', receipt: 'second-receipt' },
    ]
    const partial = {
      ...analysis,
      [source]: [
        { url: photos[0].url, status: source === 'photoAssessments' ? 'relevant' : 'eligible', reason: 'Linked' },
        { url: photos[1].url, status, reason: 'Re-upload this photo.' },
      ],
    }
    api((path) => (path === '/api/analyze' ? Promise.resolve(Response.json(partial)) : undefined))
    const view = hook(
      ready({
        photos,
        photoUrls: photos.map((photo) => photo.url),
        photoRefs: photos.map(({ url, receipt }) => ({ url, receipt })),
      }),
    )
    await act(async () => {
      await view.result.current.analyzePhotos()
    })
    expect(Object.values(view.result.current.session.operations).at(-1)?.status).toBe('succeeded')
    view.unmount()
    mount()
    expect(screen.getByText('Photo 2 · Re-upload required')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/re-upload/i)
    fireEvent.click(screen.getByText('Manage photo 2'))
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo 2' }))
    expect(stored().photos).toHaveLength(1)
    expect(stored().analysis).toBeNull()
  })
  it.each(['keep', 'exclude'] as const)(
    'prices reviewed %s candidates and evidence, never raw analysis totals',
    async (decision) => {
      const relevant = ready().photos[0]
      const uncertain = { id: 'photo-2', url: 'https://example.test/uncertain.jpg', receipt: 'uncertain-receipt' }
      const candidate = {
        ...analysis,
        items: [{ type: 'desk', count: 1 }],
        totalVolumeCubicFeet: 40,
        photoAssessments: [
          { url: relevant.url, status: 'relevant' as const, reason: 'Desk' },
          {
            url: uncertain.url,
            status: 'uncertain' as const,
            reason: 'Review',
            candidates: {
              items: [{ type: 'armchair', count: 1 }],
              total_volume_cubic_feet: 20,
              estimated_boxes_min: 1,
              estimated_boxes_max: 2,
            },
          },
        ],
      }
      const fetch = api()
      const { result } = hook(
        ready({
          analysis: candidate,
          items: candidate.items,
          photos: [relevant, uncertain],
          photoUrls: [relevant.url, uncertain.url],
          photoRefs: [relevant, uncertain].map(({ url, receipt }) => ({ url, receipt })),
        }),
      )
      act(() => {
        result.current.apply({ type: 'photo.decide', photoId: uncertain.id, decision })
      })
      await act(async () => {
        await result.current.openSummary()
      })
      expect(calls(fetch, '/api/price')).toHaveLength(1)
      const body = JSON.parse(calls(fetch, '/api/price')[0][1]?.body as string)
      expect(body.analysis.items).toEqual(
        decision === 'keep'
          ? [
              { type: 'desk', count: 1 },
              { type: 'armchair', count: 1 },
            ]
          : [{ type: 'desk', count: 1 }],
      )
      expect(body.analysis.totalVolumeCubicFeet).toBe(decision === 'keep' ? 60 : 40)
      expect(body.analysis.estimatedBoxes).toEqual(decision === 'keep' ? { min: 3, max: 6 } : { min: 2, max: 4 })
      expect(body.review.photoEvidence).toEqual({ unresolvedCount: 0, excludedCount: decision === 'keep' ? 0 : 1 })
      expect(result.current.session.photoDecisions[uncertain.url]).toBe(decision)
      expect(writes(fetch)).toEqual([])
    },
  )
  it('uncertain-only inventory stays empty until kept; exclude-all remains blocked after reload', async () => {
    const url = ready().photos[0].url
    const uncertain = {
      ...analysis,
      items: [],
      totalVolumeCubicFeet: 0,
      photoAssessments: [
        {
          url,
          status: 'uncertain' as const,
          reason: 'Review',
          candidates: {
            items: [{ type: 'armchair', count: 1 }],
            total_volume_cubic_feet: 20,
            estimated_boxes_min: 1,
            estimated_boxes_max: 2,
          },
        },
      ],
    }
    const fetch = api()
    const view = hook(ready({ analysis: uncertain, items: [] }))
    expect(view.result.current.completeness.ready).toBe(false)
    act(() => {
      view.result.current.apply({ type: 'photo.decide', photoId: 'photo-1', decision: 'exclude' })
    })
    view.unmount()
    const restored = renderHook(() => useConversationController())
    await act(async () => {
      await restored.result.current.openSummary()
    })
    expect(calls(fetch, '/api/price')).toHaveLength(0)
    expect(restored.result.current.session.items).toEqual([])
    act(() => {
      restored.result.current.apply({ type: 'item.add', item: { type: 'fixture trunk', count: 1 } })
    })
    expect(restored.result.current.session.items).toEqual([{ type: 'fixture trunk', count: 1 }])
    // An added item cannot fabricate relevant photo evidence under the goal-driven readiness contract.
    expect(restored.result.current.completeness.ready).toBe(false)
  })
  it('alias/count/add/remove and duplicate decisions update the same inventory and lock later photo decisions', () => {
    api()
    const { result } = hook(
      ready({
        items: [{ type: 'couch', count: 2 }],
        analysis: {
          ...analysis,
          items: [{ type: 'couch', count: 2 }],
          possibleDuplicates: [{ item: 'sofa', count: 2 }],
        },
      }),
    )
    act(() => {
      result.current.apply({ type: 'duplicate.resolve', itemType: 'sofa', resolution: 'same' })
    })
    expect(result.current.session.items[0].count).toBe(1)
    act(() => {
      result.current.apply({ type: 'item.count', itemType: 'sofa', count: 3 })
      result.current.apply({ type: 'item.add', item: { type: 'chair', count: 2 } })
      result.current.apply({ type: 'item.remove', itemType: 'chair' })
    })
    expect(result.current.session.items).toEqual([{ type: 'sofa', count: 3 }])
    expect(result.current.session.photoDecisionsLocked).toBe(true)
  })
  it.each(['request_failed', 'photo_link_failed'] as const)(
    'sanitizes and persists %s failure evidence; accepted retry clears it',
    async (code) => {
      let failed = true
      const url = ready().photos[0].url
      const fetch = api((path) =>
        path === '/api/analyze' && failed
          ? Promise.resolve(
              Response.json(
                {
                  error: 'raw-private-provider',
                  code: code === 'photo_link_failed' ? 'PHOTO_LINK_FAILED' : 'ANALYSIS_FAILED',
                  photoAssessments: [
                    { url, status: 'unavailable', reason: 'Unavailable' },
                    { url: 'https://example.test/not-selected.jpg', status: 'unavailable', reason: 'Private' },
                  ],
                },
                { status: 400 },
              ),
            )
          : undefined,
      )
      const view = hook()
      await act(async () => {
        await view.result.current.analyzePhotos()
      })
      expect(Object.values(stored().operations).at(-1)?.errorCode).toBe(code)
      expect(JSON.stringify(stored())).not.toContain('raw-private-provider')
      expect(stored().failedPhotoAssessments.every((entry) => entry.url === url)).toBe(true)
      view.unmount()
      const restored = renderHook(() => useConversationController())
      expect(calls(fetch, '/api/analyze')).toHaveLength(1)
      failed = false
      await act(async () => {
        await restored.result.current.analyzePhotos()
      })
      expect(restored.result.current.session.failedPhotoAssessments).toEqual([])
      expect(restored.result.current.session.analysis).toEqual(analysis)
    },
  )
  it.each(['details', 'photos'])(
    'retains photo-specific recovery across %s edits until photos actually change',
    (change) => {
      const failedPhotoAssessments = [
        { url: ready().photos[0].url, status: 'unavailable' as const, reason: 'Unavailable' },
      ]
      api()
      const { result } = hook(ready({ failedPhotoAssessments }))
      act(() => {
        if (change === 'details') result.current.apply({ type: 'details.patch', patch: { distanceMiles: 99 } })
        else result.current.removePhoto('photo-1')
      })
      expect(result.current.session.failedPhotoAssessments).toEqual(change === 'details' ? failedPhotoAssessments : [])
    },
  )
  it.each([0, 1])('overlapping upload cohorts retain both receipts when completion %s is first', async (first) => {
    const control = uploads()
    api()
    const { result } = hook(createConversationSession())
    let one: Promise<void> | undefined
    let two: Promise<void> | undefined
    act(() => {
      one = result.current.uploadFiles([control.file()])
      two = result.current.uploadFiles([control.file()])
    })
    await waitFor(() => expect(control.pending).toHaveLength(2))
    await act(async () => {
      control.pending[first].done()
    })
    expect(result.current.session.photos).toHaveLength(1)
    await act(async () => {
      control.pending[1 - first].done()
      await one
      await two
    })
    expect(result.current.session.photos).toHaveLength(2)
    expect(result.current.session.photos.every((photo) => photo.receipt)).toBe(true)
  })
  it('unrelated edits and a newer selection cannot rebase an older upload cohort', async () => {
    const control = uploads()
    api()
    const { result } = hook(createConversationSession())
    let old: Promise<void> | undefined
    let current: Promise<void> | undefined
    act(() => {
      old = result.current.uploadFiles([control.file()])
    })
    await waitFor(() => expect(control.pending).toHaveLength(1))
    act(() => {
      result.current.apply({ type: 'details.patch', patch: { from: 'Changed origin' } }, 'panel')
      current = result.current.uploadFiles([control.file()])
    })
    await waitFor(() => expect(control.pending).toHaveLength(2))
    await act(async () => {
      control.pending[1].done()
      await current
    })
    await act(async () => {
      control.pending[0].done()
      await old
    })
    expect(result.current.session.photos.map((photo) => photo.receipt)).toEqual(['selection-receipt-2'])
    expect(result.current.uploads[0].status).toBe('error')
  })
  it('caps selected uploads at ten, retains receipts and never resurrects a removed upload', async () => {
    const control = uploads()
    const fetch = api()
    const { result } = hook(createConversationSession())
    let work: Promise<void> | undefined
    act(() => {
      work = result.current.uploadFiles(Array.from({ length: 12 }, control.file))
    })
    await waitFor(() => expect(control.pending).toHaveLength(10))
    expect(result.current.error).toMatch(/10 photos/)
    const removed = result.current.uploads[0].id
    act(() => result.current.removeUpload(removed))
    await act(async () => {
      for (const upload of control.pending) upload.done()
      await work
    })
    expect(result.current.session.photos).toHaveLength(9)
    expect(result.current.session.photos.every((photo) => photo.receipt)).toBe(true)
    expect(result.current.session.photos.some((photo) => photo.id === removed)).toBe(false)
    expect(writes(fetch)).toEqual([])
  })
  it('upload failure supports explicit retry/removal and blocks analysis/pricing without losing draft', async () => {
    const control = uploads()
    const fetch = api()
    const { result } = hook()
    let work: Promise<void> | undefined
    act(() => {
      result.current.setDraft('keep writing')
      work = result.current.uploadFiles([control.file()])
    })
    await waitFor(() => expect(control.pending).toHaveLength(1))
    await act(async () => {
      await result.current.openSummary()
      control.pending[0].fail()
      await work
    })
    expect(calls(fetch, '/api/price')).toHaveLength(0)
    expect(result.current.uploads[0].status).toBe('error')
    let retry: Promise<void> | undefined
    act(() => {
      retry = result.current.retryUpload(result.current.uploads[0].id)
    })
    await waitFor(() => expect(control.pending).toHaveLength(2))
    act(() => result.current.removeUpload(result.current.uploads[0].id))
    await act(async () => {
      control.pending[1].done()
      await retry
    })
    expect(result.current.draft).toBe('keep writing')
    expect(result.current.session.photos).toHaveLength(1)
    expect(writes(fetch)).toEqual([])
  })
  it.each(['preflight', 'price-result'] as const)(
    'selection during %s blocks dependent work even without a revision change',
    async (stage) => {
      const control = uploads()
      const pending = deferred<Response>()
      const path = stage === 'preflight' ? '/api/ai-status' : '/api/price'
      const fetch = api((endpoint) => (endpoint === path ? pending.promise : undefined))
      const { result } = hook()
      let work: Promise<void>
      act(() => {
        work = result.current.openSummary()
      })
      await waitFor(() => expect(calls(fetch, path)).toHaveLength(1))
      act(() => {
        void result.current.uploadFiles([control.file()])
      })
      await waitFor(() => expect(control.pending).toHaveLength(1))
      await act(async () => {
        pending.resolve(
          Response.json(stage === 'preflight' ? { visionRevision: 1, visionFingerprint: 'current-vision' } : { price }),
        )
        await work
      })
      expect(writes(fetch)).toEqual([])
      expect(calls(fetch, '/api/price')).toHaveLength(stage === 'preflight' ? 0 : 1)
      expect(result.current.uploads).toHaveLength(1)
    },
  )
})

describe('remaining legacy guards through actual controller entry points', () => {
  it('supports ground-floor zero without editable manifest fields', () => {
    api()
    const { result } = hook(createConversationSession())
    act(() => {
      result.current.apply({ type: 'details.patch', patch: { originFloor: 0, destinationFloor: 0 } })
    })
    expect(result.current.session.moveDetails).toMatchObject({ originFloor: 0, destinationFloor: 0 })
  })
  it('includes accepted state in next Chat and distinguishes omitted fields from explicit null correction', async () => {
    const fetch = api((path, request) => {
      if (path !== '/api/conversation') return
      const body = JSON.parse(request?.body as string)
      const latest = body.messages.at(-1)
      return Promise.resolve(
        Response.json(
          packet(
            [
              {
                type: 'details.patch',
                patch: { date: null },
                facts: [
                  {
                    field: 'dateWindow',
                    sourceMessageId: latest.id,
                    wording: 'early January',
                    uncertainty: 'uncertain',
                    precision: 'window',
                    correction: true,
                  },
                ],
              },
            ],
            body.snapshot.revision,
          ),
        ),
      )
    })
    const { result } = hook(ready({ moveDetails: { ...ready().moveDetails, date: '2027-01-11' } }))
    act(() => {
      result.current.apply({ type: 'details.patch', patch: { originFloor: 2, originElevator: false } }, 'panel')
    })
    await act(async () => {
      await result.current.sendMessage('Actually early January, not an exact date.')
    })
    const request = JSON.parse(calls(fetch, '/api/conversation')[0][1]?.body as string)
    expect(request.snapshot.moveDetails).toMatchObject({ originFloor: 2, originElevator: false, date: '2027-01-11' })
    expect(result.current.session.moveDetails).toMatchObject({
      originFloor: 2,
      originElevator: false,
      date: null,
      from: ready().moveDetails.from,
    })
    expect(result.current.session.analysis).toEqual(analysis)
    expect(writes(fetch)).toEqual([])
  })
  it('mixed old-turn details/action batch requires Accept and never executes the remaining hint', async () => {
    const fetch = api((path) =>
      path === '/api/conversation'
        ? Promise.resolve(
            Response.json(
              packet([
                { type: 'details.patch', patch: { date: '2027-01-11' } },
                { type: 'request.action', action: 'analyze' },
              ]),
            ),
          )
        : undefined,
    )
    const { result } = hook(ready({ messages: [{ id: 'old-turn', role: 'user', content: 'Synthetic old proposal' }] }))
    await act(async () => {
      await result.current.retryChat()
    })
    expect(result.current.session.pendingProposals).toHaveLength(2)
    expect(result.current.session.moveDetails.date).toBeNull()
    act(() => {
      result.current.apply({ type: 'proposal.apply', proposalId: 'suggestion-0' })
    })
    expect(result.current.session.moveDetails.date).toBe('2027-01-11')
    expect(result.current.session.pendingProposals).toEqual([])
    expect(fetch.mock.calls.map(([path]) => path)).toEqual(['/api/conversation'])
  })
  it.each(['analyze', 'price'] as const)(
    'retry cannot reauthorize old %s intent after an unrelated revision change',
    async (action) => {
      let failed = true
      const fetch = api((path, request) =>
        path === '/api/conversation'
          ? Promise.resolve(
              failed
                ? Response.json({}, { status: 502 })
                : Response.json(
                    packet([{ type: 'request.action', action }], JSON.parse(request?.body as string).snapshot.revision),
                  ),
            )
          : undefined,
      )
      const { result } = hook()
      await act(async () => {
        await result.current.sendMessage(`Please ${action}`)
      })
      act(() => {
        result.current.apply({ type: 'details.patch', patch: { date: '2027-01-11' } })
      })
      failed = false
      await act(async () => {
        await result.current.retryChat()
      })
      expect(result.current.session.pendingProposals).toHaveLength(1)
      expect(result.current.view).toBe('chat')
      expect(calls(fetch, '/api/analyze')).toHaveLength(0)
      expect(calls(fetch, '/api/price')).toHaveLength(0)
      expect(writes(fetch)).toEqual([])
    },
  )
  it('original explicit price intent opens a read-only summary, never a saved lead', async () => {
    const fetch = api((path, request) =>
      path === '/api/conversation'
        ? Promise.resolve(
            Response.json(
              packet(
                [{ type: 'request.action', action: 'price' }],
                JSON.parse(request?.body as string).snapshot.revision,
              ),
            ),
          )
        : undefined,
    )
    const { result } = hook()
    await act(async () => {
      await result.current.sendMessage('Please show my price summary.')
    })
    expect(result.current.view).toBe('summary')
    expect(result.current.session.price).toEqual(price)
    expect(calls(fetch, '/api/price')).toHaveLength(1)
    expect(writes(fetch)).toEqual([])
  })
  it('pagehide-aborted reply restores composer availability without writes or duplicate turn', async () => {
    const pending = deferred<Response>()
    const fetch = api((path) => (path === '/api/conversation' ? pending.promise : undefined))
    const { result } = hook()
    let work: Promise<void> | undefined
    act(() => {
      work = result.current.sendMessage('hello')
    })
    fireEvent(window, new Event('pagehide'))
    await act(async () => {
      pending.resolve(Response.json(packet([], 0, 'Late hidden reply')))
      await work
    })
    fireEvent(window, new Event('pageshow'))
    expect(result.current.chatBusy).toBe(false)
    expect(result.current.session.messages.map((message) => message.content)).toEqual(['hello'])
    expect(writes(fetch)).toEqual([])
  })
  it.each(['update view', 'domain edit'] as const)(
    'callback rejects a stale displayed scope after %s',
    async (change) => {
      const fetch = api()
      const { result } = hook()
      await act(async () => {
        await result.current.openSummary()
      })
      act(() => result.current.bookMove())
      act(() => {
        if (change === 'update view') result.current.updateSession()
        else result.current.apply({ type: 'details.patch', patch: { date: '2027-01-11' } })
      })
      await act(async () => {
        await result.current.bookContact(contact)
      })
      expect(result.current.error).toMatch(/displayed move changed/i)
      expect(writes(fetch)).toEqual([])
    },
  )
  it.each(writeCases)(
    'pending $kind blocks reset and repeat writes before the response arrives',
    async ({ kind, path }) => {
      const pending = deferred<Response>()
      const fetch = api((endpoint) => (endpoint === path ? pending.promise : undefined))
      const { result } = hook(ready({ price, estimateId: kind === 'save' ? null : 'saved-id', contact }))
      await displayBooking(result)
      let work: Promise<void>
      act(() => {
        work = beginWrite(result, kind)
      })
      await waitFor(() => expect(calls(fetch, path)).toHaveLength(1))
      const sessionId = result.current.session.sessionId
      act(() => {
        result.current.reset('new')
      })
      await act(async () => {
        await beginWrite(result, kind)
      })
      expect(result.current.session.sessionId).toBe(sessionId)
      expect(calls(fetch, path)).toHaveLength(1)
      await act(async () => {
        pending.reject(new TypeError('Disconnected'))
        await work
      })
      expect(Object.values(result.current.session.operations).at(-1)?.status).toBe('pending')
    },
  )
  it('legacy linkage exclusions stay visible without exposing their source URL or inventing relevance', () => {
    api()
    mount(
      ready({
        analysis: {
          ...analysis,
          photoLinkStatuses: [{ url: ready().photos[0].url, status: 'unlinked', reason: 'Re-upload required' }],
        },
      }),
    )
    expect(screen.getByRole('region', { name: 'Conversation photos' })).toHaveTextContent('Re-upload required')
    expect(document.body.textContent).not.toContain(ready().photos[0].url)
    expect(screen.queryByText('Reviewed', { exact: true })).not.toBeInTheDocument()
  })
})

describe('bounded private context and durable history', () => {
  it('snapshot excludes stored contact, lead reference, receipts, URLs and internal price', async () => {
    const fetch = api()
    const state = ready({ contact, price, estimateId: 'private-reference' })
    const { result } = hook(state)
    await act(async () => {
      await result.current.sendMessage('What remains?')
    })
    const payload = JSON.parse(calls(fetch, '/api/conversation')[0][1]?.body as string)
    const text = JSON.stringify(payload)
    for (const value of [
      contact.name,
      contact.email,
      contact.phone,
      state.estimateId,
      state.photos[0].url,
      state.photos[0].receipt,
    ])
      expect(text).not.toContain(value)
    expect(payload.snapshot.status.estimateSaved).toBe(true)
    expect(payload.snapshot).not.toHaveProperty('contact')
    expect(writes(fetch)).toEqual([])
  })
  it('rejects oversized new input before append or fetch and retains the exact draft/history', async () => {
    const fetch = api()
    const { result } = hook()
    const before = result.current.session
    act(() => result.current.setDraft('x'.repeat(12001)))
    await act(async () => {
      await result.current.sendMessage()
    })
    expect(result.current.session).toBe(before)
    expect(result.current.draft).toHaveLength(12001)
    expect(result.current.error).toMatch(/12,000/)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('bounds client context but keeps full legacy history and latest question across reload', async () => {
    const messages: ConversationSession['messages'] = Array.from({ length: 220 }, (_, index) => ({
      id: `old-${index}`,
      role: 'user',
      content: `History ${index}`,
    }))
    messages.push(
      { id: 'oversized', role: 'user', content: 'x'.repeat(12001) },
      { id: 'question', role: 'assistant', content: 'What is the origin address?' },
    )
    const fetch = api()
    const view = hook(ready({ messages }))
    await act(async () => {
      await view.result.current.sendMessage('Boston')
    })
    const body = JSON.parse(calls(fetch, '/api/conversation')[0][1]?.body as string)
    expect(body.messages).toEqual([messages.at(-1), expect.objectContaining({ role: 'user', content: 'Boston' })])
    expect(view.result.current.session.messages.slice(0, 222)).toEqual(messages)
    const accepted = view.result.current.session.messages
    view.unmount()
    const restored = renderHook(() => useConversationController())
    expect(restored.result.current.session.messages).toEqual(accepted)
    expect(calls(fetch, '/api/conversation')).toHaveLength(1)
  })
})
