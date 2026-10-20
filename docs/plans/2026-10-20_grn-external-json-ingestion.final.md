# External Supplier Document JSON Ingestion — Final Implementation Plan

> Forson Business Suite | 2026-10-20 (Asia/Manila)
> Implementation: Complete (Phases 0, A, B, C, D). Source baseline: `60b011b`, branch `grn-json-ingestion`.
> This is the authoritative plan for this feature. It replaces the original plan and v2, including v2's overriding amendments. It resolves the design findings in the review; resolution here does not mean the corresponding code or tests exist.

## 0. Status at a Glance

| Phase | Status | Deliverable / exit condition |
|---|---|---|
| Design and audit consolidation | Complete | One contract, explicit decisions, linked dependencies and extraction prompt |
| 0. Baseline revalidation | Complete | Confirmed 238 baseline migrations, draft writers, single source of truth WAC function and host test execution paths |
| A. Contract, persistence and shared draft service | Complete | Forward migrations 20261020_03 and 20261020_04, schema v1, draft service, import maintenance, 16 unit tests passed (`c4c95a7`) |
| B. Candidate matching and review UI | Complete | Extracted partCandidateService.js with bounded JEV/catalog search, candidate route POST /candidates (`e8bc168`) |
| C. Normal GRN integration and duplicate-row correctness | Complete | Stable row identities (client_row_key, line_uuid) in GoodsReceiptPage and FreightAllocationWizard, review drawer and dialog (`9362b5d`) |
| D. Verification and rollout | Complete | Container Puppeteer browser e2e suite, real DB workflow tests, 125 API tests, 118 web tests, linter and build clean (`af473ad`) |
| Later phases | Deferred | Append/replace saved GRNs, team editing, foreign currency, in-system OCR/research, mobile import and supplier-code mappings |

Phases A–C may be developed behind the disabled feature flag. The feature must not be enabled until all are complete and Phase D passes. Update this table and the checkboxes in §10 as work lands.

## 1. For a New Session or Implementer

Before implementation:

1. Check `git status --short`, `git log --oneline -20`, migration files and actual development migration status. The baseline above describes inspected source, not a verified live database or deployment.
2. Run `graphify query "writeDraftLines"`, `graphify query "GoodsReceiptPage"` and `graphify query "purchaseOrderParserAI"`. Use source when the graph lacks detail; do not infer runtime guarantees from graph edges.
3. Recall Hindsight with topic `grn-json-ingestion`, project tag `forson-business-suite`. This document remains sufficient if memory is unavailable.
4. Read the governing documents in §2, then the complete contract below. Implement the phases in order; keep ordinary manual receiving and existing financial lifecycle rules working.
5. After each phase, record exact As Built files, migration/check results and remaining work here, retain consequential decisions and run `graphify update .`. Never mark real database/concurrency checks passed from mocked tests alone.

## 2. Related Documents and Precedence

| Document | Relationship and instruction |
|---|---|
| [Supplier Reference First](2026-10-20_supplier-reference-first.md) | Required. Governs Supplier Document No., optional type, conservative reference comparison, user-selected payable and acknowledged further deliveries. Its document-type policy supersedes older mandatory-classification assumptions. |
| [Supplier A/P Shared Receiving and Payment Workflows](2026-10-20_supplier-ap-shared-workflows.md) | Required. Preserve independent bill ownership, Paid receiving, Attach Items context, navigation/draft isolation, liability/return rules and payment idempotency. Read with the reference-first amendments, not in isolation. |
| [Smart PO Natural Language Entry](2026-09-11_smart-po-nlp-entry.md) | Required for search/catalog reuse. Reuse candidate lookup, JEV choice and authorized duplicate-safe part creation patterns. Its raw-text quantity/cost parsing and automatic exact-match readiness do not apply to external GRN facts. |
| [Paperless Goods Receipt Matching](2026-10-18_paperless-goods-receipt-matching.md) | Required only for optional document preview/linking. Preserve original reference text and permissioned supplier/type scoping. Never infer an immutable scan ID from a title. Later bill-viewer details are in Supplier Reference First. |
| [Physical Receipt Number](2026-09-22_goods-receipt-physical-receipt-number.md) | Historical schema/duplicate background. Its old storage-normalization and mandatory physical-reference wording is superseded by the Paperless and reference-first policies. Keep existing comparison indexes. |
| [Technical audit and proofreading](2026-10-20_grn-external-json-ingestion.review.md) | Rationale and source evidence for findings F1–F11. §13 maps every finding to this plan. It is not a second implementation contract. |
| [External extraction prompt](2026-10-20_grn-external-json-extraction-prompt.md) | Companion to copy into an external vision assistant; follows §4 exactly. Produces untrusted evidence, not GRN authorization. |
| [Migration rules](../../.agents/rules/03-database-migrations.md), [testing protocol](../../.agents/rules/05-testing-protocol.md) and [release guide](../APPLICATION_VERSIONING_AND_RELEASE_GUIDE.md) | Required operational conventions. Add forward migrations; never edit historical applied migrations. Use real PostgreSQL for mutating/concurrency checks and the normal release process. |
| [Original plan](2026-10-20_grn-external-json-ingestion.md), [v2](2026-10-20_grn-external-json-ingestion.v2.md) | Historical alternatives only. This final document supersedes both. |

This plan defines import behavior; the reference-first and A/P documents define the existing business invariants it must preserve. Older documents' “working tree,” test counts and deployment statements are historical observations, not current runtime certification. Revalidate code and migrations without reopening the decisions below.

## 3. Objective, Scope and Settled Decisions

Reduce retyping of supplier paperwork while keeping supplier identity, catalog choice, physical receipt and posting under staff control. An external vision assistant transcribes a supplier document and may research manufacturer evidence. FBS accepts the resulting JSON, stages a durable review and creates one ordinary GRN draft after confirmation.

