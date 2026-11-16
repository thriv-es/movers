# Persistent Conversation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the wizard with a runnable persistent conversation and synchronized desktop/mobile data workspace.

**Architecture:** A versioned conversation session and pure validated action reducer own domain invariants. A persistent shell invokes explicit operation handlers and renders structured conversation cards. A separate conversational API returns validated proposals, never manufactured price/receipt/booking results. Existing receipt, vision, pricing and scheduling endpoints remain the authority.

**Tech Stack:** React/TypeScript, Hono, Zod, existing local D1/R2 and Workers AI adapter, Vitest, Playwright.

## Global Constraints

- Isolated worktree `/Volumes/SANDISK SSD/Thrives/Movers/.worktrees/estimate-accuracy`, `feat/estimate-accuracy`, baseline `8e2ef0e`. Local commits approved; no push, deploy, production or remote DB access, or live AI.
- Node 24, `/opt/homebrew/bin/pnpm`; relative imports under apps/web/test. Do not log secrets, receipts, URLs, customer/contact text or raw model output.
- Approved design: `docs/superpowers/specs/2026-11-16-conversation-flow-design.md`. User approved architecture and explicitly asked to start building; do not ask again for already-specified layout choices.
- Chat remains mounted through every operation. No Details navigation step; uploads only from composer. Desktop data alongside; mobile right drawer/latest hint.
- Preserve photo receipt checks, structural image validation, relevant/uncertain review, privacy sanitation, alias/count rules, confidence ceilings, server arithmetic, role settings and vision fingerprint checks.
- Mount/refresh/re-render never initiate price, lead, date or quote writes. Only explicit customer actions do. No server-side exactly-once guarantee is claimed; MOVERS-50 and inherited seeding race remain explicit unless actually fixed/tested.
- Tasks are sequential except Tasks 2 and 3 can run after Task 1 with disjoint file ownership. Never stage/discard another agent's WIP. Final root/E2E gates after integration.

---

### Task 1: Conversation state, typed proposals and v6 migration

**Files:** Create `apps/web/src/data/z-common/z-conversation.ts`, `apps/web/src/lib/conversation-state.ts`, `apps/web/src/lib/conversation-session.ts`; tests `apps/web/test/conversation-state.test.ts`, `conversation-session.test.ts`. Do not change the current page or old chat API yet.

**Interfaces:** Export `ConversationProposal`/`ConversationSnapshot` with Zod schemas from z-conversation.ts. Export `ConversationSession`, `ConversationAction`, `createConversationSession()`, `reduceConversation(state, action)`, `conversationReadiness(state)`, `conversationSnapshot(state)` from conversation-state.ts. Export `loadConversationSession(store?)`, `saveConversationSession(state, store?)` from conversation-session.ts. New session is version 6 on existing key `movers.estimate`; preserve valid existing sessionId and legacy domain fields. Legacy v3/v4/v5 loading uses the current migration helpers, but a saved v6 must be recognized before calling the legacy loader that rejects unknown versions.

Types must include revision, timeline, pending proposals/operations, duplicate resolutions, details confirmation and latest-update hint. Keep ordinary user/assistant prose distinct from structured timeline cards. Safe agent snapshots contain local photo IDs/statuses, never receipt tokens/URLs or bytes. Explicit null detail clearing is supported.

