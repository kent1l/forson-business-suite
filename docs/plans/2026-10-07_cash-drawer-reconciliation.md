# Cash Drawer & Reconciliation — Final Module Plan and Developer Handoff

> **Forson Business Suite** | **Date:** 2026-10-07 (Asia/Manila) | **Branch inspected:** `cash-count-module`
> **Status:** Product/architecture/UI design complete; local mockups browser-tested. Application implementation is NOT established by this handoff; the planned migrations, posting service, connected screens and store rollout remain unstarted/unverified. Documentation only; no application code, migrations or live financial records changed.

## 0. Status at a Glance

| Phase / item | Status | Evidence / next step | Detail |
|---|---|---|---|
| Product, custody and count rules | Design complete | Owner clarification incorporated | §2–5 |
| Existing integration discovery | Partially done | Repository sources inspected; live schema and complete writer inventory still pending | §3, §6 |
| Phase 1: schema, permissions and invariants | Not started by this work | Implement after live catalog/source audit | §6 |
| Phase 2: atomic posting, source integration and API | Not started by this work | Cover every physical cash writer | §7 |
| Phase 3: connected UI | Design complete; production implementation not started | Local demo != application | §8 |
| Phase 4: runtime tests, reports and cutover | Not started | Real PostgreSQL/concurrency/store-day gates | §9 |
| Prototype browser verification | Passed locally; scope limited | No live integration or completed visual-AI review | §12, UI handoff |
| Live DB, base-branch diff, graph update, deployment | Not verified / not run | No remote executor exposed | §3, §12 |
| Full treasury, offline financial posting, native mobile | Explicitly deferred | Revisit triggers recorded | §10 |

Status reflects bounded repository inspection, not an exhaustive assertion that no related feature exists under other names. Revalidate before implementing.

## 1. For a New Session or Agent Picking This Up

Before starting:
1. Run `graphify query "cash drawer payments expenses refunds AP wallet custody counts"` and focused `graphify explain` on current source services. A generic UI Drawer result is not a cash ledger.
2. Recall Hindsight with query `"FBS cash drawer reconciliation notebook CASH SALES funding source"`, tags `forson-business-suite`, `cash-drawer`.
3. Confirm this table against `git status`, `git log --oneline -20`, an actual verified-base branch diff, migration status and running schema/API. If newer work exists, update this doc before trusting its checklist.
4. Read [Cash Drawer UI Design](./2026-10-07_cash-drawer-ui-design.md). It is self-contained; the local HTML demo/chat is not required.
5. Inspect all current source writes/triggers, especially mirror payment records, actual refund disbursement and Expenses/AP funding sources. Do not build a parallel ledger from Sales History summaries.

When a phase lands: update §0 and itemized phase details; retain non-obvious architecture/gotchas to Hindsight; run `graphify update .` on the actual repo host. Optional Markdown semantic indexing is best effort and must never bypass Graphify shrink-guard.

## 2. Objective and Acceptance Criteria

Replace the disconnected Google Sheets cash register and denomination sheet with one FBS workspace that answers: how much cash should be here, how much was counted, who handled it, and what explains the difference.

Initial rollout: **one Main Counter drawer, normally one daily session**, multiple operators with a designated custodian. Model additional drawers without requiring a full treasury system.

### User stories
- Cashier opens from verified float, trades through existing FBS payment flows and manually enters only exceptions/counts.
- Manager can trace withdrawals, handovers, advances, count snapshots and discrepancies without silent edits.
- Business owner retains an immutable daily report and avoids duplicate notebook/Sheets/FBS cash receipts.

### Observable acceptance
- Every physical cash event is represented once, atomically linked to its source; opening float is not duplicated as revenue/receipt.
- Noncash payments, discounts, withholding and credit sales have zero drawer effect.
- A count compares physical denomination total to expected cash at the SAME cutoff; later movements do not rewrite that comparison.
- Every nonzero closing variance needs documented independent manager review and remains visible.
- Cash sent to the safe/bank runner has a named custodian; deposit confirmation is separate from release.
- Office expenses paid elsewhere do not touch Main Counter; an expense paid from an earlier advance does not create a second drawer release.
- Closed reports and original counts survive corrections and later custody settlement.

