import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import App from '../src/App'

describe('App', () => {
  it('renders the shell and the redirect page with a link into the estimate flow', async () => {
    render(<App />)

    // The redirect page's call to action proves the router, layout and providers mounted
    // (rather than the error boundary fallback).
    const cta = await screen.findByRole('link', { name: /start an estimate/i })
    expect(cta).toHaveAttribute('href', '/estimate')
    expect(screen.getByRole('link', { name: /open the site/i })).toHaveAttribute('href', 'http://localhost:4600/')
  })
})
