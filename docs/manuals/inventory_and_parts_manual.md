---
module: Inventory & Parts Catalog
page_component: InventoryPage.jsx, PartsPage.jsx, PartNumberManager.jsx, PartApplicationManager.jsx, ApplicationsPage.jsx, PartsCleanupPage.jsx, CycleCountExecutionPage.jsx
audience: Inventory/Warehouse Staff, Parts Catalog Admin, Manager
verified_against: docs/manuals branch docs/comprehensive-project-documentation-and-manual, commit 5d772b8
last_updated: 2026-08-17
---

# Inventory & Parts Catalog

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
> - **What it's for:** The single source of truth for what parts you sell, how much of each you have on hand, and what vehicles each part fits.
> - **Who uses it:** Inventory/warehouse staff, parts catalog admins, managers.
> - **You'll mostly come here to:** Look up or adjust stock on hand, and add/edit parts (including their part numbers and vehicle applications).

## Overview

The Inventory & Parts Catalog module covers everything about *what* you stock and *how much* of it you have. It has two closely linked halves: **Inventory**, where you check stock levels and record physical stock changes, and **Parts**, where you build and maintain the catalog itself — part records, their alternate part numbers, and the vehicles they fit. It also includes two maintenance tools: **Parts Cleanup**, for merging duplicate catalog entries, and **Cycle Count**, for the guided physical stock-count workflow assigned to counting staff.

## Key Concepts

- **Part** — a catalog record for one sellable/stockable item (a SKU). Every part has a system-generated **Internal SKU**, a **Detail** (short description), and can carry many alternate **Part Numbers** and **Applications**.
- **Internal SKU** — the system's unique code for a part. Read-only; it is generated when a part is created.
- **Part Number** — an alternate identifier for the same physical part: an OEM number, a manufacturer number, a supplier's alternate number, etc. A part can have several — for example the same brake pad might be listed under an OEM number and two aftermarket cross-reference numbers. The catalog uses one of these as the *primary alias* (whichever is listed first).
- **Application** — a specific vehicle fitment: a **Make**, **Model**, and optional **Engine**, with an optional year range. Linking an application to a part records "this part fits this vehicle." A part can have many applications (e.g. one part might fit several model years of the same car, or several different models).
- **Stock on Hand** — the quantity of a part currently in inventory, shown per part on the Inventory page.
- **WAC (Weighted Average Cost)** — the average cost per unit of the stock you're currently holding, blending the cost of everything you've bought in at different prices over time. Used to value inventory (see Key Calculations below).
- **Stock Adjustment** — a manual correction to Stock on Hand (e.g. after a damage write-off or a count correction), logged with a reason and tied to the employee who made it. This posts directly to inventory, so treat it as precision-required (see the How To section below).
- **Duplicate parts** — two or more catalog entries that actually represent the same physical part (often created by accident, e.g. by two different staff members on different days). Parts Cleanup finds and merges these.
- **Cycle Count** — a scheduled physical stock count. Counting staff are assigned a batch of parts to count; this module covers *executing* an assigned count, not scheduling or reviewing one.

### Key Calculations

**Total Value = Stock on Hand × WAC** — e.g. 42 units × ₱85.50 WAC = ₱3,591.00. This is the figure shown in the Inventory table's **Total Value** column; it tells you how much your held stock of that part is worth at its current average cost.

**New Stock (after an adjustment) = Current Stock on Hand + Adjustment Quantity** — e.g. if Stock on Hand is 42 and you enter an adjustment of ‑5, the new stock will be 37. Enter a positive number to add stock, a negative number to remove it. The Stock Adjustment form shows you this resulting number live as you type, before you save.

## How To — Look Up Stock and Item Value

*Why this matters:* This is the fastest way to answer "how many do we have" or "what's this worth," without opening the full parts catalog.

*Precision:* This is read-only browsing — there's nothing to get wrong here. Look up freely.

1. Go to **Inventory Management**.
2. Use the **Search inventory...** box to find an item by name, SKU, or part number, or just browse the table.
3. Use **Sort all by** (SKU / Name / Stock on Hand / WAC / Total Value) and **Order** (Ascending / Descending) to reorder the list — for example, sort by Stock on Hand ascending to see your lowest-stock items first. You can also click any column header to sort by that column.
4. Read the columns directly: **SKU**, **Item Name**, **Stock on Hand**, **WAC**, **Total Value**.
5. Click the history icon (labeled "View History" on hover) in the **Actions** column to open **Transaction History** for that item — a running log of every stock movement (date, type, quantity, reference, notes, and the user who made it).

