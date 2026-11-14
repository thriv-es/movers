import type { HTMLAttributes } from 'react'
import { cx } from './cx'

export interface MoversMarkProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'role' | 'title'> {
  /** Height of the box icon in pixels; the wordmark scales with it. */
  size?: number
  /** Footer variant: no offset shadow on the icon. */
  compact?: boolean
  /** Accessible name of the mark. */
  title?: string
}

/** The Movers mark: an inked, taped cardboard box next to the wordmark. */
export function MoversMark({ size = 30, compact = false, title = 'Movers', className, ...rest }: MoversMarkProps) {
  return (
    <span {...rest} className={cx('mv-mark', compact && 'mv-mark--compact', className)} role="img" aria-label={title}>
      <svg className="mv-mark__box" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" focusable="false">
        <path
          d="M4 12h24v16H4z"
          fill="var(--mv-paper)"
          stroke="var(--mv-ink)"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <path
          d="M2 12 6.5 5h19L30 12z"
          fill="var(--mv-paper)"
          stroke="var(--mv-ink)"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <path d="M13 5h6v13h-6z" fill="var(--mv-tape)" stroke="var(--mv-ink)" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <span className="mv-mark__word" aria-hidden="true" style={{ fontSize: Math.round(size * 0.78) }}>
        Movers
      </span>
    </span>
  )
}