- [ ] Step 1: Write RED cases for v5 preservation, legacy re-upload preservation, fresh v6 reload, state/action revision matching, stale async result rejection, detail/photo invalidation, independent timeline events, duplicate persistence, unresolved/empty inventory pricing gates. Example:
```ts
expect(reduceConversation(state, {id:'edit-1', source:'panel', expectedRevision:state.revision, type:'details.patch', patch:{from:null}}).analysis).toBeNull()
expect(reduceConversation(state, staleAction)).toEqual(state)
expect(conversationSnapshot(state)).not.toHaveProperty('photoRefs')
```
Use actual typed payloads; define all exports before downstream tasks consume them.
- [ ] Step 2: Run `cd apps/web && /opt/homebrew/bin/pnpm exec vitest run test/conversation-state.test.ts test/conversation-session.test.ts`, capture RED before implementation.
- [ ] Step 3: Implement the reducer and migration. Allowed proposals cover details.patch; item add/count/remove; photo Keep/Exclude; duplicate same/different; garage/closets/appliances answer; whole-move coverage; and request-action hints for analyze/price/schedule/quotes. Proposed model actions never represent successful external operations. Internal actions cover attachments and operation started/succeeded/failed with expected revision and operation ID. Reject invalid payloads, stale actions and unrecognized references without mutation. Use existing review helpers/canonicalization rather than new volume constants. Stable action IDs cannot replay twice.
- [ ] Step 4: Run focused GREEN, root typecheck, changed-file Biome and whitespace. Commit `feat(web): add revisioned conversation state and draft migration`. Report exported shapes and exact files so Tasks 2/3 consume the same protocol.

### Task 2: First runnable persistent shell and explicit operations

**Files:** Create `src/components/conversation/ConversationShell.tsx`, `ConversationFeed.tsx`, `ConversationComposer.tsx`, `ConversationDataPanel.tsx`, `ConversationCards.tsx`, and `src/lib/useConversationController.ts` under apps/web. Modify `src/pages/estimate.page.tsx`, `src/style/estimator.css`, `src/lib/api-client.ts` for new client helper integration only, and legacy page-specific tests as necessary. Reuse domain helpers and existing controls without mounting auto-pricing EstimateStep. Tests: `test/conversation-flow.test.tsx`, adapt `test/estimate-session.test.ts` page assertions without dropping the prior safety cases. Do not edit backend conversational API or Task 3 protocol schema.

**Interfaces:** Consume Task 1 exports. Controller provides session, dispatch, sendMessage, uploadFiles, analyzePhotos, confirmPrice, submitContact, submitQuotes and explicit cancel/retry/status. The shell always renders the same composer/feed and data panel; no step-switch body.

- [ ] Step 1: RED tests must assert chat/composer remains present through details/photos/review/price/date; no Stepper/Details step; no POST on mount/re-render/reload; chat-only upload input; desktop data region and mobile drawer; failure keeps conversation; stale response cannot replace later edits. Example:
```ts
expect(screen.getByRole('log', {name:'Move conversation'})).toBeInTheDocument()
expect(screen.queryByRole('navigation', {name:'Progress'})).not.toBeInTheDocument()
expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/price'))).toHaveLength(0)
```
- [ ] Step 2: Run focused RED for new flow tests, then implement minimal shared shell using the existing mock chat route initially. At this milestone the app must be runnable, not a static mockup.
- [ ] Step 3: Port existing domain callbacks into controller handlers. Always preserve composer draft and transcript; route all data-panel edits through the reducer. Attachments use existing downscale/upload receipt API, progress and analysis. Missing/duplicate/uncertain questions render durable inline cards. Confirm-price explicitly checks fingerprint then calls price/save once; distinguish failures. Scheduling/contact and selected mover quote requests only run on explicit submit. Guard concurrent/replayed operations synchronously; reject stale results, show unknown interrupted writes on reload rather than re-posting. Retain human-confirmation gates.
- [ ] Step 4: Implement viewport grid/flex min-height:0 and internal overflow. Desktop >=860px shows both columns; mobile uses accessible modal right drawer with close/Escape/focus return and latest-accepted-update hint. Chat never unmounts. Test short height, long data and long transcript; preserve near-bottom auto-follow without outer-page scrolling. No second photo picker in data panel.
- [ ] Step 5: Run focused GREEN/typecheck/Biome/whitespace and affected legacy tests; commit `feat(web): run estimator in a persistent conversation shell`. Return a runnable milestone and exact retained/new test coverage. Do not claim typed agent orchestration complete before Task 3.

### Task 3: Stateful conversation API and validated agent proposals

