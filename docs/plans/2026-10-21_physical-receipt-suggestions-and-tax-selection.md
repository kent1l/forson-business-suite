# Physical Receipt Suggestions, Document Selection and Tax Mapping — Final Implementation Plan

> **Forson Business Suite** | **Date:** 2026-10-21 | **Revision:** 1.0
> **Target branch inspected:** `auto-receipt-increment-and-tax-selection`
> **Status:** Design finalized for implementation. Documentation only; no feature code, migrations, runtime tests or deployment performed by this planning task.

## 0. Status at a Glance

| Phase | Status | Required outcome |
|---|---|---|
| Design and source reconnaissance | Done | Owner decisions consolidated; relevant current source inspected |
| 1. Data integrity and migration | Not started | Series, numbering state, document registry, source links and audit |
| 2. Shared API and transaction integration | Not started | Advisory suggestions, exact-number posting, concurrency and retry safety |
| 3. Application Settings | Not started | Types, series, methods, tax mapping, defaults and spoiled-number management |
| 4. POS, invoicing and collection UX | Not started | Compact control, exception popover, Notebook and connected flows |
| 5. Tests, migration rehearsal and rollout | Not started | Real database/API/browser evidence and owner acceptance |

The statuses above describe this feature's work, not the general implementation state of FBS. Source inspection is not live-schema or deployed-UI verification. Required collection/staging compatibility work is not deferred merely because POS is the main entry point.

## 1. For a New Session or Agent Picking This Up

1. Read this whole document and current repository instructions. Recheck branch, worktree, recent commits, schema migrations and route contracts before edits; preserve unrelated changes.
2. Query Graphify for `physical receipt invoice staged sale payment settings tax calculation`; recall Hindsight for `FBS physical receipt suggestions document series spoiled booklet`.
3. Revalidate the source findings in section 3; they are leads at the inspected revision, not permanent claims. Verify actual database constraints before changing duplicate scope.
4. Implement in the phases below using Express, raw SQL/pg transactions and existing React/Tailwind patterns. Do not introduce an ORM, router or state library.
5. Update this document with per-phase As Built evidence, commands/results and remaining gates. Run `graphify update .` on the verified repository host after implementation. Do not run it against an unrelated local filesystem.

## 2. Business Objective, Scope and Stories

Reduce cashier typing and receipt-reference mistakes while preserving the identity of the actual handwritten/preprinted paper document. Suggestions are assistance, never mandatory serial assignment. Configuration belongs in Application Settings, not on the sales workspace.

Stories:
- As a cashier, I see the next suggested number immediately, but can use the number actually printed on the paper.
- As a cashier using a delivery-receipt stub with a different batch, I explain the jump as a booklet change and continue from that batch without declaring unused forms spoiled.
- As a cashier, I explicitly confirm spoilage and understand that the selected number becomes unavailable.
- As an owner, I configure document types, methods, tax compatibility and defaults centrally.
- As an operator, I choose Notebook for a sale with no issued physical receipt without suppressing tax, revenue, stock or cash processing.

Included: POS, direct invoicing, staging/approval, receipt correction safety, collection-receipt integration, settings, legacy migration, history provenance, permissions and verification. Existing internal invoice/staged/payment numbers remain independent and unchanged.

Not a receipt printer/CAS implementation or legal authorization to issue particular forms. Accountant/owner confirmation of usable paper stock and tax mapping is a rollout prerequisite. Notebook is not a tax exemption or a substitute for statutory issuance obligations.

## 3. Verified Source Baseline and Limits

