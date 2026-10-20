# External Supplier Document JSON → Existing GRN — Final Feature Plan

> Forson Business Suite | Design status: finalized for developer handoff; implementation of this import feature **not verified / not started**. Repository branch observed: `ap-bug-fixes-and-improvements`. This document is a design, not a claim of code, database migration, live testing, commit, or deployment.

## 0. Status at a Glance

| Phase | Status | Boundary |
|---|---|---|
| Existing receiving foundation | Inspected, not changed here | `GoodsReceiptPage.jsx`, `goodsReceiptRoutes.js`, GRN draft/submit/post, supplier-reference safeguards, Smart PO matcher exist in inspected source. See §3. |
| A. Import contract and review persistence | Not started | Schema v1, validation, staged review storage, duplicate/idempotency guard. |
| B. Catalog resolution and issue handling | Not started | Reuse existing search and Smart PO resolver components; make AI advisory only; line/header issue resolution. |
| C. Integrated GRN UX and commit | Not started | Small Import action in existing receiving screen; reviewed rows become normal GRN draft rows; no parallel receiving module. |
| D. Regression, operational acceptance and deployment | Not started | Test complete flow, validate migration and real cashier/receiver roles before rollout. |
| Explicitly deferred | Deferred | In-system scan/OCR, automatic web browsing, mobile import UI, CSV, automatic part creation, autonomous posting. |

## 1. For a New Session or Implementer

1. Check current branch/status/migration status and graphify query for `GoodsReceiptPage`, `goodsReceiptRoutes`, `grnWorkflowService`, Smart PO `purchaseOrderParseAI`, supplier reference service; revalidate this design against current code before implementation.
2. Inspect `docs/plans/2026-09-11_smart-po-nlp-entry.md`, `docs/plans/2026-10-20_supplier-reference-first.md` and `docs/plans/2026-10-18_paperless-goods-receipt-matching.md`. The newer supplier-reference-first contract takes priority over older invoice-only assumptions.
3. Implement and verify one phase at a time. Update this handoff with exact As Built files, migration results, and tests; run `graphify update .` on the verified repo host after backend/frontend code changes.

## 2. Business Objective, Scope and User Stories

**Objective:** Eliminate retyping supplier receipt rows, catch OCR uncertainties before entering stock and payables, and accelerate catalog matching without sacrificing fitment or cost accuracy. Receiver keeps control of actual quantities, supplier identity, part choice and final GRN posting.

- As a receiver, I can paste or upload a versioned JSON extraction from an external vision assistant into the **existing** Goods Receipt page, review the source wording and flagged issues, confirm parts and physical quantities, and continue the normal draft → submit → post workflow.
- As a reviewer, I can see which fields were transcribed, which identities were suggested by web research, what was corrected or excluded, and why; I cannot mistake an AI suggestion for an approved catalog part.
- As a store owner, imports cannot bypass supplier-reference deduplication, GRN costing, permissions, stock posting or A/P lifecycle rules.

**Scope:** JSON ingestion only. The vision scan and its internet research happen manually *outside FBS*. No FBS camera/OCR, crawler, automated supplier receipt retrieval, or fake PO. A real preceding PO can be linked via the existing receiving controls after supplier/PO reconciliation. An optional Paperless scan link is used only if a verified immutable document ID is explicitly supplied/selected within FBS; titles are not linkage IDs. The core importer does not require Paperless to work.

## 3. Verified Baseline and Architectural Decisions

