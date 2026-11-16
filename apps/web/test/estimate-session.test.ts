/**
 * The sessionStorage mirror of the estimator (MOVERS-12): round trip, version mismatch, garbage, sample seed.
 */
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { HelmetProvider } from 'react-helmet-async'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewStep } from '../src/components/estimate/ReviewStep'
import { EstimateStep } from '../src/components/estimate/EstimateStep'
import EstimatePage from '../src/pages/estimate.page'
import { analyzeApi, priceApi, uploadImage } from '../src/lib/api-client'
import {
  EMPTY_SESSION,
  type EstimateSession,
  SESSION_KEY,
  SESSION_VERSION,
  clearSession,
  loadSession,
  sampleSession,
  saveSession,
} from '../src/lib/estimate-session'

class FakeStorage {
  private map = new Map<string, string>()
  getItem(key: string) {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.map.set(key, value)
  }
  removeItem(key: string) {
    this.map.delete(key)
  }
}

const analysis = {
  items: [{ type: 'sofa', count: 1 }],
  totalVolumeCubicFeet: 80,
  estimatedBoxes: { min: 2, max: 4 },
  boxesExplanation: '',
  specialHandling: [],
  possibleDuplicates: [],
  unseenAreas: [],
}
const savedPrice = {
  currency: 'USD',
  total: 100,
  low: 90,
  high: 110,
  breakdown: { labor: 100 },
  confidence: 'high' as const,
}
const review = { followUps: { garage: false, closets: false, appliances: false }, wholeMoveCovered: true }

afterEach(() => {
  cleanup() // release object URLs before undoing browser API stubs
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.sessionStorage.clear()
})

