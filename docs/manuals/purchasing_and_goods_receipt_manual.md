---
module: Purchasing & Goods Receipt
page_component: PurchaseOrderPage.jsx, PurchaseOrderEditorPage.jsx, GoodsReceiptPage.jsx, GoodsReceiptHistoryPage.jsx
audience: Purchasing/Inventory Staff, Accounting, Manager
verified_against: master @ 5d772b8
last_updated: 2026-08-17
---

# Purchasing & Goods Receipt

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
> - **What it's for:** Ordering stock from suppliers (Purchase Orders) and recording what physically arrives (Goods Receipts), which is what actually adds the stock to inventory.
> - **Who uses it:** Purchasing/Inventory staff (create POs, receive stock), Managers (send POs to suppliers, cancel POs), Accounting (the bills these receipts generate flow into Accounts Payable).
> - **You'll mostly come here to:** Create a Purchase Order, and receive goods against it when the supplier's delivery arrives.

## Overview

Purchasing is the two-step process of ordering stock and then recording what actually shows up. A **Purchase Order (PO)** is your paper trail of what you asked a supplier for and what you agreed to pay — creating one does **not** touch inventory by itself. A **Goods Receipt** is what you record when boxes actually arrive at your door — this is the step that adds stock to inventory and creates the bill you owe the supplier. You can also record a Goods Receipt with no Purchase Order at all, for walk-in or informal supplier drop-offs.

## Key Concepts

- **Purchase Order (PO):** A record of what you've ordered from a supplier — parts, quantities, and agreed cost — before anything physically arrives. It does not affect stock levels or accounting until goods are received against it.
- **PO Status — the lifecycle of a PO:**
  - **Pending** — just created, not yet sent to the supplier. This is the only status where you can still edit, cancel, or delete the PO.
  - **Ordered** — you've confirmed the order was placed with the supplier. From here it's locked; you receive against it rather than editing it.
  - **Partially Received** — at least one Goods Receipt has been posted against this PO, but not all ordered quantities have arrived yet.
  - **Received** — every line on the PO has had its full ordered quantity received.
  - **Cancelled** — the order was called off before anything was received.
- **Goods Receipt (GRN):** The record of stock that physically arrived from a supplier. Posting one immediately adds the received quantities to inventory (as stock-in) and automatically creates a supplier bill in Accounts Payable for the amount received — you don't enter that bill separately.
- **Receiving with vs. without a PO:** Receiving *against* a PO pulls in the ordered parts and quantities automatically and updates that PO's status as items arrive. Receiving *without* a PO (a direct receipt) is for stock that shows up without a prior order — you search for or scan each part yourself, and no PO status is affected.
- **Partial receipt:** If a delivery only contains some of what you ordered, you can receive less than the full ordered quantity per line. The PO stays open at **Partially Received** for the rest.

  > 📝 Note — Once a PO moves to **Partially Received**, it drops out of the "Receive Against Purchase Order" list on the Goods Receipt screen (that list only shows POs still in **Ordered** status). Plan to receive a PO's full remaining quantity in one pass where you can; if a delivery is split across multiple shipments, check with your supervisor on how your business handles the remainder, since the system won't offer that PO back to you for a follow-up linked receipt.

### Key Calculations

- **PO line subtotal = Quantity × Cost.** Example: 10 units at ₱85.00 each = **₱850.00**.
- **PO Total = sum of all line subtotals.** Example: a PO with a ₱850.00 line and a ₱1,200.00 line totals **₱2,050.00**.
- **Goods Receipt line total = Quantity × Cost Price** (same formula, applied to what's actually received — this is what posts to inventory valuation, not the PO's original cost).
- **PO status after receiving = Received once total received across all lines ≥ total ordered across all lines; otherwise Partially Received.** Example: a PO for 100 units total; a receipt posts 60 units → PO shows **Partially Received**. A later receipt posts the remaining 40 → total received (100) now equals total ordered (100) → PO shows **Received**.

## How To — Create a Purchase Order

*Why this matters:* This is your formal record of what you're ordering and at what cost, before anything ships. It's what you'll receive goods against later, and what prints as the PO you send to your supplier.

