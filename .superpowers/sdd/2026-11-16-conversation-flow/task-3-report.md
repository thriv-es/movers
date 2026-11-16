# Task 3 — Stateful conversation API

## Result and checkpoint

Implemented the bounded backend deliverable on `feat/estimate-accuracy` in `/Volumes/SANDISK SSD/Thrives/Movers/.worktrees/estimate-accuracy`.

- Baseline: `895607d33621931ea46ab8dbd8f323a65377c9ca`.
- Implementation commit: **`a312e9d8cb539c9174eb065630f898a58612896b`** — `feat(web): add state-aware conversation proposals`.
- This report is a subsequent documentation-only commit; use the implementation SHA above for code review.
- No Task 1 schema/state, frontend/controller/api-client, legacy chat/mock, E2E, build output, preview process/state, migrations or remote resources were modified. No push, deployment, live AI or remote database call was made.
- The screenshot intake defect is covered at the new backend boundary, **not yet claimed fixed in the running UI**. Parent owns frontend wiring and browser regression verification.

## Files and responsibilities

| File | Change |
| --- | --- |
| `apps/web/functions/api/_routes/conversation.ts:10` | New POST handler, safe request errors, frozen Chat-role resolution, actual mode header, bounded malformed-output retry and sanitized provider errors. |
| `apps/web/functions/api/_lib/conversation-agent.ts:16` | Strict snapshot ingress using Task 1 schema; bounded request/response schemas; proposal parsing, revision/reference/batch validation, opaque server IDs; deterministic state-aware mock. |
| `apps/web/functions/api/_lib/conversation-prompts.ts:4` | Separate new prompt; current snapshot and transcript encoded as untrusted JSON data; supported commands, current-state precedence, extraction/clarification and no-side-effects instructions. |
| `apps/web/functions/api/[[catchall]].ts:19` | Registers `/api/conversation`; `/api/chat` remains registered and unchanged. |
| `apps/web/test/conversation-agent.test.ts:36` | 50 focused extraction, next-question, privacy and proposal-boundary tests. |
| `apps/web/test/conversation-route.test.ts:41` | 8 route tests using the real AI client with safe fake binding or real offline mode, including legacy compatibility. |
| `.superpowers/sdd/2026-11-16-conversation-flow/task-3-report.md` | This requested handoff. |

## Exact runtime protocol

### Request

`POST /api/conversation`, JSON body **exactly** `{ messages, snapshot }`.

- `messages`: Task 1-compatible chat messages `{id,role:'user'|'assistant',content}`; no system/tool roles or unknown message fields. At most 200 messages, 12,000 characters per content, 128 per message ID.
- `snapshot`: Task 1 `ConversationSnapshot`, version 6, nonnegative safe-integer revision. Domain text is input data, not instructions or evidence of authorization.
- Request body is rejected above 128,000 characters after reading it. This is not a streaming byte limit or rate-limiting implementation.
- Unknown fields are **rejected**, not forwarded. Nested move details, follow-up objects and estimated-box objects are tightened to strict validation at this ingress; all existing strict snapshot objects remain strict. Duplicate photo IDs are rejected. The actual prompt is built only from `parsed.data`.
- No extra legacy `moveDetails` top-level field: the existing adapter must remove that when switching endpoints.
- Invalid JSON/request/snapshot: HTTP 400 `{error:'Invalid conversation request',retryable:false}`. No validation issues or private values are reflected.

### Response

HTTP 200:

```ts
{
  reply: string,
  basedOnRevision: number,
  proposals: Array<{
    id: string,
    expectedRevision: number,
    command: ConversationCommand
  }>
}
```

