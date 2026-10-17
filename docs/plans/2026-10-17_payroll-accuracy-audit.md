# Payroll accuracy — audit and implementation evidence

> Forson Business Suite | Started 2026-10-17; updated 2026-10-18 (Asia/Manila) | Baseline `ed45989` | Local implementation and verification; no production deployment or wage settlement

## 0. Status at a Glance

| Phase | Status | Evidence / remaining gate |
|---|---|---|
| Snapshot reconciliation audit | Verified within stated scope | All 36 saved local payslips reconcile; saved withholding matches the saved BIR table with documented overrides respected |
| Premium and attendance corrections | Implemented and verified | Day-specific holiday/rest-day/OT/night earnings; monthly unpaid half-days; special working days; Manila punch time/classification |
| Integrity and incomplete-input gates | Implemented and verified | Exact-cent line/header/run reconciliation; negative net, legacy unpaid computation, missing employee inputs, unsupported periods/rate splits/run types and annualisation guards |
| Payroll and payslip presentation | Implemented and verified | Saved-line breakdown on desktop/mobile and My Pay; explicit monthly equivalent rate; full deductions; three-decimal DTR days; adaptive and multi-page PDF layout |
| Full statutory accuracy certification | **Not complete** | Existing manual statutory policy retained by user instruction; legal classification is not inferred, and annual tax processing remains unsupported; see section 7 |
| Business rollout | Pending | Two existing Computed runs require recomputation and review; one payroll-eligible employee lacks compensation; no paid/posted payroll was rewritten |

## 1. For a New Session or Agent Picking This Up

1. Run `graphify query "payroll accuracy attendance premiums payslip reconciliation"` for the current implementation.
2. Recall Hindsight using `forson-business-suite`, `payroll-accuracy`, `payroll` for the confirmed attendance policy and limits of this audit.
3. Compare this document with git history and the running system before relying on its status. Changes in this session are uncommitted working-tree changes.
4. Update this document and Hindsight after resolving the outstanding statutory/rollout work, then run `graphify update .`.

## 2. Objective and Decisions Already Taken

The Rate / Days / Gross table implied a multiplication that does not apply to a monthly salary. The audit expanded to calculation inputs, saved statements, employee self-service, printed PDFs and lifecycle approval/payment checks.

- The user confirmed Valencia City, Bukidnon, Philippines, and explicitly instructed keeping the existing manually configured statutory coverage/deductions/overrides/timing. Do not automatically infer MWE status, statutory coverage or exemptions from the region or pay rate. Agency-basis redesign remains outside this requested behavior.
- The user explicitly selected: **deduct unpaid half-days for monthly Attendance salaries; keep lateness and undertime paid.** Do not introduce deductions for recorded late/undertime minutes. Guaranteed salaries retain their existing approved-LWOP-only attendance reduction.
- Keep the monthly contractual cutoff entitlement model and its exact odd-centavo split. An equivalent daily rate is for display/premiums, not the monthly salary formula.
- Read historical statements from snapshots; never silently rewrite approved, paid or posted amounts to match a new engine.
- Fail on calculations whose required data/rules are unavailable instead of paying a plausible but unsupported amount. No payment, loan settlement or production deployment was performed during this work.
- Existing statutory deduction timing and assessment-basis policy were preserved. This is **not** evidence that every existing statutory basis or employee exemption is legally correct.

## 3. Architecture / Calculation Contract

The DTR summary now retains day-level holiday type, rest-day status, fraction, OT and night hours, alongside the original aggregates. Regular unworked-holiday eligibility uses the preceding scheduled working day's DTR; missing evidence requires review. The preceding-day search excludes non-working holidays/rest days and is bounded to 32 calendar days. Local holidays need an explicit standard classification.

The pure premium calculator adds amounts to daily basic or monthly cutoff entitlement without paying a scheduled monthly base day twice. Job-order contracts retain their existing contractual treatment. The existing overtime exemption continues to govern OT/night processing; holiday premiums are not inferred to be exempt merely from the OT flag.

Unpaid monthly half-days are negative earning lines, so gross and taxable earnings decrease together. `gross = basic + holiday/rest premiums + OT + night + allowances + other earnings`; deductions and employer contributions reconcile separately. The integrity service uses integer centavos for comparisons and checks statements before persistence, approval, payout and expense posting. The PDF path also rejects inconsistent saved lines.

The computed trace carries `earningsModelVersion: 2`. Unpaid legacy computations cannot be approved/marked paid without recomputation/review. Missing compensation/DTR exclusions and warnings persist in `policy_snapshot`, including explicit approval blockers, rather than disappearing on reload.

## 4. Corrections — As Built

