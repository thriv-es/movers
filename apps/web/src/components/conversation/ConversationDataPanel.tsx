import { Caption } from '@movers/ui'
import type { ConversationController } from '../../lib/useConversationController'
import { routeSummary } from './conversation-presentation'
import { MoveSummary } from './MoveSummary'

export function ConversationDataPanel({ controller }: { controller: ConversationController }) {
  const { session, completeness } = controller
  return (
    <section className="conv-data mv-stack" aria-label="Move manifest">
      <div className="conv-completeness">
        <div className="conv-completeness__label">
          <span>Move information</span>
          <strong>{completeness.percent}%</strong>
        </div>
        {/* biome-ignore lint/a11y/useFocusableInteractive: Passive progress, not a keyboard interaction. */}
        <div
          className="conv-completeness__track"
          role="progressbar"
          aria-label="Move information completeness"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={completeness.percent}
        >
          <span style={{ width: `${completeness.percent}%` }} />
        </div>
        <p className="est-small mv-muted">How much we know about your move—not price confidence.</p>
      </div>
      <Caption accent="green">What we know so far</Caption>
      <p className="est-small mv-muted">Your photos and answers, kept together. Correct anything in the chat.</p>
      <MoveSummary session={session} />
      {session.route ? <p className="est-small mv-muted">{routeSummary(session.route)}</p> : null}
      {completeness.missing.length ? (
        <div className="conv-still-needed">
          <h2 className="conv-heading">Still to check</h2>
          <ul>
            {completeness.missing.map((missing) => (
              <li key={missing}>{missing}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
