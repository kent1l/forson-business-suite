# Goods Receipt Physical Receipt Number — Implementation Plan

> **Forson Business Suite** | **Date:** 2026-09-22 | **Branch:** `master`
> **Status:** Implemented locally; database migration still needs applying to a reachable PostgreSQL instance.

## 0. Status at a Glance

| Phase | Status | Outcome |
|---|---|---|
| Data integrity | Implemented, unverified against local DB | Forward-only migration adds a supplier-scoped partial unique index |
| API and workflow | Implemented | Normalized value flows through create, draft, search, lookup, and narrow header correction |
| Goods Receipt entry | Implemented | Optional field with debounced duplicate feedback and submit guard |
| Receipt history | Implemented | Number is searchable, visible, and safely editable after posting |
| Tests and verification | Partially done | Focused mocked route tests, lint, and production build pass; PostgreSQL integration remains pending because local `postgres` authentication failed |

## 1. For a New Session or Agent Picking This Up

Before implementation:

1. Run `graphify query "goods receipt physical receipt number supplier duplicate draft post history"`.
2. Recall hindsight with query `"Forson goods receipt physical receipt number plan"` and tags `forson-business-suite`, `goods-receipt`, `physical-receipt-number`.
3. Confirm this plan remains unimplemented with `git status` and `git log --oneline -10`.
4. Treat the database unique index as the authority. A client-side availability check is only feedback while entering data and must never be the only guard.

When a phase lands, update §0 and that phase, retain non-obvious decisions, and run `graphify update .`.

## 2. Objective

Prevent a supplier delivery document from being recorded more than once while allowing different suppliers to use the same printed receipt number. Receivers need to enter the number on every goods receipt; history needs to show and find it; authorized users need to add or correct it after the goods receipt has posted without reopening inventory, WAC, payable, or line-item edits.

## 3. Decisions Already Taken

- Present one **Supplier Receipt / Invoice / DR No.** field to receivers. It persists as `physical_receipt_no`; for backfills the same value also populates the legacy `supplier_invoice_no` field required by the existing AP workflow.
- Store the physical value as an optional `VARCHAR(100)`, normalized with the existing receipt-number formatter (trimmed, uppercased, separator-normalized). Blank input becomes `NULL`.
- Uniqueness is `(supplier_id, physical_receipt_no)`, case-insensitive/canonicalized, for every non-voided GRN—including Draft and Submitted documents—so a duplicate cannot be staged and later posted. A voided document releases the number, matching the current supplier-invoice behavior.
- A physical receipt number remains optional. The feature prevents duplicates whenever a number is supplied; it does not make numbering mandatory for every supplier or workflow.
- Use the existing `goods_receipt:edit` permission for after-posting number changes. The dedicated endpoint changes only this header field, avoiding the existing full-GRN update path that replaces lines and replays inventory/WAC.
- The UI will show an advisory duplicate state once both supplier and number are present, but the migration-level unique index handles races, direct API calls, drafts, and one-shot posting.

## 4. Architecture / Domain Model

`goods_receipt` is the durable header shared by two paths:

```
Goods Receipt form ──> Draft / Submitted ──> Post ──> Receipt History
                         │                       │          │
                         └──── physical_receipt_no on the same GRN header ────┘
```

The database index owns the invariant. The API carries the same normalized header attribute through all read/write queries. The web entry page owns input and advisory validation; the history page owns presentation and a narrow post-posting edit control.

## 5. Phase 1 — Data Integrity

1. Add a forward-only migration under `database/migrations/` that adds nullable `physical_receipt_no VARCHAR(100)` to `goods_receipt`, comments its supplier-document purpose, and creates a partial unique index on `(supplier_id, physical_receipt_no)` for non-null, nonblank, non-voided values. Use an expression/index strategy consistent with the canonical form produced by the API; do not edit `database/initial_schema.sql` without this matching migration.
2. Make the migration idempotent (`IF NOT EXISTS` where PostgreSQL supports it). Existing data remains null. New backfills mirror the one user-entered supplier-document reference into the legacy `supplier_invoice_no` column for AP compatibility.
3. Choose a clear constraint/index name, e.g. `uq_goods_receipt_supplier_physical_receipt`, and map its `23505` error to a `409` that says the physical receipt number already exists for the selected supplier.
4. Confirm the predicate permits reuse after a GRN is voided, but does not permit a second Draft, Submitted, or Posted GRN for the same active supplier/document pair.

## 6. Phase 2 — API and Workflow

1. In `packages/api/routes/goodsReceiptRoutes.js`, add a small header-value normalizer using `helpers/receiptNumberFormatter.js` (or extract a shared normalizer only if the existing formatter cannot meet the GRN contract). Normalize before each write.
2. Extend the one-shot `POST /goods-receipts`, `POST /goods-receipts/drafts`, and `PUT /goods-receipts/:id/draft` payload/header SQL to accept and save `physical_receipt_no`. This covers direct posting, saved drafts, resaved drafts, and posting a saved draft without a second user edit.
3. Add `physical_receipt_no` to `GET /goods-receipts`, `GET /goods-receipts/:id`, and the draft list. Extend the history and draft search predicates so users can find a GRN by the printed number.
4. Add an authenticated advisory availability endpoint such as `GET /goods-receipts/check-physical-receipt?supplier_id=&physical_receipt_no=&exclude_grn_id=`. It should return `{ is_taken, grn_id, grn_number, workflow_status }` for a matching non-voided GRN, exclude the GRN currently being edited, and require goods-receipt access. It must use parameterized SQL and return a validation error when supplier/number is absent or invalid.
5. Add `PATCH /goods-receipts/:id/physical-receipt-no`, protected by `goods_receipt:edit`. In a transaction, lock the GRN, reject nonexistent/voided rows, normalize the nullable submitted value, update just `physical_receipt_no` and `updated_at`, and convert the unique-index race to the same `409`. Return the updated header value.
6. Preserve current accounting boundaries: neither this PATCH nor duplicate checking may edit receipt lines, supplier bills, inventory transactions, purchase-order receipt quantities, costs, dates, or workflow state.

