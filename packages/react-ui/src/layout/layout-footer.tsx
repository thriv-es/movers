import type React from 'react'
import { Link } from 'react-router'

import { cn } from '#lib/utils'
import { ThemeMenu } from '#components/layout/theme-menu'
import { GitHubIcon } from '#components/icons/tech-icons'
import { getGitHubUrl, getTwitterUrl, type AppNavLink, type SocialMediaDto } from '@workspace/data'

export interface LayoutFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  socialMedia?: SocialMediaDto
  className?: string
}

interface FooterCapLinkProps extends Omit<AppNavLink, 'title'>, React.PropsWithChildren {}

export function LayoutFooter({ socialMedia, className, ...restProps }: LayoutFooterProps) {
  return (
    <footer className={className} {...restProps}>
      <div className={cn('border-t py-4', className)}>
        <div className="container flex flex-wrap items-center justify-between ~gap-2/4">
          <p className="text-center ~text-xs/sm text-muted-foreground w-full xs:w-fit">
            <span className="whitespace-nowrap">
              Created by <FooterCapLink href={getTwitterUrl('firxworx')}>firxworx</FooterCapLink>.{' '}
            </span>
            <span className="whitespace-nowrap">
              <FooterCapLink href="/about">Acknowledgements</FooterCapLink>.
            </span>
          </p>

          <div className="flex w-full xs:w-fit items-center justify-center ~gap-2/3">
            <FooterSocialIcons socialMedia={socialMedia} />
            <ThemeMenu iconSize="md" />
          </div>
        </div>
      </div>
    </footer>
  )
}

function FooterSocialIcons({ socialMedia }: { socialMedia?: SocialMediaDto }): JSX.Element {
  return (
    <>
      {!!socialMedia?.github && (
        <Link to={getGitHubUrl(socialMedia.github)} target="_blank" rel="noopener noreferrer" className="group">
          <GitHubIcon className="~size-5/6 group-hover:text-P-link-hover transition-colors" />
        </Link>
      )}
    </>
  )
}

function FooterCapLink({ href, children }: FooterCapLinkProps): JSX.Element {
  return (
    <Link
      to={href}
      target={href.startsWith('http') ? '_blank' : undefined}
      rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
      className="group font-medium underline underline-offset-4 text-muted-foreground hover:text-P-link-hover transition-colors"
    >
      {children}
    </Link>
  )
}
