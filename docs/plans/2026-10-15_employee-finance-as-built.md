# Employee finance — implementation evidence

> Forson Business Suite | 2026-10-15 (Asia/Manila) | Baseline `02eabc5` | Application implementation; no business database migration or deployment

## 0. Status at a Glance

| Phase | Status | Evidence / remaining gate |
|---|---|---|
| 1. Recovery foundation | Implemented and automated checks passed | Exact obligation identity, debt/slot reservation, append-only events, unpaid-only cancellation and concurrency checks |
| 2. Schedules and operations | Implemented and automated checks passed | Canonical effective schedules, legacy mapping, draft/activation/release, hold/resume, direct collections and exact review |
| 3. Settlement and Accounts | Implemented and automated checks passed | Explicit noncash execution, actual payouts, residuals, unknown instructions, rounding, legacy assertions and four-domain statements |
| 4. Agency and rollout | Application implemented; owner rollout acceptance pending | Exact Treasury attribution, agency reconciliation/direct payment, source-specific corrections; disposable migration/API/browser verification |
| UI finalization | Implemented and verified | System cards, focused tabs, accessible dialogs, guided funding, exact money/date presentation and expanded Chromium checks |
| Production readiness | Owner acceptance and deployment pending | No production or existing development business data changed; migrations must precede running the new workflows |

## 1. For a New Session or Agent Picking This Up

1. Read the business contract in `docs/plans/2026-10-14_employee-accounts-payroll-recovery-and-settlement.md`.
2. Run `graphify query "employee finance payroll recovery settlement remittance"`; trust fresh source over old graph descriptions.
3. Recall Hindsight with tags `forson-business-suite`, `employee-finance` for compatibility decisions.
4. Check git history and the migration window against this evidence before making changes.
5. Update this document and graphify after further work. Pending acceptance below is operational work, not an implicitly deferred implementation phase.

## 2. Objective and Decisions Already Taken

Debt, wage entitlement, actual payouts, government withholding/remittance and business cash custody have separate owners. There is no spendable wallet or cross-domain netting. Employee identity survives loss of login access. Sensitive finance reads require finance permission; HR profile access alone is insufficient. Payroll review remains in the existing payroll permission domain.

Persist exact loan identities rather than reconstructing recoveries from component codes. Compute proposes; approval reserves; explicit employee settlement posts noncash recovery once; actual funding settles net wages separately. Zero-net recovery needs no cash release. A partial payout never reruns recovery. No automatic debt is created from negative wages; approval blocks until recovery review or legitimate earnings inputs resolve the shortfall. No configured protected-pay minimum existed in the inspected baseline; this change does not invent a legal threshold.

Preserve legacy principal interpretation and cutoff amounts. Imported original principal, interest and funding evidence remain explicitly unverified. Legacy Paid/Posted net amounts are labeled status assertions, never invented bank evidence or drawer movements. New corrections preserve the original source and create precisely bounded events.

Ordinary Void cancels unpaid Draft/Computed/Approved payroll only, with a reason, current version and request identity. It releases its own pending reservations and DTR locks, retains payslips and audit history, and permits replacement. Paid/Posted, recovery execution and actual/pending/unknown payout records block cancellation. No financial deletion or paid-to-unpaid shortcut exists.

## 3. Architecture and Migrations

Services use raw PostgreSQL transactions and existing Express/auth/UI conventions. Money boundaries use exact decimal strings/minor units. Loan and payroll locks, deterministic ordering, source uniqueness and database guards enforce debt, ownership, installment and funding limits. JSON histories explicitly retain monetary strings.

| Migration | As built |
|---|---|
| `20261015_01_employee_recovery_foundation.sql` | Exact deduction allocations, request replay records, immutable loan payments and linked reversals, debt reservation and lifecycle guards |
| `20261015_02_employee_loan_operations.sql` | Loan metadata, legacy first/second backfill, effective schedule versions, installment budgets, funding/collection/activity documents, finance permission catalog and role mappings |
| `20261015_03_employee_settlement.sql` | Explicit settlement, actual payout/allocations/outcome events, legacy assertions, payable read model and employer rounding adjustments |
| `20261015_04_agency_remittance_and_corrections.sql` | Agency-direct evidence, remittance headers/allocations/events, exact returned-funds and recovery corrections, protected Treasury sources |
| `20261015_05_employee_finance_guards.sql` | Frozen allocations/lines, approved set guards, exact recovery event validation, zero-share/catch-up proposal support and approval consistency |
| `20261015_06_collection_installments_and_bank_identity.sql` | Durable bank instruction identities, direct-arrears month/slot ownership shared with payroll, corrected entitlement/legacy guards and frozen schedule history |
| `20261015_07_payroll_entitlement_freeze.sql` | Freeze approved run totals/policy/periods, reject unexpected expense recognition on unpaid cancellation, and support additional verified payouts against corrected legacy assertions |