## 7. Phase 3 — Goods Receipt Entry UX

1. In `packages/web/src/pages/GoodsReceiptPage.jsx`, add `physicalReceiptNo` state; include it in local draft persistence, staged receipt load, `buildPayload`, and `resetForm`.
2. Place an always-visible **Physical Receipt No. (optional)** field with the receipt/header fields—not inside the backfill-only block. Keep the existing **Supplier Invoice / DR No.** field unchanged and explain the distinction concisely in helper text.
3. Debounce the availability request until both a supplier and a nonblank normalized number exist. Show a non-blocking but prominent message naming the existing GRN and its status when taken; clear stale results whenever supplier or value changes. Disable Save Draft, Submit/Post, and one-shot Post while the current lookup confirms a conflict, but still surface backend `409` as the definitive result.
4. Ensure reopening a Draft displays its stored physical number and validates against itself using `exclude_grn_id`; this prevents the edit flow from falsely treating its own number as a duplicate.
5. Update any other visible Goods Receipt creation surface that sends `POST /goods-receipts` (notably A/P attach-items) only if it exposes receipt-header entry. It may continue sending no value when its compact flow intentionally has no physical document field.

## 8. Phase 4 — Receipt History and Post-Posting Correction

1. In `packages/web/src/pages/GoodsReceiptHistoryPage.jsx`, add a **Physical Receipt No.** column and include it in the existing text search experience. Show an em dash for null.
2. In the details modal, display the number next to supplier/date metadata. For a non-voided GRN and a user with `goods_receipt:edit`, provide an inline edit/add control separate from the line-edit mode.
3. The control calls the narrow PATCH endpoint, displays a duplicate `409` inline/toast, then updates both `selectedGrn` and the cached list row so the change is immediately visible. It must work for posted receipts without enabling or invoking the full line-edit save.
4. Keep voided receipts read-only; they are historical evidence and their numbers are deliberately reusable by the data constraint.

## 9. Phase 5 — Tests and Verification

1. Extend `packages/api/tests/goodsReceiptInventory.test.js` (and/or a focused new route test) to assert list/detail fields and physical-number search behavior.
2. Add route tests for draft creation/update, one-shot posting, and staged posting with physical numbers; test same supplier + equivalent normalized value yields `409`, different supplier is allowed, the same GRN may retain its own value, and a voided source does not conflict.
3. Add tests for the availability endpoint and post-posting PATCH: permission protection, null/blank clearing, successful add/edit, voided-receipt rejection, and race/unique-violation `409` mapping.
4. Add a real-PostgreSQL migration/integration case (following `goodsReceiptPosting_db_test.js`) that proves the partial supplier-scoped unique index itself—not a mock—blocks duplicates and allows cross-supplier and voided-GRN reuse.
5. Run:

```bash
npm run -w packages/api test -- --runInBand packages/api/tests/goodsReceiptInventory.test.js
npm run -w packages/api test -- --runInBand packages/api/tests/goodsReceiptReturns.test.js
npm run -w packages/api lint
npm run -w packages/web lint
npm run -w packages/web build
npm run -w packages/api migrate:verify -- --host localhost
graphify update .
```

## 10. Explicitly Deferred

- Requiring a physical receipt number for all GRNs or only selected suppliers/payment conditions. This plan keeps it optional; mandate rules need an explicit business policy.
- Cross-module global receipt-number uniqueness. Sales receipts currently have independent rules; the stated supplier-collision requirement is specifically for goods receipts.
- Audit-log records of individual number corrections. Existing `updated_at` is sufficient for this scoped change; add a dedicated audit trail only if compliance requires who/when/old-value history.

## 11. Files Expected to Change

- `database/migrations/<timestamp>_goods_receipt_physical_receipt_no.sql`
- `packages/api/routes/goodsReceiptRoutes.js`
- `packages/api/tests/goodsReceiptInventory.test.js` and/or a new focused GRN route test
- `packages/api/tests/goodsReceiptPosting_db_test.js`
- `packages/web/src/pages/GoodsReceiptPage.jsx`
- `packages/web/src/pages/GoodsReceiptHistoryPage.jsx`

## 12. Change Log

| Date | Session | Change |
|---|---|---|
| 2026-09-22 | Codex + product owner | Created implementation plan for supplier-scoped physical receipt numbers on goods receipts, including entry validation, history display, and safe after-posting correction. |
| 2026-09-22 | Codex | Implemented the migration, API workflow, entry/history UI, and focused route coverage. Local PostgreSQL verification was unavailable in the sandbox. |
| 2026-09-22 | Codex + product owner | Consolidated the entry UI to one supplier-document reference under Supplier; backfills mirror it into the legacy invoice field for compatibility. |