## 3. Verified Current State and Limits

### Completed discovery
- [x] MCP `project_status`: `cash-count-module...origin/cash-count-module`, no tracked/untracked changes displayed before publishing these docs.
- [x] MCP `project_log(limit=20)` inspected recent history; latest displayed subject is master-data merge work, not implementation evidence for this module.
- [x] MCP `project_diff` returned empty bounded working-tree stats BEFORE doc writes. This is not a base-branch diff.
- [x] Existing planning convention inspected: numbered sections, Status at a Glance, new-agent block, phases, deferred/files/verification/change log. Sales-correction plan read fully; mobile Smart PO example read via bounded ranges.
- [x] Bounded migration search `cash_drawer|cash_session|cash_movement` returned no matches; bounded packages search returned only SalesHistory cash estimates.
- [x] Live repository reads earlier in this discussion inspected paymentRoutes, expenseRoutes, refundRoutes, AP payment migration, payment tables, MainLayout/App/navigation. These are source/schema-file findings, not queries of running PostgreSQL.
- [x] Current `SalesHistoryPage.jsx` inspection found `expectedNetCashDrawer = Math.max(cashCollectedNet - refundsApprox, 0)`, derived from payment list with method-name/current-invoice filters and approximated refunds. This is a sales-derived estimate, NOT opening+custody+movement truth. Do not inherit its zero-clamp or refund approximation into the drawer ledger. Actual source of the owner's copied CASH SALES figure still needs report mapping confirmation.

### Still required / inaccessible here
- [ ] Verified-base `git diff <base>...HEAD --stat`; MCP exposes bounded current working-tree diff only.
- [ ] Live database migration ledger, catalog constraints, cash/refund/disbursement APIs and real application behavior.
- [ ] Exhaustive all-route/trigger/service source-write inventory and mirror deduplication plan.
- [ ] Real runtime tests, applied migrations, benchmark and store pilot.
- [ ] Remote `graphify update .`, commit and push. No remote execution tool exists in the exposed MCP. Local terminal is agent host; earlier SSH attempt could not resolve dev-server.

No cash-drawer feature is claimed committed, applied or deployed. These docs are durable repo files, not necessarily Git-committed records.

## 4. Decisions Already Taken

1. **Physical custody only:** cash notes/coins in this drawer. GCash/card/bank/credit/cheques/PDCs/discounts/withholding certificates/wallet redemption are not physical receipts.
2. **Notebook clarification supersedes ambiguity:** Notebook is a casual unreceipted notebook sale, but the sheet's specific CASH SALES entry is a copied FBS expected result, not an independent cash event. Remove the copied-summary input.
3. **One canonical physical event:** receipt allocations, mirrored customer/invoice payments and source summaries never create multiple drawer receipts. Cash tender minus returned change is retained cash; cash deposit/overpayment counts fully once regardless of invoice allocation.
4. **Purpose != funding source:** Expense owns business purpose, drawer owns custody. Cash payment method alone does not select Main Counter. Office-bank/petty-cash/personal-paid expense has no drawer effect.
5. Supplier payment settles liability; inventory freight becomes landed cost; advance release is outstanding employee custody; owner draw reduces equity; transfers are not OPEX.
6. Credit note/void is not proof of physical refund. Actual cash payout must be separately represented and linked.
7. Immutable posted monetary records and submitted snapshots. No deletion/edit to erase history; approvals/counts are not cash movements; no variance auto-plug.
8. One active OPEN/CLOSING session per drawer. CLOSED never reopens in release 1. Manager-authorized supplemental same-date session may follow a close, linked to retained custody.
9. Local drafts may survive offline; financial posting/approval/close requires server confirmation.
10. Register-first cashier workspace, guided close and responsive web; no charts/full treasury expansion.

## 5. Architecture and Domain Model

