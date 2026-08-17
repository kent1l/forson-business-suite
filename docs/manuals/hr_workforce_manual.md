---
module: HR & Workforce
page_component: EmployeesPage.jsx, DepartmentsPage.jsx, LeavePage.jsx, WorkSchedulesPage.jsx, DtrPage.jsx
audience: HR Admin, Manager, Employee (self-service leave)
verified_against: master branch, commit 5d772b8
last_updated: 2026-08-17
---

# HR & Workforce

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
> - **What it's for:** Maintaining the employee directory, organizational structure, weekly work schedules, daily attendance (DTR), and leave requests that feed into payroll.
> - **Who uses it:** HR admins and managers (full access to records, schedules, and DTR); any employee with a system login can file and track their own leave requests.
> - **You'll mostly come here to:** Add or update an employee record, and generate/review the daily time record (DTR) for the current payroll cutoff.

## Overview

The HR & Workforce area is where the company's staff information lives: who works here, what department they're in, what hours they're expected to keep, whether they showed up, and when they're off. It sits under **Human Resources** in the main sidebar, split into five pages — **Employees**, **Departments**, **Time Records**, **Work Schedules**, and **Leave**. Everything recorded here — attendance, approved leave, active employment status — feeds directly into Payroll, so accuracy here is what keeps payslips correct.

## Key Concepts

- **Employee record** — the master profile for one person: personal details, contact info, employment details, and (for those who log in) system access. Created and edited from the **Employees** page.
- **Worker Class** — every employee is either **Employee** (regular staff, paid through the Regular payroll run) or **Job Order / Contract of Service** (a contractor paid through payroll instead of Expenses, paid only through a separate Job Order run and excluded from statutory deductions and reports by default).
- **Employment Status** — one of **Active**, **On Leave**, **Suspended**, **Resigned**, **Terminated**, **Retired**. Changing status to Resigned, Terminated, or Retired requires a **Date Separated** and drops the employee's **Active** flag, though they remain visible to payroll for any cutoff days worked before separation.
- **Department** — an organizational grouping used to categorize employees and filter reports (DTR, Payroll, etc.). Each department can have a **Department Head** (an employee).
- **Work Schedule** — a Sunday–Saturday weekly pattern (working days, rest days, time in/out, break minutes) assigned to an employee. It is what gets stamped onto each day when Time Records are generated.
- **DTR (Daily Time Record)** — one row per employee per day, holding a **Day Type** (Present, Half Day, Absent, On Leave, Rest Day, Rest Day Worked, Holiday, Holiday Worked, Suspended), the fraction of a day paid, and hours worked. This is the attendance data payroll reads.
- **Locked DTR day** — once a payroll run has been computed for a period, its DTR days become locked and can no longer be edited directly, to keep attendance and payslips consistent.
- **Leave Request** — an employee's application for time off against a **Leave Type** (e.g. Vacation, Sick — paid or unpaid), with a status of **Pending**, **Approved**, **Rejected**, or **Cancelled**. Approving a request marks the covered days **On Leave** on the DTR automatically.
- **Leave Balance** — for a given employee and leave type: **Entitled** days, **Carried Over** days from a prior period, **Used** days, and **Remaining** days.

### Key Calculations (if applicable)

**Remaining leave balance = Entitled + Carried Over − Used.**
Example: an employee entitled to 15.00 Vacation Leave days, with 2.00 days carried over from last year and 6.00 days already used, shows **Remaining = 15.00 + 2.00 − 6.00 = 11.00 days**.

**Days payable on the DTR (a period total) = sum of each day's day fraction.**
A whole Present day counts as 1.00, a Half Day as 0.50, and non-working entries (Absent, unpaid Rest Day) count as 0.00. Example: 10 Present days (10.00) + 2 Half Days (1.00) = **11.00 days payable** for that stretch.

## How To — Add or Edit an Employee Record

*Who this is for:* HR admins with **Employees: Edit** access.

*Why this matters:* The employee record is the source of truth for payroll, DTR, and leave — a new hire can't be scheduled, timed, or paid until they exist here.

*Precision:* The normal default — only First name and Last name are required to get started; everything else (contact info, employment details, login access) can be filled in immediately or completed later in a follow-up edit.

