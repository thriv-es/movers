import { Button, Caption, Panel, Progress } from '@movers/ui'
import { type ChangeEvent, useEffect, useRef, useState } from 'react'
import type { AnalysisResult, MoveDetails } from '@/data'
import { analyzeApi, EstimateApiError, uploadImage } from '@/lib/api-client'
import { downscaleImage } from '@/lib/image-downscale'
import { type PhotoRef, isBundledSampleUrl } from '@/lib/estimate-session'

interface UploadStepProps {
  photoUrls: string[]
  photoRefs: PhotoRef[]
  sessionId: string
  moveDetails: MoveDetails
  needsPhotoReupload: boolean
  sample: boolean
  hasAnalysis: boolean
  photoAssessments?: AnalysisResult['photoAssessments']
  /** Asked before a change that would discard an existing analysis; false cancels the change. */
  confirmChange: () => boolean
  onPhotosChange: (refs: PhotoRef[], legacyUrls: string[]) => void
  onAnalyzed: (analysis: AnalysisResult) => void
  onAnalyzeStart?: () => void
  onAnalyzeFailure: (assessments: NonNullable<AnalysisResult['photoAssessments']>) => void
  onUseOwnPhotos: () => void
  onUseSample: () => void
  onBack: () => void
}

type PhotoStatus = 'preparing' | 'uploading' | 'done' | 'error'

interface PhotoCard {
  id: string
  name: string
  /** Object URL while local, the public URL once uploaded. */
  src: string
  objectUrl: string | null
  status: PhotoStatus
  progress: number
  ref: PhotoRef | null
  error: string | null
}

const MAX_PHOTOS = 10

let cardSeq = 0

/** Uploaded files are stored as `<uuid>-<original name>`; show the original name. */
const UPLOAD_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i

const fromUrl = (url: string, ref: PhotoRef | null): PhotoCard => ({
  id: `saved-${cardSeq++}`,
  name: decodeURIComponent(url.split('/').pop() ?? 'photo').replace(UPLOAD_PREFIX, ''),
  src: url,
  objectUrl: null,
  status: 'done',
  progress: 100,
  ref,
  error: null,
})

const SAMPLE_LABELS: Record<string, string> = {
  'living-room.jpg': 'Living room',
  'bedroom.jpg': 'Bedroom',
  'kitchen.jpg': 'Kitchen',
}

