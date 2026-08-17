---
module: Sales History
page_component: SalesHistoryPage.jsx
audience: Cashier, Accounting, Manager
verified_against: packages/web/src/pages/SalesHistoryPage.jsx (branch docs/comprehensive-project-documentation-and-manual, 2026-08-17)
last_updated: 2026-08-17
---

# Sales History

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
> - **What it's for:** Look up any past invoice, verify what was sold and how it was paid, and reconcile the register at the end of a shift.
> - **Who uses it:** Cashiers and Managers (drawer reconciliation), Accounting staff (revenue and VAT reporting).
> - **You'll mostly come here to:** Find an invoice to check its details, and run the end-of-day cash count against the **Expected Net Cash (Drawer)** figure.

## Overview

Sales History is the record of every invoice the business has issued. It doubles as two tools in
one page: a lookup/search tool for finding a specific past sale, and a reconciliation dashboard that
tells a cashier how much cash should be in the drawer and tells accounting how much revenue and VAT
was recognized in a period.

## Key Concepts

- **Invoice status** — every invoice shows one of these statuses, color-coded on the page:

  | Status | Meaning |
  |---|---|
  | **Unpaid** | No payment has been recorded yet. |
  | **Partially Paid** | Some, but not all, of the balance has been paid. |
  | **Paid** | The invoice is fully paid. |
  | **Partially Refunded** | Some items on the invoice were refunded via a Credit Note, but not the whole invoice. |
  | **Fully Refunded** | Every item on the invoice has been refunded. |

- **Credit Note** — the record created when you process a refund on an invoice. It reduces the
  invoice's net amount and is what drives the "Refunds" figures on this page.
- **Physical Receipt No.** — the number from the paper receipt/official-receipt booklet, separate
  from the system-generated Invoice #. It can be entered or corrected from the invoice detail view.
- **Tax-inclusive vs. tax-exclusive** — "tax-inclusive" figures include VAT (what the customer
  actually paid); "tax-exclusive" figures strip VAT out (what counts as revenue for accounting). The
  Summary card keeps these two views side by side so cash reconciliation and revenue reporting don't
  get mixed up.

### Key Calculations

> 📝 Note: all figures below are for the date range currently selected on the page, and always
> exclude invoices with status **Cancelled**.

**Expected Net Cash (Drawer)** — the amount of physical cash that should be in the register, after
subtracting change given back and any cash refunds paid out.

`Expected Net Cash = (Cash Tendered − Change Returned) − Cash Refunds Paid`

Example: ₱9,000.00 tendered in cash, ₱550.00 given back as change, ₱0 refunds this period →
₱9,000.00 − ₱550.00 − ₱0 = **₱8,450.00** should be in the drawer.

> 📝 Note: "Cash Refunds Paid" (labelled **Refunds Out** on the page) is an approximation — it totals
> all Credit Notes issued in the period, regardless of which payout method was actually used, on the
> assumption most refunds are paid out of the drawer in cash. If a refund was actually paid back via
> GCash, card reversal, store credit, or an A/R reduction, this figure will slightly understate the
> true expected drawer cash. If the number never floors below zero, the drawer figure is capped at
> ₱0.00 rather than going negative.

**Non-Cash Collections** — everything collected through card, GCash, bank transfer, or any other
non-cash method configured on the system, for settled payments only.

`Non-Cash Collections = sum of all non-cash payment amounts`

Example: ₱2,000.00 by Card + ₱1,150.00 by GCash → **₱3,150.00**.

**Cash Mix** — the share of total collections that came in as cash, used to sanity-check the drawer
count against the terminal slips.

`Cash Mix = Cash Collected (Net of Change) ÷ (Cash Collected (Net of Change) + Non-Cash Collections)`

Example: ₱8,450.00 cash ÷ (₱8,450.00 + ₱3,150.00) = **72.8%**.

> 📝 Note: Cash Mix is calculated before subtracting refunds — it answers "of the money that came in,
> how much was cash," not "of the cash left after refunds." Don't expect it to match Expected Net Cash
> exactly if refunds were paid out during the period.

**Gross Sales (Excl. VAT)** — the tax-exclusive base price of every active invoice issued in the
period. This is what accounting recognizes as top-line revenue.

`Gross Sales = sum of each invoice's subtotal before VAT`

