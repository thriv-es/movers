# Persistent estimate conversation design

## Approval and goal

The user approved replacing the wizard with one always-mounted chat, desktop data/inventory alongside, mobile right-side data drawer with latest-update hint, chat-only uploads, and conversational details/review/pricing/scheduling. The user then asked to start building and see the app run. This specification records that approved direction; it does not authorize push, deployment, remote migrations or live model calls.

Baseline: `8e2ef0e` on the isolated `feat/estimate-accuracy` worktree. Preserve the ten synthetic fixtures, offline E2E harness, local Admin role settings, receipt checks, privacy sanitation and server-owned arithmetic.

## Runtime issue already diagnosed

The user's open tab was port 5610, serving the older checkpoint. Its D1 binding had no tables, causing movers and estimate routes to return 500. Local migrations 0001/0002 were applied there; movers now returns 200 and a nonexistent estimate lookup returns the expected 404. The user's POST was not replayed. New preview startup must apply required local migrations before reporting ready. The interface must identify the current build so old and current previews cannot be confused.

## Experience

- One estimator route and one conversation, not Chat/Details/Photos/Review/Estimate/Schedule pages. Internal readiness states may exist, but are not navigation steps and never unmount chat.
- Desktop: persistent chat left, live editable data panel right. Both have independent internal scrolling. Details, receipt-backed photo summaries, counted inventory, review answers, price and date-request result are visible from the data panel without leaving chat.
- Mobile: chat remains mounted. A compact latest-update hint opens a right-side drawer. Opening/closing the drawer preserves transcript, composer draft and pending work. Drawer closes with Escape/close control, restores focus, traps focus while modal and announces its label. The conversation remains visible behind the drawer; it is not replaced by another route.
- Use dynamic viewport/VisualViewport sizing, safe-area padding and min-height:0 at nested flex/grid boundaries. Composer and attachment controls remain reachable under a virtual keyboard. No transcript max-height cap, no auto-follow that moves the outer page or steals a reader's position. Keep the near-bottom follow policy and reduced-motion support.
- No standalone Details step. The agent asks for details; editable structured cards and the data panel show the same state. Explicit null/clear edits must be possible. A compact details confirmation precedes analysis.
- Attachments are selected only through the chat composer. Progress, previews, remove/re-upload, linkage failures and analysis controls appear in the conversation. The data panel may show photos but has no second upload control.
- Missing-item questions, possible duplicates, uncertain-photo Keep/Exclude and whole-move coverage are conversation cards/questions with durable answers, not separate review pages. Inline actions update the same inventory shown alongside. Uncertain candidates remain separate until explicitly accepted; no pricing with unresolved decisions or empty accepted inventory.
- Price is an inline result card and data-panel summary. Scheduling/contact and mover-quote controls are inline cards; the composer remains available. Scheduling is a date request, not a dispatched or guaranteed booking.

## Shared controller and events

Create a single validated controller used by conversational actions, inline controls and data-panel edits. Do not keep the old EstimateStep mounted: it auto-prices and auto-saves on mount, which is unsafe in a persistent layout.

Controller state includes a monotonically increasing data revision, existing estimate domain data, a durable timeline, pending proposals and operation status. Ordinary prose messages and structured events remain distinct. Every action carries an ID, source, expected revision and typed payload. Reject stale actions and ignore late async results for superseded revisions. Transcript-only status events do not invalidate domain evidence.

Required commands cover detail patches (including null), details confirmation, photo add/remove, explicit analysis, uncertain-photo decisions, item add/count/remove, duplicate same/different resolution, garage/closets/appliances answers, whole-move coverage, explicit pricing, contact/date request and mover quote request. Data-panel edits dispatch the same commands. Centralize the existing invalidation rules rather than shallow-merging arbitrary state.

- Details/photo changes invalidate analysis, decisions, inventory, price, estimate reference and dependent request state. Retain sanitized failure evidence only when still relevant.
- Review/inventory edits invalidate pricing and dependent references; keep the existing alias/count and accepted-candidate volume/box rules. Do not invent item-volume constants or approved rates.
- Persist duplicate resolutions and follow-up answers, so a refresh does not re-ask or double-add an answer.
- Vision fingerprint checks remain required before pricing, and results remain bound to the snapshot used by the request.
- Chat replies cannot overwrite edits made while a request was pending. The user can continue writing while operations run; conflicting actions are queued or rejected visibly, never silently applied to another revision.

## Agent contract

