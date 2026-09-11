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
| Phase 1 — Backend Exchange API (`POST /api/invoices/exchange`) | **Not started** | §6.1 |
| Phase 2 — POS & Sales History Exchange Modals (`ExchangeModal.jsx`) | **Not started** | §6.2 |
| Phase 3 — Receipt Thermal Printing & SOA Rendering (`Receipt.jsx`, `soaPdf.js`) | **Not started** | §6.3 |
| Phase 4 — Unit & Integration Test Suite (`exchange_db_test.js`) | **Not started** | §6.4 |
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

### Phase 1 — Backend Exchange API (`packages/api`)
- [ ] Create `packages/api/routes/exchangeRoutes.js`:
  - Validate payload (`original_invoice_id`, `returned_lines[]`, `replacement_lines[]`, `differential_settlement`).
  - Check available refundable quantity per line: `quantity - COALESCE(refunded_quantity, 0)`.
  - Calculate prorated unit discount: `unitDiscount = original_discount / original_quantity`.
  - Calculate tax snapshot for credit note lines using `computeTaxForBase`.
  - Generate next `CN` document number via `getNextDocumentNumber(client, 'CN')`.
  - Insert into `credit_note`, `credit_note_line`, and `credit_note_tax_breakdown`.
  - Insert `inventory_transaction` for each returned line:
    - If `is_defective === true`: `trans_type: 'Defective Return'`.
    - Else: `trans_type: 'Refund'`.
  - Generate next `INV` document number via `getNextDocumentNumber(client, 'INV')`.
  - Calculate taxes for replacement lines using `calculateInvoiceTax`.
  - Insert into `invoice`, `invoice_line`, and `invoice_tax_breakdown`.
  - Settlement processing:
    - Apply CN credit amount to new invoice.
    - If upgrade (+diff): record `invoice_payments` row for cash/card/GCash, or flag `settlement_type = 'on_account'`.
    - If downgrade (-diff): credit `customer_wallet` via `appendWalletTransaction`, or dispense cash, or let A/R absorb.
  - Rely on `recompute_invoice_settlement` trigger to update invoice balances.
- [ ] Mount route in `packages/api/index.js` at `/api/invoices`.

### Phase 2 — POS & Sales History UI (`packages/web`)
- [ ] Create `packages/web/src/components/pos/ExchangeModal.jsx`:
  - Invoice search input with typeahead / invoice picker.
  - Return selection table showing original lines, sold qty, already returned qty, unit price, and discount.
  - Checkbox to select lines, quantity stepper, and "Defective" toggle.
  - Replacement item search using `useTypeahead` for parts catalog.
  - Replacement item table with qty and price adjustments.
  - Real-time summary footer: Total Returned Value, Total Replacement Value, Net Difference.
  - Dynamic payment section:
    - If Cash/Digital customer: Cash, GCash, Card tender inputs.
    - If On-Account customer: "Charge Difference to Account" toggle (disabled for downgrades).
- [ ] Modify `packages/web/src/pages/POSPage.jsx`:
  - Add "Exchange Item" action button on `ButtonsGrid` (e.g. grid cell index 1 or 2).
  - Wire state to open `ExchangeModal`.
- [ ] Modify `packages/web/src/components/refunds/InvoiceDetailsModal.jsx`:
  - Add "Exchange Items" button in modal footer alongside "Process Refund".
  - Pre-populates `ExchangeModal` with the current invoice.

### Phase 3 — Receipt Thermal Printing & SOA Rendering
- [ ] Update `packages/web/src/components/ui/Receipt.jsx`:
  - Add condition to detect exchange transactions (presence of `exchange_data` or negative return lines).
  - Format receipt header: `*** ITEM EXCHANGE RECEIPT ***`.
  - Display reference: `Original Invoice #: INV-...` and `Original Receipt #: SI-...`.
  - Section 1: `ITEMS RETURNED` with negative totals.
  - Section 2: `ITEMS ISSUED (REPLACEMENT)` with positive totals.
  - Section 3: `NET SETTLEMENT` showing tender breakdown.
- [ ] Verify `packages/api/helpers/pdf/soaPdf.js`:
  - Ensure `CN-` rows render with `type_label: 'Credit Note Applied (Exchange)'` and link to primary invoice ref.

### Phase 4 — Unit & Integration Test Suite
- [ ] Create `packages/api/tests/exchange_db_test.js`:
  - Test Case 1: Even exchange (₱500 $\leftrightarrow$ ₱500) updates stock correctly and results in ₱0 cash effect.
  - Test Case 2: Upgrade with cash difference paid (+₱300) records payment and drawer intake.
  - Test Case 3: Upgrade charged to On-Account customer increases A/R debt.
  - Test Case 4: Downgrade on On-Account customer strictly decreases A/R debt with zero cash paid.
  - Test Case 5: Discounted item prorates return credit correctly.
  - Test Case 6: Attempting to return more than purchased quantity throws 400 error.
  - Test Case 7: Defective toggle flags inventory transaction as 'Defective Return'.

---

## 7. Explicitly Deferred Items

- **Manager PIN Override for Policy Expiry:** Automatic rejection of exchanges older than 30 days without manager override is deferred to Phase 5. In Phase 1–4, a warning banner will display if `invoice_date > 30 days`, but will not hard-block.
- **Direct Serial Number Swap:** Barcode serial tracking for individual electronic items is out of scope (handled at part level).

---

## 8. Files to Create / Modify

| # | File Path | Action | Description |
|---|---|---|---|
| 1 | `packages/api/routes/exchangeRoutes.js` | CREATE | Core atomic exchange controller |
| 2 | `packages/api/index.js` | MODIFY | Route registration |
| 3 | `packages/web/src/components/pos/ExchangeModal.jsx` | CREATE | Interactive exchange modal |
| 4 | `packages/web/src/pages/POSPage.jsx` | MODIFY | POS grid button and handler |
| 5 | `packages/web/src/components/refunds/InvoiceDetailsModal.jsx` | MODIFY | Launch exchange from Sales History |
| 6 | `packages/web/src/components/ui/Receipt.jsx` | MODIFY | Thermal exchange slip template |
| 7 | `packages/api/tests/exchange_db_test.js` | CREATE | Comprehensive PostgreSQL test suite |

---

## 9. Verification Commands

```bash
# 1. Run API unit & integration tests
npm run -w packages/api test -- packages/api/tests/exchange_db_test.js

# 2. Run existing refund and invoice test suites to ensure zero regressions
npm run -w packages/api test -- packages/api/tests/refunds.test.js
npm run -w packages/api test -- packages/api/tests/invoicing.test.js

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
