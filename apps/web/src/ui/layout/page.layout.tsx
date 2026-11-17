import React from 'react'
import { cn } from '#lib/utils'

export interface PageLayoutProps extends React.HTMLAttributes<HTMLDivElement> {
  as?: 'section' | 'div' | 'aside'
}

/**
 * Wrapper for a page's content area. Renders a `section` by default; pass `as` to override.
 * Intended to be used as a direct child of `AppLayout`.
 */
export const PageLayout = React.forwardRef<HTMLDivElement, PageLayoutProps>(function PageLayout(
  { as = 'section', className, children, ...restProps },
  ref,
) {
  const Component = as

  return (
    <Component ref={ref} className={cn(className)} {...restProps}>
      {children}
    </Component>
  )
})
