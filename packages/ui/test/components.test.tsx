import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Button, Field, Input, MoversMark, Progress, Stepper } from '../src/index'

const steps = [
  { key: 'from', label: 'From' },
  { key: 'to', label: 'To' },
  { key: 'rooms', label: 'Rooms' },
]

describe('Stepper', () => {
  it('marks done, active and upcoming steps and flags the active one', () => {
    render(<Stepper steps={steps} activeIndex={1} />)
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveClass('mv-stepper__item--done')
    expect(items[1]).toHaveClass('mv-stepper__item--active')
    expect(items[1]).toHaveAttribute('aria-current', 'step')
    expect(items[2]).toHaveClass('mv-stepper__item--upcoming')
    expect(screen.getByRole('navigation', { name: 'Progress' })).toHaveTextContent('Step 2 of 3: To')
  })

  it('renders no buttons without onSelect', () => {
    render(<Stepper steps={steps} activeIndex={1} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('only lets done steps be selected', () => {
    const onSelect = vi.fn()
    render(<Stepper steps={steps} activeIndex={1} onSelect={onSelect} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0] as HTMLElement)
    expect(onSelect).toHaveBeenCalledWith(0)
  })
})

describe('Button', () => {
  it('renders a link when href is given', () => {
    render(
      <Button href="/estimate" variant="primary" size="lg">
        Get a price
      </Button>,
    )
    const link = screen.getByRole('link', { name: 'Get a price' })
    expect(link).toHaveAttribute('href', '/estimate')
    expect(link).toHaveClass('mv-btn', 'mv-btn--primary', 'mv-btn--lg')
  })

  it('defaults to type="button" and keeps extra classes', () => {
    render(<Button className="extra">Go</Button>)
    const button = screen.getByRole('button', { name: 'Go' })
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveClass('mv-btn', 'extra')
  })
})

describe('Field and Input', () => {
  it('marks an invalid input', () => {
    render(<Input aria-label="Street" invalid />)
    const input = screen.getByRole('textbox', { name: 'Street' })
    expect(input).toHaveClass('mv-input', 'mv-input--invalid')
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('shows an error as an alert and links the label to the control', () => {
    render(
      <Field label="Street" htmlFor="street" error="Street is required">
        <Input id="street" />
      </Field>,
    )
    const error = screen.getByRole('alert')
    expect(error).toHaveTextContent('Street is required')
    expect(error).toHaveClass('mv-field__error')
    expect(screen.getByLabelText('Street')).toHaveAttribute('id', 'street')
  })
})

describe('Progress and MoversMark', () => {
  it('exposes the clamped value as a progressbar', () => {
    render(<Progress value={140} />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '100')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
  })

  it('renders the mark with its accessible name', () => {
    render(<MoversMark compact title="Movers home" />)
    const mark = screen.getByRole('img', { name: 'Movers home' })
    expect(mark).toHaveClass('mv-mark', 'mv-mark--compact')
  })
})
