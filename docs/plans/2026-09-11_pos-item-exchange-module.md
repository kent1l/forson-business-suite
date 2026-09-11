# Point-of-Sale Item Exchange ("Change Item") — PRD & Developer Handoff

> **Forson Business Suite** | **PRD-FBS-POS-002** | **Version:** 1.0  
> **Date:** 2026-09-11 | **Branch:** `master`  
> **Status:** Planning Complete — Ready for Implementation. All business scenarios, ledger effects, cash drawer rules, and physical receipt workflows clarified and agreed upon.  
> **Related PRDs / References:** [`2026-09-06_recompute_invoice_settlement.sql`](../../database/migrations/20260906_01_recompute_invoice_settlement.sql), [`arLedgerService.js`](../../packages/api/services/arLedgerService.js), [`refundRoutes.js`](../../packages/api/routes/refundRoutes.js).

---

## 0. Status at a Glance

Read this first. It is the only section that changes often — update it as phases land.

| Item | Status | Reference |
|---|---|---|
| Phase 1 — Backend Exchange API (`POST /api/invoices/exchange`) | **Done** | §6.1 |
| Phase 2 — POS & Sales History Exchange Modals (`ExchangeModal.jsx`) | **Done** | §6.2 |
| Phase 3 — Receipt Thermal Printing & SOA Rendering (`Receipt.jsx`, `soaPdf.js`) | **Done** | §6.3 |
| Phase 4 — Unit & Integration Test Suite (`exchange_db_test.js`) | **Done** | §6.4 |
| Accounting Rule: Never backdate past transactions; book today | **Decided** | §3.1, §4 |
| A/R Cashier Rule: Strictly zero cash payout on credit (On-Account) sales | **Decided** | §3.2, §4 |
| Discount Rule: Prorate original line discounts on returned items | **Decided** | §3.3, §4 |
| Inventory Rule: Item condition flag (Re-sellable vs Defective/Quarantine) | **Decided** | §3.4, §4 |
| Physical Receipt Rule: Surrender/stamp old slip, issue today's numbered slip with cross-ref | **Decided** | §3.5, §5.6 |

---

## 1. For a New Session or Agent Picking This Up

**Before starting:**

1. Run `graphify query "refund and credit note invoice settlement"` and `graphify explain "refundRoutes.js"` for a live view of the code structure. File references in this document can drift — trust a fresh graph query over old prose.
2. Call hindsight `recall` with a query such as `"ar_ledger invoice settlement recompute"`, tags `["forson-business-suite", "ar_ledger", "invoicing"]`. That holds the non-obvious rationale and trigger behavior.
3. Review `packages/api/routes/refundRoutes.js` and `database/migrations/20260906_01_recompute_invoice_settlement.sql` — the exchange engine reuses the exact discount prorating and trigger synchronization logic proven in those files.
4. Confirm the Status at a Glance table above is still accurate against `git log --oneline -20`.

**When you finish a phase or make a non-obvious decision:**

1. Update the Status at a Glance table and the relevant phase section.
2. Retain new architectural decisions/gotchas to hindsight, tagged `["forson-business-suite", "pos_exchange", "invoicing"]`.
3. Run `graphify update .` so the next query reflects your changes.

---

## 2. Business Objective & Operational Value

### The Problem
Currently, the system only supports a **pure refund workflow** (`POST /api/refunds`), which assumes money leaves the business and items return to stock. In retail and auto-parts counter sales, customers frequently return an item to **change / swap for a different part or size**.

Under the current setup, cashiers are forced to perform an awkward, error-prone 2-step workaround:
1. Navigate away from POS to **Sales History** $\rightarrow$ Open original invoice $\rightarrow$ Issue refund for Item A as "Cash Payout".
2. Navigate back to **POS** $\rightarrow$ Ring up replacement Item B as a new sale $\rightarrow$ Collect payment.