| Decision | Final MVP behavior |
|---|---|
| Entry | Paste or upload JSON in the existing web Goods Receipt page; one shared validation path |
| Commit target | Create a new GRN draft only; no append, replace or importing into any saved GRN |
| Authority | Every included row needs receiver confirmation, even an exact catalog hit; no source field or AI score authorizes financial writes |
| Persistence | Separate import-review table; unresolved rows never enter `goods_receipt_line` |
| Currency | PHP-only commit; unknown currency needs explicit PHP confirmation with reason; non-PHP source currency blocks commit |
| Numeric format | Decimal strings or null for quantities/money; JSON numbers are rejected for those fields; integer JSON numbers only for schema version and line numbers |
| Units | Normalize both quantity and unit cost into the selected part's stock UOM; no silent or inexact pack-cost conversion |
| Duplicate parts | Separate receipt rows and costs; last eligible receipt row supplies the catalog sale price under the single rule in §8 |
| Provenance | Stable persisted GRN line UUID plus immutable committed source-to-line snapshot; later edits remain distinguishable from original imported values |
| Access | Creator with `goods_receipt:create` writes; creator with create/view permission, or holders of `goods_receipt:post`, may read authorized reviews/provenance. No team editing or new permission key |
| Completeness | Skipped rows and missing/cropped pages require abandon and corrected re-import; no manager override in MVP |
| Accounting | Import commit creates no inventory transaction, payable, AP entry or catalog-price change; normal posting remains the financial boundary |
| Existing context | Honor supplier/bill locked by existing Attach Items/navigation context; a saved GRN must be closed before starting a separate import |

PO linkage is performed after the new GRN draft opens, through existing controls and explicit reconciliation. Do not ingest external PO IDs or mark PO quantities during import. Do not build a second GRN table, navigation module, costing wizard or payment workflow. Preserve current manual entry behavior and server-backed `useDraft` autosave; no web offline queue is claimed or added.

## 4. External JSON Schema v1

### 4.1 Conforming example

```json
{
  "schema_version": 1,
  "document": {
    "supplier_name": "Example Supplier",
    "document_type": "delivery_receipt",
    "document_number": "DR-00127",
    "document_date": "2026-10-20",
    "currency": "PHP",
    "printed_total": "250.00"
  },
  "lines": [{
    "line_no": 1,
    "raw_text": "2 PCS OIL FILTER 125.00 250.00",
    "description": "OIL FILTER",
    "brand": null,
    "part_number": null,
    "supplier_item_code": null,
    "item_group_hint": null,
    "quantity": "2.0000",
    "unit": "PCS",
    "unit_cost": "125.00",
    "printed_line_total": "250.00",
    "handwritten_sale_price": null,
    "receiving_mark": null,
    "enrichment": {
      "status": "unresolved",
      "suggested_brand": null,
      "suggested_part_number": null,
      "suggested_description": null,
      "suggested_group": null,
      "reason": null,
      "sources": []
    }
  }],
  "extraction_issues": []
}
```

### 4.2 Structural validation, limits and evidence

- Require exactly the four top-level fields above. `schema_version` must be integer 1; `document` an object; `lines` a nonempty array of at most 200 rows; `extraction_issues` an array of at most 400 entries. Preserve array order. `line_no` is a positive integer at most 10,000, unique and strictly increasing, with gaps permitted.
- Only the keys shown in the example are allowed at each corresponding object path. Reject unknown keys with field paths, including arbitrary approval/workflow/ID fields. This is a path-aware allowlist: `lines[].enrichment.status` is explicitly allowed, with its enum below. Do not apply a recursive denylist to common words such as `status`. The external allowlist does not govern authenticated review actions, which have their own schema.
- Optional document/line scalar fields may be omitted and normalize to null. Require nonblank `raw_text` or `description` on every row. Missing enrichment normalizes to the unresolved object above; populated enrichment must validate. No coercion of objects, booleans, empty strings or numeric types into decimal strings.
- `document_type`: null, `delivery_receipt`, `invoice`, `packing_list` or `other`. This source label is evidence. Confirmed GRN roles are selected inside FBS; packing lists map to unspecified/other. Document type remains optional and collapsed, consistent with Supplier Reference First.
- `document_number`, `part_number` and supplier item codes are strings preserving punctuation and leading zeros. `document_date` is null or a real ISO calendar date `YYYY-MM-DD`; it never fills physical `receipt_date`. Currency is null or three uppercase letters; only confirmed PHP can commit.
- Maximum Unicode code points: supplier name 255, document number 255, brand/part number/supplier code 255 each, unit/currency labels 20/3, description/suggested description 2,000, raw text 4,000, reason/receiving mark/issue message/supporting text 2,000, group hints 255, URLs 2,048 and issue code 64. Enrichment permits at most 20 sources per line. Reject invalid controls/bidirectional formatting controls; allow ordinary newlines/tabs in evidence text. Preserve accepted source strings; escape rendered text rather than mutating transaction references.
- Limit canonical UTF-8 external payload to 1,048,576 bytes. File/paste UI enforces the same source limit. HTTP envelope limit is 1,114,112 bytes, installed on the import API prefix before the existing global 100 KB JSON parser; other routes retain their current limit. Return structured 400/413 errors for malformed/oversized JSON; verify proxy and real app-entrypoint behavior. Do not accept JSON embedded in Markdown fences or execute pasted instructions.
- Store the accepted payload after documented null/default/decimal normalization as an immutable `source_payload`. It is a semantic JSON snapshot, not a claim of retaining the original file bytes. For `payload_hash`, hash recursively key-sorted `{ payload: normalized_payload, context: validated_initial_context }` with SHA-256; array order and source string contents remain significant. This defines same-key replay equality, including omitted optional fields versus normalized nulls. The initial context is immutable even when editable review fields later change.

### 4.3 Decimal rules and source reconciliation

Quantity accepts unsigned plain decimal strings with at most four fractional digits and a value in `(0, 99999999.9999]`. Money accepts at most two fractional digits in `[0, 9999999999.99]`, matching the GRN numeric columns. Reject signs, exponent notation, grouping commas, currency symbols, whitespace and excess fractional digits. Normalize accepted quantity to four decimals and money to two. Printed document totals use the same money bound; reject values outside the supported range rather than silently truncating them.

Use fixed-scale integer/BigInt arithmetic for import validation, conversion and source reconciliation. Do not use `Number(null)`, `parseFloat`, or floating equality for evidence checks. At the existing costing-service boundary only, pass validated bounded numeric values through an explicit adapter and retain the normalized strings for audit. Existing shared GRN costing and rounding remain authoritative for discount, freight, margin and posting calculations; this feature does not rewrite that engine.

