---
module: Accounts Receivable & Customers
page_component: AccountsReceivablePage.jsx, CustomersPage.jsx, PaperlessReceiptsPage.jsx
audience: Accounting, Cashier, Manager
verified_against: master branch, commit 5d772b8 (docs/comprehensive-project-documentation-and-manual)
last_updated: 2026-08-17
---

# Accounts Receivable & Customers

<!--
  Follow docs/manuals/STANDARDS.md. Keep every heading below, in this order, for every
  module manual. If a section doesn't apply, keep the heading and write "N/A" under it —
  do not delete headings.

  Callout convention (use sparingly, only where it earns its place):
    > 💡 Tip — a shortcut or best practice
    > 📝 Note — a clarifying aside
    > ⚠️ Important — real trouble if missed (e.g. anything hitting the ledger)
-->

> **At a Glance**
> - **What it's for:** Track what every customer owes, record payments against their invoices, keep customer contact records up to date, and pull paper receipt images together for filing.
> - **Who uses it:** Accounting staff and managers (Accounts Receivable), cashiers and front-desk staff (Customers).
> - **You'll mostly come here to:** Receive a customer payment against outstanding invoices, and look up a customer's balance or statement of account.

## Overview

Accounts Receivable (AR) is where the business tracks money customers owe for goods or services already delivered — most commonly invoices billed "On Account" instead of paid in full at the register. This module has three jobs: show you who owes what and how overdue it is, let you record a payment and apply it to the right invoices, and produce a Statement of Account you can hand to a customer. The Customers page is the address book behind it — every invoice, payment, and wallet balance is tied to a customer record here. Paperless Receipts is a separate but related tool for pulling scanned physical receipts (thermal or paper) together into a printable page for filing.

## Key Concepts

- **On Account:** A sale where the customer takes the goods now and pays later, instead of paying in full at checkout. It creates an invoice with an outstanding balance and starts the aging clock from the invoice's due date. Only registered customers can be sold to On Account — this is blocked for Walk-In customers.
- **Settlement type:** Every payment method (Cash, GCash, Cheque, Bank Transfer, etc.) is configured with a settlement type that controls how fast it counts as real money:
  - **Instant** (e.g. Cash, GCash, most cards) — the invoice balance drops the moment you record the payment.
  - **Delayed** (e.g. Cheque, Bank Transfer) — the payment is recorded but sits as **pending**; the invoice balance does not move until someone marks it settled after the bank clears it. Until then the customer still technically owes the money, and it does not count toward "Amount Collected" in Sales reports.
  - **On Account** — no payment is taken; the full amount is added to the customer's AR balance instead.
- **Balance Due:** What's still owed on one invoice — see Key Calculations below.
- **Ledger balance / Total Receivables:** The authoritative, module-wide total of what a customer (or the whole business) is owed, drawn from the AR ledger rather than any single invoice.
- **Store Wallet / Store Credit:** A customer's standing credit balance, separate from any one invoice. It grows when a payment overpays its allocated invoices (the excess is auto-deposited) and can be drawn down against future invoices or adjusted manually.
- **Aging bucket:** How overdue an invoice's balance is, grouped into Current, 1–30 Days, 31–60 Days, 61–90 Days, and 90+ Days — see Key Calculations below.
- **Credit Hold:** A flag on a customer account that surfaces as a red "CREDIT HOLD" badge wherever that customer appears in AR. It is not set from the Customers page edit form in this version — treat any customer already on Credit Hold as a judgment call for your supervisor before extending more credit.
- **Physical Receipt #:** The number printed on the paper/thermal receipt handed to the customer at the time of payment, recorded alongside the electronic payment so the two can be matched later (see Paperless Receipts).

### Key Calculations

**Balance Due = Total Amount − Amount Paid**
Example: Invoice `INV-2026-004521` for ₱15,000.00 has ₱6,000.00 already paid. Balance Due = ₱15,000.00 − ₱6,000.00 = **₱9,000.00**.

