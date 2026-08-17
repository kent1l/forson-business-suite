---
module: Payroll
page_component: PayrollPage.jsx, PayComponentsPage.jsx, StatutoryTablesPage.jsx, MyPayslipsPage.jsx
audience: Payroll Admin, HR Admin, Accounting (running payroll, pay components, statutory schedules); All Employees (self-service payslips and time clock)
verified_against: master @ 5d772b8
last_updated: 2026-08-17
---

# Payroll

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
> - **What it's for:** Compute, review, and release each pay period's payslips from attendance and pay setup — plus the statutory contribution tables and custom pay components that feed those calculations.
> - **Who uses it:** Payroll Admins and HR/Accounting staff run payroll, configure pay components, and maintain statutory schedules. Every employee uses the separate **My Pay** page to clock in/out and view their own payslips.
> - **You'll mostly come here to:** Create and run a payroll cycle for a pay period, and check or download your own payslip.

## Overview

Payroll turns each pay period's approved time records into payslips — computing basic pay, overtime, night differential, statutory contributions (SSS, PhilHealth, Pag-IBIG), withholding tax, loan deductions, and net pay for every covered employee. Payroll Admins run the cycle through **Payroll**, define custom pay items through **Pay Components**, and keep government contribution rates current through **Statutory Schedules**. Every employee — regardless of role — sees only their own results through **My Pay**.

## Key Concepts

- **Payroll Run** — one computation of payslips for a single pay period and run type (e.g. the Regular run for August 1–15, 2026). A run moves through a fixed sequence of statuses: **Draft → Computed → Approved → Paid → Posted**, or **Voided** at any point before Posted history needs to stay intact.
- **Run Type** — which population a run pays:
  - **Regular** — ordinary employees.
  - **Job Order** — contract-of-service workers. No statutory contributions or withholding tax are computed for this run type, and job-order pay is excluded from SSS, PhilHealth, Pag-IBIG and BIR reports.
  - **Final Pay** — a one-time run for a departing employee. It pays pro-rated 13th month pay and settles every outstanding loan in full; it does not replace their last regular payslip.
- **Pay Period / Cutoff** — the date range a run covers, and which half of the month it is (first or second cutoff). A cutoff matters because statutory contributions are legally monthly amounts that get split across both cutoffs.
- **Pay Component** — a named earning or deduction line (e.g. "HMO Employee Share," "Union Dues") that can be attached to an employee's pay. Components are either **SYSTEM** (built into the payroll engine — statutory items, basic pay, overtime — and cannot be edited) or **CUSTOM** (created by Payroll Admin here).
- **Statutory Schedule** — the versioned table of government contribution rates (SSS, PhilHealth, Pag-IBIG) and withholding tax brackets (BIR) that a run's calculations look up. Schedules are dated, not just replaced, so old payslips always reproduce the numbers they were actually computed with.
- **Adjustment** — a one-off, per-employee change scoped to a single run (an extra bonus line, or an override of a computed amount) — not a standing change to the employee's pay setup.

### Key Calculations

**Gross Pay = Basic Pay + Overtime Pay + Night Differential + Taxable Allowances + Non-Taxable Allowances**

**Net Pay = Gross Pay − (SSS + PhilHealth + Pag-IBIG + Withholding Tax + Loan Deductions + Other Deductions)**

Worked example — a monthly-paid employee with a ₱20,000/month basic salary, first cutoff of the month, no absences or overtime:

1. **Basic pay for the cutoff** — a monthly salary splits evenly across the two cutoffs, so this cutoff's entitlement is ₱10,000.00.
2. **Statutory contributions** are computed once on the full monthly basis (₱20,000) using the current Statutory Schedule, then split across the two cutoffs the same way basic pay is. For example, if the schedule's PhilHealth premium rate is 5% split evenly between employer and employee: Monthly premium = ₱20,000 × 5% = ₱1,000.00 → Employee share = ₱500.00/month → **₱250.00 for this cutoff.** SSS and Pag-IBIG follow the same monthly-then-split pattern, each from their own bracket/rate in the active schedule.
3. **Withholding tax** is computed on taxable earnings minus the statutory deductions actually withheld this cutoff (contributions are tax-deductible), then looked up against the BIR bracket table for a semi-monthly payroll.
4. **Net pay** subtracts every deduction line from gross pay:

   | | Amount |
   |---|---:|
   | Basic Pay | ₱10,000.00 |
   | **Gross Pay** | **₱10,000.00** |
   | SSS Contribution | −₱250.00 |
   | PhilHealth Contribution | −₱250.00 |
   | Pag-IBIG Contribution | −₱100.00 |
   | Withholding Tax | −₱0.00 |
   | **Total Deductions** | **₱600.00** |
   | **Net Pay** | **₱9,400.00** |

