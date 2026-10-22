# Physical Receipt Suggestions, Cashier Assignment and Tax Selection — Final Plan v2

> **Forson Business Suite** | **Date:** 2026-10-21 | **Revision:** 2.0
> **Target branch inspected:** `auto-receipt-increment-and-tax-selection`
> **Authority:** This self-contained revision supersedes [revision 1](2026-10-21_physical-receipt-suggestions-and-tax-selection.md) in full. Implement this document, not the staging reservations or implicit last-selected behavior in v1.
> **Status:** Finalized design, documentation only. No application/migration/deployment work performed in this revision task.

## 0. Status at a Glance

| Phase | Status | Deliverable / remaining work |
|---|---|---|
| Design and source review | Done | Owner corrections incorporated; full v1 read; formatting and approval source rechecked |
| 1. Schema and migration | Not started | Series, issued/spoiled registry, source links, settings/preferences and audit |
| 2. Shared API and cashier posting | Not started | Exact-number validation, cashier-only assignment, atomic posting and retries |
| 3. Application Settings | Not started | Master series/tax configuration, document-selection policy, spoilage management |
| 4. Connected UI | Not started | Same-footprint receipt control for cashier POS/invoicing/approval and collection; no partsman receipt control |
| 5. Verification and rollout | Not started | Disposable-DB, concurrency, browser and store-paper acceptance |

Statuses describe work under this feature plan, not an exhaustive audit of repository implementation. Registry-backed paper assignment at partsman staging and a pending-claim lifecycle are **removed from scope**, not deferred phases. All other required work below remains required, including collection integration and legacy compatibility.

## 1. For the Next Agent

Read this revision and current AGENTS.md. Recheck branch/status, diffs, migrations, current route contracts and test discovery before implementation; preserve unrelated changes. Query Graphify for physical receipt/cashier approval/settings/tax, and recall Hindsight for `FBS physical receipt plan v2 cashier assignment document selection`.

Do not implement v1's staging receipt fields, reservations, transfer logic, partsman skip decisions or last-selected-on-click behavior. Use Express + raw pg SQL, existing React/Tailwind controls and state-navigation conventions. After each phase document As Built, changed files, migration/API contracts, actual verification and remaining gates. Run `graphify update .` on the verified repository host after implementation.

## 2. Business Objective and Settled Workflow

Plan receipt numbers must match the actual preprinted paper. FBS suggests to save typing; cashiers remain free to enter a different valid number. Keep existing internal invoice/payment/staging numbers unchanged.

**Partsman stages sale → cashier reviews → cashier selects physical document / Notebook and number → cashier approves/posts.**
- Partsmen use staging for the sale, not physical document issuance. No receipt type/number suggestion or assignment requirement, no reservation, pointer changes, spoilage or remembered document choice on staging.
- Blank/unassigned at staging is **not Notebook**. Notebook is an explicit cashier decision that no physical receipt was issued for the posted sale.
- Cashier approval uses the same receipt-selection/suggestion rules as direct POS/invoicing. It does not inherit a physical reference from the partsman.
- Receipt identity, source posting, confirmed spoilage, numbering state and last-successful-paper preference persist together only when the cashier's final posting succeeds.
- Opening approval, rejecting staging, failed posting or abandoned forms changes no numbering/spoilage/preference state. Do not reset existing financial staging rules or client_ref idempotency.

Owner value: faster cashier entry, accurate references, proper discontinuous booklet handling and reviewable spoilage. Notebook does not suppress tax/stock/revenue/cash or waive statutory document obligations. Owner/accountant approval of physical stock and tax mappings is a rollout prerequisite, not legal certification supplied by this feature.

## 3. Verified Source and Evidence Limits