**Example:** Searching "brake pad" and sorting by Stock on Hand ascending immediately surfaces the brake pad SKUs closest to running out.

## How To — Adjust Stock

*Why this matters:* Stock on Hand should always reflect reality. Use a Stock Adjustment whenever the physical count changes for a reason other than a normal sale or purchase — damage, spoilage, a found item, or a correction after a manual count.

*Precision:* **Exact-required.** This action posts directly to inventory and is logged permanently against your user account — always enter the correct sign and a clear reason before saving.

1. On **Inventory Management**, find the part and click the adjust icon (labeled "Adjust Stock" on hover) in the **Actions** column. (This button only appears if you have permission to adjust stock.)
2. In the **Stock Adjustment** dialog, review **Current Stock Information** (SKU and Current Stock) to confirm you have the right item.
3. In **Adjustment Quantity**, enter a positive number to add stock (e.g., `5`) or a negative number to remove stock (e.g., `-2`). The form shows you the resulting "New stock will be:" figure as you type — check it before saving.
4. Fill in **Reason / Notes** with why you're adjusting (e.g., "Stock count correction" or "Damaged item"). This isn't optional in spirit — it's the only record of *why* later, so always write something specific.
5. Click **Save Adjustment**.

> ⚠️ **Important:** A zero or blank adjustment quantity is rejected — the form requires a valid, non-zero number. Double-check the sign before saving; there is no "undo" button, only a further adjustment to correct it.

**Example:** Part `BRK-2210` (Brake Pad Set) shows Current Stock of 42. A technician finds 2 units were damaged in storage. Enter `-2` in Adjustment Quantity — the form confirms "New stock will be: 40" — enter "Damaged in storage, water exposure" in Reason / Notes, and click **Save Adjustment**.

## How To — Add a New Part

*Why this matters:* Every item you can sell, purchase, or stock must exist as a Part record first. This is the starting point for the whole catalog.

*Precision:* This is a normal default workflow, not exact-required — fill in what you know and refine later. The one exception: if this part replaces or duplicates something in the catalog, check Parts Cleanup rather than creating a near-duplicate (see below).

1. Go to **Parts**, then click **New Part**.
2. Optionally enter **Part Numbers (optional)** — OEM/manufacturer/alternate numbers, separated by commas (e.g., `OEM123, MFG456, ALT789`).
3. Select or create a **Brand** and **Group** using the dropdowns. If the brand or group doesn't exist yet, type its name and choose the "Create new" option that appears — this opens a small **Add New Brand** / **Add New Group** dialog where the code is generated automatically.
4. Enter **Part Detail** — the short description shown throughout the app.
5. Enter **Last Cost** and **Last Sale Price**.
6. Optionally add **Tags** for your own categorization/searching.
7. Click **Show Advanced Options** if you need to set **Barcodes**, **Unit** (default `pcs`), **Reorder Point**, **Warning Qty**, **Tax Rate**, or the **Active** / **Is Service** / **Low Stock Warning** / **Price Change Allowed** / **Use Default Qty** / **Price is Tax Inclusive** checkboxes. These have sensible defaults, so most day-to-day part creation can skip this section.
8. Click **Save**.

> 📝 **Note:** When you create a brand-new part, the Applications manager (vehicle fitments) opens automatically right after saving, so you can immediately link the vehicles it fits — see the next section.

**Example:** Creating a part with Part Detail "Front Brake Pad Set - Ceramic," Brand "Bendix," Group "Brake System," Last Cost ₱650.00, Last Sale Price ₱950.00. After clicking **Save**, the Applications manager opens for the new part.

## How To — Manage Part Numbers

*Why this matters:* The same physical part is often known by several numbers — its own OEM number plus one or more manufacturer/aftermarket cross-reference numbers. Keeping these all attached to one Part record means staff searching by any of those numbers still find the right item.

*Precision:* Normal default — add/remove/reorder freely. The one rule that's enforced by the system: every part must keep at least one part number.

1. On **Parts**, find the part and click the numbers icon (labeled "Manage Part Numbers" on hover).
2. To add numbers, type them into **Add New Numbers**, separated by commas, semicolons, or new lines (e.g., `OEM123, MFG456; ALT789`), then click **Add Numbers**.
3. To reorder, hover a number in **Existing Numbers** and use the up/down arrows that appear — the top entry is the *primary alias*. Click **Save Order** once you're happy with the order (this button is disabled if there's only one number).
4. To remove a number, hover it and click the trash icon. Confirm in the **Remove Part Number** dialog. This removes only the alias — the part itself remains available.

