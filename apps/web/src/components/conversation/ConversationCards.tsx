import { Badge, Button, Caption, Field, Input, Panel, Progress, Textarea } from '@movers/ui'
import { useState } from 'react'
import type { ConversationController } from '../../lib/useConversationController'
import { conversationAnalysis } from '../../lib/conversation-state'
import { canonicalItemType } from '../../lib/item-aliases'
import { formatMoney, titleCase } from '../estimate/format'

export function ConversationPhotoCards({ controller }: { controller: ConversationController }) {
  const { session, uploads, readiness } = controller
  const assessments = session.failedPhotoAssessments.length
    ? session.failedPhotoAssessments
    : (session.analysis?.photoAssessments ?? [])
  const names: Record<string, string> = {
    'living-room.jpg': 'Living room',
    'bedroom.jpg': 'Bedroom',
    'kitchen.jpg': 'Kitchen',
  }
  const usable = session.photos.filter((photo) => session.sample || photo.receipt).length
  return (
    <Panel as="section" className="mv-stack" aria-label="Conversation photos">
      <Caption accent="sky">Photos of this move</Caption>
      {session.needsPhotoReupload ? (
        <p role="alert" className="est-error">
          Re-upload your photos to continue, or remove each previous photo you no longer need. Old thumbnails are
          reference only.
        </p>
      ) : null}
      <ul className="est-photos" aria-label="Selected photos">
        {session.photos.map((photo, index) => {
          const filename = photo.url.split('/').pop() ?? 'photo'
          const assessment =
            assessments.find((entry) => entry.url === photo.url) ??
            session.analysis?.photoLinkStatuses?.find((entry) => entry.url === photo.url && entry.status !== 'eligible')
          return (
            <li key={photo.id} className="est-photo">
              <img src={photo.url} alt={names[filename] ?? filename} loading="lazy" />
              <div className="est-photo__meta">
                <span>Photo {index + 1}</span>
                <span className="est-small">
                  {assessment?.status === 'unlinked' || assessment?.status === 'unavailable'
                    ? 'Re-upload required'
                    : photo.receipt
                      ? 'Receipt available'
                      : session.sample
                        ? 'Bundled sample'
                        : 'Re-upload required'}
                </span>
                {assessment ? (
                  <p>
                    Photo {index + 1}: {assessment.reason}
                  </p>
                ) : null}
                {session.analysis && assessment?.status === 'uncertain' ? (
                  <div className="mv-actions">
                    {(['keep', 'exclude'] as const).map((decision) => (
                      <Button
                        key={decision}
                        size="sm"
                        disabled={session.photoDecisionsLocked}
                        aria-pressed={session.photoDecisions[photo.url] === decision}
                        onClick={() => controller.apply({ type: 'photo.decide', photoId: photo.id, decision })}
                      >
                        {titleCase(decision)} photo {index + 1}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>
              <Button size="sm" variant="ghost" onClick={() => controller.removePhoto(photo.id)}>
                Remove
              </Button>
            </li>
          )
        })}
        {uploads.map((card) => (
          <li key={card.id} className="est-photo">
            <img src={card.src} alt="Selected upload" />
            <div className="est-photo__meta">
              <span>
                {card.status === 'preparing'
                  ? 'Preparing…'
                  : card.status === 'error'
                    ? 'Upload failed — not linked'
                    : 'Uploading…'}
              </span>
              {card.status === 'uploading' ? <Progress value={card.progress} aria-label="Uploading photo" /> : null}
              {card.status === 'error' ? (
                <Button size="sm" onClick={() => void controller.retryUpload(card.id)}>
                  Retry upload
                </Button>
              ) : null}
            </div>
            <Button size="sm" variant="ghost" onClick={() => controller.removeUpload(card.id)}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
      {!session.photos.length && !uploads.length ? (
        <p className="mv-muted">Add room photos from the composer, or try a sample move.</p>
      ) : null}
      <div className="mv-actions">
        <Button
          variant="primary"
          disabled={!readiness.canAnalyze || controller.busy || uploads.length > 0}
          onClick={() => void controller.analyzePhotos()}
        >
          {controller.busy &&
          Object.values(session.operations).some((op) => op.status === 'pending' && op.request.kind === 'analyze')
            ? 'Analysing…'
            : session.analysis
              ? 'Analyse again'
              : `Analyse ${usable || ''} photo${usable === 1 ? '' : 's'}`}
        </Button>
        {session.sample ? (
          <Button size="sm" variant="tape" onClick={() => controller.reset('own')}>
            Use my own photos
          </Button>
        ) : !session.photos.length ? (
          <Button size="sm" variant="tape" onClick={() => controller.reset('sample')}>
            Try with a sample move
          </Button>
        ) : null}
      </div>
    </Panel>
  )
}

function Answer({
  label,
  value,
  disabled,
  onAnswer,
}: { label: string; value: boolean | null; disabled?: boolean; onAnswer: (value: boolean) => void }) {
  return (
    <div role="group" aria-label={label} className="conv-answer">
      <strong>{label}</strong>
      <div className="mv-actions">
        {[true, false].map((answer) => (
          <Button
            size="sm"
            key={String(answer)}
            disabled={disabled}
            aria-pressed={value === answer}
            onClick={() => onAnswer(answer)}
          >
            {answer ? 'Yes' : 'No'}
          </Button>
        ))}
      </div>
    </div>
  )
}
export function ConversationReviewCards({ controller }: { controller: ConversationController }) {
  const { session, readiness } = controller
  const analysis = conversationAnalysis(session)
  if (!analysis) return null
  return (
    <Panel as="section" className="mv-stack" aria-label="Inventory questions">
      <Caption accent="tape">Check what is moving</Caption>
      {analysis.unseenAreas.length ? <p>Not shown: {analysis.unseenAreas.join(', ')}</p> : null}
      {analysis.possibleDuplicates
        .filter((duplicate) =>
          session.items.some((item) => canonicalItemType(item.type) === canonicalItemType(duplicate.item)),
        )
        .map((duplicate) => {
          const resolution = session.duplicateResolutions[canonicalItemType(duplicate.item)]
          return (
            <div className="conv-answer" key={duplicate.item}>
              <p>Is {duplicate.item} the same item seen from different angles, or different items?</p>
              {resolution ? (
                <p>Answered: {resolution}</p>
              ) : (
                <div className="mv-actions">
                  <Button
                    size="sm"
                    disabled={readiness.unresolvedPhotos > 0}
                    onClick={() =>
                      controller.apply({ type: 'duplicate.resolve', itemType: duplicate.item, resolution: 'same' })
                    }
                  >
                    Same {duplicate.item}
                  </Button>
                  <Button
                    size="sm"
                    disabled={readiness.unresolvedPhotos > 0}
                    onClick={() =>
                      controller.apply({ type: 'duplicate.resolve', itemType: duplicate.item, resolution: 'different' })
                    }
                  >
                    Different {duplicate.item}
                  </Button>
                </div>
              )}
            </div>
          )
        })}
      <p>Any extra items in these areas not already counted? Yes adds the existing allowance to the manifest.</p>
      {(['garage', 'closets', 'appliances'] as const).map((key) => (
        <Answer
          key={key}
          label={titleCase(key)}
          value={session.followUps[key]}
          disabled={readiness.unresolvedPhotos > 0}
          onAnswer={(answer) => controller.apply({ type: 'followUp.answer', key, answer })}
        />
      ))}
      <Answer
        label="Does this cover the whole move?"
        value={session.wholeMoveCovered}
        disabled={readiness.unresolvedPhotos > 0}
        onAnswer={(answer) => controller.apply({ type: 'coverage.answer', answer })}
      />
    </Panel>
  )
}
export function ConversationPriceCard({ controller }: { controller: ConversationController }) {
  const { session, readiness } = controller
  const interrupted = Object.values(session.operations).some(
    (op) => op.status === 'interrupted' && op.request.kind === 'save' && op.revision === session.revision,
  )
  // Vision is checked by the explicit handler, not a mount effect and not a disabling deadlock.
  const ready =
    readiness.detailsComplete &&
    session.detailsConfirmed &&
    !!session.analysis &&
    session.items.length > 0 &&
    !readiness.unresolvedPhotos &&
    !readiness.unresolvedDuplicates &&
    !readiness.unansweredFollowUps.length &&
    readiness.coverageAnswered
  return (
    <Panel as="section" className="mv-stack" aria-label="Estimate confirmation">
      <Caption accent="green">Your estimate</Caption>
      {session.price ? (
        <>
          <p className="conv-price">
            {formatMoney(session.price.low, session.price.currency)} to{' '}
            {formatMoney(session.price.high, session.price.currency)}
          </p>
          <p>This is an estimate to plan with, not a binding quote.</p>
          <Badge tone="green">{titleCase(session.price.confidence ?? 'medium')} confidence</Badge>
          <p>{session.price.confidenceReasons?.join(' ') ?? 'A mover will verify the final scope.'}</p>
          <dl className="est-dl">
            {Object.entries(session.price.breakdown).map(([key, amount]) => (
              <div key={key} className="est-dl__row">
                <dt>{titleCase(key.replaceAll('_', ' '))}</dt>
                <dd>{formatMoney(amount, session.price?.currency ?? 'USD')}</dd>
              </div>
            ))}
          </dl>
          <p>{session.estimateId ? `Saved reference ${session.estimateId}` : 'Price received; not saved yet.'}</p>
        </>
      ) : (
        <p>Confirm the details and all inventory questions, then explicitly request a price.</p>
      )}
      {!session.estimateId && !interrupted ? (
        <Button
          variant="primary"
          disabled={!ready || controller.busy || controller.uploads.length > 0}
          onClick={() => void controller.confirmPrice()}
        >
          {session.price ? 'Retry save' : 'Confirm inventory and get estimate'}
        </Button>
      ) : null}
    </Panel>
  )
}
export function ConversationRequestCards({ controller }: { controller: ConversationController }) {
  const { session } = controller
  const [name, setName] = useState(session.contact?.name ?? '')
  const [email, setEmail] = useState(session.contact?.email ?? '')
  const [phone, setPhone] = useState(session.contact?.phone ?? '')
  const [editedDate, setDate] = useState<string | null>(null)
  const date = editedDate ?? session.contact?.requestedDate ?? session.moveDetails.date ?? ''
  const [picked, setPicked] = useState<string[]>([])
  const [note, setNote] = useState('')
  if (!session.estimateId || !session.price) return null
  const unknown = (kind: string) =>
    Object.values(session.operations).some(
      (op) => op.status === 'interrupted' && op.request.kind === kind && op.revision === session.revision,
    )
  return (
    <>
      <Panel as="section" className="mv-stack" aria-label="Date request">
        <Caption accent="tape">Request a move date</Caption>
        {session.scheduleResult ? (
          <p>
            Requested {session.scheduleResult.requestedDate}. Reference {session.scheduleResult.reference}. This is not
            a confirmed booking or dispatch.
          </p>
        ) : (
          <form
            className="mv-stack"
            onSubmit={(event) => {
              event.preventDefault()
              void controller.submitContact({ name, email, phone, requestedDate: date })
            }}
          >
            <Field label="Your name" htmlFor="request-name">
              <Input
                id="request-name"
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </Field>
            <Field label="Email" htmlFor="request-email">
              <Input
                id="request-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </Field>
            <Field label="Phone" htmlFor="request-phone">
              <Input
                id="request-phone"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                required
              />
            </Field>
            <Field label="Preferred move date" htmlFor="request-date">
              <Input
                id="request-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                required
              />
            </Field>
            <Button
              type="submit"
              variant="primary"
              disabled={controller.busy || !session.detailsConfirmed || unknown('schedule')}
            >
              Request this date
            </Button>
          </form>
        )}
      </Panel>
      {session.contact ? (
        <Panel as="section" className="mv-stack" aria-label="Mover quote requests">
          <Caption accent="sky">Ask movers for quotes</Caption>
          {session.quoteResult ? (
            <p>
              Quote requests recorded for {session.quoteResult.requests.map((record) => record.moverName).join(', ')}.{' '}
              {session.quoteResult.requests.every((record) => record.status === 'logged')
                ? 'Emails are logged rather than delivered in this version.'
                : ''}
            </p>
          ) : (
            <>
              <Button size="sm" onClick={() => void controller.loadMovers()} disabled={controller.moversBusy}>
                Choose movers
              </Button>
              <p>Pick up to three recipients. Nothing is sent until you confirm.</p>
              {controller.movers.map((mover) => (
                <label className="est-mover" key={mover.id}>
                  <input
                    type="checkbox"
                    checked={picked.includes(mover.id)}
                    disabled={!picked.includes(mover.id) && picked.length >= 3}
                    onChange={() =>
                      setPicked((current) =>
                        current.includes(mover.id)
                          ? current.filter((entry) => entry !== mover.id)
                          : [...current, mover.id],
                      )
                    }
                  />
                  {mover.name} <span className="est-small">{mover.serviceArea}</span>
                </label>
              ))}
              <Field label="A note for the movers" htmlFor="conversation-quote-note">
                <Textarea
                  id="conversation-quote-note"
                  rows={2}
                  maxLength={1000}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </Field>
              <Button
                variant="primary"
                disabled={!picked.length || controller.busy || !session.detailsConfirmed || unknown('quotes')}
                onClick={() => void controller.submitQuotes(picked, note)}
              >
                Send quote requests
              </Button>
            </>
          )}
        </Panel>
      ) : null}
    </>
  )
}
export function ConversationOperationCards({ controller }: { controller: ConversationController }) {
  const ops = Object.values(controller.session.operations)
  return (
    <>
      {ops
        .filter(
          (op) =>
            op.status === 'pending' ||
            op.status === 'interrupted' ||
            (op.status === 'failed' &&
              op.revision === controller.session.revision &&
              !ops.some(
                (later) =>
                  later.request.kind === op.request.kind &&
                  later.status === 'succeeded' &&
                  later.revision >= op.revision,
              )),
        )
        .map((op) => (
          <div key={op.id} className="conv-operation" role="status">
            {op.status === 'pending' ? (
              `${titleCase(op.request.kind)} in progress… You can keep writing.`
            ) : op.status === 'interrupted' ? (
              `${titleCase(op.request.kind)} interrupted — unknown outcome. Check the existing request before submitting again.`
            ) : (
              <>
                {titleCase(op.request.kind)} failed.{' '}
                {op.request.kind !== 'save' ? (
                  <Button size="sm" disabled={controller.busy} onClick={() => void controller.retry(op.id)}>
                    Retry {op.request.kind}
                  </Button>
                ) : null}
              </>
            )}
          </div>
        ))}
    </>
  )
}