Example: an invoice with a ₱1,000.00 subtotal and ₱120.00 VAT contributes **₱1,000.00** to Gross
Sales, not ₱1,120.00.

**Refunds (Excl. VAT)** — the tax-exclusive value of every Credit Note issued in the period.

`Refunds = sum of each credit note's subtotal before VAT`

**Net Sales (Excl. VAT)** — Gross Sales minus Refunds; the number accounting reports as actual
revenue for the period.

`Net Sales = Gross Sales − Refunds`

Example: ₱10,000.00 Gross Sales − ₱500.00 Refunds = **₱9,500.00** Net Sales.

**Net VAT Collected** — VAT charged on sales minus VAT given back on refunds; this is the tax
liability owed to the tax authority for the period.

`Net VAT Collected = VAT Charged on Sales − VAT Refunded on Credit Notes`

Example: ₱1,200.00 VAT charged − ₱24.00 VAT refunded = **₱1,176.00** owed.

**Amount Collected (Incl. VAT)** — how much of the invoiced total (VAT included) has actually been
paid so far this period, capped per invoice so overpayments don't inflate the number.

**Collection Rate** — how much of what was billed has actually been collected.

`Collection Rate = Amount Collected (Incl. VAT) ÷ Net Sales (Incl. VAT, i.e. Net Sales + Net VAT Collected)`

Example: ₱11,600.00 collected ÷ ₱11,600.00 billed = **100%** if fully collected in the same period;
lower if some invoices are still unpaid or partially paid.

**Outstanding A/R** — the total unpaid balance still owed by customers, tax-inclusive (customers are
legally on the hook for the full invoiced amount, VAT included).

`Outstanding A/R = sum of each invoice's (Total − Refunded) − Amount Paid, floored at ₱0.00`

Example: an invoice billed at ₱2,400.00 with nothing paid yet contributes the full **₱2,400.00** to
Outstanding A/R.

## How To — Search for an Invoice

*Why this matters:* This is the fastest way to answer "what did this customer buy" or "where's the
receipt for INV-2026-000123" without scrolling through a long list.

*Precision:* This is a normal default flow — search terms and filters can be adjusted freely; nothing
here posts to the ledger.

1. Set the **Start Date** and **End Date** to the range you want to search, or use one of the
   shortcut buttons (**Today**, **Yesterday**, **Last 7 Days**, **Last 30 Days**, **This Month**,
   **Last Month**) to jump to a common range instantly.
2. Type into the **Search** box. It matches against:
   - Invoice Number (e.g. `INV-2026-000123`)
   - Physical Receipt No. (e.g. `SI-4652`)
   - Customer first or last name
   - Line item details — part numbers, descriptions, brands, or group names
3. Results update automatically as you type (a brief pause after you stop typing is normal — this
   is the system debouncing the search, not a delay you need to work around).
4. Click any column header (**Invoice #**, **Physical Receipt No.**, **Date**, **Customer**,
   **Status**, **Total**) to sort by that column.

**Example:** Typing `INV-2026-000123` into Search with the date range widened to **Last 30 Days**
finds the invoice even if you don't remember the exact date it was issued.

## How To — Open an Invoice's Details

*Why this matters:* The details view is where you confirm exactly what was sold, how it was paid,
who issued and approved it, and where you go to process a refund or fix the physical receipt number.

*Precision:* Opening and reading details is a normal default action. Any action taken *inside* the
details view (deleting an invoice, changing its date, processing a refund) has its own precision
note below.

1. Click anywhere on the invoice's row in the table.
2. The **Details for Invoice #...** window opens, showing:
   - **Issuer (Staged By)** and **Approved By**, with the submitted and approved timestamps.
   - **Items Sold** — each line item, quantity, unit price, and line total.
   - **Payments** — every payment recorded against the invoice, its method, status (**Settled**,
     **Pending**, or **Failed**), amount, amount tendered and change given (for cash), and a running
     **Total Paid** / **Pending** summary at the bottom.
   - A **Date Change History** list at the bottom, if the invoice's transaction date has ever been
     corrected.

> 📝 Note: If a payment shows status **Pending**, a **Mark Settled** button appears next to it —
> use this once you've confirmed the funds have actually cleared (e.g. a GCash transfer that's now
> confirmed in the account).

