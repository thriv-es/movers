# Request-Aware Vision Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After Step 3 Photos, assess each session-linked photo against confirmed move details, exclude unrelated/unavailable photos visibly, and pass only reviewed moving inventory to Step 4.

**Architecture:** D1-backed opaque upload receipts bind own photos to an estimate session; exact bundled sample paths are separately allowed. A dedicated orchestrator validates references before one bounded-concurrency multimodal call per eligible photo, parses relevance and inventory, and returns per-photo evidence plus a merged relevant inventory. Uncertain candidates require an explicit customer decision before editing/pricing. The companion local AI settings plan runs first and supplies role-specific vision backend/model resolution.

**Tech Stack:** TypeScript, Hono, Cloudflare D1/R2/Workers AI, React 18, Zod, Vitest, pnpm.

## Global Constraints

- Work only in `/Volumes/SANDISK SSD/Thrives/Movers/.worktrees/estimate-accuracy` on `feat/estimate-accuracy`; do not touch `main`, push, deploy, or access production. Use `/opt/homebrew/bin/pnpm` and Node 24.
- Follow `docs/superpowers/specs/2026-11-15-vision-agent-and-ai-settings-design.md`. Run `docs/superpowers/plans/2026-11-15-local-ai-settings.md` first; use its `resolveRole(env,'vision')` interface. Only confirmed Step 2 move details and linked photos go to vision, never the chat transcript.
- No arbitrary external fetch, live model call, preview upload/cache write, customer data logging, raw model output logging, secret/receipt logging, new rate or volume constants, or production/preview Admin settings editor. Preserve CC BY 2.0 sample attribution.
- Tests in `apps/web/test` use relative imports. Local `AI_MODE=mock` remains visibly offline; an explicitly selected real backend fails visibly if unavailable. Do not claim mock metrics are live accuracy.
- Run focused tests after each task and root typecheck, tests, build, changed-file Biome, `git diff --check`, and em-dash scan before completion. Local commits on this worktree are approved; no push.

## File map and interfaces

- `apps/web/migrations/0003_photo_receipts.sql`, `apps/web/functions/api/_lib/photo-receipts.ts`: 30-day receipt capability, D1 hash lookup, lazy expiry cleanup. Do not expand the unrelated leads store.
- `apps/web/functions/api/_routes/images.ts`, `apps/web/src/lib/api-client.ts`, `apps/web/src/lib/estimate-session.ts`, `apps/web/src/components/estimate/UploadStep.tsx`: upload `{url,receipt}` response, session ID and v4/v3 migration, re-upload affordance.
- `apps/web/functions/api/_lib/photo-links.ts`: only session receipt-verified R2 keys and exact sample paths; no `fetch(url)` for arbitrary hosts.
- `apps/web/functions/api/_lib/vision-assessment.ts`: per-photo verdict schema, prompt construction, bounded orchestration and merge. `apps/web/functions/api/_routes/analyze.ts`: request validation, error mapping and response; no raw output/URL logging.
- `apps/web/src/data/z-common/z-move-demo.ts`, `apps/web/src/data/types/move-demo.types.ts`, `apps/web/src/pages/estimate.page.tsx`, `apps/web/src/components/estimate/ReviewStep.tsx`, `apps/web/functions/api/_lib/price-confidence.ts`: persisted photo states, explicit uncertain decision, conservative confidence.
- `apps/web/functions/api/_lib/sample-cache.ts`: include selected model/backend/revision, details and photo identity in sample cache input; keep the existing mock baseline metadata historical.
- Focused tests: `apps/web/test/photo-receipts.test.ts`, `photo-links.test.ts`, `vision-assessment.test.ts`, `routes.test.ts`, `estimate-session.test.ts`, `price-confidence.test.ts`, `analysis-merge.test.ts`.

---

### Task 1: Receipt-bound uploads and draft migration

**Files:** Create `apps/web/migrations/0003_photo_receipts.sql`, `apps/web/functions/api/_lib/photo-receipts.ts`, `apps/web/test/photo-receipts.test.ts`; modify `apps/web/functions/api/_routes/images.ts`, `apps/web/src/lib/api-client.ts`, `apps/web/src/lib/estimate-session.ts`, `apps/web/src/components/estimate/UploadStep.tsx`, `apps/web/src/pages/estimate.page.tsx`, `apps/web/test/estimate-session.test.ts`, `apps/web/test/routes.test.ts`.

