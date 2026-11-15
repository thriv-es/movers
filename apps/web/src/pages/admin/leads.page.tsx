import { useCallback, useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Badge, Button, Field, Panel, Select, Textarea } from '@movers/ui'
import type { BadgeProps } from '@movers/ui'
import { titleCase } from '@/components/estimate/format'
import type { EstimateRecord, LeadStatus, MoveDetails } from '@/data'
import { formatDateTime, formatMoney, getLead, listLeads, toMessage, updateLead } from '@/lib/admin-api'
import type { LeadDetail } from '@/lib/admin-api'

const LEAD_STATUSES: LeadStatus[] = ['new', 'contacted', 'quoted', 'won', 'lost']

const STATUS_TONE: Record<LeadStatus, BadgeProps['tone']> = {
  new: 'sky',
  contacted: 'tape',
  quoted: 'green',
  won: 'green',
  lost: 'ink',
}

function isLeadStatus(value: string): value is LeadStatus {
  return (LEAD_STATUSES as string[]).includes(value)
}

function show(value: string | number | null | undefined, suffix = ''): string {
  if (value === null || value === undefined || value === '') return '?'
  return `${value}${suffix}`
}

function showBool(value: boolean | null): string {
  if (value === null) return '?'
  return value ? 'yes' : 'no'
}

function itemCount(lead: EstimateRecord): number {
  return lead.items.reduce((sum, item) => sum + item.count, 0)
}

function routeLabel(details: MoveDetails): string {
  return `${show(details.from)} \u2192 ${show(details.to)}`
}

