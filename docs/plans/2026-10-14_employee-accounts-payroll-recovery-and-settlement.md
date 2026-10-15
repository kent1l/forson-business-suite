# Employee Accounts, Payroll Recovery & Settlement — Final Implementation Plan

**Status:** Final planning handoff; application implementation NOT STARTED.
**Goal:** Provide reliable employee loans/vale, cutoff-selectable deductions, direct repayments, actual salary payouts, unpaid salary residuals and agency remittance without duplicate balances or cash movements.
**Architecture:** Extend existing payroll and loan machinery; persist exact obligation allocations; add source-linked settlements and an Employee Accounts read model. Reuse business-advance custody/liquidation. No general-purpose wallet.
**Stack:** Existing Node/Express, raw PostgreSQL SQL migrations, React/Tailwind and state-based navigation. No new ORM, router, state library or public financial search index.

This plan supersedes the implementation recommendations in the earlier chat-local employee-account audit. Audit observations are source leads, not deployment certification. Implementers must re-read repository instructions/current HEAD and preserve unrelated changes.

## 1. Business scope and canonical ownership

The Accounts workspace has four separate panels, never one automatically netted balance:
1. **Owed to company:** company loans/vale and explicitly supported employee receivables.
2. **Owed to employee:** unpaid salary, approved unpaid reimbursement claims when supported, and unapplied repayment credits.
3. **Government loans:** tracked SSS/Pag-IBIG obligations, payroll withholdings, unremitted installments and reconciliation status.
4. **Business advances:** existing cash custody, receipt liquidation, returns and advance-linked reimbursements.

Payroll is one recovery channel, not the only record of employee debt. The workspace links canonical source documents rather than maintaining an independently editable wallet.balance. Employee identity is independent of login access; separated employees retain their financial history.

### Reuse / repair / add

- **Reuse:** employee profiles, recurring pay components, payroll adjustments, payslips, calculation precision helpers, existing business cash advances and cash-movement infrastructure.
- **Repair first:** exact loan identity, cutoff scheduling, insufficient-pay handling, recovery concurrency and unpaid-only voiding.
- **Add:** loan management/release linkage, direct collections, actual payouts/residuals, employee statements, agency-loan remittance.
- **Do not add:** spendable wallet, automatic cross-category netting, duplicate employee/customer A/R principals or automatic business-advance-to-personal-debt conversion.

## 2. Source baseline and verified scheduling gap

Inspected source leads:
- `packages/api/services/hr/payrollCalculationService.js:579-599`: loans use `deduct_on_cutoff === cutoffSeq`, installment amount and outstanding cap. Exact loan IDs are returned in memory.
- `database/migrations/20260813_13_hr_payroll_core.sql:306-329`: loan cutoff permits only 1 or 2, default 2. Loan split is NOT represented by that schema.
- `packages/api/services/hr/statutoryService.js:184-204`: existing FIRST_CUTOFF / SECOND_CUTOFF / SPLIT_HALF monthly proration, with the second cutoff taking the centavo remainder.
- `payrollCalculationService.js:177-201`: recurring components already distinguish FIRST_CUTOFF, SECOND_CUTOFF, MONTHLY and EVERY_CUTOFF. EVERY_CUTOFF means the entered amount each cutoff, not half a monthly amount.
- `packages/api/services/hr/payrollRunService.js:494-508,620-650`: exact loan allocation is not persisted; mark-paid reconstructs recoveries by employee/component.
- Same service `:26-34,656-690`: currently permits Paid/Posted voiding and deletes linked loan payment rows.
- `packages/web/src/pages/PayrollPage.jsx:292-297`: void action currently appears for all non-Voided statuses.
- `packages/api/routes/cashDrawerRoutes.js:454-544`, `packages/web/src/pages/CashDrawerPage.jsx:259-310`: existing business-advance release/liquidation/return/reimbursement/settlement.
- `packages/api/services/hr/payrollPostingService.js`: gross payroll/employer expense recognition is not per-employee payout evidence.
- `packages/api/services/hr/payrollReportService.js:47-100`: statutory contribution reports are not government-loan remittance records.

