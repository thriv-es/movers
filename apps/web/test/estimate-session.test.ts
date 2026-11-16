/** Session migrations, receipt safety and isolated legacy component contracts.
 * Continuous page operation/review regressions live in conversation-flow.test.tsx.
 */
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { HelmetProvider } from 'react-helmet-async'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReviewStep } from '../src/components/estimate/ReviewStep'
import { EstimateStep } from '../src/components/estimate/EstimateStep'
import EstimatePage from '../src/pages/estimate.page'
import { analyzeApi, priceApi, uploadImage } from '../src/lib/api-client'
import { photoEvidence, reviewedAnalysis } from '../src/lib/review-photos'
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
const savedPrice = {
  currency: 'USD',
  total: 100,
  low: 90,
  high: 110,
  breakdown: { labor: 100 },
  confidence: 'high' as const,
}
const review = { followUps: { garage: false, closets: false, appliances: false }, wholeMoveCovered: true }
function mountLegacy(patch: Record<string, unknown>) {
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...EMPTY_SESSION, ...patch }))
  return render(createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(EstimatePage))))
}
const draft = () => JSON.parse(window.sessionStorage.getItem(SESSION_KEY) ?? '{}')
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
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
})
afterEach(() => {
  cleanup()
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
      JSON.stringify({ ...EMPTY_SESSION, version: 4, step: 'review', photoUrls: [], analysis, price: savedPrice }),
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
    mountLegacy({ version: 4, step: 'estimate', photoUrls: ['https://example.test/room.jpg'], analysis })
    expect(screen.getByAltText('room.jpg')).toHaveAttribute('src', 'https://example.test/room.jpg')
    expect(screen.getByText(/re-upload your photos to continue/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /analyse/i })).toBeDisabled()
  })
  it.each([
    'http://localhost:3000/sample/lookalike.jpg',
    'https://other.example/sample/living-room.jpg',
    'http://localhost:3000/sample/living-room.jpg?x=1',
  ])('does not trust sample mode for a non-bundled ref: %s', (url) => {
    mountLegacy({ sample: true, step: 'upload', photoUrls: [url], photoRefs: [{ url, receipt: null }] })
    expect(screen.getByRole('button', { name: /analyse/i })).toBeDisabled()
  })
  it('does not treat a null-receipt own-photo ref as an upload', () => {
    mountLegacy({
      step: 'upload',
      photoUrls: ['https://example.test/room.jpg'],
      photoRefs: [{ url: 'https://example.test/room.jpg', receipt: null }],
      sample: false,
    })
    expect(screen.getByRole('button', { name: /analyse/i })).toBeDisabled()
  })
  it('removing a legacy thumbnail removes its visible URL from the draft', async () => {
    mountLegacy({ version: 4, step: 'estimate', photoUrls: ['https://example.test/room.jpg'], analysis })
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(draft().photoUrls).toEqual([]))
  })
  it('preserves migrated thumbnails after a new upload, requires their explicit removal and details confirmation', async () => {
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL() {
          return 'blob:replacement'
        }
        static revokeObjectURL() {}
      },
    )
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
    mountLegacy({
      version: 4,
      step: 'upload',
      moveDetails: sampleSession(window.location.origin).moveDetails,
      photoUrls: ['https://example.test/room-a.jpg', 'https://example.test/room-b.jpg'],
    })
    fireEvent.change(screen.getByLabelText('Choose from library'), {
      target: { files: [new File(['image'], 'replacement.jpg', { type: 'image/jpeg' })] },
    })
    await waitFor(() =>
      expect(draft().photoRefs).toEqual([{ url: 'https://example.test/new-room.jpg', receipt: 'opaque-test-receipt' }]),
    )
    expect(screen.getByAltText('room-a.jpg')).toBeInTheDocument()
    expect(screen.getByAltText('room-b.jpg')).toBeInTheDocument()
    expect(draft()).toMatchObject({
      photoUrls: [
        'https://example.test/room-a.jpg',
        'https://example.test/room-b.jpg',
        'https://example.test/new-room.jpg',
      ],
      needsPhotoReupload: true,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm move details' }))
    expect(screen.getByRole('button', { name: 'Analyse 1 photo' })).toBeDisabled()
    for (const name of ['room-a.jpg', 'room-b.jpg'])
      fireEvent.click(
        within(screen.getByAltText(name).closest('li') as HTMLElement).getByRole('button', { name: 'Remove' }),
      )
    expect(draft().needsPhotoReupload).toBe(false)
    expect(screen.getByRole('button', { name: 'Analyse 1 photo' })).toBeEnabled()
    const fetch = vi.fn(async (_path: string, _request: RequestInit) => Response.json(analysis))
    vi.stubGlobal('fetch', fetch)
    fireEvent.click(screen.getByRole('button', { name: 'Analyse 1 photo' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body as string)).toEqual({
      sessionId: draft().sessionId,
      photoRefs: [{ url: 'https://example.test/new-room.jpg', receipt: 'opaque-test-receipt' }],
      moveDetails: sampleSession(window.location.origin).moveDetails,
      sample: false,
    })
  })
  it('switching from sample to own photos removes sample cards and cannot analyze them', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mountLegacy(sampleSession(window.location.origin))
    expect(screen.getByAltText('Living room')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Use my own photos' }))
    expect(screen.queryByAltText('Living room')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /analyse/i })).toBeDisabled()
    expect(draft()).toMatchObject({ sample: false, photoUrls: [], photoRefs: [] })
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
    expect(loadSession(store)).toMatchObject({ step: 'details', items: [], followUps: EMPTY_SESSION.followUps })
  })
  it('clears the saved session', () => {
    const store = new FakeStorage()
    saveSession(EMPTY_SESSION, store)
    clearSession(store)
    expect(store.getItem(SESSION_KEY)).toBeNull()
  })
  it('seeds the sample move with details and three photos', () => {
    const session = sampleSession('http://localhost:4610')
    expect(session).toMatchObject({
      sample: true,
      step: 'upload',
      chatFinished: true,
      wholeMoveCovered: null,
      needsPhotoReupload: false,
      moveDetails: { distanceMiles: 120, originFloor: 3, originElevator: false },
    })
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
  })
})

