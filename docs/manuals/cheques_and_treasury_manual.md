---
module: Cheques & Treasury
page_component: ChequesTreasuryPage.jsx
audience: Accounting/Treasury Staff, Accounts Payable Staff, Accounts Receivable Staff, Supervisor/Manager
verified_against: master branch, commit 5d772b8 (2026-08-17)
last_updated: 2026-08-17
---

# Cheques & Treasury

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
> - **What it's for:** Print cheques, track post-dated cheques (PDCs) from issue through bank clearance or bounce, manage the business's bank accounts, and review/approve cashier sales staged from POS Mobile.
> - **Who uses it:** Accounting/Treasury staff, Accounts Payable staff (outbound cheques), Accounts Receivable staff (customer PDCs), and supervisors/managers (staging approvals).
> - **You'll mostly come here to:** Print a batch of cheques, and mark a PDC as cleared or bounced on its maturity date.

## Overview

**Cheques & Treasury** is where the business prints physical cheques, tracks every cheque and
post-dated cheque (PDC) from the moment it's issued or received until it clears the bank (or
bounces), and manages the bank accounts cheques are drawn from. It also hosts the **Cashier
Staging Approval Desk**, where supervisors review and post sales transactions staged by cashiers
using POS Mobile. The module is organized into four tabs — **Print Cheques**, **Treasury Desk**,
**Bank Accounts**, and **Templates & Settings** — visible depending on your permissions.

> 📝 Note — the Cashier Staging Approval Desk lives on its own navigation entry ("Staged Sales"),
> not inside the Cheques & Treasury tab bar. It's covered here because it's part of the same
> cash-handling/approvals area of the app.

## Key Concepts

- **Bank preset** — a saved layout (field positions, date format, amount wording, paper size)
  that tells the system exactly where to print each piece of text on a specific bank's cheque
  stock. You need at least one bank preset before you can generate a cheque PDF.
- **Printer profile** — a saved offset (and feed type) that corrects for how your specific
  printer physically feeds and aligns cheque stock. Optional, but keeps alignment consistent
  across print runs.
- **Post-dated cheque (PDC)** — a cheque written with a future date on it. The system tracks
  PDCs separately from same-day payments because they can't be deposited/cashed until that date.
