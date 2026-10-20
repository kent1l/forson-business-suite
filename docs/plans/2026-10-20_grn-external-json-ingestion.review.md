# GRN External JSON Ingestion — Comparison, Technical Audit and Proofreading

> Follow-up: the [final implementation plan](2026-10-20_grn-external-json-ingestion.final.md) resolves these findings at the design level and maps F1–F11 in §13. This review preserves the evidence about the original/v2; implementation and runtime verification remain outstanding.

> Forson Business Suite | 2026-10-20 (Asia/Manila)
> Reviewed: `2026-10-20_grn-external-json-ingestion.md` and `2026-10-20_grn-external-json-ingestion.v2.md` against the current checkout, branch `grn-json-ingestion`.
> Result: use v2 as the basis for a consolidated revision; neither document is ready to serve as an unambiguous implementation contract. This review changes documentation only. Both input plans remain intact. No application tests, database migrations, browser checks or deployment were performed.

## 1. Comparison and Recommendation

The architecture shared by both plans is sound: preserve external extraction as evidence, stage unresolved rows separately, require receiver confirmation, and create an ordinary GRN draft without inventory or payable effects. Keep that architecture and the existing supplier-reference safeguards.

V2 adds 46 lines, principally an overriding §0a and a Phase 0 row. The original §§1–9 otherwise remain unchanged except for the change log. It is an amendment layered over v1, rather than a fully revised plan.

| Area | Original | V2 | Assessment |
|---|---|---|---|
| Draft creation | New, append and replace behavior | New draft only for MVP | Prefer v2; remove the superseded behavior from the normative sections. |
| Research and matching | Advisory; receiver confirms | Same, plus a separate candidate endpoint | Keep; specify the endpoint contract and extract candidate-only reuse. |
| Review persistence | Durable session and version checks | Adds payload hash, retention and activity logging | Improvement; recovery, abandonment and purge still need complete contracts. |
| Access | Creator or authorized reviewer | Creator writes; posting-permission holders can read | Clearer scope, but reconcile every route and the UI with it. |
| Missing-page exception | Possible manager exception | No override in MVP | Prefer v2; keep the source-replacement path explicit. |
| Numbers | JSON numbers or null | Decimal strings or fixed-scale numbers | Better intent; choose one canonical form and define conversion boundaries. |
| Duplicate catalog parts | Flags potential database/UI issue | Confirms no unique part-per-GRN constraint | Correct about the schema; incorrect that only UI maps remain a blocker. |
| Rollout | General regression and deployment phase | Default-off feature flag | Keep; specify how the frontend learns the server flag. |
| External extraction quality | Versioned JSON and issue codes | Adds fixtures and an extraction prompt | Keep; repair the example and field policy first. |

Recommended editorial action: retain the original as historical context and rewrite v2 into one coherent contract. Remove the “supersedes conflicting text” mechanism once its decisions have been integrated. Label the result “Design under review” until the gates below are resolved.

## 2. Findings Requiring Plan Changes

Priority here describes implementation risk if the plan is followed. These are plan findings, not claims that an importer is deployed. P1 means resolve before implementing the affected behavior; P2 means resolve before calling the handoff complete.

### F1 — [P1] The recursive denylist rejects the required enrichment status

**Location:** v2:42; both JSON examples and enrichment contracts, original:65–72 and v2:111–118.

V2 rejects `status` “at any depth” while requiring `lines[].enrichment.status`. A literal implementation rejects every populated enrichment object, including the plan's own example. A blanket `post*` key rule is similarly underspecified.

**Correction:** validate by schema path. Permit only the documented enrichment status enum at `lines[].enrichment.status`; reject workflow/approval directives at unauthorized paths. Scope this policy to external `payload`, since trusted review requests legitimately contain server-issued IDs. Construct GRN payloads from an explicit allowlist rather than spreading arbitrary input. Specify whether harmless unknown fields are rejected or dropped, including how dropping affects the stored snapshot and payload hash.

**Required check:** a conforming extraction with `enrichment.status: "unresolved"` is accepted; external workflow status, part IDs and posting directives cannot affect review or GRN state.

### F2 — [P1] Duplicate-part support also needs a deterministic catalog-price policy

**Location:** v2:22, 53 and 171; original:125.

