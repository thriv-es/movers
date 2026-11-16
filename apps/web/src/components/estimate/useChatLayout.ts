import { useCallback, useLayoutEffect, useRef } from 'react'

/** Keep the page still: only the transcript follows, and only while its reader is near the end. */
export function useChatLayout() {
  const stepRef = useRef<HTMLDivElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const following = useRef(true)

  const followLatest = useCallback(() => {
    const log = logRef.current
    if (log && following.current) {
      // No animation, including for reduced-motion readers and repeated content/size changes.
      log.scrollTo({ top: log.scrollHeight, behavior: 'instant' })
    }
  }, [])

  useLayoutEffect(() => {
    const log = logRef.current
    const content = contentRef.current
    if (!log || !content) return
    const onScroll = () => {
      following.current = log.scrollHeight - log.clientHeight - log.scrollTop <= 64
    }
    log.addEventListener('scroll', onScroll, { passive: true })
    const observer = new ResizeObserver(followLatest)
    observer.observe(content)
    observer.observe(log)
    return () => {
      log.removeEventListener('scroll', onScroll)
      observer.disconnect()
    }
  }, [followLatest])

  // Covers same-count message edits and thinking/error changes as well as new messages.
  useLayoutEffect(() => {
    followLatest()
  })

  useLayoutEffect(() => {
    const step = stepRef.current
    if (!step) return
    const viewport = window.visualViewport
    const measure = () => {
      // Use document coordinates so ordinary outer scrolling does not grow the chat.
      const top = step.getBoundingClientRect().top + window.scrollY
      const bottom = viewport ? viewport.height + viewport.offsetTop : window.innerHeight
      step.style.setProperty('--est-chat-height', `${Math.max(0, bottom - top)}px`)
    }
    measure()
    window.addEventListener('resize', measure)
    viewport?.addEventListener('resize', measure)
    viewport?.addEventListener('scroll', measure)
    const observer = new ResizeObserver(measure)
    // The header can reflow independently (zoom, fonts, mobile progress wrapping).
    if (step.parentElement) observer.observe(step.parentElement)
    if (step.parentElement?.previousElementSibling) observer.observe(step.parentElement.previousElementSibling)
    return () => {
      window.removeEventListener('resize', measure)
      viewport?.removeEventListener('resize', measure)
      viewport?.removeEventListener('scroll', measure)
      observer.disconnect()
    }
  }, [])

  const resumeFollow = () => {
    following.current = true
  }

  return { stepRef, logRef, contentRef, resumeFollow }
}