1. Go to **Human Resources → Employees**.
2. Click **Add Employee** (or click a row, then the edit icon, to update an existing one).
3. On the **Personal** tab, enter at minimum **First name** and **Last name**. Add date of birth, gender, and civil status if known.
4. Switch to the **Contact** tab for mobile number, personal email, address, and an emergency contact — useful to have on file but not required to save.
5. Switch to the **Employment** tab:
   - Set **Worker class** — **Employee** for regular staff, or **Job Order / Contract of Service** for a contractor paid through payroll. Choosing Job Order hides the Employment Type field and shows a note that this worker is paid through a separate Job Order run with no statutory deductions.
   - Set **Position**, **Department**, **Employment type** (Regular, Probationary, Contractual, Project-based, Part-time, Casual — hidden for Job Order), **Status**, **Date hired**, **Reports to**, and **Work schedule** (defaults to "Company default" if left unset).
   - Leave **Include in payroll** checked unless this person is paid entirely outside the system — this applies to Job Order workers too, since they're still paid through their own payroll run.
   - Leave **Record is active** checked; unchecking hides the record from default lists without deleting it.
6. When adding a brand-new employee, an **Access** tab appears. Check **Give this employee a login** only if they need to sign in — leave it off for staff like drivers or helpers who are paid but never use the system. If checked, fill in **Username**, **Password**, and **Role**.
7. Click **Add employee** (or **Save changes** when editing). A keyboard shortcut, **Ctrl+S**, saves from any tab.

**Example:** Adding a new hire, Jasmine Reyes, as a cashier: First name `Jasmine`, Last name `Reyes`, Position `Cashier`, Department `Sales`, Employment type `Probationary`, Date hired `2026-08-17`. No login is needed yet, so the Access tab is left unchecked — access can be granted later from her detail drawer.

> 📝 Note — Once an employee exists, their login credentials are no longer edited from this form. Go to their **Employee Detail Drawer → Employment tab** to grant, change, or revoke system access instead.

## How To — Bulk-Edit Employees

*Who this is for:* HR admins with **Employees: Edit** access.

*Why this matters:* Reassigning a whole team to a new department or manager one record at a time is slow and error-prone; bulk edit applies the same change to many employees in one step.

*Precision:* Flexible default — you choose only the fields you want to change; anything left at "(No change)" is untouched on every selected record.

1. On the **Employees** list, tick the checkbox next to each employee to update (or the header checkbox to select everyone on the current page).
2. Click **Bulk Edit (N)**, where N is the number selected.
3. Set only the fields you want to change — **Department**, **Employment Type**, **Employment Status**, or **Reports to**. Leave the rest as **(No change)**.
4. Click **Update N Employees**.

**Example:** Five employees in the Sales department are moving to report to a new supervisor. Select all five, open Bulk Edit, set only **Reports to** to the new manager's name, and click **Update 5 Employees** — their department and status are untouched.

## How To — Manage a Department

*Who this is for:* HR admins with the departments-management permission (**Add Department** / edit icon only appear with it).

*Why this matters:* Departments organize the employee directory and let reports (DTR, Payroll) be filtered by team.

*Precision:* Flexible default — only **Department Name** is required.

1. Go to **Human Resources → Departments**.
2. Click **Add Department** (or the edit icon on an existing row).
3. Enter **Department Name**. Optionally add a **Description**, **Cost Center Code**, **Sort Order** (controls list ordering), and a **Department Head** (any active employee).
4. Leave **Active** checked to keep the department selectable elsewhere; uncheck it to retire a department without deleting its history.
5. Click **Save Department**.

**Example:** Creating a new `Logistics` department with cost center code `LOG-01` and Marco Dela Cruz as Department Head.

## How To — File a Leave Request (Employee Self-Service)

*Who this is for:* Any employee with a system login and **Leave: Request** access, filing their own or another employee's leave.

*Why this matters:* An approved leave request automatically marks the covered days **On Leave** on the DTR — filing it here is what keeps attendance and payroll in sync, instead of a manual DTR correction later.

*Precision:* Flexible default for the normal case; dates and leave type should be accurate since they drive DTR and balance changes automatically once approved.

1. Go to **Human Resources → Leave**.
2. Click **File Leave Request**.
3. Choose the **Employee**, the **Leave Type** (unpaid types are marked "(unpaid)" in the list), and the **From** / **To** dates.
4. Choose **Duration**: **Whole day(s)** or **Half day(s)**. Rest days and holidays inside the date range are not charged against the balance.
5. Optionally add a **Reason**.
6. Click **File Request**. The request appears on the **Requests** tab with status **Pending**.