This causes critical operational breakdowns:
* **Till Discrepancies & Fictitious Cash Flows:** In an even swap (₱500 for ₱500), no cash moves. Faking a ₱500 payout and a ₱500 intake inflates sales/refund records and risks cash drawer drift.
* **Severe Credit/AR Risk:** If an On-Account (credit terms) customer returns an unpaid part, a cashier choosing "Cash Payout" accidentally hands real cash to a customer whose account was never paid in cash.
* **Store Credit Disconnect:** Selecting `Store Credit` in `RefundForm.jsx` currently writes a credit note but fails to credit `customer_wallet`, leaving the customer with no usable tender at the POS counter.
* **Counter Friction & Inventory Drift:** Because the multi-step process takes 2–3 minutes with a customer waiting at the counter, cashiers often bypass the system entirely ("just swap the boxes on the shelf"). This rapidly destroys stock accuracy.
* **Broken Physical Receipt Trail:** Issuing a disconnected new receipt burns numbered BIR booklet leaves for ₱0 revenue and leaves no cross-reference connecting the returned good to the replacement.

### The Solution
An atomic **Point-of-Sale Item Exchange ("Change Item")** module allowing the cashier to search an original invoice, pick items to return, select replacement items from the catalog, and settle only the **net difference** in a single screen and single database transaction.

---

## 3. Decisions Already Taken (do not relitigate)

1. **Book on CURRENT Date, Never Backdate.**  
   *Even if the original sale occurred 10 days ago*, the exchange (Credit Note, Replacement Invoice, Inventory movements, and Cash Drawer impacts) is booked with **today's timestamp**. Past sales journals, closed shifts, and daily Z-readings are sealed legal records and must never be altered retroactively.

2. **Strict Cash Drawer Isolation for On-Account Sales.**  
   For sales made on credit terms (`isCreditSale` / `on_account`), **cash must never be dispensed from the till** during a downgrade or even exchange. Any negative difference directly reduces the customer's outstanding A/R balance. Upgrades may either be charged to A/R or paid in cash at the counter.

3. **Prorated Net Paid Value (Never Gross Catalog Price).**  
   If Item A had an original sale price of ₱500 but was sold at a 10% discount (paid ₱450), the exchange credit is strictly **₱450.00**. Using the gross price would give the customer free store equity.

4. **Inventory Disposition & Condition Tracking.**  
   Returned parts are not blindly returned to sellable stock. The cashier tags the line as **Re-sellable** (restocked via `trans_type: 'Refund'`) or **Defective / Damaged** (routed to quarantine via `trans_type: 'Defective Return'`).

5. **Physical Receipt & BIR Stamping Protocol.**  
   The customer must surrender their copy of the original physical receipt (`physical_receipt_no`). Cashiers stamp it: `"EXCHANGED [Date] — Ref CN #[CN-XXX] & New SI #[YYY]"`. A new physical receipt/slip is issued with today's date referencing the original document numbers.

6. **Single Atomic Database Transaction.**  
   Credit Note generation, inventory restocking, replacement invoice creation, inventory deduction, and differential settlement must succeed or fail together inside a single PostgreSQL `BEGIN ... COMMIT` block.

---

## 4. Comprehensive Operational Scenarios Matrix

