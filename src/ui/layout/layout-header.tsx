import { useCallback, useState } from 'react'
import { Link, NavLink, type NavLinkProps } from 'react-router'
import { useWindowScroll, useDebouncedValue } from '@mantine/hooks'

import { cn } from '#lib/utils'
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '#components/ui/sheet'
import { Button } from '#components/ui/button'
import { MenuIcon } from '#components/icons/nav-icons'
import { GitHubIcon } from '#components/icons/tech-icons'
import type { AppNavLink, SocialMediaDto } from '@/data'
import { getGitHubUrl } from '@/data'
import { ThemeMenu } from "#components/layout/theme-menu";

interface LayoutHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  navLinks?: AppNavLink[]
  socialMedia?: SocialMediaDto
  className?: string
}

interface HeaderNavLinkProps extends AppNavLink, Omit<NavLinkProps, 'to'> {
  href: string
  title: string
  isAtScrollThreshold?: boolean
  className?: string
}

export function LayoutHeader({ navLinks, socialMedia, className }: LayoutHeaderProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false)

  const [scroll] = useWindowScroll()
  const [debouncedScrollY] = useDebouncedValue(scroll.y, 150)

  const handleMenuLinkClick = useCallback(() => {
    setIsMobileMenuOpen(false)
  }, [])

  const isScrolled = debouncedScrollY > 50;

  return (
    <header
      className={cn(
        "sticky top-0 z-40 w-full transition-all duration-300",
        isScrolled
          ? "border-b border-border bg-card/90 backdrop-blur supports-[backdrop-filter]:bg-card/80"
          : "border-b border-transparent bg-transparent",
        className,
      )}
    >
      <nav className="container flex items-center justify-between h-16 w-full">
        {/* Wordmark: thriv.es movers */}
        <Link
          to="/"
          className="flex items-baseline gap-2 text-foreground transition-opacity hover:opacity-80"
          onClick={handleMenuLinkClick}
          aria-label="thriv.es movers - home"
        >
          <span
            className="text-lg font-normal tracking-tight select-none leading-none"
            style={{
              fontFamily: "'Source Serif 4', 'Iowan Old Style', Georgia, serif",
            }}
          >
            thriv
            <span className="dot-bob" aria-hidden="true">
              .
            </span>
            es
          </span>
          <span
            className="text-[11px] font-semibold tracking-[0.12em] uppercase text-muted-foreground leading-none"
            style={{ fontFamily: "Inter, sans-serif" }}
          >
            movers
          </span>
        </Link>

        {/* Desktop: nav links + github + theme toggle */}
        <div className="hidden md:flex items-center gap-1">
          {navLinks && navLinks.length > 0 && (
            <ul className="flex items-center gap-0.5">
              {navLinks.map((item) => (
                <li key={item.title}>
                  <HeaderNavLink href={item.href} title={item.title} />
                </li>
              ))}
            </ul>
          )}
          {!!socialMedia?.github && (
            <a
              href={getGitHubUrl(socialMedia.github)}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 text-muted-foreground hover:text-foreground transition-colors duration-150"
              aria-label="GitHub"
            >
              <GitHubIcon className="size-4" />
            </a>
          )}
          <ThemeMenu iconSize="md" />
        </div>

        {/* Mobile: github + theme toggle + hamburger (only if nav links exist) */}
        <div className="flex items-center gap-1 md:hidden">
          {!!socialMedia?.github && (
            <a
              href={getGitHubUrl(socialMedia.github)}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 text-muted-foreground hover:text-foreground transition-colors duration-150"
              aria-label="GitHub"
            >
              <GitHubIcon className="size-4" />
            </a>
          )}
          <ThemeMenu iconSize="md" />
          {navLinks && navLinks.length > 0 && (
            <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MenuIcon />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className={className}>
                <SheetHeader>
                  <SheetTitle>Menu</SheetTitle>
                  <SheetDescription className="sr-only">
                    Navigation
                  </SheetDescription>
                </SheetHeader>
                <div className="flex flex-col items-start gap-1 mt-6">
                  {navLinks.map((item) => (
                    <HeaderNavLink
                      key={item.title}
                      title={item.title}
                      href={item.href}
                      onClick={handleMenuLinkClick}
                    />
                  ))}
                </div>
              </SheetContent>
            </Sheet>
          )}
        </div>
      </nav>
    </header>
  );
}

function HeaderNavLink({
  href,
  title,
  className,
  ...restNavLinkProps
}: HeaderNavLinkProps) {
  return (
    <NavLink
      to={href}
      className={({ isActive }: { isActive: boolean }) =>
        cn(
          "px-3 py-1.5 rounded-md text-sm font-medium transition-colors duration-150",
          "text-muted-foreground hover:text-foreground",
          isActive && "bg-muted text-foreground",
          className,
        )
      }
      {...restNavLinkProps}
    >
      {title}
    </NavLink>
  );
}
