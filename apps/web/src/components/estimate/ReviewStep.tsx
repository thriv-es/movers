import { Badge, Button, Caption, Field, Input, Panel } from '@movers/ui'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import type { AnalysisResult, DetectedItem } from '@/data'
import type { EstimateSession, FollowUpAnswers, FollowUpKey } from '@/lib/estimate-session'
import { photoEvidence } from '@/lib/review-photos'
import { canonicalItemType } from '@/lib/item-aliases'
import { titleCase } from './format'

/** What a "yes" adds to the inventory, so the price covers it. */
export const FOLLOW_UP_ITEMS: Record<FollowUpKey, DetectedItem> = {
  garage: { type: 'garage or storage unit contents', count: 1 },
  closets: { type: 'boxes (full closets)', count: 4 },
  appliances: { type: 'large appliance', count: 1 },
}

const FOLLOW_UP_QUESTIONS: { key: FollowUpKey; question: string }[] = [
  { key: 'garage', question: 'Is there a garage, shed or storage unit to empty?' },
  { key: 'closets', question: 'Are the closets and wardrobes full?' },
  { key: 'appliances', question: 'Any large appliances coming along (fridge, washer, dryer)?' },
]

interface ReviewStepProps {
  analysis: AnalysisResult
  photoDecisions?: EstimateSession['photoDecisions']
  photoDecisionsLocked?: boolean
  onPhotoDecision?: (url: string, decision: 'keep' | 'exclude') => void
  items: DetectedItem[]
  followUps: FollowUpAnswers
  wholeMoveCovered: boolean | null
  onWholeMoveCovered: (answer: boolean) => void
  onItemsChange: (items: DetectedItem[]) => void
  onFollowUp: (key: FollowUpKey, answer: boolean) => void
  onBack: () => void
  onConfirm: () => void
}

const sameType = (a: string, b: string) => canonicalItemType(a) === canonicalItemType(b)

