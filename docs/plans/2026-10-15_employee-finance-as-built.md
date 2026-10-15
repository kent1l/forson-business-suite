# Employee finance — implementation evidence

> Forson Business Suite | 2026-10-15 (Asia/Manila) | Baseline `02eabc5` | No production deployment

## 0. Status at a Glance

| Phase | Status | Evidence / remaining gate |
|---|---|---|
| 1. Recovery foundation | Implemented; further concurrency verification pending | Exact obligation allocations, unpaid void guards, debt reservations, immutable payments; targeted PostgreSQL checks pass |
| 2. Schedules and operations | Implemented; broader race/browser gates pending | Versioned first/second/split schedules, draft activation/release, hold/resume, direct collection, exact recovery review UI/API |
| 3. Settlement and Accounts | Implemented; final browser/concurrency gates pending | Explicit offsets, actual payout allocations, residuals, unknown outcomes, legacy assertions and Accounts UI/API |
| 4. Agency remittance / rollout | Not started | Remittance and authenticated acceptance pending |
| Production readiness | Pending | No deployment or owner acceptance implied |

## 1. For a New Session or Agent Picking This Up

Read `docs/plans/2026-10-14_employee-accounts-payroll-recovery-and-settlement.md` for the full business contract. Run `graphify query "employee finance payroll recovery settlement"`; confirm this document against git history and migrations. Recall Hindsight for employee-finance decisions when available. Update this evidence after each phase and run `graphify update .`.

## 2. Objective and Decisions

Keep debt, wage entitlement, actual payouts, government withholding and advance custody separately traceable. Never match recovery by component, erase payments on ordinary void, or invent cash evidence for historical Paid records. Preserve historical principal semantics. No public search indexing or wallet.

## 3. Architecture and Phase 1 As Built

Migration `20261015_01_employee_recovery_foundation.sql` adds exact loan/payslip/period/month/slot allocations and bounded reservations. Loan locks serialize recoveries; append-only payment events support linked reversals. Approved payslips and ordinary void history remain intact. Paid/Posted cannot be voided in either service or database. Recompute deletes only editable proposals. Existing computed payroll with ambiguous loan identity requires recompute/reapproval.

`employeeRecoveryService.js` owns request replay/conflict identity, lock and reservation helpers. `payrollRunService.js` persists regular and final-pay identities, reserves at approval, and uses exact allocations when posting. Run detail exposes void eligibility; PayrollPage uses it. Negative-net approval is blocked.

Pending phase-1 verification: supplemental/final-pay races, custom-component browser flow, payout/void races (requires phase 3). Further schema guards and slot budgets arrive in phase 2.

## 4. Phase 2 As Built

Migration `20261015_02_employee_loan_operations.sql` backfills legacy first/second schedules without changing amounts, exposes legacy principal/evidence ambiguity, and adds effective versions, overlap guards, monthly/slot budgets, funding provenance, collection/activity documents and seven employee-finance permissions. Admin/Super Admin get all; Manager gets view/manage. Original principal and explicit fees are captured for new drafts. Old cutoff writers are blocked; canonical calculation reads schedule versions.

Loan operations and funding services implement draft creation, independently authorized activation (company release or agency enrollment), future schedules, hold/resume and exact direct collections. Bank evidence has a unique account/reference identity; cash writes reuse drawer posting, custody, count/session/version and independent release approval guards. Direct company collection is rejected while payroll reservations exist. Overpayments are rejected. Recurring/statutory math is unchanged. Final/supplemental recovery proposals require explicit review instead of automatic debt collection; reviewed amounts and reasons are persisted on exact obligations.

Routes are mounted under `/api/hr` and `/api/payroll` through `employeeFinanceRoutes`. Employee Accounts tab includes loan creation, preview, future schedules, activation, hold/resume, direct collection and history. Payroll has an exact recovery review dialog. Request identities and retry details are scoped to actor and target in session storage, with logout cleanup; no password fields are included.

Additional files: `loanSchedule.js`, `employeeLoanService.js`, `employeeFundingService.js`, `employeeFinanceRoutes.js`, `EmployeeAccountsTab.jsx`, `PayrollRecoveryReview.jsx`, `employeeLoanSchedule.test.js`; existing index, calculation, detail drawer, auth context and PayrollPage connected.

Verification: combined payroll/schedule Jest suites: **113 passed**. Extended disposable PostgreSQL script passes activation, hold/resume, future schedule, old-writer rejection, reserved collection rejection, direct collection and balance-erasing status rejection. Web build passes (existing chunk warnings). Targeted API/web lint: no errors, JSX unused-symbol warnings. Browser/role and expanded concurrency verification pending.