Extend the chat protocol with a validated current-state snapshot and typed proposed actions/questions. Preserve prose separately. Snapshot includes domain revision, confirmed details, safe photo IDs/statuses, accepted inventory, review gaps, safe pricing/status summary and readiness. Never send receipt tokens, bucket keys, arbitrary photo URLs or image bytes into the text context. Vision still receives confirmed details and linked images, not the chat transcript.

The agent may propose allowed detail/inventory/review changes and the next relevant question. The controller validates types, references and revision before showing/applying a proposal. It does not parse business actions from free prose. Unknown actions, impossible counts and stale references fail safely without mutation. Prices, lead IDs, analysis verdicts, receipt ownership and scheduling success can only come from the corresponding validated APIs, not model claims.

Low-risk detail edits extracted from the user's message may be applied through the shared validated dispatcher and visibly acknowledged. Ambiguous destructive inventory/photo changes require an inline confirmation. Explicit Keep/Exclude, duplicate resolution and coverage controls remain available even when the model fails or offline mock is used.

## Side effects and confirmations

Mounting, refreshing, opening the data panel, changing conversation phase or receiving model prose must never trigger price/save/date/quote side effects. The controller starts these only from explicit customer actions and disables duplicate pending submissions.

- `Confirm inventory and get estimate` checks readiness/fingerprint, then requests price and saves the synthetic/current estimate through existing endpoints. The UI distinguishes price failure from save failure. No invented price or success reference.
- `Request this date` validates name/email/phone/date and the current saved estimate reference before PATCH. Show returned request status/reference persistently, with no dispatch claim.
- `Send quote requests` requires explicit mover IDs/note confirmation. No automatically selected recipients, no submission on model proposal or re-render.
- Persist successful operation results. On refresh during an in-flight write, show an interrupted/unknown outcome rather than automatically resubmitting. Do not claim server-side exactly-once guarantees; the pre-existing MOVERS-50 after-POST stale-lead persistence race is not silently declared fixed by client revision guards.
- Do not log customer/contact data, receipt tokens, photo URLs, raw model output or email bodies in new/touched paths.

## Session migration

Introduce session version 6 while retaining the existing storage key and estimate session ID where valid. Migrate version 5 into a continuous conversation, preserving messages, confirmed details, valid photo refs/receipts, sanitized assessments, customer decisions, accepted inventory, review answers, valid price/reference/contact and sample provenance. Map the old step to a suggested conversation focus, not a route. Existing v3/v4 own-photo re-upload requirements and exact sample allowlist still apply.

Do not fabricate past confirmations or completed submissions. Add a single migration summary event if useful, then resume at the first unmet requirement. A legacy photo without a receipt remains blocked for analysis until re-uploaded or explicitly removed. Preserve old drafts and do not rewrite historical leads.

## Boundaries and implementation order

1. Shared state/actions, event model and v6 migration, with a pure reducer and invariant tests.
2. First runnable persistent shell and explicit API-operation executor, reusing validated APIs and domain helpers; desktop panel/mobile drawer/chat attachments.
3. Stateful agent contract, prompt/parser/mock and typed proposal handling; conversation-led review/pricing/schedule questions. This can run independently from shell layout once the shared protocol exists.
4. End-to-end continuous-flow regressions, startup readiness and final integrated review.

After the first runnable shell passes its gates, make the local landing/current estimator point to one current version. Preserve old source checkpoints, but do not leave the primary landing CTA pointing to the obsolete wizard. Apply migrations only to the chosen isolated local state and keep AI_MODE=mock. No original 4600/4610/4611 process or remote resource is changed.

## Acceptance

Real Chromium tests must cover persistent chat through details, all ten photo uploads, relevant/unrelated/uncertain decisions, missing/duplicate checks, price, contact/date request and quote flow; desktop chat/data visible together; mobile drawer focus/latest hint; long transcript and long inventory independent scroll at the user's 917x987 viewport as well as desktop/mobile/short-height cases; draft migration/reload; no mount-triggered POSTs; no repeated writes on rerender; stale replies/results; error retry preserving the conversation. Use real local routes/disposable D1/R2 with scripted AI and synthetic data, no hidden production test hooks. Keep model accuracy and physical-device keyboard limitations explicit.

Run root typecheck/tests/build, changed-file Biome/whitespace and the updated offline browser suite. Independent reviews are per bounded task plus final integration. Do not claim a test count establishes unrestricted runtime health; inherited mover-seeding and lead-save races remain separately visible unless a dedicated fix and regression actually resolves them.