Read through project MCP:
- `packages/web/src/pages/POSPage.jsx:1152-1193`: receipt and Tax Rate are adjacent cells in a two-column grid. The receipt input normalizes on blur. Existing tax help describes the selected rate as fallback for parts with their own tax rates.
- `packages/web/src/utils/receiptNumberFormatter.js` and `packages/api/helpers/receiptNumberFormatter.js`: existing canonical letter/number formatting. These are not generic print-format templates.
- `packages/web/src/pages/InvoicingPage.jsx:193-215, 717-735`: advisory duplicate check and copy claiming automatic number reassignment.
- `packages/api/routes/invoiceRoutes.js:340-369, 568-610`: duplicate lookup and a creation loop that changes a colliding physical number. **Replace this behavior; never silently assign a different physical reference.**
- `packages/api/routes/stagedSaleRoutes.js:29-36, 355-437`: authenticated staging and approval; approval currently appends a staging suffix on an invoice collision. **Remove that workaround for this feature.** Staging accepts a client UUID for idempotency.
- `packages/api/routes/paymentRoutes.js:22-45, 96-110`: `/api/payments` is per payment instrument; separates instrument reference from physical receipt and uses the global legacy lookup.
- `packages/api/routes/paymentMethodRoutes.js`: split-payment processing can update `invoice.physical_receipt_no`; this must not overwrite the sales document with a collection document.
- `database/migrations/20260810_02_enforce_physical_receipt_uniqueness.sql`: customer-payment unique index and cross-table `public.is_physical_receipt_no_taken` over invoice, customer_payment and active staged_sale. Global checks are incompatible with blindly introducing independent series.
- `packages/api/routes/settingsRoutes.js`: authenticated GET `/api/settings`; PUT guarded by `settings:edit`. Current storage is key/value settings.
- `packages/api/routes/taxRateRoutes.js`: `/api/tax-rates`, existing `tax_rate` records; edits guarded by `settings:edit`.
- `packages/web/src/pages/SettingsPage.jsx:645-756`: Application Settings currently has admin-only page gating. Do not assume backend `settings:edit` alone makes the screen reachable.
- `AGENTS.md` and `docs/SYSTEM_CONTEXT.md`: architecture, migrations and existing permissions/routes. Context is background; current source takes precedence.

Access limits: MCP source reads, Graphify query, bounded Git status/log/diff only. No authenticated running UI, full branch-to-base diff, live SQL or remote command runner was available. Several targeted searches returned tool errors; direct reads and broader directory searches supplied the relevant evidence instead. No claim of exhaustive source audit or existing feature absence follows from clean status.

## 4. Final Product Decisions

### 4.1 Document choices and context

Initial configurable display choices:
- Sales Invoice — Non-VAT
- Charge Invoice — Non-VAT
- Sales Invoice — VAT
- Charge Invoice — VAT
- Delivery Receipt (DR)
- Collection Receipt
- Notebook — No physical receipt issued

Document category and tax designation are separate attributes; Notebook is a recording method, not a paper-document category. Names/abbreviations may be configured, but core purposes are controlled enums, not arbitrary accounting behavior. Legacy stock may be retained inactive for lookup; enable new issuance only after owner review.

POS/invoicing show eligible sales/charge series, supported DR series and Notebook. Collection Receipt appears only in payment/collection workflows. A DR remains supporting delivery evidence; allowing its reference on a sale does not turn it into a tax invoice. This feature does not redesign multiple-DR-to-one-invoice fulfillment.

### 4.2 Number suggestion method

Use one dropdown labelled **Number suggestion method**, not an additional independent continuous flag:
- `HIGHEST_PLUS_ONE`: **Highest number + 1**. Monotonic high-water mark within the selected series; lower legitimate entries do not rewind it.
- `LAST_ISSUED_PLUS_ONE`: **Last issued number + 1**. Explicit continuation pointer from the most recently successfully issued number in that series, including lower-numbered booklet batches.
- `NONE`: Notebook only; no physical-number pointer.

User-facing helper text identifies the first as continuous and the second as discontinuous. VAT series default to highest; DR defaults to last-issued. Configure other numbered types explicitly at activation; do not invent initial serials. Type defaults may be overridden per series; persist the effective series configuration and show it plainly.

Both numbered methods permit cashier overrides, higher or lower, subject to format, series, duplicate and spoiled-number validation. Highest is numeric serial order, never string MAX, invoice date or most recently edited row. Last-issued is server commit order under the series lock, not document date or client clock.

Next suggestion starts at the configured initial serial if unused, otherwise the applicable pointer's next candidate. Exclude issued, retained-voided, active pending claims and active spoiled numbers; apply optional bounds. Never iterate across an entire gap or infer all intervening numbers were issued/spoiled. Return exhausted/no-suggestion rather than wrapping or inventing a new format. Use indexed successor/gap lookup for long occupied runs.

### 4.3 Timing, overrides and legacy entry

Opening, refreshing or abandoning a form consumes nothing. Successful final issuance atomically updates registry, pointer and audit. Draft saves do not issue numbers. Staging uses a pending claim for an explicitly selected number to prevent concurrent reuse, but does not advance the issuance pointer or finalize pending spoilage. Approval transfers that claim to the invoice; it is the same document, not a second receipt.

Rejected/abandoned pending claims can be released only as unissued. If paper was actually handed out, record it as issued/voided through an authorized correction, never silently recycle it. This is a required staging lifecycle gate: confirm operational issuance timing before enabling the feature, and expose an explicit paper-issued disposition where needed rather than inferring from rejection status.

