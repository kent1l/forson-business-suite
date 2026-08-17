---
module: Invoicing & Statements
page_component: InvoicingPage.jsx, SoaGenPage.jsx
audience: Cashier, Accounting, Manager
verified_against: c38bc86 (2026-08-11)
last_updated: 2026-08-17
---

# Invoicing & Statements

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
> - **What it's for:** Bill a customer for parts sold on credit or on the spot, and produce printable Statements of Account (SOA) summarizing what a customer owes.
> - **Who uses it:** Cashiers and Accounting staff.
> - **You'll mostly come here to:** Post a new invoice for a customer, and generate a batch of Statements of Account for customers with outstanding balances.

## Overview

The **New Invoice** screen is where you bill a customer for parts — add the items they're buying, apply tax, and post the invoice so it's recorded against their account. The **Statement of Account Batch Engine** is a separate utility that turns customer and transaction data into printable/downloadable PDF statements, so Accounting can send customers a summary of their charges, payments, and running balance.

## Key Concepts

- **Invoice**: A billing record for parts sold to a customer. Once posted, it either reduces the customer's cash/change owed (if paid at time of sale) or adds to their Accounts Receivable balance (if sold on credit/terms).
- **On Account / Payment Terms**: Selling on terms means the customer takes the goods now and pays later, within a set number of days (e.g. "30 Days"). "Due on Receipt" means payment is expected immediately — no credit extended.
- **Walk-In customer**: A generic, unregistered customer. Walk-In customers can only be invoiced with immediate payment (Due on Receipt); they cannot be given payment terms.
- **Tax-inclusive vs. tax-exclusive pricing**: A line item's price can already include tax ("tax-inclusive") or have tax added on top ("tax-exclusive"). The invoice screen handles both and shows you which lines are tax-inclusive.
- **Statement of Account (SOA)**: A per-customer PDF document listing their invoices, payments, and running balance over a date range — what you'd send a customer who asks "what do I currently owe you?"
- **Physical Receipt No.**: The number on your pre-printed paper receipt/invoice book, entered here so the system record matches the paper copy the customer receives.

### Key Calculations (if applicable)

**Line Total = (Quantity × Sale Price) − Discount Amount**
Example: 4 units at ₱280.00 each, with a ₱20.00 discount → (4 × ₱280.00) − ₱20.00 = **₱1,100.00**.

**For a tax-exclusive line** (the normal case — tax is added on top of the price):
**Line Tax = Line Total × Tax Rate**
Example: ₱1,100.00 line total at a 12% VAT rate → ₱1,100.00 × 0.12 = **₱132.00** tax.

**For a tax-inclusive line** (price already includes tax), the system backs the tax out of the price instead of adding it:
**Tax-Exclusive Base = Line Total ÷ (1 + Tax Rate)**, then **Tax = Line Total − Tax-Exclusive Base**
Example: a ₱1,120.00 tax-inclusive line total at 12% VAT → ₱1,120.00 ÷ 1.12 = ₱1,000.00 base, so tax = ₱1,120.00 − ₱1,000.00 = **₱120.00**.

**Invoice Subtotal** = sum of every line's tax-exclusive base.
**Invoice Tax** = sum of every line's tax.
**Invoice Total = Subtotal + Tax**

Worked example — an invoice with two lines, both taxed at 12% VAT, neither tax-inclusive:
- Line 1: 4 × ₱280.00 − ₱20.00 discount = ₱1,100.00 → tax = ₱1,100.00 × 0.12 = ₱132.00
- Line 2: 1 × ₱500.00 = ₱500.00 → tax = ₱500.00 × 0.12 = ₱60.00

**Subtotal** = ₱1,100.00 + ₱500.00 = **₱1,600.00**
**Tax** = ₱132.00 + ₱60.00 = **₱192.00**
**Total** = ₱1,600.00 + ₱192.00 = **₱1,792.00**

> 📝 Note — If any line on the invoice uses tax-inclusive pricing, the totals panel adds an extra line, **Items Total (Entered):**, showing the raw entered amount before tax was backed out, alongside **Net Subtotal (Ex Tax):** — so you can see both the sticker price and the tax-exclusive figure the books use.

## How To — Post a New Invoice

*Why this matters:* Posting an invoice is how a sale of parts gets billed to a customer and recorded in the system. Once posted, it affects the customer's balance and the store's books — it's not a draft you can freely edit afterward.

*Precision:* **Posting an invoice is precision-required — it hits the customer's Accounts Receivable ledger.** Follow the customer, tax rate, payment method/terms, and line-item entry steps exactly. The order you click things in otherwise (e.g. searching for parts before or after picking a customer) is a flexible default — do what's convenient.