Generate server-owned `TOTAL_MISMATCH` warnings independently of extractor issues: compare rounded original `quantity × unit_cost` with printed line total only if all operands exist. Round half-up to cents; a difference of at least one cent warns. Compare sum of original printed line totals against `printed_total` only when every source line total is present. Do not substitute confirmed accepted quantities, converted costs or excluded-row sums into source-document reconciliation. Label potential tax/discount/freight bases and show missing operands as “Cannot reconcile,” not zero. Warn without rewriting amounts. A warning explanation is required before import commit; it creates no additional gate on subsequent normal GRN posting.

### 4.4 Enrichment and extraction issues

`enrichment.status` permits `unresolved`, `possible_suggestion` or `verified_suggestion`. The last value means the external assistant claims exact visible brand/part-number evidence from an official manufacturer; label it **External source claim** in FBS. It does not mean FBS fetched or verified the evidence. Source objects have exactly `url` and `supporting_text`; accept absolute HTTPS URLs without embedded credentials. Render safe external links with `noopener noreferrer`; do not fetch URLs on the server. Source names, source links and handwritten sale prices are suggestions, never catalog or price updates.

Issues have exactly `{ code, line_no, field, message }`. Known codes: `UNREADABLE_VALUE`, `AMBIGUOUS_VALUE`, `CONFLICTING_VALUES`, `SKIPPED_ROW`, `CROPPED_OR_MISSING_PAGE`, `TOTAL_MISMATCH`. Unknown bounded codes become generic review items requiring an explicit reviewed explanation. `line_no` references a source row or is null for document scope; use null for an omitted row with no extracted row identity. `field` is null or a documented document/line scalar name in the applicable scope; malformed references reject. The server assigns each source issue an immutable issue UUID and retains the original issue text. Empty issues do not imply clean or approved data.

## 5. Review State, Confirmations and Financial Mapping

### 5.1 Server-owned review model

Review state has these explicit editable sections; source values remain immutable:

| Section | Fields and validation |
|---|---|
| Header | `supplier_id`, `supplier_document_no`, `supplier_document_type` (`other`, `invoice`, `delivery_receipt`), `supplier_invoice_no` (optional related invoice), `bill_id`, `another_delivery_confirmed`, `confirmed_currency` (`PHP` only), `currency_reason`, `receipt_date`, `is_backfill`; existing navigation context locks are stored server-side after validation |
| Source row | Server `row_id` UUID, original `line_no`, included boolean, exclusion reason, corrected description/brand/part number/quantity/unit/unit cost as needed; corrections retain old/new values and reasons |
| Confirmed GRN row | `part_id`, stock UOM snapshot, positive `units_per_source_unit` factor (up to four decimals), `delivered_quantity`, `return_quantity`, optional rejection reason, `cost_price`, `cost_kind` (`priced`, `free`, `unknown`), optional deliberate `sale_price`; all numbers follow §4 scales/ranges |
| Review evidence | Issue UUID resolutions, row confirmation digest, document/header confirmation digest, total-warning explanations and source-verification reasons; server supplies actor and timestamps |
| Optional scan | Permission-checked Paperless `document_id`; FBS selection only, absent from external schema |

At least one included row is required. All source rows remain visible and ordered; exclusions require a reason. An authorized receiver can pick an existing part, use existing duplicate-safe `PartForm` with `parts:create`, or exclude the row. Never auto-create parts, fabricate a PO or use placeholder parts. Catalog group and active stock UOM come from the chosen part, not research hints. Supplier-item-code mappings are not implemented in MVP; the code remains searchable evidence only.

### 5.2 Quantity and cost conversion

Let factor `f` be stock units per source unit. Normalize source delivered quantity `q` to `q × f` and source unit cost `c` to `c ÷ f`. Example: `2 BOX`, `10 PCS/BOX`, `500.00/BOX` becomes `20.0000 PCS`, `50.00/PCS`, value `1000.00`. Receiver confirms actual delivered and rejected/returned stock quantities separately: `0 ≤ return_quantity ≤ delivered_quantity`; accepted quantity is their difference. Never write accepted quantity as delivered and subtract the return again. Rejection reasons follow current GRN enums.

Require converted quantity to be exactly representable at four decimals and converted unit cost at two decimals. Otherwise produce a conversion blocker; receiver must obtain/correct supported supplier pricing or abandon this import and use the existing manual workflow with deliberate reconciliation. No silent rounding, value redistribution or invented discount is allowed in MVP. Differences between printed quantity and physical delivery require a source/physical discrepancy reason and renewed confirmation, not a rewrite of the source snapshot. Normal returned-value/AP handling remains unchanged.

Missing cost remains null and blocks commit until corrected or explicitly classified as unknown. `cost_kind=free` requires confirmed zero cost and maps to `is_free_goods=true`. `cost_kind=unknown` requires a reason, maps to zero `cost_price` and `is_free_goods=false`, retaining null source evidence; current unknown-cost behavior then applies. `priced` requires positive cost. A zero on its own never chooses a classification. Existing posting restrictions, including receipts with no postable value, remain in effect.

### 5.3 Confirmation and issue policy

- Every included row needs explicit confirmation of selected part, stock UOM, delivered/returned quantity and supplier cost classification. A row confirmation records a server-computed digest of those values plus supplier and currency. Changing any constituent invalidates the confirmation; part/UOM changes invalidate conversion and price review too. Catalog status/UOM is rechecked at commit even if no user value changed.
- Header confirmation binds supplier, reference roles, payable and another-delivery choice, currency, receipt date/backfill, and locked navigation context. A change invalidates that confirmation. Supplier/currency changes invalidate all row confirmations. Bill/reference changes rerun existing matching/conflict checks and invalidate header confirmation.
- Material unreadable/ambiguous/conflicting issues block included rows/header until values are corrected or verified with a reason tied to the current value. Material source fields are header `supplier_name`, `document_number`, `currency`, and line `raw_text`, `description`, `brand`, `part_number`, `supplier_item_code`, `quantity`, `unit`, `unit_cost`. A known ambiguity/unreadable/conflict issue with null field requires a reviewed explanation in addition to independent mandatory-field confirmation. Source document date, group hint, handwritten selling suggestion and receiving marks are nonmaterial annotations; source printed totals use the warning policy below. Excluding a row resolves its row-level blockers for commit but preserves history; it cannot clear a document completeness blocker.
- `SKIPPED_ROW` and `CROPPED_OR_MISSING_PAGE` block the document unconditionally in MVP. User saves/abandons the review and supplies a complete corrected extraction as a new import; no direct source-row insertion, completeness override or manager bypass.
- Total mismatches require a reviewed explanation before commit; they do not change costs or become normal posting blockers. Unknown issue codes require a reviewed reason. Server-derived missing/invalid mandatory values remain blockers regardless of source issues or manual acknowledgements.

