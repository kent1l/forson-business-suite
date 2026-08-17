---
module: Point of Sale (POS)
page_component: POSPage.jsx
audience: Cashier, Store Manager
verified_against: master @ 5d772b8 (2026-08-17)
last_updated: 2026-08-17
---

# Point of Sale (POS)

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
> - **What it's for:** Ring up walk-in and counter sales — scan or search for parts, take payment, and print a receipt.
> - **Who uses it:** Cashiers, store managers covering the counter.
> - **You'll mostly come here to:** Add items to a sale and check a customer out, and occasionally save a cart for later or void a sale that went wrong.

## Overview

The Point of Sale (POS) screen is where every over-the-counter sale gets rung up. A cashier scans or searches for parts, the screen builds a running cart with subtotal, tax, and total, and then takes payment — cash, card, mobile wallet, or split across several methods, depending on what the business has enabled. Once payment is confirmed, POS creates the invoice and can print a receipt immediately.

## Key Concepts

- **Walk-in customer:** The default customer POS selects automatically when the screen loads or after a sale finishes. Use this for anonymous, cash-and-carry customers. Select a real (registered) customer instead when the sale needs to go on that customer's account or history.
- **Physical Receipt No.:** The number from your pre-printed official receipt booklet (e.g. `SI-1234`). POS normalizes whatever you type into `LETTERS-DIGITS` format automatically when you leave the field (so `si 1234`, `SI/1234`, and `SI-1234` all become `SI-1234`). Whether this field is required before you can pay depends on a store setting — if it's required, the **Confirm Payment** button stays disabled until you fill it in.
- **Tax Rate:** The tax rate applied to items that don't already carry their own rate. Most parts have a rate wired in; this dropdown is your fallback/override for the sale.
- **Saved Sale:** A cart you've parked for later without finishing the sale — useful when a customer steps away or you need to help another customer first. Saved sales live only in the cashier's own browser (not synced across registers or devices), capped at the 10 most recent per login.
- **Split Payment:** Paying for one sale with more than one payment method (e.g. part cash, part GCash). Only available when the store has split payments turned on; otherwise checkout always uses the single-method **Process Payment** window.
- **On Account:** A payment method that doesn't collect money now — it invoices the customer and adds the balance to their Accounts Receivable. It is blocked for the Walk-in customer; you must select a real, registered customer to use it. See the [Accounts Receivable](./accounts_receivable_manual.md) manual for how each method affects invoice status and A/R.
- **Settlement type:** A label (shown next to each payment method during Split Payment) telling you when the money actually counts as collected: **instant** (counted right away, e.g. Cash), **delayed** (pending until a back-office user manually settles it, e.g. Cheque), or **on account** (not collected now — it's a credit sale).

### Key Calculations

- **Line Total = Quantity × Sale Price** (discounts are not entered from the POS screen — see the note under Field Reference).
  Example: 3 units at ₱150.00 each = **₱450.00**.
- **Subtotal** = the sum of every line's tax-exclusive amount. For a normal (tax-exclusive) price, that's just the Line Total. For a **tax-inclusive** part (price already includes tax), POS backs the tax out of the entered price so the Subtotal always reflects the amount before tax.
- **Tax** = each line's tax base × that line's tax rate (the part's own rate, or the Tax Rate dropdown if the part has none), added up across the cart.
  Example: ₱450.00 subtotal × 12% = **₱54.00** tax.
- **Total = Subtotal + Tax.**
  Example: ₱450.00 + ₱54.00 = **₱504.00**.
- **Change Due = Cash Tendered − Total.**
  Example: customer hands over ₱600.00 for a ₱504.00 total → ₱600.00 − ₱504.00 = **₱96.00** change.

> 📝 Note — When any line uses a tax-inclusive price, POS also shows an **Items Total (Entered)** line above the Subtotal, so you can see both the raw entered amount and the tax-backed-out Subtotal used for the Total.

## How To — Add Items to the Sale

*Why this matters:* Every sale starts here — the cart total, tax, and payment screen are all built from what you add in this step.

*Precision:* Flexible. Use whichever method (scan, type, browse results) is fastest for the situation — there's no wrong way to add an item, as long as the right part and quantity end up in the cart.

1. Click into the search box at the top (placeholder text reads **"Scan or search (Ctrl+F)..."**) — it's already focused when the screen loads, and `Ctrl+F` (`Cmd+F` on Mac) jumps back to it any time.
2. **To scan a barcode:** just scan it. The scanner types the code and presses Enter for you, and POS looks the part up directly and adds it — no dropdown needed. If nothing matches, you'll see a toast: `No item found for barcode "<code>"`.
3. **To search by name or number:** start typing. After a brief pause, matching parts appear in a dropdown showing the part name, its application text (e.g. vehicle fitment), and its last sale price. Click a result, or arrow down and press Enter.
4. Either path opens the **Add Item to Sale** window with **Sale Price** (pre-filled from the part's last sale price, and pre-selected so you can just type over it) and **Quantity** (defaults to 1). Adjust either field if needed, then click **Add to Sale**.
5. If the part already exists in the cart, adding it again increases that line's quantity instead of creating a duplicate row.
6. Can't find the part at all? Click **New Part** (top right of the search bar) to open **Add New Part**, fill in the details, and save — it's added straight to the cart at quantity 1.

**Example:** Cashier scans a spark plug barcode. POS finds "NGK Spark Plug BPR6ES" and adds 1 unit at its last sale price of ₱185.00 with no extra clicks. For a second, unlabeled part, the cashier types "brake pad", picks "Brake Pad Set - Front" from the dropdown, confirms the price ₱1,250.00 and sets Quantity to 2 in the Add Item window, then clicks **Add to Sale** — the cart now shows a ₱2,500.00 line.

## How To — Adjust the Cart

*Why this matters:* Prices and quantities aren't always exactly what the search suggested — a cashier needs to correct a quantity or price without starting over.

*Precision:* Flexible for quantity/price corrections during a normal sale. Be careful with price overrides, since the Total you charge is whatever is on screen — double-check before checkout.

1. In the cart panel (right side), each line shows the item name with **Quantity** and **Price** as editable number fields, plus the line's total on the right.
2. Change either field directly to correct it — the Subtotal, Tax, and Total at the bottom update immediately.
3. Click the **✕** next to a line to remove it entirely.
4. Choose the **Tax Rate** for the sale from the dropdown near the top of the cart panel if the default doesn't apply — this only affects lines whose part doesn't already carry its own tax rate.

**Example:** A line for "Brake Pad Set - Front" was added at quantity 2; the customer decides on just 1. The cashier changes the Quantity field from `2` to `1`; the line total drops from ₱2,500.00 to ₱1,250.00 and the cart's Total recalculates automatically.

> 📝 Note — POS doesn't have a discount field on this screen. If a sale needs a discount applied, that has to be handled elsewhere in the workflow (e.g. by adjusting the Sale Price directly, or via Invoicing) — check with your manager for the store's discount policy.

## How To — Select the Customer

*Why this matters:* The customer on the sale determines whose invoice this becomes and which payment methods are available (On Account requires a real customer, not Walk-in).

*Precision:* Flexible — pick whichever customer applies. POS defaults to Walk-in so you only need to act here for a registered customer.

1. Click the **Customer** tile (top-left of the button grid) — it shows "Customer" until someone is picked, then switches to showing the selected name.
2. In the **Select Customer** window, search and click a name to select them, or click **Add New Customer** to create one on the spot if they're new.
3. Selecting a customer closes the window and updates the tile to show that customer's name.

**Example:** A returning customer, Maria Santos, wants the sale on her account history. The cashier clicks the Customer tile, types "Santos" into the search box, and clicks her name from the results — the tile now reads "Maria Santos."

## How To — Save a Sale for Later

*Why this matters:* Lets you park a customer's cart (e.g. they stepped away to grab their wallet) and help someone else without losing the work already done.

*Precision:* Flexible default — use it whenever you need to interrupt a sale in progress.

1. Click the **Save Sale** tile (bottom-left of the button grid), or press **Alt+S**. It's only clickable once there's at least one item in the cart and something has changed since the last save.
2. The cart, customer, and tax rate are saved; a badge on the tile shows how many sales are currently saved (up to 10 — the oldest is dropped once you go over).
3. To bring a saved sale back, click **View Saved (N)** under the tile, or reopen the tile once it has a badge. In the **Saved Sales** window, click **Restore** on the entry you want.
4. If the current cart already has items, POS asks you to confirm before replacing it. Restoring removes that entry from the saved list — restore consumes it.
5. Click the trash icon on a saved entry to delete it without restoring.

**Example:** A customer leaves their card at home mid-sale. The cashier clicks **Save Sale** (or presses Alt+S); the badge on the tile shows "1". Twenty minutes later the customer returns — the cashier opens **View Saved (1)**, clicks **Restore** on "Sale 1", and the cart reappears exactly as it was left.

> 📝 Note — Saved sales live in this browser only. If you log in at a different till or on a different computer, sales saved elsewhere won't show up here.

## How To — Take Payment (Single Method)

*Why this matters:* This is where the sale is finalized and the invoice is created — get the amount and method right, because it posts to the books.

*Precision:* Exact. Confirm the Total on screen matches what you're collecting before clicking Confirm Payment — this step creates the invoice and payment record.

1. With items in the cart and a customer selected, click **Checkout (Ctrl+Enter)** at the bottom of the cart panel — or, if you already know it's cash or a split, use the quick pills above the button grid: **Cash (Alt+1)** or **Split Payment (Alt+2)**.
2. In the **Process Payment** window, confirm or change the **Payment Method** from the dropdown (the list is whatever methods the store has enabled, e.g. Cash, Credit Card, GCash).
3. For **Cash**, enter the amount the customer hands over in **Cash Tendered** — or click one of the quick-suggestion buttons (rounded amounts at or above the total) to fill it instantly. Leaving it blank or at 0 and confirming treats it as exact change. **Change Due** appears automatically once tendered covers the total.
4. For methods that need one (e.g. Credit Card's "Auth Code," GCash's "Transaction ID"), fill in the reference field that appears — it's required before you can confirm.
5. Click **Confirm Payment**. If no Physical Receipt No. has been entered and the store doesn't require one, POS asks **"Proceed Without Physical Receipt?"** — click **Proceed** to finish anyway, or **Cancel** to go back and add the number.
6. On success, a **Sale completed!** confirmation appears with a **Print Receipt** button — click it to open the receipt in a small print window and send it to the printer.

**Example:** Total is ₱504.00. The cashier selects **Cash**, clicks the ₱600.00 quick-suggestion button, sees **Change Due: ₱96.00**, and clicks **Confirm Payment**. The invoice is created, and the cashier clicks **Print Receipt** to hand the customer their copy.

## How To — Take Payment (Split Across Methods)

*Why this matters:* Some customers pay partly in cash and partly by another method (or partly on credit) — split payment records each portion correctly against the invoice.

*Precision:* Exact. Every payment line here posts to the invoice and, for On Account, to the customer's Accounts Receivable — check amounts and methods carefully before confirming.

1. This option only appears when the store has **Split Payment** turned on. Click **Checkout**, or the **Split Payment (Alt+2)** pill, to open it.
2. The summary at the top shows **Total Due**, **Total Payments**, **Remaining**, and (once applicable) **Change Due**.
3. For each payment line, pick a **Payment Method** — the dropdown notes whether it's *(instant)*, *(pending until settled)*, or *(on account)* — and enter the **Amount**. Click **FILL** to auto-fill whatever's still remaining into that line.
4. Add more lines with **Add Another Payment Method** if the customer is splitting across more than one method. Remove a line with the trash icon (you must keep at least one).
5. Fill in **Tendered** (for methods that allow change) and any required **Reference**, as prompted.
6. If any errors are listed under **Please fix the following errors**, resolve them — **Confirm Payment** stays disabled until `Remaining` reaches ₱0.00 (or is fully covered by an On Account line).
7. If part of the payment is On Account, POS shows a **Record as On Account?** confirmation explaining the invoice will stay unpaid and the amount becomes an Accounts Receivable charge — click **Confirm & Record On Account** to proceed.
8. Click **Confirm Payment** (`Ctrl+Enter` also works; `Esc` cancels).

**Example:** Total is ₱10,000.00. The customer pays ₱4,000.00 Cash and puts the remaining ₱6,000.00 On Account (they're a registered customer with credit terms). The cashier adds a Cash line for ₱4,000.00, clicks **Add Another Payment Method**, selects the On Account method, clicks **FILL** to capture the remaining ₱6,000.00, confirms the On Account warning, then clicks **Confirm Payment**.

## How To — Void a Transaction

*Why this matters:* Clears a cart that's gone wrong (wrong customer, wrong items, customer changed their mind) so you can start fresh — nothing has been charged yet, since Void only affects the cart, not a completed sale.

*Precision:* Flexible to use, but the click itself is a real action — a confirmation step and an Undo option protect against an accidental click.

1. Click the **Void Transaction** tile in the button grid, or press **Alt+X**. It's only active once the cart has at least one item.
2. Confirm in the **Confirm Void** window by clicking **Void Transaction** — or **Cancel** to back out.
3. The cart, customer, physical receipt number, and tax rate all reset. A toast appears with an **Undo** button for about 8 seconds if you voided by mistake.

**Example:** A cashier realizes they built the cart for the wrong customer entirely. They press **Alt+X**, click **Void Transaction** to confirm, and the cart clears. Two seconds later they realize a mis-click emptied a cart they actually needed — they click **Undo** on the toast and the cart is restored.

> ⚠️ Important — Void only clears the current, unpaid cart. It does not reverse a sale that has already been paid and turned into an invoice. To undo a completed sale, use a refund/credit note through Invoicing or Sales History instead.

## How To — Convert the Cart to an Invoice

*Why this matters:* Some sales need the fuller controls of the Invoicing screen (e.g. custom terms, additional line detail) rather than a straight POS checkout — this hands the cart off without re-entering every item.

*Precision:* Flexible — use it whenever a sale is better finished outside POS.

1. With items in the cart, click the **Convert to Invoice** tile in the button grid.
2. POS sends the current lines and selected customer to the Invoicing screen and clears the POS cart.
3. A confirmation toast, **Cart transferred to Invoicing page**, confirms the handoff.

**Example:** A commercial customer needs a formal invoice with payment terms rather than an immediate POS sale. The cashier builds the cart as normal, clicks **Convert to Invoice**, and finishes the sale on the Invoicing screen instead.

## How To — Print or Reprint a Receipt

*Why this matters:* The customer's copy of the sale — handed over at checkout, or reprinted if the first copy didn't come out.

*Precision:* Flexible — reprint as many times as needed; it doesn't change the invoice.

1. Right after a sale completes, click **Print Receipt** on the **Sale completed!** toast (it stays available for about 10 seconds).
2. A small print window opens showing the company name/address/phone, invoice number, physical receipt number (if one was entered), date and time, each line item with quantity/price/total, and the Subtotal/Tax/Total — the print dialog opens automatically and the window closes itself afterward.
3. If you missed the toast or need another copy, reprint from the invoice's record on the Sales History screen (POS itself only offers the print button right after checkout).

**Example:** The receipt printer jams mid-print. The cashier clears the jam and clicks **Print Receipt** again from the still-visible toast to try again.

## Field Reference

| Field/Control | Description | Notes |
|---|---|---|
| Search box (`Scan or search (Ctrl+F)...`) | Finds a part by scan, name, or number and opens Add Item to Sale. | Barcode scans (Enter with an unmatched value) go straight to an exact lookup; typed text searches with a short debounce. |
| New Part | Opens Add New Part to create and cart a part that doesn't exist yet. | Newly created part is added to the cart at quantity 1. |
| Sale Price (Add Item to Sale) | The price this line will sell at. | Defaults to the part's last sale price; editable per sale. |
| Quantity (Add Item to Sale) | Units being sold on this line. | Defaults to 1; must be a positive number. |
| Physical Receipt No. | The number from the pre-printed receipt booklet. | Auto-normalized to `LETTERS-DIGITS` on blur. May be required before payment, depending on store settings. If the number is already taken, the backend may auto-increment it and notify you. |
| Tax Rate | Fallback/override tax rate for lines without their own rate. | Loaded from the store's configured tax rates; one may be marked Default. |
| Cart line Quantity / Price | Editable per-line quantity and price. | Changing either recalculates Subtotal, Tax, and Total immediately. |
| Customer tile | Shows/selects the customer for this sale. | Defaults to Walk-in on load and after each completed sale. |
| Save Sale / View Saved | Parks the current cart in this browser for later; restores or deletes a parked cart. | Capped at 10 per cashier login; browser-local only. |
| Void Transaction | Clears the current, unpaid cart. | Confirmation required; Undo available for ~8 seconds after. |
| Convert to Invoice | Hands the current cart and customer to the Invoicing screen. | Clears the POS cart on success. |
| Checkout / Cash (Alt+1) / Split Payment (Alt+2) | Opens the payment window — single-method or split, depending on what's clicked and what the store has enabled. | Split Payment only appears if the store has it turned on. |
| Payment Method (Process Payment / Split Payment) | Which method is collecting this payment. | List and required fields (reference, receipt no., whether change is allowed) come from the store's configured payment methods — see [Accounts Receivable](./accounts_receivable_manual.md). |
| Cash Tendered | Amount of cash physically handed over. | Blank or 0 is treated as exact payment (no change). |
| Reference | Method-specific reference number (e.g. Auth Code, Transaction ID). | Only shown/required for methods configured to need one. |

## Common Errors & What They Mean

| Message / Situation | Meaning | What To Do |
|---|---|---|
| "Please add items to the cart." | You clicked Checkout with an empty cart. | Add at least one item first. |
| "Please select a customer." | Checkout or a payment pill was clicked with no customer chosen. | Pick a customer (Walk-in is fine for a normal counter sale) via the Customer tile. |
| "No item found for barcode \"...\"" | The scanned code doesn't match any part in the system. | Try searching by name instead, or check the part actually exists / has that barcode assigned. |
| "Physical Receipt No already exists." | Someone already used that receipt number on another invoice. | Double-check the number on the printed receipt, correct it, and try again — nothing was charged. |
| Confirm Payment stays greyed out with the receipt field empty | The store requires a Physical Receipt No. before finishing a sale. | Enter the receipt number from the printed slip, then confirm. |
| "\<Reference label\> is required." | The chosen payment method (e.g. Credit Card, GCash) needs a reference number and it's blank. | Fill in the reference field shown (its label varies by method) before confirming. |
| "On Account is not available for Walk-In customers." (Split Payment) | You tried to use On Account without a real, registered customer selected. | Select the actual customer via the Customer tile, then retry the On Account line. |
| "Change not allowed for \<method\>." | You entered a Tendered amount above the total for a method that doesn't support change (most non-cash methods). | Set Tendered equal to the Amount, or switch that line to Cash if change genuinely needs to be given. |
| "Amount must be greater than 0" (Split Payment) | A payment line has ₱0.00 or a blank amount. | Enter a positive amount, or remove that payment line if it isn't needed. |
| "Tax Anomaly" banner under the Total | The cart's tax math doesn't reconcile cleanly (e.g. an unusually high effective rate). | This is a safety check, not a charge that's happened yet — review the line prices and tax rates on the cart before checking out, or ask a manager if it persists. |
| "Current cart will be replaced. Continue?" (restoring a saved sale) | You're restoring a saved sale while the active cart still has items. | Confirm only if you're okay losing the current, un-saved cart; otherwise save or finish it first. |

## Related Modules

- [Accounts Receivable](./accounts_receivable_manual.md)
- [Sales History](./sales_history_manual.md)

## Advanced Reference (optional)

N/A
