# Sales Correction & Restart — Product Proposal and Developer Handoff

> **Forson Business Suite** | **Date:** 2026-09-28
> **Status:** Immediate integrity safeguards are implemented. The guided correction-and-restart workflow is deliberately deferred for product review and later implementation.

## 0. Status at a Glance

| Phase | Status | Outcome |
|---|---|---|
| Immediate double-action safeguards | **Implemented** | A void is rejected once an invoice has a credit note; a refund is rejected after a void; duplicate invoice-line selections in one refund are rejected. |
| State model and audit schema | **Not started** | Define durable correction-case and linked-replacement records. |
| Correction & Restart API | **Not started** | Implement an approved, atomic workflow rather than re-opening a void operation. |
| Sales History / POS UX | **Not started** | Give operators one guided correction entry point with manager approval and clear choices. |
| Future receipt-printing integration | **Explicitly deferred** | If a print feature is added later, record print/issuance events as audit signals; it must not become the sole financial gate. |
| Verification and rollout | **Not started** | Add database-backed invariants, audit review, and staged release. |

## 1. For a New Session or Agent Picking This Up

Before implementation:

1. Run `graphify query "invoice refund credit note void inventory transaction ar ledger"`. If the graph is missing, regenerate/update it according to project instructions before relying on file references here.
2. Recall hindsight with `"Forson sales correction restart refund void"` and tags `forson-business-suite`, `refunds`, `invoicing`, `accounting-integrity`.
3. Confirm this document's status against `git status`, `git log --oneline -10`, and the migration state. The safeguards were committed as `e8db94b` when this plan was written.
4. Do not weaken the current 409 guards before the atomic workflow exists. They prevent an active credit note from becoming a second contradictory correction after the invoice has been cancelled.

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

1. Inventory current invoice, `invoice_payments`, `credit_note`, `credit_note_line`, `inventory_transaction`, `ar_ledger`, customer-wallet, and receipt-number triggers/constraints.
2. Add a forward-only migration for the correction-case model and immutable document relationships. Do not edit `database/initial_schema.sql` without a matching migration.
3. Define finite case states such as `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `EXECUTING`, `COMPLETED`, `REJECTED`, and `FAILED`, including legal transitions.
4. Add idempotency/uniqueness so concurrent confirmation cannot create duplicate cases or replacement invoices.
5. Define financial-resolution evidence, especially whether a refund was paid out or never released.
6. Agree finance/tax policy for invoice correction, physical receipt numbers, closed periods, and approval levels before implementation.

## 7. Phase 2 — Atomic Service and API

1. Implement a dedicated `packages/api/services/salesCorrectionService.js`; do not expand `DELETE /invoices/:id` into a multi-purpose workflow.
2. Add clearly scoped endpoints such as `POST /sales-corrections/preview`, `POST /sales-corrections`, and `GET /sales-corrections/:id`, with dedicated permissions. Recompute preview server-side at confirmation.
3. Lock the original invoice and all relevant correction records in one transaction, then re-check every state condition.
4. Generate compensating inventory/ledger entries with stable case/document references. Every original economic effect receives at most one corresponding compensation for the selected case.
5. Use payment, wallet, cheque, and refund-payout services rather than raw status writes that bypass their accounting rules.
6. Create a replacement invoice only after correction validation; it must be linked to the case, receive new identity per policy, and never inherit payment/refund state.
7. Keep the simple void endpoint narrow. It can delegate only for an eligible cancel-only path, never for a refunded invoice without explicit resolution.

## 8. Phase 3 — Web, Tests, and Rollout

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

## 10. Files Touched So Far

Immediate integrity safeguards:

- `packages/api/routes/refundRoutes.js`
- `packages/api/routes/invoiceRoutes.js`
- `packages/api/tests/refunds.test.js`
- `packages/api/tests/invoiceVoidRefund.test.js`

Deferred proposal:

- `docs/plans/2026-09-28_sales-correction-and-restart.md`

## 11. Verification Commands

The immediate safeguard work was syntax-checked and `git diff --check` was clean. Focused Jest execution was not confirmed in the interrupted workspace because dependency installation was incomplete.

Before implementation, run:

```bash
npm run -w packages/api test -- --runInBand packages/api/tests/refunds.test.js packages/api/tests/invoiceVoidRefund.test.js
npm run -w packages/api lint
npm run -w packages/web lint
npm run -w packages/api migrate:verify -- --host localhost
graphify update .
```

## 12. Change Log

| Date | Session | Change |
|---|---|---|
| 2026-09-28 | Codex + product owner | Documented the deferred Correct & Restart Sales workflow. Confirmed receipt printing does not yet exist and is not a prerequisite; if added later, it is an audit/UX signal—not the sole financial gate. Retained existing refund/void safeguards until an atomic correction workflow is built. |