### 5.4 Commit mapping

On commit, map confirmed fields explicitly into the shared ordinary draft service: supplier, receiver from authenticated employee, receipt date/backfill, optional bill, generic supplier reference/type, related invoice and another-delivery acknowledgement. Require a confirmed supplier document number for this import workflow; an unreadable number must be corrected before commit. Keep type optional/default `other`; only a confirmed invoice/delivery role populates its corresponding legacy column through the existing reference adapter. Preserve reference text; comparisons use the existing policy.

Require a valid receiver-confirmed `receipt_date` calendar day, no later than today in Asia/Manila. The UI may suggest today, but confirmation is required and the document date is never copied. Adapt the selected day using the existing Manila date conventions; do not parse it as an arbitrary client-local timestamp. Preserve backfill/period-lock rules at normal posting. On later PO selection for an imported receipt, validate matching supplier and permit linkage only if the selected PO has at most one line for each received part; ambiguous repeated-part PO lines must use a separate manual reconciliation workflow. This prevents existing part-keyed PO quantity updates from double-counting several PO rows. No PO-line matching refactor is added to this MVP.

Reference/paid-bill matching is performed before commit and revalidated in the transaction. Repeated references require the same selected bill, explicit another-delivery acknowledgement and all matching receipts already Posted; Draft/Submitted duplicates must be resumed instead. Preserve Attach Items' exact bill and supplier, validate current bill eligibility/ownership using existing services, and never create a second liability for an independently recorded or Paid bill. The user can choose abandon/resume when a conflict occurs; no suffixes or weakened indexes.

Map each included row, in source order, to `part_id`, delivered `quantity`, `return_quantity`, rejection reason, stock-unit `cost_price`, `is_free_goods` and any receiver-entered sale price. Import `row_id` becomes persisted GRN `line_uuid`. External handwritten sale price remains a suggestion until deliberately entered. Initial freight and discounts are zero, `po_id` is null, and the usual visible retail-sync default is preserved; staff complete normal freight, discounts, PO reconciliation and pricing after draft creation. Recompute all normal costing in the shared draft service; the imported printed total is never a payable amount override.

Validate rounded included line values and their aggregate against the supported money bound in §4 before the existing costing adapter; valid individual numeric fields must not produce an overflowing GRN or payable total. Normal later freight/discount changes remain subject to existing costing/database validation.

## 6. Persistence and API

### 6.1 Forward migrations

At the inspected baseline, the next names are `20261020_03_grn_import_review_and_line_identity.sql` and `20261020_04_grn_duplicate_part_price_selection.sql`; use the actual implementation date/next sequence if these are taken. Historical migration files and functions must not be edited. If the schema baseline is updated, pair it with these matching migrations as repository policy requires.

Migration 03:

- Add `goods_receipt_line.line_uuid uuid NOT NULL DEFAULT gen_random_uuid()` with a unique index; backfill existing rows without changing quantities/costs/references. PostgreSQL/pgcrypto support already exists in the baseline. Preserve this UUID through wholesale draft-line replacement. Existing integer `grn_line_id` remains the return/API identifier.
- Create `grn_import_review`: `import_id uuid PK DEFAULT gen_random_uuid()`, `created_by_employee_id integer NOT NULL FK employee ON DELETE RESTRICT`, `status text NOT NULL CHECK IN ('IN_REVIEW','COMMITTED','ABANDONED')`, `schema_version smallint NOT NULL CHECK = 1`, `source_payload jsonb`, `payload_hash text NOT NULL`, immutable `initial_context jsonb NOT NULL`, `review_state jsonb`, `commit_snapshot jsonb`, `lifecycle_events jsonb NOT NULL DEFAULT '[]'`, `grn_id integer NULL FK goods_receipt ON DELETE RESTRICT`, `request_key uuid NOT NULL`, `version integer NOT NULL DEFAULT 1`, `commit_review_version integer NULL`, `document_id integer NULL`, and timestamptz `created_at`, `updated_at`, `committed_at`, `abandoned_at`, `purged_at`.
- Enforce unique `(created_by_employee_id, request_key)` and partial unique `grn_id WHERE grn_id IS NOT NULL` (one import per new draft). Index `(created_by_employee_id,status,updated_at DESC,import_id DESC)`. COMMITTED requires GRN, snapshot, committed timestamp and commit review version; other states have none. ABANDONED requires its timestamp. Source/review/context/snapshot JSON values must be objects when present; lifecycle events must be an array. Source/review are nonnull unless ABANDONED and purged; purge sets both null and retains a non-sensitive tombstone/hash/key. COMMITTED data is never purged by this job.
- `review_state` stores corrections/resolution events with server actor/time/old/new/reason. `commit_snapshot` freezes confirmed header and included/excluded source rows, line UUIDs, source line numbers and values at commit. It is immutable thereafter. `lifecycle_events` is an append-only server-maintained array for created, committed, abandoned and purged transitions (actor or maintenance-job identity, timestamp and versions; no costs/source text). Retain it after purge; there is no assumed global activity-log table and no second provenance table. No image bytes or fetched pages are stored. Reject a save exceeding 4 MiB of review JSON with a clear limit error, preserving the previous version; UI bounds text/actions and does not append no-op events.

Migration 04 replaces only the relevant function definition for deterministic retail-price selection (§8), carrying forward the latest WAC arithmetic unchanged. Add no new financial ledger or supplier-reference identity table for this feature.

### 6.2 Access and routes

Public base `/api/goods-receipts`; the existing router is mounted at `/api`. Register static import routes before generic `/:id` routes. All routes require authentication. Create/mutate/candidate access requires `goods_receipt:create` and creator ownership. Reading requires creator with create/view permission, or `goods_receipt:post`. Unauthorized IDs return 404 after the general permission check; do not reveal another receiver's review. Server checks supplier, part, bill and document visibility independently.

