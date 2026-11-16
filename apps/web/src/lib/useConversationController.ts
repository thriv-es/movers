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
import { newSession, sampleSession } from './estimate-session'
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
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const active = useRef(true)
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
    saveConversationSession(current.current)
    // Navigation does not run React cleanup. Leave durable pending evidence for the next loader.
    const hide = () => {
      active.current = false
      chatRequest.current?.abort()
    }
    const show = () => {
      active.current = true
      setBusy(locked.current || Object.values(current.current.operations).some((op) => op.status === 'pending'))
      setChatBusy(chatRequest.current !== null)
    }
    window.addEventListener('pagehide', hide)
    window.addEventListener('pageshow', show)
    return () => {
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
      previous.pendingProposals.some(
        (proposal) => action.type !== 'proposal.apply' || proposal.id !== action.proposalId,
      )
    )
      setSuggestionsExpired(true)
    // Ref and storage update synchronously: repeat clicks and same-tick actions see the accepted revision.
    current.current = next
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
      if (!active.current || current.current.sessionId !== started.sessionId) return null
      const accepted = apply({ type: 'operation.succeeded', operationId, result }, 'system', revision)
      if (accepted) return accepted
      if (current.current.operations[operationId]?.status !== 'pending') return null
      throw new Error('Invalid operation response')
    } catch (caught) {
      if (!active.current || current.current.sessionId !== started.sessionId) return null
      if (
        (request.kind === 'save' || request.kind === 'schedule' || request.kind === 'quotes') &&
        !(caught instanceof EstimateApiError)
      ) {
        // A lost transport/body (including abort before pagehide) cannot prove the write failed.
        // Keep the real pending operation, block reposts, and let reload classify it as interrupted.
        if (current.current.operations[operationId]?.status === 'pending' && current.current.revision === revision)
          setError(
            'Request interrupted — unknown outcome. Check the existing request before submitting again; reload to restore the conversation status.',
          )
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
    if (!snapshot.analysis) return null
    try {
      await checkVision(snapshot.analysis)
      if (!active.current || current.current.sessionId !== snapshot.sessionId) return null
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
      await execute({ kind: 'analyze' }, async (snapshot) => ({
        kind: 'analyze',
        analysis: await analyzeApi(snapshot.sessionId, snapshot.photoRefs, snapshot.moveDetails, snapshot.sample),
      }))
    })
  const confirmPrice = () =>
    withLock(async () => {
      if (uploadRef.current.length) {
        setError('Finish or remove pending uploads before pricing.')
        return
      }
      if (unknown('save')) {
        setError('Save has an unknown outcome. Check the existing request before starting another estimate.')
        return
      }
      if (current.current.estimateId) return
      let snapshot = await verify(current.current)
      if (!snapshot) return
      if (!conversationReadiness(snapshot).canPrice) {
        setError('Confirm the details, accepted inventory and all review questions first.')
        return
      }
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
      if (!snapshot || !conversationReadiness(snapshot).canSave) return
      await execute({ kind: 'save' }, async (state) => {
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
    if (moversLoading.current) return
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
    if (chatRequest.current) return
    const request = new AbortController()
    chatRequest.current = request
    setChatBusy(true)
    setChatFailed(false)
    setError(null)
    const snapshot = current.current // Original request revision, before any await.
    const authorization = submittedTurn.current
    try {
      const reply = await conversationChatApi(snapshot.messages, conversationSnapshot(snapshot), request.signal)
      if (!active.current || chatRequest.current !== request || current.current.sessionId !== snapshot.sessionId) return
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
        {
          type: 'message.append',
          message: { id: id(), role: 'assistant', content: reply.reply },
          id: id(),
          source: 'agent',
          expectedRevision: snapshot.revision,
        },
        ...reply.proposals.map(
          (proposal): ConversationAction => ({
            type: 'proposal.add',
            proposal,
            id: id(),
            source: 'agent',
            expectedRevision: snapshot.revision,
          }),
        ),
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
      const detail = reply.proposals.length === 1 ? reply.proposals[0] : undefined
      if (
        detail?.command.type === 'details.patch' &&
        authorization?.sessionId === snapshot.sessionId &&
        authorization.revision === snapshot.revision &&
        authorization.messageId === snapshot.messages.at(-1)?.id
      )
        apply({ type: 'proposal.apply', proposalId: detail.id }, 'chat', detail.expectedRevision)
    } catch {
      if (active.current && chatRequest.current === request) {
        setChatFailed(true)
        setError('The assistant did not answer. Your message is saved; retry or keep editing the manifest.')
      }
    } finally {
      if (chatRequest.current === request) {
        chatRequest.current = null
        if (active.current) setChatBusy(false)
      }
    }
  }
  const sendMessage = (text = draft) => {
    if (!text.trim() || chatRequest.current) return
    const messageId = id()
    const accepted = apply(
      { type: 'message.append', message: { id: messageId, role: 'user', content: text.trim() } },
      'chat',
    )
    if (!accepted) return
    submittedTurn.current = { sessionId: accepted.sessionId, messageId, revision: accepted.revision }
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
    const legacy = mode === 'sample' ? sampleSession(window.location.origin) : newSession()
    const next =
      mode === 'new'
        ? createConversationSession()
        : migrate({
            ...legacy,
            messages: current.current.messages,
            ...(mode === 'own' ? { moveDetails: current.current.moveDetails } : {}),
          })
    current.current = next
    setSession(next)
    saveConversationSession(next)
    setError(null)
    setSuggestionsExpired(false)
    setMovers([])
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