| # | Operational Scenario | Customer Type | System & Financial Handling | Cash Drawer Impact | A/R Balance & SOA Effect |
|---|---|---|---|:---:|:---:|
| **1** | **Even Exchange**<br>*(Item A ₱500 $\leftrightarrow$ Item B ₱500)* | **Cash / Walk-in** | CN ₱500 offsets New Invoice ₱500. Net ₱0.00. Exchange receipt printed. | **₱0.00** | N/A |
| | | **On Account** | CN ₱500 offsets New Invoice ₱500. Customer debt unchanged. | **₱0.00** | CN and New Invoice post on SOA; Net change = **₱0.00**. |
| **2** | **Upgrade (Pays Difference)**<br>*(Item A ₱500 $\rightarrow$ Item B ₱800)* | **Cash / Walk-in** | Cashier collects ₱300 cash/card. Receipt shows ₱300 paid. | **+₱300.00** | N/A |
| | | **On Account (Charge to A/R)** | ₱300 difference charged to account. New invoice has ₱300 balance due. | **₱0.00** | Running balance increases by **+₱300.00** on SOA. |
| | | **On Account (Pay at Counter)** | Customer pays ₱300 cash/GCash now at counter. | **+₱300.00** | Cash payment recorded; net change on SOA = **₱0.00**. |
| **3** | **Downgrade (Store Owes Diff)**<br>*(Item A ₱500 $\rightarrow$ Item B ₱350)* | **Cash / Walk-in (Payout)** | Cashier dispenses ₱150 cash from drawer. | **-₱150.00** | N/A |
| | | **Cash / Walk-in (Store Credit)** | ₱150 credited to customer wallet / store credit voucher. | **₱0.00** | N/A |
| | | **On Account (Unpaid Invoice)** | -₱150 net diff reduces balance of original invoice. | **₱0.00** | Balance decreases by **-₱150.00** on SOA. |
| | | **On Account (Paid Invoice)** | -₱150 net diff becomes unallocated credit on account. | **₱0.00** | Balance decreases by **-₱150.00** on SOA. |
| **4** | **Past-Date Transactions**<br>*(Sold Sep 01, returned Sep 11)* | **All** | **Never backdated.** Past books stay sealed. All transactions stamped with today's date. | Touches **today's** drawer | Posted chronologically on **today's** date. |
| **5** | **Partial Exchange on Multi-line Sale**<br>*(Invoice had 5 items, swap only 1)* | **All** | Only selected `invoice_line_id` is returned. Remaining lines remain active. | Proportional | Proportional |
| **6** | **Discounted Item Exchange**<br>*(Bought at 10% off: paid ₱450, tag ₱500)* | **All** | System credits **₱450.00** (actual net paid), preserving discount equity. | Exact to paid price | Exact to paid price |
| **7** | **Multi-Item Swaps**<br>*(e.g., 2 items returned for 1 replacement)* | **All** | Handled via array payloads (`returned_lines[]`, `replacement_lines[]`). | Evaluates overall net sum | Evaluates overall net sum |
| **8** | **Defective vs Re-sellable** | **All** | Cashier toggles line condition: <br>• *Re-sellable:* Restocked to active inventory.<br>• *Defective:* Sent to quarantine/damaged stock. | N/A | N/A |

---

## 5. Domain Architecture & Ledger/Tax Mechanics

```
                             [Customer at Counter]
                                       │
            ┌──────────────────────────┴──────────────────────────┐
            ▼                                                     ▼
 [Original Invoice Lookup]                             [Replacement Catalog Scan]
 - Select lines to return                              - Select new parts
 - Tag condition (Re-sellable / Defective)             - Current catalog pricing
            │                                                     │
            └──────────────────────────┬──────────────────────────┘
                                       ▼
                       [Net Settlement Calculation]
                   Gross Return Value:  -₱500.00
                   Replacement Value:   +₱700.00
                   -----------------------------
                   Net Differential:    +₱200.00
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        ▼                              ▼                              ▼
 [Net > 0: Upgrade]             [Net = 0: Even]              [Net < 0: Downgrade]
 • Cash/Card Tender             • No cash moved              • A/R Balance Reduction
 • Or Charge to A/R                                          • Or Wallet Store Credit
                                                             • Or Cash Drawer Payout
                                       │
                                       ▼
                  [POST /api/invoices/exchange (Atomic DB Tx)]
                  1. Validate quantities & discount snapshots
                  2. Create credit_note (Ref: Original Invoice)
                  3. Post inventory_transaction for returned items
                  4. Create replacement invoice (Ref: CN & Old Invoice)
                  5. Post inventory_transaction for replacement items
                  6. Apply CN credit as tender on replacement invoice
                  7. Settle net difference via invoice_payments / A/R
                  8. recompute_invoice_settlement() automatically updates
                  9. Print Unified Thermal Exchange Receipt
```

### 5.1 Ledger Mechanics & SOA Representation
Under `ar_ledger`, every financial movement is an immutable event:
* **Original Sale (Sep 01):** `INVOICE_POSTED` (+₱5,000.00)
* **Exchange Return (Sep 11):** `CREDIT_MEMO_APPLIED` (-₱500.00, Ref: `CN-0085`)
* **Exchange Replacement (Sep 11):** `INVOICE_POSTED` (+₱800.00, Ref: `INV-1090`)
* **Counter Cash Paid (Sep 11):** `PAYMENT_SETTLED` (-₱300.00, Ref: `OR-5021`)
* **Resulting Net Balance:** ₱5,000.00 (identical to starting debt, with an unbroken audit trail).

### 5.2 Tax & BIR Integrity
* The Credit Note reverses the exact tax frozen in `tax_rate_snapshot` on the original sale line.
* The replacement invoice applies current tax rates.
* Both are recognized in the current taxable month (under BIR EOPT rules, prior-period returns are accounted as current-period Sales Returns and Allowances).