**Example:** Filing 3 whole days of Vacation Leave for Jasmine Reyes from `2026-09-01` to `2026-09-03`, reason "Family trip."

## How To — Approve, Reject, or Cancel a Leave Request

*Who this is for:* HR admins/managers with **Leave: Approve** access (Approve/Reject); the requester or anyone with **Leave: Request** access can Cancel a **Pending** or **Approved** request of theirs.

*Why this matters:* Approving is what actually updates the DTR — attendance doesn't reflect the leave until this step happens.

*Precision:* Exact — this posts changes to the DTR, and once payroll has locked a covered day, the DTR can no longer fully reflect an approval or cancellation.

1. Go to **Human Resources → Leave**, **Requests** tab. Use the status filter (**Pending**, **Approved**, **Rejected**, **Cancelled**, or **All statuses**) to find the request.
2. On a **Pending** row, click **Approve** or **Reject**.
   - Approving shows a confirmation toast such as "Approved — 3 day(s) marked on the DTR." If some of those days were already locked by a computed payroll run, the toast also reports how many days were left unchanged because payroll had already consumed them.
   - Rejecting shows "Request rejected" and leaves the DTR untouched.
3. To withdraw a request that is **Pending** or **Approved**, click **Cancel**. Cancelling an **Approved** request prompts to confirm, since the affected DTR days will revert to their scheduled state; cancelling a **Pending** request needs only a quick confirmation.

**Example:** Approving Jasmine Reyes's 3-day Vacation Leave request marks September 1–3 as **On Leave** on her DTR and shows "Approved — 3 day(s) marked on the DTR."

> ⚠️ Important — If a leave request covers a day that payroll has already computed and locked, approving or cancelling it cannot change that locked day. The toast message tells you how many days were skipped for this reason; resolve the discrepancy through a payroll adjustment or by voiding and recomputing that payroll run.

## How To — Check Leave Balances

*Who this is for:* HR admins and managers with **Leave: View** access.

*Why this matters:* Confirms an employee has enough remaining days before approving a request, or answers an employee's "how much leave do I have left" question.

*Precision:* Flexible — informational only.

1. Go to **Human Resources → Leave**, **Balances** tab.
2. Select an employee from the dropdown.
3. Review the table: **Entitled**, **Carried Over**, **Used**, and **Remaining** days per leave type. A negative **Remaining** figure is shown in red.

## How To — Set Up or Edit a Work Schedule

*Who this is for:* HR admins with **hr:manage_schedules** access (view-only for others with **hr:view**).

*Why this matters:* The schedule assigned to an employee is what gets stamped onto every day when Time Records are generated — it defines which days are worked, which are rest days, and the expected shift boundaries.

*Precision:* Exact for the weekly structure — a schedule must have at least one working day, and every working day needs both a Time In and Time Out, or the save is rejected.

1. Go to **Human Resources → Work Schedules**.
2. Click **New schedule** to start one, or click an existing schedule in the left-hand list to edit it. A **Default** badge marks the schedule assigned automatically to new employees; an **Inactive** badge marks one no longer in use.
3. Enter a **Schedule name** (e.g. "Mon-Sat, Sunday rest") and optional **Description**.
4. Toggle **Default for new employees** and/or **Active** as needed.
5. In the weekly grid, for each day:
   - Check **Rest day** to mark it non-working (this disables Time In/Time Out/Break for that day).
   - Otherwise, set **Time in**, **Time out**, and **Break (min)**.
6. Click **Create schedule** (or **Save changes**).

**Example:** A "Mon-Sat, Sunday rest" schedule with Monday–Saturday set to Time In `07:00`, Time Out `17:00`, Break `60` minutes, and Sunday marked as the sole rest day.

> 💡 Tip — If a rest day needs to move for one specific week (e.g. a one-off Saturday shift), correct that individual day directly in **Time Records** rather than editing the schedule. A day-level correction survives future "Generate for period" runs, while editing the schedule itself changes the pattern going forward for every period.

## How To — Generate and Review the Daily Time Record (DTR)

*Who this is for:* HR admins/managers with **dtr:view** (browse), **dtr:generate** (create records for a period), and **dtr:edit** (correct entries).

*Why this matters:* The DTR is the attendance data payroll reads to compute pay — nothing gets paid correctly until each employee's days for the cutoff exist and are accurate here.

*Precision:* Generating is a flexible default (safe to re-run — it skips days that already exist); correcting a Day Type on a specific day should be exact, since it changes what payroll pays.