**Example:** Clicking the row for `INV-2026-000123` opens its details and shows two payments: ₱500.00
by Card (Settled) and ₱620.00 by Cash (Settled, ₱1,000.00 tendered, ₱380.00 change).

## How To — Correct the Physical Receipt Number

*Why this matters:* The system-generated Invoice # and the paper receipt number from your official
receipt booklet are tracked separately. If a cashier writes the wrong number on the receipt or the
paper number wasn't entered at time of sale, this is where you fix it.

*Precision:* This is a normal default action, available only if your account has been granted rights
to edit receipt numbers — the button only appears if you have that permission.

1. Open the invoice's details (see above).
2. Click **Edit Receipt No.**
3. Type the correct number — it formats automatically as you type (e.g. `SI-1234`, `ABC/5678`).
4. Click **Save**, or **Cancel** to discard the change.

**Example:** An invoice was saved with a blank Physical Receipt No.; editing it in and typing
`SI-4652` saves it correctly formatted as `SI-4652`.

## How To — Process a Refund (Credit Note)

*Why this matters:* When a customer returns an item, you don't edit or delete the original invoice —
you issue a Credit Note against it, which reduces the invoice's net amount and correctly restates
revenue and VAT for the period without touching the historical sale record.

*Precision:* Follow these steps exactly — refunds post to accounting and adjust reported revenue,
VAT, and (depending on payout method) the expected cash drawer.

1. Open the invoice's details and click **Process Refund**.
2. Choose the **Refund Payout Method**: **Cash Payout**, **GCash Transfer**, **Card Reversal**,
   **Store Credit / Voucher**, or **Accounts Receivable Reduction**.
3. Check the box next to each item being returned. Only quantities not already refunded are
   selectable — the line shows **Sold**, **Refunded**, and **Available** quantities so you can see
   how much is left to return.
4. Adjust the quantity for each checked item if the customer isn't returning the full quantity sold
   on that line (it won't let you enter more than what's **Available**).
5. Confirm the **Total Refund** amount shown matches what you expect, then click **Confirm Refund**.

> ⚠️ Important: The Sales History reconciliation card treats every refund issued in the period as an
> approximate *cash* payout when calculating **Expected Net Cash (Drawer)**, regardless of which
> **Refund Payout Method** you actually chose. If you process a refund as GCash, Card, Store Credit,
> or an A/R Reduction, remember the drawer cash figure will understate reality slightly — use
> judgment when reconciling on days with non-cash refunds.

**Example — Scenario A, Split Payment:** A customer buys parts totaling **₱1,120.00** (₱1,000.00
subtotal + ₱120.00 VAT at 12%). They pay ₱500.00 by Card and the remaining ₱620.00 in cash, handing
over a ₱1,000.00 bill; the cashier returns ₱380.00 change.
- Cash Tendered = ₱1,000.00, Change Returned = ₱380.00 → **Expected Net Cash contribution = ₱620.00**
- **Non-Cash Collections contribution = ₱500.00** (verify this against the card terminal slip)
- **Gross Sales contribution = ₱1,000.00**, **VAT Collected contribution = ₱120.00**

**Example — Scenario B, Refund:** The next day, the customer returns one part worth **₱224.00**
(₱200.00 subtotal + ₱24.00 VAT) from that invoice. A Cash Payout Credit Note is issued.
- **Refunds (Excl. VAT) contribution = ₱200.00**
- **Net VAT Collected contribution = −₱24.00**
- **Expected Net Cash (Drawer)** drops by ₱224.00 to reflect the cash paid back out of the till.

## How To — Delete an Invoice

*Why this matters:* Occasionally an invoice is created in error (wrong customer, duplicate entry,
test transaction) and needs to be removed entirely, restoring the stock it sold back to inventory.

*Precision:* Follow this exactly and only when certain — deletion cannot be undone, and it reverses
inventory as well as the sale.

1. Open the invoice's details.
2. Click **Delete Invoice** (only visible if your account has permission to delete invoices).
3. Confirm the prompt: *"Delete Invoice #... ? This cannot be undone and will restore stock
   quantities."*

> ⚠️ Important: Deleting an invoice is permanent and puts the sold quantities back into inventory.
> If the goal is to reverse a sale that's already been paid or partially fulfilled, consider whether
> a refund (Credit Note) is the more appropriate tool — it preserves the historical record.