describe('estimate session', () => {
  it('returns the empty session when nothing is saved', () => {
    expect(loadSession(new FakeStorage())).toMatchObject({ ...EMPTY_SESSION, sessionId: expect.any(String) })
    expect(loadSession(null)).toMatchObject({ ...EMPTY_SESSION, sessionId: expect.any(String) })
  })

  it('round-trips a session', () => {
    const store = new FakeStorage()
    const session: EstimateSession = {
      ...EMPTY_SESSION,
      step: 'review',
      photoUrls: ['http://x/a.jpg'],
      photoRefs: [{ url: 'http://x/a.jpg', receipt: 'opaque-test-receipt' }],
      items: [{ type: 'sofa', count: 1 }],
      followUps: { garage: true, closets: null, appliances: false },
      wholeMoveCovered: false,
    }
    saveSession(session, store)
    expect(loadSession(store)).toEqual(session)
  })

  it('discards a session saved by another version', () => {
    const store = new FakeStorage()
    store.setItem(SESSION_KEY, JSON.stringify({ ...EMPTY_SESSION, version: 2, step: 'estimate' }))
    expect(loadSession(store)).toMatchObject({ ...EMPTY_SESSION, sessionId: expect.any(String) })
    expect(store.getItem(SESSION_KEY)).toBeNull()
  })

  it('migrates a v3 priced draft to review without losing edits or photos', () => {
    const store = new FakeStorage()
    store.setItem(
      SESSION_KEY,
      JSON.stringify({
        ...EMPTY_SESSION,
        version: 3,
        step: 'estimate',
        photoUrls: ['http://localhost:3000/sample/living-room.jpg'],
        analysis,
        items: [{ type: 'sofa', count: 2 }],
        price: savedPrice,
        estimateId: 'saved-id',
        sample: true,
      }),
    )
    expect(loadSession(store)).toMatchObject({
      version: 5,
      step: 'review',
      photoUrls: ['http://localhost:3000/sample/living-room.jpg'],
      photoRefs: [{ url: 'http://localhost:3000/sample/living-room.jpg', receipt: null }],
      needsPhotoReupload: false,
      analysis,
      items: [{ type: 'sofa', count: 2 }],
      price: null,
      estimateId: null,
      wholeMoveCovered: null,
      sample: true,
    })
    expect(store.getItem(SESSION_KEY)).not.toBeNull()
  })

  it.each([3, 4])('rejects non-bundled legacy sample refs in v%s and clears stale analysis', (version) => {
    const store = new FakeStorage()
    store.setItem(
      SESSION_KEY,
      JSON.stringify({
        ...EMPTY_SESSION,
        version,
        sample: true,
        step: 'estimate',
        analysis,
        price: savedPrice,
        photoUrls: ['http://localhost:3000/sample/living-room.jpg', 'http://localhost:3000/sample/lookalike.jpg'],
      }),
    )
    expect(loadSession(store)).toMatchObject({
      step: 'upload',
      sample: false,
      needsPhotoReupload: true,
      photoRefs: [],
      analysis: null,
      price: null,
    })
  })

  it('keeps a v3 draft without analysis at upload rather than a broken estimate', () => {
    const store = new FakeStorage()
    store.setItem(
      SESSION_KEY,
      JSON.stringify({
        ...EMPTY_SESSION,
        version: 3,
        step: 'estimate',
        photoUrls: ['https://example.test/a.jpg'],
        price: savedPrice,
      }),
    )
    expect(loadSession(store)).toMatchObject({
      version: 5,
      step: 'upload',
      photoUrls: ['https://example.test/a.jpg'],
      photoRefs: [],
      needsPhotoReupload: true,
      analysis: null,
      price: null,
      estimateId: null,
    })
    expect(store.getItem(SESSION_KEY)).not.toBeNull()
  })

  it('migrates a v4 own-photo draft without treating its old URLs as linked uploads', () => {
    const store = new FakeStorage()
    store.setItem(
      SESSION_KEY,
      JSON.stringify({
        ...EMPTY_SESSION,
        version: 4,
        step: 'estimate',
        moveDetails: { ...EMPTY_SESSION.moveDetails, originFloor: 4 },
        photoUrls: ['https://example.test/room.jpg'],
        analysis,
        items: analysis.items,
        price: savedPrice,
        estimateId: 'old-id',
        sample: false,
      }),
    )
    const loaded = loadSession(store)
    expect(loaded).toMatchObject({
      version: 5,
      step: 'upload',
      moveDetails: { originFloor: 4 },
      photoUrls: ['https://example.test/room.jpg'],
      photoRefs: [],
      needsPhotoReupload: true,
      analysis: null,
      items: [],
      price: null,
      estimateId: null,
      sample: false,
    })
    expect(loaded.sessionId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('invalidates a legacy own-photo analysis even when its URLs were lost', () => {
    const store = new FakeStorage()
    store.setItem(
      SESSION_KEY,
      JSON.stringify({
        ...EMPTY_SESSION,
        version: 4,
        step: 'review',
        photoUrls: [],
        analysis,
        price: savedPrice,
      }),
    )
    expect(loadSession(store)).toMatchObject({
      step: 'upload',
      analysis: null,
      price: null,
      photoRefs: [],
      needsPhotoReupload: true,
    })
  })

  it('shows legacy thumbnails but cannot analyze them without a new receipt', () => {
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        ...EMPTY_SESSION,
        version: 4,
        step: 'estimate',
        photoUrls: ['https://example.test/room.jpg'],
        analysis,
      }),
    )
    render(
      createElement(
        HelmetProvider,
        null,
        createElement(MemoryRouter, { initialEntries: ['/estimate'] }, createElement(EstimatePage)),
      ),
    )
    expect(screen.getByAltText('room.jpg')).toHaveAttribute('src', 'https://example.test/room.jpg')
    expect(screen.getByText(/re-upload your photos to continue/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /analyse/i })).toBeDisabled()
  })

  it.each([
    'http://localhost:3000/sample/lookalike.jpg',
    'https://other.example/sample/living-room.jpg',
    'http://localhost:3000/sample/living-room.jpg?x=1',
  ])('does not trust sample mode for a non-bundled ref: %s', (url) => {
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        ...EMPTY_SESSION,
        sample: true,
        step: 'upload',
        photoUrls: [url],
        photoRefs: [{ url, receipt: null }],
      }),
    )
    render(
      createElement(
        HelmetProvider,
        null,
        createElement(MemoryRouter, { initialEntries: ['/estimate'] }, createElement(EstimatePage)),
      ),
    )
    expect(screen.getByRole('button', { name: /analyse/i })).toBeDisabled()
  })

  it('does not treat a null-receipt own-photo ref as an upload', () => {
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        ...EMPTY_SESSION,
        step: 'upload',
        photoUrls: ['https://example.test/room.jpg'],
        photoRefs: [{ url: 'https://example.test/room.jpg', receipt: null }],
        sample: false,
      }),
    )
    render(
      createElement(
        HelmetProvider,
        null,
        createElement(MemoryRouter, { initialEntries: ['/estimate'] }, createElement(EstimatePage)),
      ),
    )
    expect(screen.getByRole('button', { name: /analyse/i })).toBeDisabled()
  })

  it('removing a legacy thumbnail removes its visible URL from the draft', async () => {
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        ...EMPTY_SESSION,
        version: 4,
        step: 'estimate',
        photoUrls: ['https://example.test/room.jpg'],
        analysis,
      }),
    )
    render(
      createElement(
        HelmetProvider,
        null,
        createElement(MemoryRouter, { initialEntries: ['/estimate'] }, createElement(EstimatePage)),
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(JSON.parse(window.sessionStorage.getItem(SESSION_KEY)!).photoUrls).toEqual([]))
  })

  it('preserves other migrated thumbnails and their URLs after one new photo upload', async () => {
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        ...EMPTY_SESSION,
        version: 4,
        step: 'upload',
        photoUrls: ['https://example.test/room-a.jpg', 'https://example.test/room-b.jpg'],
      }),
    )
    const OriginalURL = URL
    class TestURL extends OriginalURL {
      static createObjectURL() {
        return 'blob:replacement'
      }
      static revokeObjectURL() {}
    }
    vi.stubGlobal('URL', TestURL)
    vi.stubGlobal('createImageBitmap', undefined)
    class FakeXHR {
      upload = { onprogress: null }
      status = 200
      responseText = JSON.stringify({
        uploads: [{ url: 'https://example.test/new-room.jpg', receipt: 'opaque-test-receipt' }],
      })
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      open() {}
      send() {
        queueMicrotask(() => this.onload?.())
      }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXHR)
    render(
      createElement(
        HelmetProvider,
        null,
        createElement(MemoryRouter, { initialEntries: ['/estimate'] }, createElement(EstimatePage)),
      ),
    )
    expect(screen.getByAltText('room-a.jpg')).toBeInTheDocument()
    expect(screen.getByAltText('room-b.jpg')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /analyse/i })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Choose from library'), {
      target: { files: [new File(['image'], 'replacement.jpg', { type: 'image/jpeg' })] },
    })
    await waitFor(() =>
      expect(JSON.parse(window.sessionStorage.getItem(SESSION_KEY)!)).toMatchObject({
        photoRefs: [{ url: 'https://example.test/new-room.jpg', receipt: 'opaque-test-receipt' }],
      }),
    )
    expect(screen.getByAltText('room-a.jpg')).toBeInTheDocument()
    expect(screen.getByAltText('room-b.jpg')).toBeInTheDocument()
    expect(JSON.parse(window.sessionStorage.getItem(SESSION_KEY)!)).toMatchObject({
      photoUrls: [
        'https://example.test/room-a.jpg',
        'https://example.test/room-b.jpg',
        'https://example.test/new-room.jpg',
      ],
      needsPhotoReupload: true,
    })
    expect(screen.getByRole('button', { name: 'Analyse 1 photo' })).toBeEnabled()

    fireEvent.click(within(screen.getByAltText('room-a.jpg').closest('li')!).getByRole('button', { name: 'Remove' }))
    await waitFor(() =>
      expect(JSON.parse(window.sessionStorage.getItem(SESSION_KEY)!).photoUrls).toEqual([
        'https://example.test/room-b.jpg',
        'https://example.test/new-room.jpg',
      ]),
    )
    expect(screen.getByAltText('room-b.jpg')).toBeInTheDocument()

    const fetch = vi.fn(async (_path: string, _request: RequestInit) => Response.json(analysis))
    vi.stubGlobal('fetch', fetch)
    fireEvent.click(screen.getByRole('button', { name: 'Analyse 1 photo' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(JSON.parse((fetch.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
      sessionId: JSON.parse(window.sessionStorage.getItem(SESSION_KEY) ?? '{}').sessionId,
      photoRefs: [{ url: 'https://example.test/new-room.jpg', receipt: 'opaque-test-receipt' }],
      moveDetails: EMPTY_SESSION.moveDetails,
      sample: false,
    })
  })

  it('switching from sample to own photos removes sample cards and cannot analyze them', async () => {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(sampleSession('http://localhost:4610')))
    render(
      createElement(
        HelmetProvider,
        null,
        createElement(MemoryRouter, { initialEntries: ['/estimate'] }, createElement(EstimatePage)),
      ),
    )
    expect(screen.getByAltText('Living room')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Use my own photos' }))
    expect(screen.queryByAltText('Living room')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /analyse/i })).toBeDisabled()
    await waitFor(() =>
      expect(JSON.parse(window.sessionStorage.getItem(SESSION_KEY)!)).toMatchObject({
        sample: false,
        photoUrls: [],
        photoRefs: [],
      }),
    )
  })

  it('discards unknown steps and malformed JSON', () => {
    const store = new FakeStorage()
    store.setItem(SESSION_KEY, JSON.stringify({ ...EMPTY_SESSION, step: 'teleport' }))
    expect(loadSession(store)).toMatchObject({ ...EMPTY_SESSION, sessionId: expect.any(String) })
    store.setItem(SESSION_KEY, '{not json')
    expect(loadSession(store)).toMatchObject({ ...EMPTY_SESSION, sessionId: expect.any(String) })
    expect(store.getItem(SESSION_KEY)).toBeNull()
  })

  it('fills in fields a partial session is missing', () => {
    const store = new FakeStorage()
    store.setItem(SESSION_KEY, JSON.stringify({ version: SESSION_VERSION, step: 'details' }))
    const loaded = loadSession(store)
    expect(loaded.step).toBe('details')
    expect(loaded.items).toEqual([])
    expect(loaded.followUps).toEqual(EMPTY_SESSION.followUps)
  })

  it('clears the saved session', () => {
    const store = new FakeStorage()
    saveSession(EMPTY_SESSION, store)
    clearSession(store)
    expect(store.getItem(SESSION_KEY)).toBeNull()
  })

  it('seeds the sample move with details and three photos', () => {
    const session = sampleSession('http://localhost:4610')
    expect(session.sample).toBe(true)
    expect(session.step).toBe('upload')
    expect(session.chatFinished).toBe(true)
    expect(session.wholeMoveCovered).toBeNull()
    expect(session.moveDetails.distanceMiles).toBe(120)
    expect(session.moveDetails.originFloor).toBe(3)
    expect(session.moveDetails.originElevator).toBe(false)
    expect(session.photoUrls).toEqual([
      'http://localhost:4610/sample/living-room.jpg',
      'http://localhost:4610/sample/bedroom.jpg',
      'http://localhost:4610/sample/kitchen.jpg',
    ])
    expect(session.photoRefs).toEqual([
      { url: 'http://localhost:4610/sample/living-room.jpg', receipt: null },
      { url: 'http://localhost:4610/sample/bedroom.jpg', receipt: null },
      { url: 'http://localhost:4610/sample/kitchen.jpg', receipt: null },
    ])
    expect(session.needsPhotoReupload).toBe(false)
  })
})