The database permits duplicate parts, and `computeCosting` preserves input rows by index. However, support is not limited to changing UI maps. The freight wizard also keys overrides and React rows by `part_id`. More seriously, the current price-sync endpoint updates a catalog part from matching GRN lines without choosing which duplicate line controls its price. WAC replay joins receipt lines by GRN and part, then orders inventory transactions without a receipt-line tie-breaker. Two receipt rows can therefore offer different prices for the same catalog part.

**Evidence:** `packages/web/src/components/goods-receipt/FreightAllocationWizard.jsx:60`, `:194`, `:505`; `packages/api/routes/goodsReceiptRoutes.js:2003`; latest relevant function definition in `database/migrations/20260903_06_wac_single_source_of_truth.sql:110`.

**Correction:** expand Phase 0 to include freight overrides, row edits/removal, returns, payload building, posting price sync, manual price sync and WAC replay. Define one confirmed catalog sale price per part, or a deterministic documented selection rule that all price-writing paths use. Keep receipt quantities and costs separate. Disabling automatic sync alone does not address the manual sync endpoint. Permit the targeted backend/migration changes needed for correctness instead of assuming posting behavior can remain untouched.

**Required check:** two rows for the same part with different costs survive edit, save, reopen, freight allocation, return, post, manual sync and WAC replay; the catalog price follows the same explicit rule each time.

### F3 — [P1] Pack conversion must normalize unit cost as well as quantity

**Location:** v2:45 and 140; original:94.

The plan records a conversion and asks for quantity in stock UOM, but does not define the unit basis of the cost committed to GRN. Converting `2 BOX` to `20 PCS` while retaining `500.00/BOX` as `cost_price` would multiply the receipt value by ten. The current costing engine multiplies GRN quantity directly by unit cost.

**Evidence:** `database/initial_schema.sql:106` defines `part.measurement_unit`; `packages/api/services/grnCostingService.js:216` and `:242` derive accepted quantities and line value.

**Correction:** preserve source quantity/UOM/cost, and separately store the confirmed stock UOM, units per pack, received stock quantity and cost per stock unit. For example, `2 BOX × 10 PCS/BOX` at `500.00/BOX` becomes `20 PCS` at `50.00/PCS`, retaining a value of `1000.00` before adjustments. Define delivered versus accepted quantity and any return quantity so rejected units are not subtracted twice. Define behavior when converted unit cost cannot fit the existing two-decimal `cost_price` without material rounding; require an explicit reconciliation or defer that conversion.

### F4 — [P1] Currency is extracted but has no commit policy

**Location:** original:48 and 84; v2:94 and 130.

Both schemas accept `document.currency`, but neither explains how it affects GRN costs. The reviewed GRN schema and write contract carry no currency or exchange-rate fields; the web formatter defaults to pesos. A USD amount must not pass through as the same numeric PHP amount merely because the receiver confirmed a part.

**Evidence:** `packages/web/src/utils/currency.js:17`; `packages/api/routes/goodsReceiptRoutes.js:1123` and `:1253`; `database/initial_schema.sql:208`.

**Correction:** make the MVP currency policy explicit. A suitable bounded policy is PHP-only commit, explicit receiver confirmation when currency is unreadable, and a blocker for non-PHP documents until an authorized conversion workflow exists. Preserve the original currency as evidence. Do not infer PHP from a bare dollar sign or silently apply an exchange rate.

### F5 — [P1] Review-to-draft mapping omits fields needed by existing reference rules

**Location:** v2:158 and 166–169; original:112 and 120–123.

The flow promises repeated deliveries against an existing payable and optional real-PO linkage, but the review state and PATCH/commit contracts do not enumerate confirmed reference type/number, selected payable, another-delivery acknowledgement, related invoice, PO or free-goods decision. “Field/value/action” placeholders do not establish a validated mapping for these decisions.

The existing reference validator allows a repeated reference only when the user explicitly acknowledges another delivery, selects a bill, and all matching receipts are Posted against that same bill. A commit that cannot carry these confirmed choices either blocks legitimate receiving or encourages a bypass.

**Evidence:** `packages/api/services/supplierReceiptReferenceService.js:45`; `packages/web/src/pages/GoodsReceiptPage.jsx:788` shows the current GRN payload.

