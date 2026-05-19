<img src="public/favicon.svg" width="36" height="36" alt="movers" />

# thriv.es movers

> Snap a few photos of your stuff and get an AI-powered moving estimate in minutes.

A demo project by [thriv.es](https://thriv.es), shared freely with the community. Fork it, learn from it, build on it.

**[Live demo: movers.thriv.es](https://movers.thriv.es/)**

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/thriv-es/movers)

---

## What it does

Walk through a short five-step flow:

1. **Chat** - Tell the AI about your move: origin, destination, dates, floors, and elevator access
2. **Photograph** - Upload 1 to 5 photos of your belongings; the vision model builds your inventory
3. **Review** - Confirm or adjust the detected items
4. **Estimate** - Get a full itemized price with a confidence rating
5. **Schedule** - Pick your moving date

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite + TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| API | Hono on Cloudflare Pages Functions |
| AI | Cloudflare Workers AI (Llama 3.3 70B text + Llama 3.2 11B Vision) |
| AI Gateway | Cloudflare AI Gateway |
| Storage | Cloudflare R2 for uploaded photos |
| Deploy | Cloudflare Pages |

## Project structure

```
.
├── src/
│   ├── data/                 # Zod schemas and shared types
│   ├── ui/                   # shadcn/ui components and layout
│   └── ...                   # React app (pages, routes, providers)
├── functions/
│   └── api/
│       ├── [[catchall]].ts   # Hono entry point for /api/*
│       ├── _lib/             # AI client, prompts, pricing logic
│       └── _routes/          # Route handlers: chat, analyze, price, images
├── tailwind/                 # Tailwind preset with thriv.es design tokens
└── wrangler.toml
```

## Getting started

### What you need

- Node.js 20+
- pnpm 11+
- A [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/) token

### Setup

```bash
git clone https://github.com/thriv-es/movers
cd movers
pnpm install

cp .dev.vars.example .dev.vars
# Open .dev.vars and fill in your CF_AIG_TOKEN
```

### Running locally

**Frontend only** (no API calls):
```bash
pnpm dev          # Vite on http://localhost:5173
```

**Full stack** with AI and R2:
```bash
# Terminal 1
pnpm dev          # Vite on http://localhost:5173

# Terminal 2
pnpm dev:api      # wrangler pages dev on http://localhost:8787
```

Then open `http://localhost:8787` for the full experience.

> **Note:** The vision model (`llama-3.2-11b-vision-instruct`) requires a one-time terms acceptance in the Cloudflare dashboard: Workers AI > Model catalog > llama-3.2-11b-vision-instruct > Accept terms.

### Other commands

```bash
pnpm build        # TypeScript check + production build
pnpm lint         # Biome lint
pnpm lint:fix     # Biome lint with auto-fix
```

## Deploying

### First time setup

1. Create a Cloudflare Pages project named `movers`
2. Create an R2 bucket: `wrangler r2 bucket create movers-storage`
3. Set the production secret: `wrangler pages secret put CF_AIG_TOKEN`
4. In `wrangler.toml`, uncomment `[env.production.r2_buckets]` and set your bucket name

### Ship it

```bash
pnpm ship         # Build + deploy to Cloudflare Pages
```

## Environment variables

| Variable | Where | Description |
|---|---|---|
| `CF_AIG_TOKEN` | `.dev.vars` / Pages secret | Cloudflare AI Gateway token |
| `PRICE_PER_BOX` | `wrangler.toml` | Base price per moving box (default: 50) |
| `ENV` | `wrangler.toml` | `development` or `production` |
| `VITE_GITHUB` | `.env` | GitHub repo path, e.g. `thriv-es/movers` |

---

Built with care by [thriv.es](https://thriv.es). MIT licensed, open to contributions.
