import { Button, Input } from '@movers/ui'
import { useRef } from 'react'
import type { ConversationController } from '../../lib/useConversationController'

export function ConversationComposer({
  controller,
  onSend,
}: { controller: ConversationController; onSend: () => void }) {
  const camera = useRef<HTMLInputElement>(null)
  const library = useRef<HTMLInputElement>(null)
  const select = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    onSend()
    void controller.uploadFiles(files)
  }
  return (
    <div className="conv-composer">
      <form
        className="est-chat__form"
        aria-label="Message composer"
        onSubmit={(event) => {
          event.preventDefault()
          onSend()
          void controller.sendMessage()
        }}
      >
        <label className="mv-sr-only" htmlFor="conversation-message">
          Message
        </label>
        <Input
          id="conversation-message"
          value={controller.draft}
          onChange={(event) => controller.setDraft(event.target.value)}
          placeholder="Tell us about your move…"
          autoComplete="off"
        />
        <Button type="submit" variant="primary" disabled={controller.chatBusy || !controller.draft.trim()}>
          Send
        </Button>
      </form>
      <div className="mv-actions conv-attachments">
        <input
          ref={library}
          hidden
          tabIndex={-1}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          aria-label="Choose from library"
          onChange={select}
          disabled={controller.session.sample}
        />
        <input
          ref={camera}
          hidden
          tabIndex={-1}
          type="file"
          accept="image/*"
          capture="environment"
          aria-label="Take photo"
          onChange={select}
          disabled={controller.session.sample}
        />
        {controller.session.sample ? (
          <Button size="sm" variant="ghost" onClick={() => controller.reset('own')}>
            Use my own photos
          </Button>
        ) : (
          <Button size="sm" onClick={() => library.current?.click()}>
            Add photos
          </Button>
        )}
        <span className="est-small mv-muted">Up to 10 room or item photos</span>
        <details className="conv-photo-options">
          <summary className="est-small">Photo options</summary>
          <div className="mv-actions">
            <Button size="sm" disabled={controller.session.sample} onClick={() => camera.current?.click()}>
              Take photo
            </Button>
            {!controller.session.sample && !controller.session.photos.length ? (
              <Button size="sm" variant="ghost" onClick={() => controller.reset('sample')}>
                Try demo photos
              </Button>
            ) : null}
          </div>
        </details>
        {controller.chatBusy ? (
          <Button size="sm" variant="ghost" onClick={controller.cancel}>
            Cancel reply
          </Button>
        ) : null}
      </div>
    </div>
  )
}