- Exported backend-local validators/types: `zConversationRequest`, `zConversationResponse`, `ConversationResponse`; reusable parser `parseConversationTurn` and offline helper `mockConversationTurn`. No barrel or shared protocol file was changed.
- `reply` is separate prose, trimmed, nonempty, at most 3,000 characters. The filter rejects links/data URLs, markup/fences, JSON-object snippets, unsafe control characters and common explicit price/reference/receipt/booking-success assertions. This is a conservative English heuristic, **not a semantic guarantee that arbitrary model prose can never hallucinate**. Prose never authorizes mutations or writes.
- `basedOnRevision` and every proposal's `expectedRevision` must exactly equal the request snapshot revision. The route is stateless: it does not load a server conversation or know about edits made after the captured request. The controller must retain its existing late-response revision guard.
- At most 12 proposals; strict Task 1 command/proposal envelopes. No `finished`, whole `moveDetails` result, price object, receipt, saved/booking reference or success result is accepted.
- Allowed commands are exactly `details.patch`, `item.add`, `item.count`, `item.remove`, `photo.decide`, `duplicate.resolve`, `followUp.answer`, `coverage.answer`, `request.action`.
- A details patch must be nonempty, only supported fields, explicit null allowed, omission preserved. Proposed non-null dates additionally must be real ISO `YYYY-MM-DD` dates. This is a local server validation refinement, not a Task 1 schema edit.
- Counts are positive integers through 10,000; count zero is not removal. Item additions also cannot make the current canonical aggregate exceed 10,000.
- Item count/remove references require an existing current inventory label using the existing `canonicalItemType` (`couch` aliases to `sofa`; no new pluralization/alias table). New item labels are allowed for `item.add`.
- Photo decisions require the exact current local ID of an `uncertain` photo. Other current photos are not valid decision references. No URL/receipt can serve as a photo ID.
- Duplicate resolution requires a current inventory item, a matching current pending duplicate, and no current resolution for that canonical label.
- IDs supplied by the model must first pass Task 1 local-ID syntax, be unique within the batch and not contain URLs. They are then **replaced with fresh `proposal-${crypto.randomUUID()}` server IDs**. Returned IDs are opaque proposal IDs, never operation/success/lead/receipt IDs. Retries/new requests produce new IDs.
- Duplicate target operations are rejected: only one details patch, one operation per canonical item, one per photo, one per follow-up key and one coverage/action command per batch. One invalid member rejects the whole batch; no valid prefix escapes.
- Task 1 reducer still performs the final current-state eligibility check, including review locks, readiness and stale proposal rejection. The safe snapshot does not expose every internal reducer lock; backend validation is not an alternative to reducer validation.

### AI mode, retry and privacy

- The handler calls `resolveRole(env,'chat')` once. Both the initial `runText(...,'chat',role)` and at most one malformed-output retry use that same resolved selection/revision. No pricing/vision purpose is substituted.
- Successful responses and failures after role resolution carry `x-movers-ai-mode`; the result's actual mode replaces the initial selection, including an existing development mock fallback. Pre-validation or role-resolution failures do not invent an actual model mode.
- Validated requests receive `Cache-Control: no-store`.
- Only malformed returned output retries. The retry receives the original validated data plus a generic correction instruction; neither raw model output nor detailed validation failures are echoed into the prompt.
- A second malformed output, unavailable role/backend, or provider failure returns HTTP 502 exactly `{error:'Conversation unavailable. Please retry.',retryable:true}`, without partial proposals. Provider errors do not retry. An empty binding result rejected by the existing shared AI client is treated as a provider failure, not reparsed or retried by this route.
- No new handler/helper logs request text, customer/contact text, photo URLs, receipts, bucket keys, bytes, secrets, model output or exceptions. The shared client's existing generic development fallback warning contains no request/model payload and is unchanged.
- Snapshot contact/ref/receipt/URL/bytes fields fail before any AI call. The normal text transcript still contains whatever the customer explicitly typed; it is intentionally supplied as untrusted conversation data, never logged. This change does not claim PII redaction of customer-authored messages.
- New route imports no domain side-effect route/store/executor and calls no analysis, price, save, date or quote endpoint. The existing Chat-role settings lookup may read local settings via D1; it performs no domain write. `request.action` is only a suggested control, even if the customer asks for an action in prose.

## Offline extraction and state-aware behavior

The offline mock is separate from legacy `_lib/mock.ts`; it is not indexed by message number and only the latest message, if user-authored, can propose new values. Older user answers cannot repopulate fields changed in the supplied panel snapshot. An immediately preceding assistant question is used only for explicit contextual short answers.

Covered synthetic behavior:

