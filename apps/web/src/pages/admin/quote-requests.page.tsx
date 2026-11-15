import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Badge, Button, Panel } from '@movers/ui'
import type { QuoteRequestRecord, QuoteRequestStatus } from '@/data'
import { formatDateTime, listQuoteRequests, toMessage, updateQuoteRequest } from '@/lib/admin-api'

export default function QuoteRequestsPage() {
  const [requests, setRequests] = useState<QuoteRequestRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setListError(null)
    try {
      setRequests(await listQuoteRequests())
    } catch (error) {
      setListError(toMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const setStatus = async (id: string, status: QuoteRequestStatus) => {
    setBusyId(id)
    setActionError(null)
    try {
      await updateQuoteRequest(id, status)
      await load()
    } catch (error) {
      setActionError(toMessage(error))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mv-stack">
      <div className="mv-row">
        <Button type="button" onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
        <p className="mv-muted">Emails to movers are logged on the server, not sent, in this version.</p>
      </div>

      {listError ? <Panel tone="kraft">Could not load quote requests: {listError}</Panel> : null}
      {actionError ? <Panel tone="kraft">Could not update quote request: {actionError}</Panel> : null}

      <div className="mv-table--wrap">
        <table className="mv-table">
          <thead>
            <tr>
              <th>Created</th>
              <th>Lead</th>
              <th>Mover</th>
              <th>Note</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {requests.length === 0 ? (
              <tr>
                <td colSpan={6} className="mv-muted">
                  {loading ? 'Loading quote requests...' : 'No quote requests yet.'}
                </td>
              </tr>
            ) : (
              requests.map((request) => {
                const next: QuoteRequestStatus = request.status === 'logged' ? 'replied' : 'logged'
                return (
                  <tr key={request.id}>
                    <td className="adm-nowrap">{formatDateTime(request.createdAt)}</td>
                    <td>
                      <Link to="/admin/leads" title={request.estimateId}>
                        {request.estimateId.slice(0, 8)}
                      </Link>
                    </td>
                    <td>{request.moverName}</td>
                    <td>{request.note || <span className="mv-muted">none</span>}</td>
                    <td>
                      <Badge tone={request.status === 'replied' ? 'green' : 'tape'}>{request.status}</Badge>
                    </td>
                    <td>
                      <Button
                        type="button"
                        size="sm"
                        disabled={busyId === request.id}
                        onClick={() => void setStatus(request.id, next)}
                      >
                        {next === 'replied' ? 'Mark replied' : 'Mark logged'}
                      </Button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
