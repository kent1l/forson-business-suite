# Supplier Reference First — Implementation Handoff

> Forson Business Suite | 2026-10-20 (Asia/Manila)
> Status: Implemented in the working tree; local development migration applied. Verification recorded below. Not committed or deployed to production.
> Reviewed baseline: `9ff0cf6`; earlier Attach Items route corrections remain included in this working tree.

This document supersedes the mandatory document classification and invoice-only matching assumptions in sections 3–5 of `2026-10-20_supplier-ap-shared-workflows.md`. The financial lifecycle, permissions, independent bill ownership, explicit payment allocation and historical-data preservation requirements remain applicable. The initial research is in `scratch/2026-10-20_supplier-paperwork-workflow-review.md`; the user's later simplification to one primary field governs this implementation.

## 0. Status at a Glance

| Area | Status | Evidence / next step |
|---|---|---|
| Supplier-reference matching and duplicate checks | Implemented and tested | Real HTTP/PostgreSQL scenarios, including concurrent manual/receipt entry |
| Reference persistence and staged receiving | Implemented and tested | Additive migration, draft edit/reopen/post and acknowledged partial-delivery tests |
| Receiving, A/P and payment presentation | Implemented and tested | Browser fixture covers Attach Items, matching, duplicate review and payment alias search; production build succeeds |
| Regression verification | Passed | 67 receiving/returns/cheque tests; 10 existing web tests; lint has warnings and no errors |
| Development migration | Applied and checksum verified | `20261020_02_goods_receipt_supplier_reference.sql` |
| Production deployment | Not performed | Apply migration before serving the updated API/frontend |
| Graph refresh | Completed outside sandbox | 7,195 nodes, 12,826 edges; extraction reports 30 source-metadata issues; oversized HTML skipped |
| General document bundles, payable consolidation and unbilled-receipt accounting | Deferred | Outside this supplier-reference simplification |

## 1. For a New Session or Agent Picking This Up

1. Run `graphify query "supplier reference matching receiving payable payment"` for the current code map. The code graph was refreshed; new prose is not deeply semantically indexed by the AST-only update.
2. Recall Hindsight with project `forson-business-suite`, topic `supplier-reference-first` for the confirmed user preference.
3. Check git status/history and migration status before relying on this table. These changes are uncommitted, including the earlier route fix.
4. After further changes, update this handoff, run relevant verification, retain consequential decisions and run `graphify update .`.

## 2. Business Objective and Confirmed Decisions

Suppliers use inconsistent paperwork: AR, DR, SI, packing lists and waybills may contain the items, prices and discounts used for settlement. Staff holding that paper need to find whether it has already been recorded or paid using its printed reference.

- One primary field: **Supplier Document No.** It searches within the selected supplier and appears first in A/P and payment selection.
- Document type is optional, collapsed under details and defaults to unspecified/other. Type is useful only when resolving ambiguity; the title never marks a bill paid.
- Internal BILL/GRN numbers remain stable identifiers and secondary labels. They are not supplier-reference matching keys. Historical non-generated bill numbers remain legacy search candidates.
- Matching suggests records; the user selects the bill. Attach Items already supplies that exact bill and prevents switching to a different candidate.
- Another delivery against the same reference requires selecting its payable and explicit acknowledgement. Draft/Submitted duplicates must be resumed/reviewed rather than acknowledged away.
- Payment allocation uses the selected bill IDs internally. Supplier-reference search changes the visible selection list, not existing allocations. Supplier-level payment starts in explicit selection mode, with deliberate oldest-first allocation still available.
- Optional related invoice references remain supported inside receiving details. They register as aliases on the same payable; they do not create another debt.

## 3. Architecture and Compatibility

Goods receipts now store `supplier_document_no`, `supplier_document_type` and `another_delivery_confirmed` separately from existing `supplier_invoice_no` and `physical_receipt_no`. New unspecified paperwork does not populate either confirmed role. Explicit SI/DR types populate their applicable role. Legacy requests without `supplier_document_no` keep the legacy adapter; reopening an unchanged legacy staged receipt preserves its original role fields.