- **Inbound vs. outbound cheques** — *Inbound* cheques are ones customers give the business
  (tracked on the Treasury Desk's **Customer Cheques (Inbound / AR)** tab). *Outbound* cheques
  are ones the business writes to suppliers, for loans, rent, or other expenses (tracked on the
  **Outbound Cheques (Supplier / Loan / Rent / Other)** tab).
- **PDC Status (inbound)** — `RECEIVED`, `HELD_IN_SAFE`, `DEPOSITED`, `CLEARED`, `BOUNCED`. A
  cheque moves through these as it's received, vaulted, taken to the bank, and either honored or
  returned.
- **PDC Status (outbound)** — `ISSUED`, `HELD_FOR_RELEASE`, `DEPOSITED`, `CLEARED`, `BOUNCED`,
  `VOID`, `REPLACED`.
- **Maturity Status** — `FUTURE_PDC` (dated ahead, not yet actionable), `DUE_TODAY` (dated
  today — ready for bank action), `STALE_CHEQUE` (more than 6 months past its cheque date — most
  banks will no longer honor it).
- **Payment Hold / Credit Hold** — when an outbound or inbound cheque bounces, the system
  automatically places the supplier (Payment Hold) or customer (Credit Hold) on hold until the
  situation is resolved.
- **Void vs. Replace (outbound only)** — **Void** marks a cheque as spoiled/never issued; the
  cheque number is never reused, keeping the numbered book explainable to auditors. **Replace**
  issues a brand-new cheque for the same obligation (typically after a bounce or after a cheque
  goes stale), linked back to the original for a continuous audit trail.
- **Continuous printing queue** — cheques issued from the Treasury Desk (via **Issue Cheque**)
  that haven't been printed yet automatically appear in the **Print Cheques** queue, tagged with
  a bank icon, so treasury staff don't have to re-key them.

### Key Calculations

- **Print Queue Total = sum of the Amount column for every cheque currently in the Print Queue.**
  Example: three cheques for ₱1,200.00, ₱3,450.50, and ₱890.00 show a queue total of **₱5,540.50**.
- **Change (Cashier Staging Approval Desk) = Tendered Amount − Grand Total, shown only when
  positive.** Example: a staged sale totals ₱1,120.00 and the cashier recorded ₱1,200.00
  tendered → **Change = ₱1,200.00 − ₱1,120.00 = ₱80.00**.

## How To — Add a Bank Account

*Why this matters:* Bank Accounts are the business's own accounts — every outbound cheque is
drawn from one, and they can each be linked to a default print template so issuing a cheque can
auto-generate its PDF.

*Precision:* Account details (bank name, account number) should be exact — they're referenced on
every cheque issued from this account and in reconciliation. Opening balance and notes are
flexible fields you can adjust as needed.

1. Go to **Cheques & Treasury → Bank Accounts**.
2. Click **+ New Bank Account**.
3. Fill in **Account Name**, **Bank Name**, **Account Number**, **Currency**, and **Opening
   Balance**.
4. Optionally choose a **Default Cheque Print Template** — when set, issuing a cheque from this
   account auto-generates and opens the printable PDF. Leave it as **None — print manually from
   Cheque Printing** if you'd rather add cheques to the Print Cheques queue by hand.
5. Click **Save**.

**Example:** Create an account named `Operating Account` at `BDO`, account number
`001234567890`, currency `PHP`, opening balance `₱250,000.00`, linked to the `BDO Business
Cheque` print template.

> 📝 Note — you can **Deactivate** an account instead of deleting it (there's no delete button).
> Deactivated accounts stay in history but drop out of the active list when issuing new cheques.

## How To — Set Up a Bank Preset for Printing

*Why this matters:* A bank preset tells the PDF generator exactly where on the physical cheque
to print the date, payee, amount, and memo. Without one, you can't generate a cheque PDF at all.

*Precision:* Field coordinates (X/Y, in points) and font sizes must be tuned exactly to your
cheque stock — a preset that's off by even a few points will misprint onto the wrong part of the
cheque. This is a one-time-per-bank setup task; take your time and test-print before using it for
real cheques.

1. Go to **Cheques & Treasury → Templates & Settings**.
2. Under **Bank Presets**, click **Create Preset** (or select an existing preset and click
   **Duplicate** to start from a known-good layout).
3. On the **Layout** tab, set the bank preset name and fine-tune each field's **X**, **Y**, **Font
   Size**, and — for Payee, Amount in words, and Memo — **Max Width**, **Min Font**, and **Max
   Height** (all in points). Click **Save Bank Preset**.
4. On the **Date** tab, choose the output date format and **Date Mode** (**Single-line** or
   **Boxed date mode**, which prints `MMDDYYYY` with no separators into individual boxes) and set
   character/block spacing.
5. On the **Amount** tab, choose amount-words casing (**Title Case** or **UPPER CASE**) and the
   amount suffix (default `pesos`).
6. On the **Currency** tab, toggle **Show currency label** and set the symbol/label printed
   outside the amount box (e.g. `PHP`).
7. On the **Paper** tab, set paper width/height in inches. Recommended standardized size is
   **8" x 3"**.
8. On the **Text** tab, optionally enable filler characters (e.g. `***`) around the payee name
   and/or amount-in-words text — a common anti-fraud/anti-alteration convention on printed
   cheques.
9. On the **Calibration** tab, create or edit a **Printer Profile**: name it, pick a **Feed
   Type** (Native, or Letter Size with Center/Left/Right Feed if your printer rejects the custom
   8x3 size), set **Offset X/Y** in points, and optionally check **Set as default profile**. Click
   **Save Profile** (or **Create Profile**).

**Example:** Create a preset named `BDO Business Cheque`, 8" x 3" paper, boxed date mode, amount
words in Title Case with suffix `pesos`, currency label `PHP`, and a printer profile named
`Front Office Printer` with Offset X `2.5`, Offset Y `-1.0`, marked as default.

> 💡 Tip — use **Export Presets & Profiles** (Calibration tab) to back up or share a working
> configuration as a JSON file, and **Import Presets & Profiles** to load one onto another
> workstation.

## How To — Print Cheques (Single or Batch)

*Why this matters:* This is the working queue for turning cheque details into an actual printed,
bank-negotiable cheque — whether you're writing one cheque by hand-entry or printing a batch that
was issued from the Treasury Desk.

*Precision:* Payee name and amount must be exact — these are the two fields a bank checks against
your signature and register. Date, memo, and which rows you group into one print run are
flexible; adjust to fit your workflow.

1. Go to **Cheques & Treasury → Print Cheques**.
2. Under **Print Controls**, choose a **Bank preset** and, optionally, a **Printer profile**.
3. In the **Print Queue**, fill in **Date**, **Payee**, **Amount**, and **Memo** for each cheque.
   A new blank row appears automatically as you fill the last one. Cheques already issued from
   the Treasury Desk (tagged with a bank icon) appear here automatically and can't have their
   Date/Payee/Amount/Memo edited directly — remove one from the queue with the trash icon if you
   don't want to print it yet (it stays pending server-side), or edit it via Accounts Payable.
4. Optionally toggle **Save generated cheques to history** (on by default) and **Test print
   mode** (watermarks the PDF and skips saving to history — use this to check alignment on plain
   paper before committing to real cheque stock).
5. Click **Generate PDF**.
6. Review the **Confirm cheque batch** dialog — it lists every cheque, the count, and the total —
   then click **Confirm & Generate**.
7. The PDF opens in a new browser tab. Print it at **100% scale** — any other scale will
   misalign the text on the physical cheque.

**Example:** Queue two cheques — `2026-08-20`, payee `ABC Auto Parts Supply`, ₱15,750.00, memo
`Invoice INV-2026-000341`; and `2026-08-20`, payee `Juan Dela Cruz`, ₱4,200.00, memo `Reimbursement`
— using bank preset `BDO Business Cheque`. The queue total shows **₱19,950.00**. Click **Generate
PDF → Confirm & Generate**, then print the resulting 2-page PDF at 100% scale.

> ⚠️ Important — a cheque with status `VOID` or `REPLACED` can never be printed or reprinted from
> here. If you need a replacement cheque, issue one from the Treasury Desk's **Replace** action
> instead of trying to re-create it by hand.

> 📝 Note — click **View History** to search past cheque records by payee, memo, amount, or bank,
> filter by bank, and **Edit**, **Reprint**, or **Delete** any entry. Reprint is blocked for
> `VOID`/`REPLACED` cheques.

## How To — Issue an Outbound Cheque from the Treasury Desk

*Why this matters:* This is how the business writes a new cheque to a supplier, for a loan
payment, rent, or another expense, and gets it tracked in the outbound cheque register from day
one — including its eventual clearance or bounce.

*Precision:* Bank account, cheque number, cheque date, and amount must be exact — the cheque
number in particular must match what's physically written on the paper cheque, since it's the
audit trail. Reference number and memo are flexible/optional.

1. Go to **Cheques & Treasury → Treasury Desk**, switch to the **Outbound Cheques (Supplier /
   Loan / Rent / Other)** tab.
2. Click **+ Issue Cheque**.
3. Choose the **Bank Account** the cheque is drawn from. The **Cheque Number** field
   auto-suggests the next number for that account — it's editable, since the real sequence lives
   on the physical cheque book.
4. Set the **Cheque Date** and **Amount**.
5. Choose a **Purpose**: **Supplier Bill Payment**, **Loan Payment**, **Rent**, or **Other
   Expense**.
   - For **Supplier Bill Payment**, select the **Supplier** (required) and optionally check off
     specific bills under **Apply to Bills** to link the payment to them.
   - For any other purpose, select an **Expense Category** (required) and enter the **Payee**.
6. Optionally fill **Reference #** and **Memo**.
7. Click **Issue Cheque**.

**Example:** Issue cheque `0001245` dated `2026-08-25` for ₱22,000.00 from `Operating Account —
BDO`, purpose **Supplier Bill Payment**, supplier `ABC Auto Parts Supply`, applied to bill
`BILL-0089`.

> 📝 Note — if the selected bank account has a linked print template, the cheque is added to the
> **Print Cheques** queue automatically. If not, you'll get a reminder to link one in Bank
> Accounts before you can print it.

## How To — Verify a Cheque Cleared the Bank

*Why this matters:* Once a cheque's maturity date arrives and the bank honors it, this step
records that fact — it posts a `PAYMENT_SETTLED` entry to the ledger and updates the cash
balance. Until you do this, the system still treats the cheque as outstanding.

*Precision:* This step posts directly to the AR or AP ledger — always confirm the cheque/ref
number and amount shown in the confirmation dialog against your actual bank statement or deposit
slip before confirming. Don't mark a cheque cleared speculatively.

1. Go to **Cheques & Treasury → Treasury Desk**, and open the **Customer Cheques (Inbound / AR)**
   or **Outbound Cheques** tab as appropriate.
2. Find the cheque (use the search box, **Maturity** filter, or PDC status pills — `DUE_TODAY` is
   the fastest way to find cheques ready for bank action).
3. Click **Verify Clearance** (inbound) or **✓ Clear** (outbound).
4. In the **Verify Cheque Clearance** dialog, check the customer/payee, cheque/ref number, and
   amount match your bank record, then click **Confirm Clearance**.

**Example:** Customer `Dela Cruz Hardware` cheque `#0004521` for ₱8,500.00 shows `DUE_TODAY`.
After confirming it was honored at the bank, click **Verify Clearance → Confirm Clearance** — the
status becomes `CLEARED` and a `PAYMENT_SETTLED` entry posts to the customer's AR ledger.

## How To — Process a Bounced Cheque

*Why this matters:* When a bank returns a cheque (NSF, closed account, etc.), this reverses the
payment back onto the original invoices/bills and puts the customer/supplier on hold so no
further transactions rely on money that never actually arrived.

*Precision:* This is a ledger-reversing, hold-triggering action — follow it exactly. Enter the
real bounce reason and any bank penalty fee charged, since both are recorded permanently in the
cheque's audit history.

1. On the Treasury Desk, find the cheque and click **Mark Bounced** (inbound) or **⚠️ Bounce**
   (outbound). You can also **Report Bounce** on an already-`CLEARED` inbound cheque if the bank
   reverses it after the fact.
2. In the **Process Bounced Cheque (NSF)** dialog, review the automated-reversal warning — it
   will reverse the amount onto open invoices/bills, post a `PDC_BOUNCED_REVERSAL` ledger entry,
   and place the customer on **Credit Hold** (inbound) or the supplier on **Payment Hold**
   (outbound).
3. Enter the **Bounce Reason** (defaults to `NSF / Insufficient Funds`) and the **Bank Penalty
   Fee** if the bank charged one.
4. Click **Confirm Cheque Bounce**.

**Example:** Outbound cheque `#0001245` to `ABC Auto Parts Supply` for ₱22,000.00 bounces.
Bounce reason `NSF / Insufficient Funds`, bank penalty fee `₱0.00` (the default for outbound —
inbound defaults to `₱250.00` since that's the fee the business typically absorbs from its own
bank). Confirm — the supplier is placed on Payment Hold and the ₱22,000.00 reopens against its
original bill(s).

## How To — Re-deposit a Bounced Cheque

*Why this matters:* Sometimes a bounced cheque is worth presenting to the bank a second time
(e.g. the customer topped up their account). Re-depositing restarts the clearance cycle without
losing the cheque's bounce history.

*Precision:* The re-deposit notes and whether to lift the hold are judgment calls for the
treasury/AR or AP staff handling the account — use your knowledge of the situation.

1. On a `BOUNCED` cheque, click **Re-deposit** (or **🔄 Re-deposit**).
2. Enter **Re-deposit Notes** describing the attempt.
3. Optionally check **Lift payment/credit hold upon re-deposit** if you're comfortable resuming
   normal transactions with this supplier/customer immediately.
4. Click **Confirm Re-deposit**.

**Example:** Customer cheque `#0004521` bounced for NSF. After the customer confirms funds are
now available, re-deposit with notes `Re-depositing cheque for bank clearance attempt #2` and
leave the credit hold in place until it actually clears.

## How To — Void or Replace an Outbound Cheque

*Why this matters:* Void and Replace are the two ways to retire an outbound cheque that can't be
used as originally issued — a writing mistake, misprint, repeated bounce, or a cheque that's gone
stale. Both keep the cheque-number sequence explainable for audits instead of silently deleting
records.

*Precision:* Void and Replace both require a reason/new details — follow exactly. Never reuse a
voided cheque's number on a new cheque.

**Void** (cheque never handed over / spoiled):
1. On an `ISSUED` or `HELD_FOR_RELEASE` cheque, click **✕ Void**.
2. Enter a **Reason** (required, e.g. "Writing mistake, misprint").
3. Click **Confirm Void**.

**Replace** (issue a new cheque for the same obligation):
1. On a `BOUNCED` cheque, or a `STALE_CHEQUE`-maturity cheque that isn't already `CLEARED`,
   `VOID`, or `REPLACED`, click **⟳ Replace** (or **⟳ Replace (Stale)**).
2. Enter the **New Cheque Number** and **New Cheque Date** (both required), and an optional
   **Reason**.
3. Click **Issue Replacement**.

**Example:** Cheque `#0001199` to a landlord goes stale after sitting uncashed for 7 months.
Click **Replace (Stale)**, enter new cheque number `0001301`, new date `2026-08-24`, reason
`Bounced twice, gone stale`, and click **Issue Replacement** — the new cheque is linked back to
`#0001199` for the audit trail.

## How To — Reprint or Edit From Cheque History

*Why this matters:* Cheques get lost, smudged in the printer, or need a correction before the
bank sees them — history keeps every generated cheque searchable so you don't have to re-key it.

*Precision:* Reprinting produces a duplicate of a real financial instrument — only reprint when
you're sure the original was never actually handed to the payee, or you're knowingly issuing a
second copy for a legitimate reason.

1. On **Print Cheques**, click **View History**.
2. Search or filter by bank, then find the entry.
3. Click **Edit** to load it back into the Print Queue editor (choose **Overwrite** or **Append**
   if you already have rows in the editor), or click **Reprint** to regenerate the PDF directly
   from that record.
4. **Delete** removes the record from history (this does not un-print a cheque already handed
   out — it only removes the record).

**Example:** A printed cheque for `Juan Dela Cruz` jammed halfway through printing. Open **View
History**, search `Dela Cruz`, click **Reprint** to regenerate the same PDF and print it again.

> ⚠️ Important — **Reprint** and **Edit** are both disabled/blocked for cheques with status
> `VOID` or `REPLACED`.

## How To — Approve, Edit, or Reject a Staged Cashier Sale

*Why this matters:* Sales rung up on POS Mobile land here as staged transactions before they post
to the books — this is the checkpoint where a supervisor confirms pricing, the physical receipt
number, and payment details are correct before the sale becomes a permanent ledger record.

*Precision:* Approving posts the transaction permanently — check the physical receipt number,
customer, and tendered amount carefully before confirming. Editing/converting and rejecting are
recoverable; approving is not something to undo casually.

1. Open the **Cashier Staging Approval Desk** (Staged Sales in the main menu).
2. Use the **Pending Queue** / **Approved & Posted** / **Rejected** tabs to find the transaction,
   or search by staging ID, customer, or items.
3. Click a row to open **Review Staged Sale STG-\<id\>**.
4. Confirm or correct the **Customer**, **Physical Receipt Number (PRN)**, and **Tendered
   Amount** (change, if any, is calculated automatically).
5. Review the item lines and totals, then choose one:
   - **Approve & Post** — posts the transaction as-is.
   - **Edit / Convert to Invoice** — sends the transaction to the Invoicing page pre-filled, for
     when pricing, discounts, or line items need correction before posting.
   - **Reject Transaction** — opens a reason picker (**Pricing mismatch / Incorrect discounts**,
     **Customer signature missing**, **Incorrect tax category applied**, **Invalid payment
     authorization**, or **Other**) plus internal notes, then **Reject**.

**Example:** Staged sale `STG-4821` from cashier `M. Santos`, total ₱1,120.00, tendered
₱1,200.00 shows **Change: ₱80.00**. PRN reads correctly as `SI-1234`. Click **Approve & Post** —
the transaction moves to the **Approved & Posted** tab.

> 📝 Note — rejection notes are visible to the cashier, so write them clearly enough that they
> know what to fix and re-stage.

## Field Reference

**Bank Accounts**

| Field/Control | Description | Notes |
|---|---|---|
| Account Name | Internal label for the account | Required |
| Bank Name | Name of the bank | Required |
| Account Number | The account's actual bank number | Optional; printed as `—` if blank |
| Currency | Currency code | Defaults to `PHP` |
| Opening Balance | Starting balance for reconciliation | Defaults to `0` |
| Default Cheque Print Template | Bank preset auto-used when issuing from this account | Optional — leave as "None" to print manually |
| Notes | Free-text notes | Optional |
| Status | Active / Inactive | Toggle with **Activate**/**Deactivate**; inactive accounts are hidden from new-cheque issuance |

**Print Cheques — Print Queue row**

| Field/Control | Description | Notes |
|---|---|---|
| Date | Cheque date | Must be a valid date |
| Payee | Who the cheque is made out to | Required |
| Amount | Cheque amount in ₱ | Must be numeric; rounded to 2 decimals |
| Memo | Internal memo | Stored in history but not printed on the cheque |
| Bank preset | Which layout/template to print with | Required before generating a PDF |
| Printer profile | Physical alignment offset to apply | Optional |
| Save generated cheques to history | Persists the batch as searchable records | On by default |
| Test print mode | Watermarks the PDF, skips saving to history | Use to check alignment before real cheque stock |

**Issue Outbound Cheque**

| Field/Control | Description | Notes |
|---|---|---|
| Bank Account | Account the cheque is drawn from | Required |
| Cheque Number | Physical cheque number | Required; auto-suggested, editable |
| Cheque Date | Date on the cheque | Required |
| Amount (₱) | Cheque amount | Required |
| Purpose | Supplier Bill Payment / Loan Payment / Rent / Other Expense | Determines which fields below apply |
| Supplier | Supplier being paid | Required when Purpose is Supplier Bill Payment |
| Apply to Bills | Specific bills to settle | Optional, shown only for Supplier Bill Payment |
| Expense Category | Category the expense belongs to | Required when Purpose isn't Supplier Bill Payment |
| Payee | Who the cheque is made to | Required when Purpose isn't Supplier Bill Payment |
| Reference # | Optional cross-reference | Optional |
| Memo | Internal memo | Optional |

**Treasury Desk action dialogs**

| Field/Control | Description | Notes |
|---|---|---|
| Bounce Reason | Why the cheque was returned | Defaults to "NSF / Insufficient Funds" |
| Bank Penalty Fee (₱) | Fee the bank charged for the bounce | Defaults to ₱250.00 (inbound) / ₱0.00 (outbound) |
| Re-deposit Notes | Notes on the re-presentation attempt | Free text |
| Lift payment/credit hold upon re-deposit | Immediately resumes normal transactions | Off by default — use judgment |
| Void Reason | Why the cheque is being voided | Required |
| New Cheque Number / New Cheque Date | Details of the replacement cheque | Both required for Replace |
| Replace Reason | Why a replacement is being issued | Optional |

**Templates & Settings (bank preset)**

| Field/Control | Description | Notes |
|---|---|---|
| X / Y | Position of a field on the cheque, in points | Per field (Date, Payee, Amount in figures, Amount in words, Memo, Currency symbol) |
| Font Size / Max Width / Min Font / Max Height | Text sizing and shrink-to-fit/wrap behavior | Max Width+Min Font shrink single-line text; adding Max Height allows wrapping instead of cutting off |
| Date output format | How the date prints | MM-DD-YYYY, MM/dd/yyyy, dd/MM/yyyy, or MMM dd, yyyy |
| Date Mode | Single-line or Boxed (MMDDYYYY, no separators) | Boxed mode uses Char/Block Spacing |
| Amount words casing | Title Case or UPPER CASE | |
| Amount suffix | Word used for the currency in the amount-in-words line | Defaults to "pesos" |
| Show currency label / Symbol outside amount box | Whether/what currency label prints beside the amount box | e.g. "PHP" |
| Paper Width/Height (inches) | Physical cheque stock size | Recommended 8" x 3" |
| Filler (payee / amount-in-words) | Characters added at both ends of the text (e.g. `***`) | Anti-alteration convention |
| Printer profile: Feed Type | Native, or Letter Size Center/Left/Right Feed | Use Letter modes if your printer rejects custom 8x3 paper |
| Printer profile: Offset X/Y (pt) | Physical print alignment correction | |
| Set as default profile | Makes this the default used when none is explicitly chosen | |

## Common Errors & What They Mean

| Message / Situation | Meaning | What To Do |
|---|---|---|
| "Payee is required" | A row in the Print Queue (or the Issue Outbound Cheque form) is missing a payee name. | Fill in the Payee field before generating or issuing. |
| "Amount must be numeric" | The Amount field contains something that isn't a number. | Re-enter using digits only (e.g. `1500.00`). |
| "Due date is invalid" | The Date field couldn't be parsed. | Pick a valid date using the date picker. |
| "Select a bank preset first." | You tried to generate a PDF with no Bank preset chosen. | Choose one under Print Controls, or create one in Templates & Settings if none exist. |
| "Add at least one cheque line." | The Print Queue is empty. | Enter at least one cheque's details before generating. |
| "N queued cheque(s) were issued for a different bank preset. Remove them or switch to that preset before printing." | Cheques auto-queued from the Treasury Desk were issued against a different bank than the one currently selected — mixing presets in one PDF would misprint them. | Switch the Bank preset to match, or remove those rows and print them separately under their own preset. |
| "Cannot print a cheque with status VOID/REPLACED." | You tried to (re)print a cheque that's been voided or replaced — it should never be produced as a physical document again. | Nothing to fix here — this is working as intended. If you need a new cheque for the same purpose, use Replace on the Treasury Desk. |
| "Popup blocked. Allow popups for this site, then try again." | Your browser blocked the new tab the cheque PDF opens in. | Allow popups for this site in your browser settings and click Generate PDF again — nothing was lost. |
| Fallback PDF renderer warning | The system used a backup PDF engine because the primary one (pdf-lib) wasn't available. | The PDF still generated — just double-check alignment carefully before printing to real cheque stock. |
| "A void reason is required" | You tried to void a cheque without entering why. | Enter a short reason (e.g. "Writing mistake") and confirm again. |
| "New cheque number and date are required" | You tried to issue a replacement cheque without both fields filled in. | Fill in both the new cheque number and date, then confirm. |
| "Bank account, cheque number, cheque date, and amount are required" | The Issue Outbound Cheque form is missing one of its core fields. | Fill in all four before submitting. |
| "Select a supplier for a supplier payment cheque" | Purpose is set to Supplier Bill Payment but no supplier was chosen. | Pick a supplier from the dropdown. |
| "Select an expense category for this cheque" | Purpose is Loan Payment/Rent/Other Expense but no category was chosen. | Pick an expense category. |
| "No print template linked to this cheque's bank account. Link one in Bank Accounts, or print manually from Cheque Printing." | The bank account this cheque was issued from has no default print template. | Add a Default Cheque Print Template on that account in Bank Accounts, or add the cheque to the Print Cheques queue and pick a preset manually. |
| "Account name and bank name are required" | The New/Edit Bank Account form is missing required fields. | Fill in Account Name and Bank Name. |
| Nothing happens when clicking Delete on a template with only one preset left | The system keeps at least one bank preset available. | Create a second preset before deleting the one you no longer need. |

## Related Modules

- [Accounts Payable](./accounts_payable_manual.md)
- [Invoicing & Statements](./invoicing_and_statements_manual.md)
- [Point of Sale](./point_of_sale_manual.md)
- [Accounts Receivable](./accounts_receivable_manual.md)

## Advanced Reference (optional)

**Cheque layout coordinates.** Bank preset field positions (X/Y) are measured in points (1 point
= 1/72 inch) from the bottom-left corner of the cheque stock — the same convention used by most
PDF tools. If a field prints slightly off, nudge its X/Y a few points rather than guessing whole
inches; on an 8"x3" cheque, 10 points is roughly 1/7 inch.

**Printer profile offsets vs. bank preset coordinates.** These solve two different problems.
Bank preset X/Y positions are about *where on the cheque* a field belongs (fixed per bank, once
calibrated correctly). Printer profile Offset X/Y correct for *how your specific printer feeds
paper* — the same bank preset can need different offsets on two different office printers even
though the cheque layout itself hasn't changed. If cheques print correctly on one printer but
consistently shifted on another, adjust the profile offset, not the bank preset coordinates.

**Shrink-to-fit and wrapping.** For Payee, Amount in words, and Memo fields, if the text is wider
than **Max Width**, the renderer shrinks the font size down to **Min Font** before wrapping. It
only wraps onto a second line if **Max Height** is also set for that field — otherwise it stays
on a single line at the minimum font size, however tight that makes it.