> ⚠️ **Important:** You cannot remove the last remaining part number for a part — the confirmation dialog will warn "You must keep at least one part number" and block the removal.

**Example:** A part currently has one number, `OEM-4521`. Typing `TOY-88521, AM-3390` into **Add New Numbers** and clicking **Add Numbers** brings it to three numbers; dragging `TOY-88521` to the top and clicking **Save Order** makes it the primary alias.

## How To — Manage Part Applications (Vehicle Fitments)

*Why this matters:* Linking a part to the vehicles it fits (its "applications") is what lets staff and customers confirm a part is right for a specific car before selling it. Without applications, the part has no fitment information at all.

*Precision:* Normal default — link, edit year ranges, or unlink as your knowledge of the fitment improves.

1. On **Parts**, find the part and click the link icon (labeled "Manage Applications" on hover) — or open it directly from the **Applications** field inside the part's own edit form via the **Manage** button.
2. Under **Link New Application**, search for an existing Make/Model/Engine combination using the search box, or click **New** to create one on the spot (opens **Add New Application** — see the next section for its fields).
3. Optionally set **Year Start** and **Year End** to limit the fitment to specific model years (e.g., 2010–2015). Leave both blank if the fitment applies to all years of that vehicle.
4. Click **Link Application**.
5. To change a linked application's year range later, click the edit icon next to it in **Linked Applications** and update **Year Start** / **Year End** in the **Edit Year Range** dialog, then **Save Years**.
6. To remove a fitment that no longer applies, click the trash icon next to it — this unlinks it from the part; it does not delete the vehicle application itself, so it remains available to link to other parts.
7. Click **Close** when done.

**Example:** Linking application "Toyota Vios (1NZ-FE)" to a part with Year Start `2007` and Year End `2013` records that this part fits Vios models from those model years only.

## How To — Add or Edit a Vehicle Application

*Why this matters:* Before you can link a part to a vehicle, that Make/Model/Engine combination has to exist as an Application record. This task manages the master list of vehicle fitments (separately from any specific part).

*Precision:* Normal default. Deleting an application, however, can affect any parts currently linked to it — the system warns you at deletion time.

1. Go to **Vehicle Applications**.
2. Click **Add Application**.
3. In **Make**, type or select an existing make; if it doesn't exist, choose the **Create new "..."** option that appears.
4. In **Model**, same pattern — type/select or create new (enabled once a Make is chosen).
5. In **Engine** (optional), same pattern again (enabled once a Model is chosen).
6. Click **Save**.
7. To edit an existing application, click its edit icon in the table and change any of Make/Model/Engine, then **Save**.
8. To remove one, click its trash icon and confirm — you'll see the warning "This may affect linked parts."

**Example:** Adding Make "Toyota," Model "Vios," Engine "1NZ-FE" creates a new vehicle application record that any part can now be linked to.

## How To — Clean Up Duplicate Parts

*Why this matters:* Duplicate catalog entries (the same physical part recorded twice under different names or SKUs) fragment your stock history, confuse searches, and split reporting. Parts Cleanup finds likely duplicates and walks you through safely merging them into one record.

*Precision:* **Exact-required.** Merging is a five-step guided wizard specifically because it is close to irreversible — merged parts are deactivated and their SKUs are modified, and every other record that referenced them (orders, invoices, receipts, inventory, part numbers, applications) is redirected to the part you kept. Follow every step; do not rush the final confirmation.

1. From **Parts**, click **Cleanup Duplicates** (only visible if you have merge permission). This opens the guided wizard, currently at **Step 1: Find Duplicates**.
2. Choose a mode: **Automatic Scan** (the system finds candidates for you) or **Manual Selection** (you search and pick the parts yourself).
   - **Automatic Scan:** pick a **Similarity Threshold** (Very High 90% / High 80% / Medium 70% / Low 60%) and click **Start Duplicate Search**. Review the suggested groups — each is tagged with a confidence badge (🟢 Exact Match, 🔵 AI Confirmed, 🟡 AI Suggested, ⚪ Low Confidence). Use **Select All**, **AI-Verified Only**, or **Select High Confidence** to bulk-select groups, or check individual groups. If a group is not actually a duplicate, click **⛔ Exclude** to dismiss it from future scans.
   - **Manual Selection:** search by name, SKU, or part number, check at least 2 parts you know are duplicates, then click **Next: Choose Canonical**.