Ordinary issuance overrides set the last-issued continuation point; highest-method overrides only raise the high-water mark if higher. Authorized historical/backfill mode records an audit and reserves the physical identity but does not rewind the last-issued pointer. For highest mode, historical assignment above the current high-water mark must raise it to avoid future reuse; therefore backfill is not simply an unrestricted `do_not_advance` client flag. Post-issuance corrections never masquerade as a fresh issuance or silently rewind pointers.

Distinct simultaneously used booklets can be configured as separate series in Settings. A newly purchased discontinuous DR stub need not be created in Settings merely to explain a different starting number: the cashier can continue the existing series using the booklet-change exception. This does not allow silently creating a new duplicate namespace.

### 4.4 Preserve existing number formatting

Reuse and parity-test the existing sales-side frontend/backend normalizers and POS equivalent. Do not introduce new zero-padding, arbitrary print templates, VAT labels or booklet IDs in the displayed reference. Prefix is configurable only within the supported current format; do not guess the same prefix for VAT/non-VAT stock. Inspect actual existing references before enabling each series.

Keep identifiers as strings in API/display. Parse the terminal serial separately using exact integer arithmetic; transmit large numeric values as decimal strings. Reject prefix mismatch/nonincrementable input for a numbered series with clear feedback instead of fabricating a suffix. Do not rewrite historical saved references en masse. Supplier/GRN receipt preservation and Paperless document IDs are outside this sales-side formatting change.

## 5. Skip / Booklet-Change Popover — Final Interaction

Trigger after blur of a deliberately changed numbered suggestion, or on submit if blur did not occur. Compare normalized values: formatting-only edits are not skips. Do not interrupt each keystroke. Switching type/series, automatic refresh and selecting Notebook are not skip events. A manual number without any suggestion requires ordinary validation, not an invented skipped-number question.

Anchored, keyboard-accessible popover:

**Receipt number changed**
Suggested: `[original suggestion]` → Entered: `[entered reference]`
**Why was the suggested number not used?**
- **New stub / different booklet** — available for discontinuous (`LAST_ISSUED_PLUS_ONE`) series.
- **Suggested receipt is spoiled**.
- **Other / not spoiled**.

Buttons: **Continue** and **Go back**. No reason preselected. Other/not-spoiled does not require free-text for normal issuance; optional note is allowed.

If spoiled is selected, explicitly display the exact reference and warning:
**“[reference] will no longer be suggested or accepted for this series when this transaction is successfully issued.”**
Require positive acknowledgment of this warning. This records the original unused suggestion only. New stub and Other leave all unused numbers unspoiled. A large jump never marks an intervening range. Additional individually identified spoiled numbers belong in Settings' spoiled-number action, not automatic range inference.

After successful discontinuous issuance, subsequent suggestions continue from the entered serial whether the jump was upward or downward. New stub requires no manager approval. Highest mode retains its high-water behavior regardless of reason. The reason does not control tax.

Confirmation is bound to `(series, suggestion identity, normalized entered value, reason, selected spoiled reference)`. Changing any bound value invalidates it. Do not ask twice for an unchanged tuple during one attempt. Go back/Escape returns focus without recording anything; submission stays blocked until resolved. Switching to Notebook discards pending skip/spoilage state. No spoilage is persisted on blur, draft save, failed posting or abandoned form. Staged pending decisions are revalidated at approval before finalization.

If a concurrent cashier has claimed/issued the original suggestion, it cannot be marked spoiled. Preserve the entered number and show a refresh/reconfirmation conflict; do not transfer the spoilage designation to another number. An already spoiled reference is reported as such, not spoiled twice.

## 6. Application Settings Specification

Add **Physical Document Series** within the existing **Application Settings** page. All master configuration lives here; POS offers selection/exception handling only.

### 6.1 Series list and editor

List columns: name, document purpose/tax designation, prefix, method, next suggestion, active state, default contexts. Search/filter by type and active state; initial empty state offers **Add series** and activation instructions. No fake sample serials are persisted.

Editor fields:
- Display name, short selector label, controlled category and tax designation.
- Supported existing-format prefix; initial serial; optional lower/upper bounds.
- Number suggestion method inherited from type or explicitly overridden; effective value shown.
- Active/inactive; allowed pages; default by configured workstation/register and context.
- Default fallback tax rate and allowed resolved tax-rate mappings (section 7).

Use existing settings UI conventions, semantic colors, normal text sizes and dark theme. Save/Cancel, field errors, unsaved-change warning, loading/failure/retry states. Cannot activate numbered series without valid initial state/prefix/method and compatible tax mapping where required. No delete for used types/series; deactivate. Category/prefix/number namespace becomes immutable after first claim; create a new series instead. Method/pointer changes require explicit audit and current version.