describe('estimate review and API', () => {
  it('sends the analyze session, receipt refs and confirmed move details without chat', async () => {
    const fetch = vi.fn(async () => Response.json(analysis))
    vi.stubGlobal('fetch', fetch)
    const refs = [{ url: 'http://localhost:3000/api/images/room.jpg', receipt: 'opaque-test-receipt' }]
    const details = { ...EMPTY_SESSION.moveDetails, from: 'Boston, MA', originFloor: 3 }
    await analyzeApi(EMPTY_SESSION.sessionId, refs, details, false)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/analyze')
    expect(JSON.parse((fetch.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
      sessionId: EMPTY_SESSION.sessionId,
      photoRefs: refs,
      moveDetails: details,
      sample: false,
    })
  })
  it('sends the session ID in an upload and returns the receipt with its URL', async () => {
    let sent: FormData | null = null
    class FakeXHR {
      upload = { onprogress: null }
      status = 200
      responseText = JSON.stringify({
        uploads: [{ url: 'https://example.test/room.jpg', receipt: 'opaque-test-receipt' }],
      })
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      open() {}
      send(form: FormData) {
        sent = form
        this.onload?.()
      }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXHR)
    const file = new File(['image'], 'room.jpg', { type: 'image/jpeg' })
    expect(await uploadImage(file, '11111111-1111-4111-8111-111111111111')).toEqual({
      url: 'https://example.test/room.jpg',
      receipt: 'opaque-test-receipt',
    })
    expect((sent as FormData | null)?.get('sessionId')).toBe('11111111-1111-4111-8111-111111111111')
    expect((sent as FormData | null)?.get('images')).toBe(file)
  })

  it('sends the explicit review in the price request', async () => {
    const fetch = vi.fn(async () => Response.json({ price: savedPrice }))
    vi.stubGlobal('fetch', fetch)
    await priceApi(analysis, EMPTY_SESSION.moveDetails, review, true)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/price')
    expect(JSON.parse((fetch.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
      analysis,
      moveDetails: EMPTY_SESSION.moveDetails,
      review,
      sample: true,
    })
  })

  it('shows excluded photos in request order without exposing URLs or claiming relevance', () => {
    render(
      createElement(ReviewStep, {
        analysis: {
          ...analysis,
          photoLinkStatuses: [
            { url: 'https://private.example/a', status: 'unlinked', reason: 'Re-upload this photo.' },
            { url: 'https://private.example/b', status: 'eligible', reason: 'Not relevance tested.' },
            { url: 'https://private.example/c', status: 'unavailable', reason: 'Unsupported bytes.' },
          ],
        },
        items: analysis.items,
        followUps: review.followUps,
        wholeMoveCovered: null,
        onItemsChange: vi.fn(),
        onFollowUp: vi.fn(),
        onWholeMoveCovered: vi.fn(),
        onBack: vi.fn(),
        onConfirm: vi.fn(),
      }),
    )
    expect(screen.getByRole('list', { name: 'Photos excluded from inventory' }).textContent).toBe(
      'Photo 1: Re-upload this photo.Photo 3: Unsupported bytes.',
    )
    expect(screen.queryByText(/private\.example/)).not.toBeInTheDocument()
  })

  it('offers an explicit whole-move yes/no answer with pressed state', () => {
    const onWholeMoveCovered = vi.fn()
    const { rerender } = render(
      createElement(ReviewStep, {
        analysis,
        items: analysis.items,
        followUps: review.followUps,
        wholeMoveCovered: null,
        onItemsChange: vi.fn(),
        onFollowUp: vi.fn(),
        onWholeMoveCovered,
        onBack: vi.fn(),
        onConfirm: vi.fn(),
      }),
    )
    const group = screen.getByRole('group', { name: /whole move/i })
    const yes = group.querySelector('button:nth-of-type(1)')!
    const no = group.querySelector('button:nth-of-type(2)')!
    expect(yes).toHaveAttribute('aria-pressed', 'false')
    expect(no).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(yes)
    expect(onWholeMoveCovered).toHaveBeenCalledWith(true)
    rerender(
      createElement(ReviewStep, {
        analysis,
        items: analysis.items,
        followUps: review.followUps,
        wholeMoveCovered: true,
        onItemsChange: vi.fn(),
        onFollowUp: vi.fn(),
        onWholeMoveCovered,
        onBack: vi.fn(),
        onConfirm: vi.fn(),
      }),
    )
    expect(yes).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(no)
    expect(onWholeMoveCovered).toHaveBeenCalledWith(false)
  })

  it('consolidates saved couch and edited sofa rows before add, count edits, and removal', async () => {
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        ...EMPTY_SESSION,
        step: 'review',
        analysis: { ...analysis, specialHandling: [{ item: 'couch', reason: 'Needs extra movers' }] },
        items: [
          { type: 'Couch', count: 1 },
          { type: 'Sofa', count: 5 },
          { type: 'piano', count: 2 },
        ],
        price: savedPrice,
        estimateId: 'stale-id',
      }),
    )
    render(
      createElement(
        HelmetProvider,
        null,
        createElement(MemoryRouter, { initialEntries: ['/estimate'] }, createElement(EstimatePage)),
      ),
    )
    const savedItems = () => JSON.parse(window.sessionStorage.getItem(SESSION_KEY)!).items
    await waitFor(() =>
      expect(savedItems()).toEqual([
        { type: 'Sofa', count: 6 },
        { type: 'piano', count: 2 },
      ]),
    )
    expect(screen.getByLabelText('Sofa count')).toHaveTextContent('6')
    expect(screen.queryByLabelText('Couch count')).not.toBeInTheDocument()
    expect(screen.getByText('Needs extra movers')).toBeInTheDocument()
    expect(JSON.parse(window.sessionStorage.getItem(SESSION_KEY)!)).toMatchObject({ price: null, estimateId: null })

    fireEvent.change(screen.getByLabelText('Add something we missed'), { target: { value: 'couch' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(savedItems()).toEqual([
        { type: 'Sofa', count: 7 },
        { type: 'piano', count: 2 },
      ]),
    )
    fireEvent.click(screen.getByRole('button', { name: 'One more Sofa' }))
    await waitFor(() =>
      expect(savedItems()).toEqual([
        { type: 'Sofa', count: 8 },
        { type: 'piano', count: 2 },
      ]),
    )
    fireEvent.click(screen.getByRole('button', { name: 'One fewer Sofa' }))
    await waitFor(() =>
      expect(savedItems()).toEqual([
        { type: 'Sofa', count: 7 },
        { type: 'piano', count: 2 },
      ]),
    )
    fireEvent.click(within(screen.getByLabelText('Sofa count')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(savedItems()).toEqual([{ type: 'piano', count: 2 }]))
  })

  it('renders server reasons instead of claiming photos covered the move', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ movers: [] })),
    )
    render(
      createElement(EstimateStep, {
        analysis,
        items: analysis.items,
        moveDetails: EMPTY_SESSION.moveDetails,
        review,
        price: { ...savedPrice, confidence: 'low', confidenceReasons: ['Garage follow-up has not been answered.'] },
        estimateId: 'saved-id',
        photoUrls: [],
        sample: false,
        onPriced: vi.fn(),
        onBack: vi.fn(),
        onSchedule: vi.fn(),
      }),
    )
    expect(screen.getByText(/garage follow-up has not been answered/i)).toBeInTheDocument()
    expect(screen.queryByText(/photos and details covered the whole move/i)).not.toBeInTheDocument()
  })

  it('clears saved price and ID when the whole-move answer changes in the page', async () => {
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        ...EMPTY_SESSION,
        step: 'review',
        analysis,
        items: analysis.items,
        price: savedPrice,
        estimateId: 'saved-id',
      }),
    )
    render(
      createElement(
        HelmetProvider,
        null,
        createElement(MemoryRouter, { initialEntries: ['/estimate'] }, createElement(EstimatePage)),
      ),
    )
    const group = screen.getByRole('group', { name: /whole move/i })
    fireEvent.click(group.querySelector('button:nth-of-type(1)')!)
    await waitFor(() => expect(JSON.parse(window.sessionStorage.getItem(SESSION_KEY)!).wholeMoveCovered).toBe(true))
    expect(JSON.parse(window.sessionStorage.getItem(SESSION_KEY)!)).toMatchObject({ price: null, estimateId: null })
  })

  it('sends page review answers through EstimateStep before saving a fresh price', async () => {
    const fetch = vi.fn(async (path: string) => {
      if (path === '/api/price') return Response.json({ price: { ...savedPrice, confidenceReasons: [] } })
      if (path === '/api/estimates') return Response.json({ id: 'new-id', storage: 'memory' })
      if (path === '/api/movers') return Response.json({ movers: [] })
      throw new Error(`Unexpected route ${path}`)
    })
    vi.stubGlobal('fetch', fetch)
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ ...EMPTY_SESSION, step: 'review', analysis, items: analysis.items, ...review }),
    )
    render(
      createElement(
        HelmetProvider,
        null,
        createElement(MemoryRouter, { initialEntries: ['/estimate'] }, createElement(EstimatePage)),
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: /confirm and price it/i }))
    await waitFor(() => expect(JSON.parse(window.sessionStorage.getItem(SESSION_KEY)!).estimateId).toBe('new-id'))
    const priceCall = fetch.mock.calls.find(([path]) => path === '/api/price')!
    expect(JSON.parse((priceCall[1] as RequestInit).body as string)).toMatchObject({ review })
  })

  it('does not restore a stale in-flight price after returning to review and changing coverage', async () => {
    let resolvePrice!: (response: Response) => void
    const pendingPrice = new Promise<Response>((resolve) => {
      resolvePrice = resolve
    })
    const fetch = vi.fn(async (path: string) => {
      if (path === '/api/price') return pendingPrice
      if (path === '/api/movers') return Response.json({ movers: [] })
      if (path === '/api/estimates') return Response.json({ id: 'stale-id', storage: 'memory' })
      throw new Error(`Unexpected route ${path}`)
    })
    vi.stubGlobal('fetch', fetch)
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        ...EMPTY_SESSION,
        step: 'estimate',
        analysis,
        items: analysis.items,
        ...review,
      }),
    )
    render(
      createElement(
        HelmetProvider,
        null,
        createElement(MemoryRouter, { initialEntries: ['/estimate'] }, createElement(EstimatePage)),
      ),
    )
    await waitFor(() => expect(fetch.mock.calls.some(([path]) => path === '/api/price')).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: /review/i }))
    fireEvent.click(screen.getByRole('group', { name: /whole move/i }).querySelector('button:nth-of-type(2)')!)
    await act(async () => {
      resolvePrice(Response.json({ price: savedPrice }))
    })
    expect(JSON.parse(window.sessionStorage.getItem(SESSION_KEY)!)).toMatchObject({
      step: 'review',
      wholeMoveCovered: false,
      price: null,
      estimateId: null,
    })
    expect(fetch.mock.calls.some(([path]) => path === '/api/estimates')).toBe(false)
  })

  it('invalidates price and resets all coverage answers when a photo is removed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        ...EMPTY_SESSION,
        step: 'upload',
        photoUrls: ['https://example.test/a.jpg'],
        photoRefs: [{ url: 'https://example.test/a.jpg', receipt: 'opaque-test-receipt' }],
        analysis,
        items: analysis.items,
        followUps: review.followUps,
        wholeMoveCovered: true,
        price: savedPrice,
        estimateId: 'saved-id',
      }),
    )
    render(
      createElement(
        HelmetProvider,
        null,
        createElement(MemoryRouter, { initialEntries: ['/estimate'] }, createElement(EstimatePage)),
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(JSON.parse(window.sessionStorage.getItem(SESSION_KEY)!).photoUrls).toEqual([]))
    expect(JSON.parse(window.sessionStorage.getItem(SESSION_KEY)!)).toMatchObject({
      analysis: null,
      followUps: { garage: null, closets: null, appliances: null },
      wholeMoveCovered: null,
      price: null,
      estimateId: null,
    })
  })

  it('invalidates price and resets coverage answers after reanalysis', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        if (path === '/api/analyze') return Response.json(analysis)
        throw new Error(`Unexpected route ${path}`)
      }),
    )
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        ...EMPTY_SESSION,
        step: 'upload',
        photoUrls: ['https://example.test/a.jpg'],
        photoRefs: [{ url: 'https://example.test/a.jpg', receipt: 'opaque-test-receipt' }],
        analysis,
        items: analysis.items,
        followUps: review.followUps,
        wholeMoveCovered: true,
        price: savedPrice,
        estimateId: 'saved-id',
      }),
    )
    render(
      createElement(
        HelmetProvider,
        null,
        createElement(MemoryRouter, { initialEntries: ['/estimate'] }, createElement(EstimatePage)),
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Analyse again' }))
    await waitFor(() => expect(JSON.parse(window.sessionStorage.getItem(SESSION_KEY)!).step).toBe('review'))
    expect(JSON.parse(window.sessionStorage.getItem(SESSION_KEY)!)).toMatchObject({
      items: analysis.items,
      followUps: { garage: null, closets: null, appliances: null },
      wholeMoveCovered: null,
      price: null,
      estimateId: null,
    })
  })
})
