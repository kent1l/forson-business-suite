# Physical Receipt Series Monitor — Implementation Handoff

**Status:** Partially implemented in the working tree; database and browser behavior not verified.  
**Context:** Extends the physical document registry and spoilage settings.  
**Delivery:** Uncommitted changes on branch `20261023-bug-fixes`, based on HEAD `d5c6ca1` at documentation time; no migration added for this work. The branch also contains other changes relative to `master`.

## 1. Status at a Glance

| Area | Status | Deliverables & Notes |
|---|---|---|
| Bounded series monitor | Implemented, unverified against DB | 25 numbers per page for a selected series with both bounds; see §4. |
| Status, history and follow-up | Implemented, unverified against DB | Registry status, exact legacy reference matches, source IDs, events, follow-up, existing spoilage forms; limitations in §4. |
| Transaction actions and reconciliation | Not started | View a transaction, reach existing correction/void workflow, and safely link a verified legacy transaction; see §5. |
| Status filtering and follow-up lifecycle | Incomplete | Filter applies to current page only; follow-up can be added but not resolved. See §5. |
| Verification | Incomplete | Web lint/build passed; PostgreSQL connection was denied and browser/API monitor tests were not run. See §7. |

## 2. For a New Session or Agent Picking This Up

Before starting:
1. Run `graphify query "physical document series monitor registry spoilage legacy receipt"` for current code relationships. The last attempted graph update failed with `Operation not permitted`, so the graph can be stale.
2. Recall Hindsight using tags `forson-business-suite` and `receipt-series-monitor` for any retained context.
3. Compare this handoff with `git status`, `git log`, the actual diff including untracked files, and the running system. Do not treat uncommitted work as deployed.

After completing a phase, update this record and the settings manual, retain non-obvious decisions to Hindsight, and run `graphify update .`.

## 3. Business Objective & Decisions

Account for the full physical receipt sequence, including numbers absent from the system, rather than showing only spoiled paper. A missing system record does **not** prove a document is unused; it could be used outside the system or missing. Existing issued, spoiled and voided identities must remain auditable and not be released by a general status editor. An explicit, reasoned spoilage correction uses the existing workflow. Receipt transaction correction and voiding should use the existing transaction workflows so physical and financial records remain consistent.

The user asked for status-specific actions: issued — transaction view, history, correction/void workflow; spoiled — reason/history and audited correction; voided — transaction, reason/history; no record — mark spoiled, investigate or link a verified existing transaction, and flag for follow-up. A separate “verified unused” action was suggested as optional; its effect on availability was not agreed and it is not implemented.

## 4. Architecture & Work Implemented So Far

- [x] `Series Monitor` tab added alongside the existing `Spoiled Paper` tab in Physical Documents settings; the latter retains its search, filters and spoilage actions.
- [x] `GET /settings/physical-document-monitor` requires `settings:edit`, requires a selected series and positive page, and displays a maximum of 25 generated numbers per page within `min_serial`/`max_serial`. It returns `needs_bounds` when either is missing. Pagination happens before the frontend status filter.
- [x] For each generated number, the query prefers an occupied registry row over `UNOCCUPIED`, then the latest row; it returns source-link identifiers and invoice/payment IDs where `UPPER(TRIM(physical_receipt_no))` exactly matches the generated uppercase `PREFIX-serial`. The UI labels occupied registry states directly; for no occupied registry state, a matching legacy invoice or payment is shown as Issued, otherwise No system record.
- [x] `GET /settings/physical-document-monitor/history` returns matching physical document events and actor names. Older records may have no registry events. The UI shows timestamp, event type, actor, reason and notes.
- [x] `POST /settings/physical-document-monitor/follow-up` appends a `FOLLOW_UP` event with a required reason (maximum 100 characters), actor, series and reference after validating the selected series prefix and bounds. Latest follow-up reason appears on the corresponding row. It does not reserve or alter a receipt number.
- [x] A no-record row can open the existing mark-spoiled form prefilled with series and reference. A spoiled registry row can open the existing correction form, which uses its version and existing correction endpoint. These operations refresh the monitor.
- [x] The working tree adds no migration. This code relies on existing registry, source link and event tables.
- [ ] Verify all of the above with a real PostgreSQL instance and browser interactions. No monitor-specific automated tests have been added.