Inspected in this planning sequence:
- `packages/api/helpers/receiptNumberFormatter.js` and frontend equivalent: normalization retains prefix and serial in the canonical full reference, uppercase/separator handling and existing leading-zero behavior. Reuse it; do not add formatting rules.
- `packages/api/routes/invoiceRoutes.js:340-369,568-610`: duplicate lookup and automatic collision renumbering. Repair: exact user-confirmed normalized number or conflict; no automatic replacement.
- `packages/api/routes/stagedSaleRoutes.js:433-443`: approval accepts a reference, falls back to staged.physical_receipt_no, and appends `-STG-...` on an invoice collision. Repair at **cashier approve/post**, not partsman submission; remove fallback/suffix behavior for the new typed flow.
- `packages/api/routes/stagedSaleRoutes.js:29-36`: submission accepts legacy physical_receipt_no and client_ref. Source capability does not establish the store workflow; owner confirms partsmen never assign receipts.
- `packages/api/routes/paymentRoutes.js`: `/api/payments` writes one instrument per request; physical reference is distinct from instrument reference.
- `packages/api/routes/paymentMethodRoutes.js`: split processing can write invoice.physical_receipt_no; ensure collection documents cannot overwrite sales references.
- `database/migrations/20260810_02_enforce_physical_receipt_uniqueness.sql`: legacy cross-table lookup covers invoice/customer_payment/active staged_sale. Existing global/per-table rules need coordinated migration, not blind removal.
- `packages/web/src/pages/POSPage.jsx:1152-1193`: receipt cell beside Tax Rate in existing two-column grid; preserve outer dimensions and layout.
- `InvoicingPage.jsx`, `CashierApprovalDesk.jsx`, `SettingsPage.jsx`, `settingsRoutes.js`, `taxRateRoutes.js`, AGENTS.md and Wednesday, October 21, 2026DATE_TIME_100____/SYSTEM_CONTEXT.md: integration leads/permissions. Application Settings is presently admin-gated; settings API mutations use settings:edit.

Fresh revision checks: MCP branch/status, bounded log/diff, Graphify query, current formatter and approval source, and complete v1. Log now includes the original documentation commit; this does not prove feature implementation. Two mistyped path reads failed and were retried using the correct path. No live schema, authenticated UI, remote execution runner, full branch-to-base diff, tests, migrations or deployment verified in this task.

## 4. Document Types, Prefixes and Duplicate Identity

### 4.1 Choices

Initial configurable choices: Sales Invoice — Non-VAT; Charge Invoice — Non-VAT; Sales Invoice — VAT; Charge Invoice — VAT; Delivery Receipt; Collection Receipt; Notebook — No physical receipt issued.

Controlled document purpose and tax designation are separate attributes. Notebook is a recording method, not a paper series. Display/short labels are configurable. Historical types can remain inactive. POS/invoicing/cashier approval show eligible sales/charge series, supported DR series and Notebook. Collections show Collection Receipt, not sales invoice issuance. A DR reference does not become a tax invoice or independently decide sales tax.

### 4.2 Prefix participates in every identity check

**Duplicate/existence key: `(series_id, canonical_full_reference)`**, where the full reference contains the normalized prefix **and** serial. Never check digits alone. Use the same key for suggestions, validation, posting, spoilage, corrections, imports/backfills and compatibility queries.
- `SI-1234` and `DR-1234` are different full references; a reused serial alone is not a duplicate.
- Formatting variants accepted by the existing normalizer map to the same reference and conflict within the same series.
- Submitted prefix must match the selected series' configured prefix after normalization. A cashier cannot change prefixes to evade a conflict; select the correct eligible series explicitly.
- Independently confirmed VAT/non-VAT or other legitimate series may have identical full text. Never infer tax from prefix alone. UI shows the type/series separately; no added VAT or booklet label in the receipt string.
- Same namespace represented by multiple administrative labels/registers is not a new series. Reuse the same series id; do not clone series to bypass uniqueness. Settings must warn/reject indistinguishable overlapping proposed series until owner confirms genuinely independent paper stock. Serial jumps/new stubs in an existing discontinuous series do not create a new namespace.
- Unknown legacy series require conservative conflict checks and reviewed mapping before ambiguous activation; selecting a new series cannot make historical evidence disappear.

The displayed format remains current FBS sales formatting. No new padding, arbitrary templates or suffixes; no bulk rewriting of saved references. Use strings for identifiers, exact integer serial parsing and decimal-string transport for large values. Maximum width must fit every affected source column. Nonincrementable input/prefix mismatch is a clear validation error, not a synthesized reference.

## 5. Number Suggestions and Skip Popover

### 5.1 Application Settings method per type/series

One dropdown **Number suggestion method**:
- `HIGHEST_PLUS_ONE` — Highest number + 1; continuous/high-water mode. Lower valid issuance cannot rewind it.
- `LAST_ISSUED_PLUS_ONE` — Last issued number + 1; discontinuous continuation mode. A higher or lower override becomes the next continuation point after successful issuance.
- `NONE` — Notebook; no paper sequence.

