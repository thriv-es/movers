import type { HTMLAttributes } from 'react'
import { cx } from './cx'

export interface BubbleProps extends Omit<HTMLAttributes<HTMLDivElement>, 'role'> {
  /** Assistant bubbles sit on paper to the left; customer bubbles on tape to the right. */
  role: 'assistant' | 'user'
  /** Small uppercase line above the message, such as the speaker or a timestamp. */
  meta?: string
}

/** A chat caption for the estimator conversation. */
export function Bubble({ role, meta, className, children, ...rest }: BubbleProps) {
  return (
    <div {...rest} data-role={role} className={cx('mv-bubble', `mv-bubble--${role}`, className)}>
      {meta ? <span className="mv-bubble__meta">{meta}</span> : null}
      {children}
    </div>
  )
}
