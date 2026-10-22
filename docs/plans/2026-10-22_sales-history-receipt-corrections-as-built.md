# Sales History Receipt Corrections & Paper Outcomes — As Built

**Status:** Completed and verified locally; migration applied to the development database.  
**Authoritative context:** Extends `2026-10-21_physical-receipt-suggestions-and-tax-selection-v2.md` and its as-built record.  
**Delivery:** Working-tree changes; no commit or production deployment requested.

## 1. Status at a Glance

| Phase / Area | Status | Deliverables & Notes |
|---|---|---|
| Registry history & permissions | Completed | Forward migration `20261022_03_invoice_receipt_corrections.sql`; invoice receipt versions; historical source links; dedicated unused-number release permission. |
| Shared correction/void service | Completed | Reasons, explicit paper outcomes, locking, version checks, series/bounds/tax validation, append-only application events. |
| Transaction details UI | Completed | Receipt correction and void dialogs; receipt history; fresh invoice state following actions; correct payment-settlement endpoint. |
| Correct & Restart / exchanges | Completed | Restart approval uses the shared paper-outcome workflow; exchange replacements use normal physical-document issuance without renumbering. |
| Focused verification | Passed | 49 targeted Jest assertions, real PostgreSQL refund/date/receipt scenarios, eight exchange scenarios, and Chromium checks of every transaction-details action. |
| Full verification / local rollout | Passed | 106 API suites, 1,392 tests passed and one skipped; six snapshots passed. Web tests/build and both lints passed with warnings only. Migration applied and checksums verified locally; authenticated running API read returned 200. |

## 2. For a New Session or Agent Picking This Up

Before starting:
1. Run `graphify query "Sales History invoice receipt correction void paper outcome"` for current structure.
2. Recall Hindsight with tags `forson-business-suite`, `receipt-corrections` for decisions and test isolation details.
3. Compare this status with `git status`, `git log`, migration status, and the actual system before trusting it.

After changing this area, update this record, retain new non-obvious decisions, and run `graphify update .`.

## 3. Business Objective & Decisions

Keep receipt numbers editable for legitimate corrections while accounting for the physical paper. Both editing and voiding require a reason (5–100 characters) and, when paper was assigned, an explicit outcome:

| Original paper outcome | Registry result | Number reusable? |
|---|---|---|
| Never used; mistaken software assignment | `UNOCCUPIED` | Yes, with `invoice:release_receipt_no` permission |
| Spoiled | `SPOILED` | No |
| Issued, then cancelled/replaced | `VOIDED` | No |

There is no default paper outcome. The reason and old/new identities remain visible under Receipt history. Released numbers are eligible again without rewinding either issuance continuation. Cancelled invoices cannot be reassigned. Refunds, payment settlement, and date corrections preserve the paper identity.

The existing `invoice:edit_receipt_no` and `invoice:delete` permissions still control their actions. The new release permission is granted to existing Admin/Manager roles (10/7) and appears automatically in the database-driven Admin Settings permission editor. Approval of Correct & Restart uses its existing permission, plus the release permission when applicable.

## 4. Architecture & As Built

### Registry & Migration

The invoice has `physical_receipt_version` for stale-form protection. Previous source links become `HISTORICAL`; one `PRIMARY` invoice link identifies its current assignment. Corrections create a new registry row rather than changing the old paper identity. The compatibility uniqueness function blocks historical spoiled/voided records even when their previous owner is excluded.

The migration also repairs registry-backed previously cancelled invoices left `ISSUED` by the old void route, marks them `VOIDED`, restores their cleared invoice reference, and records the repair. It never frees a number. Legacy numbers already erased without registry/audit evidence cannot be reconstructed automatically.

### Shared API

`GET /invoices/:id/receipt-control` returns the current invoice, configured series, and up to 100 recent receipt events. Existing invoice correction `PUT` and void `DELETE` now require `reason`, `expected_version`, and `paper_outcome` when applicable. Paper replacement also requires `series_id`, `physical_receipt_no`, and explicit `recording_method`; Notebook is explicit. Ambiguous legacy assignments require `original_series_id`.

The invoice row is locked first; affected series are locked in numeric order; registry changes, source links, and events commit with the source operation. Replacement references must match an active sales series, eligible sales context, bounds, and existing line/tax-breakdown mappings. Corrections never change financial amounts or replay issuance preferences. They raise high-water when appropriate but leave last-issued order and cashier preference alone. Notebook correction is conservatively blocked if a configured sales selection policy disables Notebook.

### Other Transaction Actions

