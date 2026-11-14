import type { HTMLAttributes } from 'react'
import { cx } from './cx'

export interface CaptionProps extends HTMLAttributes<HTMLSpanElement> {
  accent?: 'none' | 'tape' | 'green' | 'sky'
}

/** A comic caption box: small uppercase text in a bordered paper slip. */
export function Caption({ accent = 'none', className, ...rest }: CaptionProps) {
  return <span {...rest} className={cx('mv-caption', accent !== 'none' && `mv-caption--${accent}`, className)} />
}
