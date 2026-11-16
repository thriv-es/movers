import { Bubble, Button, Caption, Panel } from '@movers/ui'
import type { RefObject } from 'react'
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
}: {
  controller: ConversationController
  logRef: RefObject<HTMLDivElement>
  contentRef: RefObject<HTMLDivElement>
  followRef: RefObject<HTMLDivElement>
  openData: () => void
}) {
  const { session, readiness } = controller
  const latestMessageId = session.timeline.filter((entry) => entry.kind === 'message').at(-1)?.id
  return (
    <div
      ref={logRef}
      className="est-chat__log conv-feed"
      role="log"
      aria-label="Move conversation"
      aria-live="polite"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard access to the independently scrollable transcript.
      tabIndex={0}
    >
      <div ref={contentRef} className="est-chat__content">
        {!session.messages.length ? (
          <div ref={followRef} className="mv-stack" data-conversation-anchor="true">
            {/* biome-ignore lint/a11y/useValidAriaRole: Bubble's role is the speaker, not an ARIA role. */}
            <Bubble role="assistant" meta="Movers">
              Tell me where you’re moving from and to, roughly how far, and when. You can answer several things together
              or edit the shared manifest.
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
              <Caption>Suggested update</Caption>
              <p>
                {proposal.command.type === 'details.patch'
                  ? 'Update the move details shown in this proposal.'
                  : proposal.command.type}
              </p>
              <pre className="conv-proposal">{JSON.stringify(proposal.command, null, 2)}</pre>
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
        <Panel as="section" className="mv-stack" aria-label="Confirm move details">
          <Caption accent="tape">The move we are estimating</Caption>
          <p>
            {session.moveDetails.from ?? 'Origin needed'} → {session.moveDetails.to ?? 'Destination needed'} ·{' '}
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
        <ConversationPhotoCards controller={controller} />
        <ConversationReviewCards controller={controller} />
        <ConversationPriceCard controller={controller} />
        <ConversationRequestCards key={session.sessionId} controller={controller} />
        <ConversationOperationCards controller={controller} />
      </div>
    </div>
  )
}