- [x] BIR band selection uses the greatest applicable lower threshold. Fractional pesos between published whole-peso upper bounds no longer fall into the final bracket.
- [x] Ordinary, regular-holiday, special-holiday, rest-day, holiday-on-rest-day OT and night multipliers use day classification. Special non-working holidays on rest days use 150% for the base work, rather than multiplying 130% twice.
- [x] Eligible unworked regular holiday pay is saved separately and not added twice when explicitly included in the DTR fraction.
- [x] Special Working holidays count as ordinary scheduled working days in DTR generation and monthly divisors.
- [x] Punch derivation writes Manila local clock times, retains holiday/rest-day classification, and treats a four-hour shift as a half-day.
- [x] One-off ADD amounts remain independent of an OVERRIDE on a recurring component. Overrides with no applicable target no longer disappear silently.
- [x] Final-pay ADD adjustments honor deduction component types; taxable additions are recorded for annualisation review; previously assessed benefit excess is not counted again.
- [x] Already-paid 13th-month amounts are summed from THIRTEENTH_MONTH earning lines, rather than all final-pay gross including unrelated additions.
- [x] Payroll reports include holiday/other earnings and totals for taxable/non-taxable allowances.
- [x] Three engine-generated, non-assignable codes are registered by migration `20261017_01_payroll_accuracy_components.sql`: REST_DAY, HOLIDAY_UNWORKED, HALF_DAY_UNPAID. Existing baseline schema and migration checksums were not edited.

## 5. Presentation — As Built

- [x] Payroll register separates basic and additional earnings, labels monthly rates as equivalents, and shows other deductions and the total.
- [x] Shared saved-line breakdown is available in Payroll and My Pay using their existing authorized endpoints. It displays gross, all deduction lines, net and employer-share explanation.
- [x] Monthly BASIC lines do not show an incorrect `quantity @ equivalent daily rate` formula. Day fractions retain three decimals. Final pay is labelled as entitlements rather than a zero daily salary.
- [x] PDF density reduces from the requested 4/3/2 slips to a lower density as needed. A slip longer than one page uses flowing tables instead of clipped fixed-height columns.
- [x] Concurrent PDF requests use unique temporary files so one request cannot overwrite another statement.
- [x] Computed runs expose Recompute and legacy unpaid calculations show a visible review notice.

## 6. Verification and Local Data Evidence

- Seven payroll/DTR/statutory/PDF Jest suites: **255 tests passed**.
- Disposable real-PostgreSQL reference cases: persisted holiday eligibility and premiums, holiday OT, monthly half-days with paid late/undertime, one-cent tampering rejection, and split-rate guard; fixtures roll back.
- Existing employee finance lifecycle integration: passed on an isolated clone, including exact loan identity, reservation races, negative-net protection, actual settlement/payout, full compute/recompute/approve flow, immutable statements and expense recognition. Its manual payslip fixtures now include the earning/deduction evidence required by reconciliation.
- Chromium: desktop and 390px register, employee-scoped detail, complete deductions, monthly explanation, saved totals and three-decimal days passed with intercepted read-only fixtures. Mobile screenshot inspected.
- Real Chromium PDF: compact slip, 30 earnings/20 deductions requiring density reduction, and a 150-earning multi-page slip passed visibility and PDF page-count checks. A rendered long-slip screenshot was inspected.
- Production web build passed. Changed-file API/web lint has no errors (existing unused-variable warnings remain). `git diff --check` passed.
- Graphify code refresh completed; its existing extraction metadata warnings remain, and HTML regeneration was skipped above its 5,000-node limit.
- The session-created disposable DB clone was removed after the lifecycle tests passed.
- New component migration applied to disposable and existing **local development** databases. No wage, payslip or payment amounts changed in that application.
- Read-only local snapshot audit: 36 payslips in seven nonempty retained runs (including voided history); no header/line/run reconciliation discrepancy or saved-table withholding discrepancy. This result does not validate attendance truth or employee classifications.
- Current Posted run 6 has six statements and no arithmetic/saved-table tax discrepancy. This is not proof that no benefit or statutory adjustment is owed.
- Current Computed runs 7 (Job Order, two statements) and 8 (Regular, four statements) use the previous trace version and need recomputation/review. A rolled-back recomputation of run 8 found one additional payroll-eligible employee with no compensation record. Correct compensation or eligibility before approval; do not silently exclude the person.

### Commands

```bash
docker exec forson_backend_dev npm test -- --runInBand --runTestsByPath tests/hrPayroll.test.js tests/hrPayrollComponents.test.js tests/hrPayrollAccuracy.test.js tests/hrPayslipPdf.test.js tests/hrDtrLeave.test.js tests/hrPayrollSettings.test.js tests/hrStatutoryAdmin.test.js
docker exec forson_backend_dev node scripts/auditPayroll.js
docker exec -e EMPLOYEE_FINANCE_TEST_DB=DISPOSABLE_NAME forson_backend_dev node tests/hrPayrollAccuracy_db_test.js
docker exec -e EMPLOYEE_FINANCE_TEST_DB=DISPOSABLE_NAME forson_backend_dev node tests/employeeFinance_db_test.js
docker exec forson_backend_dev node tests/hrPayslipLayout_browser_test.js
npm run -w packages/web build
graphify update .
```