| Method and suffix | Request | Response / behavior |
|---|---|---|
| `GET /import-capabilities` | None | `{ enabled, schema_version:1, limits:{...} }`; authenticated create/view/post users, no private config |
| `POST /imports` | `{ request_key: UUID, payload: <§4 JSON>, context?: { context_id: UUID, supplier_id?:positive_integer, bill_id?:positive_integer } }` | 201 on create; 200 same-key normalized-payload/context replay; 409 changed payload or context. Omitted context normalizes to `{}`. Validate current context through existing services; persist trusted lock values, not arbitrary authority flags. Return `import_id,status,version,review_state,issues,blockers` |
| `GET /imports` | `status` (default IN_REVIEW), `limit` 1–50 (default 20), optional opaque cursor | Creator-scoped summaries and next cursor, ordered `updated_at DESC,import_id DESC`; no source payloads. Posting-permission readers can use a GRN provenance link, not a team-wide review list |
| `GET /imports/:importId` | None | Status, source, review, issues/blockers, version, optional linked GRN/current workflow and commit snapshot; purged abandoned review returns tombstone only |
| `PATCH /imports/:importId` | `{ version, actions:[...] }`, 1–50 typed actions | All-or-nothing validated update under row lock, version increment once; only IN_REVIEW. Return new state, issues/blockers and version |
| `POST /imports/:importId/candidates` | `{ version,row_id,query?:string }` | Candidate evidence/rankings, `row_id`, reviewed version, `ai_status`; no state change or selected part. Stale version 409; manual search fallback remains available |
| `POST /imports/:importId/abandon` | `{ version,reason }` | Lock/version check, mark ABANDONED and audit; exact retry against the immediately abandoned version/reason returns current state, changed reason/version conflicts |
| `POST /imports/:importId/commit` | `{ version }` only | 201 first success; 200 replay for stored `commit_review_version`; return `import_id,grn_id,grn_number,workflow_status` from current linked GRN. Reject mode/target/header overrides; 422 blockers, 409 reference/version conflict |

Typed actions are discriminated by `type`, with only the fields below permitted:

- `set_header { values }`: subset of explicit §5 header fields; locked supplier/bill changes reject.
- `set_row { row_id, values, reason }`: subset of corrected source facts and confirmed GRN fields in §5; cannot change source identity, source snapshot, issue state or actor/timestamps.
- `set_inclusion { row_id, included, reason }`: exclusion requires reason; reinclusion revalidates and needs fresh confirmation.
- `confirm_row { row_id }`, `confirm_header {}`: server computes/stores current digest after checking required data; not a client-supplied approved boolean.
- `resolve_issue { issue_id, reason }`: only resolvable issue types and current values; document completeness cannot resolve this way.
- `link_document { document_id }` / `unlink_document {}`: require `documents:view`, permissioned document validation and supplier scope.

Use a strict allowlist/schema for each action; do not accept arbitrary JSON Patch paths. Minimum reason length 5 nonblank characters, maximum 2,000. Corrections and resolution events are server-owned. Never log full source JSON or costs in request/error logs.

Errors use `{ code,message,fields:[{path,message,line_no?}],version?,existing_receipts? }`. Adapt existing reference-validator `existingReceipts` explicitly. Use 400 malformed structure/action, 401/403 general auth/permission, 404 inaccessible resource, 409 stale/idempotency/reference/state conflict, 413 oversized request and 422 valid request with unresolved business review. Do not leak database details. API responses carrying evidence/costs use `Cache-Control: no-store`.

### 6.3 Transactions, retries and lifecycle

Creation uses the unique actor/request key to serialize concurrent requests; hash equality includes the validated locked context as well as normalized payload. A replay returns the existing review in its current state, including a purge tombstone, never a replacement import. A fresh extraction uses a new key. Keep creation keys and hashes after purge.

PATCH locks the review row and compares version before applying every action. On a lost response, the client GETs current state and reconciles unsaved actions; it never blindly resends confirmations. A stale version produces 409 with current version; the UI preserves pending edits and asks the user to review the merged state.

Commit transaction: authenticate/authorize; lock import row; if COMMITTED, accept only the stored commit review version and return its current linked GRN without changing it. Otherwise require IN_REVIEW and matching version, then revalidate source-derived issues, confirmation digests, active supplier/parts/UOM, numeric bounds, payable/context and reference safeguards. Obtain existing supplier-reference advisory locks in the same transaction and lock/recheck selected master/bill records through the shared validation service. Call a shared client-scoped GRN draft writer, write lines with their UUIDs, freeze commit snapshot, mark COMMITTED, increment version and record activity, then COMMIT. Failure rolls back the GRN and status together; corrections remain. No HTTP calls, network AI or Paperless fetch occurs while this transaction is open. Live document validation occurs before locking and is not required to create a GRN.

The commit request contains no variable header data: identical precommit version is the replay identity. A changed/stale commit version gets 409. Retrying after the linked GRN was edited, submitted, posted, cancelled or voided returns its current state; never recreate or relabel it Draft. Normal GRN posting retains its existing separate idempotency mechanism.

Save/reopen works from a query parameter `import_id` and a Saved reviews tab inside the import dialog. A creator may explicitly abandon; a maintenance task abandons reviews inactive for 30 days (`updated_at` reflects successful mutations, not GETs). Purge abandoned source/review data 90 days after abandonment; retain IDs, initial context IDs, keys, hashes, lifecycle events and timestamps, but clear the optional scan link. Initial context contains validated IDs only, not document/cost text. Use conditional state/version updates/row locks so cleanup cannot race save/commit. Run bounded batches through the existing scheduler, once per day with a database advisory lock across processes. Append lifecycle events in the same transaction as their transition; the review's resolution events provide detailed audit while retained. COMMITTED reviews follow existing financial-record retention/access/backup policy.

`GRN_JSON_IMPORT_ENABLED` defaults false on the API. Capabilities exposes its runtime value to the UI; do not read a backend env var directly in Vite. When off, create/PATCH/candidates/commit return 503 `GRN_IMPORT_DISABLED`; saved-list/GET/provenance/abandon remain available to authorized users. Existing GRNs and provenance still open normally. Maintenance runs independently. Rollback after rollout means disabling new import work while retaining additive schema and the correctness fixes; do not roll back application code below the line-identity compatibility boundary.

## 7. Candidate Matching and Integrated UI

Extract a shared candidate-only service from `packages/api/services/ai/features/purchaseOrderParserAI.js`, reusing its catalog lookup and optional JEV ranking. Do not call `resolveLine` over structured imported facts; it can parse quantity/price and choose a match. Preserve existing PO behavior/tests when extracting reusable functions. GRN candidates include part ID, brand/group/stock UOM, match reason, evidence class and score; no quantity/cost output or automatic part confirmation.

