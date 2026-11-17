# Cloudflare dev + main GitHub sync - design

Date: 2026-11-17
Status: implemented

## Goal

Ship the estimator (`apps/web`) to Cloudflare Pages with GitHub as the deploy trigger:

- `dev` branch -> preview environment at `https://dev.movers-ee0.pages.dev`
- `main` branch -> production at `https://movers.thriv.es`

No local CI step, no GitHub Actions workflow, no separate `movers-dev` project. Cloudflare's
Pages Git integration is the build system.

## Starting state

Verified against the `thriv.es` account (id `7a07e0c68a7370f303987cfa95cfcaa6`):

| Thing | Before |
|---|---|
| Pages project `movers` | exists, GitHub source connected to `thriv-es/movers` |
| Production branch | `main` |
| Build config | root dir `apps/web`, command `pnpm build`, output `dist` |
| Preview policy | `all` - every branch, including `feat/*` |
| `dev` preview build | working, last build `d52c345` |
| Production deployment | stale - `9f56358`, ~5 months old, pre-monorepo layout |
| Production bindings | none: no D1, no R2, no AI binding |
| R2 bucket `movers` | exists, bound to preview only |
| D1 `movers` (`348b7021`) | exists, bound to preview only |
| `movers-landing` project | exists, direct upload only, no GitHub source |

## Decisions

1. **Production gets its own data resources.** R2 bucket `movers-prod` and D1 database
   `movers-prod`, separate from the preview bucket/database `movers`. A preview build must
   never read or write production leads or photos.
2. **Estimator only.** `apps/landing` stays a direct upload to the `movers-landing` project.
3. **Preview builds on `dev` and `main` only.** `preview_deployment_setting` becomes
   `custom` with `preview_branch_includes: ["dev"]`. PR preview comments are turned off,
   because PR refs no longer match the preview filter and the bot would only report
   "no preview".

## What gets created

| Resource | Value |
|---|---|
| R2 bucket | `movers-prod` (Standard, region default) |
| D1 database | `movers-prod`, id `4b7ca9e1-ce6e-47bf-a0d0-186361d75035`, region EEUR |
| D1 schema | `migrations/0001_init.sql` applied to `movers-prod` (and already to `movers`) |

Nothing else is created. No GitHub Actions workflow, no new repository, no new Pages
project, no standalone Worker. Pages Functions ship inside the `movers` Pages project.

## Configuration changes

`apps/web/wrangler.toml`:

- `[env.production]` gains `vars = { ENV = "production", PRICE_PER_BOX = "50" }`
- `[env.production.r2_buckets]` -> `MOVERS_BUCKET` = `movers-prod`
- `[env.production.d1_databases]` -> `MOVERS_DB` = `movers-prod`
- top-level and `[env.preview]` keep the dev bucket/database `movers`
- header comments updated: the bucket is `movers`, not the never-created `movers-storage`

`README.md`: deploy section rewritten to describe branch-to-environment mapping, the
resource matrix, the setup steps, and the fact that the landing page is not GitHub-synced.

## Data flow and behavior

- Production AI runs through AI Gateway using the existing `CF_AIG_TOKEN` production
  secret, so production needs no `AI` binding. `AI_MODE` is left at `auto`.
- With `ENV=production` the admin API returns 404 (`functions/api/_routes/admin.ts`), so
  the admin UI is not exposed in production.
- Without `MOVERS_DB` the API silently falls back to an in-memory store
  (`functions/api/_lib/store.ts`); without `MOVERS_BUCKET` the photo routes fail. Those
  are exactly the bindings this change adds to production.
- The preview environment keeps `ENV=preview`, so the admin UI and API stay open on
  `dev.movers-ee0.pages.dev`. That is accepted for a test lane.

## Shipping

```bash
git push origin dev     # preview build
git push origin main    # production build
```

`main` is 15+ commits behind and still has the pre-monorepo layout, so the promotion is
a real merge that moves the app into `apps/web` and `packages/ui`.

## Verification

1. `pnpm --filter @movers/web build` and `pnpm --filter @movers/web test` pass locally.
2. Pages shows a successful preview deployment for `dev` and a successful production
   deployment for `main`.
3. `https://movers.thriv.es` serves the current UI.
4. The production deployment config lists `movers-prod` for R2 and D1.
5. `POST https://movers.thriv.es/api/chat` returns a real AI answer, not a mock.
6. A saved estimate lands in `movers-prod`, not in `movers`.