VAT series default to highest; DR defaults to last-issued. Other paper types require explicit configuration on activation. Type defaults and per-series overrides are configured in Application Settings, not hardcoded on POS. Both modes permit overrides; method is not a prohibition on skips.

List suggestions start at the configured initial serial, then follow the applicable pointer; exclude occupied issued/voided/spoiled references, respect optional bounds and return exhausted rather than wrapping. Highest is numeric order, not string MAX. Last-issued is successful server issuance order under lock, not invoice date/edit time/client clock. No partsman staging reservations or pending occupancy model. Two cashiers can see the same suggestion; first successful post wins, second gets a recoverable conflict, not reassignment.

Historical entry is authorized/audited: reserves its confirmed document identity, never rewinds the last-issued continuation. Highest-mode backfill above high-water must raise it to preserve its meaning. Corrections are not fresh issuance; voids do not release issued numbers. Use indexed gap/successor lookups for long occupied runs, not unbounded iteration over serial gaps.

### 5.2 Mandatory exception popover

After blur of an intentionally changed suggestion, or submit if not yet resolved, show an anchored popover. Compare normalized values; no prompt for formatting-only changes, each keystroke, auto refresh, switching type/series or selecting Notebook.

**Receipt number changed** — Suggested `[original]` → Entered `[entered]`. **Why was the suggested number not used?**
- **New stub / different booklet** — discontinuous mode only.
- **Suggested receipt is spoiled**.
- **Other / not spoiled**.

No preselected reason. Buttons **Continue** / **Go back**; Escape acts as Go back and restores input focus. Submit stays blocked until the unchanged decision is confirmed. Optional note, no mandatory manager approval for ordinary jumps.

New stub/Other: no spoilage; entered number posts if valid; last-issued continues from that serial after success, highest retains high-water semantics. New stub needs no Settings visit and works for upward/downward jumps.

Spoiled: show exact original suggestion and positive acknowledgment: **“[reference] will no longer be suggested or accepted for this series when this transaction posts successfully.”** Only that explicitly confirmed number is spoiled, never the intervening range. Extra spoiled numbers are individually managed through Settings. No fake invoice/payment is created for spoilage.

Bind decision to series, suggestion identity, entered reference, reason and spoiled reference. Any change invalidates it. One unchanged confirmation is not asked twice in a posting attempt. Canceled/abandoned/failed attempts persist no spoilage. Concurrently issued original suggestion cannot be spoiled: preserve entered reference and require refresh/reconfirmation without moving spoilage to a different number. A manual number when suggestions are unavailable needs normal validation, not an invented gap explanation.

## 6. Application Settings and Selection Preferences

### 6.1 Physical Document Series

Add this section in existing Application Settings, with list/search/filter, type/series editor, selection-policy/default editor and spoiled-number history. Use settings:edit backend authorization and existing admin page policy for this release; do not broaden unrelated tabs. Runtime option reads require corresponding cashier workflow access and cannot mutate masters.

Series fields: display/short label, controlled purpose, tax designation, supported current-format prefix, effective method/inheritance, actual initial/next state, optional bounds, active, allowed contexts, configured register/workstation defaults, default fallback tax rate and allowed resolved tax mappings. No invented initial serials. Cannot activate invalid/unmapped series; used namespace/prefix immutable, deactivate rather than delete. Counter/method corrections require version check, reason, old/new preview and audit; never clear occupancy or rewind into reuse.

Spoiled history: series/full reference, actor, server time, reason, linked decision/source; paginated/searchable. Mark individually with confirmation; reject already-issued/voided references. Correct mistaken designation only with settings:edit + reason + version; append correction, retain original event, make unused number eligible without rewinding sequence. Ordinary cashiers cannot unspoil.

No mandatory skip-confirmation disable switch. All master methods, default policies, series availability and tax mappings are edited in Application Settings, not a permanent extra POS panel.

### 6.2 Default document selection — approved preference

Configure policy per workstation/register and workflow context, with **Last successfully issued** as recommended initial policy where eligible paper defaults have been reviewed:
- `FIXED_DEFAULT`: **Fixed default** — new transaction begins with the configured eligible paper series; if missing/ineligible, require selection. Do not prefer last-used state.
- `LAST_SUCCESSFUL`: **Last successfully issued** — prefer the last successfully issued eligible paper **series** for the current authenticated cashier + workstation + page/context. This also determines type; remember no serial locally as authority. If absent/ineligible, use the configured eligible fixed fallback. Otherwise require selection.
- `ALWAYS_ASK`: **Always ask** — pristine new transaction begins unselected. Do not silently fall back even when a previous/default/single series exists; after explicit choice load its suggestion.

