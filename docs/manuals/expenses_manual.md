---
module: Expenses
page_component: ExpensesPage.jsx, ExpenseCategoriesPage.jsx, ExpenseLexiconPage.jsx
audience: Accounting Staff, Finance Staff, Manager
verified_against: master @ 5d772b8
last_updated: 2026-08-17
---

# Expenses

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
> - **What it's for:** Recording, classifying, and auditing business expenses (utilities, rent, supplies, and other operating costs) outside of purchasing/inventory.
> - **Who uses it:** Accounting staff, finance staff, and managers who need to log spending or review how expenses are being categorized.
> - **You'll mostly come here to:** Record a new expense, and review the terms the system has picked up from everyday language under **Learned Terms**.

## Overview

The Expenses module is where operating expenses — the day-to-day costs of running the business that aren't tied to a purchase order or inventory item — get logged, classified by category, and tracked over time. It has three parts: the **Expenses** list where records are entered and reviewed, **Expense Categories** where the classification list itself is managed, and **Learned Terms**, where the system's natural-language shorthand for expense entry is kept accurate.

## Key Concepts

- **Expense Category** — the classification bucket an expense is filed under (e.g. "Utilities," "Rent," "Transportation & Delivery"). Every expense must have one; categories are managed separately under [Manage Expense Categories](#how-to--manage-expense-categories).
- **Payee / Vendor** — who the money was paid to (e.g. "Meralco," "Landlord"). Free text, but the field suggests names you've used before so the same vendor doesn't end up spelled two different ways in reports.
- **Payment Method** — how the expense was paid. You can pick one of the configured payment methods (e.g. Cash, GCash, Bank Transfer), or leave it as the **Custom / Cash Default** option, in which case the record simply stores "Cash."
- **Reference / OR / Receipt No.** — the document number tied to the expense (official receipt, invoice number, etc.), for audit trail purposes. Optional, but recommended whenever a physical receipt exists.
- **Void** — the way an incorrect expense record is removed from the books. Voiding does not delete the record; it soft-deletes it, excluding it from totals while keeping it visible (struck through) for audit history. This cannot be undone.
- **Quick Entry (AI Assisted)** — a text box where you can type an expense description in plain, everyday language — including local shorthand or Cebuano/Bisaya, e.g. *"Bayad 4,500 sa fibeco para sa kuryente gahapon, Cash"* — and the system will attempt to extract the amount, date, category, payee, and payment method automatically, pre-filling the expense form for you to review before saving.
- **Learned Expense Terms (Lexicon)** — every time staff use Quick Entry, the system collects the words and phrases they typed and, over time, suggests what a given term seems to mean (which category, payee, or payment method it maps to). These suggestions do **not** affect how future expenses are entered until someone reviews and approves them on the **Learned Terms** page. Think of it as the system's personal dictionary of your team's shorthand, which you curate.
- **Needs Review / Active Terms / Ignored** — the three states a learned term can be in. **Needs Review** is a new suggestion nobody has acted on. **Active Terms** are approved and will influence future Quick Entry parsing. **Ignored** terms are suggestions someone decided not to use — they stay logged but have no effect.
- **Possible Duplicate Warning** — when saving an expense, the system checks whether an expense with the same date, amount, and payee already exists and warns you before saving. This is advisory only; it will never block you from saving a genuine second expense that happens to match.

### Key Calculations (if applicable)

**Filtered Total Expenses = sum of the "Total" amounts shown in the Expenses by Category breakdown, for the currently applied date filter.**
Example: if Utilities shows ₱12,500.00 and Rent shows ₱25,000.00 for the selected date range, the Filtered Total Expenses card shows ₱37,500.00.

**Category share (the bar under each category in "Expenses by Category") = that category's total ÷ Filtered Total Expenses × 100.**
Example: Utilities at ₱12,500.00 out of a ₱37,500.00 filtered total is 12,500 ÷ 37,500 × 100 = **33%** of the bar.

## How To — Record a New Expense

*Why this matters:* This is the core job of the module — every operating cost that isn't a purchase order gets logged here so it shows up correctly in expense reports and category totals.

*Precision:* Follow these steps exactly for the **Amount**, **Expense Date**, and **Category** fields — these feed directly into expense totals and reporting. The remaining fields (Payee, Payment Method, Reference No., Notes) are helpful detail but can be filled in with normal judgment.

1. On the **Expenses** page, click **Record New Expense**.
2. Enter the **Amount (₱)** — this is required and must be a positive number.
3. Set the **Expense Date** — defaults to today.
4. Choose a **Category** from the dropdown — this is required.
5. Optionally choose a **Payment Method**, or leave it on **Custom / Cash Default** if it was paid in cash.
6. Optionally fill in **Payee / Vendor** — start typing to see suggestions from names used before, and pick an existing one when it matches so reports group correctly.
7. Optionally add the **Reference / OR / Receipt No.** and any **Notes / Remarks**.
8. Click **Save Expense Record**.

> ⚠️ Important — If the system finds an existing expense with the same date, amount, and payee, it shows an amber warning ("This looks like it may already be recorded") instead of saving immediately. If this is genuinely a separate expense, click the button again — it will now read **Save anyway**.

**Example:** You pay ₱4,500.00 to Meralco for electricity on August 15, 2026, by Cash. You click **Record New Expense**, enter `4,500.00` as the Amount, set the date to `2026-08-15`, choose **Utilities** as the Category, leave Payment Method as **Custom / Cash Default**, type `Meralco` as the Payee, and enter `OR-2026-9941` as the Reference No. Clicking **Save Expense Record** shows the toast "Expense recorded successfully!" and the entry appears at the top of the list.

## How To — Record an Expense with Quick Entry

*Why this matters:* Quick Entry lets you record an expense the way you'd say it out loud, in English, Bisaya, or a mix, instead of hunting through dropdowns — useful when you're logging several small expenses quickly. It also feeds the [Learned Terms](#how-to--review-learned-expense-terms) system, so the more it's used, the better it gets at understanding your team's shorthand.

*Precision:* The description you type can be as informal as you like — this is meant to flex to how you naturally talk. However, always review the fields it pre-fills before saving; treat the AI's output as a draft, not a final answer, especially anything marked with a low-confidence warning.

1. In the **Quick Entry** box at the top of the Expenses page, type a description of the expense, e.g. `Bayad 4,500 sa fibeco para sa kuryente gahapon, Cash`.
2. Click **Parse with AI** (the button is disabled until you've typed something).
3. Wait for it to finish (it shows **Analyzing...** while working). On success, a toast reads "AI successfully extracted expense details!" and the expense form opens with fields pre-filled.
4. Fields the AI filled in are marked with a small **◆ AI** tag; any field it wasn't confident about shows a **⚠️ Low confidence** badge with a percentage — double-check those before saving.
5. Correct anything that's wrong, then click **Save Expense Record** as normal.

> 📝 Note — If the AI can't parse your text, or the AI service is unavailable, you'll see a toast telling you it's falling back to manual entry. Nothing is lost — just fill in the **Record New Expense** form by hand instead.

> 💡 Tip — Any corrections you make to AI-filled fields are used behind the scenes to improve future parsing and to build entries on the [Learned Terms](#how-to--review-learned-expense-terms) page — so correcting a wrong category or vendor name isn't wasted effort.

**Example:** You type `Bayad 4,500 sa fibeco para sa kuryente gahapon, Cash` into Quick Entry and click **Parse with AI**. The form opens with Amount `4,500.00`, Category `Utilities`, Payee `FIBECO`, Payment Method `Cash`, and yesterday's date already filled in, each tagged **◆ AI**. You review them, they look correct, and you click **Save Expense Record**.

## How To — Edit an Expense Record

*Why this matters:* Corrects mistakes in an expense that's already been saved (wrong amount, wrong category, etc.) without creating a duplicate entry.

*Precision:* Follow exactly — any change here affects expense totals and category reporting immediately.

1. Find the expense in the list and click the edit (pencil) icon in the **Actions** column. (Voided expenses cannot be edited.)
2. The **Edit Expense Record** form opens, pre-filled with the existing values, showing `Expense #<id>` under the title.
3. Update whichever fields need correcting.
4. Click **Update Expense**.

**Example:** Expense #482 was accidentally recorded under "Office Supplies" instead of "Equipment." You click the pencil icon on that row, change the **Category** dropdown to **Equipment**, and click **Update Expense**. The toast reads "Expense record updated successfully!".

## How To — Duplicate an Expense

*Why this matters:* Recurring costs like rent or subscriptions are easiest to log by reusing the last entry instead of retyping everything.

*Precision:* This is a convenience default — review the date and amount before saving, since those are the fields most likely to need changing.

1. Find a past expense in the list and click the copy icon in the **Actions** column.
2. A **Duplicate Expense** form opens, pre-filled with that expense's details, except the date defaults to today and the Reference No. is cleared (reference numbers are unique per document and should not be copied).
3. Adjust the amount, date, or any other field as needed.
4. Click **Save Expense Record**.

**Example:** Monthly rent of ₱25,000.00 to "Landlord" was recorded last month. This month, you click the copy icon on that row, confirm the date now reads today's date, confirm the amount is still ₱25,000.00, and click **Save Expense Record** to log this month's rent as a new record.

## How To — Void an Expense Record

*Why this matters:* Removes an incorrect expense from financial totals while preserving an audit trail — the correct way to "delete" an expense once it's been saved.

*Precision:* Follow exactly. Voiding cannot be reversed, and a reason is required so there's a record of why the expense was removed from the books.

1. Click the trash icon in the **Actions** column for the expense you want to void. (Already-voided expenses don't show this option.)
2. In the **Void Expense Record** dialog, enter a **Reason for Voiding** — at least 5 characters, describing why.
3. Click **Confirm Void**.

> ⚠️ Important — "Voiding soft-deletes this expense record from financial summary totals. This action cannot be reversed," as the dialog itself states. The record stays visible in the list (struck through, tagged **VOIDED**) for audit purposes, but it drops out of all totals and category summaries.

**Example:** Expense #501 for ₱1,200.00 was entered twice by mistake. You click the trash icon on the duplicate row, type "Duplicate entry, same receipt as #500" as the reason, and click **Confirm Void**. The toast reads "Expense record voided successfully," and the row now shows a **VOIDED** tag with a strikethrough.

## How To — Filter and Review Expenses

*Why this matters:* Lets you find a specific expense or narrow the list down for review — by payee, category, payment method, or date range — instead of scrolling the full history.

*Precision:* This is a normal, flexible default — adjust filters however suits what you're looking for.

1. In the **Filter & Search Expenses** panel, use any combination of: the **Search payee...** box, the **Category** dropdown, the **Payment Method** dropdown, and the **From Date** / **To Date** fields.
2. Check **Show voided expense records** if you also want to see voided entries in the list.
3. Click any sortable column header (**Date**, **Category**, **Amount**) to sort by it — click again to flip the sort direction.
4. Click **Clear All Filters** (appears once any filter is active) to reset back to the full list.

The panel footer always shows how many records are currently displayed, e.g. "Showing 25 of 143 expenses."

## How To — Manage Expense Categories

*Why this matters:* Keeps the classification list clean and consistent so expense reporting stays meaningful — new categories should be added deliberately, not created ad hoc while recording an expense.

*Precision:* This is a normal default — add, rename, and reorder categories as your reporting needs evolve. Deactivating a category is reversible (via **Reactivate**), but be aware of the effect described below before doing it.

1. Go to **Expense Categories** in the sidebar (under Finance & Expenses).
2. To add one, click **Add Expense Category**, fill in **Category Name** (required) and an optional **Description**, and click **Create Category**.
3. To edit one, click **Edit** on its row, change the fields, and click **Update Category**.
4. To reorder the list, use the up/down arrows in the **Reorder** column — the new order saves immediately.
5. To retire a category without deleting its history, click **Deactivate** on its row; click **Reactivate** to bring it back.

> 📝 Note — Deactivating a category removes it from the **Category** dropdown offered when recording or editing an expense, so staff can no longer file new expenses under it. Expenses already recorded under it keep their category and are unaffected.

**Example:** You want to retire the "Miscellaneous" category and stop new expenses from using it. On the **Expense Categories** page, you find its row and click **Deactivate**. Its status badge changes from **ACTIVE** to **INACTIVE**, and it no longer appears in the Category dropdown on the expense form — but past expenses filed under it are untouched.

## How To — Review Learned Expense Terms

*Why this matters:* Quick Entry gets smarter over time by learning the words your team actually uses, but it should never guess silently — this page is where a human confirms what each term means before it's trusted for future parsing.

*Precision:* This is a normal review task, not a scripted one — read each suggestion and use judgment on whether it's correct.

1. Go to **Learned Terms** in the sidebar (under Finance & Expenses). New suggestions land under the **Needs Review** tab, with a count badge showing how many are waiting.
2. For each entry, read the term and what it's suggested to mean, e.g. `fibeco` means `FIBECO Electric` — the small badge next to it shows whether it maps to a **Category**, **Payee**, or **Payment Method**. A green **Bisaya** tag marks terms detected as Cebuano.
3. If it's correct, click **Use this** to move it to **Active Terms** — it will now be applied automatically in future Quick Entry parsing.
4. If it's wrong or not useful, click **Ignore** to move it to the **Ignored** tab without deleting it.
5. If a category term maps to the wrong category, click the pencil icon, choose the correct category from the dropdown, and click **Save**.
6. To remove a term entirely (not just ignore it), click the trash icon.

> 📝 Note — Approving, ignoring, or correcting a term never changes anything about expenses already recorded — it only affects how future Quick Entry text gets interpreted.

**Example:** Under **Needs Review**, you see the term `kuryente` suggested to mean the category `Utilities`, seen 6 times, with an example input of "bayad kuryente 3200 cash". This is correct, so you click **Use this**. The toast reads "Term is now active," and the term moves to the **Active Terms** tab.

## Field Reference

| Field/Control | Description | Notes |
|---|---|---|
| Amount (₱) | The peso value of the expense. | Required. Must be a positive number; rejected above 99,999,999.99. |
| Expense Date | The date the expense occurred. | Required. Defaults to today. |
| Category | Which expense category this falls under. | Required. Only active categories appear in this dropdown. |
| Payment Method | How it was paid — a configured method, or the **Custom / Cash Default** option. | Optional; defaults to storing "Cash" if left as Custom / Cash Default. |
| Payee / Vendor | Who was paid. | Optional. Type-ahead suggests previously used names. |
| Reference / OR / Receipt No. | The receipt or document number for this expense. | Optional but recommended for audit trail. |
| Notes / Remarks | Free-text detail about the expense. | Optional. |
| Show voided expense records | List filter checkbox. | Off by default; check to include voided entries in the list. |
| Reason for Voiding | Explanation required to void an expense. | Required, minimum 5 characters. |
| Category Name | Name of an expense category. | Required, must be unique (case-insensitive). |
| Description (Category) | Explains what belongs in a category. | Optional. |
| Display Sort Order | Controls the category's position in lists and dropdowns. | Numeric; also adjustable with the Reorder up/down arrows. |
| Quick Entry text box | Free-text natural-language expense description for AI parsing. | Minimum 3 characters to submit. |

## Common Errors & What They Mean

| Message / Situation | Meaning | What To Do |
|---|---|---|
| "Expense date is required" | The Expense Date field was left empty when saving. | Set a date and save again — nothing was lost. |
| "Category is required" | No Category was chosen. | Pick a category from the dropdown and save again. |
| "Amount must be a positive number" | The Amount field is blank, zero, or negative. | Enter a valid amount greater than zero. |
| "Amount exceeds maximum limit" | The amount typed is larger than the system allows (99,999,999.99). | Double-check you didn't add an extra digit; split unusually large costs if genuinely needed. |
| "This looks like it may already be recorded" | An existing expense with the same date, amount, and payee was found. | If it's a genuine, separate expense, click **Save anyway**. If it really is a repeat, close the form instead of saving again. |
| "Please enter a natural language expense description (min 3 characters)." | Quick Entry was submitted with too little text. | Type a fuller description, e.g. include an amount and what it was for. |
| "Could not extract expense details. Falling back to manual entry." / AI service unavailable | Quick Entry's AI parser couldn't understand the text, or the AI service is temporarily down. | Nothing was recorded yet — just fill in **Record New Expense** manually instead. |
| "Reason for voiding must be at least 5 characters" | The void reason is too short. | Add a short explanation (e.g. "Duplicate entry") and confirm again. |
| "Category name is required" | Tried to save a category with an empty name. | Enter a name and save again. |
| "Choose a category first" (Learned Terms) | Tried to save a corrected term without selecting a category from the dropdown. | Pick a category, then click **Save**. |
| Failed to save expense record / Failed to save expense category / Failed to update term | A save didn't go through, usually a connection issue or a server-side validation problem. | Nothing was changed on your screen — check the details and try again; contact IT if it keeps happening. |

## Related Modules

- [Accounts Receivable](./accounts_receivable_manual.md)

## Advanced Reference (optional)

N/A