**Aging bucket = how far past the due date the invoice's remaining balance is** (invoices with no balance left drop out of aging entirely):
- **Current** — due date is today or later
- **1–30 Days** — due date was 1 to 30 days ago
- **31–60 Days** — due date was 31 to 60 days ago
- **61–90 Days** — due date was 61 to 90 days ago
- **90+ Days** — due date was more than 90 days ago

Example: today is August 17, 2026. An invoice due July 10, 2026 (38 days ago) with ₱4,200.00 still owed falls in the **31–60 Days** bucket, and its ₱4,200.00 balance is added to that bucket's total on the aging chart.

**Total Receivables (KPI card) = sum of every customer's positive ledger balance across the whole business.** It is not simply "sum of unpaid invoices" — it's pulled from the authoritative AR ledger, which is why it can differ slightly from adding up the Customer Ledger table by hand if a manual ledger adjustment was posted.

**Store Wallet Deposit (on overpayment) = Total Received − Allocated to Invoices**, whenever that's a positive number.
Example: you receive ₱10,000.00 in cash but the customer's outstanding invoices only add up to ₱8,500.00. Allocate ₱8,500.00 to invoices; the remaining ₱10,000.00 − ₱8,500.00 = **₱1,500.00** is automatically deposited into the customer's Store Wallet.

**Net Exposure (Wallet tab) = Outstanding Receivables − Store Wallet Balance.**
Example: a customer owes ₱7,000.00 in receivables and holds ₱2,000.00 of store credit. Net Exposure = ₱7,000.00 − ₱2,000.00 = **₱5,000.00** — the actual amount still at risk after their credit is applied.

## How To — View Customer Balances & Aging

*Why this matters:* This is your daily starting point — it tells you at a glance who owes money, how much, and how overdue it is, before you decide who to call or who to hold shipments for.

*Precision:* This is read-only reporting; there's nothing here that can go wrong. Browse freely.

