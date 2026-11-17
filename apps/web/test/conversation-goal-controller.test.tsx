import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useConversationController } from '../src/lib/useConversationController'
import { createConversationSession, type ConversationSession } from '../src/lib/conversation-state'
import { loadConversationSession } from '../src/lib/conversation-session'
import * as apiClient from '../src/lib/api-client'
import * as images from '../src/lib/image-downscale'

const analysis = {
  visionRevision: 1,
  visionFingerprint: 'vision-one',
  items: [{ type: 'sofa', count: 2 }],
  totalVolumeCubicFeet: 160,
  estimatedBoxes: { min: 2, max: 4 },
  boxesExplanation: '',
  specialHandling: [],
  possibleDuplicates: [],
  unseenAreas: [],
  photoAssessments: [{ url: 'https://example.test/room.jpg', status: 'relevant' as const, reason: 'Furniture' }],
}
const price = { currency: 'USD', total: 100, low: 90, high: 110, breakdown: { labor: 100 } }
const contact = {
  name: 'Synthetic Customer',
  email: 'customer@example.test',
  phone: '555-0101',
  requestedDate: '2027-01-20',
}
function ready(): ConversationSession {
  return {
    ...createConversationSession(),
    moveDetails: {
      from: '10 Main Street, Boston',
      to: '20 Oak Street, Boston',
      date: null,
      distanceMiles: 10,
      originFloor: 0,
      destinationFloor: 1,
      originElevator: null,
      destinationElevator: false,
    },
    photos: [{ id: 'photo-1', url: 'https://example.test/room.jpg', receipt: 'private' }],
    photoUrls: ['https://example.test/room.jpg'],
    photoRefs: [{ url: 'https://example.test/room.jpg', receipt: 'private' }],
    analysis,
    items: analysis.items,
    followUps: { garage: false, closets: false, appliances: false },
    wholeMoveCovered: true,
  }
}
function api() {
  const paths: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const path = String(url)
    paths.push(path)
    if (path === '/api/ai-status') return Response.json({ visionRevision: 1, visionFingerprint: 'vision-one' })
    if (path === '/api/price') return Response.json({ price })
    if (path === '/api/analyze') return Response.json(analysis)
    if (path === '/api/estimates') return Response.json({ id: 'saved-id' })
    if (path === '/api/estimates/saved-id/contact')
      return Response.json({ reference: 'saved-id', requestedDate: contact.requestedDate })
    if (path === '/api/conversation')
      return Response.json({ reply: 'Which items are missing?', basedOnRevision: 1, proposals: [] })
    throw new Error(`Unexpected ${path}`)
  })
  return paths
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})
it('opens early summary with precise missing essentials and zero pricing or writes', async () => {
  const paths = api()
  const hook = renderHook(() => useConversationController(createConversationSession))
  await act(async () => {
    await hook.result.current.openSummary?.()
  })
  expect(hook.result.current.view).toBe('summary')
  expect(hook.result.current.completeness.missing.join(' ')).toMatch(/pickup.*address/i)
  expect(paths).toEqual([])
  act(() => hook.result.current.updateSession())
  expect(hook.result.current.view).toBe('chat')
})
it('summary and bookMove are read-only; explicit contact confirms, saves and requests callback', async () => {
  const paths = api()
  const hook = renderHook(() => useConversationController(ready))
  await act(async () => {
    await hook.result.current.openSummary?.()
  })
  expect(hook.result.current.session.price).toEqual(price)
  expect(hook.result.current.session.detailsConfirmed).toBe(false)
  expect(paths).toEqual(['/api/ai-status', '/api/price'])
  act(() => hook.result.current.bookMove())
  expect(hook.result.current.view).toBe('booking')
  expect(paths).not.toContain('/api/estimates')
  await act(async () => {
    await hook.result.current.bookContact(contact)
  })
  expect(hook.result.current.session.scheduleResult?.reference).toBe('saved-id')
  expect(hook.result.current.session.detailsConfirmed).toBe(true)
  expect(paths.filter((path) => path !== '/api/ai-status')).toEqual([
    '/api/price',
    '/api/estimates',
    '/api/estimates/saved-id/contact',
  ])
  expect(hook.result.current.view).toBe('booking')
})
it('contact rejects invalid or changed displayed scope and blocks a lost save outcome across reload', async () => {
  const paths = api()
  const hook = renderHook(() => useConversationController(ready))
  await act(async () => {
    await hook.result.current.openSummary?.()
  })
  expect(hook.result.current.view).toBe('summary')
  act(() => hook.result.current.bookMove())
  await act(async () => {
    await hook.result.current.bookContact({ ...contact, phone: '' })
  })
  expect(paths).not.toContain('/api/estimates')
  act(() => hook.result.current.apply({ type: 'details.patch', patch: { destinationFloor: 2 } }, 'panel'))
  await act(async () => {
    await hook.result.current.bookContact(contact)
  })
  expect(paths).not.toContain('/api/estimates')
  await act(async () => {
    await hook.result.current.openSummary()
  })
  act(() => hook.result.current.bookMove())
  const original = globalThis.fetch
  vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === '/api/estimates') {
      paths.push('/api/estimates')
      throw new TypeError('lost transport')
    }
    return original(url, init)
  })
  await act(async () => {
    await hook.result.current.bookContact(contact)
  })
  expect(hook.result.current.error).toMatch(/unknown outcome/i)
  expect(paths.filter((path) => path === '/api/estimates')).toHaveLength(1)
  hook.unmount()
  const restored = renderHook(() => useConversationController(loadConversationSession))
  await act(async () => {
    await restored.result.current.openSummary()
  })
  act(() => restored.result.current.bookMove())
  await act(async () => {
    await restored.result.current.bookContact(contact)
  })
  expect(paths.filter((path) => path === '/api/estimates')).toHaveLength(1)
})
it.each(['send', 'close'] as const)(
  'revokes displayed callback scope on %s during fingerprint preflight before any write',
  async (action) => {
    const paths = api()
    const original = globalThis.fetch
    const hook = renderHook(() => useConversationController(ready))
    await act(async () => {
      await hook.result.current.openSummary()
    })
    act(() => hook.result.current.bookMove())
    let release!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => {
      release = resolve
    })
    let preflights = 0
    vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/ai-status') {
        preflights++
        return (await pending).clone()
      }
      if (String(url) === '/api/conversation') {
        const request = JSON.parse(String(init?.body))
        return Response.json({
          reply: 'What is the corrected address?',
          basedOnRevision: request.snapshot.revision,
          proposals: [],
        })
      }
      return original(url, init)
    })
    let booking!: Promise<void>
    act(() => {
      booking = hook.result.current.bookContact(contact)
    })
    expect(preflights).toBe(1)
    if (action === 'send')
      await act(async () => {
        await hook.result.current.sendMessage('Actually I need to correct the pickup address')
      })
    else act(() => hook.result.current.updateSession())
    await act(async () => {
      release(Response.json({ visionRevision: 1, visionFingerprint: 'vision-one' }))
      await booking
    })
    expect(paths).not.toContain('/api/estimates')
    expect(hook.result.current.session.detailsConfirmed).toBe(false)
  },
)
it('applies an entire latest-message grounded batch and opens summary at 90+ without saving', async () => {
  const state = ready()
  state.followUps = { garage: null, closets: null, appliances: null }
  state.wholeMoveCovered = null
  const paths = api()
  const original = globalThis.fetch
  vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) !== '/api/conversation') return original(url, init)
    paths.push('/api/conversation')
    const request = JSON.parse(String(init?.body))
    const message = request.messages.at(-1)
    const commands = [
      ...(['garage', 'closets', 'appliances'] as const).map((key) => ({ type: 'followUp.answer', key, answer: false })),
      { type: 'coverage.answer', answer: true },
    ]
    return Response.json({
      reply: 'Does this cover the whole move?',
      basedOnRevision: request.snapshot.revision,
      proposals: commands.map((command, index) => ({
        id: `batch-${index}`,
        expectedRevision: request.snapshot.revision,
        command,
        evidence: { sourceMessageId: message.id, wording: message.content },
      })),
    })
  })
  const hook = renderHook(() => useConversationController(() => state))
  await act(async () => {
    await hook.result.current.sendMessage('No additional garage, closets or appliances; yes this covers the whole move')
  })
  expect(hook.result.current.session.followUps).toEqual({ garage: false, closets: false, appliances: false })
  expect(hook.result.current.session.wholeMoveCovered).toBe(true)
  expect(hook.result.current.session.pendingProposals).toEqual([])
  expect(hook.result.current.view).toBe('summary')
  expect(hook.result.current.session.price).toEqual(price)
  expect(paths).not.toContain('/api/estimates')
})
it('ungrounded commands remain pending and price intent never authorizes a write', async () => {
  const state = ready()
  state.followUps.garage = null
  const paths: string[] = []
  vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    paths.push(String(url))
    const request = JSON.parse(String(init?.body))
    return Response.json({
      reply: 'Review the inventory.',
      basedOnRevision: request.snapshot.revision,
      proposals: [
        {
          id: 'answer',
          expectedRevision: request.snapshot.revision,
          command: { type: 'followUp.answer', key: 'garage', answer: false },
        },
        {
          id: 'intent',
          expectedRevision: request.snapshot.revision,
          command: { type: 'request.action', action: 'price' },
        },
      ],
    })
  })
  const hook = renderHook(() => useConversationController(() => state))
  await act(async () => {
    await hook.result.current.sendMessage('show me the estimate')
  })
  expect(hook.result.current.session.followUps.garage).toBeNull()
  expect(hook.result.current.session.pendingProposals).toHaveLength(1)
  expect(hook.result.current.view).toBe('summary')
  expect(paths).toEqual(['/api/conversation'])
})
it('failed automatic pricing never replays on an unrelated Send; explicit summary can retry', async () => {
  const paths = api()
  const original = globalThis.fetch
  vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === '/api/price') {
      paths.push('/api/price')
      return Response.json({ error: 'Synthetic unavailable' }, { status: 503 })
    }
    if (String(url) === '/api/conversation') {
      const request = JSON.parse(String(init?.body))
      return Response.json({
        reply: 'What would you like to review?',
        basedOnRevision: request.snapshot.revision,
        proposals: [],
      })
    }
    return original(url, init)
  })
  const hook = renderHook(() => useConversationController(ready))
  await act(async () => {
    await hook.result.current.sendMessage('review my move')
  })
  expect(paths.filter((path) => path === '/api/price')).toHaveLength(1)
  act(() => hook.result.current.updateSession())
  await act(async () => {
    await hook.result.current.sendMessage('thanks')
  })
  expect(paths.filter((path) => path === '/api/price')).toHaveLength(1)
  await act(async () => {
    await hook.result.current.openSummary()
  })
  expect(paths.filter((path) => path === '/api/price')).toHaveLength(2)
})
it('closing summary during read-only pricing cannot later authorize callback scope', async () => {
  const paths = api()
  const original = globalThis.fetch
  let release!: (response: Response) => void
  const pending = new Promise<Response>((resolve) => {
    release = resolve
  })
  vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) =>
    String(url) === '/api/price' ? pending : original(url, init),
  )
  const hook = renderHook(() => useConversationController(ready))
  let summary!: Promise<void>
  act(() => {
    summary = hook.result.current.openSummary()
  })
  // Let fingerprint preflight advance into the price request, then close the overlay.
  await act(async () => {
    await Promise.resolve()
  })
  act(() => hook.result.current.updateSession())
  await act(async () => {
    release(Response.json({ price }))
    await summary
  })
  expect(hook.result.current.view).toBe('chat')
  act(() => hook.result.current.bookMove())
  await act(async () => {
    await hook.result.current.bookContact(contact)
  })
  expect(paths).not.toContain('/api/estimates')
})
it('selecting demo photos automatically analyzes them without replacing customer details or facts', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const paths = api()
  const original = globalThis.fetch
  vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === '/api/analyze') {
      paths.push('/api/analyze')
      const request = JSON.parse(String(init?.body))
      expect(request.sample).toBe(true)
      expect(request.moveDetails.from).toBe('My current origin')
      return Response.json({
        ...analysis,
        photoAssessments: request.photoRefs.map((photo: { url: string }) => ({
          url: photo.url,
          status: 'relevant',
          reason: 'Furniture',
        })),
      })
    }
    if (String(url) === '/api/conversation') {
      paths.push('/api/conversation')
      const request = JSON.parse(String(init?.body))
      return Response.json({
        reply: 'The current inventory lists 2 sofa. Anything missing?',
        basedOnRevision: request.snapshot.revision,
        proposals: [],
      })
    }
    return original(url, init)
  })
  const state = createConversationSession()
  state.moveDetails.from = 'My current origin'
  const hook = renderHook(() => useConversationController(() => state))
  await act(async () => {
    await hook.result.current.reset('sample')
  })
  expect(hook.result.current.session.analysis).not.toBeNull()
  expect(hook.result.current.session.moveDetails.from).toBe('My current origin')
  expect(paths).toEqual(['/api/analyze', '/api/conversation'])
})
it('read-only price completion does not discard ungrounded pending factual proposals', async () => {
  const paths = api()
  const original = globalThis.fetch
  vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) !== '/api/conversation') return original(url, init)
    const request = JSON.parse(String(init?.body))
    return Response.json({
      reply: 'Review the inventory.',
      basedOnRevision: request.snapshot.revision,
      proposals: [
        {
          id: 'pending-count',
          expectedRevision: request.snapshot.revision,
          command: { type: 'item.count', itemType: 'sofa', count: 3 },
        },
      ],
    })
  })
  const hook = renderHook(() => useConversationController(ready))
  await act(async () => {
    await hook.result.current.sendMessage('not sure about the sofa count')
  })
  expect(hook.result.current.session.price).toEqual(price)
  expect(hook.result.current.session.items).toEqual([{ type: 'sofa', count: 2 }])
  expect(hook.result.current.session.pendingProposals).toHaveLength(1)
  expect(paths).not.toContain('/api/estimates')
})
it('selected photos automatically analyze before address intake finishes and continue Chat with actual results', async () => {
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL() {
        return 'blob:selected'
      }
      static revokeObjectURL() {}
    },
  )
  const file = new File(['synthetic image bytes'], 'room.jpg', { type: 'image/jpeg' })
  vi.spyOn(images, 'downscaleImage').mockResolvedValue(file)
  vi.spyOn(apiClient, 'uploadImage').mockResolvedValue({ url: 'https://example.test/room.jpg', receipt: 'private' })
  const paths = api()
  const original = globalThis.fetch
  let context: unknown
  vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) !== '/api/conversation') return original(url, init)
    paths.push('/api/conversation')
    const request = JSON.parse(String(init?.body))
    context = request.snapshot
    return Response.json({
      reply: 'The current inventory lists 2 sofa. What is the pickup address?',
      basedOnRevision: request.snapshot.revision,
      proposals: [],
    })
  })
  const hook = renderHook(() => useConversationController(createConversationSession))
  await act(async () => {
    await hook.result.current.uploadFiles([file])
  })
  expect(hook.result.current.session.analysis?.items).toEqual([{ type: 'sofa', count: 2 }])
  expect(context).toMatchObject({
    inventory: [{ type: 'sofa', count: 2 }],
    analysis: { estimatedBoxes: { min: 2, max: 4 } },
  })
  expect(paths).toEqual(['/api/analyze', '/api/conversation'])
  expect(hook.result.current.session.messages.at(-1)?.role).toBe('assistant')
})
it('analyze intent from current Send feeds actual accepted results into a second Chat turn without writes', async () => {
  const state = ready()
  state.analysis = null
  state.items = []
  state.followUps = { garage: null, closets: null, appliances: null }
  state.wholeMoveCovered = null
  const paths = api()
  const original = globalThis.fetch
  const contexts: { analysis: unknown; inventory: unknown; revision: number }[] = []
  vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) !== '/api/conversation') return original(url, init)
    paths.push('/api/conversation')
    const request = JSON.parse(String(init?.body))
    contexts.push(request.snapshot)
    return Response.json({
      reply:
        contexts.length === 1 ? 'Checking selected photos.' : 'The current inventory lists 2 sofa. Anything missing?',
      basedOnRevision: request.snapshot.revision,
      proposals:
        contexts.length === 1
          ? [
              {
                id: 'analyze-intent',
                expectedRevision: request.snapshot.revision,
                command: { type: 'request.action', action: 'analyze' },
              },
            ]
          : [],
    })
  })
  const hook = renderHook(() => useConversationController(() => state))
  expect(paths).toEqual([])
  await act(async () => {
    await hook.result.current.sendMessage('analyze photos')
  })
  expect(contexts).toHaveLength(2)
  expect(contexts[1].inventory).toEqual([{ type: 'sofa', count: 2 }])
  expect(contexts[1].analysis).toEqual({ totalVolumeCubicFeet: 160, estimatedBoxes: { min: 2, max: 4 } })
  expect(hook.result.current.session.messages.at(-1)?.content).toMatch(/2 sofa/)
  expect(paths.filter((path) => path !== '/api/conversation')).toEqual(['/api/analyze'])
  hook.unmount()
  const restored = renderHook(() => useConversationController(loadConversationSession))
  expect(restored.result.current.session.analysis).not.toBeNull()
  expect(paths.filter((path) => path === '/api/analyze')).toHaveLength(1)
})
it('photo mode switches preserve transcript, facts and timeline; only new clears them', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.spyOn(apiClient, 'analyzeApi').mockRejectedValue(new Error('synthetic analysis unavailable'))
  const state = createConversationSession()
  state.messages = [{ id: 'original', role: 'user', content: 'from Boston' }]
  state.timeline = [{ kind: 'message', id: 'event-original', revision: 0, message: state.messages[0] }]
  state.facts = [
    {
      field: 'from',
      sourceMessageId: 'original',
      wording: 'Boston',
      uncertainty: 'certain',
      precision: 'city',
      correction: false,
    },
  ]
  state.moveDetails.from = 'Boston'
  const hook = renderHook(() => useConversationController(() => state))
  await act(async () => {
    await hook.result.current.reset('sample')
  })
  expect(hook.result.current.session.messages).toEqual(state.messages)
  expect(hook.result.current.session.facts).toEqual(state.facts)
  expect(hook.result.current.session.timeline.slice(0, 1)).toEqual(state.timeline)
  expect(hook.result.current.session.moveDetails.from).toBe('Boston')
  act(() => hook.result.current.reset('own'))
  expect(hook.result.current.session.facts).toEqual(state.facts)
  act(() => hook.result.current.reset('new'))
  expect(hook.result.current.session.facts).toEqual([])
  expect(hook.result.current.session.messages.some((message) => message.id === 'original')).toBe(false)
})