The DB scripts refuse names outside `codex_employee_finance_verify_*`. Use a disposable migrated clone; never point the financial fixture suite at a business database. The browser script is `packages/web/tests/payrollAccuracyBrowser.mjs` and fixture is served by Vite. When running Chromium from the backend container, set PAYROLL_BROWSER_PACKAGE to `/usr/src/app/package.json` and PAYROLL_BROWSER_BASE_URL to the frontend's private IP URL (Vite rejects the Docker host name).

## 7. Remaining Work and Explicit Limits

### Unsupported calculations now blocked

- [ ] Dedicated SPECIAL and THIRTEENTH_MONTH run computation. They previously fell through to regular salary and could duplicate pay; now they fail with a specific error. The existing 13th-month entitlement report remains available.
- [ ] Effective compensation changes inside a cutoff require an actual split-rate calculation. The new guard refuses applying the final rate to every day.
- [ ] OT/night overlap needs explicit overlap quantities or approved allocation evidence. A cutoff-wide total cannot establish which night hours were also overtime. The new day-specific path blocks ambiguous overlap.
- [ ] Annual tax reconciliation for taxable final benefits/additions is not implemented. Final payslips needing it are flagged and approval/payment is blocked.
- [ ] Weekly/monthly/partial custom payroll periods need their own entitlement and withholding frequencies. The engine now permits complete semi-monthly cutoffs only.

### Statutory and input review still required — do not certify this as complete

- [ ] Any future SSS assessment-basis/monthly true-up redesign requires a separate explicit policy change; the user instructed preserving current statutory behavior. Official employer guidance references gross monthly compensation; the existing engine uses a contracted/annualized monthly rate as its common basis. Variable earnings, absences and employment changes can make those different. No automatic retrospective reassessment or statutory refund ledger was added here.
- [ ] Owner review of worker classification, minimum-wage-earner tax treatment, statutory exemptions, premium coverage, actual work schedules and configured annual divisor against employment agreements and applicable rules, when certifying legal eligibility. Valencia City, Bukidnon is confirmed; do not automatically change classifications based on it. Existing booleans/overrides are inputs, not legal verification.
- [ ] Validate actual attendance and holiday eligibility evidence. Auto-generated Present rows remain trusted input under the existing product design; mathematical reconciliation cannot prove someone worked.
- [ ] Implement complete annual benefit-cap aggregation across other benefit categories and year-end/termination annual tax adjustment before claiming full BIR compliance. The final-pay changes fix the identified current-slip arithmetic, not the missing annual tax subsystem.
- [ ] Owner review of the two unpaid runs and missing compensation, deployment of the migration/API/web together, and evidence-based correction of any confirmed historical differences. No historical underpayment/overpayment was established solely by the arithmetic audit.

## 8. Sources Checked

- [DOLE handbook, holiday eligibility and premium rules](https://nwpc.dole.gov.ph/wp-content/uploads/2024/11/Workers-Statutory-Monetary-Benefits-Handbook-2024-Edition.pdf).
- [BIR official Annex E, revised withholding tables effective 2023 onward](https://bir-cdn.bir.gov.ph/local/pdf/Annex%20E%20RR%2011-2018.pdf).
- [SSS contribution rates and MSC limits](https://www.sss.gov.ph/pay-contribution/); [SSS employer guidance on gross monthly compensation](https://www.sss.gov.ph/employer-er/).
- [PhilHealth advisory on the 5% rate, floor/ceiling and monthly basic salary basis](https://www.philhealth.gov.ph/advisories/2025/PA2025-0002.pdf).
- [Pag-IBIG Circular 460 published by DMW](https://wcms.dmw.gov.ph/uploads/DMW_ADVISORY_37_2025_01225b9fec.pdf).

## 9. Files Touched

- `database/migrations/20261017_01_payroll_accuracy_components.sql`.
- `packages/api/services/hr/{attendanceEarningsService,payrollIntegrityService,payrollCalculationService,payrollRunService,payrollPostingService,payrollReportService,statutoryService,dtrService,timePunchService}.js`.
- `packages/api/helpers/pdf/payslipPdf.js`, `packages/api/templates/pdf/payslip.html`, `packages/api/scripts/auditPayroll.js`.
- `packages/api/tests/{hrPayrollAccuracy.test,hrPayrollAccuracy_db_test,hrPayslipLayout_browser_test,employeeFinance_db_test}.js`.
- `packages/web/src/components/hr/{PayslipBreakdown,EmployeeDetailDrawer}.jsx`, `packages/web/src/pages/{PayrollPage,MyPayslipsPage}.jsx`.
- `packages/web/tests/payrollAccuracyBrowser.mjs`, `packages/web/tests/fixtures/payrollAccuracyBrowser.html`.

## 10. Change Log

- 2026-10-17: Audited local saved payroll, confirmed half-day-only policy, implemented computation/display/reconciliation fixes and fail-closed guards; verified unit, PostgreSQL lifecycle and Chromium cases. Full statutory assessment/classification/annualisation and rollout remain explicitly incomplete.

- 2026-10-18: User confirmed Valencia City, Bukidnon and explicitly retained manual statutory controls/current behavior; no region-based classification or automatic statutory assessment redesign was introduced.
