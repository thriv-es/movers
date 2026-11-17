import type { HTMLAttributes } from 'react'
import { cx } from './cx'

export interface StepperStep {
  key: string
  label: string
}

export interface StepperProps extends Omit<HTMLAttributes<HTMLElement>, 'onSelect'> {
  steps: StepperStep[]
  /** Zero-based index of the current step. Earlier steps are done, later ones upcoming. */
  activeIndex: number
  /** When given, done steps become buttons that call back with their index. */
  onSelect?: (index: number) => void
}

type StepState = 'done' | 'active' | 'upcoming'

function stateOf(index: number, activeIndex: number): StepState {
  if (index < activeIndex) return 'done'
  if (index === activeIndex) return 'active'
  return 'upcoming'
}

/** Numbered step panels for the estimator flow. Collapses to a "Step n of N" line on small screens. */
export function Stepper({ steps, activeIndex, onSelect, className, ...rest }: StepperProps) {
  const active = steps[activeIndex]
  return (
    <nav {...rest} aria-label="Progress" className={cx('mv-stepper-nav', className)}>
      <ol className="mv-stepper">
        {steps.map((step, index) => {
          const state = stateOf(index, activeIndex)
          const content = (
            <>
              <span className="mv-stepper__num">{index + 1}</span>
              <span className="mv-stepper__label">{step.label}</span>
            </>
          )
          return (
            <li
              key={step.key}
              className={cx('mv-stepper__item', `mv-stepper__item--${state}`)}
              aria-current={state === 'active' ? 'step' : undefined}
            >
              {state === 'done' && onSelect ? (
                <button type="button" className="mv-stepper__btn" onClick={() => onSelect(index)}>
                  {content}
                </button>
              ) : (
                content
              )}
            </li>
          )
        })}
      </ol>
      {active ? (
        <span className="mv-stepper__summary">
          Step {activeIndex + 1} of {steps.length}: {active.label}
        </span>
      ) : null}
    </nav>
  )
}
