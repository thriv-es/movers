import type { HTMLAttributes } from 'react'
import { cx } from './cx'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'ink' | 'green' | 'tape' | 'sky' | 'paper'
}

/** A small inked pill for statuses and counts. */
export function Badge({ tone = 'paper', className, ...rest }: BadgeProps) {
  return <span {...rest} className={cx('mv-badge', `mv-badge--${tone}`, className)} />
}

export interface TapeLabelProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'tape' | 'green'
}

/** A strip of packing tape with a stamped label on it. */
export function TapeLabel({ tone = 'tape', className, ...rest }: TapeLabelProps) {
  return <span {...rest} className={cx('mv-tape', tone === 'green' && 'mv-tape--green', className)} />
}
