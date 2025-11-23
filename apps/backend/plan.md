# Cloudflare Worker Backend Plan

## Overview
This plan outlines the manual creation of a Cloudflare Worker backend using D1 database and Drizzle ORM in the `apps/backend` directory. The structure will include necessary files for a basic worker setup, Drizzle integration, and configurations for bindings (KV, R2, Queues), environments (dev/prod), observability, and DNS services.

## Directory Structure
- `apps/backend/`
  - `package.json` (for dependencies including Drizzle ORM, Hono, etc.)
  - `wrangler.toml` (base config; we'll create separate dev/prod versions or use env sections)
  - `wrangler.dev.toml` (development environment config)
  - `wrangler.prod.toml` (production environment config)
  - `src/`
    - `index.ts` (Main worker entry point with Hono app and Drizzle setup)
    - `db.ts` (Drizzle ORM configuration and schema)
    - `migrations/` (Drizzle migration scripts)
  - `drizzle.config.ts` (Drizzle configuration for migrations)
  - `tsconfig.json` (TypeScript configuration)

## Key Configurations
### 1. Dependencies (in package.json)
- `@cloudflare/workers-types`
- `hono` (for routing)
- `drizzle-orm`
- `@libsql/client` (if needed for local dev, but D1 uses built-in)
- `drizzle-kit` (for migrations)

### 2. Wrangler.toml Configurations
- Base wrangler.toml with compatibility flags, name, etc.
- Bindings for:
  - D1: `[[d1_databases]] binding = "DB" database_name = "production" database_id = "<ID>"`
  - KV: `kv_namespaces = [{ binding = "KV" , id = "<ID>" }]`
  - R2: `r2_buckets = [{ binding = "BUCKET" , bucket_name = "<NAME>" }]`
  - Queues: `queues = { producers = [{ binding = "QUEUE" , queue = "<NAME>" }] }`
- Observability: `observability = { enabled = true }`
- DNS/Route: `routes = [{ pattern = "example.com/*" , zone_name = "example.com" }]`
- Separate files or [env.dev]/[env.prod] sections for environments.

### 3. Drizzle Setup
- Define schema in db.ts.
- Use Drizzle with D1 in index.ts: `const db = drizzle(env.DB);`

### 4. Implementation Steps
- Create package.json with scripts for build, dev, deploy.
- Set up index.ts with a basic Hono app that uses Drizzle for DB interactions.
- Configure migrations with drizzle-kit.

## Next Steps
Switch to code mode to implement this structure by creating the files as outlined.