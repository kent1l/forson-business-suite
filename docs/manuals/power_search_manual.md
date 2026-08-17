---
module: Power Search
page_component: PowerSearchPage.jsx
audience: Parts Staff, Inventory, Sales/Cashier, Purchasing, Anyone with Parts view access
verified_against: commit 22bce77 (2026-07-20)
last_updated: 2026-08-17
---

# Power Search

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
> - **What it's for:** Find any part instantly by SKU, name, part number, brand, or vehicle application, then drill into its stock, pricing, and cost detail.
> - **Who uses it:** Anyone with access to Parts (parts counter staff, cashiers, inventory, purchasing, managers).
> - **You'll mostly come here to:** Look up a part's current stock and price, or open a part to request an inventory audit.

## Overview

Power Search is the fastest way to find a part in the system without knowing exactly which field it's filed under. Type any part of what you know — a SKU, a brand, an OE part number, or even a vehicle it fits — and matching parts appear as you type.

## Key Concepts

- **SKU (Internal SKU):** The unique internal code Forson Business Suite assigns to a part. This is the most reliable single value to search on if you have it.
- **Part Number:** A manufacturer's or OE (Original Equipment) part number for the item. A single part can have several of these listed.
- **Application:** A vehicle (make, model, engine, and year range) that a part is known to fit — e.g. "Toyota Vios (2014-2018)". Searching an application shows every part that fits that vehicle.
- **Stock:** The quantity of the part currently on hand, shown as a number (can include fractional units for parts sold by weight or length).
- **WAC (Weighted Average Cost):** The part's average cost across all units currently in stock, recalculated as new stock comes in at different prices. Shown in the part detail view for cost reference.
- **Active vs. Inactive parts:** Power Search only shows active parts by default. Discontinued or disabled ("inactive") parts are left out automatically so they don't clutter your results.

### Key Calculations (if applicable)

N/A — Power Search only displays figures (stock, sale price, cost, WAC) that come directly from the part record. It does not compute or derive any new figures on this page.

## How To — Search for a Part

*Why this matters:* This is the main reason to come to this page — quickly finding the right part when you don't remember exactly which field (SKU, brand, part number) it's filed under, or when you only know what vehicle it fits.

*Precision:* This is a normal, flexible default — there's no single "correct" way to phrase a search. Type whatever you know and adjust if the results aren't what you expected.

1. Go to **Power Search** in the sidebar.
2. Click into the search box (placeholder text reads *"Search by SKU, Name, Part Number, Brand, or Application..."*) and start typing.
3. Results appear automatically a moment after you stop typing — you don't need to press Enter.
4. Scan the results table for the part you need. Columns shown are **SKU**, **Display Name**, **Applications**, **Stock**, and **Sale Price**.
5. If you want to start over, click the **X** inside the search box to clear it.

> 💡 Tip — You don't need to know the exact spelling or full value. Power Search matches on partial text across SKU, part numbers, brand, group, applications, tags, and detail notes, so a fragment like a brand name or part of a vehicle model is often enough.

**Example:** A cashier is asked for a brake pad that fits a "Vios 2016." Typing `vios 2016` into the search box returns every active part whose Applications list includes a Toyota Vios covering model year 2016, including the correct brake pad SKU `BP-10234`.

## How To — View Part Details

*Why this matters:* The results table only shows a summary. Opening a part's detail view gives you the full picture — part numbers, detailed notes, and cost figures — before you commit to using or ordering that part.

*Precision:* Normal default — just click the row you're interested in.

1. From your search results, click anywhere on the row for the part you want to inspect.
2. A detail window opens showing the part's **Display Name** as the title, plus **SKU**, **Stock**, **Sale Price**, **Last Cost**, and **WAC**.
3. Below that, review **Part Numbers** (all known manufacturer/OE numbers for the part) and **Detail** (any additional descriptive notes on the part).
4. Click outside the window or use its close control to return to your results.