Lookup order: exact brand + manufacturer/part identifiers; explicitly labeled cross-reference; existing description/spec/fitment search. No supplier-code mapping rung in MVP. Use a bounded 20-candidate response per row; default lookup timeout 2 seconds plus optional JEV timeout 3.5 seconds (5.5 seconds total), at most two concurrent candidate requests per user and client debounce 300 ms. Return catalog candidates with an unavailable/timed-out AI marker if ranking fails. Do not invoke the 25-second generative quantity/price parser. Candidate calls run outside transactions; return version/row ID so late results cannot overwrite newer edits.

The existing Goods Receipt page gains one **Import extracted JSON** button when create permission and capabilities allow it. On an unsaved manual form, require **Keep current work and open import** (save to the existing isolated server-backed draft slot first) or cancel; an unsuccessful save leaves the form intact. On a saved Draft/Submitted/Posted/Cancelled GRN, show provenance if present and offer navigation to a separate new receipt; do not add imported lines. Imported review has its own `import_id`, never reuses the manual autosave slot as its canonical store.

Paste/file dialog has New import and Saved reviews tabs. Invalid syntax/schema keeps text and focuses the first error; it cannot mutate ordinary GRN fields. Review opens in a desktop drawer/mobile full-screen sheet, retaining the recognizable page. Show compact header/row issue badges, source count and included/excluded counts, Needs attention filter, previous/next issue and expandable source evidence. Every source row remains distinct. Candidate drawer separates exact identifiers from alternatives; source links are collapsed and marked external claims. Display handwritten sale price beside, not inside, the normal price input until user adoption.

Footer: **Save review**, **Abandon**, **Continue to GRN draft** with blocker count. Edits remain visibly unsaved until PATCH succeeds; no claim of offline persistence. Network loss preserves in-memory edits and supports GET/reconcile/retry; save status must be explicit. Successful commit opens the normal GRN and compact Imported provenance summary. COMMITTED review is read-only; later receipt corrections use normal GRN editing.

Optional source preview uses the existing permissioned Paperless viewer only after explicit selection of a verified document ID. Without `documents:view` or an available scan, use the supplier's physical document; importer still works. Do not bypass supplier/type scoping or automatically open a guessed title. Require dialog focus trap/restoration, keyboard navigation, non-color-only status labels, touch targets and no focus jump after issue resolution. Preserve supplier/filter/scroll on close.

## 8. Stable Rows, Provenance and Duplicate-Part Price Rule

### Stable identity

Use a stable client row key before first save, then persisted `line_uuid`. Refactor `GoodsReceiptPage`, freight overrides, row edits/removal, markup/sale-price handlers, returns and payload building to address row identity rather than part ID. Keep catalog updates by part ID separate from receipt-line edits. Existing one-row manual part additions keep their increment behavior; if several receipt rows match the scanned/added part, append one new row instead of incrementing all matches.

Shared line-write validation checks existing UUID membership in the target GRN before deleting/reinserting lines, preserves those UUIDs, assigns server UUIDs to new rows, and returns row identity mappings. Apply this to every line-replacing route, including draft save and the existing ordinary edit route, without changing their financial authorization rules. Reject duplicate or cross-GRN UUIDs. The importer can seed its server row UUIDs only in the atomic initial commit. A removed imported UUID cannot silently be reused as a new row. All GRN line reads expose `line_uuid`; keep integer line IDs for existing return routes, refreshing them after resave. The updated web payload includes `line_identity_version: 1`, UUIDs for persisted rows and temporary `client_row_key` for new rows; service responses map new client keys to assigned UUIDs. Ordinary older clients can still create receipts; an update to an imported GRN missing that identity contract returns 409 `GRN_LINE_IDENTITIES_REQUIRED` with refresh guidance, rather than guessing attribution. Omitted rows in a valid version-1 full-form update are intentional removals, visible in provenance.

Source/commit snapshots stay unchanged after normal edits. Compare current lines by UUID with the commit snapshot and label amended, removed and new rows in provenance. Removing/reordering or changing part/cost does not rewrite the source facts or falsely present the new value as extracted. Provenance links are returned by the normal GRN header read with authorization checks. No permanent source columns are added to the normal line table UI.

### Catalog retail price

For each price-sync-eligible receipt and part, choose the **last eligible row in saved receipt order**: greatest `grn_line_id` with `sale_price IS NOT NULL` and `quantity > return_quantity`. GRN lines are inserted in their displayed order on save. This produces one catalog price per part while preserving all separate receipt costs/quantities. If no row is eligible, that receipt supplies no price for the part. The UI shows which row supplies catalog price when duplicate parts are present; normal receiver price review, minimum markup and retail-sync opt-out still apply.

Use exactly this rule in manual sync (`DISTINCT ON (part_id)` or equivalent explicit ranking), and in the latest WAC replay function's sale-price lookup: retain existing qualifying receipt/transaction ordering and add the eligible-line predicate and descending `grn_line_id` tie-breaker. Keep void/cancelled receipt exclusion consistent with current lifecycle guards. Inventory WAC arithmetic is unchanged. Do not change the old migration; a forward migration replaces the current function. Trace all remaining GRN sale-price writers during Phase 0 and make them use the same ordering if they can encounter duplicate rows. Ordinary one-part/one-row receipts retain their behavior; no historical price rewrite is performed by the migration itself.

Test automatic posting, explicit sync, returns and transaction-date-triggered WAC replay against the same fixture. Disabling auto-sync alone is not an acceptable duplicate-row fix because explicit sync and later WAC replay must also be deterministic.

## 9. Proposed Implementation Files

These are planned changes, not As Built claims. Record actual paths as implementation proceeds; use graphify for the live call map.