Read-only inspection via project MCP, not a runtime/database audit: `packages/web/src/pages/GoodsReceiptPage.jsx` has current supplier document number/type, supplier matching and duplicate checks, PO loading, part search, part creation, pricing, freight, local draft state and staged GRN actions. `packages/api/routes/goodsReceiptRoutes.js` currently exposes `POST /goods-receipts/drafts`, `PUT /goods-receipts/:id/draft`, `PATCH /goods-receipts/:id/submit` and `POST /goods-receipts/:id/post` (router mount `/api` must be reconfirmed). Draft validation **requires nonempty lines, every line part_id, positive quantity and valid cost**; `writeDraftLines` replaces all lines; posting recomputes costs and applies existing supplier-reference safeguards. Drafts/Submitted do not affect inventory/AP; posting does. Existing Smart PO feature contains search/AI candidate ranking and optional JEV choice for ambiguous catalog descriptions. This does NOT make that service's generated quantity/cost, score, or auto-selected part authoritative in GRN. The existing UI keys some rows and costing maps by part ID and merges manually added duplicates; imported supplier rows must not be silently merged.

**Decision:** A durable **import review session** stores unresolved external rows outside `goods_receipt_line`. Only once every included row is resolved does an atomic commit create a normal GRN draft, or explicitly replace an editable GRN draft with user consent. The GRN itself remains canonical from then onward. Review is a state within the existing receiving page, not a new business module or a second posted ledger. Import draft ≠ GRN draft. This is necessary because directly saving nullable/unmatched lines into existing GRN drafts would weaken the current contract and compromise costing/posting.

## 4. External JSON v1 Contract (same for paste and `.json` upload)

```json
{
  "schema_version": 1,
  "document": {
    "supplier_name": null,
    "document_type": null,
    "document_number": null,
    "document_date": null,
    "currency": null,
    "printed_total": null
  },
  "lines": [{
    "line_no": 1,
    "raw_text": null,
    "description": null,
    "brand": null,
    "part_number": null,
    "supplier_item_code": null,
    "item_group_hint": null,
    "quantity": null,
    "unit": null,
    "unit_cost": null,
    "printed_line_total": null,
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
  "extraction_issues": [{
    "code": "AMBIGUOUS_VALUE",
    "line_no": 1,
    "field": "unit_cost",
    "message": "The printed price is unclear."
  }]
}
```

`document_type` is an optional printed source label (e.g., `delivery_receipt`, `invoice`, `packing_list`, `other`); FBS maps only recognized types to existing GRN reference roles and otherwise leaves type `other`/unspecified for user review. `document_number`, `part_number`, `supplier_item_code` are strings preserving punctuation and zeros. `document_date` is an ISO `YYYY-MM-DD` *document* date, never receipt_date. Quantities and amounts are JSON numbers or null (positive quantity; unit_cost >= 0 if present; money nonnegative; zero cost invokes current free/unknown-cost review, never inferred automatically). Numeric currency precision follows current GRN costing rules; no float-derived balancing. Unknown or unreadable values are null. Require supported schema_version, header object, nonempty lines, unique positive ordered line_no, and each line to have raw_text or description. No mandatory cost or quantity at the **import review** stage; they are mandatory when transferring included rows to existing GRN under its current rules. No `part_id`, `supplier_id`, `po_id`, `grn_id`, physical accepted quantity, landed cost or finalized sale_price accepted from external JSON; reject unknown authority-bearing fields rather than accidentally spreading them into GRN payloads. Bound payload bytes, rows, strings, sources, URLs and issue count server-side (proposed initial limits: 1 MB JSON, 200 lines, 20 sources/line; tune with actual supplier documents).

`enrichment.status`: `verified_suggestion` requires accessible official manufacturer evidence for exact visible brand plus part number, no material conflict; `possible_suggestion` is weaker; `unresolved` includes inaccessible/contradictory research. Source entries: `{ "url": "https://...", "supporting_text": "specific evidence" }`. These are **untrusted external assertions**, not proof that FBS visited the URL and not an instruction to fetch the URL. Present external links safely (`https`, noreferrer/noopener, escaped text; reject local/intranet URLs if any future server-side fetch is introduced). Never use enrichment to overwrite transaction facts, authoritative catalog group, fitment/interchange, or suggest stock posting. Missing `enrichment` may default to unresolved for tolerant intake; invalid populated structures produce field errors. Exact-source status is still merely a suggestion.

