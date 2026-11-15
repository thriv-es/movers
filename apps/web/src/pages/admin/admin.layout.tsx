import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router'
import { Badge, Panel, TapeLabel } from '@movers/ui'
import { PageSeo } from '@/components/seo'
import { adminStatus, toMessage } from '@/lib/admin-api'
import type { AdminStatus } from '@/lib/admin-api'
import './admin.css'

type State =
  | { kind: 'loading' }
  | { kind: 'off' }
  | { kind: 'error'; message: string }
  | { kind: 'on'; status: AdminStatus }

const TABS = [
  { to: '/admin/leads', label: 'Leads' },
  { to: '/admin/movers', label: 'Movers' },
  { to: '/admin/quote-requests', label: 'Quote requests' },
]

const seo = <PageSeo title="Admin | Movers by thriv.es" index={false} follow={false} />

export default function AdminLayout() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    adminStatus()
      .then((status) => {
        if (cancelled) return
        setState(status ? { kind: 'on', status } : { kind: 'off' })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: toMessage(error) })
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (state.kind === 'loading') {
    return (
      <>
        {seo}
        <p className="mv-muted">Loading admin...</p>
      </>
    )
  }

  if (state.kind === 'off') {
    return (
      <div className="adm-header">
        {seo}
        <h1 className="mv-title mv-title--lg">Movers admin</h1>
        <Panel>Admin is switched off in this environment.</Panel>
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <div className="adm-header">
        {seo}
        <h1 className="mv-title mv-title--lg">Movers admin</h1>
        <Panel tone="kraft">Could not reach the admin API: {state.message}</Panel>
      </div>
    )
  }

  return (
    <div>
      {seo}
      <header className="adm-header">
        <div className="mv-row">
          <h1 className="mv-title mv-title--lg">Movers admin</h1>
          <TapeLabel>Local admin, no sign-in</TapeLabel>
          <Badge tone="paper">Storage: {state.status.storage}</Badge>
        </div>
        <nav aria-label="Admin sections">
          <ul className="adm-tabs">
            {TABS.map((tab) => (
              <li key={tab.to}>
                <NavLink to={tab.to} className={({ isActive }) => (isActive ? 'is-active' : undefined)}>
                  {tab.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <Outlet />
    </div>
  )
}
