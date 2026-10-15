# Employee finance — implementation evidence

> Forson Business Suite | 2026-10-15 (Asia/Manila) | Baseline `02eabc5` | No production deployment

## 0. Status at a Glance

| Phase | Status | Evidence / remaining gate |
|---|---|---|
| 1. Recovery foundation | Implemented; further concurrency verification pending | Exact obligation allocations, unpaid void guards, debt reservations, immutable payments; targeted PostgreSQL checks pass |
| 2. Schedules and operations | In progress | See original implementation plan |
| 3. Settlement and Accounts | Not started | Actual payouts and read model pending |
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

## 4. Phases 2–4 Pending

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

- 2026-10-15: recovery foundation implemented and disposable PostgreSQL verification recorded; phases 2–4 remain active work.
