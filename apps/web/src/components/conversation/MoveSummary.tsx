import type { ConversationSession } from '../../lib/conversation-state'
import { conversationAnalysis } from '../../lib/conversation-state'
import { canonicalItemType } from '../../lib/item-aliases'
import { displayFact } from './conversation-presentation'

export function accessDescription(floor: number | null, elevator: boolean | null): string {
  if (floor === null) return 'Floor not known yet'
  if (floor === 0) return 'Ground floor'
  return `Floor ${floor} · ${elevator === null ? 'elevator not known' : elevator ? 'with elevator' : 'no elevator'}`
}
export function summaryRows(session: ConversationSession): { label: string; value: string }[] {
  const details = session.moveDetails
  const dateWindow = session.facts.find((fact) => fact.field === 'dateWindow')
  return [
    { label: 'Moving from', value: displayFact(details.from) },
    { label: 'Moving to', value: displayFact(details.to) },
    { label: 'Pickup access', value: accessDescription(details.originFloor, details.originElevator) },
    { label: 'Delivery access', value: accessDescription(details.destinationFloor, details.destinationElevator) },
    {
      label: 'Move date',
      value: details.date
        ? displayFact(details.date)
        : dateWindow
          ? `${displayFact(dateWindow.wording)} (date window)`
          : 'Not decided yet',
    },
  ]
}
export function MoveSummary({ session }: { session: ConversationSession }) {
  const inventory = new Map<string, number>()
  for (const item of session.items) {
    const name = canonicalItemType(item.type)
    inventory.set(name, (inventory.get(name) ?? 0) + item.count)
  }
  const analysis = conversationAnalysis(session)
  return (
    <div className="mv-stack conv-move-summary">
      <dl className="conv-facts">
        {summaryRows(session).map(({ label, value }) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div>
        <h2 className="conv-heading">What is moving</h2>
        {inventory.size ? (
          <ul className="conv-inventory" aria-label="Move inventory">
            {[...inventory].map(([type, count]) => (
              <li key={type}>
                <span>{displayFact(type)}</span>
                <strong>× {count}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p className="est-small mv-muted">We’ll build your item list from your photos and answers.</p>
        )}
      </div>
      <div className="conv-boxes">
        <h2 className="conv-heading">Estimated packing boxes</h2>
        {analysis ? (
          <>
            <p className="conv-boxes__range">
              {analysis.estimatedBoxes.min}–{analysis.estimatedBoxes.max} <span>boxes</span>
            </p>
            <p className="est-small mv-muted">
              An estimate from the reviewed photos. Tell us about anything not shown.
            </p>
          </>
        ) : (
          <p className="est-small mv-muted">Waiting for usable room photos.</p>
        )}
      </div>
      <dl className="conv-facts conv-facts--compact">
        {(['garage', 'closets', 'appliances'] as const).map((key) => (
          <div key={key}>
            <dt>
              {key === 'garage' ? 'Garage / storage extras' : key === 'closets' ? 'Closet extras' : 'Appliance extras'}
            </dt>
            <dd>
              {session.followUps[key] === null
                ? 'Not checked yet'
                : session.followUps[key]
                  ? 'Included'
                  : 'No extra items'}
            </dd>
          </div>
        ))}
        <div>
          <dt>Whole move covered</dt>
          <dd>
            {session.wholeMoveCovered === null
              ? 'Not confirmed yet'
              : session.wholeMoveCovered
                ? 'Yes'
                : 'More items to discuss'}
          </dd>
        </div>
      </dl>
      {analysis?.specialHandling.length ? (
        <div>
          <h2 className="conv-heading">Needs special care</h2>
          <ul>
            {analysis.specialHandling.map((item) => (
              <li key={`${item.item}-${item.reason}`}>
                {displayFact(item.item)}: {displayFact(item.reason)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