describe('review arithmetic and API (retained legacy contracts)', () => {
  const mixed = {
    ...analysis,
    photoAssessments: [
      { url: 'https://example.test/a.jpg', status: 'relevant' as const, reason: 'Usable furniture.' },
      {
        url: 'https://example.test/b.jpg',
        status: 'uncertain' as const,
        reason: 'Please check this photo.',
        candidates: {
          items: [{ type: 'couch', count: 2 }],
          total_volume_cubic_feet: 160,
          estimated_boxes_min: 3,
          estimated_boxes_max: 5,
        },
      },
      { url: 'https://example.test/c.jpg', status: 'unrelated' as const, reason: 'Not moving inventory.' },
    ],
  }
  it('merges kept candidate volume, boxes and aliases without changing original evidence', () => {
    const result = reviewedAnalysis(mixed, { 'https://example.test/b.jpg': 'keep' })
    expect(result.items).toEqual([{ type: 'sofa', count: 3 }])
    expect(result.totalVolumeCubicFeet).toBe(240)
    expect(result.estimatedBoxes).toEqual({ min: 5, max: 9 })
    expect(mixed.items).toEqual([{ type: 'sofa', count: 1 }])
    expect(photoEvidence(mixed, {})).toEqual({ excludedCount: 1, unresolvedCount: 1 })
    expect(photoEvidence(mixed, { 'https://example.test/b.jpg': 'exclude' })).toEqual({
      excludedCount: 2,
      unresolvedCount: 0,
    })
  })
  it('uses the existing box fallback for kept candidates without model box counts', () => {
    const candidate = {
      ...mixed,
      photoAssessments: [
        {
          url: 'b',
          status: 'uncertain' as const,
          reason: 'Check',
          candidates: { items: [{ type: 'table', count: 1 }], total_volume_cubic_feet: 20 },
        },
      ],
    }
    expect(reviewedAnalysis(candidate, { b: 'keep' }).estimatedBoxes).toEqual({ min: 7, max: 14 })
  })
  it('sends analyze session, receipt refs and confirmed details without chat', async () => {
    const fetch = vi.fn(async (_path: string, _request: RequestInit) => Response.json(analysis))
    vi.stubGlobal('fetch', fetch)
    const refs = [{ url: 'http://localhost:3000/api/images/room.jpg', receipt: 'opaque-test-receipt' }]
    const details = { ...EMPTY_SESSION.moveDetails, from: 'Boston, MA', originFloor: 3 }
    await analyzeApi(EMPTY_SESSION.sessionId, refs, details, false)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/analyze')
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body as string)).toEqual({
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
    const fetch = vi.fn(async (_path: string, _request: RequestInit) => Response.json({ price: savedPrice }))
    vi.stubGlobal('fetch', fetch)
    await priceApi(analysis, EMPTY_SESSION.moveDetails, review, true)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/price')
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body as string)).toEqual({
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
    const props = {
      analysis,
      items: analysis.items,
      followUps: review.followUps,
      wholeMoveCovered: null as boolean | null,
      onItemsChange: vi.fn(),
      onFollowUp: vi.fn(),
      onWholeMoveCovered,
      onBack: vi.fn(),
      onConfirm: vi.fn(),
    }
    const { rerender } = render(createElement(ReviewStep, props))
    const group = screen.getByRole('group', { name: /whole move/i })
    const yes = within(group).getByRole('button', { name: 'Yes' })
    const no = within(group).getByRole('button', { name: 'No' })
    expect(yes).toHaveAttribute('aria-pressed', 'false')
    expect(no).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(yes)
    expect(onWholeMoveCovered).toHaveBeenCalledWith(true)
    rerender(createElement(ReviewStep, { ...props, wholeMoveCovered: true }))
    expect(yes).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(no)
    expect(onWholeMoveCovered).toHaveBeenCalledWith(false)
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
    await act(async () => {})
  })
})