---

## 6. Implementation Phases (Step-by-Step Specification)

### Phase 1 — Backend Exchange API (`packages/api`) — DONE 2026-09-11
- [x] Migration `database/migrations/20260911_01_pos_exchange_schema.sql`:
  - `credit_note_line.is_defective boolean` (Decision #4 disposition flag).
  - `credit_note.exchange_replacement_invoice_id` / `invoice.exchange_original_invoice_id` link columns (both nullable, `ON DELETE SET NULL`) so a CN and the invoice it helped pay for can find each other for Phase 3 receipt/SOA rendering.
  - Seeds an `exchange_credit` payment method (`type: 'credit'`, `settlement_type: 'instant'`) — the mechanism that lets the traded-in value settle the new invoice's own `amount_paid`, the same way `store_wallet` already does for a real credit balance.
- [x] Migration `database/migrations/20260911_02_exchange_credit_ledger_safety_net.sql` — **found live during smoke testing, not anticipated in the original PRD.** `update_invoice_balance_after_payment()` (20260906_01) posts a `PAYMENT_SETTLED` ar_ledger entry for *every* settled `invoice_payments` row unconditionally, including an `exchange_credit` tender. That value was already ledgered once via the credit note's `CREDIT_MEMO_APPLIED` entry against the *original* invoice — the safety net posting a second entry against the *replacement* invoice silently understated every on-account exchange's A/R impact by the full returned amount. Fixed by teaching the trigger to skip the ledger write for `exchange_credit` specifically (mirrors how it already special-cases `withholding_tax`). Confirmed via a live on-account upgrade test: ledger net movement was exactly the ₱1,000 upgrade differential, not ₱1,000 − 2×₱12,800.
- [x] Created `packages/api/services/exchangeService.js` (`processExchange(client, payload)`, throws `ExchangeError` for validation failures) and a thin `packages/api/routes/exchangeRoutes.js` (`POST /api/invoices/exchange`) that owns the transaction and maps `ExchangeError.statusCode` to the HTTP response. Split out during Phase 4 so `exchange_db_test.js` could call the logic directly inside its own rollback-only transaction, matching how every other `*_db_test.js` in this codebase tests things (`arAdjustmentService.createAdjustment`, `grnPostingService.postReceipt`) — a route that owns its own `BEGIN`/`COMMIT` can't be wrapped in an outer transaction and rolled back. The logic itself is unchanged from the original inline version:
  - Validates payload (`original_invoice_id`, `employee_id`, `returned_lines[]`, `replacement_lines[]`).
  - Checks available return quantity per line: `quantity - COALESCE(refunded_quantity, 0)` (reuses refundRoutes.js's query).
  - Prorated unit discount (`unitDiscount = original_discount / original_quantity`) and tax snapshot via `computeTaxForBase`, exactly as refundRoutes.js.
  - Generates `CN` and `INV` document numbers; inserts `credit_note` / `credit_note_line` (with `is_defective`) / `credit_note_tax_breakdown`, and `invoice` / `invoice_line` / `invoice_tax_breakdown` (reuses `calculateInvoiceTax`).
  - `inventory_transaction`: returned lines post `'Defective Return'` (quarantine) or `'Refund'` (restock) per line; replacement lines post `'StockOut'`.
  - Settlement: an `exchange_credit` tender for `min(returnCredit, replacementTotal)` always applies first (silently, no ar_ledger entry — see migration 02). An upgrade's remainder either charges to A/R (credit sale, no further tender) or must be fully covered by `payments[]` (cash/walk-in, reusing invoiceRoutes.js's tender loop incl. cheque/PDC and store_wallet-as-tender handling). A downgrade's leftover is absorbed into A/R automatically for credit sales (Decision #2 — no code path can dispense cash/wallet credit on an on-account sale), or requires `downgrade_disposition: 'wallet'` (`customerWalletService.appendWalletTransaction`) or `'cash_payout'` (recorded via `credit_note.refund_payment_method`, no DB tender — mirrors how refundRoutes.js already treats a Cash refund) for cash/walk-in.
  - Booked at `CURRENT_TIMESTAMP` always (Decision #1); >30-day original invoice returns a non-blocking `aging_warning` in the response (Phase 5 will make this a hard block per §7).
  - `recompute_invoice_settlement()` called for both the new and original invoice before commit.
- [x] Mounted in `packages/api/index.js` (`registerRoute('/api', './routes/exchangeRoutes')`).
- [x] Smoke-tested live against the dev DB (even exchange, on-account upgrade, walk-in downgrade-to-wallet with a defective-flagged return) and against `tests/refunds.test.js` + `tests/invoicePaymentSettle.test.js` (no regressions). Phase 4's `exchange_db_test.js` still needs writing to pin this in CI.

### Phase 2 — POS & Sales History UI (`packages/web`) — DONE 2026-09-11
- [x] Created `packages/web/src/components/pos/ExchangeModal.jsx`:
  - Invoice search (debounced `GET /invoices` with a wide `startDate`/`endDate` window, `status=active`, `q=<term>`; no new backend endpoint needed) when opened bare, or skips straight to the return-selection view when handed an `initialInvoice` prop.
  - Return selection table via `GET /invoices/:id/lines-with-refunds` (same data RefundForm.jsx already consumes) with a checkbox, a quantity stepper capped at `quantity - quantity_refunded`, and a per-line "Defective" checkbox (defaults unchecked = Re-sellable) that sets `is_defective` on the payload line.
  - Replacement item search via `GET /power-search/parts` (same endpoint POSPage.jsx's own search uses) through a second, independent `useTypeahead()` instance; picking a result adds an inline-editable row (qty, sale price) rather than opening a nested price/quantity modal, to avoid stacking modals-in-modals for what the PRD calls a "single screen" flow.
  - Live summary footer (Returned Value / Replacement Value / Net Difference) computed client-side: the return-side math (`computeReturnCreditPreview`) is a line-for-line copy of exchangeService.js's own prorated-discount + frozen-tax-rate arithmetic, and the replacement side reuses the existing `utils/taxPreview.js` helper (same one POSPage.jsx and InvoicingPage.jsx already trust for cart previews). Both are display aids only — the server always recomputes authoritatively on submit.
  - **Settlement design decision, worth flagging for whoever reads this next**: rather than building two separate UI paths for "upgrade settlement" and "downgrade disposition" as the PRD's scenario table might suggest, the modal exposes one unified control — a "Charge difference to customer's account" checkbox (hidden entirely for Walk-in, matching exchangeService.js's own `isWalkIn && isCreditSale` guard) that sets `payment_terms_days`/`terms`. This single toggle is what the backend actually keys `isCreditSale` off of (`canonicalDays > 0 || hasOnAccountPayment`), and it happens to correctly drive *both* directions: on for an upgrade routes `amountDue` to A/R instead of requiring a matching tender; on for a downgrade makes the backend auto-absorb `leftoverCredit` into A/R instead of demanding a `downgrade_disposition`. A "customer is paying now instead" checkbox layered on top (visible only when the account toggle is on) lets a cash tender still be attached on top of an on-account exchange, covering the PRD's "On Account (Pay at Counter)" sub-scenario without a third code path. Cash/Walk-in downgrades that leave the toggle off show the `wallet` vs `cash_payout` radio the backend requires in that case.
  - Payment tender is a **single line**, not a full split-payment array like `SplitPaymentModal.jsx`: every PRD scenario settles the net difference with one method, and the backend enforces the tendered amount equal the `amountDue` exactly for a non-credit exchange anyway, so a multi-line tender editor would add surface area (concessions, on-account confirmation dialogs, withholding preview) with no scenario that needs it. If a future requirement needs split tenders on an exchange, lift the payment-line block out into a shared component with `SplitPaymentModal.jsx` rather than duplicating its full state machine here.
  - The `aging_warning` the backend returns is informational-only and only known *after* a successful submit; the 30-day banner shown *before* submit is computed client-side from `selectedInvoice.invoice_date` so the cashier sees it before committing, exactly matching the PRD's "non-blocking banner" wording.
  - Physical receipt number field reuses `formatPhysicalReceiptNumber` (live-formats on blur, same as `InvoiceDetailsModal.jsx`'s receipt-no editor).
  - Gates itself on `hasPermission('invoicing:create')` (same permission the route requires) and renders a plain "no permission" message instead of the form when absent.
  - Added `ICONS.refresh` (already existed, unused) as the POS button's icon instead of adding a new SVG path — it already reads as a swap/exchange glyph.
- [x] Modified `packages/web/src/pages/POSPage.jsx`:
  - Added an "Exchange Item" cell at `ButtonsGrid` grid index 1 (top row, second cell), opening `ExchangeModal` with no `initialInvoice` (cashier searches).
- [x] Modified `packages/web/src/components/refunds/InvoiceDetailsModal.jsx`:
  - Added an "Exchange Items" button in the footer next to "Process Refund" (gated on `hasPermission('invoicing:create')` and `invoice.status !== 'Cancelled'`), opening `ExchangeModal` with `initialInvoice={invoice}` so it skips straight to return selection. Passed `zIndexClass="z-50"` since this nests one `Modal` inside another already-open one — see `Modal.jsx`'s own docstring on why DOM order alone isn't reliable here.
- [x] Verified with `npm run -w packages/web lint` (0 errors — pre-existing false-positive `no-unused-vars` warnings on components that *are* used in JSX, e.g. `Modal`/`Icon`/`InfoTip`/`MathExpressionInput`, already litter this codebase by the hundreds; `RefundForm.jsx` has the identical warning today) and `vite build`'s transform stage (all 3145 modules compiled with zero errors; the build only failed at the final dist-directory cleanup step because `packages/web/dist/` is owned by `root` from a prior container-run build — an environment issue that predates this change, not a code regression).
- [ ] **Not done**: a live click-through in the browser. The dev stack (`forson_frontend_dev`/`forson_backend_dev`/`forson_db`) was up and reachable, but driving it needs a logged-in session, and minting a JWT to bypass the login screen for that purpose was blocked by the coding agent's own permission classifier as an auth-bypass action. The user chose to skip browser verification for this phase rather than share credentials or test it themselves. **Whoever picks this up next should manually click through the flow once** before trusting it fully: search an invoice, return a line, add a replacement, submit an even/upgrade/downgrade exchange of each customer type (Walk-in, Cash, On-Account), and confirm the invoice/credit note that comes out the other end via Sales History matches the PRD's §4 scenarios matrix.

### Phase 3 — Receipt Thermal Printing & SOA Rendering — DONE 2026-09-11
- [x] Updated `packages/web/src/components/ui/Receipt.jsx`:
  - Detects an exchange via `saleData.exchange_data` (truthy only when the caller built it, i.e. only `ExchangeModal.jsx`'s own success path constructs one — a plain POS/split-payment sale's `saleData` never has this key).
  - Header shows `*** ITEM EXCHANGE RECEIPT ***`, plus `Original Invoice #:`, `Original Receipt #:` (only when the original had one), and `Credit Note #:` right below the replacement invoice's own number.
  - Section 1 `ITEMS RETURNED` renders `exchange_data.returned_lines` with negative line totals and a `(Defective/Damaged)` suffix on any line flagged so (Decision #4); Section 2 `ITEMS ISSUED (REPLACEMENT)` reuses the existing `lines` table/rendering path unchanged (same shape a normal sale already passes: `part_id`, `display_name`, `quantity`, `sale_price`).
  - The existing subtotal/tax/total block is reused as-is for the replacement invoice's own figures (relabelled `REPLACEMENT TOTAL:` instead of `TOTAL:` when exchanging), then a `NET SETTLEMENT` block appends: Returned Value (negative), the net differential with an (Upgrade)/(Downgrade)/Even label, each tender line actually collected, "Charged to Account" when `is_credit_sale` left a balance due, and however a downgrade's leftover credit was returned (Applied to Account Balance / Store Credit Issued / Cash Refunded) — mirrors the PRD §4 scenarios matrix labels exactly so the printed slip and the matrix use the same words.
  - Deliberately does **not** add a `tax_breakdown` per-rate line for the exchange path — the exchange API response only returns aggregate `subtotal_ex_tax`/`tax_total`, not a per-rate array, and the existing component already falls back to a single "Tax:" line when no breakdown is supplied (originally there for old sales with no stored breakdown), so no new branch was needed.
- [x] `packages/web/src/components/pos/ExchangeModal.jsx` builds the `exchange_data` receipt payload from its own already-known state (`selectedInvoice`, `selectedReturnLines`, `validReplacementLines`, the tender line, `downgradeDisposition`) plus the server's authoritative response (`credit_note.cn_number`/`total_amount`, `invoice.*`, `net_differential`, `amount_due`, `leftover_credit`, `is_credit_sale`) and offers it via a "Print Receipt" toast button on success — the exact same `window.open('/print.html', ...)` + `ReactDOM.createRoot(...).render(<Receipt .../>)` pattern `POSPage.jsx`'s own `handlePrintReceipt` already uses, duplicated locally rather than lifted into a shared helper since `ExchangeModal.jsx` is mounted from two different parent pages (`POSPage.jsx` and `InvoiceDetailsModal.jsx`) with no natural shared ancestor to hold it.
- [x] Verified `packages/api/helpers/pdf/soaPdf.js` and its two callers in `packages/api/routes/arRoutes.js` (`GET /ar/customers/:customerId/ledger` — the on-screen `ARLedgerSoaTab.jsx` feed — and `GET /ar/customers/:customerId/soa/pdf` — the actual PDF). Both had already-generic `CREDIT_MEMO_APPLIED` → `'Credit Note Applied'` labeling via a static `TYPE_LABELS` map with no way to tell an exchange-sourced credit note from an ordinary refund's, beyond it happening to be mentioned in the free-text `notes` column. Fixed by joining `credit_note.exchange_replacement_invoice_id` (added in Phase 1's `20260911_01_pos_exchange_schema.sql`) to the replacement `invoice.invoice_number` in both queries, and overriding `type_label` to `'Credit Note Applied (Exchange)'` plus a new `linked_invoice_number` field whenever that column is non-null; `soaPdf.js`'s row template now appends an `Exchanged for: <invoice_number>` line whenever `linked_invoice_number` is present. `ARLedgerSoaTab.jsx` needed no change — it already renders `row.type_label` generically, so the new label shows up there automatically.
- [x] Verified via live DB queries (not full HTTP calls — see note in §1 below on why): the module loads without syntax errors, the new `LEFT JOIN invoice exch_inv ON exch_inv.invoice_id = cn.exchange_replacement_invoice_id` resolves correctly against real Phase 1/2 smoke-test data (e.g. `cn_id 267` → `CN-202609-0005` → `exchange_replacement_invoice_id 100239` → `INV-202609-0020`), and re-ran `exchange_db_test.js` (all 7 cases still pass) to confirm the `arRoutes.js` edits caused no regression in the exchange transaction itself.
- [ ] **Not done**: rendering an actual PDF end-to-end or a live click-through of "Print Receipt" in a browser, for the same reason Phase 2 skipped browser verification (see §1 below) — driving either needs a logged-in session, and minting one to bypass login was refused by the coding agent's permission classifier as an auth-bypass action, so the user chose to skip it. Whoever picks this up next should generate one real SOA PDF for a customer with an exchange-sourced credit note (e.g. customer_id 1 in the dev DB already has three: CN-202609-0003, -0005, -0006) and click "Print Receipt" after one real exchange in POS, to confirm both render as designed before trusting this fully.

### Phase 4 — Unit & Integration Test Suite — DONE 2026-09-11
- [x] Created `packages/api/tests/exchange_db_test.js` (run with `node tests/exchange_db_test.js` against a live DB — excluded from the normal jest run, matching the `*_db_test.js` convention of `arAdjustment_db_test.js` / `goodsReceiptPosting_db_test.js`). Calls `exchangeService.processExchange()` directly inside a transaction that is rolled back at the end, so it leaves no trace. All 7 cases pass:
  - Test Case 1: Even exchange (₱500 ↔ ₱500) — stock updates correctly, new invoice fully settled by the exchange_credit tender alone, zero ar_ledger footprint on the new invoice.
  - Test Case 2: Upgrade with ₱300 cash paid — new invoice `Paid`, cash tender ledgers normally (`PAYMENT_SETTLED -300`).
  - Test Case 3: Upgrade charged to an on-account customer — **regression test for the ledger safety-net double-count bug** (20260911_02): asserts the customer's `ar_ledger` balance moves by exactly the +300 differential, not by +300 minus a phantom extra -500/+800.
  - Test Case 4: Downgrade on an on-account customer — A/R strictly decreases by the downgrade amount, zero cash tenders, no wallet credit ever created (PRD Decision #2).
  - Test Case 5: Discounted item (2 units, ₱200 line discount, return 1) — credits the prorated ₱400, not the gross ₱500.
  - Test Case 6: Returning more than purchased throws `ExchangeError` (`statusCode: 400`).
  - Test Case 7: `is_defective: true` posts `inventory_transaction.trans_type = 'Defective Return'` and sets `credit_note_line.is_defective`.
  - One pre-existing-behavior note surfaced by Case 1: a non-credit exchange still moves the customer's `ar_ledger` balance by the credit note's full amount, because `CREDIT_MEMO_APPLIED` posts unconditionally regardless of customer type (same as `refundRoutes.js` already does) while a plain cash sale never posts an offsetting `INVOICE_POSTED` entry. Asserted as current behavior rather than "fixed," since it predates this module and affects the refund feature equally — out of scope here.

---

## 7. Explicitly Deferred Items

- **Manager PIN Override for Policy Expiry:** Automatic rejection of exchanges older than 30 days without manager override is deferred to Phase 5. In Phase 1–4, a warning banner will display if `invoice_date > 30 days`, but will not hard-block.
- **Direct Serial Number Swap:** Barcode serial tracking for individual electronic items is out of scope (handled at part level).

---

## 8. Files to Create / Modify

| # | File Path | Action | Description |
|---|---|---|---|
| 1 | `packages/api/services/exchangeService.js` | CREATE | Core atomic exchange business logic (`processExchange(client, payload)`); takes an open transaction client and never calls BEGIN/COMMIT itself, so `exchange_db_test.js` can wrap it in a rollback-only transaction — matching `arAdjustmentService.js` / `grnPostingService.js` |
| 2 | `packages/api/routes/exchangeRoutes.js` | CREATE | Thin HTTP wrapper: owns the transaction lifecycle and maps `ExchangeError` → status code |
| 3 | `database/migrations/20260911_01_pos_exchange_schema.sql` | CREATE | `credit_note_line.is_defective`, exchange link columns on `credit_note`/`invoice`, seeds the `exchange_credit` payment method |
| 4 | `database/migrations/20260911_02_exchange_credit_ledger_safety_net.sql` | CREATE | Fixes a ledger double-count bug found during Phase 1 smoke testing (see Phase 1 notes above) |
| 5 | `packages/api/index.js` | MODIFY | Route registration |
| 6 | `packages/api/tests/exchange_db_test.js` | CREATE | PostgreSQL integration test suite (7 cases, §6.4) |
| 7 | `packages/web/src/components/pos/ExchangeModal.jsx` | CREATE | Interactive exchange modal |
| 8 | `packages/web/src/pages/POSPage.jsx` | MODIFY | POS grid button and handler |
| 9 | `packages/web/src/components/refunds/InvoiceDetailsModal.jsx` | MODIFY | Launch exchange from Sales History |
| 10 | `packages/web/src/components/ui/Receipt.jsx` | MODIFY | Thermal exchange slip template |
| 11 | `packages/api/routes/arRoutes.js` | MODIFY | Joins `credit_note.exchange_replacement_invoice_id` into both SOA ledger queries; labels exchange-sourced `CREDIT_MEMO_APPLIED` rows `'Credit Note Applied (Exchange)'` with a `linked_invoice_number` |
| 12 | `packages/api/helpers/pdf/soaPdf.js` | MODIFY | Renders `Exchanged for: <invoice_number>` under a CN row when `linked_invoice_number` is present |

---

## 9. Verification Commands

```bash
# 1. Run the exchange integration test against a live DB (excluded from the normal
#    jest run, like every other *_db_test.js — run directly with node, inside the
#    backend container against the dev DB):
docker exec forson_backend_dev sh -lc 'node tests/exchange_db_test.js'

# 2. Run existing refund and invoice test suites to ensure zero regressions
npm run -w packages/api test -- tests/refunds.test.js
npm run -w packages/api test -- tests/invoicePaymentSettle.test.js

# 3. Verify web linting and build
npm run -w packages/web lint
npm run -w packages/web build

# 4. Verify A/R ledger trigger consistency
npm run -w packages/api migrate:status -- --host localhost
```

---

## 10. Change Log

| Date | Author / Session | Changes |
|---|---|---|
| 2026-09-11 | Antigravity AI & Lead Dev | Initial PRD and architectural handoff completed covering all business, ledger, cash drawer, and receipt scenarios. |
