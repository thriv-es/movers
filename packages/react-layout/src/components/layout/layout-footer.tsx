import type React from 'react'

import { cn } from '@workspace/tw-style'

export interface LayoutFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string
}

/**
 * Application layout footer - minimal mobile-optimized footer.
 */
export function LayoutFooter({ className, ...restProps }: LayoutFooterProps) {
  return (
    <footer className={className} {...restProps}>
      <div className={cn('border-t py-2', className)}>
        <div className="container flex items-center justify-center">
          {/* Intentionally minimal - theme toggle is in header */}
        </div>
      </div>
    </footer>
  )
}
