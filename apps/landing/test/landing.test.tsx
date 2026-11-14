import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { LandingPage } from '../src/LandingPage'
import { APP_URL, GITHUB_URL } from '../src/config'

describe('LandingPage', () => {
  it('names the page Movers in its h1', () => {
    render(<LandingPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Movers' })).toBeInTheDocument()
  })

  it('has the eight sections: masthead, hero, strip, features, how it works, open source, call to action, footer', () => {
    const { container } = render(<LandingPage />)
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    for (const section of ['lp-hero', 'lp-strip', 'lp-features', 'lp-how', 'lp-open', 'lp-cta']) {
      expect(container.querySelector(`section.${section}`), section).not.toBeNull()
    }
  })

  it('has a heading for each feature panel, for how it works and for the call to action', () => {
    render(<LandingPage />)
    for (const name of ['The chat', 'The photos', 'The price', 'How it works', 'Box it up.']) {
      expect(screen.getByRole('heading', { name }), name).toBeInTheDocument()
    }
  })

  it('lists exactly five how-it-works steps, in order', () => {
    render(<LandingPage />)
    const list = screen.getByRole('list', { name: 'How it works' })
    const steps = within(list).getAllByRole('listitem')
    expect(steps).toHaveLength(5)
    const names = steps.map((step) => within(step).getByRole('heading').textContent)
    expect(names).toEqual(['Chat', 'Photograph', 'Review', 'Estimate', 'Schedule'])
  })

  it('points every "Get an estimate" link at APP_URL', () => {
    render(<LandingPage />)
    const links = screen.getAllByRole('link', { name: 'Get an estimate' })
    // Masthead, hero and closing call to action.
    expect(links.length).toBeGreaterThanOrEqual(3)
    links.forEach((link) => expect(link).toHaveAttribute('href', APP_URL))
  })

  it('defaults APP_URL to the local estimator', () => {
    expect(APP_URL).toBe('http://localhost:4610/estimate')
  })

  it('points the GitHub links at GITHUB_URL', () => {
    render(<LandingPage />)
    expect(GITHUB_URL).toBe('https://github.com/thriv-es/movers')
    const links = screen.getAllByRole('link', { name: /github/i })
    expect(links.length).toBeGreaterThanOrEqual(1)
    links.forEach((link) => expect(link).toHaveAttribute('href', GITHUB_URL))
  })

  it('gives every image an alt attribute, and the decorative sticker an empty one', () => {
    const { container } = render(<LandingPage />)
    const images = Array.from(container.querySelectorAll('img'))
    // Two hero figures, the sticker and the street strip.
    expect(images).toHaveLength(4)
    images.forEach((image) => expect(image.hasAttribute('alt'), image.outerHTML).toBe(true))

    const sticker = container.querySelector('img[data-lp-sticker]')
    expect(sticker).not.toBeNull()
    expect(sticker).toHaveAttribute('alt', '')

    const described = images.filter((image) => image !== sticker)
    described.forEach((image) => expect(image.getAttribute('alt')?.length ?? 0).toBeGreaterThan(20))
  })

  it('leaves all content visible when motion is reduced', () => {
    // test/setup.ts reports prefers-reduced-motion: reduce, so the motion hook must not touch the DOM.
    const { container } = render(<LandingPage />)
    expect(container.querySelector('[style*="visibility"], [style*="opacity"], [style*="transform"]')).toBeNull()
  })
})
