# Forson Business Suite - HR Module User Manual

Welcome to the **Human Resources (HR) Module** of the Forson Business Suite. This comprehensive guide will walk you through the various sub-modules, features, and workflows available to manage your organization's workforce, attendance, and payroll operations.

---

## Table of Contents
1. [Overview](#1-overview)
2. [Employees (Directory & Management)](#2-employees)
3. [Departments](#3-departments)
4. [Work Schedules](#4-work-schedules)
5. [Daily Time Records (DTR)](#5-daily-time-records-dtr)
6. [Leave Management](#6-leave-management)
7. [Payroll](#7-payroll)
8. [Pay Components](#8-pay-components)
9. [Statutory Rates](#9-statutory-rates)
10. [My Pay (Employee Self-Service)](#10-my-pay)

---

## 1. Overview
The HR module serves as the central hub for managing the lifecycle of an employee within the system. It handles everything from maintaining basic employee profiles and access controls to generating daily time records (DTR) and processing payroll according to Philippine statutory requirements (SSS, PhilHealth, Pag-IBIG).

You can access the HR module from the main sidebar under the **Human Resources** category.

---

## 2. Employees
The **Employees** sub-module is your master directory for all staff.

### Key Features:
* **Employee Directory:** View a paginated, searchable list of all employees. You can filter by employment status (Active, Inactive, All) and department.
* **KPI Overview:** Quickly view headcounts, including the number of regular employees and paid staff who do not have system login access.
* **Add Employee:** Create new employee records. Only a name is strictly required to get started; other details (like emergency contacts, employment status, and access credentials) can be completed later.
* **Employee Detail Drawer/Modal:** Click on an employee's row or the edit icon to view or update their full profile.
* **Bulk Edit:** Select multiple employees to perform bulk updates, such as reassigning a group of employees to a new department or changing their direct supervisor.
* **Status Badges:** Employees are color-coded based on their employment status (e.g., Active, On Leave, Suspended, Resigned, Terminated, Retired).

### Worker Class: Employee vs. Job Order
Every employee record now carries a **Worker Class**, set on the Employee Form:
* **Employee:** A regular staff member. The standard **Employment Type** field (Regular, Probationary, Casual, etc.) applies, and they are paid through a **Regular** payroll run with full statutory coverage.
* **Job Order / Contract of Service:** A worker engaged outside regular employment (e.g. a contractor paid through payroll rather than the Expenses module). This class:
  * Hides the Employment Type field, since Regular/Probationary/Casual don't apply.
  * Is paid exclusively through a separate **Job Order** payroll run (see [Payroll](#7-payroll)) — never through a Regular run.
  * Defaults to being **exempt from statutory contributions** (SSS, PhilHealth, Pag-IBIG, withholding tax) on its compensation record, though this stays overridable per rate entry (see below).
  * Is excluded from the SSS, PhilHealth, Pag-IBIG, and BIR statutory reports.
  * Still needs **Include in payroll** checked on the Employee Form to actually receive pay — this checkbox is not just for consultants paid outside the system.

### Ending Employment: Separation
When an employee's **Employment Status** is changed to **Resigned**, **Terminated**, or **Retired**, the system automatically:
* Clears their **Active** flag.
* Requires a **Date Separated** to be recorded — payroll cannot correctly prorate their last cutoff without knowing their last day.
* Keeps them visible to payroll for any cutoff that includes days before their separation date, so their final worked days are still paid in the normal Regular run.

Reinstating an employee (setting their status back to **Active**) automatically clears the separation date and reason, reopening their employment window. See [Payroll](#7-payroll) for how to settle a departing employee's 13th-month pay and outstanding loans via a **Final Pay** run.

---

## 3. Departments
The **Departments** sub-module allows HR administrators to define the organizational structure of the company.
* Create and manage department names.
* Use these departments to categorize employees and filter reports across the suite (e.g., in DTR and Payroll).

---

## 4. Work Schedules
The **Work Schedules** sub-module (`hr:view` to browse, `hr:manage_schedules` to edit) defines the weekly working pattern — working days, rest days, time in/out, and break duration — that gets stamped onto each employee's daily time records.

### Key Features:
* **Schedule List:** The left panel lists all schedules, showing each one's employee count and number of rest days. A **Default** badge marks the schedule assigned to new employees; an **Inactive** badge marks schedules no longer in use.
* **Weekly Editor:** Selecting a schedule opens a Sunday–Saturday grid where you set, per day:
  * **Rest day** — toggling this off exposes Time In, Time Out, and Break (minutes) for that day.
  * **Time In / Time Out** — the expected shift boundaries.
  * **Break (min)** — unpaid break time subtracted from the shift.
  * A schedule must have at least one working day and every working day needs both a time in and time out.
* **New Schedule:** Click **New schedule** to define a fresh weekly pattern, give it a name and description, and mark it **Default** and/or **Active**.
* **Assigning to Employees:** A schedule is assigned to an employee from their profile (Employee Form / Employee Detail Drawer); new employees default to whichever schedule is marked **Default**.

### How Schedules Interact with DTR
Clicking **Generate for period** in Time Records stamps each employee's assigned schedule onto every day of the cutoff. If a rest day needs to move for a specific week (e.g. a one-off Saturday shift), correct that individual day directly in Time Records rather than editing the schedule — a day-level correction survives future generation runs, while editing the schedule itself changes the pattern going forward.

---

## 5. Daily Time Records (DTR)
The **Time Records** sub-module tracks employee attendance, which is the foundational data required for computing payroll.

### Workflows and Usage:
* **Cutoff Periods:** The system defaults to standard semi-monthly payroll cutoffs (1st–15th or 16th–end of the month).
* **Generating Records:** Use the **Generate for period** button to automatically create day records for all employees based on their assigned work schedules.
* **Inline Editing:** If a correction is needed (e.g., changing a "Present" day to "Half Day", "Absent", "On Leave", or "Holiday Worked"), HR personnel can edit the "Day Type" directly inline from the records table.
* **Period Summary:** Switch to the **Period Summary** tab to view a consolidated report of total days paid, days worked, absences, leave days, and overtime hours per employee for the selected cutoff.
* **Locking:** Once a payroll run is computed for a specific period, the corresponding DTR records are **Locked** to prevent accidental modifications that would cause discrepancies in the payslips.

---

## 6. Leave Management
The **Leave** sub-module tracks and manages employee time-off requests.
* View employee leave balances.
* Process and approve/reject leave applications.
* Approved leave days automatically reflect as "On Leave" in the DTR.

---

## 7. Payroll
The **Payroll** sub-module is a robust engine for computing wages, deductions, and net pay. It enforces a strict state machine to ensure data integrity and proper financial posting.

### Compensation: Pay Basis and Salary Model
Each employee's rate history (Employee Detail Drawer → Compensation tab) now records more than a rate:
* **Pay Basis:** either **Daily rate** or **Monthly salary**.
* **Salary Model** (monthly only):
  * **Guaranteed** — the employee is paid exactly half the monthly salary every cutoff regardless of attendance; only approved leave without pay reduces it. This is the default when you switch to Monthly.
  * **Attendance-based** — also paid half the monthly salary each cutoff, but unpaid absences deduct from it as well.
* **Exempt from overtime** / **Exempt from tardiness deductions:** independent checkboxes — selecting Monthly pre-checks both (since that's the common arrangement), but a monthly-paid rank-and-file employee can still be legally entitled to overtime, so uncheck as needed. These do not follow automatically from pay basis alone.
* **Statutory Coverage:** **Covered** (SSS, PhilHealth, Pag-IBIG, and withholding tax apply) or **Exempt** (nothing is deducted and no employer share is incurred, though loans and cash advances are still recovered). Job Order workers default to Exempt when a new rate is recorded, but this can be overridden per entry.

Each row in the rate history table shows its basis (Monthly/Daily), model, and any exemptions, so past rate changes remain auditable even as policy evolves.

### Run Types
When creating a new payroll run, choose a **Run Type**:
* **Regular** — pays employees (worker class Employee). This is the default and what most cutoffs use.
* **Job Order** — pays only Job Order / Contract of Service workers, with no statutory contributions or withholding tax. A single cutoff can hold both a Regular run and a Job Order run at the same time; the run list shows a **JOB ORDER** tag on runs of this type so the two stay distinguishable.
* **Final Pay** — settles a departing employee's remaining entitlements once their separation date has been recorded (see [Employees](#2-employees)). A Final Pay run:
  * Pays each separated employee **once** — it cannot be run twice for the same person.
  * Automatically computes and prorates their **13th-month pay** for the year, netting off any 13th-month or prior final pay already disbursed so it is never paid twice.
  * Settles outstanding **loan balances** in full where the final pay covers them. If a loan is larger than the final pay, the shortfall cannot be recovered here — it is called out in a computation warning as still owed and must be collected outside payroll.
  * Does **not** require daily time records, since 13th-month pay and loan settlement aren't attendance-derived.
  * Any benefit paid above the annual 13th-month tax-exempt cap is flagged in a warning (rather than taxed here), since that requires year-end annualisation against total annual income — remember to include the flagged amount in that employee's BIR 2316.
  * Their last worked days for the cutoff are still paid by the ordinary **Regular** run, not the Final Pay run.

### The Payroll Lifecycle (State Machine)
1. **Draft:** A new payroll run is created for a specific pay period. No payslips exist yet.
2. **Computed:** The system reads the DTR for the period and calculates payslips (Gross Pay, SSS, PhilHealth, Pag-IBIG, Tax, and Net Pay). You can review warnings (e.g., employees skipped due to missing rates or incomplete DTR).
3. **Approved:** The payroll run is finalized. Adjustments are frozen.
4. **Paid:** Funds are officially marked as disbursed to the employees.
5. **Posted:** The payroll costs (including the employer share of contributions) are posted to the **Expenses / Finance** module.

### Payroll Adjustments
While a run is in the **Draft** or **Computed** state, authorized users can add **Adjustments**:
* **Add Line:** Add a supplementary allowance, bonus, or deduction.
* **Override:** Manually override a system-computed amount for a specific component.
* *Note: Adjustments are specific to the current run. After adding an adjustment, you must click **Compute** again to apply the changes to the payslips.*

### Generating Payslips
* From an active run, you can generate PDF payslips for distribution.
* You can customize the layout to print 2, 3, or 4 payslips per A4 sheet to save paper.

### Voiding a Run
If a critical error is discovered, you can **Void** a payroll run (requiring a void reason). Voiding will:
* Reverse any expense postings in the finance module.
* Restore employee loan balances (if deductions were applied).
* Unlock the time records (DTR) for that period so corrections can be made before creating a new run.

---

## 8. Pay Components
The **Pay Components** sub-module (`payroll:config`) lets payroll administrators define custom earning and deduction types that can be assigned to employees — for example an HMO employee share deduction or a transportation allowance.

### Key Features:
* **Component List:** Shows every pay component with its code, name, type, taxability, source, and status.
* **System vs. Custom components:** Components generated by the payroll engine or required for statutory computation are tagged **SYSTEM** and are locked — they cannot be edited or deactivated here. Components you add yourself are tagged **CUSTOM** and are fully editable.
* **Add Pay Component:** Provide a unique **Code** (letters, numbers, and underscores only, 2–40 characters; fixed once created), a **Name**, a **Type** (Earning or Deduction), a **Sort Order** (controls display order on payslips and reports), and whether it's **Taxable** (included in withholding tax computation).
* **Edit:** Update a custom component's name, type, taxability, or sort order (the code cannot be changed after creation).
* **Deactivate / Reactivate:** Custom components can be toggled inactive without deleting them, so they stop being assignable going forward while past payslips that already used them stay intact.

Once created, a custom pay component becomes available wherever payroll adjustments are added to a payslip (see [Payroll Adjustments](#payroll-adjustments)).

---

## 9. Statutory Rates
The **Statutory Rates** sub-module is a configuration area reserved for payroll administrators.
* Update tax brackets and withholding matrices.
* Configure contribution tables for SSS, PhilHealth, and Pag-IBIG to remain compliant with government mandates.

---

## 10. My Pay
Located in the **Top Items** section of the main sidebar, **My Pay** is an employee self-service feature.
* It allows any logged-in employee to view and download their own historical payslips without needing to request them manually from HR.
* Access is strictly limited so employees can only view their own records (`payslip:view_own` permission).

---

> **Tip for HR Managers:** Always ensure the **Daily Time Records (DTR)** are fully generated, verified, and corrected before clicking **New Payroll Run**. If you discover a mistake in attendance after a payroll run is computed, you will either need to add a manual adjustment or revert/void the payroll run to unlock the DTR for corrections.
