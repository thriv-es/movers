# Local Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the user-approved uncertain-only review, viewport-height chat and ten-photo offline E2E work without publishing.

**Architecture:** Preserve the current Hono/React app's receipt, privacy, pricing and fingerprint boundaries. Add one bounded review-flow correction, an independent chat layout/scroll change, and a test-only Playwright harness exercising real routes against disposable local services with fake AI. Keep their file ownership disjoint.

**Tech Stack:** TypeScript, React, Hono, Vitest, Playwright, existing Wrangler local runtime, pnpm/Node 24.

## Global Constraints

- Work only in `/Volumes/SANDISK SSD/Thrives/Movers/.worktrees/estimate-accuracy`, branch `feat/estimate-accuracy`. Local commits approved. No push, deployment, live Workers AI, production access or remote storage writes.
- Preserve stable preview ports 5600/5610 and original checkout ports 4600/4610/4611. Test harness uses loopback ports 5630/5631 only, with strict port binding and no existing-server reuse.
- No secrets, receipts, photo URLs, raw AI replies or actual customer data in logs. Use synthetic test details/contact data only.
- Tests in apps/web/test use relative imports. Do not change generated JPEG bytes or claim fake verdicts measure model accuracy.
- Ownership: Task 1 owns vision assessment, analyze route, shared response schema if needed, review helper/components/page and existing related tests. Task 2 owns ChatStep.tsx, estimator.css and new chat-specific helper/tests only. Task 3 owns apps/web/e2e/**, playwright.config.ts, package scripts/dependencies/lockfile, and Vitest exclude configuration only as required. Coordinate before crossing ownership.
- The accepted design is `docs/superpowers/specs/2026-11-16-local-completion-design.md`. Original uncertain-only 400 behavior is explicitly superseded only for nonempty candidates.

---

### Task 1: Candidate-bearing uncertain-only review

**Files:** Modify `apps/web/functions/api/_lib/vision-assessment.ts`, `_routes/analyze.ts`, `apps/web/src/lib/review-photos.ts`, `src/pages/estimate.page.tsx`, `src/components/estimate/ReviewStep.tsx` and shared schema only if necessary. Tests: `test/vision-assessment.test.ts`, `routes.test.ts`, `estimate-session.test.ts`, `price-confidence.test.ts` as affected.

**Interfaces:** Existing analysis has empty relevant `items` and separate `photoAssessments[].candidates`; no candidate is merged until all uncertain choices resolve. Existing vision fingerprint and evidence fields remain unchanged. Review must block pricing when accepted inventory is empty.

- [ ] Step 1: Add failing fake-AI and UI tests. Representative assertions:
```ts
expect(result.analysis.items).toEqual([])
expect(result.photos[0]?.status).toBe('uncertain')
expect(result.photos[0]?.candidates?.items.length).toBeGreaterThan(0)
expect(screen.getByRole('button', {name: /confirm and price/i})).toBeDisabled()
```
Cover one uncertain-only photo, Keep into normal pricing, Exclude to empty/no-price, unrelated/empty still 400, and persistence/fingerprint behavior.
- [ ] Step 2: Run focused RED: `cd apps/web && /opt/homebrew/bin/pnpm exec vitest run test/vision-assessment.test.ts test/routes.test.ts test/estimate-session.test.ts`.
- [ ] Step 3: Narrow the no-usable predicate and gate Review without inventing inventory:
```ts
const hasCandidates = photos.some((photo) => photo.status === 'uncertain' && (photo.candidates?.items.length ?? 0) > 0)
if (analysis.items.length === 0 && !hasCandidates) throw new NoUsableInventoryError(photos)
```
Use actual local names. Require an accepted item before pricing, retain all decision/freshness/privacy guards, and keep no-usable failure reasons.
- [ ] Step 4: Run focused GREEN, root typecheck, changed-file Biome and whitespace. Record exact RED/GREEN output. Commit only owned paths: `feat(web): review uncertain-only photo candidates`.

### Task 2: Viewport-height chat and natural follow

**Files:** Modify `apps/web/src/components/estimate/ChatStep.tsx`, `apps/web/src/style/estimator.css`; create `apps/web/test/chat-step.test.tsx`; create a focused chat-scroll helper/hook only if needed. Do not edit estimate.page.tsx or API code.

**Interfaces:** Existing ChatStep props and chatApi response shapes unchanged. Transcript should expose an accessible log identity usable by browser tests, and scroll only its own container.

- [ ] Step 1: Add failing Vitest cases with mocked element scroll metrics for bottom-follow, manual upward reading, growing final message, thinking indicator, own submit, reduced motion and cleanup. Example:
```ts
Object.defineProperties(log, {scrollHeight: {configurable: true, value: 1000}, clientHeight: {configurable: true, value: 300}})
log.scrollTop = 100
fireEvent.scroll(log)
// Rerender with incoming text: reader position must remain unchanged.
expect(log.scrollTop).toBe(100)
```
- [ ] Step 2: Run `cd apps/web && /opt/homebrew/bin/pnpm exec vitest run test/chat-step.test.tsx` for RED.
- [ ] Step 3: Replace one-time end scrolling with a near-bottom policy (`remaining <= 64` pixels), observing content size and message-content changes. Own submit resumes follow. Prefer container `scrollTo` over page `scrollIntoView`; respect reduced motion, remove listeners/observers. Replace 24rem cap with dynamic available-height flex/grid layout scoped to chat step, preserving mobile summary/access and short-height fallback. Do not add simulated token streaming.
- [ ] Step 4: Run focused GREEN, typecheck, changed-file Biome and whitespace. Commit only owned files: `feat(web): expand chat and follow incoming messages`.

### Task 3: Ten-photo offline browser E2E

**Files:** Create `apps/web/playwright.config.ts`, `apps/web/e2e/server.mjs`, `apps/web/e2e/fixtures.mjs` and focused `*.spec.ts` files; modify `apps/web/package.json`, `pnpm-lock.yaml`, `apps/web/vitest.config.ts` only if necessary to exclude e2e discovery. Keep production routes and normal Vite config unchanged.

**Interfaces:** `pnpm --filter @movers/web test:e2e` launches its own strict loopback harness. Existing source routes are loaded via Vite SSR into a test-only Hono app. Use existing Wrangler `getPlatformProxy` local D1/R2 with remote bindings disabled and ephemeral persistence, or an equally isolated direct local runtime; no provider credential reads. A fake Workers AI binding is attached only to the test Hono environment. Test-only scenario/reset controls must live only in e2e/server.mjs, never the deployed handler.

- [ ] Step 1: Add Playwright dev dependency using the existing package manager/lockfile. Detect Chromium availability; use supported installed browser or install Playwright Chromium locally if needed. Do not touch unrelated dependencies. Create strict server config, one worker, no remote baseURL/reuse:
```ts
export default defineConfig({testDir: './e2e', workers: 1, use: {baseURL: 'http://127.0.0.1:5630'}, webServer: {command: 'node e2e/server.mjs', url: 'http://127.0.0.1:5630', reuseExistingServer: false}})
```
- [ ] Step 2: Write browser tests and capture a real initial failure before completing harness/scenario implementation. Use ten exact fixture paths from `test/fixtures/minimax-photos/manifest.json`. For deterministic fake verdicts, capture uploaded test filenames/byte digests in harness-only middleware and return scripted inventory per fixture, independent of file-read order/concurrency. Label this as fake AI, not semantic ground truth.
- [ ] Step 3: Load actual API route modules through the existing Vite SSR pipeline; wrap only in test harness. Initialize local D1 from migrations 0001-0003, use local R2, fake AI and synthetic text replies. Reset each case; retain actual receipt/link/fingerprint/cache/price validation. Block external browser network. Throw if a test attempts a non-loopback URL. No production debug bypass.
- [ ] Step 4: Run browser cases covering all ten uploaded photos, mixed exclusions, uncertain-only Keep/Exclude, no-price after empty accepted inventory, wrong-session receipt rejection, stale fingerprint navigation, format retry, desktop/mobile chat and near-bottom preservation. Example browser assertions:
```ts
await expect(page.getByRole('button', {name: /confirm and price/i})).toBeDisabled()
await page.getByRole('button', {name: /keep/i}).first().click()
```
Select actual accessible identities from current UI. Wait for Tasks 1/2 commits before final assertions; don't weaken tests to old behavior. No real customer or live model calls.
- [ ] Step 5: Run E2E GREEN and root typecheck/tests/build plus changed-file Biome/whitespace. Provide exact case counts, browser version, byte-backed fixture usage, what routes are real vs mocked, cleanup behavior and limitations. Commit only test-owned files: `test(web): exercise ten-photo offline browser flows`.

### Task 4: Final integrated review

- [ ] Run all root gates plus offline E2E on the integrated branch. Keep warnings distinct from errors and baseline lint debt.
- [ ] Dispatch independent scoped reviews for each implementation and a final integration review. Fix concrete defects with covering tests; preserve source ownership.
- [ ] Report actual delivered behavior, local test commands, stable preview distinction, remaining MOVERS-50 limitation, and unchanged dev/no deployment. Do not infer approval to push from completion approval.
