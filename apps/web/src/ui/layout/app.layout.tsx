import { Outlet, useLocation } from 'react-router'
import { cn } from '#lib/utils'
import type { AppNavLink, AppNavLinkGroup, SocialMediaDto } from '@/data'

import { LayoutHeader } from './layout-header'
import { LayoutFooter } from './layout-footer'
import { LayoutMain } from './layout-main'

export interface AppLayoutProps {
  navLinks?: AppNavLink[]
  footerNavLinkGroups?: AppNavLinkGroup[]
  socialMedia?: SocialMediaDto
  hasMain?: boolean
  isMainContainer?: boolean
  className?: string
}

/**
 * Primary application layout: sticky header, optional main content area, and footer.
 *
 * The `main` element gets the `.container` class for all routes except '/'.
 * Override with `isMainContainer={false}` when you need full-bleed layouts.
 * `className` is forwarded to the `main` element.
 */
export function AppLayout({
  navLinks,
  socialMedia,
  hasMain = true,
  isMainContainer = true,
  className,
}: AppLayoutProps): JSX.Element {
  const location = useLocation()
  const isHomeLocation = location.pathname === '/'

  return (
    <>
      <LayoutHeader navLinks={navLinks} socialMedia={socialMedia} className="self-start" />
      {hasMain ? (
        <LayoutMain isContainer={isHomeLocation ? false : isMainContainer} className={cn('flex-1', className)}>
          <Outlet />
        </LayoutMain>
      ) : (
        <Outlet />
      )}
      <LayoutFooter socialMedia={socialMedia} />
    </>
  )
}