Separate **Adjust sequence** action: show old/new value, require reason, preview next suggestion, never clear issued/spoiled occupancy. Pointer edits cannot cause reuse. Separate **Defaults** editor configures allowed defaults and does not create a global last-selected cashier state.

### 6.2 Spoiled numbers

Searchable/paginated list with series, physical reference, reason, actor, server time and linked transaction/decision. **Mark spoiled** requires explicit number, confirmation and reason in Settings; reject an already issued/pending/voided reference. **Correct spoiled designation** requires `settings:edit`, reason and version check; preserve original event and append correction. Ordinary cashier cannot unspoil a number via POS. Corrected unused numbers become eligible under the configured method; the correction does not rewind pointers.

### 6.3 Configuration boundaries

Authenticated runtime reads return only eligible choices. Mutations reuse verified `settings:edit`; keep current Application Settings admin page access for this release rather than broadening every tab. Disclose that non-admin holders of settings:edit may need a later separate access review. Cashier issuance permission authorizes the attached spoilage confirmation, not series maintenance. No cashier setting disables mandatory skip confirmation. Do not hardcode VAT/DR method selection in POS.

Remember last selected eligible series per authenticated user + workstation + page, falling back to the configured workstation/context default, then single eligible series. If multiple choices and no valid default, require choice; never silently choose an arbitrary VAT/non-VAT series. A browser workstation identifier is preference scope, not an authorization boundary. Never remember a next number as authoritative local state.

## 7. Tax Behavior and Accounting Boundaries

Reference the existing `tax_rate` and centralized tax-calculation service; do not duplicate percentage math or introduce a new tax engine. Map configured fallback tax rate plus allowed resolved line rates to each sales series. Category and tax designation remain separate from physical serial.

On initial default selection, preselect its fallback tax rate. On deliberate series change in an unposted sale, show confirmation if totals/tax would change; do not silently overwrite a cashier's tax choice. Validate actual server-calculated line treatment, not only the visible fallback. Existing per-part tax precedence can otherwise make a nominal Non-VAT selection misleading. Incompatible resolved treatment blocks final posting with affected lines identified; user changes the series or resolves tax through authorized existing controls.

VAT-designated series may include exempt/zero-rated lines only when explicitly allowed by the configured mapping and supported by the existing tax engine. Rate percentage alone must not relabel legal tax categories. If current tax fields cannot distinguish required categories, document and close that integration gap before activation rather than guessing from names. Mapping changes never recalculate old invoices.

DR, Collection Receipt and Notebook default to preserving the underlying transaction's tax treatment, not adding or removing tax. Number edits alone never change tax. Collection receipts settle payments, not revenue recognition. Notebook sales use normal accounting; choosing Notebook must not create an extra notebook cash-in. Existing notebook cash coverage links remain separate and must be preserved to prevent double counting.

Keep A/R balances sourced from ledger/view or invoice.amount_paid. Preserve PDC pending/cleared behavior, stock/cost accounting, cash-drawer custody/pauses, discounts, credit holds, allocations and existing idempotency. `invoice_payments.reference` and customer instrument references remain for cheque/bank/gateway identifiers, never a fallback physical receipt field.

## 8. Proposed Database / Migration Contract

All names below are **proposed additions**, not verified existing tables. Adapt ID types to actual FK targets. Use forward-only idempotent migrations; never edit applied migration checksums or silently clean historical duplicates.

| Entity | Required fields / constraints |
|---|---|
| `physical_document_type` | id, stable unique code, controlled category, display/short labels, tax designation, default method, active, created/modified actor + timestamps |
| `physical_document_series` | id, type FK, unique stable series code, display name, prefix, method, initial serial, nullable bounds, high-water serial, last-issued serial, version, active, audit fields |
| `physical_document_series_context` | series FK, allowed context; configured default per workstation/context with uniqueness preventing ambiguous defaults |
| `physical_document_series_tax` | series FK, role DEFAULT_FALLBACK or ALLOWED_RESOLVED, existing tax_rate FK; unique pairs; no repeated percentage source of truth |
| `physical_document_registry` | id, series FK, canonical number, exact serial, state PENDING/ISSUED/VOIDED/SPOILED, version, actor/timestamps, issuance request identity; UNIQUE(series_id, canonical_number) |
| `physical_document_source_link` | registry FK; nullable staged_sale/invoice/customer_payment FKs with exactly one source per link; source-role and unique link. Multiple links allowed only for the same document's lifecycle or one explicitly grouped collection |
| `physical_document_event` | append-only event id, registry/series, event type, source/request, before/after, original suggestion, entered value, reason, actor, server time |

