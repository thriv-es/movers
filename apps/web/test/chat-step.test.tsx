import { act, fireEvent, render, screen } from '@testing-library/react'
import { type ComponentProps, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatStep } from '../src/components/estimate/ChatStep'
import { EMPTY_MOVE_DETAILS, type ChatMessage } from '../src/data'
import { chatApi } from '../src/lib/api-client'

vi.mock('../src/lib/api-client', () => ({ chatApi: vi.fn() }))

const initialMessages: ChatMessage[] = [{ id: 'hello', role: 'assistant', content: 'Where are you moving?' }]
const props: ComponentProps<typeof ChatStep> = {
  messages: initialMessages,
  moveDetails: EMPTY_MOVE_DETAILS,
  finished: false,
  onTurn: vi.fn(),
  onContinue: vi.fn(),
  onUseForm: vi.fn(),
  onTrySample: vi.fn(),
}

// jsdom has no layout: retain real DOM/component behavior and supply only browser metrics/APIs.
let height = 1000
const resizeObservers: { callback: ResizeObserverCallback; targets: Set<Element> }[] = []
const scrollRequests: ScrollToOptions[] = []
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')

function resize(element: Element) {
  act(() => {
    for (const observer of resizeObservers) {
      if (observer.targets.has(element)) observer.callback([], {} as ResizeObserver)
    }
  })
}

function transcript() {
  return screen.getByRole('log', { name: 'Move conversation' })
}

function at(top: number) {
  const log = transcript()
  log.scrollTop = top
  fireEvent.scroll(log)
  return log
}

function Harness() {
  const [messages, setMessages] = useState(initialMessages)
  return <ChatStep {...props} messages={messages} onTurn={(next) => setMessages(next)} />
}

beforeEach(() => {
  height = 1000
  resizeObservers.length = 0
  scrollRequests.length = 0
  vi.clearAllMocks()
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => height)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      record: (typeof resizeObservers)[number]
      constructor(callback: ResizeObserverCallback) {
        this.record = { callback, targets: new Set() }
        resizeObservers.push(this.record)
      }
      observe(element: Element) {
        this.record.targets.add(element)
      }
      disconnect() {
        this.record.targets.clear()
      }
    },
  )
  // The old implementation uses this unsupported page-scrolling API.
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value(this: HTMLElement, options: ScrollToOptions) {
      scrollRequests.push(options)
      this.scrollTop = Math.max(0, Math.min(options.top ?? 0, this.scrollHeight - this.clientHeight))
    },
  })
  vi.mocked(chatApi).mockResolvedValue({ reply: 'Tell me more.', moveDetails: EMPTY_MOVE_DETAILS, finished: false })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  for (const [name, descriptor] of [
    ['scrollTo', originalScrollTo],
    ['scrollIntoView', originalScrollIntoView],
  ] as const) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor)
    else Reflect.deleteProperty(HTMLElement.prototype, name)
  }
})

describe('ChatStep available viewport', () => {
  it('measures space below the existing header and updates when the viewport changes', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 240 } as DOMRect)
    vi.stubGlobal('innerHeight', 900)
    const view = render(<ChatStep {...props} />)
    const step = view.container.firstElementChild as HTMLElement
    expect(step.style.getPropertyValue('--est-chat-height')).toBe('660px')
    vi.stubGlobal('innerHeight', 600)
    fireEvent(window, new Event('resize'))
    expect(step.style.getPropertyValue('--est-chat-height')).toBe('360px')
  })

  it('accounts for the mobile visual viewport and removes viewport listeners on unmount', () => {
    const viewport = Object.assign(new EventTarget(), { height: 600, offsetTop: 0 })
    vi.stubGlobal('visualViewport', viewport)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 200 } as DOMRect)
    const removeViewport = vi.spyOn(viewport, 'removeEventListener')
    const removeWindow = vi.spyOn(window, 'removeEventListener')
    const view = render(<ChatStep {...props} />)
    const step = view.container.firstElementChild as HTMLElement
    expect(step.style.getPropertyValue('--est-chat-height')).toBe('400px')
    viewport.height = 350
    viewport.offsetTop = 50
    fireEvent(viewport, new Event('resize'))
    expect(step.style.getPropertyValue('--est-chat-height')).toBe('200px')
    viewport.offsetTop = 80
    fireEvent(viewport, new Event('scroll'))
    expect(step.style.getPropertyValue('--est-chat-height')).toBe('230px')
    view.unmount()
    expect(removeViewport).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(removeViewport).toHaveBeenCalledWith('scroll', expect.any(Function))
    expect(removeWindow).toHaveBeenCalledWith('resize', expect.any(Function))
  })
})

