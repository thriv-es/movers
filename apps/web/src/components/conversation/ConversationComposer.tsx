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
          ref={camera}
          className="mv-sr-only"
          tabIndex={-1}
          type="file"
          accept="image/*"
          capture="environment"
          aria-label="Take photo"
          onChange={select}
          disabled={controller.session.sample}
        />
        <input
          ref={library}
          className="mv-sr-only"
          tabIndex={-1}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          aria-label="Choose from library"
          onChange={select}
          disabled={controller.session.sample}
        />
        <Button size="sm" onClick={() => camera.current?.click()} disabled={controller.session.sample}>
          Take photo
        </Button>
        <Button size="sm" onClick={() => library.current?.click()} disabled={controller.session.sample}>
          Choose from library
        </Button>
        {controller.chatBusy ? (
          <Button size="sm" variant="ghost" onClick={controller.cancel}>
            Cancel reply
          </Button>
        ) : null}
      </div>
    </div>
  )
}