### Lifecycle and monetary basis
Session: OPEN -> CLOSING -> CLOSED. Authorized cancellation returns CLOSING to OPEN with reason; previous counts survive, final approvals invalidated. Normal cash writes pause during a protected mid-day count window and throughout closing. Other noncash activity may proceed.

- Expected at sequence N = approved opening float + IN movements through N - OUT movements through N.
- Counted = denomination value snapshots × nonnegative integer quantities, summed server-side.
- Variance = counted - expected at identical cutoff.
- Closing actual retained = closing counted - actual final handovers.
- Closing ledger retained = closing expected - final handovers.
- Preserve original variance and both retained figures. Next opening verifies ACTUAL retained custody, linked to prior close, with explicit discrepancy reconciliation metadata; do not invent a receipt to hide the old difference.

All money uses numeric(14,2), decimal strings in API, decimal/integer-centavo server arithmetic. Opening may be zero; posted amounts positive; variance signed. No floating-point ledger or zero-clamp hiding negative expectation. Ordinary disbursement insufficient expected cash is blocked; genuine inconsistency requires reviewed correction rather than fabricated funding.

### Transaction/lock contract
Incrementing session posting sequence + version define balance order and snapshots. Earlier user-entered occurred_at never reorders committed balances. Deterministic lock order: session -> source/document -> transfer/advance, with scoped `FOR UPDATE OF alias`. Integrate source writes so existing lock ordering does not invert this protocol.

Source transaction and drawer posting commit/rollback together on same pg client. No asynchronous untracked drawer posting at initial release. Count window is persisted state with expiry, NOT a transaction held while a human counts. Every source writer enforces paused/closed server-side state.

Closing final count/approval binds count ID, cutoff/version and amounts. Authorize only explicit final handovers after count; stage them for the atomic close or use a validated close-context revision tracking their sequences. Recompute expected effects without invalidating a valid pre-handover snapshot. All ordinary post-count movements require resume/recount. Handovers and immutable close commit atomically; routine writes cannot race around this check.

### Custody and correction boundaries
Transfer: drawer decreases at actual release. Acknowledgment/deposit confirmation is subsequent custody evidence, not additional drawer money. Partial acknowledgment and deposit stages each bounded independently; do not add the two as receipts. Returned physical money creates an IN in an OPEN receiving session and cannot also be confirmed deposited for the same portion. Final closing handover requires named recipient acknowledgment, though bank deposit may still be pending.

Advance: release once -> link verified expense/AP/GRN consumption -> return unused physical cash -> settle. Consumption does not change drawer again. Extra paid reimbursement is a separate actual OUT. Outstanding custody equals releases/reimbursements less documented consumption/returns; employee-funded excess needs review, not a hidden negative outstanding balance.

Corrections: same/open-session posting errors corrected with authorized linked reversal/replacement. Historical closed-day data-only correction is an immutable explanatory addendum with explicit reviewed custody bridge where necessary, not fictitious current cash-in/out. Original report unchanged. Refund/return of actual cash is a new real event, distinguishable from clerical correction.

## 6. Phase 1 — Schema, Catalog Audit and Invariants — Not Started

### Next steps
- [ ] Query running catalog and all pending migrations. Verify original report, source payment/refund/Expense/AP/wallet/deposit writer ownership. Document canonical source event and mirror policy before hooks.
- [ ] Add forward idempotent SQL migrations using repository filename/sequence convention; update `database/initial_schema.sql` in lockstep. No ORM.
- [ ] Seed new permissions and explicit role assignments; do not grant every existing role automatically.
- [ ] Add immutable-row protections, FK/index/unique checks and transactional tests against real PostgreSQL.

### Proposed schema contract
New names below are proposals; existing source IDs/types must be confirmed against current schema. New record IDs bigserial; employee references -> employee(employee_id), method -> payment_methods(method_id), source deletions RESTRICT, soft-disable entities.

