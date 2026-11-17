import { useCallback, useEffect, useRef, useState } from 'react'
import { zContact } from '../data/z-common/z-move-demo'
import type { Contact, PublicMover } from '../data'
import type {
  ConversationAction,
  ConversationOperationRequest,
  ConversationOperationResult,
  ConversationSession,
} from './conversation-state'
import {
  conversationAnalysis,
  conversationReadiness,
  conversationSnapshot,
  reduceConversation,
  createConversationSession,
} from './conversation-state'
import { loadConversationSession, saveConversationSession } from './conversation-session'
import { type newSession, sampleSession } from './estimate-session'
import {
  analyzeApi,
  attachContact,
  conversationChatApi,
  checkVision,
  createEstimate,
  EstimateApiError,
  listMovers,
  priceApi,
  requestQuotes,
  uploadImage,
} from './api-client'
import { downscaleImage, HEIC_MESSAGE, isAcceptedType, isHeic } from './image-downscale'
import { photoEvidence } from './review-photos'
import { conversationCompleteness } from './conversation-completeness'
import { groundedConversationProposal } from './conversation-authority'
import { CONVERSATION_MESSAGE_LIMIT, ConversationContextError, conversationContext } from './conversation-context'

type WithoutEnvelope<T> = T extends unknown ? Omit<T, 'id' | 'source' | 'expectedRevision'> : never
export type ConversationInput = WithoutEnvelope<ConversationAction>
export interface ConversationUpload {
  id: string
  src: string
  file: File
  status: 'preparing' | 'uploading' | 'error'
  progress: number
}
const id = () => crypto.randomUUID()
const isWrite = (kind: ConversationOperationRequest['kind']) =>
  kind === 'save' || kind === 'schedule' || kind === 'quotes'
const unknownWriteMessage =
  'Request interrupted — unknown outcome. Check the existing request before submitting again; reload to restore the conversation status.'
export function sampleConversation(): ConversationSession {
  return migrate(sampleSession(window.location.origin))
}
function migrate(legacy: ReturnType<typeof newSession>) {
  return loadConversationSession({ getItem: () => JSON.stringify(legacy), setItem() {}, removeItem() {} })
}

