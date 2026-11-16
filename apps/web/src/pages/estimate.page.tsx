import { Button, Stepper, TapeLabel } from '@movers/ui'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ChatStep } from '@/components/estimate/ChatStep'
import { DemoBadge } from '@/components/estimate/DemoBadge'
import { EstimateStep } from '@/components/estimate/EstimateStep'
import { MoveDetailsStep } from '@/components/estimate/MoveDetailsStep'
import { FOLLOW_UP_ITEMS, ReviewStep } from '@/components/estimate/ReviewStep'
import { ScheduleStep } from '@/components/estimate/ScheduleStep'
import { UploadStep } from '@/components/estimate/UploadStep'
import { PageSeo } from '@/components/seo'
import { CONFIG } from '@/config'
import type { AnalysisResult, ChatMessage, Contact, DetectedItem, MoveDetails, Price } from '@/data'
import {
  EMPTY_FOLLOW_UPS,
  ESTIMATE_STEPS,
  type EstimateStep as StepKey,
  type FollowUpKey,
  type PhotoRef,
  loadSession,
  newSession,
  sampleSession,
} from '@/lib/estimate-session'
import { canonicalItemType } from '@/lib/item-aliases'
import { useEstimateSession } from '@/lib/useEstimateSession'
import { checkVision, EstimateApiError } from '@/lib/api-client'
import { clearedAnalysis, photoEvidence, reviewedAnalysis } from '@/lib/review-photos'

const STEP_LABELS: Record<StepKey, string> = {
  chat: 'Chat',
  details: 'Details',
  upload: 'Photos',
  review: 'Review',
  estimate: 'Estimate',
  schedule: 'Schedule',
}

const STEPS = ESTIMATE_STEPS.map((key) => ({ key, label: STEP_LABELS[key] }))

const sameType = (a: string, b: string) => canonicalItemType(a) === canonicalItemType(b)