## 5. Phase 3 As Built

Migration `20261015_03_employee_settlement.sql` separates immutable employee recovery execution, payout documents/allocations, append-only bank outcome events, employer rounding adjustments and provenance-labeled legacy settlement assertions. Legacy Paid/Posted amounts are assertions only; no bank evidence or drawer movement is fabricated. Immutable approved entitlement remains the source of wages owed. Actual funding is unique; confirmed actual money alone reduces unpaid wages. Partial/unknown payments retain exact target allocations. Unknown/pending payments prevent replacements; explicit evidence resolves failed/cancelled/confirmed outcomes.

`employeeSettlementService` serializes run targets in deterministic order and exact employee residuals, supports zero-net noncash recovery, multi-payslip payouts and explicit employer rounding. Mark Paid now verifies all employee steps instead of posting recovery or claiming a payout. Run detail shows separate settlement summary and definitive void blockers. Void requires current version and replay identity.

`employeeAccountsService` derives four separate categories and paginated statements from canonical loans, payouts, wage entitlement and existing advance custody. Opening/closing balances respect Manila date boundaries. Accounts use a repeatable-read snapshot and report freshness. Source reads are employee-scoped and finance-authorized. Employee identity remains valid without login access.

UI includes an Employee Accounts register in HR navigation, an employee-detail Accounts tab, separate statement balances/source document dialogs, exact loan/recovery forms, wage entitlements, noncash execution, old/current payout allocations, unknown outcome reconciliation, rounding approval and clear legacy labels. No public indexing added.

Verification: disposable DB checks pass explicit recovery, partial payout, centavo carry, unknown replacement rejection, failed reconciliation, Mark Paid gate, source summaries, zero-net offsets with no funding and explicit rounding owed. Docker regression command `npm test -- --runInBand tests/hrPayroll.test.js tests/hrPayrollComponents.test.js tests/hrPayrollSettings.test.js tests/employeeLoanSchedule.test.js`: **140 passed**. Host Supertest is sandbox socket-blocked; container execution passes. Web build passes with existing chunk warnings. Authenticated browser and expanded races remain phase-4 verification gates.

## 6. Phase 4 Pending

Implement effective schedule versions and legacy migration, explicit final-pay review, operational creation/activation/hold/direct collection; actual settlements/payouts and Accounts; agency remittance and source-specific corrections. Complete disposable-DB, authenticated role/browser and migration rollout gates. Original plan defines acceptance; pending work is not deferred.

## 5. Files Touched

- `database/migrations/20261015_01_employee_recovery_foundation.sql`
- `packages/api/services/hr/employeeRecoveryService.js`
- `packages/api/services/hr/payrollRunService.js`
- `packages/api/routes/payrollRoutes.js`
- `packages/api/tests/hrPayroll.test.js`
- `packages/api/tests/employeeFinance_db_test.js`
- `packages/web/src/pages/PayrollPage.jsx`

## 6. Verification Actually Executed

- `npm run -w packages/api test -- --runInBand tests/hrPayroll.test.js`: 107 tests passed.
- Schema-only dump of local development DB restored into explicitly disposable `codex_employee_finance_verify_20261015`; phase-1 migration applied with `ON_ERROR_STOP=1`.
- `docker exec -e EMPLOYEE_FINANCE_TEST_DB=codex_employee_finance_verify_20261015 forson_backend_dev node tests/employeeFinance_db_test.js`: passed same-component exact recovery, paid-void rejection, immutable events, unpaid history preservation, request replay/conflict.
- No business data copied; no production migrations run. Tests opt in to a disposable database name.

## 7. Rollout / Compatibility

Forward-only migrations; never edit applied history. Back up and stage before production. Old computed loan payroll must be recomputed before approval/payment; old Paid history remains frozen. Do not roll application code back to deletion-based void/payment reconstruction once migrated.

## 8. Explicitly Deferred

Original plan exclusions remain: general wallet, new standalone reimbursements, customer A/R bridge, self-service loan requests, automatic interest and deficit debt, statutory basis redesign.

## 9. Change Log

- 2026-10-15: phase 3 settlement/Accounts implemented; no production deployment.
- 2026-10-15: phase 2 schedules/operations implemented and verified; settlement/remittance remain active work.
- 2026-10-15: recovery foundation implemented and disposable PostgreSQL verification recorded; phases 2–4 remain active work.
