import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import App from '../src/App'

describe('App', () => {
  it('renders the home page with a link into the estimate flow', async () => {
    render(<App />)

    // The home page headline and its call to action prove the router, layout and providers mounted
    // (rather than the error boundary fallback).
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/priced in/i)
    const cta = screen.getByRole('link', { name: /get your estimate/i })
    expect(cta).toHaveAttribute('href', '/estimate')
  })
})
