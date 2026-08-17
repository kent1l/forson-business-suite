---
module: Documents
page_component: DocumentsPage.tsx
audience: Admin, Manager
verified_against: docs/comprehensive-project-documentation-and-manual branch, commit 5d772b8
last_updated: 2026-08-17
---

# Documents

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
> - **What it's for:** A browsable library of business documents (invoices, GRNs, purchase orders,
>   sales records) with search, filtering, and an on-screen preview.
> - **Who uses it:** Admin, Manager.
> - **You'll mostly come here to:** Find a document by reference number or date, and preview it
>   on screen.

## Overview

**Documents** is a searchable library screen for records like invoices, Goods Receipt Notes (GRNs),
and purchase orders. You open it from the **Documents** entry in the sidebar. It gives you one place
to filter by document type or date range, search by reference number, and preview a document's
contents without leaving the page.

> 📝 Note — This screen is a **library/browser**, not an upload tool. There is no "Upload" or "Add
> Document" button here. You don't create documents in this screen; you look up ones that already
> exist in the library.

## Key Concepts

- **Document** — a record shown in the library, identified by a **Type** (e.g. `Invoice`, `GRN`,
  `PurchaseOrders`, `Sales`), a **Reference ID** (e.g. `INV-TEST-0001`), a **Status**, and a date.
- **Status** — one of `Draft`, `Final`, `Cancelled`, or `Archived`. This describes the state of the
  underlying record, not an action you take from this screen.
- **Preview** — a read-only, on-screen rendering of a document's key details (not the same as
  opening or downloading the original file).

> ⚠️ Important — As currently built, this library only shows documents that have already been
> loaded into it; creating an invoice, GRN, or purchase order elsewhere in the system does **not**
> automatically make it appear here yet. If a document you expect to see is missing, that's the
> likely reason — see [Common Errors & What They Mean](#common-errors--what-they-mean).

## How To — Find a Document

*Why this matters:* This is the main job of the screen — narrowing a potentially long list down to
the one record you need, using the same reference numbers and dates you already work with elsewhere
in the system.

*Precision:* This is a normal lookup task with no ledger impact — flex the steps to however you
normally search (type first, or date range first).

1. Open **Documents** from the sidebar.
2. To search by reference number, type into the **Search...** box at the top of the list. Results
   update automatically shortly after you stop typing.
3. To narrow by document type, open the filter panel on the left (click the funnel icon in the
   toolbar if the panel isn't already showing) and click a type under **TYPE**: **All**, **GRN**,
   **Sales**, **Invoice**, or **PurchaseOrders**.
4. To narrow by date, click a preset under **DATE RANGE** — **Last 7 days**, **Last 30 days**,
   **Last 90 days**, or **Last 365 days** — or click **Custom Range** to enter a **From** and **To**
   date and click **Apply**.
5. Scroll down to load more results; the library loads additional documents automatically as you
   near the bottom of the list.

**Example:** You need last month's copy of purchase order `PO-TEST-0001`. Click **PurchaseOrders**
under **TYPE**, then click **Last 30 days** under **DATE RANGE**. The card for `PO-TEST-0001` appears
in the results.

> 💡 Tip — Typing part of a reference number (e.g. `INV-TEST`) in the search box works the same as
> typing the full number — you don't need the exact match.

## How To — Preview a Document

*Why this matters:* Lets you check a document's details without leaving the library or hunting for
the original file elsewhere.

*Precision:* Normal default — just click through; there's nothing here that changes any records.

1. Find the document using the steps above.
2. Click anywhere on its card to open the **Preview** panel on the right side of the screen.
3. Review the on-screen preview.
4. Click **Close** in the top-right of the **Preview** panel when you're done.

**Example:** Clicking the card for `INV-TEST-0001` opens a preview panel showing the invoice number
and its summary details.

> 📝 Note — Each card also shows a share icon and a download icon. In the current version of the app
> these icons are not yet wired up to an action — clicking them does nothing. Use the on-screen
> **Preview** to review a document for now.

## Field Reference

| Field/Control | Description | Notes |
|---|---|---|
| Search box | Filters the list by reference number as you type. | Updates automatically a short moment after you stop typing. |
| Filter icon (toolbar) | Shows or hides the left-hand filter panel. | |
| Grid/List view icons (toolbar) | Intended to switch how results are displayed. | Currently the results always display as cards, regardless of which icon is selected. |
| TYPE filter | Narrows the list to one document type, or **All**. | Options: All, GRN, Sales, Invoice, PurchaseOrders. |
| DATE RANGE filter | Narrows the list to a preset window or a custom **From**/**To** range. | Presets: Last 7/30/90/365 days. Custom Range requires both dates before **Apply** does anything. |
| Document card — Type | The kind of record (e.g. Invoice, GRN). | Read-only. |
| Document card — Status | Draft, Final, Cancelled, or Archived. | Read-only; reflects the underlying record's state. |
| Document card — Share/Download icons | Displayed on every card. | Not functional in the current version — see note above. |
| Preview panel | Read-only rendering of the selected document's details. | Opens when you click a card; closes with the **Close** link. |

## Common Errors & What They Mean

| Message / Situation | Meaning | What To Do |
|---|---|---|
| The list is empty, or a document you expect isn't showing up | The library only lists documents that have been loaded into it — it doesn't automatically pick up every invoice, GRN, or purchase order the moment it's created elsewhere in the system. | Double-check your Type and Date Range filters aren't excluding it. If it's genuinely missing, this is expected with the current version of the module rather than something you did wrong — flag it to your administrator if you need it added. |
| "Failed to load documents." banner | The page couldn't reach the server, or your session doesn't have permission to view documents. | Wait a moment and try again. If it persists, confirm you're still logged in and that your role has the **View documents** permission; contact your administrator if not. |
| Clicking the share or download icon on a card does nothing | These icons are placeholders in the current version of the app — they aren't connected to an action yet. | This isn't an error on your part. Use **Preview** to review the document's details for now. |
| Preview panel shows "No preview available" | This specific document doesn't have preview content stored for it. | This isn't a problem with your search — some documents simply don't have a preview yet. |

## Related Modules

- [Invoicing & Statements](./invoicing_and_statements_manual.md)
- [Purchasing & Goods Receipt](./purchasing_and_goods_receipt_manual.md)
- [Sales History](./sales_history_manual.md)

## Advanced Reference (optional)

**How records get into this library today.** Unlike most modules in this suite, records here are not
created by day-to-day actions such as posting an invoice or receiving a GRN. In the current version of
the app, entries are added to the library directly (for example, during setup or data loading) rather
than being generated automatically as part of normal transaction workflows. If your team relies on
this screen to find real invoices, GRNs, or purchase orders, confirm with your administrator whether
your environment has been configured to load those records here, since an empty or sparse list may
simply reflect that no loading step has run yet — not a search problem.
