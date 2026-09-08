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
> - **You'll mostly come here to:** Check the month against the last one, see what is selling, and find out what needs reordering.
> - **Boards:** **Overview** (how are we doing), **Sales** (what sold, to whom, when), **Inventory** (what is on the shelf and what is about to run out), **Profitability** (where margin comes from), **Customers** (who the named accounts are and how much credit they have drawn), **Receivables & Cash** (who owes you and how old it is), **Data Trust** (how much of all this you can believe).

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

*Why this matters:* Revenue tells you the total; these tiles tell you where it came from.

*Precision:* Normal default; adjust the period to suit the question.

1. Open the **Sales** board.
2. **Revenue by brand** and **Revenue by group** rank the largest of each for the period.
3. **Top products** lists the biggest sellers with their revenue, units, and gross profit. A dash in
   the **Gross Profit** column means that product's sales carried no recorded cost, so no profit can
   be worked out for it — it does not mean it made nothing.
4. Click any column heading in a table to re-sort the rows on screen. Click it twice to reverse,
   three times to go back to the original ranking.
5. Click a bar or a row to narrow the whole board to it. Use **Clear filters** at the top to undo.

**Example:** Revenue by brand shows MUSASHI at ₱178K, well ahead of CALTEX at ₱38.9K. In Top
Products, the MUSASHI oil seal shows ₱178,047.35 of revenue and a dash for Gross Profit — that one
product is a quarter of the period's revenue and the system cannot say what it cost. That is the
first part worth fixing in Cost Data Health.

> ⚠️ Important — "Other" is not a brand. Where a chart or table shows an **Other** row, it is
> everything outside the top few added together, and the tile says how many things it stands for.
> It is there so the figures add up to the whole period rather than to whatever fitted on the
> chart — on this catalogue **Other** is often the biggest row, because there are more than 400
> brands and 700 groups. You cannot click into it, because it is not one thing.

## How To — Work Out When to Put a Second Person on the Counter

*Why this matters:* Staffing costs the same all day; takings do not.

*Precision:* Normal default. Use a long period — 90 days or more — so one unusual day does not
dominate the picture.

1. Open the **Sales** board and find **When the counter is busy**.
2. Each square is one hour of one weekday, with every week in the period added together. The darker
   the square, the more was taken in that hour.
3. Hover a square to read the exact figure and the number of invoices underneath the grid.

> 📝 Note — A **grey** square means nothing at all was sold in that hour. The **palest blue** means
> something was sold, but very little. They are drawn differently on purpose: "we were shut" and "we
> were open and nobody came" call for opposite decisions.

## How To — Find What Needs Reordering

*Why this matters:* An empty shelf on a part that sells steadily is a lost sale every week until it
is refilled.

*Precision:* High. Check the figures against the shelf before raising a purchase order.

1. Open the **Inventory** board. There is no date range on it — everything is the position as of now.
2. **Reorder first** lists the parts that sold on at least **three separate invoices in the last 90
   days** and now hold **under thirty days of cover** at that rate, or none at all.
3. The list is ranked by **Earned (90 days)** — the money those parts brought in — so the top of the
   list is what it costs you most to be out of.
4. Click any row to open that part on the Inventory page.

> ⚠️ Important — This is deliberately **not** the "below reorder point" flag. That flag currently
> fires on thousands of parts because their reorder points were never maintained, which is why
> nobody looks at it. This list is short because it only shows parts with real, repeated demand.

> 📝 Note — **Units Short** is how many units would bring the part back to thirty days of cover. It
> is a starting point, not a recommendation: it knows nothing about pack sizes, supplier minimums or
> lead times.

## How To — See What Stock Is Not Moving

*Why this matters:* Dead stock is money already spent that is not coming back through the counter.

*Precision:* Normal default.

1. Open the **Inventory** board.
2. **Dead Stock Value**, **Dead Stock Share** and **Dead Stock Lines** together say how much of the
   shelf has not sold in 180 days, and across how many parts. Parts never sold at all are included.
