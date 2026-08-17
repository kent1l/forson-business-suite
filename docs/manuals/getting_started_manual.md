---
module: Getting Started
page_component: LoginScreen.jsx, Dashboard.jsx
audience: All roles (Cashier, Warehouse/Inventory, Accounting, HR Admin, Manager, Admin)
verified_against: master @ 5d772b8
last_updated: 2026-08-17
---

# Getting Started

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
> - **What it's for:** Signing in to Forson Business Suite and reading the Dashboard, the landing page you see every time you log in.
> - **Who uses it:** Every role — cashiers, warehouse/inventory staff, accounting, HR admins, and managers all pass through this page.
> - **You'll mostly come here to:** Log in at the start of your shift and get a quick read on today's numbers before jumping into your actual work.

## Overview

Forson Business Suite is the company's all-in-one system for running the auto parts business — inventory, point of sale, invoicing, purchasing, accounts receivable/payable, expenses, HR, and reporting all live here instead of in separate tools or spreadsheets. This page covers the two things every single user sees before anything else: the **Sign In** screen, and the **Dashboard** that loads right after — a one-screen summary of the business that also acts as a launchpad to the rest of the app.

## Key Concepts

- **Permissions / role**: What you see on the Dashboard (and everywhere else in the app) depends on the permissions your account has been granted. Two cashiers can see different Dashboards — one might have an "Outstanding A/R" card and the other won't, simply because of what their role is allowed to view. This is normal; it is not a bug.
- **Session**: Once you sign in, the app remembers you (your session) so you don't have to log in again every time you refresh the page. A session ends when you log out, or automatically if it expires — you'll be returned to the Sign In screen either way.
- **KPI card**: A small tile at the top of the Dashboard showing one key number at a glance (e.g. Today's Revenue). "KPI" just means "key performance indicator" — a number worth checking daily.

## How To — Log In

*Why this matters:* This is the front door to the entire system — nothing else is reachable until you're signed in.

*Precision:* This is a fixed flow — there's no flexibility in how sign-in works, but there's nothing to get wrong beyond entering your credentials correctly.

1. Open Forson Business Suite in your browser. You'll land on the Sign In screen.
2. Enter your **Username** (e.g. `kent.pilar`) in the first field.
3. Enter your **Password** in the second field.
4. Select **Sign In**.

While the app checks your credentials, the button reads **Signing In...** and is disabled so you can't accidentally submit twice. If your credentials are correct, you're taken straight to the Dashboard. If not, see [Common Errors](#common-errors--what-they-mean) below.

> 💡 Tip — The sun/moon icon in the top-right corner of the Sign In screen switches between light and dark mode before you even log in, if you prefer to work in the dark.

**Example:** Kent types `kent.pilar` into Username, enters his password, and selects **Sign In**. The button briefly shows **Signing In...**, then the screen changes to his Dashboard, greeting him with "Good morning, Kent."

## How To — Read Your Dashboard

*Why this matters:* The Dashboard is a snapshot of the business the moment you log in — it's designed so you can tell at a glance whether anything needs your attention before you start your day's work.

*Precision:* This is just reading information, not entering it — there's no wrong way to look at it. Which cards and panels you see depends on your permissions, so don't be concerned if a coworker's Dashboard looks different from yours.

1. Note the greeting at the top ("Good morning," "Good afternoon," or "Good evening," followed by your first name) and the **Updated [time]** label next to it, which tells you how current the numbers below are.
2. Scan the KPI cards along the top row. Depending on your permissions, you may see any of:
   - **Today's Revenue** — total sales recorded today. Selecting the card takes you to Sales History.
   - **Outstanding A/R** — unpaid customer invoices. Selecting the card takes you to Accounts Receivable.
   - **Inventory Value** — total value of stock on hand. Selecting the card takes you to Inventory.
   - **Low Stock Alert** — how many items are at or below their minimum stock level. Selecting the card takes you to Inventory.
   - **Monthly Expenses** — operating costs recorded so far this month. Selecting the card takes you to Expenses.
3. Below the KPI cards, check the **Sales Trend** chart (sales over the last 30/90 days or this year — use the dropdown to change the range) and **Top Selling Products** (ranked by revenue, with units sold).
4. At the bottom, check **Recent Sales** (your latest invoices, with customer, invoice number, amount, and how long ago) and **Stock Alerts** (parts below their minimum, showing how many are left or "Out of stock," and the minimum threshold). Select **View all** or **Manage stock** to jump straight to the full page.

> 📝 Note — Every KPI card, chart, and panel is permission-gated. If you don't have access to a given area (say, Expenses), that card simply won't appear for you — it isn't hidden data you're missing out on by mistake.

**Example:** Maria, who has both sales and inventory permissions, logs in and sees "Today's Revenue: ₱18,450," notices "Low Stock Alert: 6 items" is highlighted, and selects that card to jump straight into Inventory and reorder the flagged parts.

## How To — Refresh Dashboard Data

*Why this matters:* Dashboard figures are a snapshot from when the page loaded — refreshing pulls the latest numbers without you having to reload the whole page.

*Precision:* This is a convenience feature you can use however suits you — there's no required schedule.

1. Select **Refresh** (top-right of the Dashboard) at any time to pull the latest figures. The button reads **Refreshing** while it works.
2. Alternatively, toggle **Auto-refresh** on to have the Dashboard quietly update itself every 30 seconds — useful if you're leaving it open on a screen during the day. Toggle it off again when you don't need it.

**Example:** A manager keeps the Dashboard open on a monitor at the front desk with **Auto-refresh** switched on, so Today's Revenue updates on its own as sales come in through the day.

## How To — Jump to a Task with Quick Actions

*Why this matters:* Quick Actions is a shortcut row so you can go straight into common tasks — creating an invoice, receiving stock, searching parts — without hunting through the sidebar menu.

*Precision:* This is just navigation — select whichever tile matches what you're about to do.

1. On the Dashboard, find the **Quick actions** row beneath the KPI cards.
2. Select a tile to jump to that task. Available tiles depend on your permissions and may include: **New invoice**, **Add stock**, **Find parts**, **Reports**, **Documents**, **Orders**, **Customers**, and **Settings**.

If none of your permissions match any of these actions, the row shows "No actions available to you" with a note to ask an administrator for access — see [Common Errors](#common-errors--what-they-mean).

**Example:** A warehouse clerk needs to log a delivery. Instead of digging through the sidebar, he selects **Add stock** from Quick Actions and lands directly on the goods receipt screen.

## How To — Switch Between Light and Dark Mode

*Why this matters:* Some people find a dark interface easier on the eyes, especially in low light. This is purely a display preference and has no effect on data.

*Precision:* Optional, flexible — switch as often as you like.

1. Select the sun/moon icon in the top-right corner of the Sign In screen or, once logged in, the header at the top of the app.
2. The icon shows a **sun** when you're in dark mode (select it to go back to light) and a **moon** when you're in light mode (select it to switch to dark).

## How To — Log Out

*Why this matters:* Logging out ends your session so the next person at the workstation can't act under your account — important on any shared computer (e.g. a POS terminal).

*Precision:* Fixed step, no flexibility needed.

1. Select the logout icon in the top-right of the header (next to your name).
2. You're returned to the Sign In screen immediately.

> ⚠️ Important — On a shared terminal (like a POS station), always log out at the end of your shift. Anything done under your account is attributed to you.

## Field Reference

| Field/Control | Description | Notes |
|---|---|---|
| Username | Your account username, entered on the Sign In screen. | Required to sign in; no format hint is enforced by the screen itself. |
| Password | Your account password, entered on the Sign In screen (masked). | Required to sign in. |
| Sign In | Submits your credentials. | Reads "Signing In..." and is disabled while the request is in progress. |
| Updated [time] | Timestamp shown under the Dashboard greeting. | Reflects the last time data was loaded or refreshed, not the current clock time. |
| Auto-refresh | Toggle in the Dashboard header. | When on, Dashboard data reloads automatically every 30 seconds. Off by default each time you load the page. |
| Refresh | Button in the Dashboard header. | Manually reloads all Dashboard data on demand. |
| Time range selector (Sales Trend chart) | Dropdown on the Sales Trend card. | Choose Last 30 Days, Last 90 Days, or This Year. |
| Sun/Moon icon | Appears on both the Sign In screen and the app header. | Toggles light/dark display mode; a personal display preference only. |

## Common Errors & What They Mean

| Message / Situation | Meaning | What To Do |
|---|---|---|
| "Login failed. Please try again." | Your username and password didn't match a valid account, or the server couldn't be reached. This is the generic fallback message and does not mean anything is broken on your end. | Double-check your username and password (watch for caps lock) and try again. If it keeps happening, ask an administrator to confirm your account is active. |
| A different error message appears under the password field | The server rejected the login for a specific reason (for example, an inactive account) and sent back a specific message instead of the generic one. | Read the message shown — it explains the specific reason. If unclear, contact an administrator. |
| "Error loading dashboard" (with a **Retry** button) | The Dashboard couldn't fetch its data — usually a temporary network hiccup, not lost data. Nothing on the Dashboard is editable, so nothing you've entered anywhere else is at risk. | Select **Retry**. If it keeps failing, check your internet connection or contact IT/an administrator. |
| "No actions available to you" in Quick Actions | Your account doesn't have permission for any of the Quick Actions shortcuts. Your other permissions (if any) are unaffected — you can still use the sidebar for whatever you are allowed to do. | Ask an administrator to grant the specific access you need (e.g. invoicing, inventory). |
| "You don't have access to activity data" (Recent Activity area) | You don't have sales or inventory view permission, so there's nothing for this section to show you. | Ask an administrator if you believe you should have this access. |
| You're unexpectedly returned to the Sign In screen | Your session expired, or another tab logged you out. This happens automatically for security — it doesn't mean you did anything wrong, and nothing you'd already saved is lost. | Simply sign in again. |

## Related Modules

- [Sales History](./sales_history_manual.md)
- [Accounts Receivable](./accounts_receivable_manual.md)
- [HR & Workforce](./hr_workforce_manual.md)

## Advanced Reference (optional)

N/A