/** All domain changes go through the revisioned reducer. Effects only persist/clean up, never submit. */
export function useConversationController(initial: () => ConversationSession = loadConversationSession) {
  const [session, setSession] = useState(initial)
  const current = useRef(session)
  const [view, setView] = useState<'chat' | 'summary' | 'booking'>('chat')
  const displayedScope = useRef<{ sessionId: string; revision: number } | null>(null)
  const summaryGeneration = useRef(0)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const active = useRef(true)
  const leaving = useRef(false)
  const pageGeneration = useRef(0)
  const chatRequest = useRef<AbortController | null>(null)
  // Authorization belongs to the explicit Send, not to a later retry's snapshot or transcript role.
  const submittedTurn = useRef<{ sessionId: string; messageId: string; revision: number } | null>(null)
  const [chatBusy, setChatBusy] = useState(false)
  const [chatFailed, setChatFailed] = useState(false)
  const [suggestionsExpired, setSuggestionsExpired] = useState(false)
  const [uploads, setUploads] = useState<ConversationUpload[]>([])
  const uploadRef = useRef(uploads)
  const uploadCohort = useRef<{ sessionId: string; revision: number } | null>(null)
  const [movers, setMovers] = useState<PublicMover[]>([])
  const [moversBusy, setMoversBusy] = useState(false)
  const moversLoading = useRef(false)

  useEffect(() => {
    active.current = true
    leaving.current = false
    saveConversationSession(current.current)
    // Page departure cancels continuation authorization, not mounted read-only result handling.
    const hide = () => {
      leaving.current = true
      pageGeneration.current += 1
      chatRequest.current?.abort()
    }
    const show = () => {
      leaving.current = false
      const pending = Object.values(current.current.operations).filter((op) => op.status === 'pending')
      setBusy(locked.current || pending.length > 0)
      if (pending.some((op) => isWrite(op.request.kind))) setError(unknownWriteMessage)
      setChatBusy(chatRequest.current !== null)
    }
    window.addEventListener('pagehide', hide)
    window.addEventListener('pageshow', show)
    return () => {
      active.current = false
      hide()
      window.removeEventListener('pagehide', hide)
      window.removeEventListener('pageshow', show)
      for (const card of uploadRef.current) URL.revokeObjectURL(card.src)
    }
  }, [])

  const dispatch = useCallback((action: ConversationAction): ConversationSession | null => {
    if (!active.current) return null
    const previous = current.current
    const next = reduceConversation(previous, action)
    if (next === previous) {
      setError('That update is stale or not ready. Check the current move manifest and try again.')
      return null
    }
    if (
      next.revision !== previous.revision &&
      action.type !== 'proposal.applyBatch' &&
      previous.pendingProposals.some(
        (proposal) =>
          (action.type !== 'proposal.apply' || proposal.id !== action.proposalId) &&
          !next.pendingProposals.some((entry) => entry.id === proposal.id),
      )
    )
      setSuggestionsExpired(true)
    // Ref and storage update synchronously: repeat clicks and same-tick actions see the accepted revision.
    current.current = next
    if (next.revision !== previous.revision && !next.price) displayedScope.current = null
    setSession(next)
    saveConversationSession(next)
    return next
  }, [])
  const apply = (
    input: ConversationInput,
    source: ConversationAction['source'] = 'inline',
    revision = current.current.revision,
  ) => dispatch({ ...input, id: id(), source, expectedRevision: revision } as ConversationAction)

  const withLock = async (work: () => Promise<void>) => {
    if (
      !active.current ||
      leaving.current ||
      locked.current ||
      Object.values(current.current.operations).some((op) => op.status === 'pending')
    )
      return
    locked.current = true
    setBusy(true)
    setError(null)
    try {
      await work()
    } finally {
      locked.current = false
      if (active.current) setBusy(Object.values(current.current.operations).some((op) => op.status === 'pending'))
    }
  }
  const unknown = (kind: ConversationOperationRequest['kind']) =>
    Object.values(current.current.operations).some(
      (op) => op.request.kind === kind && op.status === 'interrupted' && op.revision === current.current.revision,
    )
  const execute = async (
    request: ConversationOperationRequest,
    call: (snapshot: ConversationSession) => Promise<ConversationOperationResult>,
  ): Promise<ConversationSession | null> => {
    if (!active.current || leaving.current) return null
    const generation = pageGeneration.current
    const write = isWrite(request.kind)
    // Selection is transient and does not bump domain revision. Recheck at every operation boundary,
    // including after vision preflight and between accepted pricing and its dependent save.
    if (uploadRef.current.length) {
      setError('Finish or remove pending uploads before requesting analysis, pricing or saved-estimate changes.')
      return null
    }
    const operationId = id()
    const started = apply({ type: 'operation.started', operationId, request }, 'system')
    const operation = started?.operations[operationId]
    if (!started || !operation) return null
    // Analyze start clears old evidence and increments revision. Never use the pre-start revision here.
    const revision = operation.revision
    try {
      const result = await call(started)
      if (
        !active.current ||
        current.current.sessionId !== started.sessionId ||
        (write && generation !== pageGeneration.current)
      )
        return null
      const accepted = apply({ type: 'operation.succeeded', operationId, result }, 'system', revision)
      // Persist a real read-only result, but never resume its old dependent-write chain after departure.
      if (accepted) return generation === pageGeneration.current ? accepted : null
      if (current.current.operations[operationId]?.status !== 'pending') return null
      throw new Error('Invalid operation response')
    } catch (caught) {
      if (
        !active.current ||
        current.current.sessionId !== started.sessionId ||
        (write && generation !== pageGeneration.current)
      )
        return null
      if (write && !(caught instanceof EstimateApiError)) {
        // A lost transport/body (including abort before pagehide) cannot prove the write failed.
        // Keep the real pending operation, block reposts, and let reload classify it as interrupted.
        if (current.current.operations[operationId]?.status === 'pending' && current.current.revision === revision)
          setError(unknownWriteMessage)
        return null
      }
      const code = caught instanceof EstimateApiError ? caught.code : undefined
      const errorCode =
        code === 'REANALYZE_REQUIRED'
          ? 'reanalyze_required'
          : code === 'PHOTO_LINK_FAILED' || code === 'PHOTO_REUPLOAD_REQUIRED'
            ? 'photo_link_failed'
            : 'request_failed'
      const photoAssessments =
        request.kind === 'analyze' && caught instanceof EstimateApiError
          ? caught.photoAssessments
              .filter((photo) => started.photos.some((ref) => ref.url === photo.url))
              .map(({ url, status, reason }) => ({ url, status, reason }))
          : []
      const failed = apply(
        { type: 'operation.failed', operationId, errorCode, ...(photoAssessments.length ? { photoAssessments } : {}) },
        'system',
        revision,
      )
      if (failed)
        setError(
          errorCode === 'reanalyze_required'
            ? 'Photo analysis settings changed. Analyze your photos again.'
            : `${request.kind === 'save' ? 'Save' : request.kind === 'schedule' ? 'Date request' : request.kind === 'quotes' ? 'Quote request' : request.kind === 'price' ? 'Price' : 'Analysis'} failed. Your conversation is safe; retry explicitly.`,
        )
      return null
    }
  }
  const verify = async (snapshot: ConversationSession): Promise<ConversationSession | null> => {
    if (!active.current || leaving.current || !snapshot.analysis) return null
    const generation = pageGeneration.current
    try {
      await checkVision(snapshot.analysis)
      if (!active.current || generation !== pageGeneration.current || current.current.sessionId !== snapshot.sessionId)
        return null
      return apply(
        { type: 'vision.verified', fingerprint: snapshot.analysis.visionFingerprint ?? '' },
        'system',
        snapshot.revision,
      )
    } catch (caught) {
      if (active.current && current.current.sessionId === snapshot.sessionId)
        setError(
          caught instanceof EstimateApiError && caught.code === 'REANALYZE_REQUIRED'
            ? 'Photo analysis settings changed. Analyze your photos again.'
            : 'Unable to check photo analysis settings. Retry the explicit action when connected.',
        )
      return null
    }
  }
  const analyzePhotos = () =>
    withLock(async () => {
      if (uploadRef.current.length) {
        setError('Finish or remove pending uploads before analysis.')
        return
      }
      const accepted = await execute({ kind: 'analyze' }, async (snapshot) => ({
        kind: 'analyze',
        analysis: await analyzeApi(snapshot.sessionId, snapshot.photoRefs, snapshot.moveDetails, snapshot.sample),
      }))
      if (accepted) {
        // Feed real, accepted structured inventory to Chat; no old Send authority is inherited.
        submittedTurn.current = null
        // The accepted analysis supersedes any Chat snapshot from before these photos. Abort
        // without waiting for a transport that may ignore abort, then start one fresh unauthorized turn.
        chatRequest.current?.abort()
        chatRequest.current = null
        await turn()
        await maybeOpenSummary(true)
      }
    })
  const showSummary = async () => {
    const generation = ++summaryGeneration.current
    setView('summary')
    displayedScope.current = null
    apply({ type: 'summary.attempt' }, 'system')
    if (uploadRef.current.length) {
      setError('Finish or remove pending uploads before pricing.')
      return
    }
    // Early summary is useful even when essentials are missing; do not ask the customer for distance.
    if (!conversationCompleteness(current.current).ready) return
    let snapshot = await verify(current.current)
    if (!snapshot || generation !== summaryGeneration.current || !conversationReadiness(snapshot).canPrice) return
    if (!snapshot.price) {
      snapshot = await execute(
        { kind: 'price', visionFingerprint: snapshot.analysis?.visionFingerprint ?? '' },
        async (state) => {
          const analysis = conversationAnalysis(state)
          if (!analysis) throw new Error('Analysis required')
          const result = await priceApi(
            analysis,
            state.moveDetails,
            {
              followUps: state.followUps,
              wholeMoveCovered: state.wholeMoveCovered,
              photoEvidence: photoEvidence(state.analysis, state.photoDecisions),
            },
            state.sample,
          )
          return { kind: 'price', price: result.price }
        },
      )
    }
    if (snapshot?.price) {
      apply({ type: 'summary.attempt' }, 'system', snapshot.revision)
      if (generation === summaryGeneration.current)
        displayedScope.current = { sessionId: snapshot.sessionId, revision: snapshot.revision }
    }
  }
  const openSummary = async () => {
    setView('summary')
    await withLock(showSummary)
  }
  const maybeOpenSummary = async (insideLock = false) => {
    const state = current.current
    const completeness = conversationCompleteness(state)
    if (state.summaryAttemptRevision === state.revision || completeness.percent < 90 || !completeness.ready) return
    if (insideLock) await showSummary()
    else await openSummary()
  }
  const confirmPrice = openSummary // compatibility: pricing is now strictly read-only
  const updateSession = () => {
    summaryGeneration.current++
    setView('chat')
    displayedScope.current = null
  }
  const bookMove = () => {
    setView('booking')
  } // view intent only, never a write
  const bookContact = (contact: Contact) =>
    withLock(async () => {
      const parsed = zContact.safeParse(contact)
      if (!parsed.success || !parsed.data.phone.trim()) {
        setError('Enter a name, valid email, phone and requested date.')
        return
      }
      const scope = displayedScope.current
      const matches = () =>
        !!scope &&
        displayedScope.current === scope &&
        current.current.sessionId === scope.sessionId &&
        current.current.revision === scope.revision
      if (
        !scope ||
        view !== 'booking' ||
        !matches() ||
        !current.current.price ||
        !conversationCompleteness(current.current).ready
      ) {
        setError(
          'The displayed move changed. Open the summary and review the current scope before requesting a callback.',
        )
        return
      }
      if (unknown('save') || unknown('schedule')) {
        setError(unknownWriteMessage)
        return
      }
      if (current.current.scheduleResult) return
      let snapshot = await verify(current.current)
      if (!snapshot || !matches()) return
      // This explicit callback submission is the customer's confirmation of the displayed scope.
      if (!snapshot.detailsConfirmed) {
        snapshot = apply({ type: 'details.confirm' }, 'inline', snapshot.revision)
        if (!snapshot) return
        scope.revision = snapshot.revision
      }
      if (!snapshot.estimateId) {
        snapshot = await verify(snapshot)
        if (!snapshot || !matches() || !conversationReadiness(snapshot).canSave) return
        snapshot = await execute({ kind: 'save' }, async (state) => {
          const analysis = conversationAnalysis(state)
          if (!analysis || !state.price) throw new Error('Priced inventory required')
          const created = await createEstimate({
            source: state.sample ? 'sample' : 'own',
            moveDetails: state.moveDetails,
            analysis,
            items: state.items,
            price: state.price,
            photoKeys: state.photoUrls,
          })
          return { kind: 'save', estimateId: created.id }
        })
        if (!snapshot) return
        scope.revision = snapshot.revision
      }
      snapshot = await verify(snapshot)
      if (!snapshot || !matches() || !conversationReadiness(snapshot).canSchedule) return
      const accepted = await execute({ kind: 'schedule', contact: parsed.data }, async (state) => {
        if (!state.estimateId) throw new Error('Saved estimate required')
        const result = await attachContact(state.estimateId, parsed.data)
        return { kind: 'schedule', reference: result.reference, requestedDate: result.requestedDate }
      })
      if (accepted) scope.revision = accepted.revision
    })
  const submitContact = (contact: Contact) =>
    withLock(async () => {
      const parsed = zContact.safeParse(contact)
      if (!parsed.success || !parsed.data.phone.trim()) {
        setError('Enter a name, valid email, phone and requested date.')
        return
      }
      if (current.current.scheduleResult || unknown('schedule')) return
      const snapshot = await verify(current.current)
      if (!snapshot?.detailsConfirmed || !conversationReadiness(snapshot).canSchedule) return
      await execute({ kind: 'schedule', contact: parsed.data }, async (state) => {
        if (!state.estimateId) throw new Error('Saved estimate required')
        const result = await attachContact(state.estimateId, parsed.data)
        return { kind: 'schedule', reference: result.reference, requestedDate: result.requestedDate }
      })
    })
  const submitQuotes = (moverIds: string[], note: string) =>
    withLock(async () => {
      if (current.current.quoteResult || unknown('quotes')) return
      const snapshot = await verify(current.current)
      if (!snapshot?.detailsConfirmed || !conversationReadiness(snapshot).canQuote) return
      await execute({ kind: 'quotes', moverIds, note }, async (state) => {
        if (!state.estimateId) throw new Error('Saved estimate required')
        return { kind: 'quotes', requests: (await requestQuotes(state.estimateId, moverIds, note)).requests }
      })
    })
  const loadMovers = async () => {
    if (!active.current || leaving.current || moversLoading.current) return
    moversLoading.current = true
    setMoversBusy(true)
    const sessionId = current.current.sessionId
    try {
      const list = await listMovers()
      if (active.current && current.current.sessionId === sessionId) setMovers(list)
    } catch {
      if (active.current) setError('Unable to load movers. Try Choose movers again.')
    } finally {
      moversLoading.current = false
      if (active.current) setMoversBusy(false)
    }
  }

  const turn = async () => {
    if (!active.current || leaving.current || chatRequest.current) return
    const request = new AbortController()
    chatRequest.current = request
    setChatBusy(true)
    setChatFailed(false)
    setError(null)
    const snapshot = current.current // Original request revision, before any await.
    const authorization = submittedTurn.current
    try {
      const reply = await conversationChatApi(snapshot.messages, conversationSnapshot(snapshot), request.signal)
      if (
        !active.current ||
        request.signal.aborted ||
        chatRequest.current !== request ||
        current.current.sessionId !== snapshot.sessionId
      )
        return
      if (current.current.revision !== snapshot.revision || reply.basedOnRevision !== snapshot.revision) {
        setChatFailed(true)
        setError(
          'The move changed while the assistant replied. The stale reply was not applied. Retry with the current manifest.',
        )
        return
      }
      // Validate every reference against the captured state before exposing any part of the batch.
      // Proposal additions and prose do not advance the domain revision.
      const actions: ConversationAction[] = [
        ...(reply.agent
          ? [
              {
                type: 'agent.guidance' as const,
                nextAction: reply.agent.nextAction,
                id: id(),
                source: 'agent' as const,
                expectedRevision: snapshot.revision,
              },
            ]
          : []),
        {
          type: 'message.append',
          message: { id: id(), role: 'assistant', content: reply.reply },
          id: id(),
          source: 'agent',
          expectedRevision: snapshot.revision,
        },
        ...(reply.proposals.length
          ? [
              {
                type: 'proposal.addBatch' as const,
                proposals: reply.proposals,
                id: id(),
                source: 'agent' as const,
                expectedRevision: snapshot.revision,
              },
            ]
          : []),
      ]
      let checked = current.current
      for (const action of actions) {
        const next = reduceConversation(checked, action)
        if (next === checked) throw new Error('Invalid conversation proposal')
        checked = next
      }
      for (const action of actions) dispatch(action)
      setSuggestionsExpired(false)
      submittedTurn.current = null // A successful turn consumes authorization; errors may retry at the same revision.
      const authorized =
        authorization?.sessionId === snapshot.sessionId &&
        authorization.revision === snapshot.revision &&
        authorization.messageId === snapshot.messages.at(-1)?.id
      if (authorized) {
        const grounded = reply.proposals.filter((proposal) =>
          groundedConversationProposal(proposal, snapshot.messages.at(-1)),
        )
        if (
          grounded.length &&
          !apply(
            { type: 'proposal.applyBatch', proposalIds: grounded.map((proposal) => proposal.id) },
            'chat',
            snapshot.revision,
          )
        )
          return
        const analyzeIntent = grounded.some(
          (proposal) => proposal.command.type === 'request.action' && proposal.command.action === 'analyze',
        )
        if (analyzeIntent) {
          // Release this finished Chat request before the accepted analysis asks its next question.
          chatRequest.current = null
          setChatBusy(false)
          await analyzePhotos()
        } else {
          const priceIntent = grounded.some(
            (proposal) => proposal.command.type === 'request.action' && proposal.command.action === 'price',
          )
          if (priceIntent) await openSummary()
          else await maybeOpenSummary()
        }
      }
    } catch (caught) {
      if (active.current && !request.signal.aborted && chatRequest.current === request) {
        setChatFailed(true)
        setError(
          caught instanceof ConversationContextError
            ? caught.message
            : 'The assistant did not answer. Your message is saved; retry or keep editing the manifest.',
        )
      }
    } finally {
      if (chatRequest.current === request) {
        chatRequest.current = null
        if (active.current) setChatBusy(false)
      }
    }
  }
  const sendMessage = (text = draft) => {
    if (!active.current || leaving.current || !text.trim() || chatRequest.current) return
    if (text.length > CONVERSATION_MESSAGE_LIMIT) {
      setError('Please send a message of 12,000 characters or fewer. Your draft and history are unchanged.')
      return
    }
    const messageId = id()
    const message = { id: messageId, role: 'user' as const, content: text.trim() }
    try {
      conversationContext([...current.current.messages, message], conversationSnapshot(current.current))
    } catch (caught) {
      if (caught instanceof ConversationContextError) setError(caught.message)
      return
    }
    const accepted = apply({ type: 'message.append', message }, 'chat')
    if (!accepted) return
    submittedTurn.current = { sessionId: accepted.sessionId, messageId, revision: accepted.revision }
    // A new answer may correct priced scope. Hide the obsolete overlay before waiting for Chat.
    summaryGeneration.current++
    setView('chat')
    displayedScope.current = null
    setDraft('')
    return turn()
  }
  const cancel = () => {
    submittedTurn.current = null
    chatRequest.current?.abort()
    chatRequest.current = null
    setChatBusy(false)
    setChatFailed(false)
    setError('Reply cancelled. Already submitted writes cannot be cancelled here; their result may still arrive.')
  }
  const patchUploads = (next: ConversationUpload[]) => {
    uploadRef.current = next
    setUploads(next)
  }
  const removeUpload = (uploadId: string) => {
    const card = uploadRef.current.find((card) => card.id === uploadId)
    if (card) URL.revokeObjectURL(card.src)
    patchUploads(uploadRef.current.filter((card) => card.id !== uploadId))
  }
  const confirmPhotoChange = () =>
    !current.current.analysis ||
    window.confirm('Changing the photos discards the current inventory and price. Continue?')
  const uploadBatch = async (batch: ConversationUpload[]) => {
    const snapshot = current.current
    if (
      !uploadCohort.current ||
      uploadCohort.current.sessionId !== snapshot.sessionId ||
      uploadCohort.current.revision !== snapshot.revision
    )
      uploadCohort.current = { sessionId: snapshot.sessionId, revision: snapshot.revision }
    // Overlapping selections share only upload-owned revision advances. An unrelated edit leaves
    // older cohorts stale; a new explicit selection/retry may start a new cohort at that edit.
    const cohort = uploadCohort.current
    await Promise.all(
      batch.map(async (card) => {
        const present = () =>
          active.current &&
          current.current.sessionId === snapshot.sessionId &&
          uploadRef.current.some((entry) => entry.id === card.id)
        const patch = (change: Partial<ConversationUpload>) => {
          if (present())
            patchUploads(uploadRef.current.map((entry) => (entry.id === card.id ? { ...entry, ...change } : entry)))
        }
        try {
          const file = await downscaleImage(card.file)
          if (!present()) return
          patch({ status: 'uploading' })
          const ref = await uploadImage(file, snapshot.sessionId, (progress) => patch({ progress }))
          if (!present()) return
          const accepted = apply({ type: 'photo.add', photo: { id: card.id, ...ref } }, 'chat', cohort.revision)
          if (!accepted) {
            patch({ status: 'error' })
            return
          }
          cohort.revision = accepted.revision
          removeUpload(card.id)
        } catch {
          patch({ status: 'error' })
          if (present())
            setError(
              isHeic(card.file)
                ? HEIC_MESSAGE
                : !isAcceptedType(card.file)
                  ? 'Please choose a JPEG, PNG or WebP photo.'
                  : 'Photo upload failed. Retry or remove it; no linked photo was added.',
            )
        }
      }),
    )
    if (
      active.current &&
      !leaving.current &&
      current.current.sessionId === snapshot.sessionId &&
      current.current.revision === cohort.revision &&
      uploadRef.current.length === 0 &&
      batch.length > 0
    ) {
      await analyzePhotos()
    }
  }
  const uploadFiles = (files: File[]) => {
    if (!files.length) return
    if (current.current.sample) {
      setError('Switch to your own photos before uploading. Sample and own photos cannot be mixed.')
      return
    }
    if (!confirmPhotoChange()) return
    const room = 10 - current.current.photos.length - uploadRef.current.length
    if (files.length > room) setError('Up to 10 photos per estimate. Remove a photo to make room.')
    const batch = files.slice(0, Math.max(0, room)).map(
      (file): ConversationUpload => ({
        id: id(),
        file,
        src: URL.createObjectURL(file),
        status: 'preparing',
        progress: 0,
      }),
    )
    patchUploads([...uploadRef.current, ...batch])
    return uploadBatch(batch)
  }
  const retryUpload = (uploadId: string) => {
    const card = uploadRef.current.find((entry) => entry.id === uploadId && entry.status === 'error')
    if (!card || !confirmPhotoChange()) return
    patchUploads(
      uploadRef.current.map((entry) =>
        entry.id === uploadId ? { ...entry, status: 'preparing', progress: 0 } : entry,
      ),
    )
    return uploadBatch([card])
  }
  const removePhoto = (photoId: string) => {
    if (confirmPhotoChange()) apply({ type: 'photo.remove', photoId })
  }
  const reset = (mode: 'new' | 'sample' | 'own') => {
    if (locked.current || Object.values(current.current.operations).some((op) => op.status === 'pending')) {
      setError('An operation is in progress. Let it finish before replacing this move draft.')
      return
    }
    if (
      (current.current.analysis || current.current.sample || current.current.messages.length) &&
      !window.confirm('Replace this move draft? Current inventory and price will be discarded.')
    )
      return
    cancel()
    for (const card of uploadRef.current) URL.revokeObjectURL(card.src)
    patchUploads([])
    const next =
      mode === 'new'
        ? createConversationSession()
        : apply({
            type: 'photos.replace',
            sample: mode === 'sample',
            photos:
              mode === 'sample'
                ? sampleSession(window.location.origin).photoUrls.map((url) => ({ id: id(), url, receipt: null }))
                : [],
          })
    if (!next) return
    summaryGeneration.current++
    setView('chat')
    displayedScope.current = null
    current.current = next
    setSession(next)
    saveConversationSession(next)
    setError(null)
    setSuggestionsExpired(false)
    setMovers([])
    if (mode === 'sample') return analyzePhotos()
    return undefined
  }
  const retry = (operationId: string) => {
    const op = current.current.operations[operationId]
    if (!op || op.status !== 'failed') return
    switch (op.request.kind) {
      case 'analyze':
        return analyzePhotos()
      case 'price':
      case 'save':
        return confirmPrice()
      case 'schedule':
        return submitContact(op.request.contact)
      case 'quotes':
        return submitQuotes(op.request.moverIds, op.request.note)
    }
  }
  return {
    session,
    view,
    openSummary,
    updateSession,
    bookMove,
    bookContact,
    completeness: conversationCompleteness(session),
    dispatch,
    apply,
    draft,
    setDraft,
    error,
    busy,
    chatBusy,
    chatFailed,
    suggestionsExpired,
    sendMessage,
    cancel,
    retryChat: turn,
    uploadFiles,
    uploads,
    retryUpload,
    removeUpload,
    removePhoto,
    analyzePhotos,
    confirmPrice,
    submitContact,
    submitQuotes,
    movers,
    moversBusy,
    loadMovers,
    retry,
    reset,
    readiness: conversationReadiness(session),
  }
}
export type ConversationController = ReturnType<typeof useConversationController>
