import { TapeLabel } from '@movers/ui'
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
  const controller = useConversationController(() => {
    const saved = loadConversationSession()
    // A demo link must never replace an existing conversation or its accumulated answers.
    const empty = !saved.messages.length && !saved.photos.length && !saved.moveDetails.from && !saved.moveDetails.to
    return wantsSample && empty ? sampleConversation() : saved
  })
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
            <span className="est-small">USD demo pricing</span>
            <DemoBadge />
            {controller.session.sample ? <TapeLabel>Sample move</TapeLabel> : null}
          </div>
        </div>
      </header>
      <ConversationShell controller={controller} />
    </div>
  )
}