## How To — Change an Invoice's Transaction Date

*Why this matters:* Occasionally an invoice needs to be recorded under a different business date than
the one it was originally entered on (e.g. correcting a late entry). This changes which day's
reporting the sale counts toward.

*Precision:* Follow these steps exactly — this affects date-based reporting (including this page's
own date-range figures) and always requires a written reason.

1. Open the invoice's details and click **Change Date** (only visible if your account has
   permission).
2. Pick the **New Date** — it cannot be a future date.
3. Enter a **Reason** (required, and must be reasonably descriptive — very short reasons will be
   rejected).
4. Review the preview shown, then confirm.

> ⚠️ Important: Changing a date so it lands in a different calendar month requires an additional,
> more restricted permission. If the button is disabled after picking a date, that's why — ask a
> manager with the unrestricted date-change permission to make the change instead.

**Example:** An invoice recorded on `2026-08-17` should really count toward `2026-08-16`'s sales.
Changing the date with the reason "Entered after midnight, sale occurred before close" moves it into
the correct day's Sales History totals.

## How To — Reconcile the Cash Drawer at End of Day

*Why this matters:* This is the daily control that catches cash shortages, overages, or missed
transactions before they become a larger problem. Every shift or business day should end with this
check.

*Precision:* Follow these steps — this is a control process, even though the individual clicks are
flexible.

1. Set **Start Date** and **End Date** to today (or use the **Today** shortcut).
2. If the Summary card is collapsed, click **Show** to expand it (the page remembers whether you had
   it open or closed the next time you visit).
3. Note the **Expected Net Cash (Drawer)** figure under **Operational Cash Flow (Tax-Inclusive)**.
4. Physically count the cash drawer, excluding the starting float.
5. Compare:
   - Physical count **equals** Expected Net Cash → reconciliation balanced, nothing to do.
   - Physical count **is higher** than Expected Net Cash → a drawer overage; check whether change was
     underpaid to a customer at some point during the day.
   - Physical count **is lower** than Expected Net Cash → a drawer shortage; check for a missed
     transaction, incorrect change given, or a non-cash refund that was mistakenly paid out in cash
     (see the Important note under Process a Refund above).
6. Cross-check **Non-Cash Collections** against your card terminal and GCash transaction slips for
   the day to confirm they match what the system recorded.

**Example:** Expected Net Cash (Drawer) reads ₱8,450.00. The physical count comes to ₱8,450.00 —
balanced, no follow-up needed. If it had come to ₱8,400.00 instead, that's a ₱50.00 shortage to
investigate.

## Field Reference

| Field/Control | Description | Notes |
|---|---|---|
| Start Date / End Date | The reporting period the whole page (table, Summary, search) is scoped to. | Defaults to today, in Asia/Manila time. |
| Search | Free-text search across invoice #, physical receipt #, customer name, and line-item details. | Updates automatically a moment after you stop typing. |
| Invoice # | System-generated invoice identifier. | Format like `INV-2026-000123`. |
| Physical Receipt No. | The number from the paper receipt booklet. | Editable from invoice details; shows `-` if not yet entered. |
| Issuer | The staff member who created/staged the invoice. | Shown in the table and invoice details. |
| Approved By | Who approved the invoice, or "System Auto-Approved" if no manual approval step applied. | |
| Status | Current lifecycle state of the invoice. | See Key Concepts for the full list and what each means. |
| Total | Invoice total, tax-inclusive. | |
| Show / Hide (Summary) | Expands or collapses the detailed Summary breakdown. | Collapsed by default; your last choice is remembered on this device. |
| Refund Payout Method | How a refund is being paid back to the customer. | Cash Payout, GCash Transfer, Card Reversal, Store Credit / Voucher, or Accounts Receivable Reduction. |
| Mark Settled | Marks a Pending payment as confirmed/cleared. | Only shown on payments with status Pending. |

## Common Errors & What They Mean

