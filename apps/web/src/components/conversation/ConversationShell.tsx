import { Caption } from '@movers/ui'
import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useRef, useState } from 'react'
import type { ConversationController } from '../../lib/useConversationController'
import { useChatLayout } from '../estimate/useChatLayout'
import { ConversationComposer } from './ConversationComposer'
import { ConversationDataPanel } from './ConversationDataPanel'
import { ConversationFeed } from './ConversationFeed'

export function ConversationShell({ controller }: { controller: ConversationController }) {
  const { stepRef, logRef, contentRef, followRef, resumeFollow } = useChatLayout({ follow: 'conversation' })
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 860px)').matches)
  const [open, setOpen] = useState(false)
  const dataRef = useRef<HTMLDivElement>(null)
  const { latestUpdate } = controller.session
  useEffect(() => {
    const media = window.matchMedia('(min-width: 860px)')
    const change = () => {
      setDesktop(media.matches)
      if (media.matches) setOpen(false)
    }
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  const openData = () => {
    if (desktop) dataRef.current?.querySelector('input')?.focus()
    else setOpen(true)
  }
  return (
    <Dialog.Root open={!desktop && open} onOpenChange={setOpen}>
      <main ref={stepRef} className="conv-shell" aria-label="Continuous move estimator">
        <section className="mv-panel conv-chat" aria-label="Chat about your move">
          <div className="conv-chat__head">
            <Caption accent="tape">One conversation. Your whole move.</Caption>
            {!desktop ? (
              <Dialog.Trigger className="mv-btn mv-btn--sm" aria-label="Open move manifest">
                {latestUpdate ? `Updated: ${latestUpdate.area}` : 'Move manifest'} ↗
              </Dialog.Trigger>
            ) : null}
          </div>
          <ConversationFeed
            controller={controller}
            logRef={logRef}
            contentRef={contentRef}
            followRef={followRef}
            openData={openData}
          />
          <ConversationComposer controller={controller} onSend={resumeFollow} />
        </section>
        {desktop ? (
          <div ref={dataRef} className="mv-panel mv-panel--kraft conv-data-scroll">
            <ConversationDataPanel controller={controller} />
          </div>
        ) : null}
      </main>
      {!desktop ? (
        <Dialog.Portal>
          <Dialog.Overlay className="conv-drawer-overlay" />
          <Dialog.Content className="conv-drawer" aria-modal="true">
            <div className="conv-drawer__head">
              <Dialog.Title className="conv-heading">Move manifest</Dialog.Title>
              <Dialog.Close className="mv-btn mv-btn--sm mv-btn--ghost">Close manifest</Dialog.Close>
            </div>
            <Dialog.Description className="est-small">
              What we know so far. Edits update the same conversation.
            </Dialog.Description>
            <div className="conv-data-scroll">
              <ConversationDataPanel controller={controller} />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      ) : null}
    </Dialog.Root>
  )
}