- **Void Invoice:** paper state and financial reversal are atomic. Existing refund/credit-note conflict protection remains in effect. Retained spoiled/voided references stay on the cancelled invoice; released unused references remain in events/history.
- **Correct & Restart:** approval sends `receipt_decision` through the same shared void service. Completed approval replays remain idempotent.
- **Exchange Items:** original paper remains occupied; replacement uses the configured PhysicalDocumentControl and `postPhysicalDocument`. Missing assignments or duplicate paper references reject instead of renumbering. Existing financial and stock scenarios still pass.
- **Mark Settled:** UI now calls `PUT /invoices/payments/:payment_id/settle` (the prior PATCH URL did not exist). The handler locks the invoice before its payment and rejects cancelled invoices.
- **Refund / Change Date:** preserve registry assignments. Transaction details reload the current invoice following actions; permission/status guards hide invalid financial actions after cancellation.

## 5. Explicitly Deferred

- Production deployment, release/version changes, and commits were not requested.
- No reconstruction of legacy references whose evidence was already erased.
- No new support for editing cancelled receipts; their history remains available.
- Generated HTML manuals are not regenerated here; the source Sales History manual is updated.

## 6. Files Touched

- `database/migrations/20261022_03_invoice_receipt_corrections.sql`
- `packages/api/services/invoiceReceiptService.js`
- `packages/api/services/salesCorrectionService.js`
- `packages/api/services/exchangeService.js`
- `packages/api/routes/invoiceRoutes.js`
- `packages/api/routes/salesCorrectionRoutes.js`
- `packages/api/routes/exchangeRoutes.js`
- `packages/api/tests/invoiceReceiptActions.test.js`
- `packages/api/tests/invoicePaymentSettle.test.js`
- `packages/api/tests/paperlessUniquenessIntegration.test.js`
- `packages/api/tests/receivePaymentPhysicalReceipt.test.js`
- `packages/api/tests/salesCorrectionRoutes.test.js`
- `packages/api/tests/exchange_db_test.js`
- `packages/web/src/components/refunds/ReceiptActionModal.jsx`
- `packages/web/src/components/refunds/InvoiceDetailsModal.jsx`
- `packages/web/src/components/refunds/SalesCorrectionModal.jsx`
- `packages/web/src/components/pos/ExchangeModal.jsx`
- `packages/web/tests/receiptActionsBrowser.mjs`
- `packages/web/tests/fixtures/receiptActionsBrowser.html`
- `docs/manuals/sales_history_manual.md`
- This document; graphify-generated files after refresh.

## 7. Verification Commands

All database integration work runs in the backend container. Tests used a separate snapshot of the development DB, named `forson_receipt_control_20261022_test`; the `*_test` suffix is required by an existing merge concurrency test. Its immutable audit evidence is retained between runs, so receipt fixtures use unique serials.

```bash
docker exec -e DB_NAME=forson_receipt_control_20261022_test forson_backend_dev npm test -- --runInBand
docker exec -e DB_NAME=forson_receipt_control_20261022_test forson_backend_dev node tests/exchange_db_test.js
docker exec -i forson_backend_dev node --input-type=module < packages/web/tests/receiptActionsBrowser.mjs
npm run -w packages/web test
npm run -w packages/web build
npm run -w packages/web lint
npm run -w packages/api lint
git diff --check
graphify update .
```

Migration (target only this change; an unrelated `20261022_02_collection_group_master_merge_guard.sql` was already pending at session start):

```bash
docker exec forson_backend_dev node scripts/migrate.js up --from 20261022_03_invoice_receipt_corrections.sql --to 20261022_03_invoice_receipt_corrections.sql
docker exec forson_backend_dev node scripts/migrate.js verify --from 20261022_03_invoice_receipt_corrections.sql --to 20261022_03_invoice_receipt_corrections.sql
```

Final results: all 106 API suites passed (1,392 passed, one skipped, six snapshots); all eight exchange scenarios passed; Chromium checks passed; all 12 web test files passed; web build passed; API and web lint reported zero errors (existing warnings remain). The running development receipt-control endpoint returned 200 with a version, series options, and history. Only migration `20261022_03` was applied; the pre-existing unrelated `20261022_02` remains pending.

Graph refresh completed (7,660 nodes, 13,515 edges). It reported 30 source-metadata extraction warnings and skipped HTML rendering because the graph exceeds 5,000 nodes; code graph and report updates succeeded. The new document's deep semantic indexing was not run.

Browser fixtures intercept API requests and check UI wiring without changing real transactions. Real PostgreSQL tests verify registry outcomes, permissions, stale/concurrent edits, tax compatibility, legacy adoption, financial invariants, and rollback.

## 8. Change Log

- **2026-10-22:** Implemented the agreed receipt correction/void outcomes and Sales History action integration; added real database and browser regressions. Full verification passed; the new migration was applied to local development and its checksum verified. Production was not deployed.
