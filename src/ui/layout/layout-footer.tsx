import type React from 'react'
import { Link } from 'react-router'

import { cn } from '#lib/utils'
import { ThemeMenu } from '#components/layout/theme-menu'
import { GitHubIcon } from '#components/icons/tech-icons'
import { getGitHubUrl, type SocialMediaDto } from "@/data";

export interface LayoutFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  socialMedia?: SocialMediaDto
  className?: string
}

export function LayoutFooter({ socialMedia, className, ...restProps }: LayoutFooterProps) {
  return (
    <footer className={cn("border-t border-border", className)} {...restProps}>
      <div className="container flex flex-wrap items-center justify-between gap-3 py-5">
        <p className="text-sm text-muted-foreground">
          <span
            className="font-normal italic"
            style={{ fontFamily: "'Source Serif 4', Georgia, serif" }}
          >
            thriv<span style={{ color: "var(--thrive)" }}>.</span>es
          </span>{" "}
          movers - a demo by{" "}
          <a
            href="https://thriv.es"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-4 hover:text-primary transition-colors duration-150"
          >
            thriv.es
          </a>
        </p>

        <div className="flex items-center gap-3">
          {!!socialMedia?.github && (
            <Link
              to={getGitHubUrl(socialMedia.github)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors duration-150"
              aria-label="GitHub"
            >
              <GitHubIcon className="size-4" />
            </Link>
          )}
          <ThemeMenu iconSize="md" />
        </div>
      </div>
    </footer>
  );
}
