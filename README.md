<img src="apps/web/public/favicon.svg" width="36" height="36" alt="movers" />

# thriv.es movers

> Snap a few photos of your stuff and get an AI-powered moving estimate in minutes.

A demo project by [thriv.es](https://thriv.es), shared freely with the community. Fork it, learn from it, build on it.

**[Live demo: movers.thriv.es](https://movers.thriv.es/)**

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/thriv-es/movers/tree/main/apps/web)

---

## What it does

Walk through a short five-step flow:

1. **Chat** - Tell the AI about your move: origin, destination, dates, floors, and elevator access
2. **Photograph** - Upload 1 to 5 photos of your belongings; the vision model builds your inventory
3. **Review** - Confirm or adjust the detected items
4. **Estimate** - Get a full itemized price with a confidence rating
5. **Schedule** - Pick your moving date

## Monorepo layout

This is a [pnpm workspace](https://pnpm.io/workspaces) with two apps:

```
.
├── apps/
│   ├── web/                    # @movers/web: the estimator (React SPA + API)
│   │   ├── src/                # React app (pages, components, shared Zod schemas in src/data)
│   │   ├── functions/api/      # Hono API on Cloudflare Pages Functions
│   │   │   ├── _lib/           # AI client, prompts, pricing logic
│   │   │   └── _routes/        # Route handlers: chat, analyze, price, images
│   │   ├── tailwind/           # Tailwind preset with thriv.es design tokens
│   │   ├── test/               # Vitest tests
│   │   └── wrangler.toml
│   └── landing/                # @movers/landing: the marketing landing page (static)
│       ├── src/                # One page, plain CSS, GSAP motion
│       └── public/
├── package.json                # workspace scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── biome.jsonc
```

## Tech stack

| Layer | Choice |
|---|---|
| Estimator frontend | React 18 + Vite + TypeScript, Tailwind CSS + shadcn/ui |
| Landing page | React 18 + Vite + TypeScript, plain CSS, GSAP |
| API | Hono on Cloudflare Pages Functions |
| AI | Cloudflare Workers AI (Llama 3.3 70B text + Llama 3.2 11B Vision) |
| AI Gateway | Cloudflare AI Gateway (production) |
| Storage | Cloudflare R2 for uploaded photos (simulated locally by Wrangler) |
| Deploy | Cloudflare Pages |

## Getting started

### What you need

- **Node.js 22 or newer** (Wrangler 4 does not run on Node 20). `nvm use` picks it up from `.nvmrc`.
- **pnpm 10**. The exact version is pinned in `package.json` (`packageManager`), so `corepack enable` gives you the right one.

### Setup

```bash
git clone https://github.com/thriv-es/movers
cd movers
pnpm install
```

That is enough to run everything. No token is required for local development (see [AI in local development](#ai-in-local-development)).

### Running locally

```bash
pnpm dev
```

One command starts both apps:

| What | URL |
|---|---|
| Landing page | http://localhost:4600 |
| Estimator, full stack (UI + API) | http://localhost:4610 |

The estimator is served by `wrangler pages dev` on 4610, which runs the API and proxies the UI from Vite on 4611. Open 4610, not 4611.

To run one app only: `pnpm dev:web` or `pnpm dev:landing`.

The ports are fixed and strict on purpose: if one is taken, the command fails with a clear message instead of silently moving to another port.

### AI in local development

The three AI routes (`/api/chat`, `/api/analyze`, `/api/price`) pick a backend automatically:

| Mode | When it is used | What it needs |
|---|---|---|
| `gateway` | `CF_AIG_TOKEN` is set. This is what production uses. | A [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/) token in `apps/web/.dev.vars` |
| `binding` | No token, and Wrangler can reach Workers AI | `wrangler login` (see `apps/web/.dev.vars.example` for choosing the account) |
| `mock` | Neither of the above is available, or a real call fails outside production | Nothing. Works offline with deterministic demo data |

- Every AI response carries an `x-movers-ai-mode` header, and the estimator shows a **Demo data** badge whenever the mock answered, so a mocked estimate is never mistaken for a real one.
- Force a mode with `AI_MODE=gateway|binding|mock` in `apps/web/.dev.vars`. `AI_MODE=mock` gives a fully offline flow.
- In production (`ENV=production`) the mock is never used as a fallback: a failed call returns an error.

> **Note:** The vision model (`llama-3.2-11b-vision-instruct`) requires a one-time terms acceptance per Cloudflare account: Workers AI > Model catalog > llama-3.2-11b-vision-instruct > Accept terms.

### Other commands

All of these run from the repo root, across both apps:

```bash
pnpm typecheck    # TypeScript, including the API in apps/web/functions
pnpm test         # Vitest
pnpm build        # type-check + production build of both apps
pnpm lint         # Biome
pnpm lint:fix     # Biome with auto-fix
pnpm smoke        # with `pnpm dev` running: chat -> upload -> analyze -> price over HTTP
```

To target one app: `pnpm --filter @movers/web <script>` or `pnpm --filter @movers/landing <script>`.

### Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Port 4600 (or 4611) is already in use` | Another process holds the port, usually an earlier `pnpm dev`. Find it with `lsof -nP -iTCP:4600 -sTCP:LISTEN` and stop it. |
| `Wrangler requires at least Node.js v22` | You are on an older Node. Run `nvm use`, and make sure nothing pins `use-node-version` in an `.npmrc`. |
| `pnpm: Cannot find module .../pnpm.cjs` | A broken corepack shim. Run `corepack enable && corepack prepare pnpm@10.18.3 --activate`, or install pnpm another way. |
| The estimator shows the **Demo data** badge | The mock answered. Check `wrangler whoami`, the account selection in `apps/web/.dev.vars.example`, and the API log lines from `pnpm dev`. |
| `We couldn't analyze these images` with real AI | The vision model terms are not accepted on the account (see the note above), or the photo shows nothing recognisable. |
| The page at 4610 is blank or 502 right after start | Vite on 4611 is not up yet. Wait a second and reload. |

## Deploying

Nothing in the local workflow deploys. Deployment is a separate, explicit step.

### First time setup

1. Create a Cloudflare Pages project named `movers`
2. Create an R2 bucket: `wrangler r2 bucket create movers-storage`
3. Set the production secret: `wrangler pages secret put CF_AIG_TOKEN`
4. In `apps/web/wrangler.toml`, uncomment `[env.production.r2_buckets]` and set your bucket name

> **If your Pages project builds from Git:** the estimator moved from the repo root to `apps/web`. Before merging the monorepo layout, set the Pages build to root directory `apps/web`, build command `pnpm install && pnpm build`, output directory `dist`.

### Ship it

```bash
pnpm --filter @movers/web ship    # build + deploy the estimator to Cloudflare Pages
```

The landing page (`apps/landing`) builds to a static `dist/` and can be hosted on any static host. Set `VITE_APP_URL` at build time to the public URL of the estimator's `/estimate` page.

## Environment variables

| Variable | Where | Description |
|---|---|---|
| `CF_AIG_TOKEN` | `apps/web/.dev.vars` / Pages secret | Cloudflare AI Gateway token. Optional locally |
| `AI_MODE` | `apps/web/.dev.vars` | `auto` (default), `gateway`, `binding` or `mock` |
| `PRICE_PER_BOX` | `apps/web/wrangler.toml` | Base price per moving box (default: 50) |
| `ENV` | `apps/web/wrangler.toml` | `development`, `preview` or `production` |
| `VITE_GITHUB` | `apps/web/.env` | GitHub repo path, e.g. `thriv-es/movers` |
| `VITE_APP_URL` | `apps/landing/.env` | Where the landing page's "Get an estimate" points. Default `http://localhost:4610/estimate` |

---

Built with care by [thriv.es](https://thriv.es). MIT licensed, open to contributions.
