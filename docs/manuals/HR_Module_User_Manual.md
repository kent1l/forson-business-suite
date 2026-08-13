# Forson Business Suite - HR Module User Manual

Welcome to the **Human Resources (HR) Module** of the Forson Business Suite. This comprehensive guide will walk you through the various sub-modules, features, and workflows available to manage your organization's workforce, attendance, and payroll operations.

---

## Table of Contents
1. [Overview](#1-overview)
2. [Employees (Directory & Management)](#2-employees)
3. [Departments](#3-departments)
4. [Daily Time Records (DTR)](#4-daily-time-records-dtr)
5. [Leave Management](#5-leave-management)
6. [Payroll](#6-payroll)
7. [Statutory Rates](#7-statutory-rates)
8. [My Pay (Employee Self-Service)](#8-my-pay)

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

---

## 3. Departments
The **Departments** sub-module allows HR administrators to define the organizational structure of the company.
* Create and manage department names.
* Use these departments to categorize employees and filter reports across the suite (e.g., in DTR and Payroll).

---

## 4. Daily Time Records (DTR)
The **Time Records** sub-module tracks employee attendance, which is the foundational data required for computing payroll.

### Workflows and Usage:
* **Cutoff Periods:** The system defaults to standard semi-monthly payroll cutoffs (1st–15th or 16th–end of the month).
* **Generating Records:** Use the **Generate for period** button to automatically create day records for all employees based on their assigned work schedules.
* **Inline Editing:** If a correction is needed (e.g., changing a "Present" day to "Half Day", "Absent", "On Leave", or "Holiday Worked"), HR personnel can edit the "Day Type" directly inline from the records table.
* **Period Summary:** Switch to the **Period Summary** tab to view a consolidated report of total days paid, days worked, absences, leave days, and overtime hours per employee for the selected cutoff.
* **Locking:** Once a payroll run is computed for a specific period, the corresponding DTR records are **Locked** to prevent accidental modifications that would cause discrepancies in the payslips.

---

## 5. Leave Management
The **Leave** sub-module tracks and manages employee time-off requests.
* View employee leave balances.
* Process and approve/reject leave applications.
* Approved leave days automatically reflect as "On Leave" in the DTR.

---

## 6. Payroll
The **Payroll** sub-module is a robust engine for computing wages, deductions, and net pay. It enforces a strict state machine to ensure data integrity and proper financial posting.

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

## 7. Statutory Rates
The **Statutory Rates** sub-module is a configuration area reserved for payroll administrators.
* Update tax brackets and withholding matrices.
* Configure contribution tables for SSS, PhilHealth, and Pag-IBIG to remain compliant with government mandates.

---

## 8. My Pay
Located in the **Top Items** section of the main sidebar, **My Pay** is an employee self-service feature.
* It allows any logged-in employee to view and download their own historical payslips without needing to request them manually from HR.
* Access is strictly limited so employees can only view their own records (`payslip:view_own` permission).

---

> **Tip for HR Managers:** Always ensure the **Daily Time Records (DTR)** are fully generated, verified, and corrected before clicking **New Payroll Run**. If you discover a mistake in attendance after a payroll run is computed, you will either need to add a manual adjustment or revert/void the payroll run to unlock the DTR for corrections.
