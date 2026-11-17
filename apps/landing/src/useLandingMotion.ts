/**
 * Landing page motion.
 *
 * The page loads like a comic page being slapped down: panels drop in with a short overshoot, the
 * title slams letter by letter, and the props pop in behind. Scrolling down reveals the remaining
 * panels.
 *
 * Everything animates *from* a hidden state, so if the script never runs (JS disabled, an error
 * before this hook) the content is simply visible. Under `prefers-reduced-motion: reduce` nothing
 * here runs at all and the page is left exactly as the stylesheet draws it.
 */

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import type { RefObject } from 'react'

gsap.registerPlugin(useGSAP)

const MOTION_OK = '(prefers-reduced-motion: no-preference)'

/** Once a tween has landed, hand the element back to the stylesheet. */
const RELEASE = 'transform,opacity,visibility'

/**
 * Scroll reveals, driven by an observer rather than ScrollTrigger. The panels are never hidden: they
 * are simply below the fold when the observer fires, so sliding them up reads as rising into view.
 * Nothing can be left stranded invisible, and a static capture of the whole page still shows every
 * panel. Returns the cleanup.
 */
function revealOnScroll(panels: HTMLElement[], context: gsap.Context): () => void {
  if (panels.length === 0 || typeof IntersectionObserver !== 'function') return () => {}

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        observer.unobserve(entry.target)
        // This runs long after the motion handler returned, so the tween has to be added to the
        // context by hand to be reverted with everything else.
        context.add(() => {
          gsap.from(entry.target, { y: 46, duration: 0.7, ease: 'power2.out', clearProps: 'transform' })
        })
      }
    },
    { threshold: 0.05, rootMargin: '0px 0px -8% 0px' },
  )
  for (const panel of panels) observer.observe(panel)

  return () => observer.disconnect()
}

export function useLandingMotion(root: RefObject<HTMLElement>) {
  useGSAP(
    () => {
      const el = root.current
      if (!el || typeof window.matchMedia !== 'function') return

      // The handler only runs while motion is allowed. If the visitor turns reduced motion on
      // later, matchMedia reverts every tween created inside it.
      const mm = gsap.matchMedia(el)

      try {
        mm.add(MOTION_OK, (context) => {
          const q = <T extends Element>(selector: string) => Array.from(el.querySelectorAll<T>(selector))

          const timeline = gsap.timeline({ defaults: { ease: 'back.out(1.6)', clearProps: RELEASE } })

          timeline
            .from(q('[data-lp-nav]'), {
              yPercent: -110,
              autoAlpha: 0,
              duration: 0.5,
              ease: 'power3.out',
            })
            .from(q('[data-lp-hero-panel]'), { y: 52, rotation: 1.8, autoAlpha: 0, duration: 0.8 }, 0.08)
            .from(
              q('[data-lp-figure]'),
              { y: 70, rotation: -4, scale: 0.93, autoAlpha: 0, duration: 0.72, stagger: 0.12 },
              0.22,
            )
            .from(
              q('[data-lp-letter]'),
              {
                y: -52,
                rotation: -9,
                autoAlpha: 0,
                duration: 0.44,
                stagger: 0.05,
                ease: 'back.out(2.6)',
              },
              0.34,
            )
            .from(q('[data-lp-copy]'), { y: 22, autoAlpha: 0, duration: 0.52, stagger: 0.08, ease: 'power2.out' }, 0.3)
            .from(
              q('[data-lp-burst]'),
              // The burst keeps its transform: the ambient tween below takes over from it.
              { scale: 0.25, autoAlpha: 0, duration: 0.62, ease: 'back.out(3)', clearProps: 'opacity,visibility' },
              0.78,
            )
            .from(
              q('[data-lp-sticker]'),
              { scale: 0.45, rotation: -28, autoAlpha: 0, duration: 0.58, ease: 'back.out(2.8)' },
              0.9,
            )

          // Ambient: the burst keeps breathing so the hero is never static.
          gsap.to(q('[data-lp-burst]'), {
            scale: 1.07,
            duration: 1.7,
            repeat: -1,
            yoyo: true,
            ease: 'sine.inOut',
            delay: 1.6,
          })

          return revealOnScroll(q<HTMLElement>('[data-lp-reveal]'), context)
        })
      } catch (error) {
        // Motion is decoration: if it throws, undo every tween so no element stays hidden, and keep the page.
        console.error('[landing] motion disabled:', error)
        mm.revert()
      }

      // Also reverted with the useGSAP context on unmount; explicit so the dependency is plain.
      return () => mm.revert()
    },
    { scope: root },
  )
}