**Correction:** enumerate server-owned review fields and their mapping into the existing draft service, including `supplier_document_no`, `supplier_document_type`, `bill_id`, `another_delivery_confirmed`, related invoice and `is_free_goods`. State which optional choices occur only after the new draft opens. If PO selection is postponed until then, say so consistently. IDs selected inside FBS remain distinct from prohibited IDs in external JSON. Reuse current supplier/bill validation and Attach Items constraints.

### F6 — [P2] Source row identity has no durable relationship to edited GRN lines

**Location:** v2:140, 158 and 171; original:94, 112 and 125.

The import keeps a row UUID and source `line_no`, but only links to the GRN header. `writeDraftLines` deletes and reinserts all lines on draft save, generating new `grn_line_id` values. Neither source line number nor current database line ID alone preserves row attribution through deletion, reordering and repeated edits, particularly for two rows with the same part and cost.

**Evidence:** `packages/api/routes/goodsReceiptRoutes.js:1164` and `:1487`.

**Correction:** choose one explicit guarantee. Either retain an immutable import-to-draft snapshot and describe it as historical provenance only, or persist a stable line UUID through every GRN read/write and maintain its source-row association. If ongoing line attribution is required, include the necessary schema/service work in Phase A/C. A single header-linked JSON snapshot cannot by itself guarantee current-line traceability.

### F7 — [P2] The normative sections still prescribe deferred scope

**Location:** v2:17, 31–35, 82, 142, 149–153 and 165–169.

Despite the override, the main architecture, workflow, UI and API still instruct implementers to append/replace drafts, admit team reviewers and consider manager exceptions. The endpoint table still accepts deferred modes. The heading “Deferred to v2” is particularly confusing inside a file already named v2. The partial unique `grn_id` index is coherent for one import per new draft, but conflicts with future appending of multiple imports to one draft unless redesigned.

**Correction:** integrate the MVP throughout; accept only new-draft commit and reject deferred target/mode fields. State that importing from an already saved GRN is unavailable in the MVP. Preserve or park unsaved manual work before starting a separate import. Use “Later phase” for future scope and revisit cardinality before implementing append behavior. Make the stricter import rule distinct from existing ordinary edits: current `grnWorkflowService.js:25` permits editing Submitted receipts, and the update route returns them to Draft.

### F8 — [P2] Save, resume, abandon and purge are not a complete lifecycle

**Location:** v2:32, 46, 145, 152 and 164–167; original:99 and 118–121.

The only retrieval API requires an already-known import ID. There is no stated way to find a saved review after losing its tab/URL, nor an abandonment route. Retention also promises to purge an immutable `source_payload NOT NULL` without defining its tombstone representation; sensitive extracted values can remain in `review_state` even if only `source_payload` is purged.

**Correction:** add a paginated creator-scoped saved-review list reachable inside the existing import dialog, a durable URL/import-ID recovery path, and a version-checked abandon action. Define state transitions, inactivity clock, purge schedule, tombstone fields and treatment of review data, hashes and logs. Ensure cleanup cannot race an active save/commit. Decide whether disabling the feature flag stops only new work or also hides existing provenance; document frontend flag discovery rather than assuming Vite can read a backend environment variable.

### F9 — [P2] The proposed 1 MB input limit exceeds the current parser limit

**Location:** v2:130 and 186; original:84 and 140.

The API globally installs `express.json()` without options. Its locally installed body parser defaults to `100kb`, so a valid 200 KB extraction is rejected before importer validation. Also distinguish the size of external JSON from the larger `{ payload, request_key }` HTTP envelope.

**Evidence:** `packages/api/index.js:29`; `node_modules/body-parser/lib/types/json.js:53`.

**Correction:** include parser configuration and error handling in the proposed files. Specify exact byte units, payload/envelope limits, JSON error responses, and a parser mounted before the global parser if using an import-specific limit. Confirm proxy limits. Test requests below and above both limits through the actual app entrypoint, since a standalone router test can miss this issue.

### F10 — [P2] Numeric, null and total-validation rules need one precise contract

**Location:** v2:38, 43 and 130; original:84 and 95.

V2 offers decimal strings or numbers, while §4 still allows only numbers or null. “No float math” also describes neither the current shared costing code nor a clearly bounded new reconciliation layer. Existing draft validation converts cost with `Number()`, which treats null and an empty string as zero. It therefore cannot by itself guarantee the import's mandatory-cost rule. A generic total comparison can similarly turn missing values into zero or compare gross source totals against discounted/taxed receipt totals.