describe('ChatStep transcript follow', () => {
  it('exposes an accessible transcript and initially follows only its own container', () => {
    render(<ChatStep {...props} />)
    expect(transcript().scrollTop).toBe(700)
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled()
    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it.each([
    { top: 636, expected: 900, label: 'at the 64px near-bottom boundary' },
    { top: 635, expected: 635, label: 'outside the near-bottom boundary' },
    { top: 100, expected: 100, label: 'while reading earlier messages' },
  ])('handles incoming messages $label', ({ top, expected }) => {
    const view = render(<ChatStep {...props} />)
    const log = at(top)
    height = 1200
    view.rerender(
      <ChatStep
        {...props}
        messages={[...initialMessages, { id: 'next', role: 'assistant', content: 'Next question' }]}
      />,
    )
    expect(log.scrollTop).toBe(expected)
  })

  it('follows text changes within the final message without requiring another message', () => {
    const view = render(<ChatStep {...props} />)
    const log = at(700)
    height = 1400
    view.rerender(<ChatStep {...props} messages={[{ ...initialMessages[0], content: 'A much longer question' }]} />)
    expect(log.scrollTop).toBe(1100)
  })

  it('follows observed content growth and viewport resizing, but not during upward reading', () => {
    render(<ChatStep {...props} />)
    const log = at(700)
    const content = log.firstElementChild as Element
    height = 1500
    resize(content)
    expect(log.scrollTop).toBe(1200)
    at(100)
    height = 1700
    resize(content)
    expect(log.scrollTop).toBe(100)
    at(1400)
    height = 1800
    resize(log)
    expect(log.scrollTop).toBe(1500)
  })

  it('resumes follow when the reader returns to the bottom', () => {
    const view = render(<ChatStep {...props} />)
    at(100)
    const log = at(690)
    height = 1300
    view.rerender(<ChatStep {...props} messages={[{ ...initialMessages[0], content: 'More detail' }]} />)
    expect(log.scrollTop).toBe(1000)
  })

  it('resumes follow for own submit, follows thinking and the completed reply', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof chatApi>>) => void
    vi.mocked(chatApi).mockReturnValue(
      new Promise((done) => {
        resolve = done
      }),
    )
    render(<Harness />)
    const log = at(100)
    height = 1200
    fireEvent.change(screen.getByRole('textbox', { name: 'Your answer' }), { target: { value: 'Boston' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByText('Thinking...')).toBeInTheDocument()
    expect(log.scrollTop).toBe(900)
    at(900)
    height = 1500
    await act(async () => resolve({ reply: 'Where next?', moveDetails: EMPTY_MOVE_DETAILS, finished: false }))
    expect(screen.queryByText('Thinking...')).not.toBeInTheDocument()
    expect(log.scrollTop).toBe(1200)
  })

  it('does not pull an upward reader down when a pending reply arrives', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof chatApi>>) => void
    vi.mocked(chatApi).mockReturnValue(
      new Promise((done) => {
        resolve = done
      }),
    )
    render(<Harness />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Your answer' }), { target: { value: 'Boston' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    const log = at(100)
    height = 1500
    await act(async () => resolve({ reply: 'Where next?', moveDetails: EMPTY_MOVE_DETAILS, finished: false }))
    expect(log.scrollTop).toBe(100)
  })

  it('follows the initial thinking indicator and its observed growth', () => {
    vi.mocked(chatApi).mockReturnValue(new Promise(() => {}))
    render(<ChatStep {...props} messages={[]} />)
    expect(screen.getByText('Thinking...')).toBeInTheDocument()
    const log = transcript()
    height = 1100
    resize(log.firstElementChild as Element)
    expect(log.scrollTop).toBe(800)
  })

  it('never animates automatic following with reduced motion enabled', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) => ({ matches: query === '(prefers-reduced-motion: reduce)', media: query }) as MediaQueryList,
    )
    render(<ChatStep {...props} />)
    const log = at(700)
    height = 1200
    resize(log.firstElementChild as Element)
    expect(log.scrollTop).toBe(900)
    expect(scrollRequests.length).toBeGreaterThan(0)
    expect(scrollRequests.every((request) => request.behavior === 'auto' || request.behavior === 'instant')).toBe(true)
  })

  it('disconnects observers and removes its scroll listener on unmount', () => {
    const view = render(<ChatStep {...props} />)
    const log = transcript()
    const remove = vi.spyOn(log, 'removeEventListener')
    view.unmount()
    expect(resizeObservers.length).toBeGreaterThan(0)
    expect(resizeObservers.every((observer) => observer.targets.size === 0)).toBe(true)
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function))
    const before = scrollRequests.length
    resize(log)
    expect(scrollRequests).toHaveLength(before)
  })
})