Use bounded text compatible with current sales fields (inspect every target width; initial invoice baseline is 50). Serial storage uses exact integer numeric semantics, not floating point. Add nullable type/series/registry references plus explicit `physical_recording_method` (`PAPER`, `NOTEBOOK`, nullable legacy unknown) to invoice, staged_sale and customer_payment where applicable. Enforce valid combinations; Notebook has no paper registry/number/series. A blank legacy number is not automatically Notebook.

Legacy physical_receipt_no columns remain compatible read/display mirrors, written only through the shared service after migration. Registry is authoritative for duplicate/status checks. Add DB constraints/triggers or an equivalent enforced database write path so direct/alternative writes cannot bypass registry consistency; application prechecks alone are insufficient. Retain source-link evidence through void/correction. Used or voided numbers cannot become ordinary reusable numbers; a mistaken assignment requires a narrow audited correction, never wholesale financial replay.

Cross-table uniqueness must be enforced through registry occupancy, not independent per-table unique indexes. One sales document transferred from staging to invoice is not a duplicate. Distinct sales and collection documents may have the same printed text only in distinct confirmed series. Never use a new booklet/series as a way to evade a known duplicate.

Collection grouping: current `/payments` writes one instrument per request. If one physical collection receipt covers multiple instruments, create one document identity with explicit collection-group request identity and attach authorized payment rows; consume the serial once. Do not weaken uniqueness by allowing arbitrary callers to share a number. Define/implement a transactional grouped adapter around the existing payment service if no parent grouping exists. This adapter is required before collection-receipt activation, without rewriting accounting allocations.

### 8.1 Legacy preflight and rollout migration

1. Inventory existing physical fields, indexes/functions/triggers, all write paths and active pending rows; report canonical duplicates and source-linked mirrors separately.
2. Produce reviewed mappings from historical references to confirmed series. Same prefix may span VAT/non-VAT; never infer tax or series solely from prefix or highest number.
3. Preserve original references and unknown recording methods. Unmapped rows retain a conservative legacy conflict check and cannot be silently ignored by a newly enabled series. Require owner resolution where ambiguity would make reuse unsafe; do not invent old spoilage or issuance history.
4. Seed type labels inactive; configure actual series/start values and tax mappings in Settings. Backfill registry and source links with provenance, no financial postings.
5. Replace legacy global lookup/index behavior only after all affected invoice/payment/staging writers use the shared registry and the mapping is validated. Keep compatibility reads; no unguarded rollout interval. Do not touch supplier/GRN indexes.
6. Rehearse on a disposable database including snapshot rollback/redeployment compatibility. Feature activation is last, after owner data review. Disable suggestions to fall back safely if necessary, but never disable occupied/spoiled guards after issuance. Rollback must not remove registry history or reintroduce silent reassignment.

## 9. Proposed API Contract and Transaction Protocol

New endpoint names are proposals under `/api`; preserve existing response conventions and pagination helpers.

| Endpoint | Request | Response / authorization |
|---|---|---|
| GET `/physical-documents/options` | context, workstation_id | Eligible types/series, method, defaults, tax mappings, versions; authenticated + corresponding pos:use / invoicing:create / ar:receive_payment |
| GET `/physical-documents/suggestion` | series_id, context | number, series_version, opaque signed suggestion_token, available/exhausted; advisory only, no claim |
| POST `/physical-documents/validate` | series_id, physical_receipt_no, suggestion_token, authorized source being edited | normalized value, availability, exception_required, tax compatibility feedback; never final proof of availability |
| GET/POST `/settings/physical-document-series` | filters or editor fields | Paginated list / created config; GET administration and all mutations settings:edit |
| PATCH `/settings/physical-document-series/:id` | expected_version, permitted changes, reason for method/state changes | New version/config or conflict |
| POST `/settings/physical-document-series/:id/adjust-sequence` | expected_version, new seed/pointer, reason | Old/new state and preview, audited |
| PUT `/settings/physical-document-defaults` | context/workstation/series assignments and expected versions | Validated defaults, audited |
| GET/POST `/settings/physical-document-spoilage` | list filters / series_id, number, reason, acknowledgment | Paginated history / spoiled registry entry, settings:edit |
| POST `/settings/physical-document-spoilage/:id/correct` | expected_version, reason | Append correction and resulting eligibility, settings:edit |

Type-label/default-method and tax-mapping maintenance may use a companion `/settings/physical-document-types` endpoint and the series PATCH respectively; same versioning and permission rules. Runtime APIs cannot mutate configuration.