3. **Stock value by brand** and **Dead stock by brand** sit side by side. Read them together: a brand
   that is large in both is simply a big brand; one that is small on the left and large on the right
   is where buying went wrong.
4. Everything here is valued at weighted average cost, so parts with no recorded cost contribute
   nothing. Check the coverage line under each tile before acting on the figure.

## How To — Read the Insights Panel

*Why this matters:* It is the fastest way to see what changed and what needs doing, and knowing how
it works is what tells you how far to trust it.

*Precision:* Normal default. Treat each line as a pointer to a figure, not as the figure itself.

1. The panel sits above the tiles on each board, headed **What stands out**.
2. Each line says how serious it is in words — *Needs attention*, *Worth knowing*, *For information*
   — as well as by colour, and underneath it names the figures it was worked out from.
3. Click the link at the end of a line to go straight to the page or board that can do something
   about it.
4. Click **✕** to dismiss a line for now. It comes back when you change the period or reload.

> 📝 Note — **Nothing in this panel is written by an AI.** Each line is a fixed rule in the system:
> a condition, a threshold and a sentence with the numbers dropped into it. That is deliberate. A
> sentence is easier to believe than a number, so every one of them names the figures behind it and
> you can go and check them.

> ⚠️ Important — The panel stays quiet when it cannot be sure. If a period has no sales, or the
> period before it barely exists, it says nothing rather than reporting a percentage change that
> would be arithmetically correct and misleading. Silence here means "nothing worth claiming", not
> "everything is fine".

## How To — See Where Margin Actually Comes From

*Why this matters:* Total profit tells you the size; this tells you which products and brands earned
it, and which ones lost money.

*Precision:* High for the loss list — check the cost before repricing anything.

1. Open the **Profitability** board. **Read the first tile first**: it says what share of your sales
   carried a recorded cost, and every other figure on the board is measured over that share and no
   more.
2. **Where the revenue sits, by margin** groups your sales by how much each one made. The
   *(No cost recorded)* band is normally the largest — that is revenue whose margin is unknown, not
   revenue that made nothing.
3. **Sold at a loss** lists products that cost more than they sold for. Because these are measured
   on sales that *did* record a cost, the system is sure of them: a mispriced item, a cost entered
   in the wrong unit, or genuine clearance.
4. **Most profitable products** is the same information as the Profitability by Product report, from
   the same definitions — the two cannot disagree.

## How To — Check How Much of This You Can Believe

*Why this matters:* Profit and margin here describe the part of the business that recorded a cost.
This board says how big that part is, whether it is growing, and what to fix to grow it.

*Precision:* Normal default. It opens on the last twelve months, because the question is whether
things are improving.

1. Open the **Data Trust** board.
2. **Cost Coverage** is the headline: the share of revenue carrying a recorded cost. **Is coverage
   improving?** plots it over time. A flat line means the cleanup is not keeping up with new sales.
3. **Fix these parts first** ranks the parts whose missing costs leave the most revenue
   unmeasurable. Working down that list is the shortest route to figures worth trusting.
4. **Parts With Negative Stock** counts parts recorded as holding less than nothing, which is
   impossible — each is a receipt never entered, a sale entered twice, or an adjustment the wrong
   way round. Click through to Stock Reconciliation.
5. **Why this page and Reports can differ** is not a fault list. It counts the two places where a
   figure was never stored and Analytics falls back to one that is exact for those records — which
   is why Analytics reports slightly more revenue, and considerably more refunds, than the Reports
   page over the same dates.

## How To — See Who Your Real Customers Are

*Why this matters:* Almost every invoice in the system goes to one walk-in record, so a plain
"revenue per customer" describes the queue at the counter rather than your customer book. The
Customers board takes the counter out, and only then divides.

*Precision:* Normal default. It opens on the last ninety days, because there are far fewer named
account invoices than counter sales and a thirty-day window is too thin to read.