/** Step 3: photos from the phone camera or library, each downscaled, uploaded with progress and removable. */
export function UploadStep({
  photoUrls,
  photoRefs,
  sessionId,
  moveDetails,
  needsPhotoReupload,
  sample,
  hasAnalysis,
  photoAssessments = [],
  confirmChange,
  onPhotosChange,
  onAnalyzed,
  onAnalyzeStart,
  onAnalyzeFailure,
  onUseOwnPhotos,
  onUseSample,
  onBack,
}: UploadStepProps): JSX.Element {
  const [cards, setCards] = useState<PhotoCard[]>(() =>
    photoUrls.map((url) => fromUrl(url, photoRefs.find((ref) => ref.url === url) ?? null)),
  )
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const libraryRef = useRef<HTMLInputElement>(null)
  const cardsRef = useRef(cards)
  const active = useRef(true)
  cardsRef.current = cards

  // revoke every object URL when the step unmounts
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      for (const card of cardsRef.current) if (card.objectUrl) URL.revokeObjectURL(card.objectUrl)
    }
  }, [])

  const publish = (next: PhotoCard[]) => {
    setCards(next)
    const refs = next.flatMap((card) => (card.ref ? [card.ref] : []))
    const legacyUrls = next.flatMap((card) => (card.status === 'done' && !card.ref ? [card.src] : []))
    if (
      JSON.stringify(refs) !== JSON.stringify(photoRefs) ||
      JSON.stringify([...legacyUrls, ...refs.map((ref) => ref.url)]) !== JSON.stringify(photoUrls)
    ) {
      onPhotosChange(refs, legacyUrls)
    }
  }

  const patch = (id: string, change: Partial<PhotoCard>) => {
    const next = cardsRef.current.map((card) => (card.id === id ? { ...card, ...change } : card))
    cardsRef.current = next
    publish(next)
  }

  const addFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return
    const room =
      MAX_PHOTOS -
      (needsPhotoReupload
        ? cardsRef.current.filter((card) => card.ref || card.objectUrl).length
        : cardsRef.current.length)
    if (room <= 0) {
      setError(`Up to ${MAX_PHOTOS} photos per estimate.`)
      return
    }
    setError(null)
    const batch = files.slice(0, room).map<PhotoCard>((file) => {
      const objectUrl = URL.createObjectURL(file)
      return {
        id: `local-${cardSeq++}`,
        name: file.name,
        src: objectUrl,
        objectUrl,
        status: 'preparing',
        progress: 0,
        ref: null,
        error: null,
      }
    })
    const next = [...cardsRef.current, ...batch]
    cardsRef.current = next
    setCards(next)

    await Promise.all(
      batch.map(async (card, index) => {
        const file = files[index]
        if (!file) return
        try {
          const prepared = await downscaleImage(file)
          patch(card.id, { status: 'uploading' })
          const ref = await uploadImage(prepared, sessionId, (percent) => patch(card.id, { progress: percent }))
          patch(card.id, { status: 'done', progress: 100, ref })
        } catch (caught) {
          patch(card.id, { status: 'error', error: caught instanceof Error ? caught.message : 'Upload failed' })
        }
      }),
    )
  }

  const remove = (id: string) => {
    if (!confirmChange()) return
    const card = cardsRef.current.find((item) => item.id === id)
    if (card?.objectUrl) URL.revokeObjectURL(card.objectUrl)
    const next = cardsRef.current.filter((item) => item.id !== id)
    cardsRef.current = next
    publish(next)
  }

  const usable = (ref: PhotoRef | null): ref is PhotoRef =>
    !!ref && (sample ? isBundledSampleUrl(ref.url) : typeof ref.receipt === 'string' && ref.receipt.length > 0)

  const analyze = async () => {
    const refs = cards.flatMap((card) => (usable(card.ref) ? [card.ref] : []))
    if (refs.length === 0 || needsPhotoReupload) return
    onAnalyzeStart?.()
    setAnalyzing(true)
    setError(null)
    try {
      const result = await analyzeApi(sessionId, refs, moveDetails, sample)
      if (active.current) onAnalyzed(result)
    } catch (caught) {
      if (!active.current) return
      onAnalyzeFailure(caught instanceof EstimateApiError ? caught.photoAssessments : [])
      setError(caught instanceof Error ? caught.message : 'We could not read the photos. Try again.')
    } finally {
      if (active.current) setAnalyzing(false)
    }
  }

  const ready = cards.filter((card) => card.status === 'done' && usable(card.ref))
  const pending = cards.some((card) => card.status === 'preparing' || card.status === 'uploading')

  return (
    <Panel as="section" className="est-upload" aria-label="Photos">
      <div className="mv-row est-upload__head">
        <Caption accent="green">{sample ? 'Sample photos' : 'Photograph each room'}</Caption>
      </div>
      {needsPhotoReupload ? (
        <p className="est-error" role="alert">
          Re-upload your photos to continue, or remove each previous photo you no longer need. Your previous photos are
          shown for reference only.
        </p>
      ) : null}
      {sample ? (
        <p className="mv-lede">Three rooms of a two-bedroom flat. Run the analysis to see what the model spots.</p>
      ) : (
        <p className="mv-lede">
          One photo per room is enough to start; add more angles for big furniture. Photos are shrunk on your phone
          before they upload.
        </p>
      )}

      {!sample ? (
        <div className="mv-actions est-upload__pick">
          <input
            ref={cameraRef}
            className="mv-sr-only"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={addFiles}
            aria-label="Take photo"
            tabIndex={-1}
          />
          <input
            ref={libraryRef}
            className="mv-sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={addFiles}
            aria-label="Choose from library"
            tabIndex={-1}
          />
          <Button variant="primary" onClick={() => confirmChange() && cameraRef.current?.click()} disabled={analyzing}>
            Take photo
          </Button>
          <Button onClick={() => confirmChange() && libraryRef.current?.click()} disabled={analyzing}>
            Choose from library
          </Button>
        </div>
      ) : null}

      {cards.length > 0 ? (
        <ul className="est-photos" aria-label="Selected photos">
          {cards.map((card) => (
            <li key={card.id} className={`est-photo est-photo--${card.status}`}>
              <img src={card.src} alt={SAMPLE_LABELS[card.name] ?? card.name} loading="lazy" />
              <div className="est-photo__meta">
                <span className="est-photo__name">{SAMPLE_LABELS[card.name] ?? card.name}</span>
                {card.status === 'preparing' ? <span className="mv-muted est-small">Preparing...</span> : null}
                {card.status === 'uploading' ? (
                  <Progress value={card.progress} aria-label={`Uploading ${card.name}`} />
                ) : null}
                {card.status === 'error' ? (
                  <span className="est-error" role="alert">
                    {card.error}
                  </span>
                ) : null}
              </div>
              {!sample ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="est-photo__remove"
                  disabled={analyzing}
                  onClick={() => remove(card.id)}
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mv-muted">No photos yet.</p>
      )}

      {error ? (
        <p className="est-error" role="alert">
          {error}
        </p>
      ) : null}

      {photoAssessments.some((photo) => photo.status !== 'relevant') ? (
        <div>
          <p>Some photos could not be included. Upload usable photos of the items being moved, then analyze again.</p>
          <ul aria-label="Photo assessment reasons">
            {photoAssessments.map((photo, index) =>
              photo.status !== 'relevant' ? (
                <li key={photo.url}>
                  Photo {index + 1}: {photo.reason}
                </li>
              ) : null,
            )}
          </ul>
        </div>
      ) : null}
      {analyzing ? (
        <Panel tone="kraft" flat className="est-wait" aria-live="polite">
          <strong>Looking at your photos...</strong>
          <span className="mv-muted">Counting furniture, boxes and anything that needs special care.</span>
        </Panel>
      ) : null}

      <div className="mv-actions">
        <Button variant="ghost" onClick={onBack} disabled={analyzing}>
          Back
        </Button>
        <Button
          variant="primary"
          onClick={analyze}
          disabled={ready.length === 0 || needsPhotoReupload || pending || analyzing}
        >
          {hasAnalysis
            ? 'Analyse again'
            : analyzing
              ? 'Analysing...'
              : `Analyse ${ready.length || ''} photo${ready.length === 1 ? '' : 's'}`}
        </Button>
        {sample ? (
          <Button variant="tape" onClick={onUseOwnPhotos} disabled={analyzing}>
            Use my own photos
          </Button>
        ) : cards.length === 0 ? (
          <Button variant="tape" onClick={onUseSample}>
            Use the sample move instead
          </Button>
        ) : null}
      </div>
    </Panel>
  )
}