**Interfaces:**
```ts
export interface PhotoRef { url: string; receipt: string | null }
export interface ReceiptRecord { sessionId: string; objectKey: string; expiresAt: string }
export async function issuePhotoReceipt(db: D1Database, sessionId: string, objectKey: string): Promise<string>
export async function verifyPhotoReceipt(db: D1Database, sessionId: string, objectKey: string, receipt: string): Promise<boolean>
export const PHOTO_RECEIPT_DAYS = 30
```
The upload endpoint accepts `sessionId` in multipart FormData and returns `{uploads:[{url,receipt}]}`. `uploadImage(file,sessionId,onProgress)` returns one `PhotoRef`. `EstimateSession` v5 adds `sessionId`, `photoRefs`, and `needsPhotoReupload`; keep `photoUrls` synchronized for existing UI/lead interfaces until those are deliberately migrated. The sample session has exact three `PhotoRef`s with `receipt:null` and `sample:true`.

- [ ] **Step 1: Write failing receipt and migration tests.** Assert a receipt verifies only for the same session ID and object key, an expired receipt fails, the DB stores only its SHA-256 hash, and a saved v4 own-photo draft retains visible URLs/details but clears analysis/price, moves to `upload`, and sets `needsPhotoReupload:true`. A saved v4 sample draft retains exact sample refs without re-upload. Example:
```ts
const sessionA = '11111111-1111-4111-8111-111111111111'
const sessionB = '22222222-2222-4222-8222-222222222222'
const receipt = await issuePhotoReceipt(db, sessionA, 'image-a')
expect(await verifyPhotoReceipt(db, sessionB, 'image-a', receipt)).toBe(false)
expect(await verifyPhotoReceipt(db, sessionA, 'image-a', receipt)).toBe(true)
expect(loadSession(store)).toMatchObject({ version: 5, step: 'upload', analysis: null, price: null, needsPhotoReupload: true })
```
- [ ] **Step 2: Run** `cd apps/web && /opt/homebrew/bin/pnpm exec vitest run test/photo-receipts.test.ts test/estimate-session.test.ts test/routes.test.ts`; expect RED on absent receipt contract.
- [ ] **Step 3: Implement D1 receipt storage and upload.** Migration:
```sql
CREATE TABLE IF NOT EXISTS photo_receipts (
  receipt_hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS photo_receipts_expiry ON photo_receipts (expires_at);
```
Generate 32 random bytes with Web Crypto and encode base64url; store only `SHA-256` hex. Validate a UUID session ID and bounded image type/size before R2 write; if local D1 is missing, return a non-sensitive 503 rather than creating an unverifiable upload. Delete expired rows on later upload, not with a background job. Client creates a random session ID at draft creation and persists returned refs. v3/v4 migration preserves own-photo thumbnails/URLs but explicitly asks for re-upload; it never accepts legacy URLs as proof of linkage.
- [ ] **Step 4: Run focused tests and web typecheck** (`cd apps/web && /opt/homebrew/bin/pnpm typecheck`); expect PASS. Test one upload with fake R2/D1, not real photos or a live API.
- [ ] **Step 5: Commit** with `git commit -m 'feat(web): bind photo uploads to estimate sessions'`.

### Task 2: Verify links before reading bytes

**Files:** Create `apps/web/functions/api/_lib/photo-links.ts`, `apps/web/test/photo-links.test.ts`; modify `apps/web/functions/api/_routes/analyze.ts`, `apps/web/test/routes.test.ts`.

**Interfaces:**
```ts
export type PhotoLinkStatus = 'eligible' | 'unlinked' | 'unavailable'
export interface LinkedPhoto { url: string; status: PhotoLinkStatus; reason: string; image?: AiImage }
export async function resolvePhotoLinks(env: Bindings, requestUrl: string, sessionId: string, refs: PhotoRef[], sample: boolean): Promise<LinkedPhoto[]>
```
Keep input order. Only a same-origin `/api/images/<key>` URL with a valid receipt and existing R2 object is eligible for own photos. For sample sessions, only exact paths `/sample/living-room.jpg`, `/sample/bedroom.jpg`, `/sample/kitchen.jpg` on the request origin are eligible; fetch the server-constructed same-origin URL for one of those three bundled assets, never the user-supplied URL. Validate content type and bytes before the model call. Reject protocol-relative, alternate-host, credentials-in-URL and unexpected path forms. The URL is output identity only, never a fetch target. Do not log it.

