---
module: Business Analytics
page_component: AnalyticsPage.jsx
audience: Owner, Manager
verified_against: v2.6.2.1
last_updated: 2026-09-08
---

# Business Analytics

> **At a Glance**
> - **What it's for:** Seeing how the business is doing this period, and against the period before it.
> - **Who uses it:** Owner and Managers.
> - **You'll mostly come here to:** Check the month against the last one, and see where the money is sitting.

## Overview

Business Analytics answers questions about how the business is going: is revenue up or down, what is
selling, how much profit you are actually making, and how much stock is not moving. Reporting gives
you rows to export; Analytics gives you the shape of the business and the comparison. The two read
the same records — neither changes the other.

Every figure on this page also tells you how much of the underlying data it could actually measure.
That is not a disclaimer; it is the most important thing on the page, and the Key Concepts section
below explains why.

## Key Concepts

**Period.** Every board has one date range, chosen from the dropdown at the top ("Last 30 days",
"This month", and so on). Every figure on the page describes that range — except the four marked
*As of now*, explained below.

**As of now.** A/R Outstanding, Inventory Value, Dead Stock Value and Stocked Parts Without a Cost
describe what is true right now, not what happened during the period. Changing the date range does
not change them, and the tile says so. They are a photograph, not a summary.

**Compare with the previous period.** When the tick box is on, each figure also shows what it was in
the equally long stretch of time immediately before, and the change between the two. The comparison
is always written out — "vs previous 30 days" — so you never have to work out what it is comparing
against. If there is no earlier data to compare with, the tile says "No comparable earlier period"
rather than showing a change.

**Cost coverage.** Most parts in the system were created without a cost, so the sales lines that
reference them have no cost recorded either. Profit can only be worked out for a sale where the cost
is known. So every profit and margin figure here is measured over just those sales, and states what
share that was — for example, *"Measured on 11.5% of the data"*. A 36.5% margin measured on 11.5% of
sales is a real margin on a real slice of the business, not an estimate of the whole. If nothing in
the period has a cost recorded, the tile says **No cost data** and shows no number, because "we do
not know" and "we made nothing" are very different statements.

**Dead stock.** Stock you are holding for parts that have not sold in the last 180 days, valued at
what it cost you. Parts that have never sold are included. This is money already spent that is not
coming back through the counter.

**Not recorded yet.** Some figures — Net Profit, for one — need modules the business is not using
yet. Rather than show a confident zero, those tiles say the data is not being recorded. They start
working on their own once it is; nobody has to switch them on.

### Key Calculations

- **Net Revenue = Gross Revenue − Refunds** (₱720,000 − ₱6,900 = ₱713,100). Each is counted in the
  period it happened in: a refund raised in September against an August sale lands in September.
  That is correct, but it means a big refund can pull a month down without any drop in selling —
  which is why the tile shows the two parts underneath the total.
- **Gross Profit = Costed Revenue − Cost of Goods Sold**, counting only sales lines with a recorded
  cost (₱74,400 − ₱46,959 = ₱27,441).
- **Gross Margin = Gross Profit ÷ Costed Revenue** (₱27,441 ÷ ₱74,400 = 36.9%). The division is by
  *costed* revenue, not by all revenue. Dividing by all revenue would quietly water the margin down
  by the share of sales with no cost recorded, and report a margin far lower than the one you are
  actually making.
- **Average Ticket = Gross Revenue ÷ number of invoices** (₱720,000 ÷ 248 = ₱2,903). Gross, not net:
  a refund reverses a sale, it does not make the original sale smaller.
- **Refund Rate = Refunds ÷ Gross Revenue** (₱6,900 ÷ ₱720,000 = 1.0%).

## How To — Check How the Period Is Going

*Why this matters:* This is the everyday use of the page — one look that tells you whether the
business is ahead or behind, and by how much.

*Precision:* These steps are a normal default; nothing here changes any record, so explore freely.

1. Open **Analytics** from the sidebar, under **System & Analytics**.
2. Pick a range from the dropdown at the top — it opens on **Last 30 days**.
3. Leave **Compare with the previous period** ticked. Every figure that can be compared now shows
   the change beneath it, in words.