| Message / Situation | Meaning | What To Do |
|---|---|---|
| "Failed to fetch sales history." | The invoice list couldn't load, usually a temporary connectivity issue. | Wait a moment and try changing the date range or refreshing the page. Nothing was lost. |
| "You do not have permission to view payments for this invoice." | Your account role doesn't include rights to see payment details, but you can still see the items sold. | Ask a manager or supervisor to look up payment details if you need them. |
| "Please select at least one item to refund." | You clicked Confirm Refund without checking any item. | Check at least one line item under Select items to refund, then confirm again. |
| "Delete Invoice #...? This cannot be undone and will restore stock quantities." | A confirmation, not an error — this is your last chance to back out before a permanent deletion. | Only confirm if you're sure; cancel if in doubt and consider a refund instead. |
| Change Date button is greyed out / disabled | Either the reason is too short, the date crosses into a different month and needs the unrestricted permission, or the preview found a blocking issue. | Add more detail to the reason, or ask a manager with the unrestricted permission if it's a cross-month change. |
| Expected Net Cash (Drawer) doesn't match the physical count | Not necessarily a system error — see the End-of-Day Reconciliation walkthrough above for what to check first. | Work through the checklist: change given, non-cash refunds recorded as cash, or a missed transaction. |

## Related Modules

- [Accounts Receivable](./accounts_receivable_manual.md)
- [Point of Sale](./point_of_sale_manual.md)
- [Cheques & Treasury](./cheques_and_treasury_manual.md)

## Advanced Reference (optional)

This section restates the Key Calculations above using formal notation, for anyone who wants to
audit or reproduce these figures precisely (e.g. building a reconciling report). It is not needed for
day-to-day use of this page.

**Variable glossary**

Let $I$ be the set of active invoices in the selected period (status ≠ `Cancelled`).
Let $P$ be the set of settled payments matched to invoices in $I$ during the period.
Let $CN$ be the set of credit notes (refunds) issued in the period.

- $inv.total\_amount$ — tax-inclusive invoice amount
- $inv.subtotal\_ex\_tax$ — tax-exclusive invoice base
- $inv.tax\_total$ — VAT charged on the invoice
- $inv.amount\_paid$ — total settled payments applied to the invoice
- $inv.balance\_due$ — outstanding balance
- $p.amount$ — net payment amount applied
- $p.tendered\_amount$ — cash amount physically handed over (cash payments only)
- $cn.subtotal\_ex\_tax$ — tax-exclusive refund base
- $cn.tax\_total$ — VAT refunded on the credit note
- $cn.total\_amount$ — tax-inclusive refund amount (used only as the approximate cash-refund figure)

**Formulas**

$$\text{Cash Collected (Net)} = \sum_{p \in P_{\text{cash}}} p.tendered\_amount - \sum_{p \in P_{\text{cash}}} \max(0, p.tendered\_amount - p.amount)$$

$$\text{Non-Cash Collections} = \sum_{p \in P_{\text{non-cash}}} p.amount$$

$$\text{Expected Net Cash (Drawer)} = \max\left(\text{Cash Collected (Net)} - \sum_{cn \in CN} cn.total\_amount,\ 0\right)$$

$$\text{Cash Mix} = \frac{\text{Cash Collected (Net)}}{\text{Cash Collected (Net)} + \text{Non-Cash Collections}}$$

$$\text{Gross Sales} = \sum_{inv \in I} inv.subtotal\_ex\_tax \qquad \text{Refunds} = \sum_{cn \in CN} cn.subtotal\_ex\_tax$$

$$\text{Net Sales} = \text{Gross Sales} - \text{Refunds}$$

$$\text{Net VAT Collected} = \max\left(\sum_{inv \in I} inv.tax\_total - \sum_{cn \in CN} cn.tax\_total,\ 0\right)$$

$$\text{Amount Collected} = \sum_{inv \in I} \min(inv.amount\_paid,\ inv.total\_amount - inv.refunded\_amount)$$

$$\text{Collection Rate} = \min\left(\frac{\text{Amount Collected}}{\text{Net Sales} + \text{Net VAT Collected}},\ 1\right)$$

$$\text{Outstanding A/R} = \sum_{inv \in I} \max\left(0,\ (inv.total\_amount - inv.refunded\_amount) - inv.amount\_paid\right)$$

> 📝 Note: unlike an earlier draft of this manual, Cash Mix is calculated from Cash Collected (Net)
> and Non-Cash Collections *before* subtracting approximate cash refunds — it is not derived from
> Expected Net Cash (Drawer). The two figures can therefore diverge slightly on days with refunds.
