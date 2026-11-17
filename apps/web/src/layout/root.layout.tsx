import { MoversMark } from '@movers/ui'
import { Link, Outlet, ScrollRestoration, useLocation } from 'react-router'
import { IS_DEVELOPMENT, LANDING_URL } from '@/config'

/**
 * The comic shell shared by the estimator and the admin: kraft page, inked masthead, slim footer.
 */
export function RootLayout(): JSX.Element {
  const { pathname } = useLocation()
  const inAdmin = pathname.startsWith('/admin')

  return (
    <div className="mv-page est-shell">
      <header className="est-masthead">
        <a className="est-masthead__brand" href={LANDING_URL} aria-label="Movers home">
          <MoversMark size={28} />
        </a>
        <nav className="est-masthead__nav" aria-label="Site">
          <Link to="/estimate" className={inAdmin ? '' : 'is-active'}>
            Estimate
          </Link>
          {IS_DEVELOPMENT ? (
            <Link to="/admin/leads" className={inAdmin ? 'is-active' : ''}>
              Admin
            </Link>
          ) : null}
          <a href={LANDING_URL}>About</a>
        </nav>
      </header>
      <div className="est-shell__body">
        <Outlet />
      </div>
      <footer className="est-foot">
        <MoversMark size={18} compact />
        <span className="mv-muted">Estimates to plan with. Your mover confirms the final price.</span>
      </footer>
      <ScrollRestoration />
    </div>
  )
}

export default RootLayout