No existing migration or `initial_schema.sql` was edited. The migration runner tracks the seven new files with checksums; repeated `up` is a no-op. Financial history FKs use RESTRICT. Approved header/line/allocation histories cannot be edited or deleted. Schedule versions may only be closed prospectively; frozen recovery months remain valid.

Company bank funding records verified evidence and a unique bank-account/reference identity; it does not initiate an external bank transfer. Cash funding reuses the drawer posting service, custodian/session/version/count guards and independent amount-bound release approvals. One receipt/release belongs to its funding document; allocations do not produce more movements. Cash tracking must be enabled to use these cash flows. Existing business advances keep their original workflows and schemas.

## 4. Phase 1 — As Built

- [x] Revalidated current schema, source, scripts and Jest discovery. Standalone `*_db_test.js` files are explicitly excluded from default Jest discovery and require disposable opt-in.
- [x] Persisted exact regular and final/supplemental obligation proposals, schedule/version/period/month/cutoff identity and line references.
- [x] Removed component-based payment matching and deletion-based voiding.
- [x] Added backend eligibility, definitive database guards, current version/request contract and UI cancellation eligibility.
- [x] Added shared reservation/loan lock protocol and append-only recovery/correction foundations.
- [x] Verified concurrent same-slot approval has one winner; void versus employee settlement has one valid outcome; same-component/custom-component identity remains exact; historical records survive cancellation.

Legacy computed payroll with loan deductions cannot be paid through guessed identities. Release/recompute/reapprove it. Already frozen legacy Paid/Posted records are preserved.

## 5. Phase 2 — As Built

- [x] Canonical first/second/split monthly schedules use half-up minor-unit division and a second-cutoff remainder. Legacy 1/2 maps to the same original amount without halving/doubling.
- [x] Effective changes carry reason/authority/version and cannot overlap or rewrite an approved recovery month. Old cutoff writers are blocked.
- [x] Draft creation captures original principal, agreed fees, collectible opening, creditor, purpose, evidence, start eligibility and both previews.
- [x] Company activation requires actual release evidence; agency activation uses verified enrollment without company cash.
- [x] Hold/resume preserves balances and frozen allocations; no Complete action erases unpaid debt.
- [x] Company direct collection has exact loan targets, versions and a documented principal-versus-installment policy. Installment arrears require the exact recovery month and cutoff and consume the same budget as payroll. Conflicting positive payroll reservations block collection. Overpayments are rejected, so no unapplied credit is silently created.
- [x] Recovery review supports exact recover/defer/skip/catch-up choices and reasons. Final/supplemental runs propose zero collection until explicitly reviewed/authorized. Catch-up is bounded by the remaining monthly entitlement; authorized final pay remains capped by debt and competing reservations.
- [x] Real calculation tests cover both sequences, exact odd-cent remainder, midmonth remaining-share eligibility, absence of hidden catch-up, explicit catch-up/defer and negative-net approval rejection.

Recurring fixed items retain their old math. UI distinguishes “Fixed amount each cutoff” and “Split monthly amount”; legacy monthly percentages show a basis-review notice. Statutory computation and rate policy are unchanged.

## 6. Phase 3 — As Built

