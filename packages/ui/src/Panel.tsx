import type { HTMLAttributes } from 'react'
import { cx } from './cx'

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  /** Paper is the default comic panel; ink inverts it; kraft is a lighter cardboard. */
  tone?: 'paper' | 'ink' | 'kraft'
  /** A slight rotation, as if pasted on by hand. */
  tilt?: 'l' | 'r' | 'none'
  /** Smaller offset shadow for dense layouts. */
  flat?: boolean
  as?: 'div' | 'section' | 'article' | 'form'
}

/** An inked comic panel on paper, with the hard offset shadow. */
export function Panel({
  tone = 'paper',
  tilt = 'none',
  flat = false,
  as: Tag = 'div',
  className,
  ...rest
}: PanelProps) {
  return (
    <Tag
      {...rest}
      className={cx(
        'mv-panel',
        tone !== 'paper' && `mv-panel--${tone}`,
        tilt !== 'none' && `mv-panel--tilt-${tilt}`,
        flat && 'mv-panel--flat',
        className,
      )}
    />
  )
}
