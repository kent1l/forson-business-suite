# Cash Box reliability and history — implementation handoff

> Forson Business Suite | 2026-10-08 (Asia/Manila) | Current HEAD baseline: `f15e198` | Production rollout: **not performed**

## 0. Status at a Glance

| Phase | Status | Evidence / remaining gate |
|---|---|---|
| First use and history access | Implemented; fixture browser verified | Desktop/mobile first-use, closed history, OPEN/CLOSING, restricted view and manager opening |
| Historical drill-down | Implemented; fixture and disposable DB verified | Server paging/filtering, detail sections, exports retained; authenticated live role walkthrough remains |
| Closing credentials and retry | Implemented; fixture and disposable DB verified | One-use bound acknowledgment; legacy drafts scrubbed; close replay after token consumption tested |
| Notebook/custody/advance safety | Implemented; disposable DB verified | Reversed/covered receipt and custody reversal guards, settled sources, provenance, race test |
| Source unknown-outcome retry | Implemented; fixture browser verified | Persisted actor-bound request identity, status reconciliation and failure handling |
| Deployment and physical pilot | Not started | Owner-controlled migration and role/physical store-day checks; feature flag remains unchanged |

## 1. For the Next Session

1. Run `graphify query "cash drawer history acknowledgment notebook coverage reversal"` and recall Hindsight tags `forson-business-suite`, `cash-drawer`.
2. Compare this document with current Git, migration ledger and running code. This records the worktree at 2026-10-08, not a production deployment.
3. Use a newly verified disposable `codex_cash_drawer_verify_*` database for fixture-writing tests. Never point the standalone scripts at the store database.
4. Keep `ENABLE_CASH_DRAWER` disabled in production until the owner authorizes rollout and the physical pilot passes.

## 2. Business Objective and Acceptance

Physical drawer cash must be accountable by source and custodian. An authorized person can see an empty or historical History tab without opening another financial session. Counts, approvals and custody acknowledgments remain separate from cash movements. Closing snapshots remain immutable when later deposit or custody evidence arrives. Network uncertainty never creates a replacement source receipt, and recipient passwords never enter browser retry data.

## 3. Findings Revalidated Against HEAD

- **Confirmed:** the History tab was inside `{session && ...}`; the opening form appeared without an explicit opening choice for a first-use drawer; session history was tied to the same request chain as approvals/custody; the initial list stopped at 50.
- **Confirmed:** close requests put `recipient_password` in the handover body subsequently saved to `sessionStorage`. The source API used only an in-memory idempotency-key Map.
- **Confirmed:** coverage omitted reversed-receipt validation; reversal omitted coverage and reverse custody-event relationships; direct advance consumption omitted void/settlement checks; reimbursement had no payer provenance evidence.
- **Confirmed:** the audit table existed but significant request, count, transfer and advance actions were not consistently written to it.
- **Already present:** server-side centavo arithmetic, immutable movement/count/close guards, basic partial/full notebook coverage limits, source immutability guards, closed report PDF/CSV, count cutoff protection and the secure `createUuid` fallback. These were retained.
- **Not reproduced:** no evidence that the UUID fallback uses `Math.random`; it already fails closed when secure randomness is unavailable.

## 4. Architecture and As Built

### Phase A — First use and history

The existing Cash Box tablist now renders for authorized viewers with no current session. `No session open` gives an explanation and optional opening action. The denomination form appears only after the user chooses it; existing business-date, active-custodian, physical-count and source-total checks remain. History loads separately from session detail and custody/approvals. Drawer changes discard old detail and ignore out-of-order responses. History distinguishes loading, empty, error and stale results.

`GET /api/cash-drawers/sessions` now returns `{data,page,limit,total}`, with `drawer_id`, `from`, `to`, `business_date`, `custodian_id`, `status`, `page`, and `limit` filters. Maximum page size is 100. Invalid date/status/custodian filters return 400. The UI uses 25-row pages.

### Phase B — Historical detail

The existing History tab opens read-only session detail, independently paged movements, counts with denomination snapshots and review, and nonmonetary activity from actual audit rows. Source invoice navigation and PDF/CSV exports remain. Later custody events and addenda appear separately from the immutable closing numbers. No historical event is inferred where no event row exists. `GET /api/cash-drawers/sessions/:id/activity?page=&limit=` requires `cash_drawer:view`, returns `{data,page,limit,total}` and caps page size at 100. Count reads are capped similarly. Audit writes were added transactionally for approval requests, count lifecycle, closing start, notebook coverage, transfer and advance lifecycle. Existing movement rows remain the source of monetary activity.

### Phase C — Credential and retry safety

`POST /api/cash-drawers/sessions/:id/handover-ack` requires `cash_drawer:close`, recipient ID/password, count ID, expected session version, amount and destination. It verifies the recipient password and returns a 256-bit opaque token valid for five minutes. Only its SHA-256 hash is stored. The close handler consumes a token in the close transaction, bound to session, recipient, closing actor, count, version, amount and destination. An exact repeated close is answered from the existing `cash_request` row before token validation, even after consumption.

`GET /api/cash-drawers/requests/:id` returns only the authenticated actor's committed request status and response; it takes the same advisory lock as a write so reconciliation serializes with an in-flight request. It returns 404 when no row exists for that actor. The browser stores only a close key/path when the outcome is unknown. Legacy password-bearing drafts are scrubbed on API-client load, retaining only reconciliation identity. Recipient password is cleared from form state after authentication. The source API now stores actor/path/body/key in `sessionStorage` for cash source requests, reconciles the original key on reload, blocks different payloads and storage failure, and does not send a replacement write after a committed result. Logout clears the selected drawer session.