3. Click **Next** to advance to **Step 2: Choose Parts to Keep**. For each group, either click **✨ Auto-Select All** to let the system pick the most complete/recent record per group, or click individual **PartCompareCard** tiles to choose which part in each group is the one to *keep* (the "canonical" record — the others will be merged into it and deactivated).
4. Click **Next** to advance to **Step 3: Resolve Conflicts**. By default all conflicts (differing prices, names, statuses, etc.) are auto-resolved in favor of your chosen canonical part. Click **View & Manual Override** if you want to review or change: **Merge Rules** (Merge Part Numbers, Merge Applications, Merge Tags — toggle any off if you don't want that data combined) and any individual field conflicts (Display Name, Description, Cost Price, Sale Price, Active Status, Service Status) shown per group.
5. Click **Next** to advance to **Step 4: Preview Impact**. Review the **Merge Impact Summary**: groups to merge, parts to be merged, and total records to be updated, broken down table by table, plus any inventory impact and warnings/conflicts. If more than 1,000 records will be touched, you'll see a "Large Operation Warning" suggesting you run the merge during low-traffic hours.
6. Click **Next** to advance to **Step 5: Confirm Merge**. Read the **Critical Warning** carefully — it lists exactly what happens (parts deactivated and SKUs modified, references redirected, inventory consolidated with WAC recalculated, part numbers/applications merged, and the whole operation logged for audit). Check **I understand the consequences of this action**, type `MERGE` (case-sensitive) into the confirmation box, then click **Execute Merge**.

> ⚠️ **Important:** The wizard explicitly states this operation "cannot be easily reversed." Do not execute a merge you haven't fully reviewed in Step 4. If in doubt, use **⛔ Exclude** in Step 1 instead of merging.

**Example:** An automatic scan at High (80%) confidence finds a 🟢 Exact Match group of two parts both listing OEM number `OEM-4521` under different Detail text. Auto-selecting the canonical picks the more complete record, no field conflicts are detected, the impact preview shows 3 records to update (orders, invoices, inventory), and typing `MERGE` and clicking **Execute Merge** consolidates them into one part.

## How To — Run a Cycle Count (Counting Staff)

*Why this matters:* Cycle counts are how physical stock is periodically verified against what the system thinks you have. This task covers the counting workflow itself — counting a batch of parts you've been assigned. Scheduling or reviewing a count as a whole is handled elsewhere.

*Precision:* **Exact-required for the count itself** — enter the number you physically counted, not an estimate. Getting this wrong defeats the purpose of the count and can trigger incorrect stock corrections.

1. Open **My Cycle Count**. The **Pending Tasks** tab shows **Today's Batch** — the number of items assigned to you.
2. If items are pending, click **Start Counting**. If none are pending, you'll see "All caught up!"
3. For each item, you'll see its name/SKU on screen. Physically count the item, then enter the quantity using the on-screen numpad (digits, `C` to clear, `⌫` to backspace).
4. Click **Submit Count**. The app automatically advances to the next item in your batch; after the last item it shows "Batch completed!" and returns you to the dashboard.
5. If you count something that was *not* in your assigned batch (an unexpected find), click **Log Unassigned Find** from the dashboard (or **Log Unassigned Find** during an active count) instead of trying to force it into the current item. Search for the part by scanning its barcode or typing its name/SKU, select it from the results, enter the counted quantity on the numpad, and click **Submit Count**.
6. Check the **My Progress** tab at any time to review what you've already counted in this session.

> 📝 **Note:** If you make a mistake on a submitted count, do not try to "fix" it by adjusting stock yourself — flag it to whoever manages cycle counts so the batch can be corrected through the count review process, not through an ad hoc stock adjustment.

**Example:** A batch of 15 items is assigned. Tapping **Start Counting** opens item 1 of 15; the counter physically counts 24 units on the shelf, taps `2` `4` on the numpad, and taps **Submit Count** — the app immediately shows item 2 of 15.

## Field Reference

| Field/Control | Description | Notes |
|---|---|---|
| Internal SKU | System-generated unique identifier for a part. | Read-only. |
| Item Name / Detail | The short description of the part shown throughout the app. | Required. |
| Stock on Hand | Current quantity in inventory. | Changed by sales, purchases, or Stock Adjustments — never edited directly. |
| WAC | Weighted Average Cost per unit. | Recalculated automatically as stock moves in/out at different costs; also recalculated after a Parts Cleanup merge. |
| Total Value | Stock on Hand × WAC. | Calculated column, not stored input. |
| Adjustment Quantity | Amount to add (positive) or remove (negative) from stock. | Cannot be zero or blank. |
| Reason / Notes (Stock Adjustment) | Free-text explanation for the adjustment. | Not enforced as required by the form, but always fill it in — it's the only audit trail. |
| Part Numbers (optional) | Comma/semicolon/newline-separated list of alternate part identifiers. | Every part must retain at least one. |
| Brand / Group | Categorization for a part. | Can be created inline via "Create new" if it doesn't exist yet. |
| Last Cost / Last Sale Price | The most recent purchase cost and selling price for the part. | Free-form during entry; accepts numbers and one decimal point. |
| Reorder Point / Warning Qty | Thresholds used for low-stock warnings. | Found under Show Advanced Options. |
| Tax Rate | The applicable tax rate for this part. | Optional; list is pulled from configured tax rates. |
| Applications | Vehicle Make/Model/Engine fitments linked to a part, with optional Year Start/Year End. | Managed per-part via "Manage Applications"; the master list is managed on Vehicle Applications. |
| Similarity Threshold (Parts Cleanup) | How close two parts must be to be suggested as duplicates: Very High (90%), High (80%), Medium (70%), Low (60%). | Higher = fewer, more confident matches. |
| Merge Rules (Parts Cleanup) | Merge Part Numbers / Merge Applications / Merge Tags toggles. | Controls whether that data is combined into the kept part during a merge. |

## Common Errors & What They Mean

| Message / Situation | Meaning | What To Do |
|---|---|---|
| "Please enter a valid, non-zero quantity." | The Stock Adjustment form rejected your entry because it was blank, not a number, or zero. | Enter a positive or negative non-zero number and try again — nothing was saved. |
| "Cannot remove last part number" | You tried to delete the only remaining part number on a part. | Add another part number first if you really need to remove this one, or leave it — every part must keep at least one identifier. |
| "Part number already removed" | You tried to remove a part number that was already deleted (often from a stale screen after someone else changed it). | Refresh the part's numbers list; no action needed, it's already gone. |
| "You do not have permission to access the parts cleanup feature" | Your account role doesn't include merge permission. | Ask a manager/admin to perform the merge, or request the permission if it's part of your normal duties. |
| "You do not have permission to execute cycle counts." | Your account role doesn't include cycle count execution permission. | Ask a manager/admin to grant it if counting is part of your job. |
| "Select at least 2 parts to continue" (Manual Selection) | You tried to proceed in Parts Cleanup's manual mode with fewer than 2 parts checked. | Check at least 2 parts you believe are duplicates before continuing. |
| "Please agree to the terms first" / "Please type 'MERGE' to continue" | The final merge confirmation isn't complete yet — the checkbox isn't checked or the confirmation text doesn't exactly match `MERGE`. | Check the acknowledgment box and type `MERGE` exactly (case-sensitive) to enable **Execute Merge**. Nothing is merged until both are done. |
| Failed to submit count / "Failed to submit count." | The cycle count submission didn't reach the server (network issue or validation failure). | The app does not advance to the next item on failure — your count wasn't lost, just not saved yet. Check your connection and submit again. |

## Related Modules

- Purchases and receiving (affects Stock on Hand and WAC through purchase transactions)
- Sales/POS (affects Stock on Hand through sales transactions)
- Reporting (inventory valuation and low-stock reports draw on this catalog)

## Advanced Reference (optional)

**Duplicate confidence tiers.** Parts Cleanup's automatic scan classifies suggested duplicate groups into four confidence tiers, shown as colored badges: 🟢 Exact Match (identical normalized part number), 🔵 AI Confirmed (AI-verified with high confidence), 🟡 AI Suggested (AI-suggested, review recommended), ⚪ Low Confidence (weak signal, inspect carefully). The **Similarity Threshold** you pick before starting a scan filters which of these tiers are shown — at Very High/High threshold, only Exact/High-confidence groups are shown; at Medium/Low, all tiers appear. Treat lower-confidence groups with more scrutiny before merging.

**Auto-Select canonical scoring.** When you click **✨ Auto-Select All** in Step 2 of Parts Cleanup, the app scores each part in a group by data richness (points for having a filled-in display name, detail, brand, group, cost price, sale price, and internal SKU, plus extra points per part number and per application on file) and breaks ties by recency (most recently modified/created wins). The part with the highest score in each group becomes the one kept. This is a client-side heuristic meant to save time on the common case — always spot-check its picks in Step 2 rather than assuming it's always right.