`extraction_issues`: array of `{ code, line_no, field, message }`; codes `UNREADABLE_VALUE`, `AMBIGUOUS_VALUE`, `CONFLICTING_VALUES`, `SKIPPED_ROW`, `CROPPED_OR_MISSING_PAGE`, `TOTAL_MISMATCH`. line_no references an existing original line or is null at document scope; field is an allowed header/line field or null. Unknown code is reported as a generic review item rather than silently dropped; malformed references reject with actionable path. `[]` is *not* a safety certificate. Do not accept AI severity/approval/posting directives. Preserve sanitized original issue text and source JSON snapshot; derive actual review state on server.

## 5. End-to-End Flow and Issue Policy

1. Receiver clicks **Import extracted JSON** next to existing manual/PO entry actions, pastes JSON or chooses a `.json` file. Both use the same validation and review endpoint. Invalid syntax/version, empty lines, size limit, or disallowed fields yield path-specific errors; do not alter existing GRN form or stock. Never treat pasted content/URL as executable instructions.
2. Create/reopen a persisted import review session. Show detected header and *every original line in order*; preserve two distinct rows even if the same part appears twice. Supplier name is a hint; staff select the actual supplier record. Document number pre-fills **Supplier Document No.** (not automatically invoice no. or physical receipt no.). Confirm document type; run existing supplier-scoped reference conflict/bill-matching checks. Document date is read-only evidence and must not replace receiving date.
3. For each line, search FBS in order: supplier item code within confirmed supplier if a verified mapping exists; exact manufacturer/part identifiers and brand; exact cross-reference with explicit indication; then catalog description/spec/fitment search and optional existing Smart PO AI/JEV candidate *ranking* for difficult descriptions. Preserve the printed quantity/cost as-is for review; do not run raw-text PO parser's quantity/price output over extracted structured facts. Evidence and match reason visible in candidate drawer. Exact textual hit, AI/JEV pick, or verified web finding **never auto-confirms** a catalog part. Receiver confirms part, UOM/pack conversion (e.g., BOX vs PCS), physical accepted quantity and supplier cost. Existing catalog's group controls after part confirmation; conflicts need manual review. No catalog match: stay in review; choose existing part, use authorized existing PartForm with duplicate gate, or exclude row with reason. No dummy part/automatic creation. Rows with same chosen part remain separate if source rows/costs differ; adapt any part-ID-keyed UI/cost map to stable import row identity and, at GRN draft stage, stable row identity rather than collapsing two distinct receipts.
4. Map issue code and field to **server-owned** review requirements: unreadable/ambiguous/conflicting material fields block import commit until corrected/verified; `SKIPPED_ROW` or `CROPPED_OR_MISSING_PAGE` blocks whole document until completeness is checked (if a missing page cannot be obtained, remove/replace import or record a reviewed exception with manager authority and explicit evidence policy; default is no override). `TOTAL_MISMATCH` shows reconciliation warning; user records a reason if legitimate, but no silent amount rewrite and do not block solely because totals differ. Other annotation (receiving_mark) is informational, not quantity confirmation. Missing mandatory GRN supplier/reference/quantity/part/cost is independently validated even if no issue was reported. FBS rechecks quantity > 0, cost >= 0, active part/UOM compatibility, supplier reference rules and costing before transfer.
5. **Continue to GRN draft**: explicit review action transforms confirmed included rows into existing GRN header/line payload; preserve source line_no and issue resolutions separately for audit. Use existing draft save path; create a draft number, not posted GRN number. For an already editable GRN draft, default is **do not replace**: user must choose append reviewed rows or replace existing lines after a clear diff/confirmation; service must recalculate costing and protect against overwriting another tab's edit. No import into Submitted/Posted/Cancelled directly. If a linked real PO exists, show expected-vs-received and require explicit reconciliation; do not silently mark PO quantities or create a PO. Reopen existing normal GRN draft with import provenance link/compact review summary. Standard freight, discount, price review, returns, submit/post flow then applies.
6. Handwritten_sale_price is shown next to the normal sale-price decision as **Handwritten suggestion**; never syncs retail prices or overrides margin floors automatically. receiving_mark is visible only as source annotation. Printed totals are a read-only comparison against suitable current receipt totals, with discount/tax/freight differences labeled and not forced to match. Original document line count and included/excluded count remain auditable. `enrichment` is candidate evidence only.