| Table | Required fields / constraints |
|---|---|
| cash_drawer | drawer_id PK, unique code, name, active, created_by/at, modified_by/at |
| cash_drawer_session | session_id PK, unique session_code, drawer FK, business_date, custodian employee FK, OPEN/CLOSING/CLOSED, opening_amount/count/source metadata, prior_session FK, version, last_sequence, protected count window/expiry, opened/closing/closed actor/timestamps, final_count/reviewer; partial unique drawer WHERE OPEN or CLOSING |
| cash_drawer_movement | movement_id PK, session FK, unique session+sequence, IN/OUT, positive amount, category, description, actor, counterparty, occurred_at/recorded_at, late_reason, canonical source_event_key unique, request_id unique, reversal_of nullable unique self-FK, typed customer_payment/invoice_payment/expense/AP/refund/transfer/advance links, method FK; typed-source consistency checks |
| cash_count | count_id PK, session FK, OPENING/MIDDAY/CLOSING, DRAFT/SUBMITTED/INVALIDATED, cutoff sequence/version, server expected/counted/variance, counter, notes, started/submitted/invalidated timestamps; submitted snapshots immutable |
| cash_count_line | count FK, denomination_code, value_snapshot numeric(8,2), nonnegative integer quantity; unique count+code |
| cash_approval | target/action, amount/count/version binding, reason, requester/reviewer FKs, requested/decided times, decision; independent reviewer for variance and sensitive release |
| cash_transfer / cash_transfer_event | originating session, amount/destination/recipient, unique release movement; append-only acknowledgment/deposit/return/note amount/evidence/actor/occurred/recorded events, unique request IDs; per-stage aggregate checks under lock |
| cash_advance / cash_advance_event | employee/purpose/due date, unique release movement; consumption/return/reimbursement/settlement events with amount and typed expense/AP/GRN/movement links, actor/times, source-consumption uniqueness |
| cash_source_link | canonical event key, movement FK, typed source ID, amount_covered, purpose NORMAL/NOTEBOOK_RECONCILIATION, linked_by/at; no duplicate source coverage beyond original receipt |
| cash_session_close | one immutable row/session with count/cutoff, opening/IN/OUT/expected/count/variance, handovers, retained ledger/actual, notes, custodian/reviewer, report snapshot, closed_at |
| cash_audit_event | immutable target/action/actor/request/time/reason/bounded before-after metadata; protected IP, no secrets/card details |
| refund_disbursement (if absent) | credit_note FK, actual amount/method/funding session, paid_at/actor, unique canonical event; credit note alone not proof of payout |

Add indexes for session+sequence, drawer+business_date, timestamps, source FKs and pending custody lookup. API schema rejects overprecision/overflow. Business date separate from timestamps. Timestamptz stores event time; display Asia/Manila. occurred_at may reflect earlier physical activity with late reason; recorded_at server-generated immutable. Reject inappropriate future/before-opening/backdated-closed placement with explicit reviewed exceptions where legitimate. Do not log input keystrokes.

### Verified integration refinements
- AP migration defines `ap_payment(payment_id)`; proposed typed FK `ap_payment_id -> ap_payment(payment_id)`. `ap_payment_allocation` is allocation, not another payout.
- Inspected expense insert stores payment method but not explicit funding drawer. Add custody/disbursement linkage and separate expense recognition from actual payment time; Cash method alone cannot post drawer OUT. Existing db.query writes need one pg-client transaction when integrated.
- Inspected refund route creates credit_note with refund_payment_method, ledger/inventory effects and commit. It does not establish a distinct physical payout in that inspected segment. Inventory all paths first; reuse actual disbursement record if present, otherwise add it. Partial payouts bounded by finance-authorized refundable amount.
- Native source FK/mirror policy must cover overpayments, advance customer deposits, wallet consumption and mixed tenders without trusting allocation sums or deprecated invoice_payment_allocation balances.

## 7. Phase 2 — Posting Service, Integrations and API — Not Started