/** Step 4: the inventory the model saw, with flags, a duplicate check and three follow-up questions. */
export function ReviewStep({
  analysis,
  photoDecisions = {},
  photoDecisionsLocked = false,
  onPhotoDecision,
  items,
  followUps,
  wholeMoveCovered,
  onWholeMoveCovered,
  onItemsChange,
  onFollowUp,
  onBack,
  onConfirm,
}: ReviewStepProps): JSX.Element {
  const unresolved = photoEvidence(analysis, photoDecisions).unresolvedCount > 0
  const [newType, setNewType] = useState('')
  const [newCount, setNewCount] = useState('1')
  const [resolvedDuplicates, setResolvedDuplicates] = useState<string[]>([])

  // A saved pre-alias review can have both labels. Keep its edited canonical label and sum every count.
  const reviewItems = useMemo(() => {
    const grouped = new Map<string, DetectedItem>()
    for (const item of items) {
      const key = canonicalItemType(item.type)
      const existing = grouped.get(key)
      if (!existing) grouped.set(key, item)
      else
        grouped.set(key, {
          ...existing,
          type:
            existing.type.trim().toLowerCase() !== key && item.type.trim().toLowerCase() === key
              ? item.type
              : existing.type,
          count: existing.count + item.count,
        })
    }
    return [...grouped.values()]
  }, [items])

  useEffect(() => {
    if (!unresolved && reviewItems.length !== items.length) onItemsChange(reviewItems)
  }, [items, reviewItems, onItemsChange, unresolved])

  const special = new Map(analysis.specialHandling.map((entry) => [canonicalItemType(entry.item), entry.reason]))
  const duplicates = analysis.possibleDuplicates.filter(
    (dup) => !resolvedDuplicates.includes(dup.item) && reviewItems.some((item) => sameType(item.type, dup.item)),
  )

  const setCount = (type: string, count: number) => {
    if (count <= 0) {
      onItemsChange(reviewItems.filter((item) => !sameType(item.type, type)))
      return
    }
    onItemsChange(reviewItems.map((item) => (sameType(item.type, type) ? { ...item, count } : item)))
  }

  const addItem = (event: FormEvent) => {
    event.preventDefault()
    const type = newType.trim()
    const count = Math.max(1, Math.round(Number(newCount) || 1))
    if (!type) return
    const existing = reviewItems.find((item) => sameType(item.type, type))
    if (existing) setCount(existing.type, existing.count + count)
    else onItemsChange([...reviewItems, { type, count }])
    setNewType('')
    setNewCount('1')
  }

  const mergeDuplicate = (type: string, keep: boolean) => {
    if (!keep) setCount(type, 1)
    setResolvedDuplicates((current) => [...current, type])
  }

  const total = reviewItems.reduce((sum, item) => sum + item.count, 0)
  const unanswered = FOLLOW_UP_QUESTIONS.filter((q) => followUps[q.key] === null).length

  return (
    <div className="mv-stack">
      {analysis.photoAssessments?.some((photo) => photo.status !== 'relevant') ? (
        <Panel as="section" aria-label="Photo relevance">
          <Caption accent="tape">Check your photos before editing</Caption>
          <p>Only confirmed movable items are included. Photos do not prove whole-move coverage.</p>
          {photoDecisionsLocked ? (
            <p>Photo decisions are locked after inventory edits. Return to Photos to start again.</p>
          ) : null}
          <ul>
            {analysis.photoAssessments.map((photo, index) =>
              photo.status !== 'relevant' ? (
                <li key={photo.url}>
                  <p>
                    Photo {index + 1}: {photo.reason}
                  </p>
                  {photo.status === 'uncertain' ? (
                    <>
                      <img src={photo.url} alt={`Selected upload ${index + 1} to review`} width={160} loading="lazy" />
                      <p>
                        Candidate items (not included until kept):{' '}
                        {photo.candidates?.items.map((item) => `${item.count} ${item.type}`).join(', ') ||
                          'None detected'}
                      </p>
                      <Button
                        disabled={photoDecisionsLocked}
                        aria-pressed={photoDecisions[photo.url] === 'keep'}
                        onClick={() => onPhotoDecision?.(photo.url, 'keep')}
                      >
                        Keep photo {index + 1}
                      </Button>
                      <Button
                        disabled={photoDecisionsLocked}
                        aria-pressed={photoDecisions[photo.url] === 'exclude'}
                        onClick={() => onPhotoDecision?.(photo.url, 'exclude')}
                      >
                        Exclude photo {index + 1}
                      </Button>
                      {photoDecisions[photo.url] === 'exclude' ? (
                        <p>Excluded by you; candidate items are not included.</p>
                      ) : null}
                    </>
                  ) : (
                    <p>Excluded from inventory.</p>
                  )}
                </li>
              ) : null,
            )}
          </ul>
          {unresolved ? <p>Keep or exclude every uncertain photo before editing inventory or confirming.</p> : null}
        </Panel>
      ) : null}
      <fieldset
        disabled={unresolved}
        className="mv-stack"
        style={{ border: 0, padding: 0, margin: 0 }}
        aria-label="Inventory editing"
      >
        <Panel as="section" aria-label="Inventory">
          <div className="mv-row est-upload__head">
            <Caption accent="sky">What we counted</Caption>
          </div>
          <p className="mv-lede">
            {total} item{total === 1 ? '' : 's'} across {reviewItems.length} kind{reviewItems.length === 1 ? '' : 's'},
            roughly {analysis.estimatedBoxes.min} to {analysis.estimatedBoxes.max} boxes. Fix anything we got wrong.
          </p>

          {!analysis.photoAssessments && analysis.photoLinkStatuses?.some((photo) => photo.status !== 'eligible') ? (
            <div className="mv-muted">
              <p>Some photos were excluded. This inventory only covers the usable photos.</p>
              <ul aria-label="Photos excluded from inventory">
                {analysis.photoLinkStatuses.map((photo, index) =>
                  photo.status !== 'eligible' ? (
                    <li key={`${index}-${photo.status}`}>
                      Photo {index + 1}: {photo.reason}
                    </li>
                  ) : null,
                )}
              </ul>
            </div>
          ) : null}
          {!unresolved && reviewItems.length === 0 ? (
            <p>No accepted inventory remains. Add an item or return to Photos before pricing.</p>
          ) : null}
          <ul className="est-items" aria-label="Detected items">
            {reviewItems.map((item) => {
              const reason = special.get(canonicalItemType(item.type))
              return (
                <li key={item.type} className="est-item">
                  <div className="est-item__name">
                    <span>{titleCase(item.type)}</span>
                    {reason ? (
                      <Badge tone="tape" title={reason}>
                        Special handling
                      </Badge>
                    ) : null}
                    {reason ? <span className="mv-muted est-small">{reason}</span> : null}
                  </div>
                  <div className="est-item__count" aria-label={`${item.type} count`}>
                    <Button
                      size="sm"
                      onClick={() => setCount(item.type, item.count - 1)}
                      aria-label={`One fewer ${item.type}`}
                    >
                      -
                    </Button>
                    <span className="est-item__num">{item.count}</span>
                    <Button
                      size="sm"
                      onClick={() => setCount(item.type, item.count + 1)}
                      aria-label={`One more ${item.type}`}
                    >
                      +
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setCount(item.type, 0)}>
                      Remove
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>

          <form className="est-add" onSubmit={addItem}>
            <Field label="Add something we missed" htmlFor="add-type" className="est-add__type">
              <Input
                id="add-type"
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
                placeholder="Piano, treadmill, boxes"
              />
            </Field>
            <Field label="Count" htmlFor="add-count" className="est-add__count">
              <Input
                id="add-count"
                type="number"
                min={1}
                inputMode="numeric"
                value={newCount}
                onChange={(e) => setNewCount(e.target.value)}
              />
            </Field>
            <Button type="submit" disabled={newType.trim() === ''}>
              Add
            </Button>
          </form>
        </Panel>

        {duplicates.length > 0 ? (
          <Panel tone="kraft" flat as="section" aria-label="Possible duplicates">
            <Caption accent="tape">Did we count this twice?</Caption>
            <ul className="est-dups">
              {duplicates.map((dup) => (
                <li key={dup.item} className="est-dup">
                  <span>
                    The {dup.item} appears in more than one photo. We counted {dup.count}.
                  </span>
                  <div className="mv-actions">
                    <Button size="sm" variant="primary" onClick={() => mergeDuplicate(dup.item, false)}>
                      Same one, count it once
                    </Button>
                    <Button size="sm" onClick={() => mergeDuplicate(dup.item, true)}>
                      Different ones, keep {dup.count}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        <Panel as="section" aria-label="A few more questions">
          <Caption accent="green">Check what we missed</Caption>
          {analysis.unseenAreas.length > 0 ? (
            <p className="mv-muted">The photos did not show: {analysis.unseenAreas.join(', ')}.</p>
          ) : null}
          <ul className="est-followups">
            {FOLLOW_UP_QUESTIONS.map((q) => (
              <li key={q.key} className="est-followup">
                <span>{q.question}</span>
                <div className="mv-actions" role="group" aria-label={q.question}>
                  <Button
                    size="sm"
                    variant={followUps[q.key] === true ? 'primary' : 'default'}
                    aria-pressed={followUps[q.key] === true}
                    onClick={() => onFollowUp(q.key, true)}
                  >
                    Yes
                  </Button>
                  <Button
                    size="sm"
                    variant={followUps[q.key] === false ? 'primary' : 'default'}
                    aria-pressed={followUps[q.key] === false}
                    onClick={() => onFollowUp(q.key, false)}
                  >
                    No
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {unanswered > 0 ? (
            <p className="mv-muted est-small">
              Answer {unanswered === 3 ? 'these' : `the remaining ${unanswered}`} to get the most accurate price.
            </p>
          ) : null}
          <div className="est-followup">
            <span>
              Does this inventory cover everything in the whole move, including areas not shown in the photos?
            </span>
            <div className="mv-actions" role="group" aria-label="Does the inventory cover the whole move?">
              <Button
                size="sm"
                variant={wholeMoveCovered === true ? 'primary' : 'default'}
                aria-pressed={wholeMoveCovered === true}
                onClick={() => onWholeMoveCovered(true)}
              >
                Yes
              </Button>
              <Button
                size="sm"
                variant={wholeMoveCovered === false ? 'primary' : 'default'}
                aria-pressed={wholeMoveCovered === false}
                onClick={() => onWholeMoveCovered(false)}
              >
                No
              </Button>
            </div>
          </div>
        </Panel>
      </fieldset>
      <div className="mv-actions">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" onClick={onConfirm} disabled={unresolved || reviewItems.length === 0}>
          Confirm and price it
        </Button>
      </div>
    </div>
  )
}
