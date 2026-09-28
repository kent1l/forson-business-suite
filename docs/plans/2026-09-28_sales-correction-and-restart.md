# Sales Correction & Restart — Product Proposal and Developer Handoff

> **Forson Business Suite** | **Date:** 2026-09-28
> **Status:** The safe cancel-only Correct & Restart slice is implemented behind a feature flag. Payment and credit-note recovery resolutions remain deliberately blocked for finance/tax policy and dedicated payout/recovery integration.

## 0. Status at a Glance

| Phase | Status | Outcome |
|---|---|---|
| Immediate double-action safeguards | **Implemented** | A void is rejected once an invoice has a credit note; a refund is rejected after a void; duplicate invoice-line selections in one refund are rejected. |
| State model and audit schema | **Partially implemented** | Durable cases, events, permissions, idempotency, resolution evidence, and replacement links exist; finance policy is pending. |
| Correction & Restart API | **Partially implemented** | Preview/create/read/approve endpoints atomically execute only unpaid/no-credit-note cancel-only corrections; money/refund paths are recorded for manual review. |
| Sales History / POS UX | **Partially implemented** | Feature-flagged Sales History modal supports preview, reason, case creation, and manager approval; it does not yet start a prefilled cart or expose a timeline. |
| Future receipt-printing integration | **Explicitly deferred** | If a print feature is added later, record print/issuance events as audit signals; it must not become the sole financial gate. |
| Verification and rollout | **Not started** | Add database-backed invariants, audit review, and staged release. |

## 1. For a New Session or Agent Picking This Up

Before implementation:

1. Run `graphify query "invoice refund credit note void inventory transaction ar ledger"`. If the graph is missing, regenerate/update it according to project instructions before relying on file references here.
2. Recall hindsight with `"Forson sales correction restart refund void"` and tags `forson-business-suite`, `refunds`, `invoicing`, `accounting-integrity`.
3. Confirm this document's status against `git status`, `git log --oneline -10`, and the migration state. The safeguards were committed as `e8db94b` when this plan was written.
4. Do not weaken the current 409 guards. They remain authoritative for refunded invoices until a finance-approved payout/recovery workflow exists.

When a phase lands, update §0 and its detailed section, retain non-obvious decisions, and run `graphify update .`.

## 2. Objective

Let an authorized employee recover from a mistaken completed sale without deleting or mutating financial history. The workflow must make it easy to **start a corrected sale**, while ensuring revenue, VAT, cash/bank movement, customer A/R, and stock are each corrected exactly once.

The proposed product name is **Correct & Restart Sale**. It replaces the confusing choice between an unsafe post-refund void and manually piecing together a replacement sale.

## 3. Decisions Already Taken

- **A completed transaction is corrected by linked documents, never by erasing history.** The original invoice, payments, credit notes, inventory transactions, approvals, and replacement invoice remain traceable.
- **A credit note is final until explicitly corrected.** A simple invoice void remains blocked after a credit note because otherwise the cancelled sale disappears from sales totals while the credit note remains in refund/tax totals.
- **Receipt printing is not a dependency of this plan.** The system has no printing feature today. If one is introduced later, print/reprint data is only an audit signal; payment settlement, fulfillment/delivery, refund payout, and closed periods govern which correction is valid.
- **Choose the lowest-risk valid correction automatically.** An unpaid, unissued, unfulfilled invoice may be cancelled. Once money, goods, or issued documents are involved, create explicit compensating entries and require suitable approval.
- **Do not silently recycle the original invoice/physical-receipt number.** The replacement gets fresh identity unless a finance-approved compliance policy says otherwise.
- **This is not an undo button.** It is an auditable case with a reason, resolution, requester, approver where needed, and links to all generated documents.

