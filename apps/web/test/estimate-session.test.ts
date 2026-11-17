/**
 * The sessionStorage mirror of the estimator (MOVERS-12): round trip, version mismatch, garbage, sample seed.
 */
import { describe, expect, it } from 'vitest'
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
    }
    saveSession(session, store)
    expect(loadSession(store)).toEqual(session)
  })

  it('discards a session saved by another version', () => {
    const store = new FakeStorage()
    store.setItem(SESSION_KEY, JSON.stringify({ ...EMPTY_SESSION, version: SESSION_VERSION - 1, step: 'estimate' }))
    expect(loadSession(store)).toEqual(EMPTY_SESSION)
    expect(store.getItem(SESSION_KEY)).toBeNull()
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