- [ ] **Step 1: Write failing table tests** for valid receipt, wrong session/key/expired receipt, missing object, exact sample path, lookalike sample path, `https://other.example/...`, and a loopback URL with the wrong port. Example:
```ts
expect((await resolvePhotoLinks(env, 'http://127.0.0.1:5610/api/analyze', 'session-a', [{ url: 'https://other.example/a.jpg', receipt: 'x' }], false))[0]?.status).toBe('unlinked')
expect(fetchMock).not.toHaveBeenCalled()
```
- [ ] **Step 2: Run** `cd apps/web && /opt/homebrew/bin/pnpm exec vitest run test/photo-links.test.ts`; expect RED because resolver is absent.
- [ ] **Step 3: Implement the pure URL gate plus D1/R2 resolution.** Validate origin/path before decoding key, verify hash/session/key/expiry with Task 1 helper, then call `MOVERS_BUCKET.get(key)`. Return `unlinked` for untrusted references and `unavailable` for missing/undecodable bytes. Update route to use the resolver, removing arbitrary `fetch(url)` and URL/raw-response logging. Pass only `eligible` images to the vision stage; preserve exclusions in request order.
- [ ] **Step 4: Run focused route/link tests and typecheck**; expect PASS and no external fetch even with hostile URLs.
- [ ] **Step 5: Commit** with `git commit -m 'fix(web): validate photo linkage before analysis'`.

### Task 3: Request-aware per-photo assessment and cache identity

**Files:** Create `apps/web/functions/api/_lib/vision-assessment.ts`, `apps/web/test/vision-assessment.test.ts`; modify `apps/web/functions/api/_lib/prompts.ts`, `analysis-merge.ts` only if needed, `apps/web/functions/api/_routes/analyze.ts`, `apps/web/functions/api/_lib/sample-cache.ts`, `apps/web/test/routes.test.ts`, `apps/web/test/analysis-merge.test.ts`.

**Interfaces:**
```ts
export type PhotoVerdict = 'relevant' | 'unrelated' | 'uncertain'
export interface PhotoAssessment { url: string; status: PhotoVerdict | 'unlinked' | 'unavailable'; reason: string; candidates?: ModelAnalysis }
export interface VisionAssessment { analysis: ModelAnalysis; photos: PhotoAssessment[]; mode: AiMode; configRevision: number }
export async function assessPhotos(env: Bindings, linked: LinkedPhoto[], details: MoveDetails, sample: boolean): Promise<VisionAssessment>
```
The response includes all per-photo statuses but **never receipts, raw model text, image bytes, or private details**. `candidates` belongs only to uncertain photos and is not merged into confirmed inventory. `relevant` candidates are merged with existing `mergeAnalyses`. The prompt accepts confirmed details as data and asks for a strict verdict plus existing inventory fields; it excludes nonmoving objects in otherwise relevant rooms. Use a maximum of three concurrent photo calls. One invalid model reply gets one retry; a second invalid reply throws `AnalysisFormatError`, mapped to retryable 400 `ANALYSIS_FAILED`, not partial success. Provider failures surface non-sensitive 503 without mock fallback for an explicitly selected backend.

- [ ] **Step 1: Add failing fake-AI tests** for relevant/unrelated/uncertain photos, mixed ordering, only unrelated photos, malformed reply then retry success, repeated format failure, provider unavailable, three-call concurrency ceiling, and no raw response in logs. Example:
```ts
expect(result.photos.map((photo) => photo.status)).toEqual(['relevant', 'unrelated', 'uncertain'])
expect(result.analysis.items).toEqual([{ type: 'sofa', count: 1 }])
expect(result.photos[2]?.candidates?.items).toEqual([{ type: 'chair', count: 1 }])
```
- [ ] **Step 2: Run** `cd apps/web && /opt/homebrew/bin/pnpm exec vitest run test/vision-assessment.test.ts test/routes.test.ts`; expect RED on absent verdict contract.
- [ ] **Step 3: Implement the orchestrator** with a three-worker queue over eligible images, calling the companion plan's role-resolved `runVision` with one image per call. Parse a strict JSON envelope `{verdict,reason,inventory}`; reuse `parseModelAnalysis` for `inventory` when verdict is relevant/uncertain. Do not require inventory for unrelated. Retry one malformed envelope once. Wrap the existing deterministic mock inventory in an explicitly labelled offline `relevant` envelope for local development; it cannot establish relevance accuracy. When all photos are excluded or none yields movable inventory, throw `NoUsableInventoryError` and map it to 400 `NO_USABLE_PHOTOS` with a non-sensitive retry message. Add selected vision backend/model/revision, confirmed details, and canonical sample photo identities to the `withSampleCache` input; bump `SAMPLE_VERSION` to `v5`.
- [ ] **Step 4: Run focused tests, offline** `/opt/homebrew/bin/pnpm --filter @movers/web eval:vision`, and typecheck. Expect tests PASS; evaluator remains a historical static mock, not new model evidence.
- [ ] **Step 5: Commit** with `git commit -m 'feat(web): assess request-linked photos before review'`.

### Task 4: Review uncertain photos and confidence honestly

