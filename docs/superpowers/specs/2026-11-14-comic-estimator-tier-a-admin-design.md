# Comic estimator, Tier A customer flow and admin v1

Date: 2026-11-14. Status: approved by the user in chat, implementation in progress.

## Goal

Make the estimator (`apps/web`, port 4610) use the same design system as the landing
(`apps/landing`, port 4600), modernise its flow, build the Tier A backlog items
(MOVERS-7, 8, 11, 12, 15, 16, 23), add an admin v1 (leads, movers, quote requests)
backed by D1, test everything, and push a new `dev` branch to origin.

Decisions taken with the user:

- The estimator adopts the landing's comic design system; `:4610/` redirects to the landing.
- Admin v1 has no sign-in for now. Admin API routes and pages are disabled when
  `ENV === "production"` so nothing can leak if the app is deployed before auth lands.
- "Get quotes from movers" ships: the customer picks up to three signed-up movers; the
  outgoing email is logged to the server console, not sent (no email provider yet).
- Push target: create `dev` from `feat/monorepo-landing` and push it to origin.
- Out of scope: magic-link auth (MOVERS-36), plans and quotas (MOVERS-40), custom domains
  (MOVERS-41), per-company AI and prompt settings (MOVERS-42, 43), AI call log (MOVERS-44),
  multi-company estimators (MOVERS-35), self-provisioning (MOVERS-45), the Tier B items.

## 1. Shared design system: `packages/ui` (`@movers/ui`)

Plain CSS plus a few React components, no Tailwind, namespaced under `.mv` / `.mv-*` so it
can sit next to the landing's `.lp` rules and the estimator's remaining shadcn primitives.

- `src/tokens.css`: the palette (`--mv-ink #12121a`, `--mv-kraft #d8a866`, `--mv-paper
  #fff6e0`, `--mv-tape #e4572e`, `--mv-green #1f8b5d`, `--mv-sky #4fa8de`, light and dark
  kraft, `--mv-ink-soft`), border (`3px solid ink`), offset shadows (sm 4px, md 6px, lg
  10px), font stacks (display Bowlby One, body Fredoka Variable, caption Inter Variable),
  the halftone background, focus ring and selection colours.
- `src/components.css`: `.mv-page` (kraft page with halftone), `.mv-panel` (paper, ink
  border, offset shadow; modifiers `--ink`, `--kraft`, `--tilt-l/r`), `.mv-caption`
  (caption box; accents `--tape`, `--green`, `--sky`), `.mv-btn` (stamp button; `--primary`
  green, `--tape`, `--ghost`, `--sm`, `--block`), `.mv-field` with `.mv-input`,
  `.mv-select`, `.mv-textarea`, `.mv-badge` (`--green`, `--tape`, `--sky`, `--ink`),
  `.mv-tape` (packing-tape label), `.mv-stepper` (five numbered panels, done/active/
  upcoming, collapses to "Step n of 5" under 640 px), `.mv-table` (dense admin table),
  `.mv-bubble` (chat caption: assistant on paper, customer on tape), `.mv-progress`.
- `src/index.ts` exports `MoversMark`, `Panel`, `Caption`, `Button`, `Field`, `Badge`,
  `TapeLabel`, `Stepper`; every component renders the classes above and forwards props.
- The landing imports `@movers/ui/tokens.css` and `MoversMark` from the package and keeps
  its page-specific rules in `landing.css` (the `.lp` token block is replaced by aliases to
  the `--mv-*` tokens). Fonts stay installed per app via fontsource.

## 2. Estimator restyle (`apps/web`)

- `/` renders `RedirectToLanding`, which sends the browser to `VITE_LANDING_URL` (default
  `http://localhost:4600/`); the old `index.page.tsx` and the shadcn header/footer go.
- `RootLayout` becomes the comic shell: sticky masthead (MoversMark linking to the landing,
  "Get an estimate", GitHub link), the outlet, a one-line footer.
- `/estimate` keeps the step machine in `move-demo.page.tsx` (renamed `estimate.page.tsx`)
  but renders inside `.mv-page`: the `Stepper`, the active step in a `Panel`, stamp buttons,
  bubbles for the chat, a tape label for demo and sample modes, the price range in display
  type. Layout is mobile first at 360 px; single column; no horizontal scroll.
- The Radix dialog and toast stay and are restyled through the tokens (paper panel, ink
  border). The dark palette is no longer applied.

## 3. Tier A customer flow

Build order: 11, 7, 8, 23, 12, 15, 16. The flow becomes:
`chat → details → upload → review (items, edit, confirm) → estimate → schedule`.

### MOVERS-11 Structured move details
- `/api/chat` returns `{ reply, moveDetails, finished }`. `moveDetails` is produced by a
  second structured call (`generateObject`-style with Zod, falling back to a JSON block that
  the server parses and strips) and validated with `zMoveDetails`
  (`from`, `to`, `date`, `distanceMiles`, `originFloor`, `destinationFloor`,
  `originElevator`, `destinationElevator`, all nullable).
- Chat bubbles never contain JSON; the client has no regex over message text.
- `MoveDetailsStep` shows the collected values in an editable card; required fields
  (`from`, `to`, `distanceMiles`) block "Continue" with a message. "Fill in a form instead"
  on the chat step jumps straight to the card. The card's values are what `/api/price`
  receives.

### MOVERS-7 Re-price on edit
- Pricing leaves the upload step. `/api/price` is called when the inventory is confirmed,
  and again whenever the customer goes back and edits it (one call per confirmation).
- A "Calculating your estimate" state covers the Confirm → Estimate transition; a failed
  re-price shows an inline error with Retry and keeps the edited inventory.

### MOVERS-8 Price range
- `zPrice` gains `low` and `high` with `low <= total <= high`; the server derives them from
  confidence (high ±10 %, medium ±20 %, low ±30 %) and the mock does the same.