A shared receipt-reference service checks active receipts by supplier and conservative reference equality, excluding the current receipt, Voided records and Cancelled drafts. A repeated reference is allowed only for acknowledged new arrivals against the same bill when all existing matching receipts are Posted. Existing actual delivery-reference unique indexes remain intact.

Supplier bill matching accepts omitted type, searches active primary/alias identities and legacy/header references, deduplicates candidates and includes receipt/payment availability context. Comparisons trim outer whitespace and ignore case, preserving punctuation and leading zeroes. Explicit different types can represent separate numbering series; unknown types cannot bypass an existing reference.

Transaction advisory locks serialize reference claims across manual payable creation and receipt posting. Unknown/same-type duplicate debt is rejected, including existing header/legacy references not registered as aliases. Checks occur before generated document sequences where applicable. Identity upsert no longer mutates the ownership of a conflicting bill. Direct receiving's idempotency hash includes the new reference/acknowledgement fields.

The supplier bill list searches header/alias references and returns aliases for A/P/payment filtering. A selected-bill read endpoint supplies receiving context. Receipt history, drafts, linked receipt details, payment history/register and outbound cheque selection show supplier references where available. Paperless reconciliation considers the generic reference alongside existing invoice/delivery roles.

## 4. As Built and Verification

### Data and posting

- [x] Add migration without rewriting historical references or dropping existing physical-reference guards.
- [x] Persist generic fields and acknowledgement in direct create, staged create/update/read and staged post.
- [x] Guard duplicate debt across manual and receiving entry points; preserve Paid receiving and link ownership.
- [x] Preserve generic/related invoice aliases and payment-reference lookup.
- [x] Add real HTTP/PostgreSQL suite in a disposable schema-cloned database. Cases cover unspecified AR, supplier scoping, leading zeroes, duplicate rollback, acknowledged partial delivery, staged save/edit/reopen/post, known-type ambiguity, Paid receiving, alias search, explicit partial payment, concurrency, idempotent replay/changed-reference conflict and cancelled-reference reuse.

### UI and navigation

- [x] Make Supplier Document No. primary; collapse optional type/related-invoice details.
- [x] Fix grouped matching-response consumption and stale fetch handling for matching/bill/duplicate checks.
- [x] Show existing receipt review and prevent switching the bill supplied by Attach Items.
- [x] Show references first and search primary/alias references in supplier bills/payment selection.
- [x] Default supplier payments to explicit allocation; filtering retains selected amounts and explains that behavior.
- [x] Preserve earlier receiving/return route-key corrections, including Suppliers page return state.
- [x] Browser fixture verifies Attach Items context, generic matching request, duplicate blocking, explicit another-arrival acknowledgement, payment alias search and duplicate-payable messaging. It uses intercepted API fixtures; the database suite independently exercises real routes.

### Commands and results

From the repository root:

```bash
npm run -w packages/web test
npm run -w packages/web lint
npm run -w packages/web build
npm run -w packages/api lint
docker exec forson_backend_dev npm test -- --runInBand tests/grnWorkflow.test.js tests/goodsReceiptReturns.test.js tests/chequeReplacementAndDeletion.test.js
docker exec forson_backend_dev node tests/supplierApSharedWorkflows_db_test.js
docker exec forson_backend_dev node scripts/migrate.js verify
git diff --check
graphify update .
```

The new real-API suite requires a disposable database named exactly `forson_supplier_reference_test`. It creates fixtures with commits, so never run it against the development or production database. Prepare a fresh schema-only clone of the migrated local development database, then run:

```bash
docker exec -e DB_NAME=forson_supplier_reference_test -e ENABLE_CASH_DRAWER=false forson_backend_dev node tests/supplierReferenceWorkflow_db_test.js
```

The disposable database was dropped after verification. The existing supplier A/P suite instead uses a transaction and rolls back its fixtures. The frontend browser runner needs a working Puppeteer browser; the host lacks libasound.so.2, so this session used the backend container's runtime:

```bash
# Supply the development frontend's current container IP; Vite rejects the container hostname.
docker exec -i -e REFERENCE_BROWSER_BASE_URL=http://FRONTEND_CONTAINER_IP:5173 forson_backend_dev node --input-type=module < packages/web/tests/supplierReferenceBrowser.mjs
```

Both linters finish without errors and report existing warnings. Build succeeds with chunk-size/dynamic-import warnings. Migration checksum verification passes. The sandboxed graph refresh failed with `[Errno 1] Operation not permitted`; retrying with approved worker permissions succeeded (7,195 nodes, 12,826 edges). Extraction reports 30 source-metadata issues, including a curated node missing source_file; HTML generation is skipped above its 5,000-node limit. No force/shrink operation was used. No production migration or deployment was performed.

### Supplier account bill-card follow-up

The supplier account's Bills cards explicitly label **Supplier reference**, render it as a bold 18px heading, and place the internal bill number below in muted 12px text. The bill-list API exposes a read-only `display_supplier_reference` fallback from verified document identities or same-supplier linked receipts for older bills whose header reference is empty. No historical references are rewritten. Where no reference is available, the card says **No supplier reference recorded** instead of presenting the internal number as supplier paperwork.

Verification: the actual bill-list SQL executes against the local database and recovers references for 38 of 81 legacy bills with empty header references. The focused browser suite checks every fixture card's text and computed font size/weight, including legacy and missing-reference cards, then completes the existing matching/payment journeys.

### Bill-card Paperless receipt viewer

Each bill card offers **View receipt** to users with `documents:view`. This opens the supplier scan in a separate, keyboard-accessible viewer above the account drawer; **View Goods Receipt** continues to show the internal stock receipt. Closing restores focus to the original action. Multiple matching documents are selectable, with loading, empty, error and retry states. Authenticated previews use the existing Paperless image proxy; temporary blob URLs are released on change/close.

`GET /ap/supplier-bills/:billId/receipts` requires A/P visibility plus document visibility. It resolves only that bill's primary reference, active aliases, same-supplier linked goods receipt references and applicable carrier receipt references. Internal generated bill numbers never become scan searches. The existing supplier-correspondent and Goods Receipt document-type scope is retained. A bulk resolver fetches scoped metadata once for all references, deduplicates scans and excludes ambiguous or partial titles. The existing single-reference resolver delegates to that bulk resolver so tag reconciliation keeps the same identity policy.

Verification: 25 tests across `supplierBillReceipts.test.js`, `paperlessService.test.js` and `paperlessMatching.test.js` pass. The new tests use real PostgreSQL transactions that roll back and a local HTTP Paperless fixture. Browser checks cover opening/changing scans, missing scans, retry after an outage, Escape and focus restoration, alongside the earlier bill/payment journeys. A read-only lookup against the configured live Paperless instance succeeded but found no matching document for the sampled development bill; live matching of an actual scan is not established by that check. Build and scoped lint pass, with existing warnings. No new migration or remote document mutation is needed.

New files: `packages/api/services/supplierBillReceiptService.js`, `packages/api/tests/supplierBillReceipts.test.js`, `packages/web/src/components/accounts-payable/BillReceiptViewer.jsx`. Existing API routes, Paperless service, supplier drawer and browser runner are extended.

### PDF preview correction — receipt 18464

The initial viewer incorrectly assumed every Paperless preview was a PNG. Live investigation confirmed receipt **18464** (Paperless document 1236) returns `%PDF-1.7` bytes from the preview endpoint. The existing API proxy labelled those bytes image/png, and the viewer used an img element, causing the reported display failure.

The proxy now uses `getDocumentPreview`, identifies supported PDF/PNG/JPEG/GIF/WebP signatures, sends the actual Content-Type with nosniff and rejects unsupported responses. Requests use Accept `*/*`; requesting only PDF/image types made this Paperless instance reject content negotiation with HTTP 406. The existing Buffer-only artifact helper remains available for its other consumers. The viewer renders PDFs in an iframe with an Open PDF in a new tab link and images in img elements, retaining blob cleanup and retry handling.