Philippine invoicing rules treat invoices as primary sales documents and credit/debit memos as supplementary accounting documents. That supports retaining a visible correction trail rather than deleting issued records; confirm the company’s final procedure with its accountant/tax adviser before release. [BIR RR 7-2024](https://bir-cdn.bir.gov.ph/BIR/pdf/RR%20No.%207-%202024.pdf) [BIR RMC 77-2024](https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2077-%202024.pdf)

## 4. Target Domain Model

```
Draft cart
  └─ complete sale ──> Invoice issued
                         ├─ payment settled / on-account
                         ├─ stock fulfilled
                         └─ optional future: receipt-print/issuance audit events

Invoice issued ──> Correct & Restart case
                    ├─ cancel-only correction
                    ├─ payment reversal or recovery
                    ├─ credit-note/refund correction when applicable
                    ├─ stock correction, exactly once
                    └─ optional linked replacement invoice
```

Recommended durable records/fields (final names must be designed against the current schema):

- `sales_correction_case`: original invoice, reason code/text, requested/approved users, state, chosen financial resolution, timestamps, and replacement invoice link.
- Immutable links from each generated reversal/recovery document to the case and original document; never rely only on free-text notes.
- **Future integration only:** if receipt printing is later introduced, add audit fields/events such as `printed_at`, `print_count`, and `last_printed_by`. These are not prerequisites for Correct & Restart.
- An explicit refund-payout/recovery representation if one does not already exist. A credit note reduces a sale; it does not prove whether cash was physically paid out.

## 5. Target Operator Experience

In Sales History/invoice details, provide **Correct & Restart Sale** for completed sales. Its opening summary names the original invoice, payment state, stock/fulfillment state, and issued credit notes. It must work without receipt printing.

1. **Describe the mistake:** require a reason code and free text.
2. **Classify state:** server-side checks determine payment, credit-note, stock, and accounting-period state.
3. **Offer only valid resolutions:**
   - **Cancel and start again** for an unrefunded, reversible sale.
   - **Reverse/return original payment, then start again** for settled payments without refunds.
   - **Correct refund first, then restart** for an issued credit note: record whether the customer repaid the mistaken refund, the refund was never released, or the refund remains valid and the replacement sale is independent.
   - **Request manager/accounting review** for delivery, closed periods, or anything unsafe to automate.
4. **Preview consequences:** show expected stock, A/R, cash/bank, and tax effects plus the proposed replacement number.
5. **Approve and execute:** manager approval is required for financial reversals/refund correction; the backend creates all effects atomically.
6. **Continue work:** open the clean replacement sale/cart when appropriate and retain a timeline link to the original correction case.

Future receipt-printing integration (not part of this implementation):

- When a printing feature exists, it should warn that a completed invoice needs an auditable correction path; reprints should increment audit data only.
- The UI must never imply that a sale can be erased simply because it was not printed; payment, stock, and refund effects remain authoritative.

## 6. Phase 1 — State and Data-Integrity Design

### As Built (partial)

- `20260928_03_sales_correction_cases.sql` adds `sales_correction_case` and append-only `sales_correction_event`, with one case per original invoice, a UUID idempotency key, constrained state/resolution values, immutable document links, permissions, and an off-by-default `ENABLE_SALES_CORRECTIONS` flag.
- The baseline schema was updated in lockstep. A replacement is linked only by the normal invoice-create transaction after its case is completed; it always receives the usual new document identity.
- The implementation preserves the original physical receipt on a Correct & Restart cancellation. It intentionally does not repeat the legacy void route's receipt-number release behavior.

### Still Required

- Finance/tax must settle the policy for payment reversal, refund payout/recovery evidence, closed periods, receipt treatment, and approval levels before money/refund automation is written.

1. Inventory current invoice, `invoice_payments`, `credit_note`, `credit_note_line`, `inventory_transaction`, `ar_ledger`, customer-wallet, and receipt-number triggers/constraints.
2. Add a forward-only migration for the correction-case model and immutable document relationships. Do not edit `database/initial_schema.sql` without a matching migration.
3. Define finite case states such as `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `EXECUTING`, `COMPLETED`, `REJECTED`, and `FAILED`, including legal transitions.
4. Add idempotency/uniqueness so concurrent confirmation cannot create duplicate cases or replacement invoices.
5. Define financial-resolution evidence, especially whether a refund was paid out or never released.
6. Agree finance/tax policy for invoice correction, physical receipt numbers, closed periods, and approval levels before implementation.

## 7. Phase 2 — Atomic Service and API

### As Built (partial)

- `packages/api/services/salesCorrectionService.js` owns state classification and transaction execution. It locks the invoice and case, recomputes eligibility at approval, records correction-specific inventory reversals, and appends the exact inverse A/R net once.
- Routes provide `POST /sales-corrections/preview`, `POST /sales-corrections`, `POST /sales-corrections/:id/approve`, and `GET /sales-corrections/:id`, protected by dedicated permissions.
- Only invoices with no `invoice_payments`, no `credit_note`, and no sales period lock can complete automatically. Payment, credit-note, cancelled, and locked cases are persisted as `REQUIRES_MANUAL_REVIEW`; no cash, wallet, cheque, refund, tax, or stock mutation is attempted for them.
- `POST /invoices` accepts `sales_correction_case_id` only for a completed, unlinked case and atomically writes the replacement invoice link. The replacement is an ordinary new invoice and never inherits the original's payment/refund state.

### Still Required

- Integrate approved payment reversal, wallet, cheque, and refund-payout/recovery services and execute each finance-approved resolution atomically. Do not replace this work with raw payment-status updates.
- Add a reconciliation query that proves each completed case's inventory, A/R, cash/bank, and reporting deltas agree with its selected resolution.

1. Implement a dedicated `packages/api/services/salesCorrectionService.js`; do not expand `DELETE /invoices/:id` into a multi-purpose workflow.
2. Add clearly scoped endpoints such as `POST /sales-corrections/preview`, `POST /sales-corrections`, and `GET /sales-corrections/:id`, with dedicated permissions. Recompute preview server-side at confirmation.
3. Lock the original invoice and all relevant correction records in one transaction, then re-check every state condition.
4. Generate compensating inventory/ledger entries with stable case/document references. Every original economic effect receives at most one corresponding compensation for the selected case.
5. Use payment, wallet, cheque, and refund-payout services rather than raw status writes that bypass their accounting rules.
6. Create a replacement invoice only after correction validation; it must be linked to the case, receive new identity per policy, and never inherit payment/refund state.
7. Keep the simple void endpoint narrow. It can delegate only for an eligible cancel-only path, never for a refunded invoice without explicit resolution.

## 8. Phase 3 — Web, Tests, and Rollout

### As Built (partial)

- `SalesCorrectionModal` is available from invoice details only when `ENABLE_SALES_CORRECTIONS=true` and the caller has `sales_correction:create`. It displays the server preview, requires a reason, records the case, and exposes manager approval where permitted.
- Focused route tests cover preview validation, authenticated ownership, idempotency forwarding, and dedicated approval routing. Existing refunded-invoice void guard tests continue to pass.

### Still Required

- Add PostgreSQL-backed economic-delta and concurrency coverage for every resolution, plus authorization/transition/UI tests.
- Add a correction-case timeline, a clean prefilled replacement cart flow, feature-flag administration/release checklist, and accounting review of early cases.

1. Build the state summary, reason entry, resolution selection, impact preview, approval, completion, and correction timeline in Sales History/invoice details.
2. Add real-PostgreSQL tests for unpaid, paid, partially paid, partly/fully refunded, returned stock, and closed/open-period combinations.
4. Assert exact deltas for inventory, A/R ledger net, settlement, customer wallet, tax/reporting source rows, and receipt-number behavior. Include retry/concurrency tests.
5. Add route/UI tests for authorization, invalid transitions, preview drift, approvals, and idempotency.
6. Add a reconciliation query for correction cases whose net inventory/ledger result does not match their selected resolution.
7. Release behind a feature flag and review early cases with accounting before broad enablement.

## 9. Explicitly Deferred

- This document does **not** implement receipt printing or depend on receipt printing. A future print feature can integrate audit events after Correct & Restart is stable.
- It does not decide final company tax/compliance policy for receipt reuse or issued-invoice handling; accountant/tax-adviser approval is required.
- It does not automatically repair historical invoices both refunded and voided before `e8db94b`; cash payout facts cannot safely be inferred from credit-note data alone, so remediation needs a separately reviewed reconciliation plan.
- The existing refund/void safeguards remain authoritative until the atomic correction service and real-PostgreSQL tests exist.
- Payment reversal and refund recovery are intentionally not automated. The service records those cases as manual-review only until finance/tax policy and dedicated settlement/payout integration are approved.

## 10. Files Touched So Far

Immediate integrity safeguards:

- `packages/api/routes/refundRoutes.js`
- `packages/api/routes/invoiceRoutes.js`
- `packages/api/tests/refunds.test.js`
- `packages/api/tests/invoiceVoidRefund.test.js`

Deferred proposal:

- `docs/plans/2026-09-28_sales-correction-and-restart.md`

Correct & Restart implementation:

- `database/migrations/20260928_03_sales_correction_cases.sql`
- `database/initial_schema.sql`
- `packages/api/services/salesCorrectionService.js`
- `packages/api/routes/salesCorrectionRoutes.js`
- `packages/api/index.js`
- `packages/api/routes/invoiceRoutes.js`
- `packages/api/tests/salesCorrectionRoutes.test.js`
- `packages/web/src/components/refunds/SalesCorrectionModal.jsx`
- `packages/web/src/components/refunds/InvoiceDetailsModal.jsx`

## 11. Verification Commands

The immediate safeguard work was syntax-checked and `git diff --check` was clean. Focused Jest execution was not confirmed in the interrupted workspace because dependency installation was incomplete.

Verified in this session:

```bash
npm run -w packages/api test -- --runInBand packages/api/tests/salesCorrectionRoutes.test.js packages/api/tests/invoiceVoidRefund.test.js
npm run -w packages/api lint
npm run -w packages/web lint
npm run -w packages/web build
git diff --check
```

`migrate:verify -- --host localhost` reached the local database but could not authenticate as `postgres`; rerun it with the correct local DB credentials before applying the migration.

## 12. Change Log

| Date | Session | Change |
|---|---|---|
| 2026-09-28 | Codex + product owner | Documented the deferred Correct & Restart Sales workflow. Confirmed receipt printing does not yet exist and is not a prerequisite; if added later, it is an audit/UX signal—not the sole financial gate. Retained existing refund/void safeguards until an atomic correction workflow is built. |
| 2026-09-28 | Codex | Implemented the safe, feature-flagged cancel-only slice: durable cases/events, dedicated atomic API, replacement link support, Sales History modal, and focused route coverage. Deferred payment/refund recovery automation pending explicit finance/tax policy and payout/recovery service design. |