Policy schema: mode, nullable fixed/fallback series FK, context/workstation key, version/audit fields. Fixed mode requires valid fixed series; last-successful may have nullable fallback; always-ask ignores fixed fallback. Settings can disable Notebook for specific contexts, but **Notebook is not an automatic remembered/default choice in this release**. It remains an explicit cashier selection each transaction, even after a Notebook sale. A prior Notebook sale does not replace remembered paper-series state.

Update remembered paper-series state **only in successful ordinary cashier issuance**, including approval/post. Selection clicks, canceled/failed sales, merely opening approval, partsman staging, drafts, corrections and historical backfills do not update it. Record one preference update for a grouped collection receipt; idempotent replay returns original result and must not reorder preference state after a later transaction.

Validate availability, context, permissions and resolved transaction tax before reusing a remembered/default series. Ineligible remembered series falls back without changing existing tax. Never apply memory/policy changes to a restored/dirty draft. Approve a staged sale starts a cashier decision from policy, not partsman choices; an existing staged tax profile is not silently overwritten. If compatibility is unknown until lines load, defer automatic choice or require review; do not guess VAT/non-VAT. Last-used is a convenience, never legal/tax authority.

Scope is cashier + workstation + distinct POS/direct-invoicing/cashier-approval/collection context; no global shared preference and no cross-account leakage. Shared workstation identifier is preference scoping, not authentication. Browser identity/last-used failure falls back to configured policy, not another user's memory. Switching accounts clears in-flight selection responses; drafts stay owner-scoped.

## 7. Tax and Financial Invariants

Reference existing tax_rate and centralized taxCalculationService; do not duplicate tax math. For sales series configure default fallback and allowed resolved line tax mappings. Check actual server-computed lines: per-part tax may override fallback. Numeric percentage/name alone is not a legal category; close any required category-model gap before activation.

Initial pristine direct sale can preselect the configured fallback. On a deliberate change after amounts/tax are present, confirm material changes. Staged approval retains submitted tax unless cashier makes an explicit authorized change with recalculation/review. Receipt number edit never alters tax; incompatible series blocks posting with affected lines rather than silently recalculating. Old posted invoices never change from new mappings.

VAT-designated forms can include exempt/zero-rated lines only when explicitly allowed and supported by the tax engine. DR/Collection Receipt/Notebook preserve underlying tax; collection records settlement, not a second sale. Notebook choice alone creates no extra cash-in. Preserve prior notebook cash-coverage reconciliation, cash-drawer custody/pauses, credit holds, discounts, stock/cost posting and A/R/PDC behavior. Use ledger/view or invoice.amount_paid for A/R balance reads. Instrument references remain instrument-only; no physical-number fallback into invoice_payments.reference.

## 8. Proposed Schema and Migration Specifications

Names below are proposals, not claims of existing deployed tables. Use pg FK types matching actual keys, versioned optimistic settings edits, actor from auth, server timestamps and forward-only idempotent migrations.

| Entity | Required contract |
|---|---|
| physical_document_type | stable unique code, controlled category, labels, tax designation, default method, active, audit |
| physical_document_series | type FK, unique stable code, display name, canonical prefix, method, exact initial/bounds/high-water/last-issued serials, version, active, audit |
| physical_document_series_context | series FK, allowed context/workstation; default eligibility constraints |
| physical_document_series_tax | series FK, tax_rate FK, DEFAULT_FALLBACK/ALLOWED_RESOLVED role; unique pairs and at most one fallback |
| physical_document_selection_policy | context/workstation unique, mode FIXED_DEFAULT/LAST_SUCCESSFUL/ALWAYS_ASK, fixed_or_fallback series FK, Notebook eligibility, version/audit |
| physical_document_last_success | unique(authenticated employee, workstation, context), last eligible paper series FK, successful issuance id/time; server-maintained only |
| physical_document_registry | series FK, canonical full prefix-number reference, exact serial, state ISSUED/VOIDED/SPOILED, version, request identity, audit; UNIQUE(series_id, canonical_full_reference) |
| physical_document_source_link | registry FK, invoice or customer_payment FK with exactly one source per link, source role and unique source/link constraints; no staged_sale receipt-ownership link |
| physical_document_event | append-only series/registry/source/request, event, before/after, original suggestion, submitted reference, reason, actor/server time |

