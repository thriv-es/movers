# Local completion design

The user approved these combined local-only defaults on 2026-11-16: candidate-bearing uncertain-only results enter gated Review; chat fills available viewport height with near-bottom auto-follow; the ten generated photos support offline mocked-AI E2E tests. Dev remains unchanged. No production operations or live Workers AI calls.

## Uncertain-only review

A batch with no relevant items but nonempty uncertain candidates succeeds with empty confirmed inventory and separate candidates. Review requires an explicit Keep/Exclude decision for every uncertain photo before ordinary edits or pricing. Keep uses the existing canonical merge and volume/box rules. If every candidate is excluded and no inventory remains, pricing stays blocked and the user returns to Photos or adds inventory explicitly through the existing editor. Unrelated-only, unavailable-only, and genuinely empty results retain NO_USABLE_PHOTOS. No unreviewed candidate is silently accepted. This supersedes the original plan's uncertain-only 400 behavior; it does not weaken receipt, privacy, retry, or stale-fingerprint boundaries.

## Chat

Step 1 uses available dynamic viewport height beneath existing header/progress UI. The transcript scrolls internally, while composer and action buttons remain reachable. The details summary stays accessible on desktop and mobile. Short-height/zoom layouts may use outer scrolling rather than clip controls. Auto-follow runs as content grows if the reader is near the bottom, including content changes within an existing message and the thinking indicator. Scrolling upward preserves the reader's position. Sending one's own message follows the latest turn. Respect reduced motion, clean up observers/listeners, and do not add simulated token streaming or change the chat API. Changes are scoped to ChatStep, estimator CSS, and new chat-specific tests; shared page logic remains owned by the uncertain-review task.

## Offline E2E

Use Playwright Chromium on a separate loopback-only test server, with synthetic move/contact data, disposable local D1/R2, and deterministic fake AI. Exercise real UI and real Hono route validation/upload receipts/review/price paths. The harness lives only in test files; no production debug endpoints or provider bypass are added. Block outgoing browser traffic except the test loopback origin and necessary data/blob resources. No real AI/token/account is used. The ten original MiniMax JPEG fixtures and manifest are retained unchanged; generation-intent labels are not ground truth or measured semantic accuracy. Fake verdicts must be clearly identified as scripted test outcomes, including uncertain-only, mixed exclusions, and provider/format failures.

Cover desktop/mobile chat viewport/auto-follow, all ten uploads across the corpus, session mismatch rejection, mixed relevant/unrelated/uncertain review, uncertain-only Keep/Exclude, empty inventory gating, stale fingerprint reanalysis, and malformed-response bounded failure. Use a single test worker/resettable isolated harness state for deterministic case isolation. Test-only setup may write disposable local state and synthetic leads; never remote resources. Runtime production code should not need changes for the harness.

## Gates and delivery

Each workstream has scoped RED/GREEN evidence and independent review. Then run root typecheck, tests, production build, changed-file Biome, whitespace scan, and offline E2E. Report warnings, test boundaries, and unmeasured model accuracy. The existing MOVERS-50 after-POST lead-save race remains separately deferred. No push or deployment follows automatically.