> 📝 Note — Actual SSS, PhilHealth, Pag-IBIG and withholding tax figures depend entirely on the rates and brackets set under **Statutory Schedules**. The percentages above are illustrative; your company's active schedule may compute different amounts for the same salary.

> ⚠️ Important — The **employer share** of SSS, PhilHealth and Pag-IBIG (shown on a run's detail page) is a cost to the company, not something withheld from the employee. It never reduces net pay, but it is added to gross pay plus employer share when a run is posted to expenses, because that combined figure is the true cost of employing that person.

## How To — Run Payroll for a Pay Period

*Why this matters:* This is the core payroll cycle — it converts daily time records and pay setup into the payslips that actually get paid out and, eventually, posted to the company's expenses. Every run moves through the same fixed sequence of states so nothing skips a review step.

*Precision:* This is a precision-required procedure. Computing and posting a payroll run creates real pay obligations and statutory liabilities (SSS/PhilHealth/Pag-IBIG/BIR). Do not skip the review of warnings, and do not approve a run before confirming the figures are correct — approving and paying are difficult to walk back cleanly.

1. Make sure the Daily Time Record (DTR) for the period is complete and corrected — payslips are computed directly from it.
2. On the **Payroll** page, click **New Payroll Run**.
3. Choose a **Run Type**: **Regular — employees**, **Job Order — contract-of-service workers**, or **Final Pay — departing employees**.
4. Choose a **Pay Period** from the list of periods that don't already have a live run of that type.
5. Click **Create Run**. The new run opens automatically in **Draft**.
6. Click **Compute**. The engine reads the period's time records and pay setup and generates a payslip for every covered employee. A toast reports how many payslips were computed; any employees skipped (e.g. for a missing pay rate or missing time record) appear as **notices** at the top of the run — review every one before proceeding.
7. Review the payslip table and the KPI totals (Employees, Gross Pay, Deductions, Net Pay). If something needs correcting, add an **Adjustment** (see below) and click **Compute** again — payslips can be recomputed freely while the run is in Draft or Computed.
8. When the figures are correct, click **Approve**. This locks in the numbers — from this point, adjustments freeze and the run can no longer be recomputed from scratch.
9. Once pay has actually gone out, click **Mark Paid**.
10. Click **Post to Expenses** to record the run's gross pay plus employer statutory share as company expense.

**Example:** Payroll Admin creates a **Regular** run for the August 1–15, 2026 pay period. After clicking **Compute**, the run reports "Computed 42 payslip(s)" with one notice: "Employee Juan Dela Cruz skipped — no compensation on record for this period." The admin corrects Juan's pay setup, clicks **Compute** again, confirms 43 payslips and no notices, clicks **Approve**, then **Mark Paid** after payday, then **Post to Expenses**.

## How To — Add or Remove a Run Adjustment

*Why this matters:* An adjustment is a one-off change scoped to a single run — an extra bonus, a correction to one employee's computed amount — without altering their standing pay setup. It's the tool for exceptions, not for changes that should apply every cutoff going forward.

*Precision:* Follow the required fields exactly (a reason is mandatory and is kept as an audit trail); the choice between "Add" and "Override" is a judgment call based on the situation.

1. Open a run that is still **Draft** or **Computed**.
2. Under **Adjustments**, click **Add**.
3. Select the **Employee…** and the **Component…** the adjustment applies to.
4. Choose the adjustment type: **Add an extra line** (adds a new amount on top of anything already computed) or **Override the computed amount** (replaces what the engine would otherwise compute for that component).
5. Enter the **Amount** and a **Reason** — both required.
6. Click **Save**.
7. Click **Compute** again on the run to fold the adjustment into the payslips.

To remove an adjustment before it's applied, click **Remove** next to it in the Adjustments list, then recompute.

> 📝 Note — Adjustments survive a recompute and only freeze once the run is **Approved**. After approval, adjustments can no longer be added or removed on that run.

**Example:** A payroll admin adds a one-time ₱2,000 "Add an extra line" adjustment on the **PERFORMANCE_BONUS** component for employee Maria Santos, with reason "Q2 sales incentive per memo dated 2026-08-10," then recomputes the run to fold it into her payslip.

## How To — Void a Payroll Run

*Why this matters:* Voiding is the way to undo a run that was created or computed in error — for example, the wrong pay period was selected, or the DTR wasn't actually final. It reverses any expense postings, restores loan balances that were deducted, and unlocks the period's time records for correction.

*Precision:* This is a precision-required action — it reverses postings and unlocks records other staff may be relying on being locked. A reason is required and kept as a permanent record; voiding cannot be undone, though the voided payslips are kept as history.

1. Open the run you want to void.
2. Click **Void**.
3. Enter a **Reason (required)** explaining why.
4. Click **Void Run**.

**Example:** A run was accidentally created against the wrong pay period. The admin opens it, clicks **Void**, enters "Created against wrong period — recreating against Aug 1–15," and confirms. The period's time records unlock and the admin creates a new, correct run.

## How To — Print or Download Payslips

*Why this matters:* Physical or PDF payslips are handed to employees or filed for records. This is a normal, flexible task — there's no wrong choice of layout.

*Precision:* This is a default, flexible action — choose whatever sheet layout suits your printer/paper stock.

1. Open a run that has payslips.
2. Choose how many payslips per A4 sheet: **4 per sheet**, **3 per sheet**, or **2 per sheet**.
3. Click **Print payslips**. The PDF opens in a new browser tab, ready to print or save.

## How To — Create or Edit a Pay Component

*Why this matters:* Pay Components are the building blocks payroll uses beyond the built-in items (basic pay, overtime, statutory contributions). Use this to add company-specific earnings or deductions — an HMO share, union dues, a transportation allowance — that can then be assigned to employees or used in run adjustments.

*Precision:* The **Code** is exact-required — it cannot be changed after creation, so get it right the first time. Everything else (name, sort order) is a flexible default you can revise later.

1. Go to **Pay Components**.
2. Click **Add Pay Component**.
3. Enter a **Code** — letters, numbers and underscore only, 2–40 characters (e.g. `HMO_EE`). This cannot be changed after creation.
4. Enter a **Name** (e.g. "HMO Employee Share").
5. Choose the **Type**: **Deduction** or **Earning**.
6. Set the **Sort Order** — controls where this line appears relative to others on a payslip.
7. Check **Taxable (included in withholding tax computation)** if this component should count toward taxable income.
8. Click **Create Component**.

To edit an existing custom component, click **Edit** on its row, change what's needed (the code cannot change), and click **Update Component**.

To retire a component without deleting its history, click **Deactivate** on its row; click **Reactivate** to bring it back.

> 📝 Note — Components marked **SYSTEM** (basic pay, overtime, statutory contributions) are engine-owned and show **Locked** — they cannot be edited or deactivated here.

**Example:** Payroll Admin creates a new **Earning** component with code `TRANSPO_ALLOW`, name "Transportation Allowance," sort order `15`, marked taxable, for a monthly transport stipend that will later be assigned to field staff.

## How To — Update a Statutory Schedule

*Why this matters:* SSS, PhilHealth, Pag-IBIG and BIR withholding rates change periodically by government circular. This is where those official rate changes are entered so future payroll runs compute correctly — without altering the numbers that already-paid payslips were computed with.

*Precision:* This is a precision-required procedure — it directly changes statutory withholding and remittance amounts for every future run. Always confirm figures against the actual circular before saving, and never edit a schedule that's already been used (it will be locked; supersede it instead).

1. Go to **Statutory Schedules**.
2. Select the agency's schedule from the list: **SSS**, **PhilHealth**, **Pag-IBIG**, or **BIR Withholding Tax**.
3. If the schedule shows **In use**, its figures are locked (a payroll run already paid somebody off it) — skip to step 6 to supersede it instead.
4. If it shows **Editable**, adjust its figures directly:
   - **SSS** — edit the generating rules (Employee rate, Employer rate, MSC minimum/maximum/step, Regular SS ceiling, EC threshold, EC below, EC at/above), click **Preview** to see the resulting bracket table, then **Save brackets**.
   - **PhilHealth** — edit Premium rate, Income floor, Income ceiling, Employee share ratio, then click **Save**.
   - **Pag-IBIG** — edit Rate threshold, EE rate at/below, EE rate above, Employer rate, Maximum compensation, then click **Save**.
5. Done — new runs computed after saving will use the updated figures.
6. To change rates for a schedule that's already **In use**, click **Supersede…**, enter the **Effective from** date the new rates take hold, a **Label** (e.g. "SSS 2027 circular"), and a **Source reference** (the circular or RR number), then click **Supersede**. This closes the current schedule the day before your chosen date and opens a new, editable one with the same starting figures — payroll runs before that date keep using the old numbers.

**Example:** SSS issues a new circular effective January 1, 2027. The admin opens the current SSS schedule, clicks **Supersede…**, sets Effective from `2027-01-01`, Label "SSS 2027 circular," Source reference "SSS Circular No. 2027-001," and clicks **Supersede**. The new version opens ready for editing; the admin updates the MSC minimum/maximum and rates, previews the bracket table, and saves.

## How To — View Your Payslips (Employee Self-Service)

> This task is for every employee checking their own pay — not for payroll staff. It lives on the **My Pay** page, separate from the Payroll module above, and only ever shows your own records.

*Why this matters:* My Pay is where you see what you were paid and download a copy for your own records (e.g. for a loan application or tax filing), without needing to ask Payroll for a copy.

*Precision:* This is a simple, flexible lookup — there's nothing to get wrong here.

1. Go to **My Pay**.
2. If your role can clock in/out, the **Time Clock** card at the top shows your last punch and a button that reads **Clock In** or **Clock Out** depending on what's next — click it to record your time.
3. Under **Payslips**, find the pay period you want. Each row shows the Period, Pay Date, Days paid, Gross, Deductions, and Net Pay, along with a status badge.
4. Click **PDF** next to a payslip to open a downloadable copy in a new tab.

> 📝 Note — A payslip only appears here once the payroll run covering it has been approved. If you don't see a recent pay period yet, it likely hasn't been approved by Payroll yet — check back or ask Payroll directly.

**Example:** An employee opens **My Pay**, sees a row for "2026-08-01 → 2026-08-15" with Net Pay ₱9,400.00 and status **Paid**, and clicks **PDF** to save a copy for a bank loan application.

## Field Reference

| Field/Control | Description | Notes |
|---|---|---|
| Run Type (New Payroll Run) | Regular / Job Order / Final Pay — which population a run pays | Determines which pay periods are offered and what gets computed |
| Pay Period (New Payroll Run) | The date range a run covers | Only periods without an existing live run of the selected type are offered |
| Compute | Generates payslips for a Draft run from time records and pay setup | Can be repeated while Draft or Computed; surfaces skipped-employee notices |
| Approve | Locks in a Computed run's figures | Freezes adjustments; run can no longer be recomputed |
| Back to Draft | Reverts a Computed run to Draft | Available only from Computed |
| Mark Paid | Records that an Approved run's pay has gone out | |
| Post to Expenses | Records the run's gross pay plus employer statutory share as a company expense | |
| Void / Reason (required) | Cancels a run, reversing postings and unlocking DTR | Reason is kept as a permanent record; available on any non-Voided run |
| Adjustment type | **Add an extra line** adds on top of the computed amount; **Override the computed amount** replaces it | |
| Pay Component Code | 2–40 characters, letters/numbers/underscore only | Cannot be changed after creation |
| Pay Component Type | Deduction or Earning | |
| Taxable (component) | Whether the component counts toward withholding tax computation | |
| Source (component list) | SYSTEM (engine-owned, locked) vs. CUSTOM (editable) | |
| Statutory Schedule status | **In use** (locked, already paid somebody) vs. **Editable** | Use **Supersede…** to change an In use schedule |
| Supersede — Effective from | The date the new schedule version takes effect | Required |
| Supersede — Label / Source reference | Free-text identifiers for the new version (e.g. circular number) | |

## Common Errors & What They Mean

| Message / Situation | Meaning | What To Do |
|---|---|---|
| "No compensation on record for [employee] as of this period." | That employee has no pay rate set up covering this pay period, so the engine couldn't compute their payslip. | Set up their compensation record, then click **Compute** again — nothing else on the run is affected. |
| "No statutory schedule is on file for [agency] as of [date]." | The pay period falls in a date range with no active SSS/PhilHealth/Pag-IBIG/BIR schedule. | Go to **Statutory Schedules** and make sure a schedule with a matching effective date exists for that agency, then retry. |
| "A reason is required" (voiding a run) | Voiding always needs a documented reason before it will proceed. | Fill in the Reason field and try again — nothing is lost by re-entering it. |
| "Code must be 2-40 characters of letters, numbers or underscore" | The pay component code you typed doesn't meet the format rule. | Adjust the code (letters, digits and `_` only) and save again — no data was lost. |
| "Every period this year already has a live [regular/job order] run." | You're trying to create a run for a pay period that already has an open run of that type. | Open the existing run instead, or **Void** it first if it truly needs redoing. |
| "An effective date is required" (superseding a schedule) | The Supersede form needs an Effective from date before it can create the new version. | Pick the date the new rates take effect and submit again. |
| Adjustments section not visible on an Approved/Paid/Posted run | Adjustments freeze once a run is approved — this is expected, not an error. | If a correction is genuinely needed, void the run and recreate it, or handle the correction on the next cutoff. |
| No payslips yet, run still Draft | The run hasn't been computed. | Click **Compute** to generate payslips from the period's time records. |

## Related Modules

- [HR & Workforce](./hr_workforce_manual.md)

## Advanced Reference (optional)

N/A