Use exact integer storage, decimal-string API serials, bounded references compatible with all target field lengths (baseline invoice 50, verify current schema). Add nullable registry/series/type references and explicit PAPER/NOTEBOOK recording method to invoice and applicable customer-payment source/group, retaining legacy unknown for unmapped data. Notebook has no paper reference/series/registry. Do not add receipt-selection/spoilage/registry fields to partsman staging. Existing staged_sale legacy receipt column may remain for historical compatibility, not fresh assignment or fallback authority.

Registry enforces one occupied physical identity across invoice/payment writers; same source retaining own reference does not conflict. Issued/voided evidence is not released through ordinary deletion/refund. Mistaken assignment correction is a narrow authorized audited operation, no financial replay, no deletion of old paper evidence. Corrected spoilage can become unoccupied while append-only events retain history; implement an explicit unoccupied representation/removal of occupancy, not a permanently blocking SPOILED row after correction.

All mirrors/source links must be enforced using constraints/triggers or an equally enforced database write path, not advisory checks alone. Do not allow cloning config labels to create duplicate namespaces. Disallow serial-only lookups for availability. Index series/serial/state for suggestions and series/full-reference for conflicts.

Collection grouping is required before activation: `/payments` currently writes per instrument. One real physical collection receipt covering multiple instruments has one registry identity + authenticated logical group request + authorized payment links and consumes once. Reuse a verified group if available; otherwise add a transactional grouped adapter around existing payment service with group FK/unique request identity. No arbitrary sharing of receipt numbers across unrelated payments; no partial group posting after failure. Keep invoice paper references separate from collection identity.

Migration preflight: inventory every write path/index/function, canonical duplicates, real series/prefix/tax mappings and legacy staged references. Preserve saved text/history; do not infer tax from prefix or blanks as Notebook. Ambiguous legacy source ownership must be reviewed before activation. Legacy nonblank staged references are review evidence only; cashier explicitly confirms actual paper at approval, never a fallback assigned by partsman data. Keep conservative legacy conflict handling until mappings are proven; do not silently erase evidence or trust historic code capability as issuance proof.

Seed types inactive; owner configures real series, initial state, tax and selection policy. Populate confirmed issued registry links without posting cash/stock/AR. Replace legacy global checks/per-table uniqueness only once every writer/compatibility reader is coordinated and DB guards are active; do not modify supplier/GRN rules. Rehearse with snapshots/disposable DB and migration replay/checksums. Disable suggestions if needed, but do not roll back safety/history or restore silent reference reassignment.

## 9. Proposed API and Transaction Contracts

All new paths under `/api`; follow existing response/pagination conventions. settings:edit for configuration/spoilage management; runtime data scoped to authenticated workflow permission. Existing admin page access remains; broad settings-manager access is deferred.

- GET `/physical-documents/options?context=&workstation_id=`: eligible types/series/tax mappings, effective policy, eligible default selection/selection_required and versions; no claim/reservation. User's last-success state is resolved server-side. Cashier workflow permissions, not pos:use alone as a physical-issuance grant.
- GET `/physical-documents/suggestion?series_id=&context=`: canonical full reference, prefix/serial, version, opaque signed suggestion token or exhausted; no state mutation.
- POST `/physical-documents/validate`: series, full physical reference, suggestion token, authorized edited source; normalized full value, availability/exception feedback, tax compatibility where line context supplied. Final posting still authoritative.
- GET/POST/PATCH `/settings/physical-document-types` and `/settings/physical-document-series[/id]`: validated labels/methods/contexts/tax mappings, versions/audit; no deletion of used masters.
- GET/PUT `/settings/physical-document-selection-policies`: context/workstation, policy mode, eligible fixed/fallback, Notebook eligibility, expected_version; validate mode combinations. No cashier write endpoint to set arbitrary last-success state.
- POST `/settings/physical-document-series/:id/adjust-sequence`: exact values, expected_version, required reason; return old/new and next-preview, never remove occupancy.
- GET/POST `/settings/physical-document-spoilage`; POST `/settings/physical-document-spoilage/:id/correct`: pagination/filter or exact series/full reference, version, reason and acknowledgment; audit all changes, reject issued/voided references.

