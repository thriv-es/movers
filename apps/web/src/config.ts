import { z } from 'zod'
import { zSocialMediaDto } from '@/data'

export interface AppConfig extends z.infer<typeof zAppConfig> {}

export const IS_CLIENT = typeof globalThis?.window !== 'undefined'
export const IS_PRODUCTION = import.meta.env.PROD
export const IS_DEVELOPMENT = import.meta.env.DEV

/**
 * Zod schema for this app's config object.
 * Do not store sensitive information in this object because it is publicly exposed to the client.
 *
 * The `locale` string must be valid BCP-47 format e.g. `en-US` or `fr-CA` although the schema only
 * validates it as `string`.
 *
 * **SEO & meta reference**
 *
 * The _recommended_ maximum lengths for fields related to SEO and meta are:
 *
 * - `title` <= 60 (at least for the most important parts to display on a search results page)
 * - `description` <= 155
 * - `keywords` < 10 comma separated keywords
 *
 * **Important reminders for working with Vite:**
 *
 * - `import.meta.env.BASE_URL` value is derived from the `base` property in `vite.config.ts`
 * - `import.meta.X` variables are "find and replace" with hardcoded values-in-place during Vite build
 * - `VITE_` prefix is required on environment variable names for Vite to expose them to browser/client environments
 * - `process.env.X` is a Node-specific convention that does not exist in browser/client environments
 *
 * `vite.config.ts` has a custom `define` to replace `process.env.NODE_ENV` with a harcoded
 * value based on the `NODE_ENV` value in play during the build process. This step enables any dependencies
 * that may rely on `process.env.NODE_ENV` to work as expected and not cause runtime errors in the browser.
 *
 * @see index.html for environment variable usage such as `%VITE_LOCALE%`
 */
export const zAppConfig = z.object({
  // ── Identity ──────────────────────────────────────────────────────────
  title: z.string().default("App"),
  locale: z.string().default("en"),
  textDirection: z.enum(["ltr", "rtl"]).default("ltr"),
  description: z.string().default(""),
  author: z.string().default(""),
  keywords: z.string().default(""),
  canonical: z.string().default(""),

  // ── OpenGraph / Social ─────────────────────────────────────────────────
  ogImage: z.string().default("/og-image.png"),
  ogImageAlt: z.string().default(""),
  ogType: z.string().default("website"),
  ogSiteName: z.string().default(""),

  // ── Twitter ────────────────────────────────────────────────────────────
  twitterCard: z.string().default("summary_large_image"),
  twitterHandle: z.string().default(""),
  twitterImage: z.string().default("/og-image.png"),
  twitterImageAlt: z.string().default(""),

  // ── Theme / UX ─────────────────────────────────────────────────────────
  colorScheme: z.string().default("light dark"),
  themeColor: z.string().default("#ffffff"),

  // ── Contacts ───────────────────────────────────────────────────────────
  contacts: z.object({
    legal: z.string().default("contact@example.com"),
  }),

  // ── Social media handles ───────────────────────────────────────────────
  socialMedia: zSocialMediaDto.optional(),
});

/**
 * This project's config object.
 */
export const CONFIG: AppConfig = zAppConfig.parse({
  title: import.meta.env.VITE_TITLE,
  locale: import.meta.env.VITE_LOCALE,
  textDirection: import.meta.env.VITE_TEXT_DIRECTION,
  description: import.meta.env.VITE_META_DESCRIPTION,
  author: import.meta.env.VITE_META_AUTHOR,
  keywords: import.meta.env.VITE_META_KEYWORDS_CSV,
  canonical: import.meta.env.VITE_CANONICAL,

  ogImage: import.meta.env.VITE_OG_IMAGE,
  ogImageAlt: import.meta.env.VITE_OG_IMAGE_ALT,
  ogType: import.meta.env.VITE_OG_TYPE,
  ogSiteName: import.meta.env.VITE_OG_SITE_NAME,

  twitterCard: import.meta.env.VITE_TWITTER_CARD,
  twitterHandle: import.meta.env.VITE_TWITTER_HANDLE,
  twitterImage: import.meta.env.VITE_TWITTER_IMAGE,
  twitterImageAlt: import.meta.env.VITE_TWITTER_IMAGE_ALT,

  colorScheme: import.meta.env.VITE_COLOR_SCHEME,
  themeColor: import.meta.env.VITE_THEME_COLOR,

  contacts: {
    legal: import.meta.env.VITE_LEGAL_CONTACT,
  },
  socialMedia: {
    github: import.meta.env.VITE_GITHUB || "thriv-es/movers",
    twitter: import.meta.env.VITE_TWITTER,
  },
});