1. Go to **New Invoice**.
2. Under **Customer**, select the customer from the dropdown, or click the **+** button next to it to add a new customer on the spot (opens the **Add New Customer** form).
   - If the selected customer has an outstanding balance, you'll see it under the dropdown as **Outstanding Balance: ₱X / Credit Limit: ₱Y**. If the balance exceeds the limit, an **Over Limit!** badge appears — check with a supervisor before proceeding.
3. Under **Tax Rate**, select which tax rate applies to this invoice (e.g. `VAT (12.00%)`). This becomes the default tax rate for lines that don't specify their own.
4. Search for parts to bill using the **Add Items** search box (search by part name, SKU, or application). Click a result to add it to the invoice. Adding the same part twice increases its quantity by 1 instead of creating a duplicate line.
   - If the part doesn't exist yet, click **New Part** to add it, which also adds it to the invoice automatically once saved.
5. For each line in the invoice table, adjust **Quantity** and **Sale Price** as needed. **Line Total** recalculates automatically. To remove a line, click the trash icon at the end of the row.
6. Set **Payment Method** (e.g. Cash, GCash) if your store has split payments disabled, or leave it — if split payments are enabled, you'll be prompted for payment details after clicking Post Invoice instead.
7. Enter the **Physical Receipt No.** matching your paper receipt book, if your store requires one.
8. Set **Payment Terms**: pick a common option from the dropdown (**Due on Receipt** or a number of days like **30 Days**), or choose **Custom...** and type a day count in the field next to it.
   - ⚠️ **Important** — Walk-In customers can only be invoiced **Due on Receipt**. Selecting payment terms greater than 0 days for a Walk-In customer blocks the post with an error.
9. Review the totals panel (**Subtotal**, **Tax**, **Total**) at the bottom.
10. Click **Post Invoice**.

**Example:** You're invoicing customer **Juan Dela Cruz** for 4 units of a brake pad at ₱280.00 each (₱20.00 discount) and 1 unit of a filter at ₱500.00, both taxed at 12% VAT, on **30 Days** terms, with Physical Receipt No. `SI-4521`. The totals panel shows **Subtotal: ₱1,600.00**, **Tax: ₱192.00**, **Total: ₱1,792.00**. Clicking **Post Invoice** creates the invoice and adds ₱1,792.00 to Juan's Accounts Receivable balance, due in 30 days.

