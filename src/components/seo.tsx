import { CONFIG, IS_CLIENT } from '@/config'
import { Helmet } from 'react-helmet-async'

/* ──────────────────────────────────────────────────────────────────────────────
   PageSEO — thin wrapper around react-helmet-async with defaults from CONFIG
   Per-page overrides through props; all meta defaults are opinionated for
   SEO + AEO (Answer Engine Optimization) so AI agents and crawlers can
   extract structured information.

   References
   - https://ogp.me/         OpenGraph protocol
   - https://schema.org      JSON-LD structured data
   - https://developers.google.com/search/docs/appearance/structured-data
────────────────────────────────────────────────────────────────────────────── */

export interface PageSeoProps {
  /** Page <title>. Falls back to CONFIG.title. */
  title?: string
  /** Meta description. Falls back to CONFIG.description. */
  description?: string
  /** Canonical URL. Falls back to CONFIG.canonical. */
  canonical?: string
  /** OpenGraph image URL (absolute or root-relative). */
  ogImage?: string
  ogImageAlt?: string
  ogType?: string
  ogSiteName?: string
  twitterCard?: string
  twitterImage?: string
  twitterImageAlt?: string
  /** Whether search engines can index this page. Default true. */
  index?: boolean
  /** Whether search engines should follow links on this page. Default true. */
  follow?: boolean
  /** Optional JSON-LD structured data object (without @context). */
  jsonLd?: Record<string, unknown>
  /** Additional meta tags */
  extraMeta?: Array<Record<string, string>>
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function fullUrl(path: string): string {
  if (path.startsWith('http')) return path
  const base = CONFIG.canonical || (IS_CLIENT ? window.location.origin : '')
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

function robotsDirective(index?: boolean, follow?: boolean): string {
  const idx = index === false ? 'noindex' : 'index'
  const flw = follow === false ? 'nofollow' : 'follow'
  return [idx, flw].join(',')
}

/* ── Component ─────────────────────────────────────────────────────────────── */

export function PageSeo({
  title,
  description,
  canonical,
  ogImage,
  ogImageAlt,
  ogType,
  ogSiteName,
  twitterCard,
  twitterImage,
  twitterImageAlt,
  index = true,
  follow = true,
  jsonLd,
  extraMeta,
}: PageSeoProps): JSX.Element {
  const resolved = {
    title: title || CONFIG.title,
    description: description || CONFIG.description,
    canonical: fullUrl(canonical || CONFIG.canonical || ''),
    ogTitle: title || CONFIG.title,
    ogDescription: description || CONFIG.description,
    ogImage: fullUrl(ogImage || CONFIG.ogImage || ''),
    ogImageAlt: ogImageAlt || CONFIG.ogImageAlt || description || CONFIG.description,
    ogType: ogType || CONFIG.ogType || 'website',
    ogSiteName: ogSiteName || CONFIG.ogSiteName || CONFIG.title,
    twitterCard: twitterCard || CONFIG.twitterCard || 'summary_large_image',
    twitterImage: fullUrl(twitterImage || CONFIG.twitterImage || CONFIG.ogImage || ''),
    twitterImageAlt: twitterImageAlt || CONFIG.twitterImageAlt || description || CONFIG.description,
    robots: robotsDirective(index, follow),
    locale: CONFIG.locale || 'en',
    author: CONFIG.author,
    keywords: CONFIG.keywords,
    themeColor: CONFIG.themeColor || '#0f172a',
    twitterHandle: CONFIG.twitterHandle,
  }

  return (
    <Helmet>
      {/* ── Primary ──────────────────────────────────────────────────── */}
      <title>{resolved.title}</title>
      <meta name="description" content={resolved.description} />
      <meta name="author" content={resolved.author} />
      <meta name="keywords" content={resolved.keywords} />
      <meta name="robots" content={resolved.robots} />
      {resolved.canonical && <link rel="canonical" href={resolved.canonical} />}

      {/* ── OpenGraph ────────────────────────────────────────────────── */}
      <meta property="og:title" content={resolved.ogTitle} />
      <meta property="og:description" content={resolved.ogDescription} />
      <meta property="og:type" content={resolved.ogType} />
      <meta property="og:locale" content={resolved.locale} />
      <meta property="og:site_name" content={resolved.ogSiteName} />
      {resolved.ogImage && <meta property="og:image" content={resolved.ogImage} />}
      {resolved.ogImageAlt && <meta property="og:image:alt" content={resolved.ogImageAlt} />}
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      {resolved.canonical && <meta property="og:url" content={resolved.canonical} />}

      {/* ── Twitter ──────────────────────────────────────────────────── */}
      <meta name="twitter:card" content={resolved.twitterCard} />
      {resolved.twitterHandle && <meta name="twitter:site" content={resolved.twitterHandle} />}
      {resolved.twitterHandle && <meta name="twitter:creator" content={resolved.twitterHandle} />}
      <meta name="twitter:title" content={resolved.ogTitle} />
      <meta name="twitter:description" content={resolved.ogDescription} />
      {resolved.twitterImage && <meta name="twitter:image" content={resolved.twitterImage} />}
      {resolved.twitterImageAlt && <meta name="twitter:image:alt" content={resolved.twitterImageAlt} />}

      {/* ── Mobile / PWA ─────────────────────────────────────────────── */}
      <meta name="theme-color" content={resolved.themeColor} />
      <meta name="color-scheme" content={CONFIG.colorScheme || 'light dark'} />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      <meta name="apple-mobile-web-app-title" content={resolved.title} />

      {/* ── AI / Answer Engine meta (AEO) ────────────────────────────── */}
      {/* Helps LLMs, AI search, and answer engines classify content */}
      <meta name="ai-content-type" content="website" />
      <meta name="ai-topic" content="moving services, relocation, moving estimates, AI moving quotes" />
      <meta name="ai-summary" content={resolved.description} />

      {/* ── Additional meta ──────────────────────────────────────────── */}
      {extraMeta?.map((attrs, i) => (
        <meta key={`extra-${i}`} {...attrs} />
      ))}

      {/* ── JSON-LD Structured Data ──────────────────────────────────── */}
      {jsonLd && (
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            ...jsonLd,
          })}
        </script>
      )}
    </Helmet>
  )
}

// Re-export for convenience
export { Helmet, HelmetProvider } from 'react-helmet-async'