### Next steps
- [ ] Implement proposed `packages/api/services/cashDrawerService.js` and `packages/api/routes/cashDrawerRoutes.js`, registered via existing registerRoute/protect/hasPermission conventions.
- [ ] Inventory ALL actual payment, refund, AP, Expense, advance/deposit, void/edit and retry entry paths, including invoiceRoutes/paymentMethodRoutes/stagedSaleRoutes/paymentRoutes and DB triggers. Implement single canonical posting service; derived allocation/mirror never posts twice.
- [ ] Require explicit drawer/session funding for new physical events after cutover; nullable migrated history is not retro-posted.
- [ ] Integrate real source writes and drawer ledger in same transaction; no success if cash is accepted but ledger rejects.
- [ ] Implement counts/pause, close-context handovers, approvals, advances, transfer stages, reversals/addenda and notebook coverage.

### Proposed API contract
Base `/api/cash-drawers`. Authenticated actor server-derived. UUID Idempotency-Key required for financial/lifecycle writes: same key/body replay original response, different body ->409. Existing object/store scope enforced; do not invent tenancy parallel to current model. Money decimal strings, ISO8601 offset times, allowlisted enums and bounded text, SQL parameterized. Mutations carry expected_version where touching session.

| Method / relative path | Request -> response | New permission |
|---|---|---|
| GET / | active drawers/current sessions | cash_drawer:view |
| GET /sessions | drawer/date/state/page/limit filters -> paginated snapshots | cash_drawer:view |
| POST /:drawerId/sessions | date,custodian,opening lines/sources,prior session,reason/authorization ->201 session/summary | cash_drawer:open |
| GET /sessions/:id | state/version/expected/count staleness/custody totals | cash_drawer:view |
| GET /sessions/:id/movements | search/filter/page/limit -> sequence,balance_after,source,actors/times | cash_drawer:view |
| POST /sessions/:id/movements | IN/OUT,category,amount,purpose/counterparty,occurred,reference,attachment,version,authorization ->201 movement/new version | cash_drawer:move |
| POST /sessions/:id/counts/start | kind,version ->201 draft/cutoff/expected/expiry and pause | cash_drawer:count |
| POST /counts/:id/submit | lines,notes,cutoff version ->201 immutable computed snapshot | cash_drawer:count |
| POST /counts/:id/cancel | reason ->200 invalidated draft/safe resume | cash_drawer:count |
| POST /sessions/:id/start-closing | version ->200 CLOSING | cash_drawer:close |
| POST /sessions/:id/cancel-closing | reason/version ->200 OPEN; approvals invalidated | cash_drawer:close |
| POST /approvals | action,target/count/version/amount/reason ->201 pending | initiating action permission |
| POST /approvals/:id/decision | APPROVED/REJECTED,reason ->200 scoped decision | cash_drawer:review |
| POST /sessions/:id/close | final count/version,variance approval if required,handovers/acknowledgments,retained amount,card checklist ->201 immutable close | cash_drawer:close |
| POST /sessions/:id/transfers | amount,destination,recipient,occurred,authorization ->201 transfer + OUT | cash_drawer:transfer |
| POST /transfers/:id/events | stage/amount/evidence/occurred; return requires OPEN receiving session ->201 event; actual return IN atomic | cash_drawer:transfer |
| POST /sessions/:id/advances | employee,purpose,amount,due,authorization ->201 advance + OUT | cash_drawer:move |
| POST /advances/:id/events | consumption/return/reimbursement/settlement,typed links/amount; physical return/reimbursement needs OPEN session ->201 event/effect | cash_drawer:settle_advance |
| POST /movements/:id/reverse | open session/version,reason,approval ->201 linked correction; historical case may require noncash addendum instead | cash_drawer:correct |
| POST /notebook-receipts/:id/reconcile | canonical payment/covered amount/reason/approval ->200 coverage link, only genuinely additional cash posts | cash_drawer:correct |
| GET /sessions/:id/report | format pdf/csv -> permission-scoped report | cash_drawer:export |

Additional key cash_drawer:configure. Seed all new permission/role assignments; existing A/R, Expense, AP permissions still required for owning workflows. Drawer permission alone cannot bypass source document security.

Errors:400 input;401 auth;403 scope/permission;404 absent;409 paused/closed/version/duplicate/conflicting idempotency/stale count;422 policy/insufficient availability;503 unavailable dependency. Return code/message useful to cashier; failed transaction fully rolls back. Movement response includes ID/session/sequence/direction/amount/balance_after/source/times/new version; count response includes cutoff/expected/counted/variance/submitted time/validity. No client-computed final amounts trusted.