**Files:** Modify `apps/web/src/data/z-common/z-move-demo.ts`, `apps/web/src/data/types/move-demo.types.ts`, `apps/web/src/pages/estimate.page.tsx`, `apps/web/src/components/estimate/ReviewStep.tsx`, `apps/web/src/components/estimate/UploadStep.tsx`, `apps/web/src/lib/estimate-session.ts`, `apps/web/src/lib/api-client.ts`, `apps/web/functions/api/_lib/price-confidence.ts`, `apps/web/functions/api/_routes/price.ts`, `apps/web/functions/api/[[catchall]].ts`, `apps/web/test/estimate-session.test.ts`, `apps/web/test/price-confidence.test.ts`, `apps/web/test/routes.test.ts`.

**Interfaces:** `AnalysisResult.photoAssessments` contains sanitized statuses and uncertain candidate inventories; `EstimateSession.photoDecisions: Record<string,'keep'|'exclude'>` persists customer decisions keyed by exact photo identity. `ReviewCoverage.photoEvidence` is `{excludedCount:number, unresolvedCount:number}` with zero defaults for legacy clients; excludedCount includes unrelated/unavailable photos and customer-excluded uncertain photos. The server confidence ceiling is `low` when unresolvedCount > 0, at most `medium` when excludedCount > 0, and otherwise follows the existing coverage table. The UI cannot reach Confirm while any uncertain photo is unresolved. Persist the analysis configuration revision/fingerprint with the draft, expose a safe non-secret `GET /api/ai-status` revision endpoint, and compare the vision fingerprint (not the global revision) on Review/Estimate load and immediately before price; a mismatch clears analysis/price and routes to Photos for re-analysis. The price route also rejects a stale analysis fingerprint with 409 and never saves a lead on that path.

- [ ] **Step 1: Write failing UI/session/confidence tests.** A mixed response shows excluded reasons; an uncertain photo keeps candidates separate, blocks inventory editing/Confirm until Keep or Exclude, and survives refresh. Keep merges candidates by the existing canonical alias/count rule; Exclude discards them. Both invalidate price and estimate ID. Price confidence with an excluded photo cannot be high even if the user says whole move covered. Example:
```ts
expect(priceConfidence({ ...request, review: { ...request.review, photoEvidence: { excludedCount: 1, unresolvedCount: 0 } } }, 'high').level).toBe('medium')
expect(screen.getByRole('button', { name: 'Confirm and price it' })).toBeDisabled()
```
- [ ] **Step 2: Run** `cd apps/web && /opt/homebrew/bin/pnpm exec vitest run test/estimate-session.test.ts test/price-confidence.test.ts test/routes.test.ts`; expect RED on absent photo assessment/decision fields.
- [ ] **Step 3: Implement session/UI wiring.** The Photos action sends `sessionId`, `photoRefs`, confirmed `moveDetails` and `sample`; it never sends chat messages. Show skipped-photo reasons on Photos/Review. In Review, display uncertain decisions before inventory controls; after every uncertain photo is decided, derive the starting inventory from relevant analysis plus kept candidates using canonical aliases, then enable ordinary edits. Lock those decisions after ordinary inventory editing; going back to Photos/re-analyzing resets them. Persist decisions/status and reset analysis/price on photo or details change. Add `GET /api/ai-status` returning only `{visionRevision,visionFingerprint}` (no model/token); check it on Review/Estimate load and before pricing, invalidating a stale draft. The price route compares the analysis fingerprint to current vision settings, returns 409 `REANALYZE_REQUIRED` on mismatch, and performs no lead write. Include `photoEvidence` in the price request and render server-owned reasons. Do not claim the model proved full coverage.
- [ ] **Step 4: Run focused tests and root typecheck**; expect PASS.
- [ ] **Step 5: Commit** with `git commit -m 'feat(web): review photo relevance before pricing'`.

### Task 5: Integrated gates and isolated browser observation

**Files:** Modify only defects discovered in Tasks 1-4 and focused tests. Do not deploy or change production settings.

- [ ] **Step 1: Run** `/opt/homebrew/bin/pnpm typecheck && /opt/homebrew/bin/pnpm test && /opt/homebrew/bin/pnpm build` from the worktree root. Expect PASS across all packages.
- [ ] **Step 2: Run** `git diff --name-only -z --diff-filter=ACMR 0e5ec1d..HEAD -- apps/web | xargs -0 /opt/homebrew/bin/pnpm exec biome check`, `git diff --check 0e5ec1d..HEAD`, and `git grep -n $'\xe2\x80\x94' -- apps packages README.md`. The grep's exit 1 means zero matches; expect Biome zero errors on changed files, leaving unrelated full-web baseline lint debt distinct.
- [ ] **Step 3: Inspect the diff** for secret/receipt/customer data logging, external image fetch, false ownership claims, unsupported model IDs, silent mock fallback, stale cache identity and stale analysis/price. Record actual results. Use fake AI and local D1/R2 only; built-in Browser observation may inspect the local UI without clicking Analyse, Upload, Confirm/Price, or another write-producing control until separately approved.
