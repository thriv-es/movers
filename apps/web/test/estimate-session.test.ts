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
    expect(screen.getByRole('button', { name: 'Analyse 1 photo' })).toBeDisabled()

    fireEvent.click(within(screen.getByAltText('room-a.jpg').closest('li')!).getByRole('button', { name: 'Remove' }))
    await waitFor(() =>
      expect(JSON.parse(window.sessionStorage.getItem(SESSION_KEY)!).photoUrls).toEqual([
        'https://example.test/room-b.jpg',
        'https://example.test/new-room.jpg',
      ]),
    )
    expect(screen.getByAltText('room-b.jpg')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Analyse 1 photo' })).toBeDisabled()
    fireEvent.click(within(screen.getByAltText('room-b.jpg').closest('li')!).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(JSON.parse(window.sessionStorage.getItem(SESSION_KEY)!).needsPhotoReupload).toBe(false))
    expect(screen.getByRole('button', { name: 'Analyse 1 photo' })).toBeEnabled()

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

describe('request-aware photo review', () => {
  const mixed = {
    ...analysis,
    visionRevision: 1,
    visionFingerprint: 'current-vision',
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
  function mount(step = 'review', fingerprint = 'current-vision', responseAnalysis = mixed) {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        calls.push(path)
        if (path === '/api/ai-status') return Response.json({ visionRevision: 99, visionFingerprint: fingerprint })
        if (path === '/api/movers') return Response.json({ movers: [] })
        throw new Error(`Unexpected ${path}`)
      }),
    )
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        ...EMPTY_SESSION,
        step,
        analysis: responseAnalysis,
        items: responseAnalysis.items,
        moveDetails: sampleSession(window.location.origin).moveDetails,
        ...review,
        price: savedPrice,
        estimateId: 'old-id',
      }),
    )
    const view = render(
      createElement(
        HelmetProvider,
        null,
        createElement(MemoryRouter, { initialEntries: ['/estimate'] }, createElement(EstimatePage)),
      ),
    )
    return { ...view, calls }
  }
  const draft = () => JSON.parse(window.sessionStorage.getItem(SESSION_KEY) ?? '{}')

  const uncertainOnly = {
    ...mixed,
    items: [],
    totalVolumeCubicFeet: 0,
    estimatedBoxes: { min: 0, max: 0 },
    photoAssessments: mixed.photoAssessments.slice(1, 2),
  }

  it('keeps uncertain-only inventory empty until every decision resolves, persists Keep, then prices accepted totals', async () => {
    const view = mount('review', 'current-vision', {
      ...uncertainOnly,
      photoAssessments: [
        ...uncertainOnly.photoAssessments,
        { url: 'https://example.test/d.jpg', status: 'uncertain', reason: 'Check another photo.' },
      ],
    })
    expect(screen.getByRole('button', { name: 'Confirm and price it' })).toBeDisabled()
    expect(screen.getByLabelText('Add something we missed')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Keep photo 1' }))
    expect(draft().items).toEqual([])
    expect(screen.getByLabelText('Add something we missed')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Exclude photo 2' }))
    expect(draft().items).toEqual([{ type: 'sofa', count: 2 }])
    expect(draft().analysis.items).toEqual([])
    expect(screen.getByRole('button', { name: 'Confirm and price it' })).toBeEnabled()
    view.unmount()
    render(
      createElement(
        HelmetProvider,
        null,
        createElement(MemoryRouter, { initialEntries: ['/estimate'] }, createElement(EstimatePage)),
      ),
    )
    expect(screen.getByRole('button', { name: 'Keep photo 1' })).toHaveAttribute('aria-pressed', 'true')
    expect(draft().items).toEqual([{ type: 'sofa', count: 2 }])
    let priced: unknown
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, request?: RequestInit) => {
        if (path === '/api/ai-status') return Response.json({ visionRevision: 99, visionFingerprint: 'current-vision' })
        if (path === '/api/movers') return Response.json({ movers: [] })
        if (path === '/api/price') {
          priced = JSON.parse(request?.body as string)
          return Response.json({ price: savedPrice })
        }
        if (path === '/api/estimates') return Response.json({ id: 'kept-id', storage: 'memory' })
        throw new Error(`Unexpected ${path}`)
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and price it' }))
    await waitFor(() => expect(draft().estimateId).toBe('kept-id'))
    expect(priced).toMatchObject({
      analysis: {
        items: [{ type: 'sofa', count: 2 }],
        totalVolumeCubicFeet: 160,
        estimatedBoxes: { min: 3, max: 5 },
        visionFingerprint: 'current-vision',
      },
      review: { photoEvidence: { excludedCount: 1, unresolvedCount: 0 } },
    })
  })

  it('keeps Exclude-all empty and blocks pricing until inventory is explicitly added', async () => {
    const { calls } = mount('review', 'current-vision', uncertainOnly)
    fireEvent.click(screen.getByRole('button', { name: 'Exclude photo 1' }))
    expect(draft().items).toEqual([])
    expect(screen.getByRole('button', { name: 'Confirm and price it' })).toBeDisabled()
    expect(screen.getByText(/add an item or return to photos before pricing/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and price it' }))
    await act(async () => {})
    expect(draft().step).toBe('review')
    expect(calls).not.toContain('/api/price')
    expect(calls).not.toContain('/api/estimates')
    fireEvent.change(screen.getByLabelText('Add something we missed'), { target: { value: 'table' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true }))
    expect(draft().items).toEqual([{ type: 'table', count: 1 }])
    expect(screen.getByRole('button', { name: 'Confirm and price it' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Keep photo 1' })).toBeDisabled()
  })

  it('blocks restored empty estimates from pricing or lead writes even when all photos were excluded', async () => {
    const view = mount('review', 'current-vision', uncertainOnly)
    fireEvent.click(screen.getByRole('button', { name: 'Exclude photo 1' }))
    const saved = draft()
    view.unmount()
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...saved, step: 'estimate' }))
    render(
      createElement(
        HelmetProvider,
        null,
        createElement(MemoryRouter, { initialEntries: ['/estimate'] }, createElement(EstimatePage)),
      ),
    )
    await screen.findByText(/add an item or return to photos before pricing/i)
    expect(screen.queryByRole('region', { name: 'Your estimate' })).not.toBeInTheDocument()
    expect(view.calls).not.toContain('/api/price')
    expect(view.calls).not.toContain('/api/estimates')
  })

  it.each(['review', 'estimate'])(
    'invalidates stale uncertain-only evidence on %s re-entry without pricing or lead writes',
    async (step) => {
      const { calls } = mount(step, 'new-vision', uncertainOnly)
      await waitFor(() => expect(draft().step).toBe('upload'))
      expect(draft()).toMatchObject({ analysis: null, items: [], photoDecisions: {}, price: null, estimateId: null })
      expect(calls).not.toContain('/api/price')
      expect(calls).not.toContain('/api/estimates')
    },
  )

  it.each(['keep', 'exclude'] as const)(
    'persists %s and gates edits, merges only kept aliases, then locks decisions',
    async (decision) => {
      const view = mount()
      await screen.findByRole('button', { name: 'Keep photo 2' })
      expect(screen.getByAltText('Selected upload 2 to review')).toHaveAttribute('src', 'https://example.test/b.jpg')
      expect(screen.getByText(/Not moving inventory/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Confirm and price it' })).toBeDisabled()
      expect(screen.getByLabelText('Add something we missed')).toBeDisabled()
      expect(draft().items).toEqual([{ type: 'sofa', count: 1 }])
      fireEvent.click(screen.getByRole('button', { name: `${decision === 'keep' ? 'Keep' : 'Exclude'} photo 2` }))
      await waitFor(() => expect(draft().photoDecisions).toEqual({ 'https://example.test/b.jpg': decision }))
      expect(draft()).toMatchObject({ price: null, estimateId: null })
      expect(draft().items).toEqual([{ type: 'sofa', count: decision === 'keep' ? 3 : 1 }])
      expect(screen.getByRole('button', { name: 'Confirm and price it' })).toBeEnabled()
      fireEvent.click(screen.getByRole('button', { name: 'One more sofa' }))
      expect(screen.getByRole('button', { name: 'Keep photo 2' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Exclude photo 2' })).toBeDisabled()
      view.unmount()
      render(
        createElement(
          HelmetProvider,
          null,
          createElement(MemoryRouter, { initialEntries: ['/estimate'] }, createElement(EstimatePage)),
        ),
      )
      await waitFor(() => expect(screen.getByRole('button', { name: 'Keep photo 2' })).toBeDisabled())
      expect(draft().photoDecisions['https://example.test/b.jpg']).toBe(decision)
    },
  )

  it.each(['review', 'estimate'])(
    'invalidates stale vision on %s load without pricing or lead writes',
    async (step) => {
      const { calls } = mount(step, 'new-vision')
      await waitFor(() => expect(draft().step).toBe('upload'))
      expect(draft()).toMatchObject({ analysis: null, price: null, estimateId: null, photoDecisions: {} })
      expect(calls).not.toContain('/api/price')
      expect(calls).not.toContain('/api/estimates')
    },
  )

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

  it.each(['preprice-change', 'server-409'] as const)(
    'requires reanalysis for %s and never saves a lead',
    async (failure) => {
      mount()
      fireEvent.click(await screen.findByRole('button', { name: 'Keep photo 2' }))
      let checks = 0
      const calls: string[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async (path: string) => {
          calls.push(path)
          if (path === '/api/ai-status')
            return Response.json({
              visionRevision: 2,
              visionFingerprint: failure === 'preprice-change' && ++checks > 1 ? 'changed' : 'current-vision',
            })
          if (path === '/api/movers') return Response.json({ movers: [] })
          if (path === '/api/price')
            return Response.json({ code: 'REANALYZE_REQUIRED', error: 'Analyze again.' }, { status: 409 })
          throw new Error(`Unexpected ${path}`)
        }),
      )
      fireEvent.click(screen.getByRole('button', { name: 'Confirm and price it' }))
      await waitFor(() => expect(draft().step).toBe('upload'))
      expect(draft()).toMatchObject({ analysis: null, price: null, estimateId: null })
      expect(calls).not.toContain('/api/estimates')
      expect(calls.includes('/api/price')).toBe(failure === 'server-409')
    },
  )

  it('resets photo decisions on return to Photos and shows skipped reasons there', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Exclude photo 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(draft()).toMatchObject({ step: 'upload', photoDecisions: {}, photoDecisionsLocked: false })
    expect(screen.getByText(/Photo 3: Not moving inventory/)).toBeInTheDocument()
  })

  it('clears evidence and decisions when confirmed move details change', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Keep photo 2' }))
    fireEvent.click(screen.getByRole('button', { name: /2 Details/i }))
    fireEvent.change(screen.getByLabelText('Moving from'), { target: { value: 'A' } })
    fireEvent.change(screen.getByLabelText('Moving to'), { target: { value: 'B' } })
    fireEvent.change(screen.getByLabelText('Distance (miles)'), { target: { value: '10' } })
    fireEvent.submit(screen.getByRole('form', { name: 'Move details' }))
    await waitFor(() =>
      expect(draft()).toMatchObject({
        step: 'upload',
        analysis: null,
        photoDecisions: {},
        photoDecisionsLocked: false,
        items: [],
        price: null,
        estimateId: null,
      }),
    )
  })

  it('shows genuinely empty uncertain-photo failure reasons on Photos and cannot restore an old review', async () => {
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        ...EMPTY_SESSION,
        step: 'upload',
        analysis: mixed,
        items: mixed.items,
        photoUrls: ['https://example.test/b.jpg'],
        photoRefs: [{ url: 'https://example.test/b.jpg', receipt: 'receipt' }],
        photoDecisions: { 'https://example.test/b.jpg': 'keep' },
        photoDecisionsLocked: true,
        price: savedPrice,
        estimateId: 'old-id',
      }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          {
            code: 'NO_USABLE_PHOTOS',
            error: 'Upload clearer usable photos.',
            photoAssessments: [{ ...mixed.photoAssessments[1], candidates: { items: [], total_volume_cubic_feet: 0 } }],
          },
          { status: 400 },
        ),
      ),
    )
    render(
      createElement(
        HelmetProvider,
        null,
        createElement(MemoryRouter, { initialEntries: ['/estimate'] }, createElement(EstimatePage)),
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Analyse again' }))
    await screen.findByText(/Photo 1: Please check this photo/)
    expect(screen.queryByRole('button', { name: 'Keep photo 1' })).not.toBeInTheDocument()
    expect(draft()).toMatchObject({ step: 'upload', analysis: null, photoDecisions: {}, price: null, estimateId: null })
  })

  it.each(['photos', 'details'] as const)(
    'restores failed photo reasons after refresh and clears them on %s changes',
    async (change) => {
      const session = sampleSession(window.location.origin)
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
      const assessments = [
        { url: session.photoUrls[0], status: 'unrelated', reason: 'No movable inventory was found.' },
      ]
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          Response.json(
            {
              code: 'NO_USABLE_PHOTOS',
              error: 'Upload usable photos.',
              photoAssessments: assessments,
            },
            { status: 400 },
          ),
        ),
      )
      const mountPage = () =>
        render(
          createElement(
            HelmetProvider,
            null,
            createElement(MemoryRouter, { initialEntries: ['/estimate'] }, createElement(EstimatePage)),
          ),
        )
      const view = mountPage()
      fireEvent.click(screen.getByRole('button', { name: 'Analyse 3 photos' }))
      await screen.findByText(/Photo 1: No movable inventory/)
      expect(draft()).toMatchObject({ analysis: null, failedPhotoAssessments: assessments, price: null })
      view.unmount()
      mountPage()
      expect(screen.getByText(/Photo 1: No movable inventory/)).toBeInTheDocument()
      if (change === 'photos') fireEvent.click(screen.getByRole('button', { name: 'Use my own photos' }))
      else {
        fireEvent.click(screen.getByRole('button', { name: /2 Details/i }))
        fireEvent.change(screen.getByLabelText('Distance (miles)'), { target: { value: '99' } })
        fireEvent.submit(screen.getByRole('form', { name: 'Move details' }))
      }
      await waitFor(() => expect(draft().failedPhotoAssessments).toEqual([]))
      expect(screen.queryByText(/Photo 1: No movable inventory/)).not.toBeInTheDocument()
    },
  )

  it('retains last failure reasons during a retry and clears them after successful analysis', async () => {
    const session = sampleSession(window.location.origin)
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
    let finish!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => {
      finish = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        if (path === '/api/ai-status') return Response.json({ visionRevision: 1, visionFingerprint: 'current-vision' })
        return Response.json(
          { code: 'NO_USABLE_PHOTOS', error: 'Try again.', photoAssessments: [mixed.photoAssessments[1]] },
          { status: 400 },
        )
      }),
    )
    render(
      createElement(
        HelmetProvider,
        null,
        createElement(MemoryRouter, { initialEntries: ['/estimate'] }, createElement(EstimatePage)),
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Analyse 3 photos' }))
    await screen.findByText(/Photo 1: Please check this photo/)
    expect(draft().failedPhotoAssessments).toEqual([
      { url: 'https://example.test/b.jpg', status: 'uncertain', reason: 'Please check this photo.' },
    ])
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) =>
        path === '/api/ai-status' ? Response.json({ visionRevision: 1, visionFingerprint: 'current-vision' }) : pending,
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Analyse 3 photos' }))
    expect(screen.getByText(/Photo 1: Please check this photo/)).toBeInTheDocument()
    expect(draft().failedPhotoAssessments).toHaveLength(1)
    await act(async () => {
      finish(Response.json(analysis))
    })
    await waitFor(() => expect(draft()).toMatchObject({ step: 'review', analysis, failedPhotoAssessments: [] }))
  })

  it('does not restore old analysis after leaving Photos and changing details during analysis', async () => {
    let finish!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => {
      finish = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => pending),
    )
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...sampleSession(window.location.origin) }))
    render(
      createElement(
        HelmetProvider,
        null,
        createElement(MemoryRouter, { initialEntries: ['/estimate'] }, createElement(EstimatePage)),
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Analyse 3 photos' }))
    fireEvent.click(screen.getByRole('button', { name: /2 Details/i }))
    fireEvent.change(screen.getByLabelText('Distance (miles)'), { target: { value: '99' } })
    fireEvent.submit(screen.getByRole('form', { name: 'Move details' }))
    await act(async () => {
      finish(Response.json(mixed))
    })
    expect(draft()).toMatchObject({ step: 'upload', analysis: null, moveDetails: { distanceMiles: 99 } })
  })

  it('keeps the relevant starting inventory until every uncertain photo is decided', async () => {
    mount('review', 'current-vision', {
      ...mixed,
      photoAssessments: [
        ...mixed.photoAssessments,
        {
          url: 'https://example.test/d.jpg',
          status: 'uncertain',
          reason: 'Check another photo.',
          candidates: { items: [{ type: 'table', count: 1 }], total_volume_cubic_feet: 20 },
        },
      ],
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Keep photo 2' }))
    expect(draft().items).toEqual([{ type: 'sofa', count: 1 }])
    expect(screen.getByRole('button', { name: 'Confirm and price it' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Exclude photo 4' }))
    expect(draft().items).toEqual([{ type: 'sofa', count: 3 }])
    expect(screen.getByRole('button', { name: 'Confirm and price it' })).toBeEnabled()
  })

  it('resets decisions when returning through unchanged move details to Photos', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Keep photo 2' }))
    fireEvent.click(screen.getByRole('button', { name: /2 Details/i }))
    fireEvent.submit(screen.getByRole('form', { name: 'Move details' }))
    expect(draft()).toMatchObject({
      step: 'upload',
      photoDecisions: {},
      photoDecisionsLocked: false,
      items: [{ type: 'sofa', count: 1 }],
      price: null,
      estimateId: null,
    })
  })

  it.each(['keep', 'exclude'] as const)('sends %s evidence and only accepted totals to pricing', async (decision) => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: `${decision === 'keep' ? 'Keep' : 'Exclude'} photo 2` }))
    let priced: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, request?: RequestInit) => {
        if (path === '/api/ai-status') return Response.json({ visionRevision: 99, visionFingerprint: 'current-vision' })
        if (path === '/api/movers') return Response.json({ movers: [] })
        if (path === '/api/price') {
          priced = JSON.parse(request?.body as string)
          return Response.json({ price: savedPrice })
        }
        if (path === '/api/estimates') return Response.json({ id: 'fresh-id', storage: 'memory' })
        throw new Error(`Unexpected ${path}`)
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and price it' }))
    await waitFor(() => expect(draft().estimateId).toBe('fresh-id'))
    expect(priced).toMatchObject({
      analysis: {
        items: [{ type: 'sofa', count: decision === 'keep' ? 3 : 1 }],
        totalVolumeCubicFeet: decision === 'keep' ? 240 : 80,
      },
      review: { photoEvidence: { excludedCount: decision === 'keep' ? 1 : 2, unresolvedCount: 0 } },
    })
  })

  it('does not invalidate vision on global revision-only changes', async () => {
    mount()
    await screen.findByRole('button', { name: 'Keep photo 2' })
    expect(draft().analysis.visionFingerprint).toBe('current-vision')
    expect(draft().step).toBe('review')
  })
})

