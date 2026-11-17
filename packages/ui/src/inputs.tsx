import { forwardRef } from 'react'
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cx } from './cx'

interface InvalidProps {
  /** Marks the control as invalid: tape-red border plus `aria-invalid`. */
  invalid?: boolean
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement>, InvalidProps {}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid = false, className, ...rest },
  ref,
) {
  return (
    <input
      {...rest}
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cx('mv-input', invalid && 'mv-input--invalid', className)}
    />
  )
})

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement>, InvalidProps {}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid = false, className, ...rest },
  ref,
) {
  return (
    <select
      {...rest}
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cx('mv-select', invalid && 'mv-input--invalid', className)}
    />
  )
})

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, InvalidProps {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid = false, className, ...rest },
  ref,
) {
  return (
    <textarea
      {...rest}
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cx('mv-textarea', invalid && 'mv-input--invalid', className)}
    />
  )
})