4. Read **Net Revenue** first — it is the headline, with the gross and refund figures beneath it.
5. **Revenue over time** shows the same measure day by day, with the previous period behind it as a
   dashed grey line, so you can see whether a change is a trend or a single busy day.

**Example:** On **Last 30 days**, Net Revenue reads ₱713K, down ₱257,911.58 (−26.6%) vs previous
30 days, with "₱720K gross revenue − ₱6.9K refunds" underneath. Invoices are down 51.2% while
Average Ticket is up 46.2% — fewer sales, each larger. That is a different story from a general
slowdown, and the two tiles together tell you which one you are looking at.

## How To — Read a Profit or Margin Figure Honestly

*Why this matters:* Profit here is deliberately understated rather than guessed. Knowing how to read
the coverage line is the difference between using this page and being misled by it.

*Precision:* Follow this exactly before acting on any margin figure.

1. Read the number on the **Gross Profit** or **Gross Margin** tile.
2. Read the line beneath it — for example *"Measured on 11.5% of the data"*.
3. Click the **ⓘ** next to that line. It states how many sales lines were excluded, and why.
4. Treat the margin percentage as trustworthy for the slice it measured, and the profit amount as a
   floor — the real total is higher, by an unknown amount, because uncosted sales contributed
   nothing to it.
5. To improve the figure, click **Fix the data**. That opens Cost Data Health, where parts without a
   cost can be corrected. Every part fixed there raises the coverage of every future period.

> ⚠️ Important — Do not compare a margin figure across two periods whose coverage differs a lot. A
> margin that moves from 36% to 41% while coverage moves from 15% to 3% has not told you the
> business got better; it has told you a different, smaller set of sales was measured.

## How To — See What Is Selling and What Is Not Moving

*Why this matters:* Revenue tells you the total; these tiles tell you where it came from and where
money is stuck.

*Precision:* Normal default; adjust the period to suit the question.

1. **Revenue by brand** ranks the largest brands for the period. Only the top few appear — the tile
   says so when there are more.
2. **Top products** lists the biggest sellers with their revenue, units, and gross profit. A dash in
   the **Gross Profit** column means that product's sales carried no recorded cost, so no profit can
   be worked out for it — it does not mean it made nothing.
3. **Dead Stock Value** and **Inventory Value** together tell you what share of your stock is not
   moving. Both are as of now.
4. **How much of this we can measure** breaks the period down and shows what share of each one
   carried cost data. Use it to see whether coverage is improving as parts get fixed.

**Example:** Revenue by brand shows MUSASHI at ₱178K, well ahead of CALTEX at ₱38.9K. In Top
Products, the MUSASHI oil seal shows ₱178,047.35 of revenue and a dash for Gross Profit — that one
product is a quarter of the period's revenue and the system cannot say what it cost. That is the
first part worth fixing in Cost Data Health.

## How To — Export a Tile

*Why this matters:* For sharing with a bookkeeper or working a list offline.

*Precision:* Normal default.

1. Click the **☰** in the top-right of any chart or table tile.
2. Choose **Export CSV**. The file downloads with the rows behind the tile, plus a coverage column
   so the figures cannot be read out of context later.

> 📝 Note — Exporting needs the **Export Analytics Data** permission. If the option is missing, ask
> an administrator.

## How To — Refresh a Figure

*Why this matters:* Figures are held briefly so a board loads quickly. At a busy counter you may
want the very latest.

*Precision:* Normal default.

1. Look at the bottom of the tile. If it says **As of 40s ago**, the figure is being reused.
2. Click **Refresh** on that line, or **Refresh** in the **☰** menu, to recalculate it now.

## Field Reference