Issuance payload belongs on existing POST `/invoices`, POST `/sales/staging/:id/approve-post`, POST `/payments` (or required grouped adapter), and relevant narrow receipt corrections/split surfaces. It does **not** belong on partsman POST `/sales/staging`:
`physical_document`: recording_method PAPER/NOTEBOOK; series_id (paper only); physical_receipt_no (full string, paper only); suggestion_token; exception {reason NEW_BOOKLET/SPOILED_SUGGESTION/OTHER_NOT_SPOILED, original suggestion, entered reference, optional note, explicit spoilage acknowledgment}. Retain top-level physical_receipt_no only as compatible cashier mirror, reject disagreement. Legacy untyped clients require guarded migration, not guessed series/Notebook.

For fresh partsman staging, accept omitted/null legacy receipt field for compatibility; reject nonempty physical reference or paper-assignment/spoilage payload with a clear cashier-assignment validation error. Do not silently ignore supplied receipt instructions. Cashier capability must be enforced by existing posting authorization (currently invoicing:create), not role display labels or pos:use alone. Partsman-only users cannot obtain protected cashier suggestion/spoilage mutations through direct APIs. Preserve legitimate staging access/client_ref retries.

Approval requires explicit cashier PAPER + series/full reference or explicit allowed Notebook; no fallback to staged reference, no -STG- suffix, no reservation transfer. Existing staged-sale foreign keys remain sale provenance, not paper ownership. Unassigned/missing cashier choice is a validation error, not automatic Notebook.

Successful response returns exact normalized full reference, registry/series/recording method and next/state versions with existing financial response. Conflicts preserve user input. Codes: 400 invalid format/prefix/payload; 403 denied; 404 ineligible source; 409 RECEIPT_NUMBER_TAKEN/RECEIPT_NUMBER_SPOILED/RECEIPT_DECISION_STALE/SERIES_CHANGED/SERIES_EXHAUSTED; 422 RECEIPT_EXCEPTION_REQUIRED/RECEIPT_TAX_INCOMPATIBLE/RECEIPT_ASSIGNMENT_REQUIRED. Return minimal authorized conflict details; do not leak other customers.

Final cashier posting transaction:
1. Resolve completed stable request-id replay before token expiry checks; same key/different payload conflicts. Include receipt/exception in request fingerprint. Replay does not change pointers or last-success preference again.
2. Respect existing source/cash-session lock protocol, lock source and affected series/registry deterministically across posting, corrections and spoilage. Scope FOR UPDATE OF alias with joins. Never hold locks during human popover interaction.
3. Validate permission, source state, active series/context, full prefix-number input, legacy occupancy, actual resolved tax, signed suggestion/confirmation and exact spoilage target under lock. Signed suggestion is not a reservation. Permit safe stale suggestion usage if entered number is unused and configuration compatible; never transfer an obsolete spoilage decision.
4. Persist invoice/collection source, registry/links, spoilage/event, numbering state and last-success paper preference together. Concurrent duplicate/failure rolls all back. Paperless Notebook saves none of these paper side effects and retains ordinary financial posting.
5. Commit exact result. Timeout is unknown outcome: retry/query same identity, never assign another number or double-post financial effects. Preserve current source idempotency and cash/custody behavior.

Remove direct invoice auto-increment loop, approval suffix/fallback, UI promises of automatic reassignment and instrument-reference physical fallbacks. A suggestion may avoid known occupied numbers before entry; posting may never substitute a different physical number after cashier confirmation.

## 10. UI / State Specification

Keep POS receipt cell's existing outer size, padding, position and adjacent Tax Rate column. Composite control inside current input footprint: short-label dropdown left, editable full physical reference right, current Ctrl+P focus shortcut. No permanent new row or shift of cart/payment controls. Long number remains readable via input focus/scroll, not data truncation. Full type/tax/series accessible labels in dropdown; booklet grouping only for multiple active booklets. Popover via portal with viewport collision handling; overlay rather than layout reflow.

Use current light/dark tokens, typography, surfaces and semantic focus/error states. Keyboard dropdown navigation, visible focus, Escape/back and focus restoration; adequate hit targets within existing allocation. Test baseline bounds/zoom/desktop/mobile, do not claim visual verification from source. Same shared control in InvoicingPage, CashierApprovalDesk and collection forms. **No physical control in partsman staging view**; if POS is shared, gate it by actual cashier execution mode/capability. Do not confuse missing staging choice with missing required cashier input.