Read the local architectural SYSTEM_CONTEXT as background; where stale, current verified source wins. This planning pass did not verify deployed migrations, runtime balances, authenticated browser behavior or execute application tests. Historical deficit-roll-forward memories are not evidence of an implemented deficit ledger.

## 3. Final deduction scheduling contract

### 3.1 Fixed loans, vale and balance-linked installments

Every personal obligation has a **Monthly installment amount** and **Deduct on** selector:

| UI choice | Stored schedule | First cutoff | Second cutoff |
|---|---|---|---|
| 1st cutoff | FIRST_CUTOFF | Full monthly installment | Zero |
| 2nd cutoff | SECOND_CUTOFF | Zero | Full monthly installment |
| Split across both cutoffs | SPLIT_HALF | Rounded half | Monthly installment minus first share |

Use integer minor units/decimal arithmetic with explicit half-up rounding for positive fixed amounts. The second share is a remainder, not another independently rounded half. Reuse verified proration semantics without relying on binary floating point for persisted money.

The entered amount is NOT multiplied by the number of cutoffs. UI must show monthly amount and both cutoff previews before save. Reuse existing pay-period sequence to identify cutoffs; do not infer it from the payment date or hardcode calendar day boundaries.

Additional rules:
- Bind allocations to exact obligation, recovery month, cutoff, pay period, run/payslip and schedule version.
- Prevent duplicate recovery for the same installment slot across regular, supplemental or replacement runs. Off-cycle/final-pay collection requires an explicit allocation/review; it must not automatically run another monthly installment.
- At computation, cap a scheduled share against available obligation balance after valid payments and competing approved reservations; exclude the current draft's replaced reservation.
- Outstanding obligation balance and unpaid scheduled installment are different quantities. An uncollected installment does not create another principal charge.
- Schedule changes are effective-dated and audited. Once a month has an approved installment reservation or posted recovery, ordinary schedule changes take effect next recovery month. Earlier changes require authorized release/recompute/reapproval of affected unpaid payroll; no silent rewriting.
- On a mid-month start, default to the remaining eligible share only: no automatic full-month charge or catch-up. Display the reduced first-month collection and require explicit authorized catch-up if needed.
- Void releases that run's reservations; a corrected replacement can collect the still-unrecovered slot once. A second regular run cannot collect an already recovered installment again.

### 3.2 Missed, partial and insufficient deductions

- A missed first-cutoff amount does NOT silently double the second cutoff.
- Display scheduled, reserved, collected, deferred and outstanding amounts separately.
- Recovery review may authorize catch-up, partial collection, defer or skip for an exact obligation, subject to valid deduction authority and available pay.
- Do not extend company-loan interest, rewrite agency schedules or increase principal merely because collection was deferred.
- Block payroll approval/settlement on unresolved negative net pay. Calculate any mandatory-deduction shortfall transparently; do not silently waive it, auto-create an employee loan or claim an unverified payroll_deficit feature.
- Determine available recovery pay after supported required deductions and any configured, legally reviewed protected-pay rule. If optional debts compete, require explicit review/priority allocation, never incidental SQL/array order.
- Final-pay recovery is separately reviewed/authorized, capped by available pay and debt, and leaves unpaid balances outstanding. It does not bypass the cutoff/month identity safeguards.

### 3.3 Existing recurring and statutory deductions