Extend existing POST `/api/invoices`, POST `/api/sales/staging`, POST `/api/sales/staging/:id/approve-post`, POST `/api/payments` and related narrow correction/split routes with a shared `physical_document` contract:
- `recording_method`: PAPER or NOTEBOOK.
- `series_id`: required for PAPER, null for Notebook.
- `physical_receipt_no`: current-format string for PAPER; null for Notebook. Existing top-level field retained as compatibility mirror; reject disagreement.
- `suggestion_token`: identifies exact server-issued suggestion/context; not a reservation.
- `exception`: nullable object with reason NEW_BOOKLET / SPOILED_SUGGESTION / OTHER_NOT_SPOILED, original suggested reference, entered reference, optional note, and explicit spoilage acknowledgment when applicable.
- Existing stable issuance idempotency identity; maintain current client_ref/source-request contracts. New request IDs must cover the physical-document subpayload in the request fingerprint.

Server trusts authenticated actor, never submitted employee identity. Verify signed suggestion or stored proposal identity so callers cannot arbitrarily mark unrelated numbers spoiled by inventing a baseline. Tokens bind series, context and suggestion, but do not force stale paper references to change; an unused entered reference may still post after concurrent activity if configuration/tax remain valid and no conflicting spoilage is requested. Expired token refresh retains typed value and requires reconfirmation where relevant.

Success returns actual persisted physical_document identity/state, recording method, unchanged normalized paper number and versions alongside existing transaction response. No claim that paper was printed by FBS. Errors: 400 malformed/format mismatch; 403 unauthorized; 404 missing/ineligible resource; 409 `RECEIPT_NUMBER_TAKEN`, `RECEIPT_NUMBER_SPOILED`, `RECEIPT_DECISION_STALE`, `SERIES_CHANGED` or `SERIES_EXHAUSTED`; 422 `RECEIPT_EXCEPTION_REQUIRED` / `RECEIPT_TAX_INCOMPATIBLE`. Include actionable field errors without leaking unrelated customer details.

Atomic issuance protocol:
1. Resolve completed-request replay first; same key/different payload conflicts. Replays return the original result even if the suggestion has since expired.
2. Start/participate in the existing source transaction; respect existing cash-session/source and source-row locks, then series/registry locks in one documented deterministic order across issuance, spoilage, corrections and staging. Use scoped `FOR UPDATE OF alias` on joined queries. Never hold DB locks during human confirmation.
3. Verify active series/context, canonical input, tax compatibility, source ownership, suggestion/exception acknowledgment and all occupied/legacy conflicts under lock.
4. Persist source, registry/source links, exact spoiled designation, event and pointer changes together; staging is pending as defined in section 4.3. A duplicate or invalid spoofed decision rolls everything back.
5. Commit and return exact result. Network timeout is unknown outcome: retain draft and stable request ID, query/retry that same operation. Never issue another number or duplicate invoice/payment just because the response was lost.

Remove invoice collision auto-increment, staged `-STG-` suffixing, UI promises of reassignment and payment-reference fallbacks. A conflict preserves cart and typed reference and offers refresh/change/review; no background replacement of manual input. Standalone spoiled-number management is its own explicit audited transaction, not dependent on a later unrelated sale.

## 10. Compact POS / Invoicing UI Specification

Keep the existing POS receipt cell's outer position, width, height, padding, two-column grid and adjacent Tax Rate cell. Do not add a permanent row, increase the checkout panel or shift cart/payment controls. Reuse current font, border, surface and dark-theme tokens.

Within the existing input footprint use a single composite control:
- Left: compact short-label dropdown trigger with caret; full type/tax designation and active booklet in accessible label/tooltip.
- Right: editable receipt number, flexible width with min-width zero; focus/horizontal text scroll rather than hiding the reference. Retain existing Ctrl+P focus shortcut.
- Dropdown: eligible types/series, full labels, only show booklet grouping when multiple active booklets exist. Notebook is explicit.
- Popover overlays outside the cell using a portal and viewport collision handling; no layout reflow. Native keyboard navigation, readable labels and adequate hit targets take precedence over decorative density. On narrow widths use short labels, not an expanded permanent row; verify against actual baseline dimensions in browser.

Notebook disables the number input and displays **No physical receipt**; preserves normal tax/cash behavior. Replace the ambiguous proceed-without-receipt path with an explicit Notebook decision when permitted; do not silently relabel historical blanks. Existing required-receipt/payment-method rules must be reconciled server-side: require a valid PAPER number or explicitly allowed Notebook, and retain a hard paper requirement for any context configured to forbid Notebook.

