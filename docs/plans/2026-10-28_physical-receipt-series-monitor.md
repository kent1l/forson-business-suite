# Physical Receipt Series Monitor — Implementation Handoff

**Status:** Implementation complete; PostgreSQL integration and browser interaction checks passed.
**Context:** Extends the physical document registry and spoilage settings.
**Delivery:** Original monitor committed as `86548e3`; completion changes are uncommitted in the current working tree. No migration is required. No production deployment or release was performed.

## 1. Status at a Glance

| Area | Status | Deliverables & Notes |
|---|---|---|
| Bounded series monitor | Complete, tested | Exact bigint serials, 25 numbers per page, sparse range enumeration; §4. |
| Status, history and follow-up | Complete, tested | Registry and normalized legacy evidence; audited, explicitly resolved follow-ups; §4. |
| Transaction actions and reconciliation | Complete, tested | Permission-gated summaries, existing invoice correction/void UI, verified invoice/payment/group linking; §5. |
| Status filtering and pagination | Complete, tested | Full-range filtering and correct totals; stale-response protection and empty-page handling; §4. |
| Verification | Complete | Real PostgreSQL suites, browser fixtures, API/web lint and production build; §7. |
| Verified unused | Explicitly deferred | No agreed availability rule; §6. |

## 2. For a New Session or Agent Picking This Up

Before starting:
1. Run `graphify query "physical document series monitor registry spoilage legacy receipt"` for current code relationships.
2. Recall Hindsight using tags `forson-business-suite` and `receipt-series-monitor` for retained design decisions.
3. Compare this record with `git status`, `git log`, the actual diff including untracked files, and the running system. Working-tree changes are not a production deployment.

After changes, update this record and the settings manual, retain non-obvious decisions to Hindsight, and run `graphify update .`.

## 3. Business Objective & Decisions

Account for the full physical receipt sequence, including numbers absent from the system. **No system record** does not prove the paper is unused: it may be missing or used outside the system. Issued, spoiled and voided identities remain auditable and blocked. Spoilage correction uses the existing reasoned correction workflow. Financial correction and voiding use existing invoice workflows.

Reconciliation requires explicit verification against the original paper, a 5–100 character reason, and transaction-domain permissions in addition to settings access. It may register a legacy transaction's matching reference or attach genuinely unrecorded paper to a transaction without a reference. It cannot overwrite another assignment or turn Notebook transactions into paper transactions. Those cases must use existing transaction workflows.

Follow-ups are investigation records, not reservations. They remain open across issuance/spoilage until explicitly resolved. Resolution appends an event and never releases the number.

## 4. Architecture & Monitor Behavior — As Built

- [x] `Series Monitor` and `Spoiled Paper` remain separate settings tabs; existing spoilage search, correction and pagination are preserved.
- [x] `GET /settings/physical-document-monitor` requires `settings:edit`. A selected series needs both bounds; missing bounds return `needs_bounds`. Invalid IDs, page values and statuses are rejected.
- [x] `receiptMonitorService` combines sparse registry and normalized invoice/payment/collection-group evidence. Occupied registry states take precedence over unoccupied history. Untracked cancelled invoices show as Voided; other legacy matches show as Issued.
- [x] Case, spacing, separators and leading zeros are normalized for numbered alphabetic prefixes. Ordinary service occupancy checks also recognize these legacy formats and collection groups, so issuance does not reuse a legacy number identified by the monitor.
- [x] Status filtering applies across the selected range before 25-row pagination. Gap pages use intervals between occupied serials and bigint arithmetic; they never expand a huge booklet into all its numbers. Work still scales with actual recorded evidence in the range.
- [x] Source links retain PRIMARY/HISTORICAL roles, including prior registry rows for the same serial. Legacy candidates are labeled separately. Transaction summaries require the relevant view permission.
- [x] History includes events associated with the serial's registry history as well as reference-only investigation events, including actors/reasons/notes. Older transactions may have no events.
- [x] Follow-up creation validates prefix/bounds and rechecks that the number has no occupied evidence under the series lock. Duplicate open flags are rejected. Resolution requires the current follow-up event ID, preserving stale-update protection and append-only history.
- [x] Series/page/filter changes ignore stale requests. Failed loads show a retry action; empty filters show an empty-state row. A filtered page removed by a concurrent change clamps to the last remaining page.
- [x] Mark spoiled and Correct spoilage reuse existing forms. Mark spoiled now validates prefix and any configured bounds, takes the series lock and checks normalized occupancy. Standalone spoilage still supports series without bounds.

## 5. Transaction Actions and Safe Reconciliation — As Built

Endpoints under `/settings/physical-document-monitor`:

