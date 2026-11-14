import type { HTMLAttributes } from 'react'
import { cx } from './cx'

export interface ProgressProps extends Omit<HTMLAttributes<HTMLDivElement>, 'role'> {
  /** Percent complete, clamped to 0..100. */
  value: number
}

/** A thin inked track with a green fill. */
export function Progress({ value, className, ...rest }: ProgressProps) {
  const clamped = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0))
  return (
    // biome-ignore lint/a11y/useFocusableInteractive: a progressbar is read-only output and must not take focus
    <div
      {...rest}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cx('mv-progress', className)}
    >
      <div className="mv-progress__bar" style={{ width: `${clamped}%` }} />
    </div>
  )
}