- Estimate headline is the range; the midpoint, a one-sentence non-binding notice visible
  without scrolling at 360 px, and a confidence line explaining what lowered it.

### MOVERS-23 Special items and unseen areas
- `zAnalysisResult` gains optional `specialHandling: {item, reason}[]`,
  `possibleDuplicates: {item, count}[]`, `unseenAreas: string[]`; the vision prompt asks
  for them; the API still validates when the model omits them; the mock returns examples.
- Review shows badges on flagged items, a "Did we count this twice?" merge for duplicates,
  and three yes/no follow-ups (garage or storage unit, full closets, large appliances)
  whose answers add boxes or line items before pricing. Special items appear as lines in
  the breakdown (the pricing prompt and the mock both add a surcharge line).

### MOVERS-12 Refresh and back
- `useEstimateSession` stores `{ version, step, messages, moveDetails, photoKeys, items,
  analysis, price, contact, sample }` in `sessionStorage`; a version mismatch discards
  the state. Nothing goes to `localStorage`.
- Every step after the first has Back; completed stepper panels are clickable; going back
  keeps later data until the customer changes something that invalidates it, and then
  asks before discarding. "Start over" clears the state.

### MOVERS-15 Phone upload
- Remove button always visible; "Take photo" (`capture="environment"`) and "Choose from
  library"; each file is decoded with `createImageBitmap`, downscaled to at most 1600 px on
  the long edge and encoded as JPEG (quality 0.82). HEIC that the browser cannot decode is
  rejected with "Open the photo in Photos, share it as JPEG, and try again".
- Object URLs are created once per file and revoked on removal; per-photo progress via
  XHR; errors are inline, no `alert()` anywhere in the flow.

### MOVERS-16 Sample move
- "Try with a sample move" on the chat step and `/estimate?sample=1`. Pre-filled details
  (2-bedroom flat, 3rd floor without elevator, 120 miles) and three bundled room photos in
  `apps/web/public/sample/` with `LICENSE.md` (generated for this repository).
- The client sends `sample: true`; `/api/analyze` and `/api/price` serve sample results from
  the Cache API (`caches.default`, key includes a sample version) and only call the models
  on a miss. Every step shows a "Sample move" tape label; "Use my own photos" resets.

## 4. Admin v1 (`/admin`)

### Data (D1 binding `MOVERS_DB`, migrations in `apps/web/migrations/`)
- `estimates`: `id` (22-char random), `created_at`, `source` (`own | sample`),
  `move_details` JSON, `items` JSON, `analysis` JSON, `price` JSON, `contact` JSON
  (name, email, phone, requested date) nullable, `status`
  (`new | contacted | quoted | won | lost`), `notes`, `updated_at`.
- `movers`: `id`, `name`, `slug`, `email`, `website`, `service_area`, `status`
  (`active | inactive`), `created_at`.
- `quote_requests`: `id`, `estimate_id`, `mover_id`, `note`, `status` (`logged | replied`),
  `created_at`.
- `scripts/dev-api.mjs` adds `--d1 MOVERS_DB` and applies migrations with
  `wrangler d1 migrations apply MOVERS_DB --local` before starting.

### Customer-facing API
- `POST /api/estimates` saves the estimate when the price arrives (anonymous lead) and
  returns `{ id }`; the client keeps the id in the session.
- `PATCH /api/estimates/:id/contact` attaches contact and requested date from the Schedule
  step; the response carries a reference (the id) and the demo note.
- `GET /api/movers` lists active movers (name, slug, service area) for the quote picker.
- `POST /api/quote-requests` takes `estimateId`, up to three `moverIds`, optional note;
  stores one row per mover and logs the email body to the server console.

### Admin API (`/api/admin/*`, disabled with 404 when `ENV === "production"`)
- `GET /api/admin/leads?status=` list, `GET /api/admin/leads/:id` detail,
  `PATCH /api/admin/leads/:id` (status, notes), `GET /api/admin/leads.csv`.
- `GET/POST /api/admin/movers`, `PATCH /api/admin/movers/:id`.
- `GET /api/admin/quote-requests`.

### Pages (`apps/web/src/pages/admin/*`, same comic design, `.mv-table`)
- `/admin` redirects to `/admin/leads`. Sidebar-less: a tab strip (Leads, Movers, Quote
  requests) under the masthead.
- Leads: table (date, from → to, distance, items, range, requested date, contact, source,
  status), status filter, CSV export, row click opens a detail panel with the inventory,
  breakdown, status select and notes.
- Movers: table plus an add/edit form (name, email, website, service area, status).
- Quote requests: table (date, lead, mover, note, status).
- The page shows a "Local admin, no sign-in" tape label so nobody mistakes it for a
  protected area.

## 5. Testing and delivery

- Vitest: schemas (`zMoveDetails`, `zPrice` range invariant, analysis extensions), routes
  in mock mode (chat structured output, price range, sample caching, estimates CRUD, admin
  guard in production), `useEstimateSession` versioning, image downscale helper.
- `pnpm smoke` covers chat, details, analyze, price, estimates, contact, movers, quote
  requests and the admin lists.
- Browser run: landing → estimator; the sample move end to end; own-photo flow with a
  refresh in the middle; each admin page; console clean, no 4xx/5xx.
- Root `typecheck`, `test`, `build` green; new files biome-clean; no em-dashes.
- Commits per sub-project on `feat/monorepo-landing`; then `git branch dev` and
  `git push -u origin dev`. Friday MOVERS-7, 8, 11, 12, 15, 16, 23 to In Review with notes;
  a new task for admin v1 linked to MOVERS-37/46; `http://localhost:4610/admin` opened in a
  new browser tab.
