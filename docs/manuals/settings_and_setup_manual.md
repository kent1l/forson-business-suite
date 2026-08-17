---
module: Settings & Setup
page_component: SettingsPage.jsx, SetupPage.jsx, MobileSetupPage.jsx
audience: Administrator only (Settings and Setup pages are locked to permission level 10); Warehouse/Mobile staff use the Mobile Setup page to install the app
verified_against: master @ 5d772b8
last_updated: 2026-08-17
---

# Settings & Setup

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
> - **What it's for:** The very first admin account creation, and every company-wide, financial, and system configuration for Forson Business Suite — company details, branding, taxes, payment methods, backups, permissions, and mobile app distribution.
> - **Who uses it:** Administrators only. Everything on the Settings page is hidden behind an "Access Denied" wall for anyone without the Administrator role. Warehouse staff only touch the separate, public **Mobile Setup** page to install the app.
> - **You'll mostly come here to:** Update company info, add/edit tax rates, configure payment methods, and check on scheduled backups.

## Overview

This module covers three related but distinct screens: the one-time **Setup** wizard that runs the very first time the application is installed (creating the first administrator account), the **Settings** page where an Administrator configures how the whole company runs day to day, and the **Mobile Setup** page warehouse staff visit on their phone to download and install the Forson mobile app.

## Key Concepts

- **Administrator (permission level 10):** The single highest access role in the system. The Settings page checks for this exact permission level — anyone else who navigates there sees an "Access Denied" message instead of the page. If a setting in this manual seems unreachable, the most common reason is simply that the signed-in account isn't an Administrator.
- **Tab:** The Settings page is organized as one page with a row of tabs across the top (Company Info, Brand Identity, Financial, Payment Methods, Cycle Count, Deduplication, Tax Rates, Roles & Permissions, Backup & Restore, Data Utilities, Mobile App). Only one tab's content shows at a time; switching tabs does not save unsaved changes on the tab you're leaving.
- **OTA (Over-The-Air) update:** A way of pushing a new version of the mobile app to warehouse devices without anyone re-installing manually — the app checks its version number against what's configured here and prompts the user to update if they don't match.
- **Settlement type (payment methods):** Describes when money from a payment method actually counts as received: **Instant** (cash, card — counted right away), **Delayed** (bank transfer, cheque — held as pending until someone manually confirms it cleared), or **On Account** (no money changes hands at checkout; it becomes a receivable). This determines how the payment behaves everywhere else in the app (POS, invoicing, Accounts Receivable) — see [Accounts Receivable](./accounts_receivable_manual.md) for the full accounting impact of each settlement type.
- **rclone / Tailscale remote backup:** Optional off-site copies of your nightly backup, pushed to Google Drive (via a tool called rclone) or to another server over a private Tailscale network. Both require a one-time technical setup on the server itself, done by whoever manages your infrastructure — not something you configure entirely from this screen.

## How To — Create the First Administrator Account (Initial Setup)

*Why this matters:* This screen only ever appears once — the very first time Forson Business Suite is installed and no administrator account exists yet. It creates the account everyone else's access will eventually be set up from.

*Precision:* Follow this exactly. There is no way to skip or redo this step later through the UI — if you get locked out before another admin exists, you'll need direct database access to recover.

1. When the app loads with no existing accounts, you're shown the **Welcome to Forson Business Suite** screen automatically — you don't navigate here yourself.
2. Enter **First Name** and **Last Name**.
3. Enter a **Username**. This is what you'll type to sign in going forward, so pick something memorable and low-risk to mistype.
4. Enter a **Password**.
5. Select **Create Admin Account**. While it's working, the button reads **Creating Account...**.
6. On success you'll see a confirmation and be returned to the sign-in screen to log in with the credentials you just created.

**Example:** On a fresh install, Kent Pilar enters First Name `Kent`, Last Name `Pilar`, Username `kent.pilar`, and a password, then selects **Create Admin Account**. The toast reads "Admin account created successfully! Please log in," and he signs in as the system's first Administrator.