| Field/Control | Description | Notes |
|---|---|---|
| Period dropdown | The date range every figure on the board describes | Your choice is remembered on this device |
| Compare with the previous period | Adds the equally long stretch immediately before, and the change | Off for *As of now* figures, which have no period |
| Net Revenue | Gross revenue minus refunds, each in its own period | Shows its two parts underneath |
| Gross Profit | Revenue minus cost, on sales with a recorded cost only | Always read with its coverage line |
| Gross Margin | Gross profit as a share of costed revenue | Not a share of all revenue — see Key Concepts |
| Invoices | Number of invoices issued in the period | Cancelled invoices excluded |
| Average Ticket | Gross revenue divided by invoices | Mostly walk-in counter sales, so this is a counter average |
| A/R Outstanding | What customers owe right now, from the A/R ledger | As of now; the date range does not affect it |
| Inventory Value | Stock on hand at weighted average cost | Understated by parts with no cost — see its coverage line |
| Dead Stock Value | Stock on hand for parts with no sale in 180 days | Includes parts never sold |
| Stocked Parts Without a Cost | Parts holding stock with no cost recorded | Click through to fix them |
| Net Profit | Gross profit less operating costs | Shows *Not recorded yet* until Expenses and Payroll are in use |
| **ⓘ** | Explains the figure in plain language | Every tile and every coverage line has one |
| **☰** | Refresh, Export CSV, and Open in page | Options vary by tile |

## Common Errors & What They Mean

| Message / Situation | Meaning | What To Do |
|---|---|---|
| **No cost data for this period** | Nothing sold in this period carried a recorded cost, so profit cannot be worked out at all | Widen the period, or click **Fix the data** to add costs in Cost Data Health |
| **Measured on 11.5% of the data** | The figure is real, but covers only that share of sales | Read the ⓘ, and treat the profit amount as a floor |
| **No comparable earlier period** | There is no data in the stretch before this one | Normal for the earliest months; pick a shorter range |
| **Not recorded yet** | The figure needs a module the business is not using | Nothing to do — it appears on its own once that module carries data |
| A dash (—) in a table cell | That row carried no recorded cost, so the figure could not be worked out | Not a zero. Fix the part's cost to make it appear |
| **Showing the top rows only** | There are more rows than the tile lists | Export the tile to CSV to see them all |
| **This tile failed** | That one figure could not be loaded; the rest of the board is fine | Click **Retry**. If it keeps failing, tell an administrator |
| **That query took too long** | The range asked for was too large to answer | Pick a shorter period |
| **Analytics is busy right now** | Several people are loading boards at once | Wait a few seconds and try again — this protects the till |
| The **Analytics** item is missing from the sidebar | Your account does not have the **View the Business Analytics boards** permission | Ask an administrator |

## Related Modules

- [Reporting](./reporting_manual.md) — the same records as exportable tables
- [Inventory & Parts](./inventory_and_parts_manual.md) — Cost Data Health, where missing costs are fixed
- [Accounts Receivable](./accounts_receivable_manual.md) — the ledger behind A/R Outstanding
- [Settings & Setup](./settings_and_setup_manual.md) — the Analytics settings tab and permissions

## Advanced Reference

**Why this page can disagree with an old Reporting export.** Two reasons, both deliberate.

First, profit. Until recently both pages subtracted cost without excluding sales where no cost was
recorded, which reported the whole sale price as profit and overstated a year's profit by roughly
₱8.9M. Both pages now exclude those sales. An export taken before that correction will show a far
larger profit figure, and it was wrong.

Second, revenue. A few hundred of the oldest invoices were never given a separate before-VAT total
when the tax fields were added. Reporting leaves those out of its gross sales figure; Analytics
falls back to the invoice total for them, since those invoices record no VAT. Analytics therefore
reports slightly more revenue than Reporting over ranges that include them, and the difference is
the value of those old invoices — not a miscount on either side.

**Refunds.** A refund belongs to the period the credit note was raised in, never the period of the
sale it reverses. This matters because tax returns are filed per period: moving a refund back into
an already-filed period would restate a return that has been submitted.

**Days Sales Outstanding**, when it appears, is measured over credit sales only. Nearly all sales
here are walk-in cash, and counting those would drag the figure towards zero and hide a genuine
collection problem in the credit book.
