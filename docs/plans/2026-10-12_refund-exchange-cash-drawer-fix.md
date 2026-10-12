# Refund and exchange drawer posting — investigation handoff

> Forson Business Suite | 2026-10-12 (Asia/Manila) | HEAD baseline: `97f7c75` | Worktree implementation; deployment not performed

## 0. Status at a Glance

| Phase | Status | Evidence / remaining gate |
|---|---|---|
| Investigate posting path | Complete | Missing frontend session selection confirmed; existing backend OUT arithmetic verified |
| Connect correction forms | Complete | Explicit open-drawer selector in refunds and exchanges; six Chromium fixture scenarios pass |
| Prevent disabled tracking bypass | Complete | Explicit session requests return 503 and roll back if tracking is disabled |
| Verify cash accounting | Complete | Disposable PostgreSQL HTTP tests cover payouts, replay, rollback and noncash isolation |
| Sales History cash without Cash Box | Complete | Independent cash-payout total includes exchange differences; disabled-rollout PostgreSQL checks pass |
| Historical incident identification | Specific event unconfirmed | Production does not use Cash Box; Sales History label mismatch found and fixed |
| Deployment | Not performed | Changes remain in this worktree |

## 1. For the Next Session

1. Run `graphify query "refund exchange cash drawer session payout"` and recall Hindsight tags `forson-business-suite`, `cash-drawer`.
2. Confirm this document against Git and the deployed application before relying on it.
3. Run the standalone test only on a disposable schema-only `codex_cash_drawer_verify_*` database.
4. To identify the reported incident, obtain its invoice/credit note and drawer session, check deployment/feature-flag history and compare credit notes with actual movements/disbursements. Update this document and graphify after further changes.

## 2. Business Objective and Findings

Paying a cash refund or the remainder of a cheaper-item exchange from an open drawer must lower that drawer's expected cash once, in the same transaction as the credit note.

The backend already posts `CASH_REFUND` OUT movements and disbursements when `ENABLE_CASH_DRAWER=true`. Refunds use the refunded total; exchanges use only the positive leftover credit after the replacement item. Expected cash comes from the latest movement balance, with opening cash as the fallback.

Both correction forms omitted `cash_session_id`. The API interceptor reads `forson_cash_drawer_session`, but the current Cash Box page does not write that storage value. With tracking enabled, missing-session payouts return 422 and roll back; they do not silently commit. With tracking disabled, legacy credit-note processing skips drawer postings. Before this fix, even an explicitly supplied session was silently ignored in that disabled state.

A read-only aggregate of the local development database found 247 `Cash` credit notes without disbursements, dated September 6, 2025 through October 5, 2026 in Manila. These predate the October 7 cash-drawer module. The local backend currently has tracking enabled. This is evidence of legacy data, not proof of the exact reported incident or of any production configuration.

## 3. Sales History Follow-up — Cash Box Disabled in Production

The user clarified that the Cash Box module is unfinished and unused in production. The initial fix addressed the Cash Box integration path, but the reported Sales History figure comes from a separate read path. That distinction is now confirmed.

`/payments/refunds-approx` filtered only the exact label `Cash`. Ordinary Cash refunds were already subtracted; exchange downgrades use `Cash Payout` and were excluded. Simply including that label and summing the whole credit note would also be wrong: a returned item worth 100 exchanged for an item worth 60 pays out only 40.

The endpoint now includes normalized Cash/Cash Payout labels. For exchanges it subtracts the associated `exchange_credit` tender from the credit-note total, falling back to the replacement invoice total for legacy missing tenders. The tender is scoped by replacement invoice and credit-note reference. Account exchanges are excluded using payment terms and on-account methods; wallet/noncash/even exchanges are excluded by payout label. This query uses existing credit notes, invoices and payments only; no Cash Box tables, feature flag or disbursement is needed. A real-database test runs cash refund and cash exchange routes with `ENABLE_CASH_DRAWER=false` and checks that the Sales History total increases by 140 for refund 100 plus exchange remainder 40.

The exchange service now labels account downgrades `Applied to Account` even if an API caller supplies `cash_payout`. Sales History permits negative net cash flow when the selected period pays refunds for earlier collections. Its tooltip distinguishes period sales cash from a physical-box balance including opening float and other movements. Failed payout-total requests show Unavailable instead of silently reporting zero refunds.

## 4. Decisions and Architecture

Select the physical drawer in the correction form rather than relying on visiting Cash Box or selecting a global browser default. A sole OPEN session is selected automatically; multiple sessions require a choice. CLOSING sessions are excluded. Drawer load errors and missing selections block cash submission. The backend remains authoritative for permissions, session state, count pauses and sufficient cash.

Explicit session payloads activate the existing persisted source-request idempotency mechanism. No new accounting formula, schema migration or historical backfill was needed. Legacy non-drawer behavior remains available when the feature is disabled; explicitly drawer-funded requests fail instead of losing their movement during a configuration change.

## 5. As Built

