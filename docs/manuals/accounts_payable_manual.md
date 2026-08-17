---
module: Accounts Payable & Suppliers
page_component: AccountsPayablePage.jsx, SuppliersPage.jsx
audience: Accounting Staff, Manager
verified_against: commit a5d3eb3 (2026-08-12)
last_updated: 2026-08-17
---

# Accounts Payable & Suppliers

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
> - **What it's for:** See what the business owes each supplier, track how overdue those bills are, and keep supplier contact/terms records up to date.
> - **Who uses it:** Accounting staff and managers with Accounts Payable access.
> - **You'll mostly come here to:** Check a supplier's balance and bill history, and record a new payable when a bill comes in.

## Overview

Accounts Payable (AP) is where you track money the business owes to its suppliers — unpaid bills, how overdue they are, and which suppliers are on payment hold. The **Accounts Payable** page (Overview & Aging) gives you the big-picture dashboard across all suppliers; the **Suppliers** page is the directory where you maintain each supplier's contact details and payment terms. Both open the same supplier detail view, so you can drill from either page into one supplier's bills, payments, and ledger history.

## Key Concepts

- **Payable / Bill** — A supplier invoice the business owes money on. Each bill has a **Total Amount**, an **Amount Paid**, and a status of **Unpaid**, **Partially Paid**, or **Paid**.
- **Payment Terms (days)** — How many days after the bill date payment is due (e.g. "Net 30" means due 30 days after the bill date). Set per supplier and used to auto-fill a bill's due date if you don't enter one manually.
- **Payment Hold** — A manual flag on a supplier that signals "do not pay this supplier right now" (e.g. a dispute or quality issue). It doesn't block bills from being recorded, but it's a visible warning wherever the supplier appears.
- **Aging** — How overdue a supplier's open bills are, grouped into buckets: **Current**, **1-30 Days**, **31-60 Days**, **61-90 Days**, and **90+ Days**. See Key Calculations below for exactly how a bill lands in a bucket.
- **AP Ledger** — The permanent, chronological record of every charge and payment posted against a supplier (new bills increase the balance, payments decrease it). This is the source of truth for a supplier's running balance — the **Ledger** tab in the supplier detail view shows it directly.
- **Outbound Cheque** — A cheque the business issues to pay a supplier (or another expense). Cheque issuance and clearing lives on the separate **Outbound Cheques & Treasury** page, reachable from the button of the same name on the Accounts Payable page — see [Related Modules](#related-modules).

### Key Calculations

**Payable Due (balance on a bill) = Total Amount − Amount Paid**

Example: Bill `INV-2026-000456` has a Total Amount of ₱18,500.00 and an Amount Paid of ₱6,500.00.
Payable Due = ₱18,500.00 − ₱6,500.00 = **₱12,000.00** still owed.

**Aging bucket** — every open bill (Unpaid or Partially Paid) is placed into a bucket by comparing its due date (or its bill date, if no due date is set) to today:

| Bucket | Meaning |
|---|---|
| Current | Due date is today or in the future |
| 1-30 Days | Up to 30 days past due |
| 31-60 Days | 31 to 60 days past due |
| 61-90 Days | 61 to 90 days past due |
| 90+ Days | More than 90 days past due |

Example: today is **August 17, 2026**. A bill with a due date of **January 5, 2026** is well over 90 days late, so it falls in the **90+ Days** bucket and counts toward that colored segment of the Supplier Bill Aging Summary bar.

**Overdue (KPI card)** = sum of (Total Amount − Amount Paid) for every open bill whose due date has already passed. A bill that is only partially paid still counts, but only for its remaining balance — not its original total.

## How To — Check a Supplier's Balance, Bills, and Payment History

*Why this matters:* This is the fastest way to answer "how much do we owe this supplier, and what's it for?" before approving a payment or fielding a supplier's call.

*Precision:* This is a read-only lookup — there's nothing to get wrong here.

1. Go to **Accounts Payable** (for suppliers with an open balance) or **Suppliers** (for the full directory, including paid-up and inactive suppliers).
2. Click a supplier's row to open their detail panel.
3. Use the tabs across the top to drill in:
   - **Profile** — contact info, payment terms, and the Payment Hold control.
   - **Bills** — every bill for this supplier, with Total, Paid, due date, and days overdue.
   - **Payments** — every payment instrument issued to this supplier (amount, date, method, and which bills it was applied to).
   - **Ledger** — the full chronological running balance: every charge and payment, in order, with the balance after each entry.

**Example:** You open **Suppliers**, find "Metro Auto Parts Supply" showing an AP Balance of ₱42,150.00, click the row, and switch to the **Bills** tab to see which specific invoices make up that total before deciding what to pay first.

## How To — Record a New Payable

*Why this matters:* Use this when a supplier's bill/invoice arrives before (or without) a formal goods receipt — for example, a service invoice, or paperwork that arrives ahead of the physical delivery. It creates the bill so it starts showing up in AP balances and aging immediately; you can attach the actual line items later (see the next task) once goods physically arrive.

*Precision:* Follow these steps as given — this posts a real payable to the ledger the moment you save it.

1. On the **Accounts Payable** page, click **New Payable** (or, from a specific supplier's detail panel, open the **Bills** tab and click **New Payable** there — the supplier is pre-filled).
2. Select the **Supplier** (skip if pre-filled).
3. Enter a **Bill Number** if the supplier gave you one — leave it blank and the system auto-generates one.
4. Set the **Bill Date** (defaults to today) and, optionally, the **Due Date**. Leave Due Date blank to auto-compute it from the supplier's payment terms.
5. Enter the **Total Amount** — this is required.
6. Add any **Notes**, then click **Create Payable**.

> ⚠️ **Important:** Creating a payable here does not receive any stock. If the bill is for physical goods, use **Attach Items** on the resulting bill once the delivery arrives (see below) — that's the step that actually moves inventory.

**Example:** A bill arrives from "Metro Auto Parts Supply" for ₱18,500.00, no bill number printed on it, dated today, with 30-day terms. You leave Bill Number and Due Date blank, enter Total Amount `18500.00`, and click **Create Payable** — the system fills in an auto-generated bill number and a due date 30 days out.

## How To — Attach Items to a Payable (Receive Stock)

*Why this matters:* When the physical goods for a payable you already recorded actually arrive, this is the step that receives them into inventory and links that stock to the bill, so the bill's items and its dollar total can be checked against each other.

*Precision:* Follow these steps as given — this posts a real goods receipt and increases stock on hand.

1. Open the supplier's detail panel and go to the **Bills** tab.
2. Find the bill and click **Attach Items**.
3. Search for each part by name or SKU and click it to add a line.
4. Adjust **Qty** and **Cost** for each line as needed. The modal shows a running **Items Total** next to the bill's **Bill Total** so you can see if they match.
5. Click **Attach & Receive Stock**.

> 📝 **Note:** The Items Total does not have to exactly match the Bill Total (e.g. a bill may include a delivery fee that isn't tied to a specific part) — the comparison is there to help you catch mistakes, not to block you.

**Example:** On bill `INV-2026-000456`, you search "brake pad," add 20 units at ₱425.00 cost each (₱8,500.00), plus 2 units of "oil filter" at ₱150.00 (₱300.00) — Items Total shows ₱8,800.00 against a Bill Total of ₱18,500.00, meaning more lines still need to be attached later. Click **Attach & Receive Stock** to post what you have so far.

## How To — Record a Supplier Payment (Issue an Outbound Cheque)

*Why this matters:* This is how you actually pay down what a supplier is owed. Right now, cheque is the only payment instrument this system issues to suppliers — there is no separate cash or bank-transfer entry form.

*Precision:* Follow these steps exactly — this posts a real cheque record and, once applied to bills, reduces those bills' balances on the ledger.

1. From the **Accounts Payable** page, click **Outbound Cheques & Treasury**.
2. Click to issue a new cheque, opening the **Issue Outbound Cheque** form.
3. Select the **Bank Account** the cheque is drawn against. If that account has no linked print template, a note will tell you to set one up in Bank Accounts before you can print from Print Cheques.
4. Confirm or edit the suggested **Cheque Number** (it's suggested from the bank account's sequence but is always freely editable — the real source of truth is the physical cheque book).
5. Set the **Cheque Date** and the **Amount (₱)**.
6. Under **Purpose**, choose **Supplier Bill Payment**.
7. Select the **Supplier**. If they have open bills, a checklist of bills appears under **Apply to Bills (optional)**, each showing what's still owed — check the ones this cheque is paying.
8. Optionally fill in **Reference #** and **Memo**.
9. Click **Issue Cheque**.

> ⚠️ **Important:** If you don't check any bills under **Apply to Bills**, the cheque is still issued and recorded, but it won't reduce any specific bill's balance. Always apply the cheque to the bill(s) it's actually paying so the supplier's balance and aging stay accurate.

**Example:** You issue cheque `0001234` from "Main Operating Account," dated today, for ₱12,000.00, purpose **Supplier Bill Payment**, supplier "Metro Auto Parts Supply," and check the box next to bill `INV-2026-000456` (Owed: ₱12,000.00). Click **Issue Cheque** — the cheque enters the clearing queue and, once cleared, that bill's balance drops to ₱0.00.

## How To — Adjust a Bill's Due Date

*Why this matters:* Suppliers sometimes grant an extension, or a due date was entered wrong. Correcting it keeps aging and the Overdue KPI accurate instead of flagging a bill that isn't really late.

*Precision:* This is a normal, flexible correction — enter the new date the supplier actually agreed to.

1. Open the supplier's detail panel, go to the **Bills** tab, and click **Edit Due Date** on the bill (only available while the bill isn't fully Paid).
2. Pick the new date.
3. Optionally enter a **Reason** for the record.
4. Click **Save**.

**Example:** A supplier agrees to push bill `INV-2026-000456`'s due date from August 1 to August 31. You click **Edit Due Date**, select August 31, type "Supplier granted 30-day extension" as the reason, and click **Save** — the bill drops out of the overdue aging buckets.

## How To — Place or Lift a Payment Hold

*Why this matters:* Payment hold is a flag, not a block — it doesn't stop bills or payments from being recorded, but it's a loud visible warning (an "ON HOLD" badge) everywhere that supplier appears, so anyone about to pay them sees it first.

*Precision:* A reason is required whenever you place a hold — it's the only thing another staff member has to go on when they see the badge later.

1. Open the supplier's detail panel and go to the **Profile** tab.
2. To place a hold: type a reason in the text box and click **Place On Payment Hold**.
3. To lift a hold: click **Lift Payment Hold**.

**Example:** A shipment from "Metro Auto Parts Supply" arrived damaged. You open their Profile tab, type "Disputed shipment — quality issue on GRN-2026-0031, do not pay until resolved," and click **Place On Payment Hold**. Their name now shows an "ON HOLD" badge on every AP and Suppliers list until someone clicks **Lift Payment Hold**.

## How To — Add or Edit a Supplier

*Why this matters:* Every payable and payment traces back to a supplier record, and the payment terms you set here drive auto-computed due dates on future bills — so keeping this accurate saves rework later.

*Precision:* This is a normal record edit — use your judgment on what to fill in beyond the required Supplier Name.

1. Go to the **Suppliers** page and click **Add Supplier** (or click the pencil/edit icon on an existing supplier's row to edit).
2. Enter the **Supplier Name** (required).
3. Optionally fill in **Contact Person**, **Phone**, **Email**, and **Address**.
4. Enter **Payment Terms (days)** if you know it (e.g. `30` for Net 30) — this is used to auto-compute bill due dates when goods are received from this supplier.
5. Leave **Account is Active** checked unless you're retiring this supplier.
6. Click **Save**.

> 💡 **Tip:** Press **Ctrl+S** (or **Cmd+S** on Mac) while the form is open to save without reaching for the mouse.

**Example:** A new parts vendor, "Northside Bearings Inc.," is added with Contact Person "Rina Cruz," Phone `0917-555-0142`, and Payment Terms `30`. Every bill entered for them afterward defaults its due date to 30 days out unless you override it.

## Field Reference

| Field/Control | Description | Notes |
|---|---|---|
| Total Payables (KPI) | Sum of every open supplier balance across the business | From the AP Overview & Aging dashboard |
| Overdue (KPI) | Sum of balances on bills whose due date has passed, with a count of how many bills | See Key Calculations |
| Due Next 7 Days (KPI) | Sum of balances on bills due within the next 7 days | Helps plan the coming week's payments |
| Suppliers On Hold (KPI) | Count of suppliers currently flagged with a payment hold | |
| Supplier Bill Aging Summary | Stacked bar showing total open balance by aging bucket | Click a colored segment to filter the table below to that bucket |
| Status filter (AP Overview table) | All Statuses / Current - Good Standing / Overdue Payables / Payment Hold Only | Filters the supplier list by their earliest-due-bill status or hold flag |
| Open Bills | Count of a supplier's currently unpaid or partially paid bills | Shown in the AP Overview supplier table |
| Payable Due | A supplier's total outstanding balance | See Key Calculations |
| Bill Number | Identifies a bill; auto-generated if left blank on New Payable | |
| Bill Date | The date on the supplier's invoice | Defaults to today |
| Due Date (on a bill) | When payment is due | Auto-computed from the supplier's Payment Terms if left blank |
| Total Amount (on a bill) | The full amount owed on the bill | Required, must be greater than zero |
| Payment Terms (days) | Number of days after the bill date that payment is due for this supplier | Optional; drives auto-computed due dates |
| Payment Hold / Payment Hold Reason | Manual "do not pay" flag and the reason behind it | Reason is required to place a hold |
| Bank Account (cheque) | The account the outbound cheque is drawn from | Must have a linked print template to be printable later |
| Cheque Number | The physical cheque's number | Suggested automatically per bank account, but always editable |
| Purpose (cheque) | Supplier Bill Payment / Loan Payment / Rent / Other Expense | Only Supplier Bill Payment applies bills; the others require an Expense Category instead |
| Apply to Bills (cheque) | Checklist of a supplier's open bills to pay down with this cheque | Optional, but should normally be checked so balances update |
| Account is Active (supplier) | Whether the supplier appears in the default Active supplier list | Inactive suppliers still show under the Inactive/All filters |

## Common Errors & What They Mean

| Message / Situation | Meaning | What To Do |
|---|---|---|
| "Select a supplier" (New Payable) | You tried to save a payable without choosing who it's for | Pick a supplier from the list, then save again |
| "Enter a valid total amount" (New Payable) | The amount is blank, zero, or negative | Enter the bill's actual total, greater than ₱0.00 |
| "A reason is required to place a supplier on payment hold" | You clicked Place On Payment Hold with an empty reason box | Type a short reason so anyone who later sees the "ON HOLD" badge knows why |
| "Select a due date" (Edit Due Date) | You tried to save without picking a new date | Pick a date on the calendar, then click Save |
| "Bank account, cheque number, cheque date, and amount are required" (Issue Outbound Cheque) | One of these four required fields is still empty | Fill in all four before issuing |
| "Select a supplier for a supplier payment cheque" | Purpose is set to Supplier Bill Payment but no supplier is chosen | Pick the supplier this cheque is paying |
| "Select an expense category for this cheque" | Purpose is Loan Payment, Rent, or Other Expense, and no category was chosen | Pick the matching expense category |
| "Payee is required" | The cheque has no payee name (usually only possible for non-supplier purposes) | Type who the cheque is made out to |
| "Add at least one item" (Attach Items) | You clicked Attach & Receive Stock with no lines added | Search for and add at least one part before submitting |
| "Access Denied" on the Accounts Payable page | Your account doesn't have permission to view Accounts Payable | Ask a manager or admin to grant you access — nothing was broken or lost |

## Related Modules

- [Cheques & Treasury](./cheques_and_treasury_manual.md) — cheque issuance, clearing, bouncing, and voiding (reached via the **Outbound Cheques & Treasury** button on this page; also covers bank account setup and print templates)
- [Purchasing & Goods Receipt](./purchasing_and_goods_receipt_manual.md) — the normal path for receiving stock, which can also generate payables automatically

## Advanced Reference (optional)

N/A
