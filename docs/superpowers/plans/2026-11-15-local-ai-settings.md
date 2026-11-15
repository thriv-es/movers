# Local AI Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure Cloudflare backend and compatible model independently for Chat, Pricing, and Vision from an isolated local Admin page.

**Architecture:** A small typed catalog and revisioned local D1 row own the selections. The existing AI client resolves a role before calling Gateway or binding, while explicit `AI_MODE=mock` remains an offline override. A development-and-loopback-only Admin API exposes safe selections and availability, never credentials.

**Tech Stack:** TypeScript, Hono, Cloudflare D1/Workers AI, React 18, Zod, Vitest, pnpm.

## Global Constraints

- Work only in `/Volumes/SANDISK SSD/Thrives/Movers/.worktrees/estimate-accuracy` on `feat/estimate-accuracy`; do not touch `main`, push, deploy, or access production. Use `/opt/homebrew/bin/pnpm` and Node 24.
- This plan implements the approved `docs/superpowers/specs/2026-11-15-vision-agent-and-ai-settings-design.md` Admin half. The companion vision plan consumes its interfaces and is executed second.
- Only Cloudflare AI Gateway and Workers AI binding are selectable. No external vendor, credential form, live model validation call, or remote Admin editor. Keep `CF_AIG_TOKEN` server-side.
- Tests under `apps/web/test` use relative imports. Do not log secrets, addresses, photo URLs, receipts, raw model text, or customer data.
- `ENV=development` plus a loopback-bound server is required for settings GET/PATCH; preview and production respond 404. An absent local D1 binding responds 503, never silently persists in memory.
- Run focused tests after each task and root typecheck, tests, build, changed-file Biome, `git diff --check`, and em-dash scan before completion. Local commits on this worktree are approved; no push.

## File map and interfaces

- `apps/web/functions/api/_lib/ai-settings.ts`: catalog, `AiRole`, `AiBackend`, `AiSelection`, `AiSettings`, defaults, validation, D1 load and compare-and-swap update. Keep this separate from unrelated lead `Store`.
- `apps/web/migrations/0002_ai_settings.sql`: singleton revisioned configuration row.
- `apps/web/functions/api/_lib/ai.ts`, `ai-mode.ts`, `ai-client.ts`: resolve per-role backend/model while preserving existing defaults and forced mock semantics.
- `apps/web/functions/api/_routes/admin.ts`: local-only settings GET/PATCH and status; `apps/web/src/lib/admin-api.ts`, `src/pages/admin/ai-settings.page.tsx`, `admin.layout.tsx`, `admin.css`, `src/router.tsx`: grouped Text and Images UI.
- `apps/web/test/ai-settings.test.ts`, `ai-client.test.ts`, `ai-mode.test.ts`, `admin-ai-settings.test.ts`, `admin-ai-settings-ui.test.tsx`: pure, route, and UI regression tests with fake D1/AI; no live calls.

---

### Task 1: Catalog and revisioned local persistence

**Files:** Create `apps/web/functions/api/_lib/ai-settings.ts`, `apps/web/migrations/0002_ai_settings.sql`, `apps/web/test/ai-settings.test.ts`.

