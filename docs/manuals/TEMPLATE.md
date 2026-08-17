---
module: <Module Display Name>
page_component: <e.g. SalesHistoryPage.jsx>
audience: <e.g. Cashier, Accounting, HR Admin, Manager — list all roles that use this module>
verified_against: <app version or commit-ish>
last_updated: <YYYY-MM-DD>
---

# <Module Display Name>

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
> - **What it's for:** <one line>
> - **Who uses it:** <role(s)>
> - **You'll mostly come here to:** <the 1-2 most common tasks>

## Overview

One to three sentences: what is this module for, and who uses it. Plain language, no jargon.

## Key Concepts

Any terms, statuses, or ideas a user must understand before using this module (e.g. "what is a
Credit Note," "what does 'On Account' mean here"). Skip if the module is self-explanatory.

### Key Calculations (if applicable)

For any on-screen figure that's derived from other numbers, give the plain-language formula plus a
worked example with real numbers — e.g. "**Net Sales = Gross Sales − Refunds** (₱10,000 − ₱500 =
₱9,500)." Plain arithmetic only, no set notation/LaTeX — see STANDARDS.md #12. Omit this subsection
if the module has no derived figures. Deeper/edge-case formal formulas, if truly needed, go in
Advanced Reference instead, not here.

## How To — <Task 1 Name>

State tasks as verbs a user would search for: "Record a Payment," "Print a Cheque," "Void a Sale."
One `## How To — ...` section per major task. Each one follows:

*Why this matters:* one sentence of orientation — where this task fits in the bigger workflow and
what it's for. Assume the reader is new; don't assume tribal knowledge.

*Precision:* one line stating whether these steps must be followed exactly (e.g. anything posting to
the ledger/tax fields) or are the normal default and can flex to the situation. Don't over-specify
self-evident UI actions either way — write for a competent adult, not a script to be followed blindly.

1. Step one, referring to on-screen labels exactly as shown.
2. Step two.
3. ...

**Example:** A short worked walkthrough with realistic sample data (invoice numbers, amounts, names).

## How To — <Task 2 Name>

(repeat the pattern above for every major task this module supports)

## Field Reference

A table or list of every field/control on the page that isn't self-explanatory: name, what it means,
validation rules, and any default behavior.

| Field/Control | Description | Notes |
|---|---|---|
| | | |

## Common Errors & What They Mean

Write this reassuringly — lead with what the message means and what to do, not just the raw text.
The reader should never come away feeling like they broke something irreversible when they haven't.

| Message / Situation | Meaning | What To Do |
|---|---|---|
| | | |

## Related Modules

Links to other manual pages this module commonly interacts with, e.g.:
- [Accounts Receivable](./accounts_receivable_manual.md)

## Advanced Reference (optional)

Only for modules that need deeper detail (e.g. reconciliation math) for power users. Must still be
written for a numerate business user, not a developer — no DB columns, internal function names, or
API routes. Omit this section entirely if not needed.