> ⚠️ **One setting has to be filled in first.** Analytics cannot tell the walk-in record apart from a
> real account — it is a customer row like any other. Until an administrator enters its customer ID
> under **Settings → Analytics → Walk-in customer record**, the revenue half of this board says
> *Not recorded yet* and explains what is missing. It will not guess, because guessing wrong would
> make the page state something confident and false about who the business depends on. The credit
> tiles work either way.

1. Open the **Customers** board.
2. **Named Account Revenue** is the headline, and it is deliberately much smaller than the revenue on
   the Overview board. The difference is counter trade.
3. **Revenue concentration** ranks your accounts with a **Running** share beside them. Read down that
   column to find how few customers make up most of the book — that is your concentration risk.
   Everything below the twelfth account is added together into one **Other** row rather than cut off,
   so the running share reaches 100% and means it. This table cannot be re-sorted, because a running
   total only makes sense in the order it was added up in.
4. **Revenue by when the account was won** splits this period's revenue by the month each account
   first bought from you. It answers whether the customers you won a year ago are still buying.
5. **New Accounts** counts accounts whose first invoice ever falls inside the period. Over a
   twelve-month range almost every account counts as new, because the records only go back that far —
   the figure means something over a shorter window.
6. **Credit Drawn**, **Credit Extended** and **Accounts Over Their Limit** are positions as of now and
   do not move with the date picker. Most credit limits are the system default rather than a figure
   anyone decided on, so read **Credit Extended** as what the settings currently permit.

## How To — See Who Owes You and How Old It Is

*Why this matters:* Deciding who to chase, and knowing how much of what you are owed you can even
put an age on.

*Precision:* Normal default. Everything above the ledger section is a position as of now; only the
movement tiles change with the date range.

1. Open the **Receivables & Cash** board.
2. **Two figures lead the board, and they do not agree.** *Owed on Open Invoices* is every unsettled
   invoice, including those raised before the A/R module went live. *On the A/R Ledger* is the same
   question asked of the ledger, which only knows invoices since 19 August 2026. **Not on the Ledger**
   is the difference between them. Neither figure is wrong; quote *Owed on Open Invoices* as your
   total exposure. The gap shrinks on its own as the older invoices settle.
3. **How old is what we are owed** buckets the balances by age. *(No payment terms)* is a band of its
   own — an invoice with no due date can never become overdue however long it sits, so most of what
   you are owed will never appear in an overdue figure. That is why **Overdue Balance** and **Balance
   With No Terms** sit side by side.
4. **Who owes us** ranks accounts by what they owe, with the overdue portion and the age of their
   oldest invoice beside it. The rows below the fifteenth are added together, so the total at the
   bottom matches the figure at the top of the board. Click a row to open Accounts Receivable.
5. **What moved on the ledger** is the whole story of the receivable in one table: what was charged,
   what was collected, what was written off, and what was reversed. The movements add up to the change
   in the balance.
6. **Concessions Granted** and **Balances Written Down** are money that was invoiced and then agreed
   not to be collected. They are shown gross; **Adjustments Reversed** is separate rather than netted
   off either, because the ledger does not record which kind of adjustment a reversal cancels.
7. **Cheques in the pipeline** is what has been taken in and has not cleared the bank. *Bounced* means
   the balance is already back on the customer's account.

> 📝 Note — Anything to do with collection *over time* (Collected, Collected vs Charged, Days Sales
> Outstanding) is measured from the A/R ledger, which begins on 18 August 2026. Over a range that
> starts earlier it looks like a collapse in activity when the truth is that there is no ledger to
> read. Each of those tiles says so in its ⓘ.

## How To — Export a Tile

*Why this matters:* For sharing with a bookkeeper or working a list offline.

*Precision:* Normal default.