Initial/default suggestion fills only pristine new fields. Never overwrite restored draft/manual input on settings loads, debounce responses or tab visibility refresh. Guard stale asynchronous responses by series/input identity. Changing a dirty series asks before replacing the typed number and clears old pending exception state. Reset after successful issuance fetches a fresh suggestion for the retained eligible selection.

Loading: in-cell progress with no geometry change. Suggestion failure: keep type and manual entry available; display retry in overlay and still enforce server validation. Options failure: retain existing draft, no guessed type; block new typed-mode submission until eligible choices can be validated. Empty eligible list: explain configure in Settings, no fake default. Conflict/validation states use icon/border plus accessible text in overlay rather than permanent growing error rows. Unknown write outcome blocks a new attempt with a different request identity until resolved. Draft storage failure displays explicit recovery warning; never persist credentials or signed authorization secrets in drafts.

Use the same control/behavior in InvoicingPage, CashierApprovalDesk and relevant collection/split-payment surfaces with context filtering. Persist nonsecret recording method, series, typed number and request identity in existing drafts; acquire fresh suggestion proof on restore and revalidate pending exception. History/detail views distinguish Notebook, legacy unspecified, paper type/series and physical reference without changing existing human reference precedence. Corrections use existing `invoice:edit_receipt_no`, shared registry checks and no financial reposting; preserve occupied original paper identity as superseded/voided evidence.

Collection issuance must not overwrite invoice physical_receipt_no or put physical values into instrument reference fields. One receipt covering split instruments uses the grouped identity described in section 8.

## 11. Implementation Phases and Acceptance Criteria

### Phase 1 — Data integrity and migration (Not started)

Deliver schema, registry/source-link constraints, config validation, legacy preflight/mapping, indexes and forward-only migrations. Verify real Postgres uniqueness across sources, Notebook combinations, numeric comparisons, pending claim transfer, spoiled/voided occupancy and migration replay/checksums. No live-data cleanup without owner authorization.

### Phase 2 — Shared service and route integration (Not started)

Implement suggestion/validation/issuance/config/spoilage contracts, all existing writers and correction paths, stable idempotency and grouped collection handling. Remove both source-verified reassignment behaviors. Cover direct sale, staged sale, approval, payment, split and narrow correction paths; no route-specific bypass of the shared service. Verify lock order and source transaction rollback with actual concurrent sessions.

### Phase 3 — Application Settings (Not started)

Implement full list/editor, method and tax mappings, defaults, sequence adjustment and spoiled-number history/correction. Verify page reachability for current admin policy and backend denial for unauthorized mutations. New series activates only after validated initial state and owner mapping review.

### Phase 4 — Connected cashier UX (Not started)

Implement composite receipt control and automatic popover in all included contexts, Notebook, draft restore, stale-request guards, required-receipt policy reconciliation and unchanged POS footprint. Verify in actual browser, not only source or screenshots of fixtures.

### Phase 5 — Verification and rollout (Not started)

Observable acceptance matrix:
1. Pristine eligible form suggests a number without consuming it; abandoning/reopening does not advance state.
2. Normal successful issuance updates the correct series once; another type/register does not accidentally share a pointer.
3. Highest mode never rewinds after lower issuance; last-issued mode continues from a lower or higher override in server commit order.
4. Discontinuous DR jump + New stub marks no spoiled forms, requires no Settings visit, and continues from entered serial after success.
5. Other/not-spoiled leaves original number eligible if later explicitly entered; it is not forcibly the next suggestion.
6. Spoiled confirmation names and blocks only the exact confirmed number. Large jump does not spoil a range; occupied/concurrently claimed numbers cannot be spoiled.
7. Canceled popover, failed sale and abandoned draft persist neither spoilage nor issuance. Staged approval finalizes once and does not conflict with its own pending claim.
8. Duplicate race returns conflict with typed number/cart preserved; no auto-increment, fabricated suffix, or invoice/payment side effect.
9. Stale suggestion/configuration cannot silently change user input or transfer spoilage to another number. Formatting-only edit does not prompt.
10. Notebook consumes no paper number and does not remove tax or create a duplicate cash movement. Existing notebook coverage still offsets prior physical cash correctly.
11. VAT/non-VAT compatibility uses actual resolved line tax, with per-part precedence and supported mixed/exempt cases tested; number edits never alter tax.
12. Collection references stay on collection identity; one collection covering multiple instruments consumes once. Rejected grouping/duplicate does not leave partial payments.
13. Historical backfill, editing old receipts and voids never create phantom fresh issuance, rewind last-issued state or release issued/voided numbers for reuse.
14. Reload after lost successful response retries same identity and returns same source/document; conflicting payload with same key is rejected. No duplicate cash/ledger/stock posting.
15. Direct API calls cannot bypass role/context, tax, spoilage, duplicate or legacy constraints. Registry/source mismatch rejected at database boundary.
16. POS receipt area's measured bounding box and adjacent controls match baseline at representative desktop/mobile widths and zoom. Dropdown/popover accessible with keyboard, Escape/focus restoration, light/dark theme, no clipped reference or overflow/reflow.
17. Legacy ambiguous prefixes/data block unsafe activation; historical references remain readable; GRN/Paperless uniqueness unchanged.
18. Suggestion exhaustion, manual fallback, options failure, session/account switch, concurrent settings edits and draft-storage failure have explicit recoverable states.