### Notebook receipt coverage
Capture an unrepresented physical notebook receipt once with page/reference. Later source sale/payment workflow MUST select prior receipt before canonical posting; source link consumes partial/full coverage under lock and posts only actually additional cash. Multiple mappings cannot exceed original receipt. Sale/inventory/tax recording belongs to owning sale process, not generic drawer ledger. If duplicate posting already committed, manager correction is transparent; closed-day documentary correction never fabricates physical cash today. Preserve original variance/report and explicit custody bridge.

## 8. Phase 3 — Production UI — Design Complete; Implementation Not Started

Follow [final UI handoff](./2026-10-07_cash-drawer-ui-design.md). Recommended cashier workspace, not dense alternate.

- [ ] Add proposed `packages/web/src/pages/CashDrawerPage.jsx` and components under `packages/web/src/components/cashDrawer/`.
- [ ] Register `cash_drawer` in MainLayout switch and config/navigation.js under Finance & Expenses. Reuse App currentPage/pageState, API client/AuthContext, existing tokens/Modal/Drawer/Tabs; no router/state-library additions.
- [ ] Build header/status/expected+count+variance+outflow cards, register and side rail; tabs Today/Counts/Handover & Advances/History.
- [ ] Build opening source/count, category-led IN/OUT, count pause/recount, server manager approval, closing wizard, custody/advance events, source detail/history/export.
- [ ] Show count cutoff/age, not live actual after later activity. Opening separate from cash-in total. Over/Short signed/text. Draft/failed/stale/forbidden/closed/offline states truthful.
- [ ] Responsive web with mobile full-screen forms/count, 44px targets, focus management, keyboard support, AA contrast, dark mode. Browser-derived preview never final posted truth.

The prototype's manager-review checkbox is explicitly simulated; never implement production approval as an untrusted checkbox.

## 9. Phase 4 — Real Verification, Reports and Cutover — Not Started

### Test matrix and release gates
- [ ] Source completeness: all physical cash write routes and mirrors; mixed tenders/change/deposits/overpayments/wallet use/withholding/discounts/PDC; actual refund versus credit note; exactly once under retries/concurrency.
- [ ] Real DB: migrations/checks/FKs, immutable guards, rollback, double-open, lock order, close/write races, count expiry/pause/resume, stale approval, final handover bounds.
- [ ] Custody: partial acknowledgments/deposits/returns, named external custodian, outstanding advances, consumption funded from advance, extra reimbursement/employee excess.
- [ ] Monetary/count cases: zero float/count, centavos, blank/negative/fractional/overflow, denomination change history, nonzero retained bridge/supplemental session, late historical event/addendum, no hidden zero clamp.
- [ ] Notebook: partial/full/multiple source coverage, late sale encoding after close, duplicate remediation without invented cash.
- [ ] Security: scope/permissions, independent reviewer, spoofed actor, idempotency conflicts, SQL/text/CSV injection, stale/offline unknown write and attachment authorization.
- [ ] UI real app: desktop/tablet/mobile, keyboard/touch, light/dark, network/auth failures, source drill-down and immutable history.
- [ ] Immutable closing PDF/print/CSV includes opening, receipts/releases/category, pre-handover expected/count/variance, handovers and ledger/actual retained, custodian/reviewer and timestamps. Later custody progress separate.
- [ ] If terminal card payments occurred: physical batch settlement and centavo reconciliation before daily close, separate from drawer denomination totals; authorized evidenced exception only.
- [ ] Benchmark local deployment targets: summary/register <=300ms at ninety-fifth percentile; atomic posting added overhead <=50ms; total write <=500ms excluding human approval/upload; refresh <=5s + on focus. These are targets NOT measurements. Bounded lock waits and no long human-held transaction.
- [ ] Restore backup including immutable history; owner/manager signs off full store-day pilot with notebook/office-expense/advance/transfer/discrepancy cases.