### Phase D — Source and custody integrity

Notebook coverage and reversal acquire the session then receipt movement lock and recheck reversed/covered state. Generic reversal rejects reverse links from transfer/advance event tables and release tables. Covered or custody-linked corrections require a coordinated workflow; standalone reversal returns a clear 422 and cannot silently change drawer balance. Fully covered source payment idempotency now starts even without a cash session ID. Direct advance consumption checks canonical positive amount, cash method, void expense or uncleared AP status, prior source event, available advance and settlement state. Reimbursement requires an amount-bound independent review plus an explicit payer employee matching the advance holder and recorded payer evidence; an unlinked drawer is not accepted as proof of employee funding.

## 5. Schema, Files and API Contract

Forward migrations only:

- `20261008_01_cash_acknowledgment.sql`: one-use hashed acknowledgment table.
- `20261008_02_cash_reimbursement_provenance.sql`: payer/evidence columns on advance events.
- `20261008_03_cash_history_index.sql`: history and audit read indexes.

Files touched: `packages/api/routes/cashDrawerRoutes.js`, `packages/api/services/cashDrawerService.js`, `packages/api/tests/cashDrawer_db_test.js`, `packages/api/tests/cashDrawerRoutes_db_test.js`, `packages/web/src/pages/CashDrawerPage.jsx`, `packages/web/src/api.js`, `packages/web/src/contexts/AuthContext.jsx`, `packages/web/tests/createUuid.test.js`, `packages/web/tests/cashDrawerBrowser.mjs`, `packages/web/tests/fixtures/cashDrawerBrowser.html`, and the three migrations above.

Compatibility: close requests with `recipient_password` now return 400; clients must obtain an acknowledgment token first. The new reimbursement evidence fields are required only for `REIMBURSEMENT`. The historical session endpoint retains its old `business_date` filter and adds a total count.

## 6. Verification Actually Executed

All database commands below targeted the **new disposable** `codex_cash_drawer_verify_20261008` database. It was created empty, the baseline and 221 migrations were applied, then the two later migrations were applied. `migrate.js verify` reported **Checksums verified**. No store or production migration was run.

| Command | Actual result |
|---|---|
| `DB_HOST=localhost CASH_DRAWER_TEST_DB=codex_cash_drawer_verify_20261008 node packages/api/tests/cashDrawer_db_test.js` | PASS; reversed coverage, void expense, unsettled AP, source/cash invariants |
| `DB_HOST=localhost CASH_DRAWER_TEST_DB=codex_cash_drawer_verify_20261008 node packages/api/tests/cashDrawerRoutes_db_test.js` | PASS; close replay/status, custody reversal, two-connection coverage/reversal order, no-session fully covered payment retry, >50 history, later deposit snapshot immutability |
| `DB_HOST=localhost DB_NAME=codex_cash_drawer_verify_20261008 npm run -w packages/api test -- --runInBand --runTestsByPath tests/authMiddlewarePermissions.test.js tests/expenseModule.test.js tests/refunds.test.js tests/paymentMethods.test.js` | 4 suites, 37 tests passed |
| `npm run -w packages/web test` | 8 test files passed; UUID native/fallback/unavailable cases included |
| `LD_LIBRARY_PATH=/tmp/cash-browser-libs/usr/lib/x86_64-linux-gnu node packages/web/tests/cashDrawerBrowser.mjs` | 11 mocked Chromium fixture scenarios passed; desktop/mobile first use, roles, closed/open/closing, partial failure, pagination/drawer switch, close/source lost response reload, secret-free and storage conflict/failure checks |
| `npm run -w packages/web build` | PASS; existing chunk-size warning |
| `npm run -w packages/web lint -- --quiet` and `npm run -w packages/api lint -- --quiet` | PASS |
| `git diff --check`, `node --check` for changed API service/routes | PASS |
| `graphify update .` | PASS after rerun with repository filesystem access; 6,513 nodes / 11,541 edges. Graphify reported 30 extraction warnings about an existing document node; the code graph was rebuilt. |

The browser suite uses intercepted API fixtures, not an authenticated live store. The database scripts use real PostgreSQL, not mocks. The disposable database remains available for review and may be removed after review. No production readiness claim follows from either.

## 7. Explicitly Deferred, Blocked, and Rollout

**Deferred by design:** a coordinated correction workflow for already covered notebook cash or linked transfer/advance movements. The current release rejects standalone reversal and preserves links. A future workflow needs a manager-authorized paired financial/custody correction with append-only evidence. Full employee excess/split-funding design also remains outside this change.

**Not completed:** authenticated live cashier/manager walkthrough and physical store-day pilot. No store credentials or owner approval were provided, and fixture browser roles cannot establish live authorization behavior. Review of every operational source route in a full store day and production-scale query timing also remain release gates. The migration was applied only to the disposable database; intended development/staging/production targets need owner-controlled backup, migration checksum verification, deployment and rollback rehearsal. Keep production feature flag off until those gates pass.

## 8. Change Log

- 2026-10-08: Revalidated HEAD; implemented history, one-use close acknowledgment and reconciliation, source retry persistence, notebook/custody/advance guards, provenance, audit coverage, migrations and regression tests. Verified against disposable PostgreSQL and mocked Chromium fixtures; documented pending rollout gates.
