import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ConversationShell } from '../src/components/conversation/ConversationShell'
import { ConversationDataPanel } from '../src/components/conversation/ConversationDataPanel'
import { ConversationPhotos } from '../src/components/conversation/ConversationPhotos'
import { createConversationSession, conversationReadiness } from '../src/lib/conversation-state'
import type { ConversationController } from '../src/lib/useConversationController'

function controller(view = 'chat'): ConversationController {
  const session = createConversationSession()
  session.moveDetails = {
    from: '12 Main Street, Boston, MA',
    to: '9 Oak Street, Hartford, CT',
    date: null,
    distanceMiles: 120,
    originFloor: 0,
    destinationFloor: 1,
    originElevator: null,
    destinationElevator: true,
  }
  session.messages = [{ id: 'user-one', role: 'user', content: 'Please keep my earlier answer.' }]
  session.timeline = [{ kind: 'message', id: 'timeline-one', revision: 0, message: session.messages[0] }]
  return {
    session,
    readiness: conversationReadiness(session),
    completeness: { percent: 55, missing: ['Inventory and photos'], ready: false },
    view,
    draft: '',
    uploads: [],
    busy: false,
    chatBusy: false,
    chatFailed: false,
    suggestionsExpired: false,
    error: null,
    movers: [],
    moversBusy: false,
    apply: vi.fn(),
    dispatch: vi.fn(),
    setDraft: vi.fn(),
    sendMessage: vi.fn(),
    retryChat: vi.fn(),
    uploadFiles: vi.fn(),
    retryUpload: vi.fn(),
    removeUpload: vi.fn(),
    removePhoto: vi.fn(),
    analyzePhotos: vi.fn(),
    confirmPrice: vi.fn(),
    submitContact: vi.fn(),
    submitQuotes: vi.fn(),
    loadMovers: vi.fn(),
    cancel: vi.fn(),
    retry: vi.fn(),
    reset: vi.fn(),
    openSummary: vi.fn(),
    updateSession: vi.fn(),
    bookMove: vi.fn(),
    bookContact: vi.fn(),
  } as unknown as ConversationController
}
beforeEach(() => {
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
it('shows business completeness above read-only accumulated facts, without a form or distance question', () => {
  const c = controller()
  render(<ConversationDataPanel controller={c} />)
  const progress = screen.getByRole('progressbar', { name: 'Move information completeness' })
  expect(progress).toHaveAttribute('aria-valuenow', '55')
  expect(screen.getByText('12 Main Street, Boston, MA')).toBeVisible()
  expect(screen.getByText('9 Oak Street, Hartford, CT')).toBeVisible()
  expect(screen.queryAllByRole('textbox')).toHaveLength(0)
  expect(screen.queryAllByRole('spinbutton')).toHaveLength(0)
  expect(screen.queryAllByRole('button')).toHaveLength(0)
  expect(screen.queryByText(/changes clear dependent inventory/i)).not.toBeInTheDocument()
})
it('keeps the transcript and composer mounted beneath an early summary with no fabricated price', () => {
  const c = controller('summary')
  render(<ConversationShell controller={c} />)
  const dialog = screen.getByRole('dialog', { name: 'Your move estimate' })
  expect(within(dialog).getByText('Inventory and photos')).toBeVisible()
  expect(within(dialog).getByRole('button', { name: 'Book this move' })).toBeDisabled()
  expect(within(dialog).getByRole('button', { name: 'Start a new session' })).toBeVisible()
  expect(screen.getByText('Please keep my earlier answer.')).toBeInTheDocument()
  expect(document.getElementById('conversation-message')).toBeInTheDocument()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Update this session' }))
  expect(c.updateSession).toHaveBeenCalledTimes(1)
  expect(c.reset).not.toHaveBeenCalled()
  expect(c.confirmPrice).not.toHaveBeenCalled()
})
it('shows only the customer price range and three summary actions, not internal calculations', () => {
  const c = controller('summary')
  c.completeness = { percent: 95, missing: [], ready: true }
  c.session.price = {
    currency: 'USD',
    total: 650,
    low: 585,
    high: 715,
    breakdown: { SECRET_TARIFF: 650 },
    explanation: 'INTERNAL_RATE_FORMULA',
  }
  render(<ConversationShell controller={c} />)
  const dialog = screen.getByRole('dialog', { name: 'Your move estimate' })
  expect(within(dialog).getByText(/\$585/)).toHaveTextContent('$715')
  expect(within(dialog).getAllByRole('button')).toHaveLength(3)
  expect(screen.queryByText(/SECRET_TARIFF|INTERNAL_RATE_FORMULA/)).not.toBeInTheDocument()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Book this move' }))
  expect(c.bookMove).toHaveBeenCalledTimes(1)
  expect(c.bookContact).not.toHaveBeenCalled()
  expect(c.reset).not.toHaveBeenCalled()
})
it('booking has a separate callback form and download, with no success or reset before an API result', () => {
  const c = controller('booking')
  c.completeness = { percent: 95, missing: [], ready: true }
  c.session.price = { currency: 'USD', total: 650, low: 585, high: 715, breakdown: {} }
  render(<ConversationShell controller={c} />)
  const dialog = screen.getByRole('dialog', { name: 'Book your move' })
  expect(within(dialog).getByRole('button', { name: 'Download estimate and item list' })).toBeEnabled()
  fireEvent.change(within(dialog).getByLabelText('Your name'), { target: { value: 'Synthetic Customer' } })
  fireEvent.change(within(dialog).getByLabelText('Email'), { target: { value: 'synthetic@example.invalid' } })
  fireEvent.change(within(dialog).getByLabelText('Phone'), { target: { value: '5550100' } })
  fireEvent.change(within(dialog).getByLabelText('Preferred move date'), { target: { value: '2027-01-11' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Request a callback' }))
  expect(c.bookContact).toHaveBeenCalledWith({
    name: 'Synthetic Customer',
    email: 'synthetic@example.invalid',
    phone: '5550100',
    requestedDate: '2027-01-11',
  })
  expect(screen.queryByText(/callback request recorded/i)).not.toBeInTheDocument()
  expect(c.reset).not.toHaveBeenCalled()
})
it('downloads the estimate without clearing the session or claiming a callback was submitted', () => {
  const c = controller('booking')
  c.completeness = { percent: 95, missing: [], ready: true }
  c.session.price = { currency: 'USD', total: 650, low: 585, high: 715, breakdown: {} }
  const NativeURL = URL
  vi.stubGlobal(
    'URL',
    class extends NativeURL {
      static createObjectURL() {
        return 'blob:synthetic-estimate'
      }
      static revokeObjectURL() {}
    },
  )
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  render(<ConversationShell controller={c} />)
  fireEvent.click(screen.getByRole('button', { name: 'Download estimate and item list' }))
  expect(click).toHaveBeenCalledTimes(1)
  expect(screen.getByText('Download started. Your session has not been cleared.')).toBeVisible()
  expect(c.reset).not.toHaveBeenCalled()
  expect(c.bookContact).not.toHaveBeenCalled()
})
it('shows callback success only from its recorded API result and still offers the saved estimate', () => {
  const c = controller('booking')
  c.completeness = { percent: 95, missing: [], ready: true }
  c.session.price = { currency: 'USD', total: 650, low: 585, high: 715, breakdown: {} }
  c.session.scheduleResult = { reference: 'synthetic-record', requestedDate: '2027-01-11', status: 'requested' }
  render(<ConversationShell controller={c} />)
  expect(screen.getByRole('heading', { name: 'Callback request recorded' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Request a callback' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Download estimate and item list' })).toBeEnabled()
  expect(c.reset).not.toHaveBeenCalled()
})
it('keeps an intentionally edited callback date while an accepted move date changes', () => {
  const c = controller('booking')
  c.completeness = { percent: 95, missing: [], ready: true }
  c.session.price = { currency: 'USD', total: 650, low: 585, high: 715, breakdown: {} }
  c.session.moveDetails.date = '2027-01-11'
  const mounted = render(<ConversationShell controller={c} />)
  fireEvent.change(screen.getByLabelText('Preferred move date'), { target: { value: '' } })
  c.session.moveDetails.date = '2027-02-12'
  mounted.rerender(<ConversationShell controller={c} />)
  expect(screen.getByLabelText('Preferred move date')).toHaveValue('')
})
it('returns directly to chat rather than reopening the mobile manifest after a price overlay', () => {
  const c = controller('chat')
  const mounted = render(<ConversationShell controller={c} />)
  fireEvent.click(screen.getByRole('button', { name: 'Open move manifest' }))
  expect(screen.getByRole('dialog', { name: 'Your move so far' })).toBeVisible()
  c.view = 'summary'
  mounted.rerender(<ConversationShell controller={c} />)
  expect(screen.getByRole('dialog', { name: 'Your move estimate' })).toBeVisible()
  c.view = 'chat'
  mounted.rerender(<ConversationShell controller={c} />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Message' })).toBeVisible()
})
it('identifies each unavailable photo even when only legacy linkage evidence records its failure', () => {
  const c = controller()
  c.session.photos = [{ id: 'linked-photo', url: 'https://example.invalid/room.jpg', receipt: 'synthetic-receipt' }]
  c.session.analysis = {
    items: [],
    totalVolumeCubicFeet: 0,
    estimatedBoxes: { min: 0, max: 0 },
    boxesExplanation: '',
    specialHandling: [],
    possibleDuplicates: [],
    unseenAreas: [],
    photoLinkStatuses: [{ url: c.session.photos[0].url, status: 'unavailable', reason: 'Bytes unavailable.' }],
  }
  render(<ConversationPhotos controller={c} />)
  expect(screen.getByText('Photo 1 · Re-upload required')).toBeVisible()
  expect(screen.queryByText('Photo 1 · Attached')).not.toBeInTheDocument()
})
it('does not blame valid photo bytes when only the provider assessment failed', () => {
  const c = controller()
  c.session.photos = [{ id: 'provider-failure', url: 'https://example.invalid/room.jpg', receipt: 'synthetic-receipt' }]
  c.session.failedPhotoAssessments = [
    {
      url: c.session.photos[0].url,
      status: 'unavailable',
      reason: 'Photo assessment could not be completed. Please try again.',
    },
  ]
  render(<ConversationPhotos controller={c} />)
  expect(screen.getByText('Photo 1 · Review unavailable — retry analysis')).toBeVisible()
  expect(screen.queryByText('Photo 1 · Re-upload required')).not.toBeInTheDocument()
})
it('moves keyboard focus to stable photo management when a resolved decision disappears', () => {
  const c = controller()
  c.session.photos = [{ id: 'uncertain-photo', url: 'https://example.invalid/room.jpg', receipt: 'synthetic-receipt' }]
  c.session.analysis = {
    items: [],
    totalVolumeCubicFeet: 0,
    estimatedBoxes: { min: 0, max: 0 },
    boxesExplanation: '',
    specialHandling: [],
    possibleDuplicates: [],
    unseenAreas: [],
    photoAssessments: [{ url: c.session.photos[0].url, status: 'uncertain', reason: 'Please check this room.' }],
  }
  const mounted = render(<ConversationPhotos controller={c} />)
  const keep = screen.getByRole('button', { name: 'Keep photo 1' })
  keep.focus()
  c.session.photoDecisions[c.session.photos[0].url] = 'keep'
  mounted.rerender(<ConversationPhotos controller={c} />)
  expect(screen.getByText('Manage photo 1')).toHaveFocus()
})
it.each(['save', 'schedule', 'quotes'] as const)('blocks reset for an interrupted %s write', (kind) => {
  const c = controller('summary')
  const request =
    kind === 'save'
      ? { kind }
      : kind === 'schedule'
        ? {
            kind,
            contact: {
              name: 'Synthetic',
              email: 'synthetic@example.invalid',
              phone: '5550100',
              requestedDate: '2027-01-11',
            },
          }
        : { kind, moverIds: ['synthetic-mover'], note: '' }
  c.session.operations = { unknown: { id: 'unknown', revision: 0, request, status: 'interrupted' } }
  render(<ConversationShell controller={c} />)
  expect(screen.getByRole('button', { name: 'Start a new session' })).toBeDisabled()
})
it('only an explicit new-session click asks the controller to clear the conversation', () => {
  const c = controller('summary')
  render(<ConversationShell controller={c} />)
  fireEvent.click(screen.getByRole('button', { name: 'Start a new session' }))
  expect(c.reset).toHaveBeenCalledWith('new')
})