### Cutover
Archive Google Sheets. Verify and approve physical opening with canonical source reconciliation. Feature-flag rollout: test -> one Main Counter pilot -> daily signoff -> stop live Sheets entry. Never import past summaries as new live money; no old sale/expense reposting. Do not enable while a physical cash source path remains unhooked. Rollback disables new feature usage safely and preserves all ledger/audit data; it does not drop financial tables or erase posted effects.

## 10. Explicitly Deferred

| Item | Revisit trigger |
|---|---|
| Complete treasury/general ledger/bank reconciliation | Separate scope and fund-account policy approved |
| Automatic variance write-off | Accountant-approved event treatment and authorization |
| Offline financial posting | Approved durable idempotency/conflict/custody model |
| Automatic notebook inventory/tax accounting | Full compliant sale-entry policy; custody exception alone not sufficient |
| Historical Sheets import into live ledger | Separate reconciled migration plan proving no duplicate source |
| Native mobile drawer app / analytics charts | Web pilot and specific operational need established |
| Full semantic doc indexing | Verified remote semantic runner available; best effort, no forced shrink-guard bypass |

Not-started phases §6–9 are next implementation work, not deliberately deferred features.

## 11. Files Touched So Far

This handoff publishes docs only:
- `docs/plans/2026-10-07_cash-drawer-reconciliation.md`.
- `docs/plans/2026-10-07_cash-drawer-ui-design.md`.

No application/migration files modified by this work. Proposed schema/API/UI paths above are NOT shipped files. Local design/prototype/test assets in `/opt/data/output/cash-drawer/` exist only on agent host and were not uploaded to repo; essential contracts are transcribed here and companion UI doc.

MCP plan_write creates repo files atomically and refuses overwrite; it does not establish Git commit, push, migration or deployment. Fresh remote state/diff and readback are required after publication.

## 12. Verification Commands, Results and Access Limits

### Actually inspected
MCP project_status/project_log(limit20)/project_diff/plan_list, plan_read and bounded project_read/search, graph_query. Empty working-tree diff before doc publication. Selected source/schema files inspected; live DB not queried. Graph result surfaced generic Drawer UI, so source search/read was used instead of assuming module implementation. Date obtained via `TZ=Asia/Manila date` on agent host.

Local prototype execution trace reports:
```
/opt/data/output/cash-drawer/.venv/bin/python /opt/data/output/cash-drawer/verify.py
```
Exit0; PASS workspace/compact desktop1440px/mobile390px, denomination/count/dialog/tab/keyboard/simulated close/dark-mode/overflow/JS-error checks. JSON and screenshots generated. These are mockup tests only. Visual-AI image review failed due provider text-only input restriction. Local spec sanity script earlier blocked by approval timeout; not counted as executed verification.

### Commands for next verified dev-server session — NOT run here
```
git status --short --branch
git log --oneline -20
git diff <verified-base-branch>...HEAD --stat
git diff --check
npm run -w packages/api migrate:status -- --host localhost
npm run -w packages/api migrate:verify -- --host localhost
npm run -w packages/api lint
npm run -w packages/web lint
npm run -w packages/web build
graphify update .
```
Replace verified base and DB host with target-environment configuration; do not use localhost blindly inside Docker. Migration commands above verify only; applying migrations requires explicit target authorization/runbook. Real Jest PostgreSQL tests proposed under `packages/api/tests/cashDrawer*.test.js`; after files exist use project's Jest config and exact paths. No invented API success responses/test pass counts. No cash runtime API smoke check can succeed before endpoints exist.

Remote graph update and commit/push NOT run: MCP exposes read-only graph tools + plan file creation, no remote shell. Record actual results once access exists; documentation publication is not blocked by optional graph indexing.

## 13. Change Log

| Date | Author / Session | Change |
|---|---|---|
| 2026-10-07 | Forson + Kent Pilar | Finalized module/UI decisions, recorded existing Sales History estimate limitation, merged AP/refund/correction refinements, itemized unbuilt phases and published resumable docs with adapted plan-to-docs skill. No application changes or live verification claimed. |
