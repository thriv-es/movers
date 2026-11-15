import { Badge, Button, Caption, Field, Panel, Textarea } from '@movers/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnalysisResult, DetectedItem, MoveDetails, Price, PublicMover, ReviewCoverage } from '@/data'
import { createEstimate, listMovers, priceApi, requestQuotes } from '@/lib/api-client'
import { formatMoney, titleCase } from './format'

interface EstimateStepProps {
  analysis: AnalysisResult
  items: DetectedItem[]
  moveDetails: MoveDetails
  review: ReviewCoverage
  price: Price | null
  estimateId: string | null
  photoUrls: string[]
  sample: boolean
  /** Bumps whenever the inventory or details change, so the step prices again. */
  onPriced: (price: Price, estimateId: string) => void
  onBack: () => void
  onSchedule: () => void
}

const CONFIDENCE_COPY: Record<NonNullable<Price['confidence']>, string> = {
  high: 'This range uses the inventory and move details you confirmed; a mover will verify the final scope.',
  medium: 'Some coverage or move details remain uncertain, so the range is wider.',
  low: 'Important coverage or move details remain uncertain; treat this as a rough range.',
}

/** Step 5: the price range, saved as a lead, with the option to ask up to three movers for quotes. */
export function EstimateStep({
  analysis,
  items,
  moveDetails,
  review,
  price,
  estimateId,
  photoUrls,
  sample,
  onPriced,
  onBack,
  onSchedule,
}: EstimateStepProps): JSX.Element {
  const [loading, setLoading] = useState(price === null)
  const [error, setError] = useState<string | null>(null)
  const [movers, setMovers] = useState<PublicMover[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<{ names: string[]; logged: boolean } | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  // survives StrictMode's double effect run, so one confirmation means one price call and one saved lead
  const inFlight = useRef(false)
  const active = useRef(true)

  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])

  const runPricing = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setError(null)
    try {
      const analysisWithItems = { ...analysis, items }
      const { price: fresh } = await priceApi(analysisWithItems, moveDetails, review, sample)
      if (!active.current) return
      const created = await createEstimate({
        source: sample ? 'sample' : 'own',
        moveDetails,
        analysis: analysisWithItems,
        items,
        price: fresh,
        photoKeys: photoUrls,
      })
      if (active.current) onPriced(fresh, created.id)
    } catch (caught) {
      if (active.current) setError(caught instanceof Error ? caught.message : 'Pricing failed. Try again.')
    } finally {
      inFlight.current = false
      if (active.current) setLoading(false)
    }
  }, [analysis, items, moveDetails, review, sample, photoUrls, onPriced])

  useEffect(() => {
    if (price === null) void runPricing()
  }, [price, runPricing])

  useEffect(() => {
    let cancelled = false
    listMovers()
      .then((list) => {
        if (!cancelled) setMovers(list)
      })
      .catch(() => {
        if (!cancelled) setMovers([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const togglePick = (id: string) => {
    setPicked((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id)
      if (current.length >= 3) return current
      return [...current, id]
    })
  }

  const sendQuotes = async () => {
    if (!estimateId || picked.length === 0) return
    setSending(true)
    setQuoteError(null)
    try {
      const result = await requestQuotes(estimateId, picked, note)
      const channels = Object.values(result.delivery)
      setSent({
        names: result.requests.map((request) => request.moverName),
        logged: channels.length > 0 && channels.every((channel) => channel === 'logged'),
      })
    } catch (caught) {
      setQuoteError(caught instanceof Error ? caught.message : 'Could not send the quote requests.')
    } finally {
      setSending(false)
    }
  }

  if (loading || (price === null && !error)) {
    return (
      <Panel as="section" aria-live="polite" className="est-wait est-wait--tall">
        <Caption accent="green">Calculating your estimate</Caption>
        <p className="mv-lede">
          Adding up {items.reduce((sum, item) => sum + item.count, 0)} items, the distance, floors and anything special.
        </p>
      </Panel>
    )
  }

  if (price === null) {
    return (
      <Panel as="section" tone="kraft" className="mv-stack">
        <Caption accent="tape">Pricing did not go through</Caption>
        <p className="est-error" role="alert">
          {error}
        </p>
        <p className="mv-muted">Your inventory is safe. Try again, or go back and check the details.</p>
        <div className="mv-actions">
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
          <Button variant="primary" onClick={() => void runPricing()}>
            Retry
          </Button>
        </div>
      </Panel>
    )
  }

  const breakdown = Object.entries(price.breakdown)
  const confidence = price.confidence ?? 'medium'

  return (
    <div className="mv-stack">
      <Panel as="section" tone="ink" className="est-price" aria-label="Your estimate">
        <div className="mv-row est-upload__head">
          <Caption>Your estimate</Caption>
        </div>
        <p className="est-price__range">
          {formatMoney(price.low, price.currency)} to {formatMoney(price.high, price.currency)}
        </p>
        <p className="est-price__mid">Most likely around {formatMoney(price.total, price.currency)}</p>
        <p className="est-price__notice">
          This is an estimate to plan with, not a binding quote. Your mover confirms the final price.
        </p>
        <p className="est-price__confidence">
          <Badge tone={confidence === 'high' ? 'green' : confidence === 'medium' ? 'tape' : 'paper'}>
            {titleCase(confidence)} confidence
          </Badge>{' '}
          {price.confidenceReasons?.length ? price.confidenceReasons.join(' ') : CONFIDENCE_COPY[confidence]}
        </p>
      </Panel>

      <Panel as="section" aria-label="Breakdown">
        <Caption accent="sky">How it adds up</Caption>
        <div className="mv-table--wrap">
          <table className="mv-table">
            <tbody>
              {breakdown.map(([label, amount]) => (
                <tr key={label}>
                  <td>{titleCase(label.replace(/_/g, ' '))}</td>
                  <td className="est-num">{formatMoney(amount, price.currency)}</td>
                </tr>
              ))}
              <tr>
                <th scope="row">Midpoint</th>
                <th scope="row" className="est-num">
                  {formatMoney(price.total, price.currency)}
                </th>
              </tr>
            </tbody>
          </table>
        </div>
        {price.explanation ? <p className="mv-muted">{price.explanation}</p> : null}
        {error ? (
          <p className="est-error" role="alert">
            {error}
          </p>
        ) : null}
      </Panel>

      {movers.length > 0 ? (
        <Panel as="section" tone="kraft" flat aria-label="Get quotes from movers">
          <Caption accent="green">Get quotes from movers</Caption>
          {sent ? (
            <div className="mv-stack">
              <p>
                Sent to {sent.names.join(', ')}.{' '}
                {sent.logged ? 'Emails are logged rather than delivered in this version.' : 'They will be in touch.'}
              </p>
              <Badge tone="green">{sent.logged ? 'Quote requests logged' : 'Quote requests sent'}</Badge>
            </div>
          ) : (
            <div className="mv-stack">
              <p className="mv-muted">
                Pick up to three movers who have signed up. They receive your inventory and this estimate.
              </p>
              <ul className="est-movers">
                {movers.map((mover) => {
                  const checked = picked.includes(mover.id)
                  return (
                    <li key={mover.id}>
                      <label className={`est-mover${checked ? ' is-picked' : ''}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePick(mover.id)}
                          disabled={!checked && picked.length >= 3}
                        />
                        <span className="est-mover__name">{mover.name}</span>
                        {mover.serviceArea ? <span className="mv-muted est-small">{mover.serviceArea}</span> : null}
                      </label>
                    </li>
                  )
                })}
              </ul>
              <Field label="A note for the movers" htmlFor="quote-note" help="Optional">
                <Textarea id="quote-note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
              </Field>
              {quoteError ? (
                <p className="est-error" role="alert">
                  {quoteError}
                </p>
              ) : null}
              <div className="mv-actions">
                <Button variant="primary" onClick={sendQuotes} disabled={picked.length === 0 || sending || !estimateId}>
                  {sending
                    ? 'Sending...'
                    : `Ask ${picked.length || ''} mover${picked.length === 1 ? '' : 's'} for quotes`}
                </Button>
              </div>
            </div>
          )}
        </Panel>
      ) : null}

      <div className="mv-actions">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" onClick={onSchedule}>
          Schedule the move
        </Button>
      </div>
    </div>
  )
}
