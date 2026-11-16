import { Button, TapeLabel } from '@movers/ui'
import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ConversationShell } from '../components/conversation/ConversationShell'
import { DemoBadge } from '../components/estimate/DemoBadge'
import { PageSeo } from '../components/seo'
import { CONFIG } from '../config'
import { loadConversationSession } from '../lib/conversation-session'
import { sampleConversation, useConversationController } from '../lib/useConversationController'

/** One always-mounted conversation; readiness is not navigation or permission to submit. */
export default function EstimatePage(): JSX.Element {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const wantsSample = params.get('sample') === '1'
  const controller = useConversationController(() => (wantsSample ? sampleConversation() : loadConversationSession()))
  useEffect(() => {
    if (wantsSample) navigate('/estimate', { replace: true })
  }, [wantsSample, navigate])
  return (
    <div className="est-page conv-page">
      <PageSeo
        title="Get your moving estimate | Movers by thriv.es"
        description="One conversation and a live shared move manifest, from room photos to a moving estimate and date request."
        canonical={`${CONFIG.canonical}/estimate`}
      />
      <header className="est-head conv-head">
        <div className="est-head__row">
          <h1 className="mv-title">Your move, together</h1>
          <div className="mv-row">
            <span className="est-small">Conversation v6</span>
            <DemoBadge />
            {controller.session.sample ? <TapeLabel>Sample move</TapeLabel> : null}
            <Button size="sm" variant="ghost" onClick={() => controller.reset('new')}>
              Start over
            </Button>
          </div>
        </div>
      </header>
      <ConversationShell controller={controller} />
    </div>
  )
}