**Files:** Create `apps/web/functions/api/_routes/conversation.ts`, `_lib/conversation-agent.ts`; modify Functions catchall registration; create focused `test/conversation-agent.test.ts`, `conversation-route.test.ts`. This task owns backend prompt/parser/mock additions and may add a separate `_lib/conversation-prompts.ts` without changing legacy chat behavior. Do not modify shell/page/controller, api-client.ts or Task 1 protocol while Task 2 edits them; send the parent any required protocol correction.

**Interfaces:** `POST /api/conversation` accepts `{messages, snapshot: ConversationSnapshot}` and returns `{reply, basedOnRevision, proposals: ConversationProposal[]}` with visible AI mode header. Legacy `/api/chat` remains compatible for old clients/tests; new controller's sendMessage uses the new endpoint once available. Snapshot and response validation use Task 1 schemas; response proposal IDs generated/validated safely, not interpreted from prose.

- [ ] Step 1: RED tests for state-aware next question, nonempty safe reply, proposal allowlist, explicit null patch, nonpositive counts, unknown item/photo references, stale basedOnRevision, malformed output bounded retry, no side-effect endpoints called, no receipt/URL/contact leakage from snapshots, sanitized provider failure. Include combined answers such as `from Tel Aviv to Raanana on 1.1.2027`: one validated patch sets separate origin/destination/date and the next question skips all known fields. Test current-state panel edits, contextually attached address fragments that preserve the known city, explicit corrections, ambiguous-fragment/date clarification without invented values, and no fabricated distance/floor/elevator/consent. Use fake AI, not live models.
- [ ] Step 2: Run focused RED; implement one role-resolved Chat-purpose call with current validated state supplied as data. The model can propose data changes/questions or suggest an action card, but cannot mark price/save/date/quote successful, infer confirmed ownership/coverage or fabricate IDs. Strip unknown fields and reject invalid proposal batches safely. One malformed reply retry maximum; repeated invalid output gives a safe retryable error and leaves state unchanged.
- [ ] Step 3: Add deterministic offline mock conversation behavior that respects current state and extracts supported synthetic detail/item answers rather than replaying the initial intake script forever. State-aware questions cover missing details, attachments, uncertain/missing/duplicate review, coverage, price and date/contact. Never call external APIs from the conversation route.
- [ ] Step 4: GREEN focused tests/typecheck/Biome/whitespace; commit `feat(web): add state-aware conversation proposals`. Report exact protocol and mock limitations to parent. Parent/Task 2 wires the existing client helper to this endpoint after integration.

### Task 4: Runnable preview readiness and continuous-flow browser regression

**Files:** Update `apps/web/e2e/fixtures.mjs`, `photos.spec.ts`, `chat.spec.ts`, `server.mjs` as required for the new conversation route/UI; add focused conversation browser cases. Update local preview startup helper/test if necessary so migrations are applied before ready (not a production startup migration). No changes to original 4600/4610/4611 processes.

- [ ] Step 1: Replace old form/step-entry helpers with actual chat and composer attachment interactions. Keep real local D1/R2 and real domain routes, scripted AI only. No fake API fulfillment or production test backdoor. Preserve original ten JPEG bytes/provenance.
- [ ] Step 2: RED browser cases: chat remains mounted from initial detail collection through all ten uploads, analysis/review/missing/duplicate questions, price/save/date/quote; both columns visible at917x987; long transcript/data independent scroll; mobile drawer focus/latest hint; no mount/reload duplicate POSTs; v5 migration; stale proposal and async result rejected; no old auto-save behavior.
- [ ] Step 3: GREEN all new and retained safety cases. Test fresh local runtime migrations before read/write endpoints; use synthetic records only in disposable test state. Report inherited mover seeding/lead races honestly rather than silently preseed away a claim of fresh-database health.
- [ ] Step 4: Root typecheck/tests/build, updated offline E2E, changed-file Biome/whitespace, independent scoped/final review. Record actual checks and limitations, not live model accuracy.
- [ ] Step 5: After first runnable shell passes focused gates, parent may switch the primary local5600landing/5610estimator to current code with AI_MODE=mock and applied local schema; preserve existing local data/state and old source checkpoint. Update cross-links together and label build identity. No public push or remote migration. Return exact current local URL and verified HTTP readiness.