- `from Tel Aviv to Raanana on 1.1.2027` gives **one** details patch `{from:'Tel Aviv',to:'Raanana',date:'2027-01-01'}` and asks for distance, not origin/destination/date again.
- Combined from/to without a date and supported out-of-order date/to/from answers are parsed independently of question position.
- Explicit `from Haifa` corrections replace a known origin; `clear`/`forget` supported detail names produce null rather than omission.
- Explicit miles, side-labelled positive floors and side-labelled yes/no elevators are extracted. Bare numeric floor/distance and yes/no elevator responses require the corresponding specific current question. Negative miles and decimal floors are not coerced into invented valid values. Ground-floor encoding is not guessed because the existing protocol accepts positive floors only.
- City-only known locations are retained when a later street fragment names its side or answers a one-side address question. A comma-separated existing address can retain its final city segment. Unidentified side asks origin/destination. An existing street address with no safely separable city asks for a full city/address rather than dropping or guessing the city.
- ISO calendar dates are validated. Numeric dotted/slashed dates are normalized only when the two components are equal or one exceeds 12, making month/day order unambiguous. Invalid dates or two plausible dates ask a targeted ISO clarification; independently valid locations still appear in the same one patch.
- Named item add/count/remove proposals, exact uncertain-photo Keep/Exclude, pending duplicate same/different, explicit garage/closets/appliances answers and whole-move coverage are supported. A yes/no answer to the corresponding generated review question is contextual, not a general confirmation. `remove it` asks which named item and produces no destructive proposal.
- Explicit action phrases suggest analyze/price/schedule/quotes cards only. No details-confirm command exists in the proposal allowlist; even a contextual `yes` does not fabricate confirmation.
- Next question uses current details plus proposed changes, then details-confirm UI, chat attachments/link repair, explicit analysis, uncertain-photo choices, missing inventory, duplicate review, missing-item follow-ups, whole-move coverage, estimate/save, contact/date request and quote-recipient controls. Item/review edits project old price/dependent-result invalidation for question selection. Original snapshot is not mutated.

Limitations deliberately retained:

- This is a bounded **English synthetic grammar**, not unrestricted language understanding. It does not claim Hebrew/multilingual support, geocoding, address ownership, regional date inference, relative dates, unit conversion, city-distance inference or model accuracy.
- Supported location labels are `from`, `to`, `origin address`, `destination address`; supported combinations/delimiters are exercised by tests. Arbitrary paraphrases or multiple conflicting corrections may need clarification or explicit panel controls. No frontend regex workaround was added.
- City segmentation is conservative and is not a postal-address parser. Complex existing comma-separated region formats may need a full explicit location edit.
- Existing canonical aliases are reused. `chairs` remains `chairs`; this task intentionally did not invent a singularization table or item-volume constants.
- A mixed details-plus-review answer currently proposes supported details first; complex multi-intent review/item sentences are outside this mock grammar. Named controls remain the reliable path for such edits.
- The safe snapshot intentionally excludes uncertain candidate inventories. The mock does not invent accepted inventory/volume/boxes when a Keep proposal would later let the reducer compute them; the next request's fresh snapshot supplies the real result.
- No real-model accuracy, prompt-injection immunity, real browser summary update, integrated E2E or physical keyboard behavior is established by these unit/route tests.

## RED / GREEN and validation evidence

All commands ran from the isolated worktree above using active Node `v24.18.0` and `/opt/homebrew/bin/pnpm`. All test imports are relative. Fake binding outputs and synthetic state were used; no live model was called.

### Focused test command (same exact command for each cycle)

```sh
/opt/homebrew/bin/pnpm --filter @movers/web test test/conversation-agent.test.ts test/conversation-route.test.ts
```

Observed sequence:

1. Initial missing-feature RED: exit 1, 2 suites could not load the not-yet-created agent/route modules, zero collected tests. This is recorded separately, **not** counted as behavioral RED.
2. Minimal compiling stub behavioral RED: exit 1; **22 failed, 22 passed, 44 total**, 2 failed files. Combined extraction returned no proposal, current-state question repeated origin, nested-private snapshot fields passed, parser unimplemented, and route returned 501. Legacy compatibility already passed.
3. Initial implementation: exit 1; **2 failed, 42 passed, 44 total**. Corrected two test-fixture assumptions, not business requirements: saved role models must belong to the existing catalog (the initial synthetic model strings were invalid), and existing aliases do not singularize `chairs`. No shared alias/model code was changed.
4. Initial GREEN: exit 0; **44 passed**, 2 files.
5. Additional short-answer/city-retention/prose-safety RED: exit 1; **7 failed, 45 passed, 52 total**. Fixed contextual short answers, ambiguous existing city preservation and conservative unsafe-prose rejection.
6. GREEN: exit 0; **52 passed**, 2 files.
7. Numeric/date/count boundary RED: exit 1; **5 failed, 52 passed, 57 total**. Negative miles/decimal floors had been coerced; model invalid/non-ISO dates and aggregate item overflow had passed. Fixed all five conditions.
8. GREEN: exit 0; **57 passed**, 2 files.
9. Proposed inventory next-question RED: exit 1; **1 failed, 57 passed, 58 total**. Proposed addition was not reflected in next-question selection. Added clone-only item projection and projected price/result invalidation.
10. Final GREEN after formatting: exit 0; **58 passed** (agent 50 + route 8), **2 passed files**, duration 557 ms.