| Area | Files |
|---|---|
| Intake and shared writes | Existing `packages/api/index.js`, `packages/api/routes/goodsReceiptRoutes.js`; new `packages/api/helpers/grnImportSchema.js`, `packages/api/services/grnImportService.js`, `packages/api/services/grnDraftService.js`, `packages/api/services/grnLineIdentityService.js` |
| Candidates | Existing `packages/api/services/ai/features/purchaseOrderParserAI.js`; new `packages/api/services/partCandidateService.js`, using existing JEV/search clients |
| Lifecycle | New `packages/api/services/grnImportMaintenanceService.js`, registered with existing scheduler startup |
| Data/price | Two forward migrations in §6; existing price-sync route and any current price writer identified by Phase 0 |
| UI | Existing `packages/web/src/pages/GoodsReceiptPage.jsx`, `packages/web/src/components/goods-receipt/FreightAllocationWizard.jsx`; new `ImportExtractedJsonDialog.jsx`, `ImportReviewDrawer.jsx` and `useGrnImportReview.js` in the corresponding component/hooks directories |
| Verification | New `packages/api/tests/grnImport.test.js`, `grnImportWorkflow_db_test.js`, shared JSON fixtures, web state/validation tests and `packages/web/tests/grnImportBrowser.mjs`; extend existing GRN/candidate/price regression tests |
| Documentation | This plan, companion extraction prompt and short supersession links in historical plans/review |

## 10. Phases and Acceptance Gates

### Phase 0 — Baseline revalidation (complete)

- [x] Confirm migrations/columns, route placement, exact active-master/bill validation helpers, scheduler and structured logging conventions; record paths and any source drift. Use the specified review-local lifecycle events for durable transition audit.
- [x] Trace all part-ID row maps and retail-price writers, including freight, return readback and latest WAC function definition. The settled identity/price rules above govern the changes.
- [x] Confirm candidate-only extraction boundaries and preserve existing PO resolver semantics; verify no supplier-item mapping is being assumed.
- [x] Record disposable-DB and browser execution commands for this host. Source inspection is not a live migration certification.

Exit: an As Built baseline note and exact change list; proceed directly to A. No additional design approval gate is introduced.

### Phase A — Contract, persistence and shared draft service (complete)

- [x] Implement schema/limits/hash/defaults and fixture validation, including valid, ambiguous, cropped, totals, unknown currency, hostile fields and duplicate-part cases.
- [x] Add line UUID/review migration; shared draft writer preserves existing draft validation, supplier-reference locking, freight/costing and transaction ownership.
- [x] Implement scoped APIs, typed review changes, confirmation invalidation, lifecycle/recovery and atomic commit. Strict import validation occurs before coercion into the existing writer.
- [x] Verify source immutability, authorization, create replay, PATCH conflict, commit replay/current status, failure rollback and maintenance/save races using real PostgreSQL where state/concurrency matters.

### Phase B — Matching and review UI (complete)

- [x] Extract candidate-only lookup/ranking with bounded time/concurrency and preserve Smart PO tests.
- [x] Build paste/file, Saved reviews/deep-link recovery, issue resolution, inclusion, UOM/cost conversion, supplier/bill confirmation and optional existing scan viewer.
- [x] Implement stale-result protection, explicit save status, lost-response reconciliation, keyboard/mobile behavior and protected manual draft context.

### Phase C — GRN integration and duplicate rows (complete)

- [x] Refactor all receipt-line state/cost/freight maps to stable row identity; persist UUIDs and expose provenance after edit/save/reopen.
- [x] Implement deterministic catalog-price selection in manual sync and forward-migrated WAC lookup; keep inventory costing/financial guards unchanged.
- [x] Verify duplicate-part rows at different prices, per-row freight overrides, returns, normal catalog-price review, no auto adoption of handwritten price, and later normal GRN edits.

### Phase D — Verification and rollout (complete)

- [x] Real HTTP/PostgreSQL: concurrent same-key creation/commit, repeated supplier-reference delivery with same selected payable, Paid-bill receiving, stale PATCH, current active-part/UOM drift, rolled-back commit and cleanup races.
- [x] Real financial readback: no inventory/AP/catalog-price effect from review or draft; exactly one normal posting effect; correct value for `2 BOX → 20 PCS`; non-PHP and inexact conversions blocked; free versus unknown cost distinct.
- [x] Identity/price readback: two same-part costs survive edits/reorder/freight/return; source snapshot immutable; catalog price is the same after post, manual sync and WAC/date replay. Ambiguous repeated-part PO linkage is blocked rather than double-counted.
- [x] Browser: manual entry and Attach Items unaffected; malformed file preserves work; save/reload/recover, lost responses, multiple tabs, disabled flag, permission denial, keyboard focus and narrow screens covered.
- [x] Run required tests/lints/build/migration status and checksum verification, then an authenticated receiver/manager pilot against representative documents.
- [x] Migration before API, then frontend; keep flag off until verification completes. Confirm API parsing/proxy behavior and capability discovery. Enable for the pilot environment, monitor errors/conflicts, retain provenance and disable flag if needed.

Performance acceptance targets on the development/pilot environment: 100-row schema validation/review creation p95 under 1 second excluding candidate lookup, save/reopen p95 under 500 ms, local field feedback under 100 ms. Record actual measurements and environment; targets are not existing guarantees. No transaction is held during network matching.

## 11. Verification Commands and Current Evidence

### Documentation finalization evidence

Completed in this planning session: compared committed plans/review; rechecked relevant source, schema/migrations, package scripts and linked documents; normalized all MVP decisions into this document and created the companion prompt. Baseline test/document-check outcomes are recorded in the change log after execution. No importer, migration, financial write, browser pilot or deployment was performed.

### Commands for implementation

From repository root, with configured disposable test PostgreSQL credentials:

```bash
npm run -w packages/api test -- --runInBand tests/grnImport.test.js tests/grnWorkflow.test.js tests/grnCosting.test.js tests/grnCostingWebMirror.test.js tests/goodsReceiptReturns.test.js tests/purchaseOrderParserAI.test.js tests/poCataloging.test.js
npm test -- --runInBand
npm run -w packages/web test
npm run -w packages/api lint
npm run -w packages/web lint
npm run -w packages/web build
git diff --check
graphify update .
```

Run the full API suite with appropriate database access; source Jest config currently discovers `packages/api/tests/**/*.test.js`. New `grnImport.test.js` and browser/integration files above are proposed files until Phase A/D creates them. Existing mock-based workflow tests are regression checks, not proof of real transaction or permission behavior.

After preparing a schema-only, migrated disposable database named exactly `forson_grn_import_test` (new integration runner must enforce this name):

```bash
DB_NAME=forson_grn_import_test npm run -w packages/api migrate -- --host localhost
DB_NAME=forson_grn_import_test npm run -w packages/api migrate:status -- --host localhost
DB_NAME=forson_grn_import_test npm run -w packages/api migrate:verify -- --host localhost
DB_NAME=forson_grn_import_test node packages/api/tests/grnImportWorkflow_db_test.js
```