1. Go to **Human Resources → Time Records**.
2. Set the **From**/**To** dates, or click **This cutoff** to jump to the current semi-monthly period (1st–15th or 16th–end of month). Optionally filter by **Department** or **Employee**.
3. Click **Generate for period** to create day records for all matching employees from their assigned work schedules. A toast reports how many days were created; if every day already exists, it says so and creates nothing.
4. Review attendance in one of three views (tabs):
   - **Attendance Grid** — one row per employee, one column per day, color-coded by Day Type. Click a cell to change its Day Type from a popover (only for unlocked days you can edit).
   - **Daily Records** — a flat table with Date, Employee, Day Type, Days, Hours, Shift, and Remarks. Change **Day Type** inline via the dropdown on any unlocked row.
   - **Period Summary** — one row per employee totalling Days Paid, Worked, Absent, Leave, Holiday days, Hours, and OT (overtime) for the period.
5. To correct an entry, change its **Day Type** (Present, Half Day, Absent, On Leave, Rest Day, Rest Day Worked, Holiday, Holiday Worked, Suspended) from the Attendance Grid or Daily Records view. Locked rows show a **Locked** label and cannot be edited this way.

**Example:** Generating records for the `2026-08-16` to `2026-08-31` cutoff creates day rows for every active employee; if one employee, Marco Dela Cruz, was actually absent on `2026-08-20`, open the Attendance Grid, click his cell for the 20th, and choose **Absent** from the popover.

> ⚠️ Important — Once a payroll run is computed for a period, its DTR days lock and can no longer be edited here. If you discover an attendance mistake after that point, add a payroll adjustment or void the payroll run to unlock the DTR for correction (see the Payroll manual).

## Field Reference

| Field/Control | Description | Notes |
|---|---|---|
| Worker Class | Employee vs. Job Order / Contract of Service | Job Order hides Employment Type, defaults to statutory-exempt, and is paid only via a Job Order payroll run |
| Employment Status | Active, On Leave, Suspended, Resigned, Terminated, Retired | Resigned/Terminated/Retired require a Date Separated and clear the Active flag |
| Include in payroll | Checkbox on the Employment tab | Uncheck only for people paid entirely outside the system |
| Work schedule | Dropdown of active schedules | "Company default" if left unset; determines rest days when DTR is generated |
| Leave Type | e.g. Vacation, Sick | Marked "(unpaid)" in pickers when not a paid type |
| Duration (leave request) | Whole day(s) or Half day(s) | Rest days/holidays in range are not charged |
| Day Type (DTR) | Present, Half Day, Absent, On Leave, Rest Day, Rest Day Worked, Holiday, Holiday Worked, Suspended | Editable inline unless the day is locked by payroll |
| Is Locked (DTR) | Shown as a "Locked" label | Set once a payroll run has been computed for that period |
| Rest day (schedule) | Checkbox per weekday | Disables Time In/Out/Break for that day when checked |

## Common Errors & What They Mean

| Message / Situation | Meaning | What To Do |
|---|---|---|
| "Schedule name is required" | You tried to save a work schedule without a name. | Enter a name and save again — nothing was lost. |
| "A schedule needs at least one working day" | Every day in the weekly grid is marked Rest day. | Uncheck Rest day on at least one day and set its Time In/Out. |
| "\<Day\> needs both a time in and a time out" | A working (non-rest) day is missing Time In or Time Out. | Fill in both times for that day, then save. |
| "N day(s) were locked by payroll and left unchanged" (on leave approval) | Some days in the approved leave range already belong to a computed payroll run, so the DTR couldn't be updated for those specific days. | Nothing is broken — the approval still went through for the unlocked days. Handle the locked days via a payroll adjustment or by voiding that payroll run. |
| "Every day in this period already exists — nothing to create" | You clicked Generate for period, but records for that date range and filter already exist. | This is informational, not an error — re-running Generate is safe and simply skips existing days. |
| Row shows "Locked" and the Day Type control is disabled | Payroll has already computed a run covering that day. | To correct it, either add a payroll adjustment or void that payroll run to unlock the DTR, then re-edit. |
| "Access Denied" on any HR page | Your account doesn't have the permission needed to view that page (e.g. `hr:view`, `dtr:view`, `leave:view`). | Ask an administrator to grant the relevant permission if you believe you should have access. |

## Related Modules

- [Payroll](./payroll_manual.md)
- [Pay Components](./payroll_manual.md)

## Advanced Reference (optional)

N/A