Verification commands to select/execute on a verified dev checkout (NOT run in this planning task): focused API/service/database and web tests using repository test configuration; `npm run -w packages/api lint`; `npm run -w packages/web lint`; `npm run -w packages/web build`; migration status/verify through documented scripts against the disposable DB; authenticated browser scenarios above; `graphify update .`. Confirm Jest discovery includes the new database/concurrency suites; standalone DB scripts may require explicit invocation. Record exact commands and actual output, separating mocked tests from real DB and live-browser results.

Performance acceptance targets (proposed, measure on store-like development data): p95 suggestion/availability API <=150ms excluding transport; no per-keystroke request; no whole-table MAX/scan per checkout; indexed lookup by series/serial/state. Incremental receipt-service posting overhead p95 <=100ms excluding pre-existing sale/payment work; no human-wait locks and no checkout UI layout shift. Explain deviations rather than claim unmeasured compliance.

Rollout gate: disposable-DB migration rehearsal and tests, mapping/counter review, accountant/owner tax/stock eligibility review, staged issuance timing resolved, grouped collection verified, current-role walkthrough, two-cashier race/retry test and real-store paper comparison pilot. Production flags/data and deployment remain untouched until separately authorized.

## 12. Explicitly Deferred / Non-goals

- Printing, BIR/CAS registration changes, legal certification and changing statutory tax rules.
- Full physical booklet purchasing/stock inventory, automatic OCR, Paperless linking changes and supplier/GRN reference redesign.
- Auto-spoiling entire gaps or automatic booklet creation from a number jump: intentionally excluded, not backlog defaults.
- Multiple delivery documents per invoice fulfillment redesign; revisit if requested as a separate document-linking project.
- Broad non-admin access redesign of all Application Settings tabs; revisit when a settings-manager role is required.
- New offline/mobile serial reservation/synchronization. Existing mobile/legacy staging must remain compatible under guarded activation; this is not permission to accept unchecked serials or silently assign Notebook. Enable typed series for those clients only when their payloads and replay behavior are compatible.

## 13. Files Touched and Proposed Work Areas

This planning task creates only `docs/plans/2026-10-21_physical-receipt-suggestions-and-tax-selection.md`.

Implementation work areas (proposed; inspect HEAD before choosing exact new filenames):
- New forward-only SQL migrations under `database/migrations/` and focused disposable-DB fixtures.
- Existing `invoiceRoutes.js`, `stagedSaleRoutes.js`, `paymentRoutes.js`, `paymentMethodRoutes.js`, settings/tax routes and related correction paths; shared physical-document service/routes as needed.
- `packages/web/src/pages/POSPage.jsx`, `InvoicingPage.jsx`, `CashierApprovalDesk.jsx`, `SettingsPage.jsx`, shared control/settings components, collection/split forms, relevant history/detail and draft hooks.
- Both receipt format utilities and POS normalization only for parity/reuse; no new formatting policy.
- API/web/integration/browser tests and updated feature/user documentation.

No local-only mockup or chat history is required to implement this plan.

## 14. Verification Record and Change Log

Planning evidence: current branch/status, bounded log/diff, Graphify query, plan conventions, source/migration reads and tool-reported date. Plan publication must be followed by remote read-back and status inspection; the planning session's final response reports that result.

Not performed: application edits, migrations, schema introspection, test/build execution, authenticated UI/paper pilot, production changes, Git commit/push, or remote Graphify update. No remote command runner was exposed; Graphify update remains an implementation follow-up, not a documentation-publication blocker.

| Date | Change |
|---|---|
| 2026-10-21 | Finalized owner discussion: editable per-series suggestions; highest vs last-issued methods; discontinuous new-stub reason; mandatory skip/spoilage confirmation; all configuration in Application Settings; Notebook; existing-format preservation; tax compatibility; same-space POS composite control. Added source-verified reassignment repairs, concurrency/migration contracts, acceptance tests and explicit implementation status. |