**Example:** Clicking the row for SKU `BP-10234` opens a window titled with the part's display name, showing Stock `12.00`, Sale Price `450.00`, Last Cost `310.00`, and WAC `305.50` — letting the cashier confirm there's enough stock before promising it to the customer.

## How To — Request an Inventory Audit

*Why this matters:* If the stock quantity shown looks wrong (e.g. the shelf is empty but the system says there's stock, or vice versa), you can flag the part for a physical recount instead of just trusting or overriding the number yourself. This keeps inventory counts accurate without needing to track down someone from the inventory team in person.

*Precision:* Normal default — request an audit whenever you suspect the on-screen stock is inaccurate; there's no wrong time to ask for a recount.

1. Open the part's detail view (see **How To — View Part Details** above).
2. Click **Request Inventory Audit** at the bottom of the window.
3. A confirmation message appears naming the part's SKU, letting you know the request went through.

> 📝 Note — Requesting an audit does not change the stock number immediately. It flags the part for the inventory team to physically recount; the on-screen figure updates only after that count is completed elsewhere in the system.

**Example:** Stock for SKU `BP-10234` shows `12.00`, but the shelf appears empty. Clicking **Request Inventory Audit** in the part's detail view raises a toast reading "Inventory audit requested for BP-10234," so the inventory team knows to recount it.

## Field Reference

| Field/Control | Description | Notes |
|---|---|---|
| Search box | Free-text search across SKU, part numbers, brand, group, applications, tags, and detail notes. | Searches only after you pause typing (a short debounce); empty box shows no results and the prompt "Type in the search box to begin." |
| Clear (X) button | Clears the search box and results in one click. | Appears inside the search box only once you've typed something. |
| SKU (results column) | The part's internal SKU. | Shown in a fixed-width font for easy comparison. |
| Display Name (results column) | The part's user-facing name. | — |
| Applications (results column) | Vehicles the part is known to fit. | Blank if no applications are recorded for the part. |
| Stock (results column) | Current quantity on hand. | Shows `-` if not available. Shown to two decimal places to support fractional-unit parts. |
| Sale Price (results column) | The part's most recent sale price. | Shows `-` if the part has no recorded sale price yet. |
| Part detail window title | The part's Display Name. | Falls back to "Part Details" while the window is still loading. |
| Last Cost (detail window) | The cost paid for the most recent stock receipt of this part. | Shows `-` if unavailable. |
| WAC (detail window) | Weighted Average Cost — see Key Concepts. | Shows `-` if unavailable. |
| Part Numbers (detail window) | All manufacturer/OE part numbers recorded for the part, in order. | — |
| Detail (detail window) | Free-text descriptive notes on the part. | — |
| Request Inventory Audit (button) | Flags the currently open part for a physical stock recount. | Shows a success message naming the part's SKU on success, or an error message if the request fails. |

## Common Errors & What They Mean

| Message / Situation | Meaning | What To Do |
|---|---|---|
| "An error occurred during the search." | The search request to the server failed — usually a temporary connectivity or server issue, not something you did wrong. | Wait a moment and try your search again. If it keeps happening, let a supervisor or IT know. |
| "No results found for your query." | Your search terms didn't match any active part on file. | Double-check the spelling, try a shorter or more general term (e.g. just the brand, or just part of the part number), or confirm the part isn't marked inactive/discontinued. |
| "Failed to request audit" | The inventory audit request didn't go through — usually a temporary connectivity issue. | Try clicking **Request Inventory Audit** again. If it keeps failing, note the SKU and report it to the inventory team directly so the recount still happens. |
| A part you expect to see never appears in results | The part may be marked inactive, or none of its recorded SKU/part numbers/brand/applications/tags match what you typed. | Try a broader search term. If you believe the part should be active, check with Parts/Inventory staff. |

## Related Modules

- [Sales History](./sales_history_manual.md) — has its own, separate keyword search for looking up invoices (by invoice number, receipt number, customer, or line item), distinct from this page's part lookup.
- [Invoicing and Statements](./invoicing_and_statements_manual.md) — uses the same part lookup when adding line items to an invoice.

## Advanced Reference (optional)

N/A