- [x] Employee settlement executes the exact approved allocation set once, independently of cash.
- [x] Immutable actual payouts have exact employee/payslip allocations, funding/evidence, actor/time and durable request identity. One payment can settle current and older residuals.
- [x] Pending/unknown bank instructions retain their original bank/reference identity. No confirmed funding or actual paid amount is fabricated. Replacement payments are blocked until evidence resolves the original instruction.
- [x] Unpaid centavos remain owed. Explicit approved upward rounding adds an employer obligation; it is not employee debt. Approval precedes expense posting. Payroll expense recognition includes the approved employer rounding in wage cost, without another cash movement.
- [x] Mark Paid verifies employee recovery execution and actual settlement instead of claiming a disbursement. Posting expenses rechecks settlement. Legacy assertions retain their compatibility/provenance label; verified additional correction payouts do not invent old funding evidence.
- [x] Four-domain Accounts summaries/statements derive from canonical source records, use a repeatable-read snapshot and Manila date boundaries, and return paginated source-linked transactions with separate opening/closing balances.
- [x] UI includes HR Employee Accounts register, employee drawer Accounts tab, separate panels, source dialogs, history, exact review, current/older payout allocation, pending reconciliation and rounding approval. Actor/employee changes remount sensitive state. Retry details contain no credentials and are cleared at logout.
- [x] PostgreSQL tests verify partial payouts, zero-net offsets, failed/unknown outcomes, residual carry/settlement, duplicate funding rejection and expense-versus-money separation.

## 7. Phase 4 — As Built and Remaining Rollout Gates

- [x] Agency withholding is separate from paid, confirmed and reconciled remittance. Mark Paid never labels withholding remitted.
- [x] Remittance allocations point at exact recovery payment IDs and reuse an existing non-payroll Treasury expense or cleared supplier payment. Loan shares are distinct from contributions within that payment. No new expense or outward cash movement is generated.
- [x] Global agency workspace supports a batch across employees; per-employee views show their source-linked installments. Existing Treasury sources can be searched/selected.
- [x] Agency statement differences become NEEDS_REVIEW; reconciliation cannot rewrite withholding to hide a discrepancy.
- [x] Verified employee payments directly to an agency reduce the same obligation from agency evidence, without a company receipt or inferred amortization rewrite.
- [x] Source-specific corrections preserve events, require correction permission/reason/evidence/current versions, and cannot exceed the exact original source. Returned money needs a separately verified funding event. Remitted recovery cannot be reversed until remittance attribution is corrected with actual returned-funds evidence.
- [x] Authenticated API role checks, intercepted Chromium UI checks, production web build, standalone disposable DB checks, checksum-verified migration rehearsal, legacy-data rehearsal and no-op runner replay executed.
- [ ] Owner acceptance using the organization's real policy, approved agreements, Treasury references and authenticated operator roles.
- [ ] Production/staging deployment, pre-deployment backup review, actual bank evidence reconciliation and realistic-volume performance measurement. This session did not migrate the existing business database or initiate bank transfers.

### Correction contracts

All are separate, idempotent POST commands with `request_id`; they require `employee_finance:correct`. There is no generic undo endpoint.

| Endpoint | Required source and version | Financial effect |
|---|---|---|
| `/api/payroll/recoveries/:paymentId/reversals` | Original payroll recovery; `run_version`, `loan_version`, reason/evidence | Append full exact recovery reversal, restore loan debt and add the same amount to wages owed; no cash invented |
| `/api/payroll/payout-allocations/:allocationId/returns` | Confirmed actual payout allocation; run `version`, amount and verified inward funding | Preserve payout, append bounded returned-money event, reopen the corresponding wage payable |
| `/api/hr/employee-collections/:collectionId/refunds` | Exact original `payment_id`; `loan_version`, original amount and verified outward funding | Refund one complete original loan allocation, append linked recovery reversal and restore debt; no blanket collection undo |
| `/api/hr/loan-remittances/:remittanceId/corrections` | Exact `remittance_allocation_id`; remittance event `version`, `loan_version`, amount and verified inward funding | Record actual agency return, reopen bounded unremitted withholding and mark reconciliation for review |

Ordinary unpaid cancellation cannot perform these actions. Posted payroll remains Posted; additional obligations/returns are visible in the separate settlement state and source history.

### Final UI delivery — As Built