- Preserve fixed recurring FIRST_CUTOFF / SECOND_CUTOFF / MONTHLY semantics. Label fixed MONTHLY as 'Split monthly amount'.
- Preserve legacy EVERY_CUTOFF as 'Fixed amount each cutoff'; show its meaning distinctly. Never relabel it as split or halve old values silently.
- One-time adjustments apply only to the selected run. Balance-linked overrides require exact obligation IDs, not only component codes.
- Percentage-based components retain their existing reviewed basis until explicitly redesigned. New fixed monthly splitting must not halve a percentage of already cutoff-earned basic pay again. Show the assessment basis in UI; flag ambiguous legacy percentage + MONTHLY assignments for review rather than silently changing them. Percentage-basis redesign is deferred, not a blocker for fixed loan scheduling.
- Statutory contributions and withholding tax remain separate from loan recovery. Preserve the existing statutory scheduling and monthly reconciliation policy; do not let a loan selector alter contribution bases, agency totals or tax rules. Any future statutory schedule UI uses its own policy scope/version and compliance review.

## 4. Payroll lifecycle and unpaid-only void

**Ordinary Void = cancel a mistakenly generated payroll before any payout, not reverse paid wages.**

Eligibility:
- Draft / Computed / Approved: eligible only if unpaid, with no posted recovery/remittance and no active/unknown payment instructions.
- Paid / Posted: reject ordinary void, even if someone claims the payment confirmation was a mistake.
- Voided: no further state change; an exact completed-request retry safely returns the prior result.
- Any actual or partial payout blocks ordinary void regardless of stale run status. Pending bank/cash instructions must be conclusively canceled/reconciled first.

Backend must lock and recheck status and linked financial records in the same transaction, sharing the lock protocol used by payout/recovery posting. UI visibility follows backend eligibility but is not authorization. Return eligible=false with a user-safe blocker reason for the detail screen; definitive checks happen at write time.

Eligible void requires payroll:void permission and reason; sets Voided with actor/time, excludes the run from active payroll, releases its own DTR locks and pending reservations, preserves run/payslip audit evidence and permits a corrected replacement. It does NOT move cash, delete actual payments or undo real loan collections. Unexpected financial records under an unpaid status are an integrity conflict requiring investigation.

Paid corrections use a separate authorized adjustment/correction workflow preserving original payroll and financial events. They may record additional owed salary, verified overpayment or linked reversals only when actual evidence warrants them. Correcting a mistaken Mark Paid must not fabricate returned cash. Do not provide an unsafe paid-to-unpaid status toggle as a shortcut.

Keep the existing Draft -> Computed -> Approved lifecycle. Introduce a separate settlement state (NOT_STARTED / IN_PROGRESS / PARTIAL / SETTLED / NEEDS_REVIEW) rather than silently reinterpreting historical run statuses. Resolve current Paid/Posted semantics in an additive compatibility migration: mark Paid only after all required employee settlement steps complete; Posted remains expense-recognition completion, not payment evidence.

## 5. Loan/vale operating workflow

1. HR creates a draft with employee, company/agency creditor, type, reference/evidence, collectible opening amount, monthly installment, schedule, start period and recovery authorization.
2. Approver reviews. A company-funded obligation activates only on confirmed release; agency enrollment activates from verified agency evidence without company cash-out.
3. Payroll computes exact proposed allocations, previews both cutoffs and flags exceptions.
4. Approval freezes terms and reserves recovery amounts against exact obligations. Draft computation itself is not repayment.
5. At employee settlement execution, an explicit idempotent noncash recovery event applies the approved offset; actual net wage disbursement is recorded separately. A zero-net settlement can recover debt without a fictitious cash payment. Partial cash payouts do not rerun or prorate already posted recovery.
6. Company direct repayment posts once through a verified collection/funding source and reduces the same debt. While payroll reservations exist, reject conflicting collection and require authorized release/recompute of affected unpaid payroll; never quietly underfund an approved recovery.
7. Hold/resume and future-effective schedule changes preserve debt and audit history. No 'Complete' button may erase a balance. Settlement is derived from valid recoveries/authorized adjustments.
8. Company collections and agency loans have different creditor boundaries: an employee's verified direct payment to an agency requires reconciliation against agency evidence, not a company cash receipt. If the company accepts money to remit, record agency liability and subsequent remittance distinctly.

Original principal, total collectible amount, imported opening balance and interest/fees must be explicit. Do not invent interest or reinterpret historical principal_amount. Partial/direct repayment allocation to installment arrears versus principal must be selected and documented; never infer agency amortization changes from internal payroll records.

