import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MoveDetailsStep, validateDetails } from '../src/components/estimate/MoveDetailsStep'
import { EMPTY_MOVE_DETAILS } from '../src/data'
import { displayFact, routeSummary } from '../src/components/conversation/conversation-presentation'

afterEach(cleanup)
it('accepts floor zero in the legacy details form without relaxing distance validation', () => {
  const details = {
    ...EMPTY_MOVE_DETAILS,
    from: 'Tel Aviv',
    to: 'Raanana',
    distanceMiles: 0,
    originFloor: 0,
    destinationFloor: 0,
  }
  const onContinue = vi.fn()
  render(<MoveDetailsStep moveDetails={details} onBack={() => {}} onContinue={onContinue} />)
  for (const label of ['Floor at origin', 'Floor at destination'])
    expect(screen.getByLabelText(label)).toHaveAttribute('min', '0')
  fireEvent.click(screen.getByRole('button', { name: 'Continue to photos' }))
  expect(onContinue).toHaveBeenCalledWith(details)
  expect(validateDetails({ ...details, distanceMiles: null })).toHaveProperty('distanceMiles')
  expect(validateDetails({ ...details, distanceMiles: -1 })).toHaveProperty('distanceMiles')
  expect(validateDetails({ ...details, originFloor: -1 })).toHaveProperty('originFloor')
})
it('describes real route precision and missing routing separately with attribution', () => {
  for (const status of ['unconfigured', 'unavailable', 'ambiguous', 'ready'] as const) {
    const text = routeSummary({
      status,
      from: 'A',
      to: 'B',
      endpointRevision: 0,
      precision: 'city',
      attribution: 'Powered by Geoapify',
      ...(status === 'ready' ? { distanceMiles: 10 } : {}),
    })
    expect(text).toContain('Powered by Geoapify')
    expect(text).toMatch(
      status === 'ready'
        ? /Approximate city-to-city.*Not an address-level/
        : status === 'unconfigured'
          ? /not configured/
          : new RegExp(status),
    )
  }
})
it('does not render credential-bearing URLs or contact as new fact summaries', () => {
  for (const value of [
    'https://example.test/?key=private',
    'private@example.test',
    'Bearer private',
    'receipt=private',
  ])
    expect(displayFact(value)).not.toContain('private')
})
