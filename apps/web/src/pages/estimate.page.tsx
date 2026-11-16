import { Button, Stepper, TapeLabel } from '@movers/ui'
import { useCallback, useEffect, useMemo } from 'react'
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

  const activeIndex = ESTIMATE_STEPS.indexOf(session.step)
  const review = useMemo(
    () => ({ followUps: session.followUps, wholeMoveCovered: session.wholeMoveCovered }),
    [session.followUps, session.wholeMoveCovered],
  )

  const goTo = useCallback((step: StepKey) => update({ step }), [update])

  // a saved session can point at review or estimate without an analysis (for example after "Use my own photos")
  useEffect(() => {
    if ((session.step === 'review' || session.step === 'estimate') && !session.analysis) update({ step: 'upload' })
  }, [session.step, session.analysis, update])

  const onTurn = useCallback(
    (messages: ChatMessage[], moveDetails: MoveDetails, chatFinished: boolean) =>
      update({ messages, moveDetails, chatFinished }),
    [update],
  )

  const onDetails = useCallback(
    (moveDetails: MoveDetails) => {
      const changed = JSON.stringify(moveDetails) !== JSON.stringify(session.moveDetails)
      update({ moveDetails, step: 'upload', ...(changed ? { price: null, estimateId: null, contact: null } : {}) })
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
        analysis: null,
        items: [],
        followUps: { ...EMPTY_FOLLOW_UPS },
        wholeMoveCovered: null,
        price: null,
        estimateId: null,
        contact: null,
      }),
    [update],
  )

  const onAnalyzed = useCallback(
    (analysis: AnalysisResult) =>
      update({
        analysis,
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

  const onItemsChange = useCallback(
    (items: DetectedItem[]) => update({ items, price: null, estimateId: null, contact: null }),
    [update],
  )

  const onFollowUp = useCallback(
    (key: FollowUpKey, answer: boolean) =>
      update((current) => {
        const extra = FOLLOW_UP_ITEMS[key]
        const without = current.items.filter((item) => !sameType(item.type, extra.type))
        return {
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
        analysis: null,
        items: [],
        followUps: { ...EMPTY_FOLLOW_UPS },
        wholeMoveCovered: null,
        price: null,
        estimateId: null,
        contact: null,
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
            confirmChange={confirmPhotoChange}
            onPhotosChange={onPhotosChange}
            onAnalyzed={onAnalyzed}
            onUseOwnPhotos={useOwnPhotos}
            onUseSample={startSample}
            onBack={() => goTo('details')}
          />
        )
      case 'review':
        if (!session.analysis) return null
        return (
          <ReviewStep
            analysis={session.analysis}
            items={session.items}
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
        return (
          <EstimateStep
            analysis={session.analysis}
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
      <main className="est-body">{body}</main>
    </div>
  )
}
