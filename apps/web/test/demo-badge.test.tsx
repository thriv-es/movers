import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DemoBadge } from '../src/components/estimate/DemoBadge'
import { recordAiMode, resetAiModeStore } from '../src/lib/ai-mode-store'

const responseWithMode = (mode: string) => ({ headers: new Headers({ 'x-movers-ai-mode': mode }) })

describe('DemoBadge', () => {
  afterEach(() => resetAiModeStore())

  it('renders nothing before any AI call', () => {
    render(<DemoBadge />)
    expect(screen.queryByTestId('demo-badge')).toBeNull()
  })

  it('renders nothing when real AI answered', () => {
    render(<DemoBadge />)
    act(() => {
      recordAiMode(responseWithMode('gateway'))
      recordAiMode(responseWithMode('binding'))
    })
    expect(screen.queryByTestId('demo-badge')).toBeNull()
  })

  it('appears as soon as one answer was mocked and stays', () => {
    render(<DemoBadge />)
    act(() => recordAiMode(responseWithMode('mock')))
    expect(screen.getByTestId('demo-badge').textContent).toMatch(/Demo data/)
    act(() => recordAiMode(responseWithMode('gateway')))
    expect(screen.getByTestId('demo-badge')).toBeTruthy()
  })
})