*Precision:* Supplier and line items are what matter most — get the right parts and quantities. Cost is pulled in automatically from each part's last recorded cost and isn't editable here; if the actual price differs when the goods arrive, you correct it during Goods Receipt, which is what actually affects inventory valuation. Notes and Expected Date are flexible, informational fields.

1. From **Purchase Orders**, click **New Purchase Order**.
2. Choose the **Supplier** from the dropdown.
3. Optionally set an **Expected Date** for when the order should arrive.
4. Under **Add Part**, search for each part you want to order and click it to add it to the list. If the part doesn't exist yet, click **New Part** to create it on the fly, then it's added automatically.
5. For each line, set the **Qty** you're ordering. Remove a line with the trash icon if you added it by mistake.
6. Add any **Notes** for context (e.g. delivery instructions).
7. Click **Create Purchase Order**.

> 💡 Tip — Your work is auto-saved as a draft while you type (you'll see "Draft saved at …" near the top of the form). If you navigate away and come back before finishing, your draft reloads automatically.

**Example:** You're ordering from **AutoParts Distributors Inc.** — 20 units of an oil filter at ₱85.00 and 5 units of a brake pad set at ₱1,200.00. You search and add both parts, set quantities to 20 and 5, add a note "Deliver to main warehouse," and click **Create Purchase Order**. The PO totals ₱850.00 + ₱6,000.00 = **₱6,850.00** and appears in the **Pending** tab.

## How To — Edit a Pending Purchase Order

*Why this matters:* Mistakes happen — wrong quantity, missing part, wrong supplier. You can still fix any of that as long as the order hasn't been sent yet.

*Precision:* Flexible — change whatever needs correcting before you send the order.

1. On the **Purchase Orders** page, find the PO under the **Pending** tab.
2. Click the **Edit** icon on that row.
3. Make your changes (supplier, expected date, parts, quantities, notes) the same way you would when creating a PO.
4. Click **Update Purchase Order**.

> 📝 Note — Editing is only available while a PO is **Pending**. Once it's **Ordered**, the system locks it against edits — the changed order has effectively already gone to the supplier.

## How To — Send a Purchase Order to Your Supplier (Mark as Ordered)

*Why this matters:* This flips the PO from a draft you can still change into a committed order. It's also what makes the PO show up on the Goods Receipt screen's "Receive Against Purchase Order" list, so your warehouse can receive against it later.

*Precision:* This is a one-way step for that PO — once marked Ordered, it can no longer be edited or deleted. Make sure the PO is correct first.

1. Find the PO under the **Pending** tab.
2. Click the **Mark as Ordered** icon (the paper-plane icon) on that row.
3. Confirm the status changes to **Ordered**.

**Example:** PO **PO-000045** for AutoParts Distributors Inc. is reviewed and correct, so you click **Mark as Ordered**. It moves from the **Pending** tab to the **Ordered** tab and is now available to receive against.

## How To — Cancel or Delete a Purchase Order

*Why this matters:* Sometimes an order is called off before it ships. Cancelling keeps a record that the order existed but was called off; deleting removes it entirely.

*Precision:* Both actions are only available while the PO is **Pending**, and deleting is permanent — the system asks you to confirm before removing it.

1. Find the PO under the **Pending** tab.
2. To cancel: click the **Cancel PO** icon. The status changes to **Cancelled** and the PO is kept for your records.
3. To delete: click the **Delete PO** icon, then confirm **Delete** in the "Are you sure?" prompt. This permanently removes the PO.

> ⚠️ Important — Once a PO has moved past **Pending** (to Ordered, Partially Received, or Received), neither Cancel nor Delete is available for it from this screen.

## How To — Receive Goods Against a Purchase Order

*Why this matters:* This is the step that actually adds stock to inventory and creates the bill you owe your supplier — the PO itself never touches stock or Accounts Payable on its own.

*Precision:* Exact. Quantity and Cost Price on each line post directly to inventory valuation and to the supplier bill amount — always match what's on the physical delivery and supplier invoice, not what you originally ordered, if they differ.

1. Go to **Goods Receipt** (from the sidebar) — this opens **New Goods Receipt**.
2. Under **Receive Against Purchase Order (Optional)**, select the PO from the dropdown (shown as PO number and supplier). This automatically fills the **Supplier** field and loads all the PO's lines.
3. For each line, confirm or correct the **Quantity** actually received, the **Cost Price**, and the **Sale Price**. If only part of the order arrived, lower the quantity on the affected lines to match what's physically in hand.
4. Review **Items**, **Total Quantity**, and **Total Cost** at the bottom.
5. Click **Post Transaction**.

> ⚠️ Important — Posting is immediate and adds stock right away; there's no draft-then-approve step. Double-check quantities and costs before clicking **Post Transaction**, since it also generates the supplier bill.

**Example:** You select **PO-000045 - AutoParts Distributors Inc.** from the dropdown. It loads 20 oil filters at ₱85.00 and 5 brake pad sets at ₱1,200.00. Only 15 oil filters actually arrived, so you change that line's Quantity from 20 to 15; the brake pads arrived in full. Total Cost shows 15 × ₱85.00 + 5 × ₱1,200.00 = **₱7,275.00**. You click **Post Transaction** — inventory increases by those quantities, a supplier bill for ₱7,275.00 is created, and PO-000045 moves to **Partially Received** (5 oil filters still outstanding).

## How To — Receive Goods Without a Purchase Order

*Why this matters:* Not every delivery starts with a PO in the system — informal supplier drop-offs or walk-in restocks still need to hit inventory and get billed correctly.

*Precision:* Exact, for the same reason as above — Quantity and Cost Price post straight to inventory valuation and the resulting bill.

1. Go to **Goods Receipt**. Leave **Receive Against Purchase Order (Optional)** on **-- Select a PO --**.
2. Choose the **Supplier**, or click **New** next to it to add one you haven't ordered from before.
3. Under **Add Part Manually**, search for each part by name or SKU (or scan a barcode) and select it to add it to the list. Use **New Part** if the part doesn't exist yet.
4. Set **Quantity**, **Cost Price**, and **Sale Price** for each line.
5. Click **Post Transaction**.

**Example:** A local supplier drops off 10 spark plugs at ₱45.00 each with no prior PO. You select the supplier, search "spark plug," add the part, set Quantity to 10 and Cost Price to ₱45.00, and click **Post Transaction**. Inventory increases by 10 units and a ₱450.00 supplier bill is created — no PO is affected since none was used.

## How To — Look Up a Past Goods Receipt

*Why this matters:* Once posted, a receipt is your audit trail for what arrived, when, and at what cost — useful for resolving supplier disputes or checking why a stock or cost figure looks the way it does.

*Precision:* Flexible browsing/searching. If your account has edit permission, correcting a posted receipt's figures is exact-required, since it adjusts historical inventory valuation.

1. From **Goods Receipt**, click **View History** (or navigate to **Goods Receipt History** directly).
2. Use the search bar to find a receipt by GRN #, supplier, or part details, or sort by clicking a column header.
3. Click any row to open its details — supplier, receive date, received-by, and every line with quantity, cost, and sale price.
4. If you have permission to edit goods receipts, click **Edit** inside the details view, adjust the quantities/prices as needed, and click **Save**.

> ⚠️ Important — Editing a posted Goods Receipt changes historical inventory figures. Only do this to correct a genuine data-entry mistake, and only if you have that permission.

## Field Reference

| Field/Control | Description | Notes |
|---|---|---|
| Supplier (PO / Goods Receipt) | The vendor you're ordering from or receiving stock from. | Required to save a PO or post a receipt. On the Goods Receipt screen, this locks and auto-fills when a PO is selected. |
| Expected Date (PO) | The date you expect the order to arrive. | Optional, informational only. |
| Add Part / Add Part Manually | Search box to find an existing part by name or SKU and add it as a line. | On Goods Receipt, also accepts a scanned barcode. |
| New Part | Opens a quick form to create a part that doesn't exist yet, then adds it to the current lines. | Available on both the PO editor and Goods Receipt screen. |
| Qty / Quantity | How many units of a part are being ordered (PO) or received (Goods Receipt). | On Goods Receipt, this is what posts to inventory — must match the physical count. |
| Cost Price | What you're paying per unit. | On the PO editor this is set automatically from the part's last cost and isn't editable. On Goods Receipt it's editable and is what posts to inventory valuation and the supplier bill. |
| Sale Price (Goods Receipt only) | The price you intend to sell the part at going forward. | Optional per line; defaults to the part's last sale price if known. |
| Notes (PO) | Free-text notes for the order (e.g. delivery instructions). | Optional. |
| Receive Against Purchase Order | Dropdown of open POs (status **Ordered**) to receive against. | Selecting one loads its lines and locks Supplier/Add Part Manually to keep the receipt tied to that PO. |
| Status filter tabs (Purchase Orders list) | Pending / Ordered / Partially Received / Received / Cancelled / All. | Filters the list; Pending is the default view. |
| Download (Purchase Orders list) | Downloads the PO as a PDF. | Available for any PO regardless of status. |

## Common Errors & What They Mean

| Message / Situation | Meaning | What To Do |
|---|---|---|
| "Please add at least one part to the purchase order." | You tried to save a PO with no line items. | Add at least one part before saving. |
| "Please select a supplier or create an 'N/A' supplier." | No supplier was chosen, and there's no placeholder "N/A" supplier set up to fall back on. | Pick a supplier from the dropdown, or ask an admin to set up an "N/A" placeholder supplier if your workflow needs one. |
| "No supplier selected — using placeholder 'N/A' supplier." | An informational notice, not an error — you saved without picking a supplier, so the system used the "N/A" placeholder supplier automatically. | Nothing required, but go back and set the real supplier later if you know it. |
| "Cannot edit a PO with status 'Ordered'" (or similar) | Edits are only allowed while a PO is Pending; this one has already moved on. | If something's genuinely wrong with an Ordered PO, cancel it and create a new, corrected one instead. |
| "Cannot delete a PO with status '...'" | Same rule as editing — deletion only works on Pending POs. | Use Cancel instead if the PO has already been sent. |
| "Please select a supplier and add at least one item." (Goods Receipt) | You clicked Post Transaction without a supplier chosen or without any lines. | Select a supplier and add at least one part, then post again. |
| "No item found for barcode '...'" | The barcode you scanned doesn't match any part in the system. | Double check the barcode, or search for the part by name/SKU instead. |
| A PO you expect isn't in the "Receive Against Purchase Order" list | The list only shows POs in **Ordered** status. If it's already **Partially Received**, it won't reappear there. | Check the Purchase Orders page to confirm its actual status; see the note under Key Concepts about partial receipts. |
| Your draft disappeared after posting/saving | This is expected — successfully creating a PO or posting a Goods Receipt clears the saved draft automatically. | Nothing to fix; that's the system confirming your entry went through. |

## Related Modules

- Accounts Payable — every posted Goods Receipt automatically creates the supplier bill you'll pay against.
- Inventory / Parts — Goods Receipts are what move stock quantities up; the Purchase Order editor and Goods Receipt screen both let you create a new part on the fly if one doesn't exist yet.
- Suppliers — POs and Goods Receipts are both tied to a supplier record; new suppliers can be added directly from the Goods Receipt screen.

## Advanced Reference

**How the auto-generated supplier bill works:** When you post a Goods Receipt, the system totals the quantity × cost price across all its lines and creates a supplier bill for that amount, due according to that supplier's normal payment terms. This happens automatically so Accounts Payable always reflects what you owe as soon as goods arrive — you don't need to enter that bill by hand. (If a receipt is being attached to a bill that already exists rather than creating a new one, no duplicate bill is created.)

**How partial-vs-full receiving is tracked:** For a PO linked to a Goods Receipt, the system keeps a running total, per line, of how much has been received so far. Each time a receipt posts against that PO, it adds to that running total. After posting, the system compares the running total across all lines to the originally ordered total across all lines: if everything ordered has now been received, the PO becomes **Received**; otherwise it becomes **Partially Received**. This is a pure quantity comparison — it doesn't look at cost.
