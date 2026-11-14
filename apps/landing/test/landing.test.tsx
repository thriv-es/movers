import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { LandingPage } from '../src/LandingPage'

describe('LandingPage', () => {
  it('renders the Movers title', () => {
    render(<LandingPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Movers' })).toBeInTheDocument()
  })
})