Notebook disables number with **No physical receipt**, resets pending exception, does not change tax or consume sequence. Replace ambiguous no-receipt confirmation with explicit Notebook when allowed, retain paper-only requirements where configured. Always-ask starts pristine forms unselected, including after successful posting; no implicit single-choice bypass. Last-success/fixed follow policy only for pristine new transactions. Draft/dirty values survive settings refresh and async lookup; revalidate rather than replace. Staged approval applies policy to cashier-owned receipt state without overwriting submitted tax.

Settings policy UI shows mode, fixed/fallback selector (visible/required only as applicable), context/workstation and help: last successfully issued paper only; Notebook never remembered. Reset after successful posting follows effective policy, not unconditional retention of the last clicked type. Restoration of a draft preserves its explicit Notebook choice but does not carry it to another new sale.

Failure states: in-cell loading; manual-entry fallback if suggestion unavailable but type/options validated; options failure preserves draft and blocks guessed new issuance; no eligible series links/explains Settings; errors shown accessibly in overlays without permanent cell growth. Series change of dirty number requires confirmation before replacement. Ignore stale request responses on series/input/account changes. Spoilage/collision decision preserves typed reference/cart. Unknown posting response freezes new different-key attempts until resolved. Store nonsecret draft fields/request id only, no credentials or reusable authorization secrets; show storage-failure warning and recovery.

History distinguishes paper type/series/reference, explicit Notebook and legacy unknown. Preserve physical-reference precedence and immutable document IDs in existing SOA/archive integrations. Corrections reuse invoice:edit_receipt_no with registry consistency, audit and no financial replay. Collection UI never overwrites sales paper fields; grouped collection displays one receipt across authorized instrument lines.

## 11. Execution Phases and Observable Acceptance

### Phase 1 — Schema and migration (Not started)

Deliver proposed entities, DB invariants, prefix-aware identity, policy/preference state and reviewed legacy mapping. Remove v1 pending-claim model and staged assignment migrations. Rehearse forward migration/checksums/idempotence and registry/mirror consistency on disposable Postgres; no live cleanup without authorization.

### Phase 2 — API and cashier transaction integration (Not started)

Implement shared suggestions/validation/exact posting, auth, signed exception proof, lock order, retry-safe audit and last-success updates. Keep partsman submission assignment-free. Repair direct invoice and cashier approval reference mutation. Complete collection grouping/compatibility before activation; no route bypass.

### Phase 3 — Settings (Not started)

Implement master series/methods/tax/contexts, approved policy dropdown, fixed/fallback defaults, audited sequence edits and spoiled list/correction. Verify admin page reachability and backend role denial. Validate activation/namespace/prefix overlaps and empty/invalid states.

### Phase 4 — UI (Not started)

Wire shared compact control only into cashier contexts; mandatory skip popover, Notebook, all three selection modes, draft/error/retry states. Separate staged tax from receipt selection. Preserve geometry and normal work speed.

### Phase 5 — Tests and rollout (Not started)

Acceptance matrix:
- **Identity:** distinct prefixes with same serial do not collide; normalized equivalent full references within series do; mismatch prefix rejected; confirmed independent same-prefix series separated; cloned same namespace cannot bypass checks; serials are strings/exact integers, not float/text ordering.
- **Staging:** partsman has no receipt control; blank payload stages normally; nonempty assignment rejected; staging/rejection changes no registry/pointers/spoilage/preference. Cashier approval explicitly assigns once with no staged fallback. Duplicate approval leaves sale pending/unposted and preserves cashier state.
- **Sequencing:** pristine suggestion/abandoned/draft consume nothing; both methods allow upper/lower override; highest cannot rewind; last-issued continues from confirmed batch; occupied/spoiled/voided skipped, exhaustion explicit; backfills/corrections obey section 5.
- **Popover:** formatting-only edits no prompt; new stub spoils nothing; explicit spoiled original is blocked; large gaps never bulk-spoiled; canceled/failed/changed decisions no side effects; concurrent original usage yields reconfirmation, not wrong spoilage.
- **Policy:** fixed ignores memory; last-success updates only after successful ordinary paper issuance by correct cashier/workstation/context; always-ask starts empty even with a single eligible type. Failed/canceled/draft/staging/backfill/correction/replay does not change memory. Inactive/incompatible remembered choice uses eligible fallback or requires choice. Separate context/account histories; no Notebook carryover; restored draft not overwritten; settings edit affects next pristine transaction only.
- **Tax:** actual per-part precedence/mixed treatment validated; number edits no tax change; remembered type cannot silently alter existing staged tax; Notebook/DR/Collection preserve underlying tax; unauthorized/misconfigured tax flow blocked.
- **Atomicity/security:** two cashiers same number: one commit/one exact conflict, no number mutation. Spoilage vs posting race serialized. Direct API spoof cannot bypass permission/context/prefix or inject unrelated spoilage. Reload retry returns original source/document once with no preference reordering or extra cash/stock/ledger effects; same-key/different-payload conflict.
- **Collections:** one physical receipt/group, multiple legitimate instrument links, consume once; unrelated sharing rejected; failure rolls back group; no invoice-reference overwrite or instrument-reference fallback.
- **Legacy/corrections:** original references retained; blank not Notebook; ambiguous prefix/series mappings block unsafe activation; staged legacy references never automatic assignment; source ownership and spoiled correction auditable; issued/voided not ordinary reusable; GRN/archive rules unchanged.
- **UI:** measured POS receipt bounding box/adjacent controls match baseline at desktop/mobile widths and zoom, light/dark, readable input, keyboard/focus/overlay behavior; partsman view clean; options/suggestion/error/unknown-write/account-switch/storage failures recoverable.