- [x] `GET /transaction?source_type=&source_id=` returns an explicit customer/amount/reference/status summary, not unrestricted transaction data. Invoice viewing requires `invoicing:create`; payment/group viewing requires `ar:view`.
- [x] Invoice summaries open `InvoiceDetailsModal`, which supplies the existing permission-gated correction/void workflows and cancelled-invoice restrictions. Payment and collection-group summaries are read-only; no new financial void/correction endpoints were introduced.
- [x] `POST /reconcile` requires settings access, the view permission above, and `invoice:edit_receipt_no` for invoices or `ar:receive_payment` for payments/groups. The UI first inspects the transaction, then requires an ownership confirmation and reason.
- [x] Reconciliation compares the reviewed reference and registry ID against the locked transaction; invoices additionally require the current receipt version. It locks transaction → group members if applicable → series, consistent with invoice receipt actions. Uniqueness violations/deadlocks/serialization conflicts return a retryable conflict.
- [x] Rejects cancelled invoices, Notebook records, a different existing reference, an existing registry assignment, mismatched assigned series, occupied paper, ambiguous overlapping series, duplicate legacy claimants, incompatible invoice tax rates and ineligible type/context.
- [x] Collection receipts reconcile through the collection group. Consistent child tenders share its new receipt metadata; conflicting child assignments are rejected. Individual grouped payments cannot be independently reconciled.
- [x] A successful reconciliation creates an ISSUED registry row and PRIMARY source link, updates only receipt metadata and the series high-water/version, and appends `LEGACY_RECONCILED` with actor/reason/before/after evidence. It does not change amounts, stock, ledger entries or allocations; it does not move the last-issued sequence pointer or cashier preference. Unoccupied historical identities are retained.
- [x] Concurrency tests cover competing transaction links and competing spoilage/link actions. Follow-up resolution after issuance and spoilage-correction history are covered too.

## 6. Explicitly Deferred & Files Touched

`Verified unused` remains deferred until its effect on availability and later issuance is agreed. Production deployment, release/version bump and committing were not requested.

Completion changes:

- `packages/api/helpers/receiptNumberFormatter.js`
- `packages/api/services/physicalDocumentService.js`
- `packages/api/services/receiptMonitorService.js` (new)
- `packages/api/routes/physicalDocumentRoutes.js`
- `packages/api/tests/receiptMonitor.test.js` (new)
- `packages/web/src/components/settings/ReceiptMonitor.jsx`
- `packages/web/tests/fixtures/receiptMonitorBrowser.html` (new)
- `packages/web/tests/receiptMonitorBrowser.mjs` (new)
- `docs/manuals/settings_and_setup_manual.md`
- This handoff document and generated graph outputs.

## 7. Verification Commands

A disposable `pgvector/pgvector:pg15` container, `forson_receipt_monitor_test`, was attached to `forson_business_suite`; repository migrations initialized its isolated `receipt_monitor_test` database. No application database was used for these tests. The container is removed after verification.

```bash
# Initialize the disposable database (backend container contains the migration runtime):
docker exec -e DB_HOST=forson_receipt_monitor_test -e DB_USER=test -e DB_PASSWORD=test -e DB_NAME=receipt_monitor_test forson_backend_dev node scripts/migrate.js up

# Real PostgreSQL integration suites:
docker exec -e DB_HOST=forson_receipt_monitor_test -e DB_USER=test -e DB_PASSWORD=test -e DB_NAME=receipt_monitor_test forson_backend_dev npx jest --config jest.config.js --runInBand --silent tests/receiptMonitor.test.js tests/physicalDocumentCheckout.test.js tests/invoiceReceiptActions.test.js tests/physicalDocumentSystem.test.js

# Browser fixtures intercept API calls; integration suites above exercise real routes/DB:
docker exec -i forson_backend_dev node --input-type=module < packages/web/tests/receiptMonitorBrowser.mjs
docker exec -i forson_backend_dev node --input-type=module < packages/web/tests/receiptActionsBrowser.mjs

npm run -w packages/api lint -- --quiet
npm run -w packages/web lint -- --quiet
npm run -w packages/web build
git diff --check
graphify update .
```

All four PostgreSQL suites passed (43 tests, including 16 monitor-specific scenarios). Both browser suites passed. API/web lint and build pass; existing repository lint warnings and bundle-size warnings remain. The browser monitor fixture covers bounds/series selection, full-range filtering, pagination, no matches, history, spoilage callbacks, follow-up creation/resolution, explicit reconciliation, invoice navigation, permission visibility, retry and stale responses. The existing invoice action browser fixture separately verifies correction/void behavior. These are isolated browser fixtures, not a production end-to-end run. The disposable PostgreSQL container was removed after verification. `git diff --check` passed. Graphify refreshed successfully after retrying outside the sandbox (7,733 nodes, 13,656 edges); it reported existing extraction warnings and skipped HTML visualization because the graph exceeds its size limit. Markdown semantic indexing was not run.

## 8. Change Log

- **2026-10-28:** Documented the original monitor implementation, remaining gaps and initial environment limitations.
- **2026-10-28:** Completed filtering, follow-up lifecycle, transaction summaries/navigation and safe reconciliation; normalized legacy occupancy; verified with isolated PostgreSQL and browser fixtures and updated the settings manual. Original implementation is now committed as `86548e3`; completion work remains uncommitted.
