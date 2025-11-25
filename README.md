# Movers - AI-Powered Moving Estimates

A mobile-first web app that provides instant moving estimates using AI-powered photo analysis.

## Features

- 📸 **Photo Analysis**: Upload photos of your items and let AI identify them
- 💬 **Interactive Chat**: Conversational interface for adding/editing items
- 💰 **Instant Quotes**: Get pricing estimates in minutes
- 📅 **Easy Scheduling**: Book your move directly from the app

## Tech Stack

- **Frontend**: React 18 + Vite + TypeScript
- **Backend**: Cloudflare Workers (Hono.js)
- **Styling**: TailwindCSS + shadcn/ui components
- **AI**: OpenAI GPT-4 Vision for image analysis
- **Monorepo**: pnpm workspaces

## Project Structure

```
movers/
├── apps/
│   ├── client/          # React SPA (mobile-first)
│   └── backend/         # Cloudflare Workers API
├── packages/
│   ├── data/            # Shared types, schemas, utilities
│   ├── react-ui/        # UI components (shadcn/ui)
│   └── react-layout/    # Layout components
```

## Prerequisites

- Node.js (version specified in `.npmrc`)
- pnpm
- Cloudflare account (for backend deployment)

## Development

Install dependencies:

```sh
pnpm install
```

Set up environment variables:

```sh
# Client
cp apps/client/.env.example apps/client/.env

# Backend
cp apps/backend/.dev.vars.example apps/backend/.dev.vars
```

Build all packages:

```sh
pnpm build
```

Start dev server:

```sh
pnpm dev
```

The client app will be available at http://localhost:5173

## Deployment

### Client (Cloudflare Pages)

```sh
cd apps/client
pnpm build
# Deploy dist/ to Cloudflare Pages
```

### Backend (Cloudflare Workers)

```sh
cd apps/backend
pnpm deploy
```

## License

MIT