- Shared `useCashDrawerSession` loads available drawers when physical cash is required; `CashDrawerSessionField` renders the selection and validation message.
- RefundForm submits the chosen session for Cash payouts and prevents duplicate submission while pending.
- ExchangeModal submits the chosen session for cash downgrades and cash upgrade tenders. Wallet and account-only settlements do not require a drawer.
- `reserveSourceSession` rejects an explicit drawer session when tracking is disabled, before any source document is written.
- Real-database route regression script verifies expected balances, disbursements, exact replay, missing-session rollback, noncash isolation, disabled-flag rollback, closing and count-window rollback.
- Browser fixtures start with empty session storage and exercise both forms with one OPEN session, two OPEN sessions and only a CLOSING session. Captured payloads include the selected session and UUID idempotency key.

## 6. Files Touched

- `packages/api/services/cashDrawerService.js`
- `packages/api/tests/refundCashDrawer_db_test.js`
- `packages/web/src/hooks/useCashDrawerSession.js`
- `packages/web/src/components/refunds/CashDrawerSessionField.jsx`
- `packages/web/src/components/refunds/RefundForm.jsx`
- `packages/web/src/components/pos/ExchangeModal.jsx`
- `packages/web/tests/fixtures/refundCashDrawerBrowser.html`
- `packages/web/tests/refundCashDrawerBrowser.mjs`
- `packages/api/routes/paymentRoutes.js`
- `packages/api/services/exchangeService.js`
- `packages/web/src/pages/SalesHistoryPage.jsx`
- `packages/web/tests/fixtures/salesHistoryCashBrowser.html`
- `packages/web/tests/salesHistoryCashBrowser.mjs`
- This document and generated graphify outputs.

## 7. Verification Actually Executed

The disposable database `codex_cash_drawer_verify_20261012_refunds` was created and loaded with a schema-only dump of the local development database; no business data was copied. All test writes targeted that disposable database, which was dropped after verification.

| Command / check | Result |
|---|---|
| `docker exec -e CASH_DRAWER_TEST_DB=codex_cash_drawer_verify_20261012_refunds forson_backend_dev node tests/refundCashDrawer_db_test.js` | PASS: opening 1000, refund 100 → 900, exchange payout 40 → 860; replay unchanged; noncash unchanged; failed operations atomic |
| `docker exec forson_backend_dev npm test -- --runInBand tests/refunds.test.js` | PASS: five existing route tests |
| `CASH_BROWSER_BASE_URL=http://172.18.0.7:5173 node tests/refundCashDrawerBrowser.mjs` inside backend container after copying the web script there | PASS: six intercepted Chromium scenarios; resolve the current frontend IP rather than assuming this address |
| `npm run -w packages/web build` | PASS; existing dynamic-import/chunk-size warnings |
| Targeted ESLint on changed API, hook, field and browser test files | PASS; existing JSX unused-import warnings on the correction forms |
| `git diff --check` | PASS |
| `graphify update .` | PASS with repository access; existing 30 extraction warnings and large-graph HTML skip |

Host Supertest was blocked by sandbox socket permissions; it passed in the development container. Host Chromium lacked libasound; the browser suite passed in the backend container. Tests use real PostgreSQL plus intercepted browser API fixtures, not a production walkthrough.

### Follow-up verification with Cash Box disabled

- Disposable PostgreSQL `codex_cash_drawer_verify_20261012_sales_cash`: extended `refundCashDrawer_db_test.js` passed. Sales History totals include cash refunds plus only cash exchange differences with tracking both on and off; wallet/account exchanges are excluded and date filtering works. The database was removed after verification.
- `salesHistoryCashBrowser.mjs` inside the backend container: three intercepted Chromium cases passed. Cash 1000 (tendered 1100, change 100) minus payouts 140 displays 860; zero receipts minus payouts displays -140; failed refund fetch displays Unavailable. No Cash Box endpoint is called.
- `docker exec forson_backend_dev npm test -- --runInBand tests/refunds.test.js tests/payment.settlement.test.js`: seven tests passed.
- Updated web production build, targeted API/web ESLint and `git diff --check`: passed.

## 8. Explicitly Deferred

Automatic historical balance repair is excluded: a credit note does not establish which drawer physically paid it, when the cash left, whether a manual movement already covered it, or whether the remainder was wallet credit. Any verified historical correction must preserve closed-session snapshots and append-only accounting. Production deployment and reconciliation of the specific incident remain separate from this verified worktree fix.

## 9. Change Log

- 2026-10-12: Investigated correction-to-drawer wiring, added explicit selection and disabled-tracking guard, verified PostgreSQL and Chromium scenarios, documented historical uncertainty and deployment status.

- 2026-10-12 follow-up: User clarified Cash Box is unused in production. Found Sales History excluded Cash Payout exchange credits; corrected the independent payout query, account labels and net-cash display. Extended disabled-rollout PostgreSQL tests and Sales History Chromium coverage. No production deployment.