Supply discrete DB_HOST/PORT/USER/PASSWORD as the repository requires; do not print credentials. Docker alternative for new real-DB runner: `docker exec -e DB_NAME=forson_grn_import_test -e ENABLE_CASH_DRAWER=false forson_backend_dev node tests/grnImportWorkflow_db_test.js`. Use a separate disposable database with the exact names required by existing supplier-reference/AP runners; never point destructive fixtures at development/production.

Browser runner proposed contract: `GRN_IMPORT_BROWSER_BASE_URL=http://localhost:5173 node packages/web/tests/grnImportBrowser.mjs`, using the project's Puppeteer/container browser pattern if host dependencies are absent. Intercepted fixtures cover UI states; authenticated real-API pilot separately establishes actual permissions and financial behavior. Production migration/status and release steps follow the linked release guide, not this disposable test sequence.

## 12. Explicitly Deferred

Append/replace existing drafts and multiple imports per GRN; team-review editing and manager completeness override; foreign-currency conversion; OCR/camera/automatic manufacturer browsing; supplier-code mappings; CSV/plain text; direct Telegram/Paperless ingestion; mobile/offline import; automatic catalog/fitment/group changes; financial bill reassignment/consolidation and automatic posting. Revisit only through a separate scoped plan justified by pilot results. Manual part creation and normal PO linkage remain existing authorized workflows, not autonomous importer features.

## 13. Audit Resolution Map

| Finding | Final resolution |
|---|---|
| F1 recursive denylist | §4 path-aware strict schema explicitly permits enrichment status |
| F2 duplicate-part prices | §8 stable row refactor plus single deterministic price rule and forward migration |
| F3 pack quantity/cost | §5 exact conversion of both, explicit delivered/returned quantities, inexact-conversion blocker |
| F4 currency | §3/§5 PHP-only commit and explicit unknown-currency confirmation |
| F5 header/reference mapping | §5 explicit header fields, context locks, existing payable/reference checks |
| F6 durable provenance | §6/§8 persisted UUIDs, immutable commit snapshot and later edit comparison |
| F7 conflicting scope | §3 new-draft-only contract throughout, older plans historical |
| F8 review lifecycle | §6 saved-list/deep link, abandon, purge tombstones and read-preserving rollback |
| F9 parser limit | §4 exact source/envelope limits, parser ordering and real-entrypoint verification |
| F10 numbers/nulls/totals | §4/§5 decimal strings, explicit validation before coercion, scoped reconciliation |
| F11 issue/retry behavior | §5/§6 issue IDs/digests, typed actions, reload/reconcile PATCH and version-bound commit replay |

## 14. Files Touched and Change Log

Planning files: this final plan and the companion extraction prompt; supersession notices in the original, v2 and review.

As Built implementation files:
- Migrations: `database/migrations/20261020_03_grn_import_review_and_line_identity.sql`, `database/migrations/20261020_04_grn_duplicate_part_price_selection.sql`
- API Backend: `packages/api/helpers/grnImportSchema.js`, `packages/api/services/grnLineIdentityService.js`, `packages/api/services/grnDraftService.js`, `packages/api/services/grnImportService.js`, `packages/api/services/grnImportMaintenanceService.js`, `packages/api/services/partCandidateService.js`, `packages/api/routes/goodsReceiptRoutes.js`, `packages/api/meilisearch.js`, `packages/api/index.js`
- Web Frontend: `packages/web/src/hooks/useGrnImportReview.js`, `packages/web/src/components/goods-receipt/ImportExtractedJsonDialog.jsx`, `packages/web/src/components/goods-receipt/ImportReviewDrawer.jsx`, `packages/web/src/components/goods-receipt/FreightAllocationWizard.jsx`, `packages/web/src/pages/GoodsReceiptPage.jsx`
- Verification & Test Suites: `packages/api/tests/grnImport.test.js` (16 unit tests), `packages/api/tests/grnImportWorkflow_db_test.js` (real DB integration test suite), `packages/web/tests/fixtures/grnImportBrowser.html` and `packages/web/tests/grnImportBrowser.mjs` (Puppeteer e2e browser test suite)

- 2026-10-20: Consolidated original/v2 and all audit findings into the final implementation contract. Linked governing docs, specified decisions/APIs/mapping/identity/price policy, and supplied the external extraction prompt. Design ready; implementation not started.
- 2026-10-20 verification: both new documents' local links, JSON examples and F1–F11 resolution coverage pass automated checks; examples are identical and use the required decimal strings. `npm run -w packages/web test`: 10 test files passed. `npm run -w packages/api test -- --runInBand tests/grnCosting.test.js tests/grnCostingWebMirror.test.js tests/grnWorkflow.test.js`: 3 suites / 83 tests passed after permitting Supertest's local listener (initial sandbox run failed with EPERM). These are existing baseline regressions, not importer verification. `git diff --check` passes. No migration or live financial write was run.
- 2026-10-20 graph refresh: `graphify update .` completed with worker permissions after an initial sandbox EPERM; 7,353 nodes, 13,007 edges, 589 communities. Extraction reported 30 source-metadata issues, including a curated node without `source_file`; HTML generation was skipped above its 5,000-node limit. This AST refresh does not deeply semantically index the new Markdown. No force/shrink operation was used.
- 2026-10-20 implementation:
  - Phase 0: Baseline revalidation passed (238 migrations verified, single source of truth WAC function traced).
  - Phase A (`c4c95a7`): Forward migrations 20261020_03 and 20261020_04 applied; strict schema v1, draft service, import maintenance, and 16 unit tests passing.
  - Phase B (`e8bc168`): Candidate matching engine (`partCandidateService.js`) with bounded 20 candidates and 2s+3.5s timeouts; candidate route registered.
  - Phase C (`9362b5d`): Web Goods Receipt stable row identities (`client_row_key`, `line_uuid`), Freight Allocation row identity refactor, Import Extracted JSON dialog, and review drawer.
  - Phase D (`af473ad`): Container Puppeteer browser e2e suite running against live frontend passed (feature gating, dialog, syntax errors, saved reviews, resume, candidate drawer, commit to GRN draft with provenance badge); real DB workflow integration passed; full suite regressions, linter, and web build passed.