Proposed performance targets, to measure: p95 suggestion/availability <=150ms excluding transport; incremental posting receipt overhead p95 <=100ms excluding existing sale work; indexed lookups, no whole-table MAX at checkout or request per keystroke. No human-wait DB locks. Report actual deviations.

Required verification, NOT run by this documentation task: focused real-DB service/API/migration/concurrency suites and web tests; `npm run -w packages/api lint`; `npm run -w packages/web lint`; `npm run -w packages/web build`; migration status/verify through existing scripts against disposable DB; authenticated partsman/cashier/admin browser roles; real-paper pilot; `graphify update .` on repository host. Verify discovery of any standalone DB suites and report exact commands/results separately from mocked browser fixtures.

Rollout gate: all above, reviewed actual series/counters/tax mappings, explicit role separation, grouped collection, legacy mapping and owner store pilot sign-off. No production settings/data/deploy without separate authorization.

## 12. Deferred / Non-goals

Printing/CAS/BIR registration or legal certification; physical booklet purchasing inventory; OCR/Paperless/GRN redesign; multi-DR fulfillment model; broad non-admin access redesign of all Settings tabs; new offline serial reservations. Existing mobile partsman staging must stay assignment-free and replay-compatible. Future offline cashier issuance requires a separate explicit allocation design. Automatic range spoilage and partsman receipt reservation are intentionally excluded, not future defaults.

## 13. Files Expected and Documentation Footprint

This revision task creates only `docs/plans/2026-10-21_physical-receipt-suggestions-and-tax-selection-v2.md`; v1 remains historical because available plan_write is create-only, not an overwrite tool. User authorized this replacement revision. No application code changed. Implementers should add a superseded banner in v1 when a normal repository editor is available; this revision's explicit supersession is already authoritative.

Proposed implementation areas: forward-only database migrations/tests; packages/api/routes/invoiceRoutes.js, stagedSaleRoutes.js (submission guard + cashier approval, not reservation), paymentRoutes.js, paymentMethodRoutes.js, settings/tax/correction routes, shared physical-document service; packages/web/src/pages/POSPage.jsx, InvoicingPage.jsx, CashierApprovalDesk.jsx, SettingsPage.jsx and shared cashier control/settings/collection/history/draft components. Existing format utilities only for parity/reuse, not a new format policy. Add focused API, DB concurrency, web and browser acceptance coverage. No local mockup/chat prerequisites.

## 14. Verification Record and Change Log

Publication requires remote read-back and status inspection, reported to the owner after creation. Bounded status/diff is not a branch-to-base audit. No application test/build/migration/live UI/deployment run or commit/push performed here. Remote Graphify update not run: no verified remote command runner; do not update a different local filesystem.

| Revision | Change |
|---|---|
| 1.0 | Original plan; retained as historical link above. Its staging reservations and last-selected behavior are superseded. |
| 2.0 (2026-10-21) | Owner clarification: partsmen stage without receipts; cashier assigns only at posting. Removed staging claims/transfer/pending schema, added submission guard and explicit cashier approval. Added Fixed default / Last successfully issued / Always ask, success-only per-cashier/workstation/context state, no Notebook carryover. Made prefix-aware full-reference duplicate checks, series namespace safeguards, API/schema/UI/acceptance updates explicit. |
