import { Button, Caption, Field, Input, Select } from '@movers/ui'
import { useState } from 'react'
import type { MoveDetails } from '../../data'
import type { ConversationController } from '../../lib/useConversationController'
import { canonicalItemType } from '../../lib/item-aliases'
import { conversationAnalysis } from '../../lib/conversation-state'
import { formatMoney } from '../estimate/format'

const fields: { key: keyof MoveDetails; label: string; type?: string }[] = [
  { key: 'from', label: 'Moving from' },
  { key: 'to', label: 'Moving to' },
  { key: 'distanceMiles', label: 'Distance (miles)', type: 'number' },
  { key: 'date', label: 'Move date', type: 'date' },
  { key: 'originFloor', label: 'Floor at origin', type: 'number' },
  { key: 'originElevator', label: 'Elevator at origin', type: 'boolean' },
  { key: 'destinationFloor', label: 'Floor at destination', type: 'number' },
  { key: 'destinationElevator', label: 'Elevator at destination', type: 'boolean' },
]
export function ConversationDataPanel({ controller }: { controller: ConversationController }) {
  const { session, readiness } = controller
  const [addition, setAddition] = useState('')
  const editable = !!session.analysis && readiness.unresolvedPhotos === 0
  const items = new Map<string, number>()
  for (const item of session.items) {
    const type = canonicalItemType(item.type)
    items.set(type, (items.get(type) ?? 0) + item.count)
  }
  const reviewed = conversationAnalysis(session)
  return (
    <section className="conv-data mv-stack" aria-label="Move manifest">
      <Caption accent="green">What we know so far</Caption>
      <p className="est-small mv-muted">
        Shared with this conversation. Changes clear dependent inventory or estimates.
      </p>
      <div className="conv-details">
        {fields.map(({ key, label, type }) => (
          <Field key={key} label={label} htmlFor={`manifest-${key}`}>
            {type === 'boolean' ? (
              <Select
                id={`manifest-${key}`}
                value={session.moveDetails[key] === null ? '' : session.moveDetails[key] ? 'yes' : 'no'}
                onChange={(event) =>
                  controller.apply(
                    {
                      type: 'details.patch',
                      patch: { [key]: event.target.value === '' ? null : event.target.value === 'yes' },
                    },
                    'panel',
                  )
                }
              >
                <option value="">Not sure</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Select>
            ) : (
              <Input
                id={`manifest-${key}`}
                type={type ?? 'text'}
                min={type === 'number' ? (key === 'distanceMiles' ? 0 : 1) : undefined}
                value={String(session.moveDetails[key] ?? '')}
                onChange={(event) =>
                  controller.apply(
                    {
                      type: 'details.patch',
                      patch: {
                        [key]:
                          event.target.value === ''
                            ? null
                            : type === 'number'
                              ? Number(event.target.value)
                              : event.target.value,
                      },
                    },
                    'panel',
                  )
                }
              />
            )}
          </Field>
        ))}
      </div>
      <h2 className="conv-heading">Accepted inventory</h2>
      {!items.size ? (
        <p>No accepted inventory remains. Add an item or upload usable photos before pricing.</p>
      ) : (
        <ul className="conv-inventory">
          {[...items].map(([type, count]) => (
            <li key={type} aria-label={`${type} count`}>
              <span>
                <strong>{type}</strong> × {count}
              </span>
              <div className="mv-actions">
                <Button
                  size="sm"
                  aria-label={`One fewer ${type}`}
                  disabled={!editable || count <= 1}
                  onClick={() => controller.apply({ type: 'item.count', itemType: type, count: count - 1 }, 'panel')}
                >
                  −
                </Button>
                <Button
                  size="sm"
                  aria-label={`One more ${type}`}
                  disabled={!editable}
                  onClick={() => controller.apply({ type: 'item.count', itemType: type, count: count + 1 }, 'panel')}
                >
                  +
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!editable}
                  onClick={() => controller.apply({ type: 'item.remove', itemType: type }, 'panel')}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form
        className="mv-stack"
        onSubmit={(event) => {
          event.preventDefault()
          if (
            addition.trim() &&
            controller.apply({ type: 'item.add', item: { type: addition.trim(), count: 1 } }, 'panel')
          )
            setAddition('')
        }}
      >
        <Field label="Add something we missed" htmlFor="manifest-add">
          <Input
            id="manifest-add"
            value={addition}
            maxLength={200}
            disabled={!editable}
            onChange={(event) => setAddition(event.target.value)}
          />
        </Field>
        <Button type="submit" size="sm" disabled={!editable || !addition.trim()}>
          Add
        </Button>
      </form>
      {reviewed ? (
        <div className="est-small">
          <p>
            Reviewed volume: {reviewed.totalVolumeCubicFeet} ft³ · Boxes: {reviewed.estimatedBoxes.min}–
            {reviewed.estimatedBoxes.max}
          </p>
          {reviewed.boxesExplanation ? <p>{reviewed.boxesExplanation}</p> : null}
          {reviewed.specialHandling.map((item) => (
            <p key={`${item.item}-${item.reason}`}>
              {item.item}: {item.reason}
            </p>
          ))}
        </div>
      ) : null}
      <h2 className="conv-heading">Photos & review</h2>
      <p>
        {session.photos.length} selected · {readiness.unresolvedPhotos} uncertain · {readiness.unresolvedDuplicates}{' '}
        duplicate checks
      </p>
      <p>
        Garage: {String(session.followUps.garage ?? 'unanswered')} · Closets:{' '}
        {String(session.followUps.closets ?? 'unanswered')} · Appliances:{' '}
        {String(session.followUps.appliances ?? 'unanswered')}
      </p>
      <p>
        Whole move covered: {session.wholeMoveCovered === null ? 'unanswered' : session.wholeMoveCovered ? 'Yes' : 'No'}
      </p>
      {session.price ? (
        <div>
          <h2 className="conv-heading">Estimate</h2>
          <p>
            {formatMoney(session.price.low, session.price.currency)}–
            {formatMoney(session.price.high, session.price.currency)}
          </p>
          <p>{session.estimateId ? `Reference ${session.estimateId}` : 'Not saved yet'}</p>
        </div>
      ) : null}
      {session.scheduleResult ? <p>Date requested: {session.scheduleResult.requestedDate}. Not a booking.</p> : null}
      {session.quoteResult ? <p>{session.quoteResult.requests.length} mover quote requests recorded.</p> : null}
    </section>
  )
}