export default function LeadsPage() {
  const [filter, setFilter] = useState<LeadStatus | ''>('')
  const [leads, setLeads] = useState<EstimateRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setListError(null)
    try {
      setLeads(await listLeads(filter || undefined))
    } catch (error) {
      setListError(toMessage(error))
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    void load()
  }, [load])

  const onRowKey = (event: KeyboardEvent<HTMLTableRowElement>, id: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setSelectedId(id)
    }
  }

  return (
    <div className="mv-stack">
      <div className="mv-row">
        <Field label="Status" htmlFor="lead-filter">
          <Select
            id="lead-filter"
            value={filter}
            onChange={(event) => {
              const value = event.target.value
              setFilter(isLeadStatus(value) ? value : '')
            }}
          >
            <option value="">All</option>
            {LEAD_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="button" onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
        <Button href="/api/admin/leads.csv" variant="ghost">
          Download CSV
        </Button>
      </div>

      {listError ? <Panel tone="kraft">Could not load leads: {listError}</Panel> : null}

      <div className={selectedId ? 'adm-split adm-split--open' : 'adm-split'}>
        <div className="mv-table--wrap">
          <table className="mv-table">
            <thead>
              <tr>
                <th>Created</th>
                <th>Route</th>
                <th>Distance</th>
                <th>Items</th>
                <th>Estimate</th>
                <th>Status</th>
                <th>Contact</th>
              </tr>
            </thead>
            <tbody>
              {leads.length === 0 ? (
                <tr>
                  <td colSpan={7} className="mv-muted">
                    {loading ? 'Loading leads...' : 'No leads yet.'}
                  </td>
                </tr>
              ) : (
                leads.map((lead) => (
                  <tr
                    key={lead.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={lead.id === selectedId}
                    className={lead.id === selectedId ? 'adm-row--click adm-row--selected' : 'adm-row--click'}
                    onClick={() => setSelectedId(lead.id)}
                    onKeyDown={(event) => onRowKey(event, lead.id)}
                  >
                    <td className="adm-nowrap">{formatDateTime(lead.createdAt)}</td>
                    <td>{routeLabel(lead.moveDetails)}</td>
                    <td>{show(lead.moveDetails.distanceMiles, ' mi')}</td>
                    <td>{itemCount(lead)}</td>
                    <td className="adm-nowrap">
                      {formatMoney(lead.price.low, lead.price.currency)} to{' '}
                      {formatMoney(lead.price.high, lead.price.currency)}{' '}
                      <span className="mv-muted">({formatMoney(lead.price.total, lead.price.currency)})</span>
                    </td>
                    <td>
                      <Badge tone={STATUS_TONE[lead.status]}>{lead.status}</Badge>
                    </td>
                    <td>{lead.contact?.name ?? 'none'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {selectedId ? (
          <LeadDetailPanel id={selectedId} onClose={() => setSelectedId(null)} onSaved={() => void load()} />
        ) : null}
      </div>
    </div>
  )
}

interface LeadDetailPanelProps {
  id: string
  onClose: () => void
  onSaved: () => void
}

function LeadDetailPanel({ id, onClose, onSaved }: LeadDetailPanelProps) {
  const [detail, setDetail] = useState<LeadDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<LeadStatus>('new')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const next = await getLead(id)
      setDetail(next)
      setStatus(next.lead.status)
      setNotes(next.lead.notes)
    } catch (caught) {
      setError(toMessage(caught))
    }
  }, [id])

  useEffect(() => {
    setDetail(null)
    void load()
  }, [load])

  const save = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      await updateLead(id, { status, notes })
      await load()
      onSaved()
    } catch (caught) {
      setSaveError(toMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  if (error) {
    return (
      <Panel tone="kraft" as="section" aria-live="polite">
        <div className="mv-stack">
          <p>Could not load lead: {error}</p>
          <div className="mv-actions">
            <Button type="button" size="sm" onClick={() => void load()}>
              Retry
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </Panel>
    )
  }

  if (!detail) {
    return (
      <Panel as="section" flat>
        <p className="mv-muted">Loading lead...</p>
      </Panel>
    )
  }

  const { lead, quoteRequests } = detail
  const details = lead.moveDetails
  const currency = lead.price.currency
  const breakdown = Object.entries(lead.price.breakdown)

  return (
    <Panel as="section" flat aria-label="Lead detail">
      <div className="mv-stack">
        <div className="mv-row">
          <h2 className="mv-title mv-title--md">Lead {lead.id.slice(0, 8)}</h2>
          <Badge tone={STATUS_TONE[lead.status]}>{lead.status}</Badge>
          <Badge tone="paper">{lead.source}</Badge>
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        <h3 className="adm-section">Move</h3>
        <dl className="adm-grid">
          <div>
            <dt>From</dt>
            <dd>{show(details.from)}</dd>
          </div>
          <div>
            <dt>To</dt>
            <dd>{show(details.to)}</dd>
          </div>
          <div>
            <dt>Date</dt>
            <dd>{show(details.date)}</dd>
          </div>
          <div>
            <dt>Distance</dt>
            <dd>{show(details.distanceMiles, ' mi')}</dd>
          </div>
          <div>
            <dt>Floors</dt>
            <dd>
              {show(details.originFloor)} to {show(details.destinationFloor)}
            </dd>
          </div>
          <div>
            <dt>Elevators</dt>
            <dd>
              origin {showBool(details.originElevator)}, destination {showBool(details.destinationElevator)}
            </dd>
          </div>
        </dl>

        <h3 className="adm-section">Contact</h3>
        {lead.contact ? (
          <dl className="adm-grid">
            <div>
              <dt>Name</dt>
              <dd>{lead.contact.name}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>
                <a href={`mailto:${lead.contact.email}`}>{lead.contact.email}</a>
              </dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{show(lead.contact.phone)}</dd>
            </div>
            <div>
              <dt>Requested date</dt>
              <dd>{lead.contact.requestedDate}</dd>
            </div>
          </dl>
        ) : (
          <p className="mv-muted">No contact yet</p>
        )}

        <h3 className="adm-section">Inventory</h3>
        {lead.items.length === 0 ? (
          <p className="mv-muted">No items detected.</p>
        ) : (
          <ul className="adm-list">
            {lead.items.map((item) => (
              <li key={item.type}>
                {titleCase(item.type)} × {item.count}
              </li>
            ))}
          </ul>
        )}

        {lead.analysis.specialHandling.length > 0 ? (
          <>
            <h3 className="adm-section">Special handling</h3>
            <ul className="adm-list">
              {lead.analysis.specialHandling.map((entry) => (
                <li key={entry.item}>
                  <strong>{titleCase(entry.item)}</strong>: {entry.reason}
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <h3 className="adm-section">Price</h3>
        <p>
          {formatMoney(lead.price.low, currency)} to {formatMoney(lead.price.high, currency)}{' '}
          <span className="mv-muted">(midpoint {formatMoney(lead.price.total, currency)})</span>
          {lead.price.confidence ? (
            <>
              {' '}
              <Badge tone="paper">confidence: {lead.price.confidence}</Badge>
            </>
          ) : null}
        </p>
        {breakdown.length > 0 ? (
          <div className="mv-table--wrap">
            <table className="mv-table">
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map(([line, amount]) => (
                  <tr key={line}>
                    <td>{line}</td>
                    <td>{formatMoney(amount, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {lead.price.explanation ? <p className="mv-muted">{lead.price.explanation}</p> : null}

        <h3 className="adm-section">Quote requests</h3>
        {quoteRequests.length === 0 ? (
          <p className="mv-muted">No quote requests for this lead.</p>
        ) : (
          <ul className="adm-list">
            {quoteRequests.map((request) => (
              <li key={request.id}>
                {request.moverName}{' '}
                <Badge tone={request.status === 'replied' ? 'green' : 'tape'}>{request.status}</Badge>{' '}
                <span className="mv-muted">{formatDateTime(request.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}

        <h3 className="adm-section">Update</h3>
        <form
          className="mv-stack"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <Field label="Status" htmlFor={`lead-status-${lead.id}`}>
            <Select
              id={`lead-status-${lead.id}`}
              value={status}
              onChange={(event) => {
                const value = event.target.value
                if (isLeadStatus(value)) setStatus(value)
              }}
            >
              {LEAD_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notes" htmlFor={`lead-notes-${lead.id}`}>
            <Textarea
              id={`lead-notes-${lead.id}`}
              rows={4}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
          {saveError ? <Panel tone="kraft">Could not save: {saveError}</Panel> : null}
          <div className="mv-actions">
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </div>
    </Panel>
  )
}
