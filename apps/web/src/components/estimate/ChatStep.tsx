import { Badge, Bubble, Button, Caption, Panel } from '@movers/ui'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import type { ChatMessage, MoveDetails } from '@/data'
import { chatApi } from '@/lib/api-client'
import { formatDetail } from './format'
import { useChatLayout } from './useChatLayout'

interface ChatStepProps {
  messages: ChatMessage[]
  moveDetails: MoveDetails
  finished: boolean
  onTurn: (messages: ChatMessage[], moveDetails: MoveDetails, finished: boolean) => void
  onContinue: () => void
  onUseForm: () => void
  onTrySample: () => void
}

const GREETING_FALLBACK = 'Hi! Tell me about your move: where from, where to, and roughly when.'

let messageSeq = 0
const newId = (role: string) => `${role}-${Date.now()}-${messageSeq++}`

const DETAIL_ROWS: { key: keyof MoveDetails; label: string }[] = [
  { key: 'from', label: 'From' },
  { key: 'to', label: 'To' },
  { key: 'date', label: 'Date' },
  { key: 'distanceMiles', label: 'Distance' },
  { key: 'originFloor', label: 'Floor (from)' },
  { key: 'originElevator', label: 'Elevator (from)' },
  { key: 'destinationFloor', label: 'Floor (to)' },
  { key: 'destinationElevator', label: 'Elevator (to)' },
]

/** Step 1: a short conversation that fills in the move details card as it goes. */
export function ChatStep({
  messages,
  moveDetails,
  finished,
  onTurn,
  onContinue,
  onUseForm,
  onTrySample,
}: ChatStepProps): JSX.Element {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { stepRef, logRef, contentRef, resumeFollow } = useChatLayout()
  const greeted = useRef(false)

  useEffect(() => {
    if (messages.length > 0 || greeted.current) return
    greeted.current = true
    setBusy(true)
    chatApi([], moveDetails)
      .then((turn) =>
        onTurn([{ id: newId('assistant'), role: 'assistant', content: turn.reply }], turn.moveDetails, turn.finished),
      )
      .catch(() =>
        onTurn([{ id: newId('assistant'), role: 'assistant', content: GREETING_FALLBACK }], moveDetails, false),
      )
      .finally(() => setBusy(false))
  }, [messages.length, moveDetails, onTurn])

  const send = async (event: FormEvent) => {
    event.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    resumeFollow()
    const next = [...messages, { id: newId('user'), role: 'user' as const, content: text }]
    setInput('')
    setError(null)
    setBusy(true)
    onTurn(next, moveDetails, finished)
    try {
      const turn = await chatApi(next, moveDetails)
      onTurn(
        [...next, { id: newId('assistant'), role: 'assistant', content: turn.reply }],
        turn.moveDetails,
        turn.finished,
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The assistant did not answer. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const known = DETAIL_ROWS.filter((row) => moveDetails[row.key] !== null)

  return (
    <div ref={stepRef} className="est-split est-chat-step">
      <Panel as="section" className="est-chat" aria-label="Chat about your move">
        <Caption accent="tape">Tell us about the move</Caption>
        <div
          ref={logRef}
          className="est-chat__log"
          role="log"
          aria-label="Move conversation"
          aria-live="polite"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: The scrollable transcript needs keyboard access.
          tabIndex={0}
        >
          <div ref={contentRef} className="est-chat__content">
            {messages.map((message) => (
              <Bubble key={message.id} role={message.role} meta={message.role === 'user' ? 'You' : 'Movers'}>
                {message.content}
              </Bubble>
            ))}
            {busy ? (
              // biome-ignore lint/a11y/useValidAriaRole: Bubble's `role` is the speaker, not an ARIA role
              <Bubble role="assistant" meta="Movers" className="est-chat__typing">
                Thinking...
              </Bubble>
            ) : null}
          </div>
        </div>
        {error ? (
          <p className="est-error" role="alert">
            {error}
          </p>
        ) : null}
        <form className="est-chat__form" onSubmit={send}>
          <label className="mv-sr-only" htmlFor="chat-input">
            Your answer
          </label>
          <input
            id="chat-input"
            className="mv-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={finished ? 'Anything else to add?' : 'Type your answer'}
            autoComplete="off"
            disabled={busy && messages.length === 0}
          />
          <Button type="submit" variant="primary" disabled={busy || input.trim() === ''}>
            Send
          </Button>
        </form>
        <div className="mv-actions">
          {finished ? (
            <Button variant="primary" onClick={onContinue}>
              Continue to details
            </Button>
          ) : (
            <Button variant="ghost" onClick={onUseForm}>
              Fill in a form instead
            </Button>
          )}
          <Button variant="tape" onClick={onTrySample}>
            Try with a sample move
          </Button>
        </div>
      </Panel>

      <aside className="mv-panel mv-panel--kraft mv-panel--flat est-details-card" aria-label="What we know so far">
        <Caption accent="green">What we know so far</Caption>
        {known.length === 0 ? (
          <p className="mv-muted">Answer a few questions and the details appear here.</p>
        ) : (
          <dl className="est-dl">
            {known.map((row) => (
              <div key={row.key} className="est-dl__row">
                <dt>{row.label}</dt>
                <dd>{formatDetail(row.key, moveDetails[row.key])}</dd>
              </div>
            ))}
          </dl>
        )}
        {finished ? <Badge tone="green">Ready to continue</Badge> : null}
        <p className="mv-muted est-small">You can correct any of these on the next step.</p>
      </aside>
    </div>
  )
}