**Power-loss boundary:** persisted import review session survives reload and permits continuation; don't rely only on the existing local autosave hook. Past GRN commit, the existing GRN is canonical, with the import session retained as provenance; no second financial document.

## 6. Clean UI/UX in Existing GoodsReceiptPage

- One subtle `Import extracted JSON` button beside existing item entry/PO actions; hidden/disabled without create permission and unavailable in Posted/Cancelled views. Do not add an Import navigation item, dashboard, extra wizard for costing, duplicate line table on the main page, or permanent columns to the normal manual entry screen.
- Paste/file chooser in a small dialog. Validation failure leaves existing form unchanged, keeps text intact and focuses first error. Import review uses a responsive drawer on desktop and accessible full-screen sheet on mobile. Existing GRN page stays recognizable underneath. Compact header: `12 rows · 2 need correction · 1 document review`; one issue badge per affected row/header, filter `Needs attention`, previous/next issue and keyboard focus. Row expands to source raw_text, edit fields, candidate picker with exact/alternative distinctions and optional collapsible web source evidence. Keep noise hidden for clean rows.
- Source document preview button only if a verified immutable Paperless document ID is linked by the existing permissioned viewer. Never auto-open a scan by guessed title; if scan unavailable, show neutral `Compare with supplier document` instruction.
- Sticky bottom: `Save review` and `Continue to GRN draft` with an explicit remaining-blockers count; users may save incomplete review without polluting the ordinary GRN draft queue. For material issues, correcting a value and explicitly confirming against the source clears the issue; informational annotations need no acknowledgment. Document/total warnings need a reviewed reason when applicable. Store who/when/value/reason. The normal GRN line table, freight wizard, prices, return controls and Submit/Post actions remain unchanged except compact `Imported` provenance and re-open-review link.
- Existing manual entry must work unchanged. Opening import with unsaved manual edits asks to preserve/park them; no silent replacement. When editing an existing draft use a compare/append/replace choice and server version check. On network failure keep review locally visible but indicate `Not saved`; retry with same idempotency key. Preview candidates may be unavailable offline; retain review state and allow existing offline GRN functionality without falsely claiming cloud matching ran.
- Keyboard/screen reader: dialog trap and focus restoration, labeled badges not color-only, source URL disclosure and safe external open, mobile large touch targets, no focus loss after resolving a row, preserve selected supplier and scroll/filter after closing review.

## 7. Proposed Persistence and API Contract

**Migration (proposed, verify naming conventions and current schema):** `database/migrations/<YYYYMMDD>_01_grn_import_review.sql`; introduce `grn_import_review` with `import_id uuid PK`, `created_by_employee_id FK employee`, `status text CHECK (IN_REVIEW, COMMITTED, ABANDONED)`, `schema_version smallint`, `source_payload jsonb NOT NULL` (validated immutable snapshot), `review_state jsonb NOT NULL` (selected supplier, row UUID/line_no, corrections, part selections, physical quantities, issue resolutions, exclusions/reasons), `document_id integer NULL` (only confirmed Paperless ID, not filename), `grn_id integer NULL FK goods_receipt/grn table (unique for committed import if one-to-one)`, `request_key text`, `version integer`, `created_at`, `updated_at`, `committed_at`; add unique `(created_by_employee_id, request_key)` for creation replay and indexes `(created_by_employee_id,status,updated_at DESC)` and `(grn_id)` as needed. Store provenance in a separate table so printed data, research and issue history never become financial GRN columns. Use JSONB CHECK object/array guards; full structural validation in service. `review_state` must retain stable per-row identity, original line_no, resolution events (actor/time/old/new/reason) and source issue text. Bound size/retention; avoid storing entire image here. Encrypt/restrict business cost data under current backup and access policy. If a user starts a new import with an existing document number, preserve the review session but resolve duplicates through the current supplier-reference policy before GRN commit.