### Typecheck, formatting, whitespace and root tests

```sh
/opt/homebrew/bin/pnpm typecheck
```

- First implementation typecheck: exit 2, 22 new `noUncheckedIndexedAccess` errors in regex/split extraction. Resolved with explicit checked/defaulted components, not a protocol change or disabled checking.
- Final root typecheck: **exit 0**, UI, landing and web (including Functions) all completed.

Scoped formatting/check commands:

```sh
/opt/homebrew/bin/pnpm exec biome check --write 'apps/web/functions/api/[[catchall]].ts' apps/web/functions/api/_lib/conversation-agent.ts apps/web/functions/api/_lib/conversation-prompts.ts apps/web/functions/api/_routes/conversation.ts apps/web/test/conversation-agent.test.ts apps/web/test/conversation-route.test.ts
/opt/homebrew/bin/pnpm exec biome check 'apps/web/functions/api/[[catchall]].ts' apps/web/functions/api/_lib/conversation-agent.ts apps/web/functions/api/_lib/conversation-prompts.ts apps/web/functions/api/_routes/conversation.ts apps/web/test/conversation-agent.test.ts apps/web/test/conversation-route.test.ts
git diff --check
git diff --cached --check
```

- First scoped autoformat reported 7 lint errors: an unnecessary export from a test and six control-character-regex findings. Removed the export and changed the safety check to explicit character-code validation; no lint suppression added.
- Final autoformat: exit 0, 6 checked files, 1 final test-file format fix.
- Final no-write scoped Biome: **exit 0, 6 checked files, no fixes applied**.
- Final working-tree and staged whitespace checks: **exit 0**, no findings.

Exactly one final root suite invocation:

```sh
/opt/homebrew/bin/pnpm test
```

**Exit 0:** UI 9/9 (1 file), landing 9/9 (1 file), web 496/496 (31 files), **514 total tests across 33 files**. Web duration 5.48 s. Root output included the unchanged `test/example.test.tsx` jsdom `Not implemented: navigation (except hash changes)` stderr; that test passed. Focused tests emitted no such warning. No root test rerun was performed.

No build or E2E was run, in accordance with this backend-only assignment and the prohibition on build/preview alteration.

## Parent frontend integration instructions

1. Update only the existing conversation adapter/controller integration in the parent-owned files. Send POST `/api/conversation` with `{messages,snapshot}`; remove the legacy extra top-level `moveDetails` field. Legacy `/api/chat` is still available unchanged for other clients/tests.
2. Validate `{reply,basedOnRevision,proposals}` using a frontend-safe response schema built from the existing Task 1 revision/proposal schemas. Do not import the Functions helper into frontend production code just to obtain the response type: it includes backend mock/parser code. The backend exports above document the exact shape; a shared response export can be proposed separately if needed.
3. Retain the revision captured before send. Reject the response if `basedOnRevision` differs from it or the controller has moved to a different revision while the request was in flight. Never stamp the latest revision onto a late response/proposal.
4. Append reply prose separately from structured actions, and add proposals through the existing agent-origin `proposal.add` envelope. Returned server IDs are proposal IDs. Generate separate action-envelope IDs for proposal add/apply/dismiss; do not reuse proposal IDs as operation results.
5. A combined answer is intentionally **one** details patch with all fields. If the parent implements the approved visibly acknowledged low-risk detail application, do so through the existing user-origin validated dispatcher, with one patch at its captured revision, not by merging reply prose or separately applying each field.
6. Destructive inventory/photo edits remain pending until explicit inline/customer confirmation. Adding a proposal does not mutate the domain. Applying a `request.action` proposal is only a hint and **must not trigger a network operation**. Existing explicit controls/executor remain the only analysis/price/save/date/quote entry points.
7. Multiple proposals all target the captured revision. Applying one domain-changing proposal increments revision and can stale the remainder. Do not silently rebase them; refresh/re-ask or use existing visible acceptance rules. The combined intake case avoids this issue by design through its single details patch.
8. Preserve retry UI/composer/state for 502 `{retryable:true}`. Respect actual `x-movers-ai-mode` for the demo badge. No response supplies `finished`, `moveDetails`, success refs or a price result.
9. Browser verification still required: send the exact combined answer, apply it through the controller, verify separate From/To/ISO date in What we know so far and that the next question asks only missing details; then exercise panel edits and later contextual address corrections. Task 3 tests alone do not establish that user-visible integration.