## How To — Update Company Information

*Why this matters:* Company Info feeds the header/footer of every invoice, statement, and printed document the system generates — customers and vendors see this exact information on paperwork, so it needs to be accurate.

*Precision:* This is a flexible default — update it whenever company details change (new address, new phone line). Nothing here posts to the ledger.

1. Go to **Settings**, then select the **Company Info** tab (this is the tab that's open by default).
2. Fill in **Company Name**, **Company Address**, **Company Phone**, and **Company Email**.
3. Optionally fill in **Company Website** and **Tax Identification No. (TIN)**.
4. Optionally fill in **Remittance Bank Name** and **Remittance Bank Account #** — these print on invoices so customers know where to send bank transfers.
5. Set **Application Timezone** from the dropdown (e.g. `Asia/Manila (PHT, UTC+8)`). This controls the timezone used for reports, backups, and scheduler logs across the whole app.
6. Select **Save Settings** at the bottom of the page.

**Example:** An admin updates **Company Phone** from an old landline to `+63 917 123 4567` and selects **Save Settings**; a "Settings saved successfully!" toast confirms the change.

## How To — Customize Brand Identity

*Why this matters:* Brand Identity controls the logo and color scheme shown across the app (sidebar, login page, buttons) — useful for making the system feel like "yours" rather than a generic template, and for keeping a consistent look on customer-facing documents.

*Precision:* This is entirely a flexible, cosmetic default — there's no wrong choice, and you can always undo it.

1. Go to **Settings** → **Brand Identity**.
2. Under **Logo**, use **Upload** next to **Full logo** (shown on the login page and the expanded sidebar) or **Icon logo** (shown in the collapsed sidebar and the browser tab). Accepted formats are PNG, SVG, or WebP, up to 2MB. Select **Remove** to clear a logo you've already uploaded.
3. Under **Brand colors**, either click one of the preset swatches (e.g. "Emerald," "Crimson," "Navy") to apply a pre-matched primary/accent pair, or pick custom colors under **Primary color** and **Accent color (optional)**.
4. Optionally expand **Advanced: separate colors for dark mode** to set different primary/accent colors specifically for users viewing the app in dark mode.
5. Check the **Live preview** panels (Light mode / Dark mode) to see how buttons, badges, and navigation will look before committing.
6. Select **Save Brand Identity**.

> 📝 Note — Success, warning, and danger colors (green/yellow/red) never change, no matter what brand colors you pick. That's intentional, so status meaning (e.g. "this is an error") stays consistent everywhere in the app.

Select **Reset to default theme** at any time to revert to the default "Forson Slate" theme and remove any uploaded logos — you'll be asked to confirm first, since this removes your custom logos.

**Example:** An admin clicks the **Navy** preset, uploads a square company mark as the **Icon logo**, checks both preview panels, then selects **Save Brand Identity**.

## How To — Configure Financial Defaults

*Why this matters:* These are default values applied across sales documents — the currency symbol shown throughout the app, the payment terms text that appears on new invoices, and a footer message printed on every invoice.

*Precision:* Flexible defaults — no ledger impact from changing these; they only affect how new documents are labeled and worded.

1. Go to **Settings** → **Financial**.
2. Set **Currency Symbol** (e.g. `₱`).
3. Set **Default Payment Terms** (e.g. `Net 30`) — the standard text shown on new invoices unless overridden per-customer elsewhere.
4. Set **Invoice Footer Message** — free text printed at the bottom of every invoice (e.g. thank-you note, return policy).
5. Select **Save Settings**.

## How To — Configure Payment Methods

*Why this matters:* This is where you define which payment methods staff can select at checkout and on Accounts Receivable/Payable screens (Cash, Card, Bank Transfer, GCash, On Account, etc.), and the rules each one enforces — whether it requires a reference number, whether change is allowed, and how it settles. Getting the **Settlement Type** right matters because it directly controls when a payment counts as collected money versus a pending receivable — see [Accounts Receivable](./accounts_receivable_manual.md) for the full accounting impact of each settlement type.

*Precision:* Adding a new method is a flexible, low-risk action. Changing the **Settlement Type** or deleting/disabling a method that's already in use by past transactions is higher-stakes — it changes how future transactions using that method are treated financially, so treat it as a step requiring exact attention, not a default to breeze through.

1. Go to **Settings** → **Payment Methods**.
2. Select **Add Method** to open the payment method form.
3. Enter a **Code** — a unique, lowercase, no-spaces identifier (e.g. `gcash`) — and a **Display Name** (e.g. `GCash`) shown to staff.
4. Choose a **Type**: Cash, Card (Credit/Debit), Bank Transfer, Mobile Payment, Credit Terms, Voucher/Gift Card, or Other. Picking a type auto-fills sensible defaults for the rules below (for example, Card auto-enables **Requires Reference/Auth Code** and **Requires Physical Receipt Number**; Credit Terms auto-sets Settlement Type to On Account).
5. Set **Sort Order** — a number controlling where this method appears in the list; lower numbers show first. You can also drag and drop rows in the method list to reorder them without editing this field directly.
6. Under **Payment Rules**, review and adjust as needed:
   - **Enabled** — whether staff can select this method right now.
   - **Requires Reference/Auth Code** — forces staff to enter a reference number (label it via the field that appears, e.g. "Auth Code," "Reference Number," "Transaction ID").
   - **Requires Physical Receipt Number** — forces staff to log a physical receipt number.
   - **Change Allowed** — whether the system allows giving change back on this method (only makes sense for Cash).
   - **Settlement Type** — **Instant** (funds received immediately — cash, cards), **Delayed** (funds settle later — bank transfer, cheque), or **On Account** (no payment now, invoice remains due).
7. Select **Create Method** (or **Update Method** when editing an existing one).

To disable a method instead of deleting it, select the **Enabled**/**Disabled** pill next to it in the list. To remove one entirely, select the trash icon — if the method has already been used on a transaction, the system automatically disables it instead of deleting it, so historical records stay intact.

> ⚠️ Important — Deleting a payment method that has transaction history doesn't actually delete it; the system silently converts the delete into a disable to protect past records. If you see a toast saying "disabled (was in use)" instead of "deleted," that's expected, not an error.

**Example:** An admin adds a new method with Code `gcash`, Display Name `GCash`, Type `Mobile Payment` (which auto-sets **Requires Reference/Auth Code** with label "Transaction ID" and Settlement Type `Instant`), then selects **Create Method**.

## How To — Set Up Tax Rates

*Why this matters:* Tax rates determine how much tax is calculated on parts and services. The default tax-inclusive setting here also controls how new parts are priced by default in Inventory.

*Precision:* Follow exactly — tax rates feed directly into pricing and invoice totals shown to customers, so an incorrect percentage here produces incorrect invoices until it's fixed.

1. Go to **Settings** → **Tax Rates**.
2. To change how *new* parts are priced by default, toggle **New parts default to "Price is Tax Inclusive"** — this only affects parts created after the change, never existing parts.
3. Select **Add Tax Rate** (or **Add your first tax rate** if none exist yet).
4. Enter a **Rate Name** (e.g. `VAT`) and a **Rate Percentage** as a decimal, not a whole number — `0.12` for 12%, not `12`. The form shows you the equivalent percentage live as you type, so you can double check before saving.
5. Select **Save**.
6. To make a rate the one applied by default across the system, select **Set Default** next to it in the list — the currently default rate is marked with a star and the label **Default**.
7. To edit or remove a rate, use the pencil or trash icon next to it. The default rate can't be deleted (the trash icon is disabled) — set a different rate as default first if you need to remove it.

### Key Calculations

**Rate Percentage → Displayed Tax Rate = Rate Percentage × 100.** The field stores tax rates as a decimal fraction of 1, not a whole-number percentage: entering `0.12` in Rate Percentage displays as "This represents 12.00%," and a tax rate list entry stored as `0.12` displays as `(12.00%)` next to its name.

**Example:** An admin adds Rate Name `VAT`, Rate Percentage `0.12`, sees "This represents 12.00%" confirm the entry, saves it, then selects **Set Default** so `VAT (12.00%)` becomes the star-marked default rate applied system-wide.

## How To — Configure Cycle Counting

*Why this matters:* Cycle counting is the practice of continuously spot-checking small batches of inventory instead of doing one giant annual count — this tab controls whether that process runs automatically and how it prioritizes which parts to count.

*Precision:* Flexible defaults for a warehouse process you can tune over time; not a financial posting by itself, but the Auto-Approve limits below directly control which count variances get applied to inventory without a human reviewing them first, so treat those two fields with care.

1. Go to **Settings** → **Cycle Count**.
2. Check **Turn on automated nightly task generation** to enable the feature.
3. Set **Schedule (CRON format)** — a cron expression (e.g. `0 2 * * *` for 2:00 AM daily) controlling when nightly count tasks are generated.
4. Set **Items Per Batch** — how many parts get queued per generated batch.
5. Set the scoring weights that decide which parts are prioritized for counting: **Points per day uncounted**, **Points per sale (30d)**, and **Points for negative stock** — higher weights make that factor matter more when ranking which parts need counting soonest.
6. Set **Auto-Approve Max Variance Qty** and **Auto-Approve Max Financial Impact** — count discrepancies at or below both thresholds are applied automatically without needing manual review; anything above either threshold is held for a person to approve.
7. Select **Save Settings**.

> ⚠️ Important — Auto-Approve Max Financial Impact controls how large a discrepancy can silently adjust your inventory value without anyone reviewing it. Set this conservatively; a high number here means bigger count errors can slip through unnoticed.

## How To — Manage Deduplication

*Why this matters:* Over time, duplicate part records tend to accumulate (the same part entered twice under slightly different names). This tab runs an automated, AI-assisted scan that finds likely duplicates and queues them as suggestions for review elsewhere in the app, rather than merging anything on its own.

*Precision:* Flexible — turning the nightly scan on/off or triggering a manual scan doesn't change any data by itself; it only generates suggestions for someone to review and approve later.

1. Go to **Settings** → **Deduplication**.
2. Toggle **Nightly Background Deduplication Scan** on or off — when on, the system automatically scans the full parts catalog every night for likely duplicates.
3. To run a scan immediately instead of waiting for the nightly run, select **Start Manual Scan** under **Trigger On-Demand Scan** (only available when no scan is already running).
4. While a scan is running, the page shows a live progress card with **Processed**, **In Queue**, **AI Calls Made**, and **Groups Found** counts, updating automatically.
5. Review **Current Suggestions Queue** for a breakdown of pending matches by confidence: **Exact Matches**, **AI Confirmed**, **AI Suggested**, and **Low Confidence**.
6. Review **Recent Scan Runs** for a history of past batches, their duration, and status.

> 📝 Note — This tab only finds and queues suggestions; it does not merge any part records by itself. Reviewing and approving suggested merges happens elsewhere in Inventory, not on this page.

## How To — Manage Roles & Permissions

*Why this matters:* This controls exactly what each role in the system (Cashier, Warehouse, Accounting, HR Admin, Manager, etc.) is allowed to see and do. It's the single place that answers "why can't this staffer see that screen."

*Precision:* Follow carefully — over-granting permissions here is a real security exposure (e.g. giving a Cashier role access to financial settings), and under-granting blocks staff from doing their job. Take a moment to understand what a permission actually unlocks before checking it.

1. Go to **Settings** → **Roles & Permissions**.
2. Choose a role from **Select a Role to Edit**.
3. Review the permission checkboxes, grouped by category. Each one is labeled with a plain description of what it grants.
4. Check or uncheck permissions as needed for that role.
5. Select **Save Permissions**.

> ⚠️ Important — Changes here apply to every user currently assigned that role, immediately. There's no confirmation step before saving, so double-check your checkbox choices, especially for roles with broad reach (e.g. Manager), before selecting **Save Permissions**.

## How To — Manage Backups & Restore

*Why this matters:* Backups are your safety net against data loss — hardware failure, accidental deletion, or a bad import. This tab controls how often local backups run, how long they're kept, whether copies are also pushed off-site, and lets you manually trigger, download, upload, or restore a backup.

*Precision:* Retention and schedule settings are flexible defaults you can tune to your risk tolerance. **Restore is the one action on this entire page that must be treated with full precision** — it overwrites all current data and cannot be undone.

1. Go to **Settings** → **Backup & Restore**.
2. Under **Local Backup Configuration**, set **Retention Period (Days)** (how long local backup files are kept before automatic deletion) and **Backup Schedule (Cron)** (e.g. `0 2 * * *`; the field shows a plain-language description like "Every day at 2:00 AM" once you enter a valid expression).
3. Under **Remote Backup (Redundancy)**, optionally toggle **Google Drive** and/or **Tailscale rsync** on to push a copy of every backup off-site after the local copy completes. Each shows a **rclone Remote Path** (Google Drive) or **Peer Host** / **Destination Path on Peer** (Tailscale) field once enabled, along with a one-time server setup checklist (running `rclone config`, generating SSH keys, etc.) that whoever manages your server infrastructure needs to complete — this isn't something you finish entirely from the browser.
4. If either remote target is enabled, set **Remote Retention Period (Days)** for how long off-site copies are kept.
5. Select **Save Settings** to apply schedule/retention/remote changes.
6. To create a backup right now instead of waiting for the schedule, select **Backup Now** in the **Available Backups** list.
7. To bring in a backup file from elsewhere, select **Upload Backup**, choose a `.sql`, `.sql.gz`, or `.gz` file. After it uploads, you're asked whether to restore from it immediately (**Yes, Restore Now**) or just keep it in the list (**Keep in List Only**).
8. To restore from any existing backup in the list, select **Restore** next to it, then confirm **Yes, Restore** in the warning prompt.

> ⚠️ Important — Restoring a backup overwrites **all current data** with whatever was in that backup file, and this cannot be undone. The app reloads automatically a few seconds after a successful restore. Only restore when you're certain — for example, recovering from a confirmed data problem — not as something to try casually.

**Example:** An admin sets **Retention Period (Days)** to `14`, enables **Google Drive**, enters `gdrive:forson-backups` as the **rclone Remote Path**, saves, then selects **Backup Now** to trigger an immediate on-demand backup and confirm the pipeline works end to end.

## How To — Use Data Utilities (Export, Import, Search Repair)

*Why this matters:* This tab handles bulk data movement in and out of the system — exporting Parts, Customers, or Suppliers to a spreadsheet, importing them back in bulk, and repairing the internal search index if search results start looking stale or wrong.

*Precision:* Exporting is completely safe. Importing can overwrite existing records that match on a unique key (SKU, Email), so treat an import file the same way you'd treat any bulk edit — review it before uploading, don't guess at the format.

1. Go to **Settings** → **Data Utilities**.
2. Under **Export Data**, select **Export Data** on the Parts, Customers, or Suppliers card to download the current data as a CSV, or **Download Template** to get a blank CSV with the correct column headers for that entity.
3. Under **Import Data**, choose a `.csv` file for Parts, Customers, or Suppliers, then select **Import [entity]**. Rows matching an existing record by its unique key (e.g. SKU for Parts, Email for Customers) are **updated**; rows that don't match are **created new**.
4. Under **Search Index**, select **Repair Search Index** if search results feel stale or incomplete. Choose **Dry-run** (checks connectivity and counts only, changes nothing) or **Full repair** (applies settings and reindexes all parts), then select **Queue Dry-run** or **Queue Repair**. Progress shows live in a modal with **Total**, **Processed**, **Success**, **Failed**, and an ETA; select **Cancel Job** to stop a running repair.

> ⚠️ Important — Importing Parts, Customers, or Suppliers updates existing records in place when the unique key matches. Always start from **Download Template** so your column headers line up correctly, and double check a sample of the file before importing a large batch.

## How To — Configure the Mobile App & Provision Devices

*Why this matters:* This controls what version of the Android warehouse app is pushed to staff phones (OTA update), and gives you a quick way to get a warehouse device onto the install page without typing a URL.

*Precision:* Flexible for release notes wording; the version number itself is exact — every active mobile device compares its version against this value, so entering the wrong version forces devices to "update" to a version that may not match what's actually deployed.

1. Go to **Settings** → **Mobile App**.
2. Set **Mobile App Version (OTA Update)** to the new version number (e.g. `1.2.0`). Changing this forces every active mobile warehouse client to download the latest `.apk` the next time it checks in.
3. Optionally fill in **Release Notes (Optional)** — shown to staff on their device's update screen (e.g. "Added new barcode scanning features...").
4. Select **Save Settings**.
5. To get a device onto the install page quickly, select **Show QR Code** under **Device Provisioning**. Point the warehouse device's camera at the QR code shown to open the Mobile Setup page directly (see [Install the Mobile App](#how-to--install-the-mobile-app-on-a-warehouse-device) below).

**Example:** After releasing a new APK build, an admin sets **Mobile App Version (OTA Update)** to `1.3.0`, writes "Fixed barcode scanner crash on older Android devices" in **Release Notes**, and selects **Save Settings** — every warehouse device now sees an update prompt on its next check.

## How To — Install the Mobile App on a Warehouse Device

*Why this matters:* This is the page warehouse/inventory staff use — on their own phone, not through Settings — to download and install the Forson Android app that gives them barcode scanning and inventory tools on the floor.

*Precision:* This is a simple default flow — follow the on-screen numbered steps; there's little room to get it wrong.

1. On the warehouse device, open the Mobile Setup page — either by scanning the QR code an admin generated in **Settings** → **Mobile App**, or by browsing directly to `/mobile-setup`.
2. The page shows the current app **Version** available and, if provided, a **What's New** section with the admin's release notes.
3. Select **Download App (.apk)**.
4. Open the downloaded `.apk` file from the device's notifications or Downloads folder.
5. If the device blocks the install for security, tap **Settings** in the prompt, toggle **Allow from this source**, then go back and tap Install.

**Example:** A new warehouse hire scans the QR code shown on an admin's screen, lands on the Mobile Setup page showing "Version 1.3.0 Available," taps **Download App (.apk)**, opens the file from Downloads, allows installation from that source when prompted, and the Forson app installs.

## Field Reference

| Field/Control | Description | Notes |
|---|---|---|
| Company Name / Address / Phone / Email | Core company identity, printed on documents | Company Info tab |
| Company Website / Tax Identification No. (TIN) | Optional company identifiers | Company Info tab |
| Remittance Bank Name / Remittance Bank Account # | Printed on invoices so customers know where to send bank transfers | Company Info tab |
| Application Timezone | Default timezone for reports, backups, and scheduler logs | Company Info tab; defaults to Asia/Manila |
| Full logo / Icon logo | Branding images shown on login/sidebar/favicon | Brand Identity tab; PNG/SVG/WebP, max 2MB |
| Primary color / Accent color | Brand colors used for buttons, badges, nav highlights | Brand Identity tab; success/warning/danger colors are fixed and unaffected |
| Currency Symbol | Symbol shown throughout the app (e.g. ₱) | Financial tab |
| Default Payment Terms | Default terms text on new invoices | Financial tab |
| Invoice Footer Message | Free text printed on every invoice | Financial tab |
| Code / Display Name | Unique identifier and shown label for a payment method | Payment Methods tab; Code must be unique, lowercase, no spaces |
| Type | Cash, Card, Bank Transfer, Mobile Payment, Credit Terms, Voucher/Gift Card, Other | Payment Methods tab; auto-fills rule defaults |
| Settlement Type | Instant / Delayed / On Account | Payment Methods tab; controls when a payment counts as collected — see [Accounts Receivable](./accounts_receivable_manual.md) |
| New parts default to "Price is Tax Inclusive" | Whether newly created parts price tax-inclusive by default | Tax Rates tab; does not affect existing parts |
| Rate Name / Rate Percentage | Tax rate name and value as a decimal (0.12 = 12%) | Tax Rates tab |
| Turn on automated nightly task generation | Enables/disables nightly cycle count task generation | Cycle Count tab |
| Schedule (CRON format) | When nightly cycle count tasks generate | Cycle Count tab; e.g. `0 2 * * *` |
| Auto-Approve Max Variance Qty / Auto-Approve Max Financial Impact | Thresholds below which count discrepancies auto-apply without review | Cycle Count tab; set conservatively |
| Nightly Background Deduplication Scan | Enables/disables the automatic nightly duplicate-finder | Deduplication tab; only produces suggestions, never auto-merges |
| Select a Role to Edit | Chooses which role's permission set you're viewing/editing | Roles & Permissions tab |
| Retention Period (Days) | How long local backups are kept before auto-deletion | Backup & Restore tab; default 7 |
| Backup Schedule (Cron) | When automatic backups run | Backup & Restore tab; default `0 2 * * *` |
| Google Drive / Tailscale rsync | Optional off-site backup targets | Backup & Restore tab; require one-time server-side setup |
| Remote Retention Period (Days) | How long off-site backups are kept | Backup & Restore tab; default 30 |
| Mobile App Version (OTA Update) | Version string compared against every mobile device | Mobile App tab; changing it forces devices to update |
| Release Notes (Optional) | Text shown to staff on the mobile update screen | Mobile App tab |

## Common Errors & What They Mean

| Message / Situation | Meaning | What To Do |
|---|---|---|
| "Access Denied" on the Settings page | Your account isn't an Administrator (permission level 10) | Ask an Administrator to make the change for you, or to review your role's permissions if you believe you should have access. |
| "Rate name is required." | You tried to save a tax rate with no name entered | Enter a Rate Name before saving. |
| "Rate percentage must be a number between 0 and 1 (e.g., 0.12 for 12%)." | You entered a whole number (like `12`) instead of a decimal (`0.12`) for a tax rate, or left it blank/invalid | Re-enter the rate as a decimal fraction — 12% is `0.12`, not `12`. |
| "Authentication expired. Please log out and log back in." | Your session timed out while you were working | Log out and log back in, then retry the save — nothing was lost except this one action. |
| Payment method deleted but toast says "disabled (was in use)" instead | The method has already been used on past transactions, so the system protects that history by disabling it instead of deleting it | Nothing to fix — this is expected behavior. The method just stops appearing as selectable; existing records referencing it are untouched. |
| "Please select a file to import." | You clicked Import without choosing a CSV file first | Select a file, then click Import again. |
| Import completes but some rows look wrong | The CSV's unique key (SKU/Email) matched an existing record and updated it in place, or a column didn't line up with the template | Start from **Download Template** for the correct headers, review the file carefully, and re-import. |
| Backup restore prompt: "This will overwrite all current data...This cannot be undone." | You're about to replace everything currently in the system with the selected backup's contents | Only proceed if you're certain this is the backup you want. If unsure, cancel and download the backup file first to inspect it, or confirm with another admin. |
| Mobile Setup page falls back to "1.0.0" | The device couldn't reach the server to check the real configured version | Check the device's network connection; retry loading the page. This doesn't affect the actual server-side version setting. |

## Related Modules

- [Accounts Receivable](./accounts_receivable_manual.md) — how each payment method's settlement type affects invoice balances, collected cash, and A/R once staff actually use these methods on a transaction.
- [Getting Started](./getting_started_manual.md) — signing in, and the Dashboard every role lands on after login.

## Advanced Reference (optional)

N/A