**Proposed routes** mounted under the verified `/api/goods-receipts` router; consolidate logic in a small import service, not a copied PO route:

| Endpoint | Permission | Request / response | Behavior |
|---|---|---|---|
| `POST /imports` | `goods_receipt:create` (use actual existing permission key) | `{ payload: <schema-v1 JSON>, request_key: UUID }` → 201 `{ import_id, version, review, blockers }`; replay same key+payload returns existing; changed payload 409. | Validate, sanitize, persist review; no GRN, PO, stock or A/P writes. |
| `GET /imports/:importId` | creator or authorized receiving reviewer | → `{ import_id, status, source_payload, review_state, version, blockers, grn_id? }` | Reopen; no cross-user leak. |
| `PATCH /imports/:importId` | authorized receiver | `{ version, changes: [ { line_no?, field?, value?, part_id?, action?, reason? } ] }` → `{ version, review_state, blockers }` | Validate edits, bind issue resolution to actor, optimistic concurrency 409 on stale version; only IN_REVIEW. |
| `POST /imports/:importId/commit` | `goods_receipt:create` | `{ version, request_key, mode: "new_draft"|"append_draft"|"replace_draft", target_grn_id?, target_version?, confirmed_supplier_id, receipt_date }` → `{ import_id, grn_id, grn_number, workflow_status:"Draft" }` | 422 line/header blockers, 409 supplier reference/stale edit conflict; create/update existing GRN draft and mark import COMMITTED **in one DB transaction**. Idempotent retry returns same draft; never create duplicate drafts/stock/AP. Target drafts must be editable and explicitly confirmed. |

All examples are proposed contracts; match repo's established authenticated route conventions and actual permission names on implementation. Validate server-side in PATCH **and again inside commit under row locks**, including supplier, active parts, row quantities/costs, issue resolution, excluded lines and current draft version; do not trust UI state. Consistent errors `{ code, message, fields: [{ path, message, line_no? }], existing_receipts? }`, 400 bad structure, 401/403 auth, 404 inaccessible ID, 409 version/duplicate/idempotency conflict, 413 oversized payload, 422 unresolved reviews. Schema validation errors must not leak DB internals. `GET`/`PATCH`/commit access must check GRN role, ownership/team-review authorization and target GRN status; server-scoped IDs. Sanitize free text and URL display; no server browsing or OCR. Use transaction/lock on import row and target draft, version compare and existing supplier reference validator. If commit fails, keep import session and corrections; no partial GRN. If drafting through existing route functions is not reusable, extract common validation/write service rather than calling local HTTP or copying posting logic.

**Important implementation refinement:** Existing draft-line replacement overwrites all lines and existing UI maps costing by `part_id`; plan a row-key refactor so duplicate imported source rows survive, line order and provenance stay tied to `line_no`, and costing/updates never collapse differing costs. If project GRN schema requires a unique part per draft, treat this as a migration/design gate: explicitly support distinct GRN lines for same part or require user-visible, value-safe aggregation only with matching cost/UOM and individually traceable source rows. Never silently merge.

## 8. Acceptance Criteria, Edge Cases, Performance and Verification