- [x] Employee Accounts uses the system's segmented navigation, cards, badges, loading/error/empty states, spacing and semantic colors in light and dark mode. The four separate balance domains appear before the activity filters; focused tabs contain loans, salary settlement and government-loan work.
- [x] Shared `FinancePrimitives.jsx` removes circular imports through the accounts tab. Drafts and loan commands use scrollable dialogs with Escape, trapped keyboard focus, focus restoration and background scroll locking. Payroll recovery review and unpaid void use the same dialog.
- [x] All finance forms use consistent labeled controls. Monetary summaries retain exact decimal strings and full pesos/centavos; dates explicitly use Manila time. Technical request hashes and row versions are omitted from source document presentation.
- [x] Cash funding selects the operator's current open drawer, carries its version automatically and offers independent release approvals matching the amount. Inward collections, wage returns and agency refunds use receipt controls without requiring an outward release approval. Server funding guards remain authoritative.
- [x] Employee search is debounced and keeps the selected employee identity visible across result pages/searches. Treasury source search clears the previous selection and reports failures. Late statement/source responses cannot replace newer selections or reopen closed dialogs.
- [x] Durable unknown-request replay remains scoped to actor and command across reloads and tab switches; successful commands use the existing toast convention. Outcome reconciliation forms sit behind labeled disclosures.
- [x] Expanded Chromium fixtures passed for tab navigation, populated salary balances, source-dialog keyboard/focus behavior, cash drawer/approval selection, statement response races, the full employee register and global agency workspace. Screenshots at 390px and 1440px were visually inspected in light/dark mode.

This follow-up changes frontend behavior and presentation only. It adds no migration and does not perform business-database rollout. Browser responses are intercepted fixtures; owner acceptance with real operational records remains pending.

## 8. API and Permission Map

Original plan contracts are mounted under `/api/hr` and `/api/payroll`. Additional read routes include employee loans/payables/payouts/withholdings, source documents, an employee register, available banks, existing Treasury sources and the global agency workspace. Own-statement self-service was intentionally not added; finance authorization is explicit.

| Permission | Scope |
|---|---|
| `employee_finance:view` | Employee Accounts/register/statements/source reads |
| `employee_finance:manage` | Prepare drafts, future schedules and hold/resume |
| `employee_finance:approve` | Activate verified loans and approve employer rounding |
| `employee_finance:collect` | Company direct collections |
| `employee_finance:pay` | Employee noncash execution, actual payouts and bank-outcome reconciliation |
| `employee_finance:remit` | Treasury remittance attribution, agency reconciliation and agency-direct evidence |
| `employee_finance:correct` | The named source-specific correction commands above |

Admin/Super Admin role mappings receive the finance keys; Manager receives view/manage. Existing payroll permissions still control computation/approval/posting/void/recovery review. Cash writes additionally require drawer movement permission/custody, and outflows require the existing independent release approval. Auth is resolved from current database state; revoked or inactive login access cannot use an old JWT.

## 9. Verification Actually Executed

All fixture-writing/concurrency work used explicitly named `codex_employee_finance_verify_*` disposable databases, initialized from a schema-only local dump. No business rows were copied. All eight disposable databases created by this session were removed after verification. The standalone scripts reject other database names. Default Jest discovery omits these scripts, so they were run explicitly.

| Command/check | Actual result |
|---|---|
| `docker exec forson_backend_dev npm test -- --runInBand tests/hrPayroll.test.js tests/hrPayrollComponents.test.js tests/hrPayrollSettings.test.js tests/employeeLoanSchedule.test.js` | 4 suites, **140 tests passed** |
| `EMPLOYEE_FINANCE_TEST_DB=codex_employee_finance_verify_acceptance_20261015 node tests/employeeFinance_db_test.js` inside backend container | Full PostgreSQL orchestration, constraints, races, source corrections, real JWT/role HTTP checks, drawer guards and exact arrears checks passed; script reports named scenarios, not a Jest count |
| Migration runner `up --db codex_employee_finance_verify_checksum_20261015 --from 20261015_01_employee_recovery_foundation.sql --to 20261015_07_payroll_entitlement_freeze.sql` | Seven forward migrations applied on fresh schema |
| Same window with `verify`, followed by `up` again | Checksums verified; no pending migrations |
| `EMPLOYEE_FINANCE_TEST_DB=<fresh disposable pre-feature schema> node tests/employeeFinanceMigration_db_test.js` | Legacy first/second amounts preserved, frozen Posted payslip unchanged, labeled assertion created, no invented old funding/cash, ordinary paid void rejected; verified legacy recovery correction pays only the additional wages from new bank evidence |
| `FINANCE_BROWSER_BASE_URL=http://172.18.0.7:5173 node --input-type=module < packages/web/tests/employeeFinanceBrowser.mjs` inside backend container | Chromium fixtures: four exact panels, finance-view-only/denied roles, actor/employee switching, 390px layout, odd-cent preview, unknown-request reload/replay, focused tabs, populated salary cards, source keyboard/focus, guided cash selectors, stale-filter response suppression and full employee/global agency workspace |
| `npm run -w packages/web build` | Passed; existing dynamic import/chunk-size warnings |
| `npm run -w packages/web test` | **10 tests passed** |
| Targeted API/web ESLint and `git diff --check` | No errors; repository JSX unused-symbol warnings and one existing unused API argument warning |