> ⚠️ Important — If a tax calculation looks abnormal (for example, an effective tax rate over 100%, or the totals don't reconcile with the entered line amounts), a **Tax Calculation Warning** banner appears above the totals. Don't post the invoice while this warning is showing — double-check the tax rate and line prices first.

## How To — Generate a Statement of Account (SOA)

*Why this matters:* A Statement of Account is what you hand or email a customer to show everything they've been charged and everything they've paid over a period, plus their running balance — the standard document for collections and account reconciliation.

*Precision:* This is a flexible, self-service workflow — you control the exact date range and which customers to include. The one exact requirement is the CSV file layout (see Field Reference), since the tool reads the files' column headers literally.

1. Go to the **Statement of Account Batch Engine** page.
2. Under **1. Customer Registry (customers.csv)**, click the upload box and choose your customer list file. If you don't already have one in the right format, click **Download Sample customers.csv** for a template.
3. Under **2. Consolidated Ledger (transactions.csv)**, upload your transaction ledger file the same way. Click **Download Sample transactions.csv** if you need the template.
4. Under **Statement Settings**, set:
   - **Statement Date** — the date printed on the statement (defaults to today).
   - **Period Start Date** / **Period End Date** — the date range of transactions to include (defaults to the 1st of the current month through today).
5. Click **Validate & Parse Files**. The tool reads both CSVs and shows a **Validated Summary** table listing every customer found, with transaction count, **Total Charged**, **Total Paid**, and **Closing Balance**.
6. Review the table. Every customer is selected by default (checkbox column) — uncheck any you don't want a statement for, or use the header checkbox to select/deselect all.
7. Click **Generate Selected Statements (N)** to produce PDF statements for every checked customer as a single downloadable ZIP file, or click **Download PDF** on an individual row to generate just that one customer's statement.

**Example:** You upload `customers.csv` and `transactions.csv` covering August 2026, set **Period Start Date** to `2026-08-01` and **Period End Date** to `2026-08-31`, and click **Validate & Parse Files**. The preview shows customer `CUST-101` (Acme Corp) with **Total Charged: ₱12,000.00**, **Total Paid: ₱4,000.00**, **Closing Balance: ₱8,000.00**. Clicking **Generate Selected Statements (2)** downloads a ZIP containing PDF statements for both customers shown in the preview.

> 📝 Note — This tool works entirely from the uploaded CSV files, in memory. It does not read live invoices from the system and does not write anything back to the database — it's a standalone reconciliation/statement utility, separate from the invoices you post on the **New Invoice** page.

## Field Reference

| Field/Control | Description | Notes |
|---|---|---|
| Customer | The customer being billed. | Required to post. Use the **+** button to add a new customer without leaving the page. |
| Tax Rate | The default tax rate applied to invoice lines. | Defaults to whichever tax rate is marked default in Settings, if one exists. |
| Payment Method | How the customer is paying (Cash, GCash, etc.). | Only shown when split payments are disabled for your store. Choosing **Cash** marks the full total as paid immediately. |
| Physical Receipt No. | The number from your pre-printed receipt book. | Normalized automatically (e.g. `si 4521` becomes `SI-4521`). Must be unique — a duplicate is rejected. |
| Payment Terms | Number of days before the invoice is due. | **Due on Receipt** = 0 days. Walk-In customers are restricted to 0 days. |
| Add Items (search box) | Searches parts by name, SKU, or application. | Click a result to add it as a line; adding an existing line's part again just increases its quantity. |
| Quantity / Sale Price (per line) | Editable per line item. | Line Total recalculates live as you type. |
| Subtotal / Tax / Total | Computed totals for the whole invoice. | See Key Calculations above. |
| Statement Date | Date printed on the generated SOA PDF. | Defaults to today. |
| Period Start Date / Period End Date | Date range of transactions included in the SOA. | Defaults to the 1st of the current month through today. |
| customers.csv | Customer registry file for the SOA engine. | Expected columns: `CUSTOMER_ID, COMPANY_NAME, TIN, ADDRESS, PHONE, EMAIL, CREDIT_LIMIT, PAYMENT_TERMS, CREDIT_STATUS, WALLET_BALANCE`. |
| transactions.csv | Transaction ledger file for the SOA engine. | Expected columns: `CUSTOMER_ID, DATE, DUE_DATE, INVOICE#, PHYSICAL_RECEIPT#, DESCRIPTION, DEBIT, CREDIT, Note`. |

## Common Errors & What They Mean

| Message / Situation | Meaning | What To Do |
|---|---|---|
| "Please select a customer and add at least one item." | You clicked Post Invoice without picking a customer, or with no line items on the invoice. | Select a customer under **Customer** and add at least one part before posting — nothing has been saved yet. |
| "Payment terms other than COD are not allowed for Walk-In customers." | You tried to give a Walk-In customer payment terms longer than Due on Receipt. | Change **Payment Terms** to **Due on Receipt**, or select a registered customer instead if this sale is meant to be on credit. |
| "Please select a payment method." | Split payments are off and no **Payment Method** was chosen. | Pick a payment method from the dropdown, then click **Post Invoice** again. |
| "Physical Receipt No already exists." (or a 409 conflict on posting) | The receipt number you entered is already used on another invoice. | Double-check your paper receipt book against the system, correct the **Physical Receipt No.** field, and try again — no duplicate invoice was created. |
| Tax Calculation Warning banner above the totals | The system detected an unusual result while computing tax — an effective rate over 100%, or a mismatch between the entered line amounts and the recomposed subtotal + tax. | Don't post yet. Re-check the selected **Tax Rate** and each line's **Sale Price**/tax settings for a typo, then confirm the warning clears before posting. |
| "Please upload both files first." / "Please upload both files." (SOA engine) | You clicked **Validate & Parse Files** or **Generate Selected Statements** before uploading both `customers.csv` and `transactions.csv`. | Upload both files using the upload boxes, then retry. |
| "Please select at least one customer." (SOA engine) | You clicked **Generate Selected Statements** with every row unchecked. | Check at least one customer in the **Validated Summary** table, or use the header checkbox to select all. |
| "Failed to parse CSV files." | One of the uploaded files isn't a valid CSV, or its structure couldn't be read. | Compare your file against **Download Sample customers.csv** / **Download Sample transactions.csv** and re-export it with matching headers, then re-upload. |
| "Failed to generate statements. Check CSV layouts." | The files parsed for the preview, but statement generation failed on the server — usually a data-quality issue in a row (bad date, missing amount, etc.). | Check the **Validated Summary** table for rows that look off (blank name, zero transactions), fix the source file, and try again. |

## Related Modules

- [Accounts Receivable](./accounts_receivable_manual.md)
- [Sales History](./sales_history_manual.md)

## Advanced Reference (optional)

N/A