- Valid pasted/file JSON yields identical server review; missing/ambiguous printed facts remain null; ordering, zeros, raw_text and source issue association survive save/reopen/commit. A multi-page cropped flag blocks completeness confirmation. Malformed JSON, wrong version, fabricated authority fields and empty lines cannot create a GRN.
- Brand/part conflicts, multiple same-brand tiers, supplier code mapping collision, unit pack mismatch and inactive parts remain unconfirmed until staff acts; unauthorized create-part cannot bypass gate. AI/JEV unavailable or web sources invalid still permit manual catalog search and review, never auto-select.
- No-matched part can be linked via normal picker, created using existing authorized duplicate-safe PartForm, or excluded with reason; at least one included line required. Distinct same-part printed rows with differing prices retain separate costs and source traceability. Zero-cost vs missing cost distinguished, free-goods semantics confirmed. Printed total differences never modify costs or autonomously block posting, but reviewed reason recorded.
- Existing supplier-reference duplicate policy (including repeated delivery against same bill/PO), original text preservation, draft transitions, pricing/margin floor, freight, return quantities, and ordinary post idempotency unchanged. Receipt_date explicitly set by receiver; not copied from document_date. Posted or Submitted GRNs cannot import new lines. Repeated commit and simultaneous tabs cannot create duplicate GRNs. Final post alone changes inventory, AP and prices.
- Suggested targets to validate with real receipts: schema/preview p95 < 1 s for 100 lines excluding external search, interactive local row validation < 100 ms, save/reopen p95 < 500 ms, no regression to existing part lookup or draft save. Bound candidate search and AI calls (fallback asynchronous, progressive results); never hold DB transaction open across AI/network calls. Keep offline-capable existing manual GRN behavior intact.
- Test matrix: schema-valid/invalid/bounds; permission and malicious nested fields; double replay/stale version/concurrent target edit; same-part two costs; incomplete page/ambiguous qty/cost/total mismatch; missing supplier/date; supplier-reference collision; real PO case and no-PO case; catalog creation permission and duplicate gate; source evidence URL sanitization; draft/edit/submit/post readback; existing GRN regression; device layouts and keyboard. Use disposable test DB for mutating flows.

**Implementation verification commands (NOT run for this plan):** `npm run -w packages/api test -- --runInBand tests/grnImport.test.js tests/grnWorkflow.test.js`; `npm run -w packages/api lint`; `npm run -w packages/web test`; `npm run -w packages/web lint`; `npm run -w packages/web build`; `npm run -w packages/api migrate:status -- --host localhost`; `npm run -w packages/api migrate:verify -- --host localhost`; `git diff --check`; `graphify update .`. Verify migration/test DB connectivity and actual script names on repo host; perform authenticated browser receiver/manager checks and physical receipt pilot separately. None of these commands was executed in this documentation-only session.

## 9. Proposed Files, Deferred Items and Change Log

**Files touched by this planning session:** this plan only. **Proposed (not yet modified):** `packages/api/routes/goodsReceiptRoutes.js`; new `packages/api/services/grnImportService.js` and validation helper; `packages/web/src/pages/GoodsReceiptPage.jsx`; new `packages/web/src/components/goods-receipt/ImportExtractedJsonDialog.jsx` and `ImportReviewDrawer.jsx`; applicable existing Smart PO candidate resolver/search service; new `database/migrations/<YYYYMMDD>_01_grn_import_review.sql`; API/web test files. Verify file paths and route mount against current repo before editing. Do not edit existing financial ledger or posting service solely to accept external JSON.

**Explicitly deferred:** OCR/vision inside FBS; automatic manufacturer research inside FBS; CSV/plain-text as first-class intake; unreviewed catalog/brand/fitment changes; auto receipt attachment by filename/title; import from Telegram/Paperless without manual JSON; offline mobile import UI (existing mobile receiving remains); automatic creation/posting of inventory, payable, or price changes from source/enrichment.

**Change log:** Initial finalized design: versioned external JSON, evidence-separated enrichment, structured extraction issues, durable review before normal GRN draft, integrated UI, candidate confirmation, server gates, idempotent commit, duplicate-line safeguard. Repository source inspected read-only; no application code or migration executed. 