## Self-review, assumptions and remaining risks

- Read the task brief, regression notes, approved design, Task 1 interface report excerpt, Task 2 wiring excerpt and relevant source conventions; did not read the whole implementation plan.
- Self-reviewed request projection, strict output allowlist, current-reference/revision gates, generated IDs, whole-batch failure, one retry, explicit-null behavior, mock state precedence, no-side-effect import/call path and error/log sanitation. Added RED/GREEN cases for concrete defects found during that review rather than expanding frontend/domain scope.
- Mutation check: removing revision/reference validation breaks boundary tests; removing patch aggregation breaks combined-answer tests; replaying transcript/nth-message assignment breaks panel-state tests; dropping city or guessing ambiguous dates breaks clarification tests; executing action hints breaks the forbidden-fetch test; logging provider errors breaks no-log assertions; retrying indefinitely or echoing invalid text breaks bounded-retry tests.
- Assumption: supplied snapshot is the client's validated public projection, not server authorization. Snapshot validation rejects hidden fields but cannot prove a client-supplied price/readiness value is authentic. No such value authorizes a backend write here; trusted domain APIs/controller validation remain required.
- Assumption: runtime provides Web Crypto UUIDs, as used elsewhere in the project and in the Node 24/Workers targets.
- No necessary Task 1 protocol correction was identified or made. Ingress strictness and real-ISO proposed-date validation are local server refinements of the existing fields.
- Remaining integration work: parent adapter/controller wiring, independent API review, and Task 4 browser/E2E. Existing lead-save/mover-seeding races and unrelated runtime behavior are not claimed fixed.
- Model prose filtering is intentionally defensive but cannot establish semantic truth; proposal types/revisions/references and the separate explicit executor are the actual side-effect boundary.
- **Blockers: none for this bounded backend deliverable.**

## Fix round 1/5 — unsupported result prose and full-address correction

### Checkpoint and scope

- Review baseline: `39bfd5a386a9159ed48af28a90770fe0fff81cf1`.
- Fix implementation commit: **`adead1b25949d67c539a2ed0b78fc065a0690772`** — `fix(web): render safe conversation guidance and replace complete addresses`.
- This appended section supersedes the original report's heuristic prose-blacklist policy and its address-replacement description. The earlier evidence remains recorded as history, not as the current prose-safety guarantee.
- Changed only the owned backend agent/prompts/route and the two owned test files; this tracked report is the documentation-only follow-up. No frontend, Task 1 schema/state, legacy chat/mock, catchall, E2E, build/preview state/process, remote resource, live AI, push or deployment change.

### Finding 1: visible prose is now server-authored

The review demonstrated that sentence blacklisting was not a sound boundary: syntactically valid model replies asserted booking/quote success and amounts through unlisted paraphrases. The fix **removes the semantic claim blacklist rather than expanding it**.

Current intentional policy:

