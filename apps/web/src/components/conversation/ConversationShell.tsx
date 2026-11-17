import { Button, Caption } from '@movers/ui'
import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useRef, useState } from 'react'
import type { ConversationController } from '../../lib/useConversationController'
import { useChatLayout } from '../estimate/useChatLayout'
import { ConversationComposer } from './ConversationComposer'
import { ConversationDataPanel } from './ConversationDataPanel'
import { ConversationFeed } from './ConversationFeed'
import { ConversationJourney } from './ConversationJourney'

export function ConversationShell({ controller }: { controller: ConversationController }) {
  const { stepRef, logRef, contentRef, followRef, resumeFollow, pauseFollow } = useChatLayout({
    follow: 'conversation',
  })
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 860px)').matches)
  const [open, setOpen] = useState(false)
  const dataRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (controller.view !== 'chat') setOpen(false)
  }, [controller.view])
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
    if (desktop) dataRef.current?.focus()
    else setOpen(true)
  }
  return (
    <>
      <Dialog.Root open={!desktop && open && controller.view === 'chat'} onOpenChange={setOpen}>
        <main ref={stepRef} className="conv-shell" aria-label="Continuous move estimator">
          <section className="mv-panel conv-chat" aria-label="Chat about your move">
            <div className="conv-chat__head">
              <Caption accent="tape">Let’s plan your move.</Caption>
              <div className="mv-actions">
                {!desktop ? (
                  <Dialog.Trigger className="mv-btn mv-btn--sm mv-btn--ghost" aria-label="Open move manifest">
                    {controller.completeness.percent}% · What we know
                  </Dialog.Trigger>
                ) : null}
                <Button
                  size="sm"
                  onClick={() => {
                    setOpen(false)
                    void controller.openSummary()
                  }}
                >
                  Price summary
                </Button>
              </div>
            </div>
            <ConversationFeed
              controller={controller}
              logRef={logRef}
              contentRef={contentRef}
              followRef={followRef}
              openData={openData}
              onInteract={pauseFollow}
            />
            <ConversationComposer controller={controller} onSend={resumeFollow} />
          </section>
          {desktop ? (
            <div ref={dataRef} tabIndex={-1} className="mv-panel mv-panel--kraft conv-data-scroll">
              <ConversationDataPanel controller={controller} />
            </div>
          ) : null}
        </main>
        {!desktop ? (
          <Dialog.Portal>
            <Dialog.Overlay className="conv-drawer-overlay" />
            <Dialog.Content className="conv-drawer" aria-modal="true">
              <div className="conv-drawer__head">
                <Dialog.Title className="conv-heading">Your move so far</Dialog.Title>
                <Dialog.Close className="mv-btn mv-btn--sm mv-btn--ghost">Back to chat</Dialog.Close>
              </div>
              <Dialog.Description className="est-small">
                Everything learned from your photos and conversation.
              </Dialog.Description>
              <div className="conv-data-scroll">
                <ConversationDataPanel controller={controller} />
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </Dialog.Root>
      <ConversationJourney key={controller.session.sessionId} controller={controller} />
    </>
  )
}