describe('saved estimate re-entry freshness', () => {
  const currentStatus = { visionRevision: 1, visionFingerprint: 'current-vision' }
  const mover = { id: 'mover-1', name: 'Test Mover', slug: 'test-mover', serviceArea: 'Boston' }

  async function enterSchedule(recheck: () => Promise<Response>) {
    let checks = 0
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        calls.push(path)
        if (path === '/api/ai-status') return ++checks === 2 ? recheck() : Response.json(currentStatus)
        if (path === '/api/movers') return Response.json({ movers: [mover] })
        throw new Error(`Unexpected route ${path}`)
      }),
    )
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        ...EMPTY_SESSION,
        step: 'estimate',
        analysis,
        items: analysis.items,
        ...review,
        moveDetails: sampleSession(window.location.origin).moveDetails,
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
    const schedule = await screen.findByRole('button', { name: 'Schedule the move' })
    await screen.findByRole('checkbox')
    expect(screen.getByRole('region', { name: 'Your estimate' })).toBeInTheDocument()
    fireEvent.click(schedule)
    expect(screen.getByRole('form', { name: 'Schedule your move' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    return calls
  }

  function expectSavedActionsGated() {
    expect(screen.queryByRole('region', { name: 'Your estimate' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Schedule the move' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /for quotes/i })).not.toBeInTheDocument()
  }

  it('hides saved-price actions during delayed Schedule-to-Estimate revalidation, then restores them on success', async () => {
    let finish!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => {
      finish = resolve
    })
    const calls = await enterSchedule(() => pending)
    expectSavedActionsGated()
    expect(screen.getByRole('status')).toHaveTextContent(/checking photo analysis settings/i)
    await act(async () => {
      finish(Response.json(currentStatus))
    })
    expect(await screen.findByRole('button', { name: 'Schedule the move' })).toBeEnabled()
    fireEvent.click(await screen.findByRole('checkbox'))
    expect(screen.getByRole('button', { name: /for quotes/i })).toBeEnabled()
    expect(calls).not.toContain('/api/price')
    expect(calls).not.toContain('/api/estimates')
  })

  it('keeps saved-price actions gated after failed revalidation and recovers only after a new successful check', async () => {
    const calls = await enterSchedule(async () => Response.json({ error: 'Status unavailable' }, { status: 503 }))
    await screen.findByRole('alert')
    expectSavedActionsGated()
    expect(screen.getByRole('status')).toHaveTextContent(/unable to check/i)
    expect(JSON.parse(window.sessionStorage.getItem(SESSION_KEY) ?? '{}')).toMatchObject({
      price: savedPrice,
      estimateId: 'saved-id',
      step: 'estimate',
    })
    fireEvent.click(screen.getByRole('button', { name: /4 Review/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm and price it' }))
    expect(await screen.findByRole('button', { name: 'Schedule the move' })).toBeEnabled()
    fireEvent.click(await screen.findByRole('checkbox'))
    expect(screen.getByRole('button', { name: /for quotes/i })).toBeEnabled()
    expect(calls).not.toContain('/api/price')
    expect(calls).not.toContain('/api/estimates')
  })

  it('clears saved evidence and price when the Schedule-to-Estimate recheck finds a stale fingerprint', async () => {
    let finish!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => {
      finish = resolve
    })
    const calls = await enterSchedule(() => pending)
    expectSavedActionsGated()
    await act(async () => {
      finish(Response.json({ ...currentStatus, visionFingerprint: 'changed-vision' }))
    })
    await waitFor(() =>
      expect(JSON.parse(window.sessionStorage.getItem(SESSION_KEY) ?? '{}')).toMatchObject({
        step: 'upload',
        analysis: null,
        items: [],
        price: null,
        estimateId: null,
      }),
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/analyze your photos again/i)
    expectSavedActionsGated()
    expect(calls).not.toContain('/api/price')
    expect(calls).not.toContain('/api/estimates')
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
      if (path === '/api/ai-status') return Response.json({ visionRevision: 1, visionFingerprint: 'current-vision' })
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
      if (path === '/api/ai-status') return Response.json({ visionRevision: 1, visionFingerprint: 'current-vision' })
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