Real API authentication used an Admin fixture, finance-view-only fixture, HR-only fixture and payroll-post-only fixture; source isolation, inactive JWT rejection and finance access to former-employee history passed. Browser API responses were intercepted fixtures; this was not a production operator acceptance walkthrough.

Small-fixture Accounts summary timing: **111.7 ms p95 across 20 samples** in the final clean integration run. This is not a production-volume performance certification. No transactional-write p95 target is claimed. Graphify was refreshed successfully (existing 30 extraction warnings and large-graph HTML skip). Existing statutory bulk loading emits a pg concurrent-query deprecation warning; tests pass with the installed pg version.

Host Supertest is sandbox socket-blocked; tests ran in Docker. Docker/Chromium verification did not require production access. Resolve the current frontend container address before repeating browser commands; the recorded IP is not configuration.

## 10. Files and Verification Entry Points

- Seven new migrations under `database/migrations/20261015_0*`.
- `packages/api/services/hr/employeeRecoveryService.js`, `loanSchedule.js`, `employeeLoanService.js`, `employeeFundingService.js`, `employeeSettlementService.js`, `employeeAccountsService.js`, `loanRemittanceService.js`, `employeeFinanceCorrectionService.js`.
- Existing `payrollCalculationService.js`, `payrollRunService.js`, `payrollPostingService.js` and `payrollRoutes.js`; new `employeeFinanceRoutes.js` mounted by `index.js`.
- `packages/web/src/components/hr/EmployeeAccountsTab.jsx`, `EmployeeAccountStatement.jsx`, `EmployeePayables.jsx`, `EmployeeAgencyLoans.jsx`, `PayrollRecoveryReview.jsx` and existing employee detail/payroll pages.
- `packages/web/src/pages/EmployeeAccountsPage.jsx`, HR navigation/MainLayout and logout cleanup.
- `employeeLoanSchedule.test.js`, `employeeFinance_db_test.js`, `employeeFinanceMigration_db_test.js`, `employeeFinanceBrowser.mjs` and its browser fixture.
- Shared finance UI: `FinancePrimitives.jsx`, `financePresentation.js`, `employeeFinance.css`; `SegmentedTabs.jsx` exposes selected button state to assistive technology.
- Package scripts: API `test:employee-finance:db`, `test:employee-finance:migration`; web `test:employee-finance:browser`.

Use a fresh pre-feature disposable schema for the migration fixture. Use an already migrated disposable schema for the main integration script. Do not run either against the existing business database.

## 11. Rollout and Compatibility

Coordinate migrations and API/web deployment. Verify applied checksums, back up, inventory legacy evidence/ambiguous balances and open payroll, rehearse on a staging clone, then obtain owner acceptance. Recompute unpaid legacy loan payroll before attempting payment; never reconstruct its obligation identity from a component. Confirm finance role assignments and enable drawer tracking only under the organization's existing rollout policy.

Rollback is a reviewed backup/application recovery operation, not financial deletion or reversal of SQL history. Do not restore the old deletion-based void/payment-reconstruction code against the migrated guards. Never clear pending bank instructions as a shortcut. Preserve exact request identities during reconciliation.

## 12. Explicitly Deferred / Excluded

Original exclusions remain: general wallet/cross-domain netting, standalone reimbursements, customer A/R bridge, self-service loan applications, automatic interest/penalties, automatic deficit debt, statutory basis/rate redesign and agency portal/PRN automation. Overpayments are rejected rather than introducing an unsupported credit ledger. A new employer adjustment after expense posting requires a separately prepared payroll/expense adjustment; ordinary rounding is approved before posting.

## 13. Change Log

- 2026-10-15: Phase 1 committed as `758e397`; phase 2 as `26433a7`; phase 3 as `658e10d`.
- 2026-10-15: Agency remittance, source-specific corrections, direct-installment ownership, bank identities, accounting/freeze guards and final verification added for phase 4. Application implementation is complete; owner rollout acceptance remains pending.

- 2026-10-15: Final UI polish completed on user follow-up. Re-ran 140 API regressions, 10 web tests, production build, web lint and expanded Chromium fixtures; visually inspected mobile/desktop layouts. No business migration or deployment performed.
