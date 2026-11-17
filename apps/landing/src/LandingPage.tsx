/**
 * The Movers landing page.
 *
 * A sibling of the Friday landing page: one printed comic page with inked panels, caption boxes,
 * halftone dots and a comic burst, in the Movers palette (kraft, paper, ink, tape, thrive green).
 * Every call to action leads to the estimator at APP_URL.
 */

import { MoversMark } from '@movers/ui'
import { useRef } from 'react'

import '@movers/ui/tokens.css'
import '@movers/ui/components.css'
import './landing.css'

import boxSticker from './assets/landing/box-sticker.png'
import heroCustomer from './assets/landing/hero-customer.jpg'
import heroMover from './assets/landing/hero-mover.jpg'
import streetWide from './assets/landing/street-wide.jpg'
import { ComicBurst } from './components/ComicBurst'
import { APP_URL, GITHUB_URL } from './config'
import { useLandingMotion } from './useLandingMotion'

const FEATURES = [
  {
    id: 'chat',
    accent: 'lp-caption--tape',
    label: 'The chat',
    title: 'Tell it about the move.',
    body: 'Answer a few questions the way you would on the phone: where from, where to, when, and how many flights of stairs.',
    points: [
      'Origin, destination and move date',
      'Floors and elevators at both ends',
      'Distance worked out from the addresses',
    ],
  },
  {
    id: 'photos',
    accent: 'lp-caption--green',
    label: 'The photos',
    title: 'Snap the room. Skip the survey.',
    body: 'Photograph each room with your phone. A vision model lists what it sees, and you correct whatever it got wrong.',
    points: [
      'Sofas, lamps and boxes become an inventory',
      'Add, remove or recount items before pricing',
      'No tape measure, no clipboard',
    ],
  },
  {
    id: 'price',
    accent: 'lp-caption--sky',
    label: 'The price',
    title: 'A number you can read.',
    body: 'The estimate arrives broken down line by line, with a confidence rating that says how sure it is.',
    points: [
      'An itemized breakdown, not one round figure',
      'High, medium or low confidence, stated up front',
      'An estimate to plan with; your mover confirms the final price',
    ],
  },
]

const STEPS = [
  { name: 'Chat', body: 'Say where you are, where you are going and when.' },
  { name: 'Photograph', body: 'Take photos of each room. Phone photos are fine.' },
  { name: 'Review', body: 'Check the inventory it built and fix what it missed.' },
  { name: 'Estimate', body: 'Read the itemized price and its confidence rating.' },
  { name: 'Schedule', body: 'Happy with it? Pick your moving date.' },
]

const STACK = [
  { name: 'Workers AI', role: 'Reads the photos and drafts the estimate' },
  { name: 'Hono', role: 'The API, on Cloudflare Pages Functions' },
  { name: 'React', role: 'The estimator you click through' },
]

