import { Bubble, Button, Caption, Panel } from '@movers/ui'
import { type RefObject, useState } from 'react'
import { conversationStage, displayFact, proposalSummary, type ConversationStage } from './conversation-presentation'
import type { ConversationController } from '../../lib/useConversationController'
import {
  ConversationOperationCards,
  ConversationPhotoCards,
  ConversationPriceCard,
  ConversationRequestCards,
  ConversationReviewCards,
} from './ConversationCards'

export function ConversationFeed({
  controller,
  logRef,
  contentRef,
  followRef,
  openData,
  onInteract,
}: {
  controller: ConversationController
  logRef: RefObject<HTMLDivElement>
  contentRef: RefObject<HTMLDivElement>
  followRef: RefObject<HTMLDivElement>
  openData: () => void
  onInteract: () => void
}) {
  const { session, readiness } = controller
  const [reopened, setReopened] = useState<{ stage: ConversationStage; revision: number } | null>(null)
  const requiredStage = conversationStage(session, readiness)
  const stage = reopened?.revision === session.revision ? reopened.stage : requiredStage
  const photosDurable = !!readiness.unresolvedPhotos || session.needsPhotoReupload || controller.uploads.length > 0
  const reviewDurable =
    !!session.analysis &&
    (!!readiness.unresolvedDuplicates || !!readiness.unansweredFollowUps.length || !readiness.coverageAnswered)
  const reopen = (value: ConversationStage) => setReopened({ stage: value, revision: session.revision })
  const latestMessageId = session.timeline.filter((entry) => entry.kind === 'message').at(-1)?.id
  return (
    <div
      ref={logRef}
      className="est-chat__log conv-feed"
      role="log"
      aria-label="Move conversation"
      aria-live="polite"
      onClickCapture={onInteract}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard access to the independently scrollable transcript.
      tabIndex={0}
    >
      <div ref={contentRef} className="est-chat__content">
        {!session.messages.length ? (
          <div ref={followRef} className="mv-stack" data-conversation-anchor="true">
            {/* biome-ignore lint/a11y/useValidAriaRole: Bubble's role is the speaker, not an ARIA role. */}
            <Bubble role="assistant" meta="Movers">
              Where are you moving from and to? If you know your move date, you can share that too. You can answer
              together or edit the shared manifest.
            </Bubble>
          </div>
        ) : null}
        {session.timeline.map((entry) =>
          entry.kind === 'message' ? (
            <div
              key={entry.id}
              className="mv-stack"
              ref={entry.id === latestMessageId ? followRef : undefined}
              data-conversation-anchor={entry.id === latestMessageId ? 'true' : undefined}
            >
              <Bubble role={entry.message.role} meta={entry.message.role === 'user' ? 'You' : 'Movers'}>
                {entry.message.content}
              </Bubble>
            </div>
          ) : entry.event === 'migration' ||
            entry.event === 'details.updated' ||
            entry.event === 'details.confirmed' ||
            entry.event === 'review.updated' ||
            entry.event === 'photos.updated' ? (
            <p key={entry.id} className="conv-event">
              {entry.event === 'migration'
                ? 'Your earlier draft is here. Confirm the move details before continuing.'
                : entry.event === 'details.confirmed'
                  ? 'Move details confirmed.'
                  : `${entry.area === 'details' ? 'Move details' : entry.area === 'photos' ? 'Photos' : 'Inventory review'} updated in the shared manifest.`}
            </p>
          ) : null,
        )}
        {controller.chatBusy ? <p role="status">Thinking… You can keep writing.</p> : null}
        {controller.error ? (
          <p role="alert" className="est-error">
            {controller.error}
          </p>
        ) : null}
        {controller.chatFailed ? (
          <Button size="sm" onClick={() => void controller.retryChat()}>
            Retry reply
          </Button>
        ) : null}
        {controller.suggestionsExpired ||
        session.pendingProposals.some((proposal) => proposal.expectedRevision !== session.revision) ? (
          <Panel className="mv-stack">
            <p role="status">
              Earlier suggestions expired because the move changed. Refresh suggestions or send a new message.
            </p>
            <Button size="sm" disabled={controller.chatBusy} onClick={() => void controller.retryChat()}>
              Refresh suggestions
            </Button>
          </Panel>
        ) : null}
        {session.requestedAction ? (
          <p role="status">
            Use the explicit{' '}
            {session.requestedAction === 'analyze'
              ? 'photo analysis'
              : session.requestedAction === 'price'
                ? 'Confirm inventory and get estimate'
                : session.requestedAction === 'schedule'
                  ? 'Request this date'
                  : 'Send quote requests'}{' '}
            control below. Accepting a suggestion does not run it.
          </p>
        ) : null}
        {session.pendingProposals
          .filter((proposal) => proposal.expectedRevision === session.revision)
          .map((proposal) => (
            <Panel key={proposal.id} className="mv-stack">
              <Caption>Suggested update — not yet accepted</Caption>
              <ul>
                {proposalSummary(proposal.command).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <div className="mv-actions">
                <Button
                  size="sm"
                  onClick={() =>
                    controller.apply(
                      { type: 'proposal.apply', proposalId: proposal.id },
                      'inline',
                      proposal.expectedRevision,
                    )
                  }
                >
                  Accept suggestion
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    controller.apply(
                      { type: 'proposal.dismiss', proposalId: proposal.id },
                      'inline',
                      proposal.expectedRevision,
                    )
                  }
                >
                  Dismiss suggestion
                </Button>
              </div>
            </Panel>
          ))}
        <div className="mv-actions" aria-label="Move stage summaries">
          {readiness.canRequestPhotos || session.photos.length || session.analysis ? (
            <Button size="sm" variant="ghost" onClick={() => reopen('details')}>
              {session.detailsConfirmed ? 'Move details confirmed · Reopen details' : 'Review move details'}
            </Button>
          ) : null}
          {session.analysis && stage !== 'photos' && !photosDurable ? (
            <Button size="sm" variant="ghost" onClick={() => reopen('photos')}>
              {session.photos.length} photos analysed · Reopen photos
            </Button>
          ) : null}
          {session.analysis && stage !== 'review' && !reviewDurable ? (
            <Button size="sm" variant="ghost" onClick={() => reopen('review')}>
              Inventory reviewed · Reopen review
            </Button>
          ) : null}
          {session.analysis && stage !== 'price' ? (
            <Button size="sm" variant="ghost" onClick={() => reopen('price')}>
              {session.price
                ? `Estimate received${session.estimateId ? ` · Saved reference ${session.estimateId}` : ''} · View estimate`
                : 'Review estimate requirements'}
            </Button>
          ) : null}
          {session.estimateId && session.price && stage !== 'requests' ? (
            <Button size="sm" variant="ghost" onClick={() => reopen('requests')}>
              Continue date and quote requests
            </Button>
          ) : null}
          {stage !== requiredStage && requiredStage ? (
            <Button size="sm" onClick={() => setReopened(null)}>
              Continue current step
            </Button>
          ) : null}
        </div>
        {stage === 'details' ? (
          <Panel as="section" className="mv-stack" aria-label="Confirm move details">
            <Caption accent="tape">The move we are estimating</Caption>
            <p>
              {session.moveDetails.from ? displayFact(session.moveDetails.from) : 'Origin needed'} →{' '}
              {session.moveDetails.to ? displayFact(session.moveDetails.to) : 'Destination needed'} ·{' '}
              {session.moveDetails.distanceMiles ?? '?'} miles · {session.moveDetails.date ?? 'Date not set'}
            </p>
            <div className="mv-actions">
              <Button size="sm" onClick={openData}>
                Edit move manifest
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={!readiness.detailsComplete || session.detailsConfirmed}
                onClick={() => controller.apply({ type: 'details.confirm' })}
              >
                {session.detailsConfirmed ? 'Details confirmed' : 'Confirm move details'}
              </Button>
            </div>
          </Panel>
        ) : null}
        {stage === 'photos' || photosDurable ? <ConversationPhotoCards controller={controller} /> : null}
        {stage === 'review' || reviewDurable ? <ConversationReviewCards controller={controller} /> : null}
        {stage === 'price' ? <ConversationPriceCard controller={controller} /> : null}
        <ConversationRequestCards key={session.sessionId} controller={controller} visible={stage === 'requests'} />
        <ConversationOperationCards controller={controller} />
      </div>
    </div>
  )
}
