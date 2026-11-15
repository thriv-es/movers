/**
 * The sessionStorage mirror of the estimator (MOVERS-12): round trip, version mismatch, garbage, sample seed.
 */
import { createElement } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { HelmetProvider } from 'react-helmet-async'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewStep } from '../src/components/estimate/ReviewStep'
import { EstimateStep } from '../src/components/estimate/EstimateStep'
import EstimatePage from '../src/pages/estimate.page'
import { priceApi } from '../src/lib/api-client'
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
  items: [{ type: 'sofa', count: 1 }], totalVolumeCubicFeet: 80,
  estimatedBoxes: { min: 2, max: 4 }, boxesExplanation: '',
  specialHandling: [], possibleDuplicates: [], unseenAreas: [],
}
const savedPrice = { currency: 'USD', total: 100, low: 90, high: 110, breakdown: { labor: 100 }, confidence: 'high' as const }
const review = { followUps: { garage: false, closets: false, appliances: false }, wholeMoveCovered: true }

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.sessionStorage.clear()
})

describe('estimate session', () => {
  it('returns the empty session when nothing is saved', () => {
    expect(loadSession(new FakeStorage())).toEqual(EMPTY_SESSION)
    expect(loadSession(null)).toEqual(EMPTY_SESSION)
  })

  it('round-trips a session', () => {
    const store = new FakeStorage()
    const session: EstimateSession = {
      ...EMPTY_SESSION,
      step: 'review',
      photoUrls: ['http://x/a.jpg'],
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
    expect(loadSession(store)).toEqual(EMPTY_SESSION)
    expect(store.getItem(SESSION_KEY)).toBeNull()
  })

  it('migrates a v3 priced draft to review without losing edits or photos', () => {
    const store = new FakeStorage()
    store.setItem(SESSION_KEY, JSON.stringify({
      ...EMPTY_SESSION, version: 3, step: 'estimate',
      photoUrls: ['https://dev.movers-ee0.pages.dev/sample/living-room.jpg'],
      analysis, items: [{ type: 'sofa', count: 2 }],
      price: savedPrice, estimateId: 'saved-id', sample: true,
    }))
    expect(loadSession(store)).toMatchObject({
      version: 4, step: 'review',
      photoUrls: ['https://dev.movers-ee0.pages.dev/sample/living-room.jpg'],
      analysis, items: [{ type: 'sofa', count: 2 }],
      price: null, estimateId: null, wholeMoveCovered: null, sample: true,
    })
    expect(store.getItem(SESSION_KEY)).not.toBeNull()
  })

  it('keeps a v3 draft without analysis at upload rather than a broken estimate', () => {
    const store = new FakeStorage()
    store.setItem(SESSION_KEY, JSON.stringify({ ...EMPTY_SESSION, version: 3, step: 'estimate', photoUrls: ['https://example.test/a.jpg'], price: savedPrice }))
    expect(loadSession(store)).toMatchObject({ version: 4, step: 'upload', photoUrls: ['https://example.test/a.jpg'], analysis: null, price: null, estimateId: null })
    expect(store.getItem(SESSION_KEY)).not.toBeNull()
  })

  it('discards unknown steps and malformed JSON', () => {
    const store = new FakeStorage()
    store.setItem(SESSION_KEY, JSON.stringify({ ...EMPTY_SESSION, step: 'teleport' }))
    expect(loadSession(store)).toEqual(EMPTY_SESSION)
    store.setItem(SESSION_KEY, '{not json')
    expect(loadSession(store)).toEqual(EMPTY_SESSION)
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
  })
})

describe('estimate review and API', () => {
  it('sends the explicit review in the price request', async () => {
    const fetch = vi.fn(async () => Response.json({ price: savedPrice }))
    vi.stubGlobal('fetch', fetch)
    await priceApi(analysis, EMPTY_SESSION.moveDetails, review, true)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/price')
    expect(JSON.parse((fetch.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
      analysis, moveDetails: EMPTY_SESSION.moveDetails, review, sample: true,
    })
  })

  it('offers an explicit whole-move yes/no answer with pressed state', () => {
    const onWholeMoveCovered = vi.fn()
    const { rerender } = render(createElement(ReviewStep, {
      analysis, items: analysis.items, followUps: review.followUps, wholeMoveCovered: null,
      onItemsChange: vi.fn(), onFollowUp: vi.fn(), onWholeMoveCovered, onBack: vi.fn(), onConfirm: vi.fn(),
    }))
    const group = screen.getByRole('group', { name: /whole move/i })
    const yes = group.querySelector('button:nth-of-type(1)')!
    const no = group.querySelector('button:nth-of-type(2)')!
    expect(yes).toHaveAttribute('aria-pressed', 'false')
    expect(no).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(yes)
    expect(onWholeMoveCovered).toHaveBeenCalledWith(true)
    rerender(createElement(ReviewStep, {
      analysis, items: analysis.items, followUps: review.followUps, wholeMoveCovered: true,
      onItemsChange: vi.fn(), onFollowUp: vi.fn(), onWholeMoveCovered, onBack: vi.fn(), onConfirm: vi.fn(),
    }))
    expect(yes).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(no)
    expect(onWholeMoveCovered).toHaveBeenCalledWith(false)
  })

  it('renders server reasons instead of claiming photos covered the move', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ movers: [] })))
    render(createElement(EstimateStep, {
      analysis, items: analysis.items, moveDetails: EMPTY_SESSION.moveDetails,
      review, price: { ...savedPrice, confidence: 'low', confidenceReasons: ['Garage follow-up has not been answered.'] },
      estimateId: 'saved-id', photoUrls: [], sample: false,
      onPriced: vi.fn(), onBack: vi.fn(), onSchedule: vi.fn(),
    }))
    expect(screen.getByText(/garage follow-up has not been answered/i)).toBeInTheDocument()
    expect(screen.queryByText(/photos and details covered the whole move/i)).not.toBeInTheDocument()
  })

  it('clears saved price and ID when the whole-move answer changes in the page', async () => {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...EMPTY_SESSION, step: 'review', analysis, items: analysis.items, price: savedPrice, estimateId: 'saved-id' }))
    render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: ['/estimate'] }, createElement(EstimatePage))))
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
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...EMPTY_SESSION, step: 'review', analysis, items: analysis.items, ...review }))
    render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: ['/estimate'] }, createElement(EstimatePage))))
    fireEvent.click(screen.getByRole('button', { name: /confirm and price it/i }))
    await waitFor(() => expect(JSON.parse(window.sessionStorage.getItem(SESSION_KEY)!).estimateId).toBe('new-id'))
    const priceCall = fetch.mock.calls.find(([path]) => path === '/api/price')!
    expect(JSON.parse((priceCall[1] as RequestInit).body as string)).toMatchObject({ review })
  })

  it('does not restore a stale in-flight price after returning to review and changing coverage', async () => {
    let resolvePrice!: (response: Response) => void
    const pendingPrice = new Promise<Response>((resolve) => { resolvePrice = resolve })
    const fetch = vi.fn(async (path: string) => {
      if (path === '/api/price') return pendingPrice
      if (path === '/api/movers') return Response.json({ movers: [] })
      if (path === '/api/estimates') return Response.json({ id: 'stale-id', storage: 'memory' })
      throw new Error(`Unexpected route ${path}`)
    })
    vi.stubGlobal('fetch', fetch)
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      ...EMPTY_SESSION, step: 'estimate', analysis, items: analysis.items, ...review,
    }))
    render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: ['/estimate'] }, createElement(EstimatePage))))
    await waitFor(() => expect(fetch.mock.calls.some(([path]) => path === '/api/price')).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: /review/i }))
    fireEvent.click(screen.getByRole('group', { name: /whole move/i }).querySelector('button:nth-of-type(2)')!)
    await act(async () => { resolvePrice(Response.json({ price: savedPrice })) })
    expect(JSON.parse(window.sessionStorage.getItem(SESSION_KEY)!)).toMatchObject({
      step: 'review', wholeMoveCovered: false, price: null, estimateId: null,
    })
    expect(fetch.mock.calls.some(([path]) => path === '/api/estimates')).toBe(false)
  })

  it('invalidates price and resets all coverage answers when a photo is removed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      ...EMPTY_SESSION, step: 'upload', photoUrls: ['https://example.test/a.jpg'],
      analysis, items: analysis.items, followUps: review.followUps, wholeMoveCovered: true,
      price: savedPrice, estimateId: 'saved-id',
    }))
    render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: ['/estimate'] }, createElement(EstimatePage))))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(JSON.parse(window.sessionStorage.getItem(SESSION_KEY)!).photoUrls).toEqual([]))
    expect(JSON.parse(window.sessionStorage.getItem(SESSION_KEY)!)).toMatchObject({
      analysis: null, followUps: { garage: null, closets: null, appliances: null },
      wholeMoveCovered: null, price: null, estimateId: null,
    })
  })

  it('invalidates price and resets coverage answers after reanalysis', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path === '/api/analyze') return Response.json(analysis)
      throw new Error(`Unexpected route ${path}`)
    }))
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      ...EMPTY_SESSION, step: 'upload', photoUrls: ['https://example.test/a.jpg'],
      analysis, items: analysis.items, followUps: review.followUps, wholeMoveCovered: true,
      price: savedPrice, estimateId: 'saved-id',
    }))
    render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: ['/estimate'] }, createElement(EstimatePage))))
    fireEvent.click(screen.getByRole('button', { name: 'Analyse again' }))
    await waitFor(() => expect(JSON.parse(window.sessionStorage.getItem(SESSION_KEY)!).step).toBe('review'))
    expect(JSON.parse(window.sessionStorage.getItem(SESSION_KEY)!)).toMatchObject({
      items: analysis.items, followUps: { garage: null, closets: null, appliances: null },
      wholeMoveCovered: null, price: null, estimateId: null,
    })
  })
})