export function LandingPage() {
  const root = useRef<HTMLDivElement>(null)

  useLandingMotion(root)

  return (
    <div className="lp" ref={root}>
      <header className="lp-nav" data-lp-nav>
        <div className="lp-nav__brand">
          <MoversMark size={30} title="Movers" />
        </div>
        <nav className="lp-nav__links" aria-label="Sections">
          <a href="#chat">The chat</a>
          <a href="#photos">The photos</a>
          <a href="#price">The price</a>
          <a href="#how">How it works</a>
        </nav>
        <div className="lp-nav__actions">
          <a href={APP_URL} className="lp-btn lp-btn--primary">
            Get an estimate
          </a>
        </div>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-panel lp-panel--hero lp-hero__panel" data-lp-hero-panel>
            <div className="lp-hero__copy">
              <p className="lp-caption lp-caption--tape" data-lp-copy>
                Nobody is coming round to count your chairs.
              </p>

              <h1 className="lp-hero__title" aria-label="Movers">
                {'MOVERS'.split('').map((letter) => (
                  <span className="lp-hero__letter" data-lp-letter key={letter} aria-hidden="true">
                    {letter}
                  </span>
                ))}
              </h1>

              <p className="lp-hero__lede" data-lp-copy>
                Your move, priced in minutes.
              </p>

              <p className="lp-hero__sub" data-lp-copy>
                Tell the chat where you are going, photograph each room, and get an itemized estimate you can check line
                by line. The photos do the surveying.
              </p>

              <div className="lp-hero__actions" data-lp-copy>
                <a href={APP_URL} className="lp-btn lp-btn--primary lp-btn--lg">
                  Get an estimate
                </a>
                <a href={GITHUB_URL} className="lp-btn lp-btn--ghost lp-btn--lg">
                  View on GitHub
                </a>
              </div>

              <ul className="lp-facts" data-lp-copy>
                <li className="lp-fact">
                  <span className="lp-fact__term">No walk-through</span>
                  <span className="lp-fact__desc">The estimate comes from your photos.</span>
                </li>
                <li className="lp-fact">
                  <span className="lp-fact__term">Itemized price</span>
                  <span className="lp-fact__desc">Every line is there to check.</span>
                </li>
                <li className="lp-fact">
                  <span className="lp-fact__term">Open source</span>
                  <span className="lp-fact__desc">MIT licensed. Read it, run it.</span>
                </li>
              </ul>
            </div>

            <div className="lp-hero__art">
              <figure className="lp-figure lp-figure--mover" data-lp-figure>
                <img
                  src={heroMover}
                  alt="A smiling mover in a green cap and work gloves carrying a stack of taped cardboard boxes."
                  width={1100}
                  height={1467}
                  decoding="async"
                />
                <figcaption className="lp-caption lp-hero__note" data-lp-copy>
                  He does the lifting. Your phone does the counting.
                </figcaption>
              </figure>

              <figure className="lp-figure lp-figure--customer" data-lp-figure>
                <img
                  src={heroCustomer}
                  alt="A woman holding up her phone to photograph a green sofa, a floor lamp and a few taped boxes."
                  width={1100}
                  height={1467}
                  decoding="async"
                />
              </figure>

              <ComicBurst label="PHOTOS ONLY" />

              <img
                className="lp-sticker"
                data-lp-sticker
                src={boxSticker}
                alt=""
                width={360}
                height={360}
                decoding="async"
              />
            </div>
          </div>
        </section>

        <section className="lp-strip">
          <figure className="lp-strip__frame" data-lp-reveal>
            <img
              src={streetWide}
              alt="A cream moving truck with a green stripe parked at the kerb on a sunny street, its ramp down, with boxes and a green sofa waiting on the pavement."
              width={1900}
              height={1069}
              loading="lazy"
              decoding="async"
            />
            <figcaption className="lp-caption lp-caption--tape lp-strip__caption">
              Moving day, 8:05 AM. The price was settled last week.
            </figcaption>
          </figure>
        </section>

        <section className="lp-features" aria-label="What Movers does">
          {FEATURES.map((feature, index) => (
            <article
              key={feature.id}
              id={feature.id}
              className={`lp-feature${index === 1 ? ' lp-feature--offset' : ''}`}
              data-lp-reveal
            >
              <h2 className={`lp-caption lp-feature__label ${feature.accent}`}>{feature.label}</h2>
              <p className="lp-feature__title">{feature.title}</p>
              <p className="lp-feature__body">{feature.body}</p>
              <ul className="lp-feature__list">
                {feature.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </article>
          ))}
        </section>

        <section className="lp-how" id="how">
          <div className="lp-how__head" data-lp-reveal>
            <h2 className="lp-how__title" id="how-title">
              How it works
            </h2>
            <p className="lp-how__lede">Five steps. About five minutes. One phone.</p>
          </div>
          <ol className="lp-steps" aria-labelledby="how-title">
            {STEPS.map((step, index) => (
              <li key={step.name} className="lp-step" data-lp-reveal>
                <span className="lp-step__num" aria-hidden="true">
                  {index + 1}
                </span>
                <h3 className="lp-step__title">{step.name}</h3>
                <p className="lp-step__body">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="lp-open" id="open-source">
          <div className="lp-open__panel" data-lp-reveal>
            <div className="lp-open__copy">
              <span className="lp-caption lp-caption--green">Open source</span>
              <h2 className="lp-open__title">Read it. Run it. Change it.</h2>
              <p className="lp-open__body">
                Movers is MIT licensed, and the whole estimator lives in one repository. Clone it, start it with one
                command, and see exactly how a photo becomes a price.
              </p>
              <div className="lp-open__actions">
                <a href={GITHUB_URL} className="lp-btn lp-btn--lg">
                  View on GitHub
                </a>
              </div>
            </div>
            <dl className="lp-stack">
              {STACK.map((part) => (
                <div key={part.name} className="lp-stack__row">
                  <dt className="lp-stack__name">{part.name}</dt>
                  <dd className="lp-stack__role">{part.role}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="lp-cta">
          <div className="lp-cta__panel" data-lp-reveal>
            <div>
              <span className="lp-caption">Moving day is coming either way.</span>
              <h2 className="lp-cta__title">Box it up.</h2>
              <p className="lp-cta__body">Get your estimate now. All it takes is a few minutes and a phone camera.</p>
            </div>
            <div className="lp-cta__actions">
              <a href={APP_URL} className="lp-btn lp-btn--lg">
                Get an estimate
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-foot__inner">
          <span className="lp-nav__brand">
            <MoversMark size={22} compact title="Movers" />
          </span>
          <div className="lp-foot__links">
            <a href={APP_URL}>Get an estimate</a>
            <a href={GITHUB_URL}>GitHub</a>
            <a href="https://thriv.es" target="_blank" rel="noreferrer">
              thriv.es
            </a>
          </div>
          <span>&copy; {new Date().getFullYear()} thriv.es</span>
        </div>
      </footer>
    </div>
  )
}