## 6. Actual payroll payouts and centavo residuals

- Immutable approved payslip defines entitlement; exact recovery events define noncash offsets; actual payout records define cash/bank settlement.
- Record employee, actual amount, method, funding source, occurrence/recording times, source evidence, actor and exact payslip allocations.
- A payment may settle current and older residuals. Prevent over-allocation and duplicate funding under locks/idempotency.
- Unpaid net salary, including cash centavos, remains owed to the employee until settled. Do not change gross earnings or invent a deduction to hide a payout difference.
- Employer-funded upward rounding is an explicit approved adjustment, not automatic employee debt. Rounding policy/version and settlement evidence remain visible. No silent write-off or indefinite wage withholding.
- Failed/unknown transfers are not confirmed payouts. Preserve request identity across reload, reconcile outcome, and prohibit replacement submissions until resolved.
- Only actual cash receipt/release creates a drawer movement. Gross payroll expense, loan offset, allocation and remittance reconciliation do not each generate another cash movement. Respect drawer custody, approval, count-pause and closed-session guards.
- Loan recovery reduces company receivables; it does not reduce gross wage expense. Government withholding creates/remains a remittance obligation until paid.

## 7. Schema/migration specification

Proposed additions; verify names against HEAD before implementation. Forward-only raw SQL migrations with database constraints, actor/time metadata and indexes. Do not edit applied migration history.

### Loan schedule and legacy migration

- Add effective-dated `employee_loan_schedule`: schedule_id, loan_id FK RESTRICT, schedule enum FIRST_CUTOFF/SECOND_CUTOFF/SPLIT_HALF, monthly_installment NUMERIC(12,2)>0, effective_from_recovery_month, effective_to, start eligibility, authorization/evidence, version and actor/timestamps. Reject overlapping active ranges per loan.
- Add creditor/purpose, draft/activation/evidence and collectible-opening metadata to existing employee_loan with compatibility constraints. Preserve existing historical loan types/status readers until migrated.
- Backfill deduct_on_cutoff 1 -> FIRST_CUTOFF, 2 -> SECOND_CUTOFF, monthly_installment = legacy amortization_amount. Do not double/halve legacy amounts or default all loans to split. Freeze old payslip amounts. Expose migration review for ambiguous imported balances/interest.
- One canonical schedule reader after cutover. During compatibility, synchronize old 1/2 representations where possible and block old writers from mutating split schedules; do not run conflicting independent schedule sources.

### Persisted allocations/reservations

- Add `payroll_deduction_allocation`: allocation_id, exact loan_id or validated typed future receivable target, employee_id, payslip_id/line_id, pay_period_id, recovery_month, cutoff_seq, schedule_id/version, scheduled_amount, approved_amount, status, recovery/correction references and audit fields.
- Add enforceable installment-slot ownership/reservation records or equivalent transactional constraints: monthly/slot budgets must not be exceeded across runs; partial collections may have multiple events but one bounded schedule entitlement. Include plan version, supplemental/final-pay authorization and release history.
- Positive money constraints, cross-employee ownership validation and unique request/event identities. Index employee/status, loan/month/cutoff and payslip references.
- Replace component-based loan repayment reconstruction with these exact allocations for regular and final pay.

### Settlement/event additions

- Extend loan recovery events/payment records with allocation/direct-collection source, actor, occurrence/recording times, idempotency identity and linked reversal. New financial events are append-only. Replace deletion-based balance recalculation with reversal-aware aggregation atomically; historical payment rows are not counted twice.
- Add controlled direct employee collection document/allocations linked to existing funding movement/payment identity; do not create another receipt for its allocation rows.
- Add `payroll_payout` and `payroll_payout_allocation` with employee, amount, method/funding, evidence, status, exact payslip targets, source uniqueness and corrections. Store noncash recovery separately from cash payout.
- Add explicit unapplied payable credit only when accepting employee overpayments; no negative loan balance or silent netting.
- Derive employee summaries/statements from canonical loan, payout/payable and custody records. Existing business advances retain their own schema and event owners.