## 5. Remaining Work

### Transaction actions and safe reconciliation

- [ ] Add navigation to inspect linked invoice, customer payment or collection group, respecting existing permissions and handling multiple/historical source links. Current UI shows IDs as text only; it does not distinguish link roles.
- [ ] Provide a route into existing invoice receipt correction/void UI when appropriate, rather than modifying financial or registry states directly. Confirm permission checks and behavior for cancelled invoices and non-invoice sources using `packages/web/src/components/refunds/InvoiceDetailsModal.jsx`, `ReceiptActionModal.jsx`, and `packages/api/services/invoiceReceiptService.js`.
- [ ] Design and implement verification/linking for a genuinely unrecorded receipt against an existing transaction. Specify ownership, ambiguous matches, existing physical references, permissions, audit trail, concurrency/locking, duplicate prevention and financial invariants first. Do not blindly attach a reference or mark a gap issued.
- [ ] Review legacy matching: the current query only matches exact uppercase-trimmed `PREFIX-serial`, so differently formatted or zero-padded older values and overlapping series may be missed or ambiguous. Compare against the existing formatter and occupancy rules before changing classification; avoid asserting that a gap is unused.

### Monitor usability and follow-up

- [ ] Apply status filtering across the entire selected range with correct filtered totals and pagination; the existing dropdown filters only the current page.
- [ ] Add a way to resolve follow-up flags and retain an audit trail; currently the latest flag remains displayed even after a receipt changes status. Decide whether follow-up history should be shown separately and how to avoid flagging occupied numbers under concurrency.
- [ ] Consider `Verified unused` only after a business rule is agreed for its effect on eligibility, audit and later issuance. It was a suggestion, not a settled requirement.
- [ ] Verify row/action visibility for historical source links, multiple matching records, stale requests on series changes, empty pages, very large serials, and rows after spoilage correction or concurrent issuance. Review the existing spoilage endpoint's series/prefix/bounds validation and locking before relying on it for monitor actions.

### Verification

- [ ] Add meaningful real-PostgreSQL API tests for bounded enumeration, first/last page, status and legacy detection, unoccupied history, authorization, audit events, conflicting actions, and transaction linking when implemented. Use an isolated test database, not live sales.
- [ ] Add browser interaction tests for series/bounds selection, pagination and filtering, row actions, history, follow-up and error states. Test permissions and stale responses.
- [ ] Run appropriate API/web tests, lint and build; run `graphify update .`; update this handoff and manual with actual results.

## 6. Explicitly Deferred & Files Touched

Production deployment, release/version bump, and committing were not requested. `Verified unused` is deferred pending the business rule above; transaction actions and linking are outstanding requested work, not deferred scope.

Working-tree files for this effort:

- `packages/api/routes/physicalDocumentRoutes.js`
- `packages/web/src/components/settings/PhysicalDocumentSettings.jsx`
- `packages/web/src/components/settings/ReceiptMonitor.jsx` (untracked at documentation time)
- `docs/manuals/settings_and_setup_manual.md`
- This handoff document.

## 7. Verification Commands

Commands run during implementation:

```bash
node --check packages/api/routes/physicalDocumentRoutes.js
npm run -w packages/web lint -- --quiet
npm run -w packages/web build
npm run -w packages/api test -- --runInBand physicalDocumentCheckout.test.js
git diff --check
graphify update .
```

Syntax check, web lint and web build passed. The existing checkout suite failed to connect to PostgreSQL (`connect EPERM 127.0.0.1:5432`); none of its five scenarios ran successfully. This suite is not a substitute for monitor-specific tests. Graphify reported a rebuild failure: `Operation not permitted`. No authenticated monitor API or browser check was performed. The build ran before a final small UI change displaying the follow-up reason; lint ran after it.

For continuation, use an isolated database and run the appropriate monitor tests from the backend container if available, following the repository's real-PostgreSQL test conventions. Re-run the web build and lint after changes. Do not run database tests against production or an unverified shared database.

## 8. Change Log

- **2026-10-28:** Documented the uncommitted monitor implementation, exact gaps, verification limitations, and continuation plan; added a task-oriented settings manual section.