**Evidence:** `packages/api/routes/goodsReceiptRoutes.js:1194`; `packages/api/services/grnCostingService.js:71` and `:242`.

**Correction:** select and document a canonical numeric representation, scales, ranges, exponent policy and rounding rules. A practical choice is decimal strings/null externally, explicit import validation and fixed-scale source reconciliation, then a controlled adapter to existing costing. Reject null/blank/malformed mandatory values before numeric coercion. Require an explicit free-goods versus unknown-cost decision for zero. Compare original printed quantities/costs in the same units only when operands exist; define cent rounding/tolerance and label totals that may include tax, discount or freight. Do not implicitly expand this feature into a rewrite of all GRN arithmetic.

### F11 — [P2] Issue resolution and retry behavior are not sufficiently specified

**Location:** v2:41, 134, 141, 152 and 166–169; original:88, 95, 106 and 120–123.

Multiple issues can target the same row and field, but resolutions have no issue identity. The PATCH shape is not a discriminated set of permitted actions. It is unclear whether changing a previously confirmed value, supplier, part or UOM invalidates confirmations. Retrying a PATCH after a lost response will use a stale version; the UI's generic instruction to retry the same idempotency key has no matching PATCH contract. A COMMITTED check prevents a second GRN, but the plan does not distinguish a genuine commit replay from changed commit arguments or a draft that has since been edited/posted.

**Correction:** issue server-generated issue IDs and explicit actions such as set-field, confirm-row, exclude-row and resolve-issue. Bind material confirmations to the reviewed value/revision and invalidate dependent confirmations after changes. Define document completeness and unknown-issue handling. Decide whether total-warning explanations are required before commit while keeping warnings out of later posting eligibility. For lost PATCH responses, either support operation IDs or reload/compare state before retrying. For commit, lock first, authenticate, distinguish replay from changed requests, and return the linked GRN's current workflow status without overwriting later edits or reporting a Posted GRN as Draft.

## 3. Proofreading and Example Corrections

| Location | Problem | Suggested wording/change |
|---|---|---|
| Both:1–3 | “Final Feature Plan” and “finalized” conflict with unresolved design gates. The observed branch is historical. | “External Supplier Document JSON Ingestion — Draft Implementation Plan”; record the inspection date and baseline commit, and require a fresh branch/status check. |
| V2:10, 25 and 56 | “test dir,” “Gate for A,” and a directory question whose answer is now available. | “API tests use `packages/api/tests/`; Phase 0 must complete before Phase A.” |
| V2:29 | “Deferred to v2” inside v2. | “Deferred to a later phase.” |
| Original:84 / v2:130 | Requires a “header object,” but the JSON property is `document`. | “Require a `document` object.” |
| Both JSON examples | `raw_text` and `description` are both null, violating the documented per-line requirement. Syntax is valid; the example is not a conforming payload. | Supply a real description/raw-text example, or label it a structural template and provide a separate valid fixture. |
| Original:86 / v2:132 | `verified_suggestion` can sound verified by FBS. | Label it in UI as “External source claim — receiver confirmation required.” Keep the wire enum only if its semantics are explained. |
| Original:97 / v2:143 | Inconsistent identifier casing in prose. | Use backticks consistently: `handwritten_sale_price`, `receiving_mark`, `receipt_date`, `line_no`. |
| Original:99 / v2:145 | “Past GRN commit” is awkward; “local autosave hook” misstates current persistence. | “After commit, the GRN is canonical. The import review is retained as provenance.” Describe `useDraft` as server-backed form autosave. |
| Original:107, 133 / v2:153, 179 | Claims existing offline GRN functionality without establishing a web offline queue. | “Preserve the existing form during transient network failure, display unsaved changes, and support retry.” Keep offline-mobile behavior separate. |
| Original:112 / v2:158 | “Separate provenance table” is ambiguous: it can mean the import table separate from financial lines, rather than a second new table. V2 treats it as an extra table. | “Keep source evidence and review history in `grn_import_review`, separate from financial GRN rows.” |
| Original:114 / v2:160 | Says router is mounted at `/api/goods-receipts`; actual mount is `/api`, with the resource prefix inside route paths. | “Public API base: `/api/goods-receipts`; the router is registered at `/api`.” |
| Original:118, 123 / v2:164, 169 | “Use actual permission” remains after v2 verifies it; new error shape differs from current route responses. | Use `goods_receipt:create` explicitly; document any adapter from `existingReceipts` to `existing_receipts`. |
| Original:131 / v2:177 | “No-matched part” and “Zero-cost vs missing cost” are awkward. | “A line with no catalog match…” and “Distinguish zero cost from missing cost.” |
| Original:136 / v2:182 | A proposed new test is mixed with existing verification, while v2 questions an already-correct `tests/` path. | Keep `tests/grnWorkflow.test.js`; label `tests/grnImport.test.js` as a future file. The actual Jest config currently matches `tests/**/*.test.js`. |
| Original:140 / v2:186 | Placeholder migration and proposed-file list omit affected existing files. | Recheck whether `20261020_03_grn_import_review.sql` remains available; add the freight wizard, API parser/runtime flag wiring, shared draft service and any identity/price changes selected by Phase 0. |
| Both change logs | “No application code or migration executed” conflates editing code with running it. | “No application code was changed, and no migration was run.” |