### Agency remittance

- Add agency-loan remittance header and allocations to exact withheld installments: agency/period, official reference, amount, existing treasury payment/funding identity, payment/confirmation state, evidence, actors/times and corrections.
- Separate withheld, remitted and reconciled. Limit allocations to available unremitted withholding. Contribution and loan allocations remain distinguishable even under one external payment.

Use exact decimals/minor units; deterministic lock order and scoped FOR UPDATE aliases; RESTRICT financial-history deletion; unique source references and request identities. Financial employee data must not enter public Meilisearch indexes or credential-bearing browser drafts.

## 8. API contracts (proposed)

All routes use existing protect/permission patterns; existing mounts must be verified. Money is returned as exact two-decimal strings. Mutations require version, idempotency identity and authorization/reason where relevant. Same key+payload returns original result; changed payload returns 409.

| Endpoint | Request / response | Validation |
|---|---|---|
| GET /api/hr/employees/:id/accounts | Four separate summaries, paginated source-linked transactions, freshness/partial-state metadata | Finance scope or authenticated self; no blended wallet balance |
| GET /api/hr/employees/:id/account-statement | Date/type filters; opening, entries, closing by domain | Server-scoped employee access; immutable sources |
| POST /api/hr/employees/:id/loans | Creditor/type, opening/collectible terms, monthly installment, schedule, start period, evidence; returns draft ID/version and cutoff preview | Supported combinations; positive amounts; no financial release yet |
| POST /api/hr/loans/:id/activate | Approval and verified release/enrollment reference; returns active state | Company release required only for company-funded debt |
| POST /api/hr/loans/:id/schedule-changes | monthly_installment, schedule, effective recovery month, version, reason; returns effective schedule and previews | No overlap or silent approved-payroll mutation |
| POST /api/hr/loans/:id/hold or /resume | Version/reason; returns status and affected upcoming periods | Does not erase debt or rewrite frozen allocations |
| POST /api/hr/employee-collections | Employee, exact targets, amount, method/funding/evidence; returns collection ID, allocations and balances | Creditor boundary, outstanding/reservation locks, one cash-in |
| POST /api/payroll/payslips/:id/recovery-review | Exact allocation IDs and recover/defer/skip/catch-up amounts/reasons | Editable lifecycle, authority, available-pay and slot limits |
| POST /api/payroll/employee-settlements | Approved payslip/recovery IDs and version; returns noncash recovery posting identities and remaining payout | No double recovery, valid employee and debt reservation |
| POST /api/payroll/payouts | Actual amount, employee, method/funding/evidence and payslip allocations | Approved entitlement, no overpayment unless explicit approved credit, source/cash controls |
| POST /api/hr/loan-remittances | Agency/period, existing payment/reference and installment allocations | No excess/unverified or duplicate remittance |
| GET /api/payroll/runs/:id | Existing detail extended with settlement summary and void eligibility/blocker reasons | Read permission; final write checks are separate |
| POST /api/payroll/runs/:id/void | Existing reason contract plus expected version/request identity; returns Voided/run ID | Only unpaid eligible statuses; reject financial/pending-payment blockers atomically |

Paid correction/reversal commands must be source-specific and independently authorized; do not add a generic undo-everything endpoint. Their contracts must name affected payroll/recovery/payout/remittance records and required evidence before implementation acceptance.

Standard responses: 201 created or 200 read/replay; 400 malformed; 403 unauthorized; 404 absent; 409 stale/state/idempotency conflict; 422 financial constraint. Response includes document ID/status, exact amounts, source/allocation IDs, version and replay indicator; pagination follows existing helpers.

Reuse payroll:view/compute/approve/post/void, hr:manage_compensation and relevant cash-drawer keys within their current domains. Seed explicitly proposed employee_finance:view/manage/approve/collect/pay/remit/correct permissions and role mappings after verifying the current permission catalog. HR profile access alone is not financial authorization. Self-service derives employee identity from auth, not request input. No password persistence in retry state.

