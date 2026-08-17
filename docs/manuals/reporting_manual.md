---
module: Reporting
page_component: ReportingPage.jsx
audience: Manager, Accounting, Inventory/Purchasing staff, Business Owner
verified_against: packages/web/src/pages/ReportingPage.jsx and packages/web/src/components/reports/*.jsx (branch docs/comprehensive-project-documentation-and-manual, 2026-08-17)
last_updated: 2026-08-17
---

# Reporting

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
> - **What it's for:** One page with eight ready-made reports covering sales, profit, refunds, and inventory — view them on screen or export to CSV for Excel/accounting.
> - **Who uses it:** Managers and owners (performance and profit), Accounting (sales and refunds), Inventory/Purchasing staff (stock valuation, low stock, movement).
> - **You'll mostly come here to:** Pull a **Sales Summary** or **Profitability by Product** report for a date range, and check **Low Stock** or **Inventory Valuation** before reordering.

## Overview

Reporting is the business's window into what has already happened: what sold, what it cost, what
was refunded, and what's sitting in the warehouse right now. Every report lives on one page as a set
of tabs — pick a tab, set your filters, and view the results on screen or export them as a CSV file.

## Key Concepts

- **Report tab** — each report is its own tab across the top of the page. Only one report is shown
  at a time; switching tabs does not remember filters from the previous tab.
- **Date range** — most reports (all except **Inventory Valuation** and **Low Stock**) are filtered
  by a **Start Date** and **End Date**. These default to today's date when you open the tab, so you
  must widen the range yourself to see more than one day.
- **View Report vs. Export CSV** — every filterable report has two buttons: **View Report** runs the
  report on screen, **Export CSV** downloads the same results as a `.csv` file you can open in Excel
  or attach to an email. They use the same filters — set your filters first, then choose either
  button.
- **Net vs. Gross** — "Net" in a report name (e.g. **Sales Summary (Net)**) means refunded amounts
  have already been backed out of the figures. If you need refund activity itself, use the
  **Refunds** report.

### Key Calculations

**Profit (Sales Summary) = Total Sales − Total Cost.** Example: if Total Sales for the day is
₱45,000.00 and Total Cost is ₱31,500.00, Profit shown on the summary card is ₱13,500.00.

**Total Profit (Profitability by Product) = Total Revenue − Total Cost**, calculated per item, then
listed line by line. Example: item ITM-00214 with Total Revenue ₱8,000.00 and Total Cost ₱5,200.00
shows Total Profit ₱2,800.00 on its row.

**Total Value (Inventory Valuation) = Stock on Hand × WAC.** WAC ("Weighted Average Cost") is the
item's blended average cost across all purchases, not the price of the most recent purchase.
Example: 40 units on hand at a WAC of ₱125.00 gives a Total Value of ₱5,000.00 for that row. The
**Grand Total Inventory Value** at the bottom of the report is the sum of every row's Total Value.

## How To — Run the Sales Summary Report

*Why this matters:* this is the fastest way to see total revenue, cost, and profit for a period, and
to drill into every line item that made up those totals.

*Precision:* this is a read-only report — there's nothing here that posts to the ledger, so feel
free to explore filters freely.

1. Open **Reports** and make sure the **Sales Summary (Net)** tab is selected (it's the default tab).
2. Set **Start Date** and **End Date**.
3. Click **View Report**. The summary cards — **Total Sales**, **Total Cost**, **Profit**, **Total
   Invoices** — update, and the table below lists every line item sold in the period with its Date,
   Invoice #, Item, and Total.
4. Click any column header (Date, Invoice #, Item, Total) to sort by that column.
5. To download the results instead, click **Export CSV**.

**Example:** Set Start Date `2026-08-01` and End Date `2026-08-17`, click **View Report**. The
summary shows Total Sales ₱312,400.00, Total Cost ₱219,600.00, Profit ₱92,800.00, Total Invoices 148.
Scrolling the table shows invoice `INV-2026-000842` with item "Brake Pad Set – Front" at ₱1,120.00.

## How To — Run the Profitability by Product Report

*Why this matters:* Sales Summary tells you overall profit; this report breaks profit down per
product so you can see which items are actually earning money and which are barely covering cost.

*Precision:* read-only report; filters can flex to whatever you're investigating.

1. Open the **Profitability by Product (Net)** tab.
2. Set **Start Date** and **End Date**.
3. Optionally narrow the results with **Brand** and/or **Group** — both default to "All Brands" /
   "All Groups" and support typing to search.
4. Click **View Report**. The table lists each item with Total Revenue, Total Cost, and Total Profit,
   sorted by Total Profit (highest first) by default. Click any column header to change the sort.
5. Click **Export CSV** to download.

**Example:** Filter Brand to "Bosch" for `2026-08-01` to `2026-08-17`. The top row might show
"Bosch Spark Plug (Set of 4)" with Total Revenue ₱18,400.00, Total Cost ₱11,040.00, Total Profit
₱7,360.00.

## How To — Run the Refunds Report

*Why this matters:* shows every refund (Credit Note) issued in a period, tied back to its original
invoice, so accounting can reconcile how much was returned to customers.

*Precision:* read-only report; can flex.

1. Open the **Refunds** tab.
2. Set **Start Date** and **End Date**, or use one of the quick-range buttons — **Today**,
   **Yesterday**, **Last 7 Days**, **Last 30 Days**, **This Month**, **Last Month** — to jump to a
   common range instantly instead of picking dates by hand.
3. The table updates automatically as soon as dates change (there's no separate "View Report"
   button on this tab) and lists Credit Note #, Original Invoice #, Date, Customer, and Amount.
4. Click any column header to sort.

> 📝 Note: this report has no CSV export button — view figures on screen or share the page, but you
> can't download this one as a file.

**Example:** Click **This Month**. A row shows Credit Note `CN-2026-000031` against original invoice
`INV-2026-000790`, customer "Maria Santos," dated 08/05/2026, Amount ₱450.00.

## How To — Run the Inventory Valuation Report

*Why this matters:* gives a snapshot of exactly how much money is tied up in current stock — useful
for balance-sheet reporting and for deciding whether to hold or move inventory.

*Precision:* read-only; there are no filters to set, so there's nothing to get wrong here.

1. Open the **Inventory Valuation** tab. The report loads automatically — every item currently
   tracked, with SKU, Item, Stock on Hand, WAC, and Total Value.
2. Click a column header to sort — for example, sort by **Total Value** (the default) to see your
   most capital-intensive items first.
3. Read the **Grand Total Inventory Value** row at the bottom of the table for the overall figure.
4. Click **Export CSV** at the top to download the full list.

**Example:** Sorted by Total Value descending, the top row might be SKU `BRK-00214`, "Brake Pad Set –
Front," Stock on Hand 320, WAC ₱125.00, Total Value ₱40,000.00.

## How To — Run the Top-Selling Products Report

*Why this matters:* identifies your best sellers for a period, by revenue or by quantity, so you
know what to keep stocked and what to feature.

*Precision:* read-only; can flex.

1. Open the **Top-Selling Products** tab.
2. Set **Start Date** and **End Date**.
3. Choose **Sort By**: **Revenue** or **Quantity**, depending on whether you want to rank by money
   earned or units moved.
4. Click **View Report**. The table lists SKU, Item Name, Qty Sold, and Total Revenue.
5. Click **Export CSV** to download.

**Example:** Sort By "Quantity" for `2026-08-01` to `2026-08-17`. The top row might show SKU
`OIL-00110`, "Engine Oil 4L – Synthetic," Qty Sold 512, Total Revenue ₱256,000.00.

## How To — Run the Low Stock Report

*Why this matters:* flags every item that has fallen to or below its reorder point, so purchasing
knows what to reorder before it runs out.

*Precision:* read-only; there are no filters — the report always shows the current live list.

1. Open the **Low Stock** tab. The report loads automatically and lists SKU, Item Name, Stock on
   Hand (shown in red), and Reorder Point for every item currently at or below its threshold.
2. Click a column header to sort — for example, sort by **Stock on Hand** (the default) to see the
   most urgent shortages first.
3. Click **Export CSV** to download the list, for example to attach to a purchase order request.

> 💡 Tip: an empty table here ("No items are currently low on stock.") is good news — it means
> nothing needs reordering right now.

**Example:** A row might show SKU `FLT-00087`, "Oil Filter – Standard," Stock on Hand 3 (in red),
Reorder Point 15 — signaling it needs restocking soon.

## How To — Run the Sales by Customer Report

*Why this matters:* rolls up sales per customer over a period, useful for spotting your top accounts
or checking one customer's purchase volume.

*Precision:* read-only; can flex.

1. Open the **Sales by Customer (Net)** tab.
2. Set **Start Date** and **End Date**.
3. Optionally narrow to one customer with the **Customer** search box (defaults to "All Customers").
4. Click **View Report**. The table lists Customer, Total Invoices, and Total Sales, sorted by Total
   Sales (highest first) by default.
5. Click **Export CSV** to download.

**Example:** Filter Customer to "Juan Dela Cruz" for `2026-08-01` to `2026-08-17`. The row shows
Total Invoices 6, Total Sales ₱24,300.00.

## How To — Run the Inventory Movement Report

*Why this matters:* shows a line-by-line audit trail of every stock movement (sales, receipts,
adjustments, etc.) for a period, including who recorded it and what document it's tied to — the
first place to look when a stock count doesn't match what the system expects.

*Precision:* read-only; can flex.

1. Open the **Inventory Movement** tab.
2. Set **Start Date** and **End Date**.
3. Optionally narrow to one item with the **Part** search box (defaults to "All Parts").
4. Click **View Report**. The table lists Date, Item, Type, Quantity (positive quantities in green,
   negative in red), Reference, and User — the staff member who recorded the transaction.
5. Click **Export CSV** to download.

**Example:** A row might show 08/12/2026 09:41 AM, "Brake Pad Set – Front," Type "Sale," Quantity
−4 (red), Reference `INV-2026-000842`, User "J. Reyes."

## Field Reference

| Field/Control | Description | Notes |
|---|---|---|
| **Start Date / End Date** | Date range filter, on every report except Inventory Valuation and Low Stock. | Defaults to today's date when you open the tab. Both must be filled in, or the report shows "Please select both a start and end date." |
| **View Report** | Runs the report on screen with the current filters. | Not present on Refunds (updates automatically) or Inventory Valuation/Low Stock (load automatically, no date filter). |
| **Export CSV** | Downloads the current report and filters as a `.csv` file. | Not available on the Refunds report. |
| **Brand / Group** (Profitability by Product) | Narrows results to one brand or product group. | Defaults to "All Brands" / "All Groups"; type to search. |
| **Customer** (Sales by Customer) | Narrows results to one customer. | Defaults to "All Customers"; type to search. |
| **Part** (Inventory Movement) | Narrows results to one item. | Defaults to "All Parts"; type to search. |
| **Sort By** (Top-Selling Products) | Ranks results by **Revenue** or **Quantity**. | Separate from column-header sorting, which re-orders the table client-side after loading. |
| **Date range shortcuts** (Refunds only) | One-click buttons: Today, Yesterday, Last 7 Days, Last 30 Days, This Month, Last Month. | Sets both Start Date and End Date at once. |
| Column headers (any report) | Click to sort the visible table by that column; click again to reverse direction. | Sorting is applied to the currently loaded page of results. |
| Pagination controls (bottom of every report) | Move between pages of results and change how many rows are shown per page. | N/A |

## Common Errors & What They Mean

| Message / Situation | Meaning | What To Do |
|---|---|---|
| "Please select both a start and end date." | You tried to run a report with one of the date fields empty. | Fill in both **Start Date** and **End Date**, then try again — no data was affected. |
| "Failed to generate report." | The report couldn't load, usually a temporary connection issue. | Wait a moment and click **View Report** again. If it keeps happening, let your system administrator know. |
| "No sales data for the selected period." / "No data to display." / "No refunds found for the selected period." | Your filters are correct, but there's genuinely nothing to show for that combination of date range/brand/customer/part. | Try a wider date range or fewer filters if you expected results. This is not an error — it's a valid empty result. |
| "No items are currently low on stock." | Every item is above its reorder point. | Nothing to do — this is the report telling you inventory is in good shape. |
| "Access Denied" on the whole Reports page | Your account doesn't have the **reports:view** permission. | Ask a manager or system administrator to grant you report access if you need it for your role. |

## Related Modules

- [Sales History](./sales_history_manual.md)
- [Inventory and Parts](./inventory_and_parts_manual.md)
- [Accounts Receivable](./accounts_receivable_manual.md)
- [Purchasing and Goods Receipt](./purchasing_and_goods_receipt_manual.md)

## Advanced Reference (optional)

N/A
