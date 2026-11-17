import { Bubble, Button } from '@movers/ui'
import type { RefObject } from 'react'
import type { ConversationController } from '../../lib/useConversationController'
import { proposalSummary } from './conversation-presentation'
import { ConversationOperationCards } from './ConversationCards'
import { ConversationPhotos } from './ConversationPhotos'

export function ConversationFeed({
  controller,
  logRef,
  contentRef,
  followRef,
  onInteract,
}: {
  controller: ConversationController
  logRef: RefObject<HTMLDivElement>
  contentRef: RefObject<HTMLDivElement>
  followRef: RefObject<HTMLDivElement>
  openData: () => void
  onInteract: () => void
}) {
  const { session } = controller
  const latestMessageId = session.timeline.filter((entry) => entry.kind === 'message').at(-1)?.id
  const proposals = session.pendingProposals.filter((proposal) => proposal.expectedRevision === session.revision)
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
        <div
          className="mv-stack"
          ref={!session.messages.length ? followRef : undefined}
          data-conversation-anchor={!session.messages.length ? 'true' : undefined}
        >
          {/* biome-ignore lint/a11y/useValidAriaRole: Bubble's role is the speaker, not an ARIA role. */}
          <Bubble role="assistant" meta="Movers">
            Hi! I’ll help estimate your move. Where are you moving from and to?
          </Bubble>
        </div>
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
          ) : null,
        )}
        <ConversationPhotos controller={controller} />
        {controller.chatBusy ? (
          <p role="status" className="conv-thinking">
            Thinking… You can keep writing.
          </p>
        ) : null}
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
        {controller.suggestionsExpired ? (
          <p className="est-small mv-muted">The move changed. Send a new message to update the assistant.</p>
        ) : null}
        {proposals.length ? (
          <details className="conv-pending">
            <summary>Review suggested changes</summary>
            <p className="est-small">These changes need your confirmation. They do not book or send anything.</p>
            {proposals.map((proposal) => (
              <div key={proposal.id} className="mv-stack">
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
              </div>
            ))}
          </details>
        ) : null}
        <ConversationOperationCards controller={controller} />
      </div>
    </div>
  )
}