1. The model still returns a bounded nonempty `reply` field for model-envelope shape compatibility. Its existing syntactic checks (length, control characters, links/data URLs, markup/fences and JSON snippets) remain. The server **never returns this raw model reply**, regardless of whether it sounds safe, helpful, true or false. It is not logged or echoed on retry.
2. `parseConversationTurn(text,snapshot,messages?)` now validates the entire model batch first, then calls the private shared server renderer and constructs a fresh `{reply,basedOnRevision,proposals}` object. The actual route supplies the validated messages; callers omitting messages get current-state template guidance without contextual clarification.
3. The private renderer uses the current validated snapshot, the validated typed commands and the latest user/question context. Both real and offline modes use it. Existing clone-only proposed-edit projection and price/dependent-result invalidation are reused for next-question selection. No operation executes or becomes successful through this projection.
4. The normal visible reply is one of the server-authored missing-detail, confirmation, attachment/link-repair, analysis, photo-review, inventory/duplicate/follow-up/coverage, price/save-control, date/contact-control or quote-control guidance templates. The route does **not** narrate a model-supplied amount, saved reference, scheduled/booked move, sent request, payment or dispatch. Existing price/date/quote result cards remain the authoritative domain-result display.
5. To preserve genuine model-detected ambiguity without accepting free text, the **internal model output only** may add `clarification: 'date' | 'address_side' | 'address_city' | 'item' | 'photo'`. These values select fixed questions about ISO date, origin versus destination, complete address/city, a named inventory item, or an uncertain-photo review control. Unknown selectors fail the normal bounded malformed-output path. No selector authorizes an action or claims success.
6. Local deterministic ambiguity detection has precedence over the optional model selector, then ordinary current-state guidance is used. Date/address ambiguity continues to work when the model supplies no selector or supplies unrelated prose.
7. `clarification` is **not** part of the client response or Task 1 protocol. It is consumed internally and omitted from the fresh response. External request/response fields, proposal IDs, revisions/references, atomic batch rejection, retry bounds, mode header and error behavior remain unchanged. No frontend wiring change is needed beyond the original Task 3 instructions.
8. Visible duplicate guidance no longer interpolates the free-text inventory label. It refers to the items shown in the review controls, preventing a malicious or mistaken item label from turning into result prose. Other dynamic template parts are only existing validated local photo IDs and enum follow-up keys, not arbitrary domain/model text.
9. The final server-authored object is validated again with `zConversationResponse`. Raw model claim variants may now produce HTTP 200 **with safe server guidance and validated proposals**, instead of either displaying the claim or rejecting a batch solely because of a semantic phrase match. Existing syntactically malformed output can still retry/fail normally.

Relevant source: `apps/web/functions/api/_lib/conversation-agent.ts:62` (typed clarification mapping), `:103` (parser/fresh response), `:409` (shared server renderer); `apps/web/functions/api/_routes/conversation.ts:38` supplies message context. The prompt documents ignored raw prose and the typed selector in `apps/web/functions/api/_lib/conversation-prompts.ts`.

### Finding 2: explicit complete locations replace old cities

`addressWithCity` now classifies a comma-delimited alphabetic city component (excluding apartment/unit/floor labels) as an explicit complete address replacement before considering known-city preservation.

- With origin `Tel Aviv`, `origin address: 9 Oak Street, Haifa` proposes exactly `{from:'9 Oak Street, Haifa'}`.
- With origin `Tel Aviv`, `actually from 12 Main Street, Haifa` proposes exactly `{from:'12 Main Street, Haifa'}`.
- A complete `9 Oak Street, Haifa` response to a one-side destination-address question replaces `Raanana`; it does not append it.
- A genuinely city-less fragment such as `origin address: 9 Oak Street` or the existing contextual `12 Herzl Street` case still retains the known city.
- An explicitly marked correction without an identifiable city, such as `actually from 12 Main Street`, asks for city clarification rather than treating the old city as implicitly confirmed.
- An apparent unseparated new city after a street suffix, such as `origin address: 12 Main Street Haifa`, is ambiguous and asks for a complete city/address instead of appending `Tel Aviv`.
- The model prompt receives the same replacement-versus-fragment instructions and both exact full-address regression examples. No address ownership, geocoding, distance, floor, elevator or confirmation inference was introduced.

Relevant source: `apps/web/functions/api/_lib/conversation-agent.ts:181` and the bounded extraction caller.

### Behavioral RED/GREEN and exact commands

All commands below ran from the same isolated worktree on Node 24 using `/opt/homebrew/bin/pnpm`. Tests use synthetic snapshots, offline mode or fake AI bindings; no live model call.

Test files changed:

- `apps/web/test/conversation-agent.test.ts`: exact two full-origin replacements, contextual destination replacement, retained city-less fragment versus ambiguous correction, ignored reference/price/receipt prose and rejection of an unknown model-only clarification selector. Existing combined-answer, state precedence, targeted clarification and reference/revision tests remain.
- `apps/web/test/conversation-route.test.ts`: nine fake-binding model claim variants covering booking, quote completion, numeric and written amounts, mover arrival, saved lead, payment and recipient notifications; current-state guidance instead of a repeated model question; local and typed-model targeted clarifications; later price/save/date/quote states; and no free-text inventory-label interpolation into prose.

