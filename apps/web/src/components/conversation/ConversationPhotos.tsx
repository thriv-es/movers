import { Button, Progress } from '@movers/ui'
import { useLayoutEffect, useRef } from 'react'
import type { ConversationController } from '../../lib/useConversationController'
import { photoRecoveryNeeded } from './conversation-presentation'

/** Inline evidence, not another step. Only unresolved photos expose decisions. */
export function ConversationPhotos({ controller }: { controller: ConversationController }) {
  const { session, uploads } = controller
  const root = useRef<HTMLElement>(null)
  const focusedDecision = useRef<{ node: HTMLElement; photoId: string } | null>(null)
  useLayoutEffect(() => {
    const previous = focusedDecision.current
    if (previous && !previous.node.isConnected) {
      focusedDecision.current = null
      if (document.activeElement === document.body)
        root.current
          ?.querySelector<HTMLElement>(`[data-photo-manage="${previous.photoId}"]`)
          ?.focus({ preventScroll: true })
    }
  })
  if (!session.photos.length && !uploads.length) return null
  const assessments = session.failedPhotoAssessments.length
    ? session.failedPhotoAssessments
    : (session.analysis?.photoAssessments ?? [])
  return (
    <section
      ref={root}
      className="conv-inline-photos mv-stack"
      aria-label="Conversation photos"
      onFocusCapture={(event) => {
        const node = event.target as HTMLElement
        focusedDecision.current = node.dataset.photoDecision ? { node, photoId: node.dataset.photoDecision } : null
      }}
    >
      <p className="est-small mv-muted">
        {session.photos.length} photo{session.photos.length === 1 ? '' : 's'} attached ·{' '}
        {session.analysis ? 'Inventory updated' : 'We’ll review these in this conversation'}
      </p>
      {photoRecoveryNeeded(session) ? (
        <p role="alert" className="est-error">
          Some photos need re-uploading. Add them again below, or remove the unavailable ones.
        </p>
      ) : null}
      <ul className="conv-photo-strip" aria-label="Selected photos">
        {session.photos.map((photo, index) => {
          const linkageFailure = [...assessments, ...(session.analysis?.photoLinkStatuses ?? [])].find(
            (entry) => entry.url === photo.url && ['unlinked', 'unavailable'].includes(entry.status),
          )
          const assessment = linkageFailure ?? assessments.find((entry) => entry.url === photo.url)
          const unavailable =
            (!session.sample && !photo.receipt) || ['unlinked', 'unavailable'].includes(assessment?.status ?? '')
          return (
            <li key={photo.id} className="conv-photo">
              <img src={photo.url} alt={`Room or item attachment ${index + 1}`} loading="lazy" />
              <span className="est-small">
                Photo {index + 1} ·{' '}
                {unavailable
                  ? 'Re-upload required'
                  : session.photoDecisions[photo.url] === 'exclude'
                    ? 'Excluded'
                    : session.photoDecisions[photo.url] === 'keep'
                      ? 'Included after review'
                      : assessment?.status === 'relevant'
                        ? 'Reviewed'
                        : assessment?.status === 'unrelated'
                          ? 'Not move inventory'
                          : assessment?.status === 'uncertain'
                            ? 'Needs your input'
                            : 'Attached'}
              </span>
              {assessment?.reason ? <p className="est-small">{assessment.reason}</p> : null}
              {assessment?.status === 'uncertain' && !session.photoDecisions[photo.url] ? (
                <div className="mv-actions" role="group" aria-label={`Review photo ${index + 1}`}>
                  <Button
                    size="sm"
                    data-photo-decision={photo.id}
                    disabled={session.photoDecisionsLocked || controller.busy}
                    onClick={() => controller.apply({ type: 'photo.decide', photoId: photo.id, decision: 'keep' })}
                  >
                    Keep photo {index + 1}
                  </Button>
                  <Button
                    size="sm"
                    data-photo-decision={photo.id}
                    disabled={session.photoDecisionsLocked || controller.busy}
                    onClick={() => controller.apply({ type: 'photo.decide', photoId: photo.id, decision: 'exclude' })}
                  >
                    Exclude photo {index + 1}
                  </Button>
                </div>
              ) : null}
              <details>
                <summary className="est-small" data-photo-manage={photo.id}>
                  Manage photo {index + 1}
                </summary>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={controller.busy}
                  onClick={() => controller.removePhoto(photo.id)}
                >
                  Remove photo {index + 1}
                </Button>
              </details>
            </li>
          )
        })}
        {uploads.map((upload) => (
          <li key={upload.id} className="conv-photo">
            <img src={upload.src} alt="Selected upload" />
            <span className="est-small">
              {upload.status === 'error'
                ? 'Upload failed — not attached'
                : upload.status === 'preparing'
                  ? 'Preparing…'
                  : 'Uploading…'}
            </span>
            {upload.status === 'uploading' ? <Progress value={upload.progress} aria-label="Uploading photo" /> : null}
            <div className="mv-actions">
              {upload.status === 'error' ? (
                <Button size="sm" onClick={() => void controller.retryUpload(upload.id)}>
                  Retry upload
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => controller.removeUpload(upload.id)}>
                Remove upload
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
