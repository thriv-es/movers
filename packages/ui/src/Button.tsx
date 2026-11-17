import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react'
import { cx } from './cx'

interface ButtonStyleProps {
  variant?: 'default' | 'primary' | 'tape' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  /** Full-width button. */
  block?: boolean
}

export type ButtonAsButtonProps = ButtonStyleProps & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined }

export type ButtonAsAnchorProps = ButtonStyleProps & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }

export type ButtonProps = ButtonAsButtonProps | ButtonAsAnchorProps

/** A rubber-stamp button. Renders an `<a>` when `href` is given, a `<button type="button">` otherwise. */
export function Button(props: ButtonProps) {
  const { variant = 'default', size = 'md', block = false, className, ...rest } = props
  const classes = cx(
    'mv-btn',
    variant !== 'default' && `mv-btn--${variant}`,
    size !== 'md' && `mv-btn--${size}`,
    block && 'mv-btn--block',
    className,
  )

  if (rest.href !== undefined) {
    const { href, ...anchor } = rest as AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }
    return <a {...anchor} href={href} className={classes} />
  }

  const { type = 'button', ...button } = rest as ButtonHTMLAttributes<HTMLButtonElement>
  return <button {...button} type={type} className={classes} />
}