## 9. UI delivery

Use existing employee detail primitives and navigation; add Accounts tab and an HR/Payroll Employee Accounts register. Existing business-advance forms remain their canonical workflow.

- Statement-first, four labeled categories, exact full peso amounts; no decorative wallet balance.
- Loan form: creditor/type, evidence, monthly amount, start period, 1st/2nd/split selector, both cutoff previews, authorization and next deduction. Explain legacy per-cutoff recurring items distinctly.
- Schedule history and future change effective month visible; expired versions remain available for audit.
- Payroll review: exact loan reference, scheduled/approved/deferred/remaining, available pay, exceptions and source links. Never merge multiple same-category obligations into an untraceable input.
- Payout view: entitlement, recovered deductions, actual paid, remaining payable, funding/evidence and unknown-write state.
- Void shows only when eligible and authorized; unpaid cancellation confirmation explains preserved history and regenerated payroll. Paid/Posted views explain the separate correction action.
- Loading, empty, filter-empty, failed/partial, stale, permission-denied and unknown-outcome states are distinct. Mobile retains unabridged figures and usable controls; keyboard focus returns after dialogs. Financial data must not leak through cached state after account changes.

## 10. Execution phases and acceptance gates

All implementation phases below are **NOT STARTED**, not deferred. Each phase requires connected UI/API, tests, documentation and explicit done/pending evidence.

### Phase 1 — Lifecycle and exact recovery foundation

1. Revalidate HEAD/schema/test discovery and capture baseline without altering production.
2. Add unpaid-only void guards and UI eligibility; preserve audit records and release only pending reservations/DTR locks.
3. Persist exact regular/final-pay obligation allocations and remove component-based matching.
4. Add reservation/locking and source-aware append-only recovery correction foundations.
5. Verify same-category concurrent loans, custom components, stale status, duplicate requests, void vs mark-paid/payout races and historical run preservation.

Gate: no paid/partial payroll can be ordinarily voided; no recovery can hit the wrong obligation or exceed the debt.

### Phase 2 — Cutoff schedules and operational loan management

1. Add schedule versions and reviewed legacy migration.
2. Implement first/second/split fixed installments, exact remainder, monthly/slot budgets and effective changes.
3. Add loan/vale creation, approval, release/enrollment activation, hold/resume, direct collection and exact recovery review UI/API.
4. Verify mid-month start, missed/deferred deductions, explicit catch-up, direct payment conflicts, supplemental/replacement/final pay and insufficient-pay approval blocking.

Gate: each fixed monthly installment can be scheduled without doubling or losing centavos; no hidden catch-up or frozen-history rewrite.

### Phase 3 — Actual settlement and Employee Accounts

1. Add explicit employee settlement/recovery events and actual payout allocations with drawer/bank integration.
2. Build source-linked employee summary/statement, unpaid salary and centavo residuals.
3. Test zero-net recovery, partial payouts, failed/unknown bank payment, old/current residual settlement, approved rounding and funding uniqueness.
4. Migrate historical Paid/Posted records as provenance-labeled legacy settlement assertions, not invented bank evidence/cash movements. Unknown legacy details remain unknown.

Gate: entitlement, recoveries and actual money paid reconcile separately, with no duplicate expenses/cash movements.

### Phase 4 — Agency-loan remittance and operational rollout

1. Add withheld/remitted/reconciled records and source-linked remittance UI/API using existing Treasury funding identity.
2. Verify partial/duplicate remittance, agency statement differences, employee direct agency payments, separation and post-remittance corrections.
3. Complete authenticated role flows, browser/build/disposable-DB verification, staged migration dry run and owner acceptance.

Gate: a deduction is never labeled remitted solely because payroll was marked Paid.

## 11. Required test matrix