**Interfaces:**
```ts
export type AiRole = 'chat' | 'price' | 'vision'
export type AiBackend = 'gateway' | 'binding'
export interface AiSelection { backend: AiBackend; model: string }
export interface AiSettings { revision: number; roles: Record<AiRole, AiSelection> }
export const DEFAULT_ROLES: Record<AiRole, AiSelection>
export function validateRoles(input: unknown): Record<AiRole, AiSelection> // throws on unknown role/backend/model
export async function readAiSettings(db: D1Database): Promise<AiSettings>
export async function updateAiSettings(db: D1Database, expectedRevision: number, roles: unknown): Promise<AiSettings | null> // null on conflict
```
The catalog initially contains the existing text default `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, existing text alternative `@cf/meta/llama-3.1-8b-instruct-fp8-fast` (show its documented prompt-following caveat), and existing vision model `@cf/meta/llama-3.2-11b-vision-instruct`. These are known project models, not a claim that another live model is validated. A vision selector with one catalog option is acceptable until a second compatible model is evaluated; do not invent one. Both backends can carry each catalog selection, subject to availability. Do not make arbitrary model IDs writable.

- [ ] **Step 1: Write failing catalog and persistence tests.** Use a minimal fake D1 prepared-statement object to assert that a text model is rejected for `vision`, an unknown backend is rejected, defaults are returned at revision 0, and two writes using the same expected revision yield one revision-1 update and one `null` conflict. Example assertions:
```ts
expect(() => validateRoles({ ...DEFAULT_ROLES, vision: { backend: 'gateway', model: DEFAULT_ROLES.chat.model } })).toThrow()
expect(() => validateRoles({ ...DEFAULT_ROLES, price: { backend: 'other', model: DEFAULT_ROLES.price.model } })).toThrow()
// With a fake D1 whose SELECT returns no row:
expect(await readAiSettings(db)).toEqual({ revision: 0, roles: DEFAULT_ROLES })
```
- [ ] **Step 2: Run** `cd apps/web && /opt/homebrew/bin/pnpm exec vitest run test/ai-settings.test.ts`; expect RED because module is absent.
- [ ] **Step 3: Implement the catalog and atomic D1 row.** Migration:
```sql
CREATE TABLE IF NOT EXISTS ai_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL,
  roles_json TEXT NOT NULL
);
```
`readAiSettings` returns defaults if row 1 is absent. `updateAiSettings` validates first, inserts row 1 with revision 0 using `INSERT OR IGNORE`, then `UPDATE ai_settings SET roles_json = ?, revision = revision + 1 WHERE id = 1 AND revision = ?`; use `meta.changes === 1` for success, otherwise `null`. Read the updated row and revalidate stored JSON. Never store tokens.
- [ ] **Step 4: Run the focused test, then** `/opt/homebrew/bin/pnpm exec biome check apps/web/functions/api/_lib/ai-settings.ts apps/web/test/ai-settings.test.ts`; expect PASS with no errors.
- [ ] **Step 5: Commit** the three files locally with `git commit -m 'feat(web): persist local AI role selections'`.

### Task 2: Role-specific model and backend dispatch

**Files:** Modify `apps/web/functions/api/_lib/ai.ts`, `ai-mode.ts`, `ai-client.ts`, `types.ts`; modify `apps/web/test/ai-client.test.ts`, `ai-mode.test.ts`.

**Interfaces:** `resolveRole(env: Bindings, role: AiRole): Promise<{ selection: AiSelection; mode: AiMode; available: boolean; revision: number }>` loads local D1 selections only for development, otherwise retains `CHAT_MODEL`/`PRICE_MODEL` and existing vision default. `AI_MODE=mock` in local development overrides the effective mode without changing saved selections. Explicit saved Gateway/binding selection has **no mock fallback** on provider failure. `runText(..., purpose)` maps chat/price; `runVision(...)` maps vision. Do not change their public response shapes in this task.

- [ ] **Step 1: Add failing tests** for independent chat/price/vision model/backend routing, local forced mock precedence, missing selected binding/token producing a non-sensitive error, and preview ignoring local D1. Example:
```ts
expect(chatRun).toHaveBeenCalledWith('@cf/meta/llama-3.3-70b-instruct-fp8-fast', expect.anything())
expect(priceRun).toHaveBeenCalledWith('@cf/meta/llama-3.1-8b-instruct-fp8-fast', expect.anything())
expect(visionRun).toHaveBeenCalledWith('@cf/meta/llama-3.2-11b-vision-instruct', expect.anything())
```
Use a fake settings reader/AI binding; do not use a real token or model call.
- [ ] **Step 2: Run** `cd apps/web && /opt/homebrew/bin/pnpm exec vitest run test/ai-client.test.ts test/ai-mode.test.ts`; expect RED on role overrides.
- [ ] **Step 3: Implement the resolver and dispatch.** Keep the existing `resolveAiMode(env)` default behavior for nonlocal callers, but let the role resolver select an explicit `gateway`/`binding` mode with `allowMockFallback:false`; if local `AI_MODE=mock`, return mock first. Check the placeholder token using the existing `PLACEHOLDER_TOKEN`. Pass `selection.model` to the Gateway and binding call in both text and vision paths. A missing selected provider throws a sanitized availability error rather than falling back. Cache a selection only within a request, not across D1 revisions.
- [ ] **Step 4: Run focused tests and** `/opt/homebrew/bin/pnpm typecheck` from root; expect PASS.
- [ ] **Step 5: Commit** with `git commit -m 'feat(web): route AI calls by local role settings'`.

### Task 3: Local Admin API and grouped settings page

**Files:** Modify `apps/web/functions/api/_routes/admin.ts`, `apps/web/src/lib/admin-api.ts`, `apps/web/src/pages/admin/admin.layout.tsx`, `admin.css`, `apps/web/src/router.tsx`, `apps/web/scripts/dev-api.mjs` if necessary to enforce loopback; create `apps/web/src/pages/admin/ai-settings.page.tsx`, `apps/web/test/admin-ai-settings.test.ts`, `apps/web/test/admin-ai-settings-ui.test.tsx`.

**Interfaces:** `GET /api/admin/ai-settings` returns `{settings:AiSettings, effective:Record<AiRole,{mode:AiMode,available:boolean}>, catalog}` without credentials. `PATCH /api/admin/ai-settings` accepts `{expectedRevision:number, roles:Record<AiRole,AiSelection>}`, returns the same shape or 409 `{error:'Settings changed; reload and retry.'}`. Server checks `ENV === 'development'` and request hostname `localhost` or `127.0.0.1`, and the dev server binds only loopback; otherwise 404. If `MOVERS_DB` is absent, return 503 with no memory write. This is not general authentication.

- [ ] **Step 1: Write failing route and UI tests.** Assert GET/PATCH return 404 for preview/production and non-loopback; 503 with no D1; 400 for incompatible role/model; 409 for stale revision; successful PATCH increments revision. Render Admin with development status and assert `Text`, `Chat`, `Pricing`, `Images`, `Vision` sections and provider/model controls, and that a preview status hides the settings tab. Example:
```ts
expect((await admin.request('http://127.0.0.1/ai-settings', {}, { ...baseEnv, ENV: 'preview' })).status).toBe(404)
expect((await admin.request('http://127.0.0.1/ai-settings', {
  method: 'PATCH', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ expectedRevision: 0, roles: DEFAULT_ROLES }),
}, { ...baseEnv, ENV: 'development', MOVERS_DB: db })).status).toBe(200)
```
- [ ] **Step 2: Run** `cd apps/web && /opt/homebrew/bin/pnpm exec vitest run test/admin-ai-settings.test.ts test/admin-ai-settings-ui.test.tsx`; expect RED on missing route/UI.
- [ ] **Step 3: Implement the endpoints and page.** Place the local-only guard on each settings route inside the existing Admin router (its other preview routes remain unchanged). Use `readAiSettings`, `updateAiSettings`, and `resolveRole` without model calls. Add `adminAiSettings()`/`saveAdminAiSettings()` helpers; show defaults, saved/effective modes, provider unavailable and offline-mock badges; group the three role cards under Text and Images. Disable Save during request; show validation/conflict errors and never write credentials. Serve local dev API on loopback so a spoofed Host header alone is not the isolation boundary.
- [ ] **Step 4: Run focused route/UI tests, root typecheck and changed-file Biome** for this task's files; expect no errors.
- [ ] **Step 5: Commit** with `git commit -m 'feat(web): add local AI settings admin'`.

### Task 4: Integrated local gates and handoff

**Files:** Modify only defects from Tasks 1-3 and focused tests. No deployment config or production route enablement.

- [ ] **Step 1: Run** `/opt/homebrew/bin/pnpm typecheck && /opt/homebrew/bin/pnpm test && /opt/homebrew/bin/pnpm build` at the worktree root; expect all three PASS.
- [ ] **Step 2: Run Biome on the paths changed since this plan's base commit** using `git diff --name-only -z --diff-filter=ACMR 0e5ec1d..HEAD -- apps/web | xargs -0 /opt/homebrew/bin/pnpm exec biome check`. The base `0e5ec1d` is the approved spec commit before this plan's implementation; do not include unrelated untouched baseline files. Expect zero errors; warning-level non-null assertions may remain. Run `git diff --check 0e5ec1d..HEAD` and `git grep -n $'\xe2\x80\x94' -- apps packages README.md` (exit 1 means no matches).
- [ ] **Step 3: Inspect the diff** for secrets, inadvertent preview/prod settings access, raw AI/customer logging, and fallback to mock from an explicitly selected real backend. Record exact test/build/lint outcomes and any legacy full-web Biome debt. Do not deploy or call a real model.