Verification: 31 preview/matching tests pass, including mislabelled upstream PDF, image types and invalid HTML. The browser runner passed using the actual receipt 18464 PDF bytes fetched read-only from the configured Paperless instance (`REFERENCE_TEST_PAPERLESS_ID=1236` in the backend runtime). The normal runner generates a PDF fixture with pdf-lib. It verifies the PDF viewer/blob MIME type alongside image switching, empty/error/retry handling and keyboard focus restoration. No document/tag or financial mutation was performed.

### Follow-up audit of the reported persistent preview error

A read-only audit fetched all 268 Goods Receipt previews from Paperless: all are PDFs, none failed retrieval or PDF structure/page parsing. Receipt 18464 is readable and unencrypted. A real browser session against the running API/frontend (no mocked receipt responses) resolved bill 81 to document 1236 and loaded its PDF frame without the reported image error. That persistent error was not reproduced; the user's exact app URL was requested before attributing it to cache or another deployment. The browser now detects a PDF signature and constructs a correctly typed Blob even when a proxy mislabels PDF bytes as image/png.

Results and reproduction: `scratch/2026-10-20_paperless-preview-audit.md`, its per-document JSON, and the read-only `packages/api/scripts/auditPaperlessReceiptPreviews.js`. A browser regression uses the actual PDF bytes for 18464 with intentionally incorrect image/png headers. Scope is preview retrieval and PDF parsing for all documents, not full browser rendering of every receipt.

## 5. Explicitly Deferred and Limits

- A general multi-document upload/bundle system, automatic OCR classification and automatic matching/association.
- Adding a later reference without a receiving event through a new standalone alias editor; existing receiving related-invoice and audited correction mechanisms remain available.
- Consolidation/reassignment of posted payables, statements of account creating liabilities, and automatic retrospective matching.
- A Receive now / Bill later mode: requires a separately designed accrual/unbilled-receipt accounting workflow.
- Classifying every historical document. Unknown historical collisions require review; the system cannot prove a separate arrival without a unique external delivery identifier.
- Generic references in posted history are shown read-only. This change does not add a posted generic-reference editing action.

## 6. Files Touched

- API: `routes/apRoutes.js`, `routes/apPdcRoutes.js`, `routes/goodsReceiptRoutes.js`; `services/supplierBillService.js`, `services/supplierReceiptReferenceService.js`, `services/grnPostingService.js`, `services/apPaymentService.js`, `services/paperlessService.js`; `tests/supplierReferenceWorkflow_db_test.js`.
- Web: GoodsReceiptPage/history/drafts; SupplierDetailDrawer; AddPayableModal, RecordSupplierPaymentModal, BillGoodsReceiptsModal, PaymentsRegisterTable, IssueOutboundChequeModal; new `utils/supplierReference.js`; browser fixture/runner.
- Earlier route fix retained: MainLayout, AccountsPayablePage, apNavigationContract and supplier drawer.
- Migration: `database/migrations/20261020_02_goods_receipt_supplier_reference.sql`.
- Documentation: this handoff, the original shared-workflow plan cross-reference, and the scratch research review.

## 7. Change Log

| Date | Session | Change |
|---|---|---|
| 2026-10-20 | Codex + product owner | Replaced mandatory typed/invoice-first entry with supplier-reference-first receiving, A/P lookup and explicit payment selection; implemented and locally verified. |
| 2026-10-20 | Codex + product owner | Made supplier references prominent on each account bill card and recovered legacy display references from linked receipts without rewriting history. |
| 2026-10-20 | Codex + product owner | Added bill-card View receipt action with supplier-scoped Paperless scan resolution, authenticated preview and missing/error/retry handling. |
| 2026-10-20 | Codex + product owner | Corrected PDF previews after receipt 18464 exposed the original PNG-only assumption; verified with its actual Paperless PDF. |
| 2026-10-20 | Codex + product owner | Audited all 268 supplier previews after the persistent 18464 report; added client-side PDF byte detection and a live viewer test hook. |