- FIRST_CUTOFF, SECOND_CUTOFF and SPLIT_HALF against both actual cutoff sequences; reject unsupported sequence/schedule values.
- Odd-cent monthly amount: both shares sum exactly; original monthly total is not applied twice.
- Legacy cutoff 1/2 retains original amounts; recurring EVERY_CUTOFF is not silently converted; percentage ambiguity is surfaced.
- Two loans sharing a component, each with its own schedule/balance; final installment caps and direct repayment concurrency.
- Mid-month activation, next-month schedule change, paused/resumed, missed/partial first share and explicit versus absent catch-up.
- Duplicate regular/supplemental/replacement/final-pay runs cannot recover the same slot beyond its approved budget.
- Zero/insufficient earned pay, required-deduction shortfalls, protected-pay setting and explicit exception approval; no fabricated deficit debt.
- Draft/Computed/Approved unpaid void succeeds; Paid/Posted/partial/pending-payment/recovery/remitted void fails with no side effects. Simultaneous void/payout has only one valid outcome.
- Void preserves records and actual cash/debt; corrected payroll can regenerate; repeated requests reconcile safely.
- Zero-net noncash recovery, actual partial payout, cents carried, old balance settled once, upward rounding explicitly funded.
- Permission/employee isolation, login-disabled former employee, stale versions, reload/network-unknown retry and account switching.
- Agency withholding versus remittance, source uniqueness, partial payments and corrections.

Inspect packages/api/jest.config.js and current package scripts before choosing commands; default discovery can omit standalone database scripts. Run fixture-writing and concurrency tests only against an explicitly disposable database. Record actual commands/results, browser identity/roles and limitations; do not invent pass counts. Proposed performance targets: normal paginated statement/summary p95 <500ms, transactional write p95 <1s excluding external gateways; measure before claiming compliance.

## 12. Likely implementation surfaces and documentation

Existing: packages/api/services/hr/payrollCalculationService.js, payrollRunService.js, payrollPostingService.js, payrollReportService.js, statutoryService.js; packages/api/routes/payrollRoutes.js and hrRoutes.js; packages/api/services/cashDrawerService.js and routes/cashDrawerRoutes.js for guarded funding reuse; packages/web/src/pages/PayrollPage.jsx and components/hr/EmployeeDetailDrawer.jsx; database/migrations; packages/api/tests/hrPayroll.test.js and new targeted disposable-DB/API/UI tests.

Keep a small shared schedule evaluator and exact allocation service rather than duplicating cutoff rules in UI/calculation/payment posting. Add dedicated employee-finance services/routes/components following existing conventions; verify actual names at HEAD. No background worker is required for the fixed schedule itself. Unknown bank outcomes require durable reconciliation, not an untracked timer. Sensitive statements remain permission-filtered and unindexed publicly.

Per-phase As Built documentation must record business behavior, migrations/schema, API/permissions, files touched, commands/results, done/pending, explicitly deferred items, rollout gates and rollback/compatibility considerations. Preserve applied SQL history; run graphify update . after source changes where available. Do not mark the feature production-ready until migration and authenticated workflow gates pass.

## 13. Explicitly deferred / not required

These are deliberately deprioritized, unlike the not-started implementation phases:
- General-purpose spendable employee wallet and automatic cross-domain netting: **not required**.
- Standalone reimbursement application/approval payable module beyond existing advance-linked reimbursements: **deferred**, unless independently required.
- Employee credit-purchase/customer A/R bridge, generic non-loan receivable instruments and overpayment recovery: **deferred** pending source-owner verification. Existing customer A/R must remain canonical.
- Employee self-service loan applications and payment requests: **deferred**; own-statement read access may be added after authorization verification.
- Automatic interest/penalties, automatic advance-to-loan conversion and automatic payroll-deficit debt: **excluded**.
- Redesign of statutory bases/rates, variable percentage assessment, agency portal automation and PRN generation: **out of scope**. Loan schedule selection must not silently change them.

Planning is finalized. No application implementation, deployment, migration execution or runtime certification is implied.