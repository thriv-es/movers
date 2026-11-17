import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'

export interface FieldProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode
  /** The id of the control the label points at. */
  htmlFor?: string
  help?: ReactNode
  /** Shown under the control in tape red and announced as an alert. */
  error?: ReactNode
  children?: ReactNode
}

/** A labelled form field: caption label, the control, then help text or an error. */
export function Field({ label, htmlFor, help, error, children, className, ...rest }: FieldProps) {
  return (
    <div {...rest} className={cx('mv-field', className)}>
      <label className="mv-field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {help ? <span className="mv-field__help">{help}</span> : null}
      {error ? (
        <span className="mv-field__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  )
}