1. Open **Accounts Receivable** and stay on the **Overview & Aging** tab (it's selected by default).
2. Check the four KPI cards at the top: **Total Receivables**, **Invoices Sent**, **Overdue Invoices**, and **Avg. Collection Period**.
3. Use the **Statement / Date Range** bar to change the window these figures cover — set **From**/**To** manually, pick a shortcut (**Today**, **Yesterday**, **Last 7 Days**, **Last 30 Days**, **This Month**, **Last Month**), or click **All Time**.
4. Click any bar on the aging chart (e.g. **31-60 Days**) to drill into the exact invoices that make it up — you can click **Receive Payment** on any invoice from that list.
5. In the **Customer Accounts Receivable** table below, use the search box, the status filter (**All Statuses**, **Current / Good Standing**, **Overdue Receivables**, **Credit Hold Only**), or column sorting to narrow the list. Click **Export CSV** to download it.
6. Click a customer's row to open **Payable Invoices for &lt;name&gt;** — a full list of their open invoices, each with a status badge (e.g. "12 days overdue," "Due today," "5 days remaining"). Click an invoice row to see its line items.

**Example:** You filter the Customer Accounts Receivable table to **Overdue Receivables**, spot that ABC Hardware Supply owes ₱23,400.00 across 3 invoices with the earliest due date 15 days ago, and click their row to see the individual invoice numbers before calling them.

## How To — Record a Customer Payment

*Why this matters:* This is how a customer's balance actually goes down — it posts directly to the AR ledger, updates each invoice's paid amount and status, and (if the customer overpays) deposits the excess to their Store Wallet.

*Precision:* Follow these steps exactly. This action posts to the ledger — the payment method, amount, and invoice allocations you enter here become the permanent record of what was collected and where it went.

1. From the **Overview & Aging** tab, click **Receive Payment** next to a customer in the Customer Accounts Receivable table (or from the aging drill-down, or from their **Payable Invoices** list) — you need the **ar:receive_payment** permission to see this button.
2. In the **Receive Payment from &lt;name&gt;** window, enter the **Physical Receipt #** for the paper receipt you're handing the customer (e.g. `OR-88491`).
3. Under **Payment Breakdown**, fill in the first payment line: choose a **Payment Method** from the dropdown (only methods enabled in Settings appear here), enter the **Amount**, and fill the reference field if the method requires one — its label changes per method (e.g. "Cheque #," "Transaction ID"). If the method is a cheque, also set the **Date on Cheque (Maturity)**.
   > ⚠️ **Important:** A cheque or bank transfer payment is recorded as *pending* until someone later marks it settled — the customer's balance does not move yet for that portion. Cash and GCash post immediately.
4. If the customer is paying with more than one instrument (e.g. part cash, part cheque), click **+ Add Line** to add another split and repeat. Click **Remove Line** to delete an extra one.
5. Under **Invoice Allocations**, apply the received amount to specific invoices. The form auto-fills allocations for you as soon as you enter an amount, applying to invoices in the order listed until the amount runs out — click **Auto-fill** to redo this, **Clear** to start over, or type into any invoice's **Applied Amount** field to override it by hand.
6. If the total received is more than what you allocated, the **Store Wallet Deposit** card turns amber and an **Overpayment Detected** banner explains the excess will be deposited to the customer's Store Wallet automatically on save. If you've allocated *more* than was received, a red warning tells you to fix the split or the allocations before you can save.
7. Add any **Receipt Notes** if needed, then click **Process & Save Payment** (or press **Ctrl+S**). Click **Cancel** (or press **Esc**) to back out — you'll be asked to confirm if you've entered anything.

**Example:** Maria Santos owes ₱9,000.00 on `INV-2026-004521`. She pays ₱10,000.00 in cash. You select **Cash** as the method, enter ₱10,000.00, and the form auto-fills ₱9,000.00 against the invoice. The Store Wallet Deposit card shows ₱1,000.00 with an overpayment banner. You click **Process & Save Payment** — the invoice is now Paid, and Maria's Store Wallet balance increases by ₱1,000.00.

> 💡 **Tip:** If a payment method requires a store wallet balance (drawing down existing store credit as the "payment"), the form blocks you from entering more than the customer currently has available.

## How To — Create or Edit a Customer

*Why this matters:* Every invoice, payment, and wallet balance is tied to a customer record — this is where you add a new one or fix out-of-date contact details.

*Precision:* This is a normal default action — use your judgment on what to fill in beyond the required First Name.

1. Open **Customers** from the sidebar. Use the **Active** / **Inactive** / **All** tabs to filter the list.
2. Click **Add Customer** (requires the **customers:edit** permission) to open a blank form, or click the pencil icon on an existing row to edit one.
3. Fill in **First Name** (required), **Last Name**, **Company Name**, **Phone**, **Email**, **Address**, and any **Tags** you want to attach for searching/filtering later. Toggle **Active** off to retire a customer without deleting their history.
4. Click **Save Customer** (or press **Ctrl+S**). Click **Cancel** (or **Esc**) to discard — you'll be asked to confirm if you've made changes.
5. To remove a customer entirely, click the trash icon on their row and confirm **Delete** in the prompt.

**Example:** A new walk-in customer, Juan Dela Cruz, asks to be set up for On Account purchases. Click **Add Customer**, enter First Name "Juan," Last Name "Dela Cruz," Phone "0917-555-0123," leave Company Name blank, and click **Save Customer**.

## How To — View a Customer Ledger & Print a Statement of Account (SOA)

*Why this matters:* When a customer disputes a balance or asks for a formal statement, this tab shows the full running history behind their current balance and lets you export it as a PDF.

*Precision:* This is read-only reporting and export — safe to explore freely.

1. Open **Accounts Receivable** → **Customer Ledger & SOA** tab.
2. Type into **Search Customer** and pick the account from the dropdown.
3. Review the ledger table: **Txn Date**, **Due Date**, **Ref / Doc #**, **Description**, **Charges (Dr)**, **Credits (Cr)**, and a **Running Balance** for every line, starting from an **OPENING BALANCE BROUGHT FORWARD** row. The **Net Account Balance** in the top-right corner is the customer's current total.
4. If the customer has cheques recorded but not yet cleared by the bank, a **Floating Collections / Uncleared Cheques** panel appears below the ledger listing each one's cheque date, reference, bank, clearance status, and amount.
5. Toggle **Attach images** on if you want scanned receipt images included, then click **Export Statement of Account (PDF)** to download it.
6. If you have the **transaction:change_date** permission, a small pencil icon appears next to dates on eligible rows (invoices, payments, credit notes) — click it to correct a transaction's date.

**Example:** A customer calls disputing their balance. You search for them in **Customer Ledger & SOA**, see their Net Account Balance is ₱12,750.00, and walk them through the ledger line by line — an invoice for ₱18,000.00 on one date, a ₱5,250.00 payment credited two weeks later, landing on the current running balance. You click **Export Statement of Account (PDF)** to email them a copy.

## How To — Manage a Customer's Wallet / Store Credit

*Why this matters:* Store Wallet balances build up from overpayments (see the payment-recording task above) and can be drawn down against future invoices. This tab is where you review that balance history or make a manual correction.

*Precision:* Manual balance adjustments post to the wallet ledger — enter the exact amount and a clear reason. Everything else here is read-only browsing.

1. Open **Accounts Receivable** → **Customer Wallet Management** tab.
2. Search for a customer, or scan the table for **Store Wallet Balance**, **Outstanding Receivables**, and **Net Exposure** per account.
3. Click **View / Adjust Wallet** on a customer's row to open **Store Wallet & Credit Ledger**, showing their **Available Store Credit Balance** and a **Transaction Audit Trail** of every credit/drawdown with date, type, amount, and balance after.
4. To correct a balance manually, click **Adjust Balance**, enter the **Adjustment Amount (₱)** (positive to add credit, negative to remove it) and a **Reason / Reference Notes**, then click **Confirm Adjustment**.

**Example:** A customer's Store Wallet shows ₱1,500.00 in unused credit from a prior overpayment. They ask for it back in cash instead. You open **View / Adjust Wallet**, click **Adjust Balance**, enter **-1500.00** with the reason "Refunded to customer in cash per manager approval," and click **Confirm Adjustment**.

## How To — Consolidate Paperless Receipts

*Why this matters:* Thermal and paper receipts fade and pile up. This tool pulls scanned copies already stored in Paperless-ngx and lays four of them per printable A4 sheet so they can be filed compactly.

*Precision:* This only generates a printable PDF — it doesn't touch any ledger or customer balance. Safe to experiment with.

1. Open **Paperless Receipts Consolidation**. Check the connection badge in the top-right — it should read **Connected (&lt;latency&gt;ms)**; click **Check Connection** to retest if it doesn't.
2. Narrow the list with the **All Tags** dropdown and/or the search box (e.g. searching `CI-1011`), then click **Filter**.
3. Tick the checkbox next to each receipt you want (or the header checkbox to select all). The selection counter shows how many A4 pages that will take, at 4 receipts per page.
4. Click **Consolidate 2x2 A4 PDF**. A **Consolidated 2x2 A4 Receipt Preview** opens.
5. Click **Download PDF** to save it, or **Close** to discard the preview.
6. Click **Preview** on any single row's Actions column to open just that one receipt in a new tab.

**Example:** You select 9 receipts tagged `March-2026`. The selection badge reads "9 Selected (3 A4 Pages)." Click **Consolidate 2x2 A4 PDF**, review the preview, and click **Download PDF** to save `Paperless_2x2_Receipts_...pdf` for filing.

## Field Reference

| Field/Control | Description | Notes |
|---|---|---|
| Physical Receipt # (Receive Payment) | The number on the paper receipt issued to the customer | Optional, but recommended for matching to Paperless Receipts later |
| Payment Method (Receive Payment) | Which configured payment channel this split line uses | Only methods enabled in Settings appear; reference field requirements vary per method |
| Amount (Receive Payment split) | How much this payment line is for | Must be a positive number |
| Reference / Ref # (Receive Payment split) | Cheque number, transaction ID, auth code, etc. | Required only if the selected method is configured to require it |
| Date on Cheque (Maturity) | The date printed on a cheque | Only shown for cheque-type payment methods |
| Applied Amount (Invoice Allocations) | How much of the received payment goes to a specific invoice | Auto-filled; can be overridden per invoice |
| Receipt Notes | Free-text internal memo on the payment | Optional |
| First Name / Last Name (Customer) | Customer's individual contact name | First Name is required |
| Company Name (Customer) | Business name, if applicable | Used as the display name over first/last name when present |
| Tags (Customer) | Free-form labels for search/filtering | Optional |
| Active (Customer) | Whether the customer appears in the default "Active" filter | Does not delete history when turned off |
| Status filter (Customer AR Summary) | Narrows the customer table by aging/credit-hold state | All Statuses / Current / Overdue / Credit Hold Only |
| Attach images (SOA export) | Includes scanned receipt images in the exported PDF | Off by default |
| Adjustment Amount (Wallet) | Manual correction to a customer's Store Wallet balance | Positive adds credit, negative removes it |

## Common Errors & What They Mean

| Message / Situation | Meaning | What To Do |
|---|---|---|
| "Payment amounts must be positive." | One of your payment split lines has a zero, blank, or negative amount. | Enter a positive amount on every line, or remove the empty one. |
| "Insufficient store wallet balance (&lt;amount&gt;) for this payment." | You tried to pay with more store credit than the customer currently has. | Reduce the amount on that line, or switch part of the payment to another method. |
| "Reference / Cheque # is required for &lt;method&gt;." | The payment method you picked needs a reference number and the field is empty. | Fill in the reference field before saving — nothing was lost, just add it and resubmit. |
| Red "Allocated invoice total exceeds payment received" warning | The invoice allocations add up to more than the total payment amount entered. | Lower one or more invoice allocations, or add another payment line to cover the difference, until the two totals match. |
| "No outstanding unpaid invoices found for this customer." | This customer has no open balance to apply a payment against right now. | Double-check you picked the right customer. If they genuinely have no open invoices, there's nothing to receive payment for. |
| "Failed to process payment." | The payment didn't save — usually a connection hiccup or a validation issue on the server. | Nothing was recorded; check your entries and try **Process & Save Payment** again. If it keeps failing, note the customer and amount and contact IT. |
| "Failed to save customer." | The customer record couldn't be saved. | Check that First Name is filled in and try again. |
| "Are you sure?" prompt when deleting a customer | A safety check before permanently removing a customer record. | Click **Delete** only if you're certain; click **Cancel** if you're not. |
| Paperless connection badge shows an error message instead of "Connected" | The app can't reach the Paperless-ngx receipt server right now. | Click **Check Connection** to retry. If it stays down, the receipts you need may be temporarily unavailable — try again later or contact IT. |
| "Failed to generate 2x2 PDF layout." | The consolidated PDF couldn't be built from your selected receipts. | Try again with a smaller selection. If it persists, contact IT. |

## Related Modules

- [Accounts Payable](./accounts_payable_manual.md)
- [Sales History](./sales_history_manual.md)
- [Settings — Payment Methods](./settings_and_setup_manual.md)

## Advanced Reference (optional)

**How a split payment line gets allocated across invoices:** Each payment method line you add in Record a Customer Payment is saved as its own payment record. When you have multiple invoices selected for allocation, the amount on each line is applied to invoices in the order they're listed, filling one invoice's remaining balance before moving to the next, until that line's amount is used up. This means if you want a specific payment instrument (e.g. a particular cheque) tied to a specific invoice, allocate carefully rather than relying purely on auto-fill when paying off several invoices at once with a mixed-method payment.

**Settlement type and Sales/Cash metrics:** A payment's settlement type (Instant, Delayed, On Account) also controls whether it's counted in same-day cash reconciliation and "Amount Collected" figures elsewhere in the system, not just the AR balance. Cash and most instant methods count immediately; Cheque/Bank Transfer only count once manually marked settled after bank clearance; On Account never creates a payment record until a real payment is collected later through this AR module.