Exact focused command:

```sh
/opt/homebrew/bin/pnpm --filter @movers/web test test/conversation-agent.test.ts test/conversation-route.test.ts
```

Observed results:

- Behavioral **RED**, exit 1: **18 failed, 58 passed, 76 total**, both files failed. Seven previously unlisted result/amount claim variants passed through to HTTP 200 verbatim, two old-blacklist examples failed rather than yielding usable safe guidance, all new complete-address corrections retained obsolete cities, ambiguous replacement was silently patched, model/state/clarification guidance was not server-rendered, and the revised ignored-prose unit expectation exposed the former semantic blacklist.
- First implementation **GREEN**, exit 0: **76 passed**, agent 55 + route 21, two files, duration 617 ms. Root typecheck in the same command also exited 0.
- Added a later-state coverage test exercising price, save, date-request and quote-request guidance against the same unsupported model prose without changing production behavior.
- Final focused **GREEN after scoped formatting**, exit 0: **77 passed**, agent 55 + route 22, two files, duration 557 ms.

Final scoped formatting/check commands:

```sh
/opt/homebrew/bin/pnpm exec biome check --write apps/web/functions/api/_lib/conversation-agent.ts apps/web/functions/api/_lib/conversation-prompts.ts apps/web/functions/api/_routes/conversation.ts apps/web/test/conversation-agent.test.ts apps/web/test/conversation-route.test.ts
/opt/homebrew/bin/pnpm typecheck
/opt/homebrew/bin/pnpm exec biome check apps/web/functions/api/_lib/conversation-agent.ts apps/web/functions/api/_lib/conversation-prompts.ts apps/web/functions/api/_routes/conversation.ts apps/web/test/conversation-agent.test.ts apps/web/test/conversation-route.test.ts
git diff --check
git diff --cached --check
```

- Scoped autoformat: exit 0, five files checked, three formatted, no lint errors.
- Root typecheck: exit 0, UI/landing/web completed, including Functions.
- Final no-write scoped Biome: exit 0, five checked files, no fixes applied.
- Working-tree and staged whitespace checks: exit 0, no findings.

Exactly one final root suite invocation in this fix round:

```sh
/opt/homebrew/bin/pnpm test
```

**Exit 0: 533 total tests** — UI 9/9 (one file), landing 9/9 (one file), web **515/515** (31 files); 33 files total. Web duration 5.53 s. The unchanged `test/example.test.tsx` again emitted jsdom's `Not implemented: navigation (except hash changes)` stderr and passed. No root suite rerun, build, E2E or preview operation was performed.

### Self-review and remaining limits

- Checked that there is no `turn.reply` copy/spread into the returned object, no semantic phrase blacklist left as the prose-truth boundary, no internal clarification-selector leak, and no free-text inventory-label insertion in the visible reply. Removing the renderer or returning raw model replies breaks the fake-binding behavioral tests, including later states and paraphrases not present in the former blacklist.
- Checked full replacements before fragment preservation; removing that branch reproduces both exact reported obsolete-city regressions. Existing fragment-retention tests remain green, and ambiguous corrections now fail toward clarification rather than guessed city reuse.
- The prose policy intentionally sacrifices arbitrary model-authored conversational wording: visible guidance is bounded English server templates, not unrestricted chat answers. A model can still choose an unnecessary but safe typed clarification; it cannot supply its wording, an amount or a success statement. This does not claim unrestricted semantic accuracy of typed model proposals; existing schema/reference/revision validation, visible proposal acceptance and trusted domain-operation results remain necessary.
- Address detection remains a bounded synthetic grammar, not a postal parser. Complete addresses use a comma-separated alphabetic city component; postal-code formats, unseparated cities, unusual street suffixes or ambiguous correction intent may require a complete explicit city/address or panel edit. No city or country lookup is performed.
- The client snapshot remains current-state input, not authenticated server result evidence. Templates use it to select guidance; they do not manufacture external success or monetary values. Real domain APIs/cards remain authoritative for actual results.
- Frontend wiring and browser/E2E remain parent-owned and unmodified. No Task 1 protocol correction was required. **Blockers: none for this fix round.**