1. Click the **☰** in the top-right of any chart or table tile.
2. Choose **Export CSV**. The file downloads with the rows behind the tile, plus a coverage column
   so the figures cannot be read out of context later. Where the tile shows an **Other** row, the
   export contains it too, so the exported column still adds up to the period.

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
| Board tabs | Overview, Sales, Inventory, Profitability, Customers, Receivables & Cash, Data Trust | Tiles you have no permission for are not shown at all |
| Period dropdown | The date range every figure on the board describes | Your choice is remembered on this device; the Inventory board has none, because nothing on it moves with a date |
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
| Other | Everything outside the top few, added together | Says how many things it stands for; not clickable |
| Column headings in a table | Click to re-sort the rows on screen | Sorts only what is listed; it cannot fetch different rows |
| Parts to Reorder | Parts with repeat demand and under 30 days of cover | Not the "below reorder point" flag — see the how-to |
| Days of Cover | How long the stock lasts at the last 90 days' rate | Zero means the part is already out |
| Units Short | Units needed to reach thirty days of cover | Ignores pack sizes, minimums and lead times |
| Earned (90 days) | What those parts took in over the last 90 days | This is what the reorder list is ranked by |
| Discount Rate / Discounts Given | Discounts as a share of list price | Shows *Not recorded yet* until discounts are captured on sale lines |
| Cost Coverage | Share of revenue that carries a recorded cost | The most important figure in Analytics — everything about profit is measured over this share |
| Revenue We Cannot Measure | Revenue on sales with no recorded cost | The same gap in money rather than in percent |
| Margin band | Sales grouped by the margin they made | *(No cost recorded)* is a band of its own, not hidden rows |
| Parts With Negative Stock | Parts recorded as holding less than zero | Always a data fault; fix on Stock Reconciliation |
| What stands out | The insights panel | Fixed rules, never an AI; each line names the figures behind it |
| Named Account Revenue | Invoiced sales to named accounts, counter trade excluded | Much smaller than the Overview revenue, and meant to be |
| Running | A running share of the total, down the ranked rows | Only meaningful in the order shown, so that table cannot be re-sorted |
| Customer since | The month an account first bought from you | A fact about the customer, not about the date range |
| New Accounts | Accounts whose first invoice ever falls in this period | Over a twelve-month range nearly every account counts as new |
| Credit Drawn / Credit Extended | What accounts owe, against the limits they were granted | Most limits are the system default rather than a decision |
| Owed on Open Invoices | Every unsettled invoice, net of credit notes | The figure to quote as total exposure |
| On the A/R Ledger | The same question asked of the A/R ledger | Only knows invoices raised since 19 August 2026 |
| Not on the Ledger | The difference between the two figures above | Not an error in either — it is the size of the gap |
| Balance With No Terms | Owed on invoices with no due date | Can never appear as overdue, however old it gets |
| Oldest Overdue | Days past due on the most overdue open invoice | In a table, the **Other** row shows the oldest it folded, not a sum |
| Collected / Charged to Accounts | Money off and onto customer accounts in the period | Read from the A/R ledger, which begins 18 August 2026 |
| Concessions Granted / Written Down | Balances agreed not to be collected | Gross; reversals are counted separately |
| Cheques Not Yet Cleared | Customer cheques still in the pipeline | Held, deposited and bounced are all counted — none is cash yet |
| **☰** | Refresh, Export CSV, and Open in page | Options vary by tile |

## Common Errors & What They Mean

| Message / Situation | Meaning | What To Do |
|---|---|---|
| **No cost data for this period** | Nothing sold in this period carried a recorded cost, so profit cannot be worked out at all | Widen the period, or click **Fix the data** to add costs in Cost Data Health |
| **Measured on 11.5% of the data** | The figure is real, but covers only that share of sales | Read the ⓘ, and treat the profit amount as a floor |
| **No comparable earlier period** | There is no data in the stretch before this one | Normal for the earliest months; pick a shorter range |
| **Not recorded yet** | The figure needs a module the business is not using | Nothing to do — it appears on its own once that module carries data |
| **Analytics cannot tell counter trade from a named account…** | The walk-in customer record has not been identified | An administrator enters its customer ID under Settings → Analytics. The rest of the Customers board works meanwhile |
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