The current `useDraft` hook reads and writes `/drafts/:type` through the API and uses revision guards (`packages/web/src/hooks/useDraft.js:32`). This does not make it a substitute for dedicated import reviews, but it should not be described as local-only persistence.

Suggested valid **proposed normalized** fixture below. It uses decimal strings as recommended by F10; the consolidated contract must explicitly adopt that representation. It remains subject to receiver confirmation.

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

## 4. What This Audit Verified

- Queried the existing graph with the feature question and `writeDraftLines`, then inspected source directly where graph context was sparse. No graph rebuild was needed for this documentation-only review.
- Compared both plans with `diff -u`; confirmed the override-style revision described above.
- Inspected GRN draft/read/edit/post/return/price-sync routes, costing and workflow services, the supplier-reference validator, receiving UI, freight wizard, schema and relevant migrations.
- Confirmed public route base `/api/goods-receipts`, existing permission keys, duplicate-part schema legality and the current migration filenames in source. No live database schema or applied migration state was checked.
- Confirmed Smart PO's actual path is `packages/api/services/ai/features/purchaseOrderParserAI.js`, exporting an instance with `resolveLine`. That method parses quantities/prices and can select a match; it is not a candidate-only GRN adapter. Its generative call requests a 25-second timeout. The whole resolution path still needs its own bounded candidate-service design. No supplier-item-code mapping was found in the schema/migration/service/route searches performed; that is a search result, not a live-database assertion.
- Parsed both embedded JSON examples with Node: both are syntactically valid, and both have a line violating their own raw-text/description requirement. Each includes the status key rejected by v2's recursive denylist.
- Called the pure costing function with two rows for the same part at costs 100 and 200: it retained two rows, produced distinct suggested prices 170 and 340, and returned no costing errors. This supports the duplicate-price finding; no inventory or payable writes were made.
- Confirmed JavaScript coerces null and an empty string to zero, and inspected the installed body parser's 100 KB default.
- Inspected package scripts and test configuration. `packages/api/tests/grnWorkflow.test.js` exists; the plan's proposed `grnImport.test.js` does not yet exist. Some existing GRN regression suites mock the database/authentication, so they do not replace the proposed real PostgreSQL concurrency and permission checks.

No complete test suite, benchmark, candidate provider, HTTP payload-limit test, browser flow, migration command or production behavior was exercised. Findings about SQL price selection are based on current source and migration definitions, not a live-database reproduction.

## 5. Readiness Gate for the Consolidated Plan

- [ ] Integrate v2's MVP decisions throughout; remove contradictory deferred contracts.
- [ ] Resolve F1–F5 before implementing extraction validation and financial mapping.
- [ ] Choose the provenance guarantee, row identity and duplicate-part retail-price policy.
- [ ] Specify recovery/lifecycle endpoints, typed review actions, confirmation invalidation and retry semantics.
- [ ] Fix the JSON example, numeric contract, parser limit and rollout-flag wiring.
- [ ] Update acceptance checks to cover pack-cost conversion, currency mismatch, null cost, duplicate-part price sync, provenance after draft edits, lost responses and saved-review recovery.
- [ ] Complete Phase 0 with exact proposed files and decisions; implementation phases remain not started.

## 6. Change Log

- 2026-10-20: Added comparison, source-based audit, proofreading suggestions and a proposed valid normalized fixture. Both reviewed plans remain unchanged.