/** The estimator: six steps, one session, refresh-safe. */
export default function EstimatePage(): JSX.Element {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const wantsSample = params.get('sample') === '1'
  const { session, update, reset } = useEstimateSession(() =>
    wantsSample ? sampleSession(window.location.origin) : loadSession(),
  )

  // `/estimate?sample=1` is a deep link; once the sample session exists the URL can be clean again
  useEffect(() => {
    if (wantsSample) navigate('/estimate', { replace: true })
  }, [wantsSample, navigate])

  const [verified, setVerified] = useState<{ analysis: AnalysisResult; step: StepKey } | null>(null)
  const [freshnessError, setFreshnessError] = useState<string | null>(null)
  const activeIndex = ESTIMATE_STEPS.indexOf(session.step)
  const evidence = useMemo(
    () => photoEvidence(session.analysis, session.photoDecisions),
    [session.analysis, session.photoDecisions],
  )
  const inventoryAnalysis = useMemo(
    () =>
      session.analysis && evidence.unresolvedCount === 0
        ? reviewedAnalysis(session.analysis, session.photoDecisions)
        : session.analysis,
    [session.analysis, session.photoDecisions, evidence.unresolvedCount],
  )
  const review = useMemo(
    () => ({ followUps: session.followUps, wholeMoveCovered: session.wholeMoveCovered, photoEvidence: evidence }),
    [session.followUps, session.wholeMoveCovered, evidence],
  )
  const onReanalyze = useCallback(() => {
    update({ ...clearedAnalysis(), step: 'upload' })
    setFreshnessError('Photo analysis settings changed. Analyze your photos again.')
  }, [update])

  useEffect(() => {
    // Verification belongs only to this check; leaving/re-entering a step must not reuse it.
    setVerified(null)
    if (!session.analysis || !['review', 'estimate'].includes(session.step)) return
    let cancelled = false
    const analysis = session.analysis
    const step = session.step
    setFreshnessError(null)
    checkVision(analysis)
      .then(() => {
        if (!cancelled) setVerified({ analysis, step })
      })
      .catch((error) => {
        if (cancelled) return
        if (error instanceof EstimateApiError && error.code === 'REANALYZE_REQUIRED') onReanalyze()
        else setFreshnessError('Unable to check photo analysis settings. Return to Photos and try again.')
      })
    return () => {
      cancelled = true
    }
  }, [session.analysis, session.step, onReanalyze])
  const visionVerified = verified?.analysis === session.analysis && verified?.step === session.step

  const goTo = useCallback(
    (step: StepKey) => {
      if ((step === 'estimate' || step === 'schedule') && (evidence.unresolvedCount > 0 || session.items.length === 0))
        return
      setVerified(null)
      update((current) => ({
        step,
        ...(step === 'upload'
          ? {
              ...clearedAnalysis(),
              analysis: current.analysis,
              failedPhotoAssessments: current.failedPhotoAssessments,
              items: current.analysis?.items ?? [],
            }
          : {}),
      }))
    },
    [update, evidence.unresolvedCount, session.items.length],
  )

  // a saved session can point at review or estimate without an analysis (for example after "Use my own photos")
  useEffect(() => {
    if ((session.step === 'review' || session.step === 'estimate') && !session.analysis) update({ step: 'upload' })
  }, [session.step, session.analysis, update])

  const onTurn = useCallback(
    (messages: ChatMessage[], moveDetails: MoveDetails, chatFinished: boolean) =>
      update((current) => ({
        messages,
        moveDetails,
        chatFinished,
        ...(JSON.stringify(moveDetails) !== JSON.stringify(current.moveDetails) ? clearedAnalysis() : {}),
      })),
    [update],
  )

  const onDetails = useCallback(
    (moveDetails: MoveDetails) => {
      const changed = JSON.stringify(moveDetails) !== JSON.stringify(session.moveDetails)
      update((current) => ({
        moveDetails,
        step: 'upload',
        ...clearedAnalysis(),
        ...(!changed
          ? {
              analysis: current.analysis,
              items: current.analysis?.items ?? [],
              failedPhotoAssessments: current.failedPhotoAssessments,
            }
          : {}),
      }))
    },
    [session.moveDetails, update],
  )

  const confirmPhotoChange = useCallback(() => {
    if (!session.analysis) return true
    return window.confirm('Changing the photos discards the current inventory and price. Continue?')
  }, [session.analysis])

  const onPhotosChange = useCallback(
    (photoRefs: PhotoRef[], legacyUrls: string[]) =>
      update({
        photoRefs,
        photoUrls: [...legacyUrls, ...photoRefs.map((ref) => ref.url)],
        needsPhotoReupload: legacyUrls.length > 0,
        ...clearedAnalysis(),
      }),
    [update],
  )

  const onAnalyzed = useCallback(
    (analysis: AnalysisResult) =>
      update({
        analysis,
        failedPhotoAssessments: [],
        photoDecisions: {},
        photoDecisionsLocked: false,
        items: analysis.items,
        step: 'review',
        followUps: { ...EMPTY_FOLLOW_UPS },
        wholeMoveCovered: null,
        price: null,
        estimateId: null,
        contact: null,
      }),
    [update],
  )

  const onPhotoDecision = useCallback(
    (url: string, decision: 'keep' | 'exclude') =>
      update((current) => {
        if (
          !current.analysis ||
          current.photoDecisionsLocked ||
          !current.analysis.photoAssessments?.some((photo) => photo.url === url && photo.status === 'uncertain')
        )
          return {}
        const photoDecisions = { ...current.photoDecisions, [url]: decision }
        return {
          photoDecisions,
          items:
            photoEvidence(current.analysis, photoDecisions).unresolvedCount === 0
              ? reviewedAnalysis(current.analysis, photoDecisions).items
              : current.analysis.items,
          followUps: { ...EMPTY_FOLLOW_UPS },
          wholeMoveCovered: null,
          price: null,
          estimateId: null,
          contact: null,
        }
      }),
    [update],
  )

  const onItemsChange = useCallback(
    (items: DetectedItem[]) =>
      update({ items, photoDecisionsLocked: true, price: null, estimateId: null, contact: null }),
    [update],
  )

  const onFollowUp = useCallback(
    (key: FollowUpKey, answer: boolean) =>
      update((current) => {
        const extra = FOLLOW_UP_ITEMS[key]
        const without = current.items.filter((item) => !sameType(item.type, extra.type))
        return {
          photoDecisionsLocked: true,
          followUps: { ...current.followUps, [key]: answer },
          items: answer ? [...without, extra] : without,
          price: null,
          estimateId: null,
          contact: null,
        }
      }),
    [update],
  )

  const onWholeMoveCovered = useCallback(
    (wholeMoveCovered: boolean) => update({ wholeMoveCovered, price: null, estimateId: null, contact: null }),
    [update],
  )

  const onPriced = useCallback((price: Price, estimateId: string) => update({ price, estimateId }), [update])

  const onScheduled = useCallback((contact: Contact) => update({ contact }), [update])

  const startOver = useCallback(() => reset(newSession()), [reset])
  const startSample = useCallback(() => reset(sampleSession(window.location.origin)), [reset])
  const useOwnPhotos = useCallback(
    () =>
      update({
        sample: false,
        photoUrls: [],
        photoRefs: [],
        needsPhotoReupload: false,
        ...clearedAnalysis(),
      }),
    [update],
  )

  const body = useMemo(() => {
    switch (session.step) {
      case 'chat':
        return (
          <ChatStep
            messages={session.messages}
            moveDetails={session.moveDetails}
            finished={session.chatFinished}
            onTurn={onTurn}
            onContinue={() => goTo('details')}
            onUseForm={() => goTo('details')}
            onTrySample={startSample}
          />
        )
      case 'details':
        return <MoveDetailsStep moveDetails={session.moveDetails} onBack={() => goTo('chat')} onContinue={onDetails} />
      case 'upload':
        return (
          <UploadStep
            key={session.sample ? 'sample' : 'own'}
            photoUrls={session.photoUrls}
            photoRefs={session.photoRefs}
            sessionId={session.sessionId}
            moveDetails={session.moveDetails}
            needsPhotoReupload={session.needsPhotoReupload}
            sample={session.sample}
            hasAnalysis={session.analysis !== null}
            photoAssessments={
              session.failedPhotoAssessments.length > 0
                ? session.failedPhotoAssessments
                : session.analysis?.photoAssessments
            }
            confirmChange={confirmPhotoChange}
            onPhotosChange={onPhotosChange}
            onAnalyzed={onAnalyzed}
            onAnalyzeStart={() =>
              update((current) => ({ ...clearedAnalysis(), failedPhotoAssessments: current.failedPhotoAssessments }))
            }
            onAnalyzeFailure={(assessments) =>
              update({
                failedPhotoAssessments: assessments.map(({ url, status, reason }) => ({ url, status, reason })),
              })
            }
            onUseOwnPhotos={useOwnPhotos}
            onUseSample={startSample}
            onBack={() => goTo('details')}
          />
        )
      case 'review':
        if (!session.analysis) return null
        return (
          <ReviewStep
            analysis={inventoryAnalysis ?? session.analysis}
            items={session.items}
            photoDecisions={session.photoDecisions}
            photoDecisionsLocked={session.photoDecisionsLocked}
            onPhotoDecision={onPhotoDecision}
            followUps={session.followUps}
            wholeMoveCovered={session.wholeMoveCovered}
            onWholeMoveCovered={onWholeMoveCovered}
            onItemsChange={onItemsChange}
            onFollowUp={onFollowUp}
            onBack={() => goTo('upload')}
            onConfirm={() => goTo('estimate')}
          />
        )
      case 'estimate':
        if (!session.analysis) return null
        if (evidence.unresolvedCount > 0)
          return <p>Return to Review and decide every uncertain photo before pricing.</p>
        if (session.items.length === 0)
          return (
            <div className="mv-stack">
              <p>No accepted inventory remains. Add an item or return to Photos before pricing.</p>
              <Button onClick={() => goTo('review')}>Back to Review</Button>
            </div>
          )
        if (!visionVerified) return <p role="status">{freshnessError ?? 'Checking photo analysis settings...'}</p>
        return (
          <EstimateStep
            analysis={inventoryAnalysis ?? session.analysis}
            onReanalyze={onReanalyze}
            items={session.items}
            moveDetails={session.moveDetails}
            review={review}
            price={session.price}
            estimateId={session.estimateId}
            photoUrls={session.photoUrls}
            sample={session.sample}
            onPriced={onPriced}
            onBack={() => goTo('review')}
            onSchedule={() => goTo('schedule')}
          />
        )
      case 'schedule':
        return (
          <ScheduleStep
            estimateId={session.estimateId}
            moveDetails={session.moveDetails}
            contact={session.contact}
            onScheduled={onScheduled}
            onBack={() => goTo('estimate')}
            onStartOver={startOver}
          />
        )
      default:
        return null
    }
  }, [
    session,
    update,
    inventoryAnalysis,
    evidence.unresolvedCount,
    visionVerified,
    freshnessError,
    onReanalyze,
    onPhotoDecision,
    goTo,
    onTurn,
    onDetails,
    confirmPhotoChange,
    onPhotosChange,
    onAnalyzed,
    onItemsChange,
    onFollowUp,
    onWholeMoveCovered,
    review,
    onPriced,
    onScheduled,
    startOver,
    startSample,
    useOwnPhotos,
  ])

  return (
    <div className="est-page">
      <PageSeo
        title="Get your moving estimate | Movers by thriv.es"
        description="Chat about your move, photograph your rooms and get a priced range with an itemized breakdown in minutes."
        canonical={`${CONFIG.canonical}/estimate`}
      />
      <header className="est-head">
        <div className="est-head__row">
          <h1 className="mv-title mv-title--lg">Your estimate</h1>
          <div className="mv-row">
            <DemoBadge />
            {session.sample ? <TapeLabel>Sample move</TapeLabel> : null}
            <Button size="sm" variant="ghost" onClick={startOver}>
              Start over
            </Button>
          </div>
        </div>
        <Stepper steps={STEPS} activeIndex={activeIndex} onSelect={(index) => goTo(ESTIMATE_STEPS[index] ?? 'chat')} />
      </header>
      <main className="est-body">
        {freshnessError ? <p role="alert">{freshnessError}</p> : null}
        {body}
      </main>
    </div>
  )
}
