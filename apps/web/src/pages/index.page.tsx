import { Button, Panel } from '@movers/ui'
import { useEffect } from 'react'
import { PageSeo } from '@/components/seo'
import { LANDING_URL } from '@/config'

/**
 * `/` belongs to the landing site. This page sends the browser there and leaves a link behind for
 * anyone whose browser blocked the redirect.
 */
export default function RedirectToLanding(): JSX.Element {
  useEffect(() => {
    window.location.replace(LANDING_URL)
  }, [])

  return (
    <div className="est-redirect">
      <PageSeo title="Movers by thriv.es" index={false} follow={true} />
      <Panel as="section" tilt="l" className="mv-stack" style={{ display: 'inline-flex', padding: '1.5rem' }}>
        <p className="mv-lede">Taking you to the Movers site...</p>
        <div className="mv-actions">
          <Button href={LANDING_URL}>Open the site</Button>
          <Button href="/estimate" variant="primary">
            Start an estimate
          </Button>
        </div>
      </Panel>
    </div>
  )
}
