import { Button, Caption, Field, Input } from '@movers/ui'
import * as Dialog from '@radix-ui/react-dialog'
import { useState } from 'react'
import type { ConversationController } from '../../lib/useConversationController'
import { formatMoney } from '../estimate/format'
import { MoveSummary } from './MoveSummary'
import { downloadEstimate } from './estimate-download'

export function ConversationJourney({ controller }: { controller: ConversationController }) {
  const { session, completeness, view } = controller
  const [name, setName] = useState(session.contact?.name ?? '')
  const [email, setEmail] = useState(session.contact?.email ?? '')
  const [phone, setPhone] = useState(session.contact?.phone ?? '')
  const [editedDate, setDate] = useState<string | null>(null)
  const date = editedDate ?? session.contact?.requestedDate ?? session.moveDetails.date ?? ''
  const [downloadError, setDownloadError] = useState(false)
  const [downloadStarted, setDownloadStarted] = useState(false)
  const booking = view === 'booking'
  const price = completeness.ready ? session.price : null
  const blocked = controller.busy || controller.chatBusy || controller.uploads.length > 0
  const unknownWrite = Object.values(session.operations).some(
    (operation) =>
      ['save', 'schedule', 'quotes'].includes(operation.request.kind) &&
      ['interrupted', 'pending'].includes(operation.status),
  )
  const download = () => {
    setDownloadError(false)
    try {
      if (price && downloadEstimate(session)) setDownloadStarted(true)
    } catch {
      setDownloadError(true)
    }
  }
  return (
    <Dialog.Root
      open={view !== 'chat'}
      onOpenChange={(open) => {
        if (!open) controller.updateSession()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="conv-journey-overlay" />
        <Dialog.Content
          className={`conv-journey${booking ? ' conv-journey--booking' : ''}`}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            document.getElementById('conversation-message')?.focus({ preventScroll: true })
          }}
        >
          <header className="conv-journey__head">
            <Caption accent={booking ? 'tape' : 'green'}>
              {booking ? 'Let’s arrange the next step' : `${completeness.percent}% of move information collected`}
            </Caption>
            <Dialog.Title className="mv-title">{booking ? 'Book your move' : 'Your move estimate'}</Dialog.Title>
            <Dialog.Description>
              {booking
                ? 'Review your move and leave your details for a callback. Your move is not booked until a mover confirms it.'
                : 'Your conversation stays open underneath. Update anything before requesting a callback.'}
            </Dialog.Description>
          </header>
          <div className="conv-journey__body">
            <div className="conv-estimate-ticket">
              <p className="est-small">
                {session.sample ? 'Sample move · ' : ''}USD demo estimate · not a binding quote
              </p>
              {price ? (
                <p className="conv-journey__price">
                  {formatMoney(price.low, price.currency)}–{formatMoney(price.high, price.currency)}
                </p>
              ) : (
                <p className="conv-heading">
                  {controller.busy ? 'Preparing your estimate…' : 'A few essentials are still missing'}
                </p>
              )}
              {!price && completeness.missing.length ? (
                <>
                  <p>We won’t guess a price. Continue the conversation to check:</p>
                  <ul>
                    {completeness.missing.map((missing) => (
                      <li key={missing}>{missing}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              {!price && !completeness.missing.length && !controller.busy ? (
                <p>Pricing is not available yet. Return to the conversation and retry the failed operation.</p>
              ) : null}
              {price ? (
                <p className="est-small">The final price and availability need confirmation from a mover.</p>
              ) : null}
            </div>
            <MoveSummary session={session} />
            {controller.error ? (
              <p role="alert" className="est-error">
                {controller.error}
              </p>
            ) : null}
            {booking ? (
              <section className="conv-callback mv-stack" aria-label="Callback request">
                {session.scheduleResult ? (
                  <div role="status">
                    <h2 className="conv-heading">Callback request recorded</h2>
                    <p>
                      Reference {session.scheduleResult.reference}. Preferred move date:{' '}
                      {session.scheduleResult.requestedDate}. This is not a confirmed booking or dispatch.
                    </p>
                    <p>Your estimate and conversation are still here.</p>
                  </div>
                ) : (
                  <form
                    className="mv-stack"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void controller.bookContact({ name, email, phone, requestedDate: date })
                    }}
                  >
                    <h2 className="conv-heading">How can we reach you?</h2>
                    <Field label="Your name" htmlFor="callback-name">
                      <Input
                        id="callback-name"
                        autoComplete="name"
                        required
                        maxLength={120}
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                      />
                    </Field>
                    <Field label="Email" htmlFor="callback-email">
                      <Input
                        id="callback-email"
                        type="email"
                        autoComplete="email"
                        required
                        maxLength={200}
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                      />
                    </Field>
                    <Field label="Phone" htmlFor="callback-phone">
                      <Input
                        id="callback-phone"
                        type="tel"
                        autoComplete="tel"
                        required
                        maxLength={40}
                        value={phone}
                        onChange={(event) => setPhone(event.target.value)}
                      />
                    </Field>
                    <Field label="Preferred move date" htmlFor="callback-date">
                      <Input
                        id="callback-date"
                        type="date"
                        required
                        value={date}
                        onChange={(event) => setDate(event.target.value)}
                      />
                    </Field>
                    <p className="est-small">
                      Requesting a callback saves this displayed estimate and your contact details. It does not confirm
                      a booking or send mover quote requests.
                    </p>
                    {unknownWrite ? (
                      <p role="status">
                        A request is in progress or its outcome is unknown. Check the existing request before submitting
                        again.
                      </p>
                    ) : null}
                    <Button type="submit" variant="primary" disabled={!price || blocked || unknownWrite}>
                      Request a callback
                    </Button>
                  </form>
                )}
                <Button disabled={!price || blocked} onClick={download}>
                  Download estimate and item list
                </Button>
                {downloadStarted ? (
                  <p role="status" className="est-small">
                    Download started. Your session has not been cleared.
                  </p>
                ) : null}
                {downloadError ? (
                  <p role="alert">The download could not start. Your estimate is safe; try again.</p>
                ) : null}
              </section>
            ) : null}
          </div>
          <footer className="conv-journey__actions">
            {booking ? (
              <Button size="sm" onClick={() => void controller.openSummary()}>
                Back to price summary
              </Button>
            ) : (
              <Button variant="primary" disabled={!price || blocked} onClick={controller.bookMove}>
                Book this move
              </Button>
            )}
            <Button onClick={controller.updateSession}>
              {booking ? 'Update this session' : 'Update this session'}
            </Button>
            <Button variant="ghost" disabled={controller.busy || unknownWrite} onClick={() => controller.reset('new')}>
              Start a new session
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
