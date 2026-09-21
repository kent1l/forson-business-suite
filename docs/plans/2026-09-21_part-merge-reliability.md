# Part Merge Reliability — Developer Handoff

> **Forson Business Suite** | **Date:** 2026-09-21 | **Branch:** `master`
> **Status:** All approved reliability phases are implemented. The remaining work is database-backed integration coverage and production migration verification.

## 0. Status at a Glance

| Item | Status | Reference |
|---|---|---|
| `part_number` collision fix | **Done** in `f39d120` | §3 |
| `part_application` collision fix | **Done** in `f39d120` | §3 |
| Barcode transfer through `part_barcode` | **Done** in `f39d120` | §3 |
| Full foreign-key policy audit | **Done** in `85c336e` | §4 |
| `part_tag` move | **Done** in `85c336e` | §4-A |
| `part_inventory_stats` aggregate | **Done** in `85c336e` | §4-A |
| `part_aliases` reconciliation | **Done** in `85c336e` | §4-A |
| `staged_sale_line` open drafts | **Done** in `85c336e` | §4-A (P2) |
| Dedupe queue / AI cache / AI queue rebuild | **Done** in `85c336e` | §4-B |
| `part_exclusion` transfer | **Done** in `85c336e` | §4-B |
| Historical tables — explicit Preserve policy | **Done** in `85c336e` | §4-C |
| WAC non-positive quantity fix | **Done** in `85c336e` | §5 |
| Merge concurrency hardening | **Done** | §5 |
| Meilisearch durable sync | **Done** | §5 |
| Expiring merge-revert capability | **Done** | §6 |

## 1. For a New Session or Agent Picking This Up

Before implementation:

1. Run `graphify query "PartMergeService executeMerge mergeChildRecords reassignForeignKeys undo merge"`.
2. Recall hindsight with query `"part merge PostgreSQL child uniqueness and undo"` and tags `forson-business-suite`, `part-merge`.
3. Confirm this document against `git status` and `git log --oneline -10`.
4. Run the database-backed merge/revert integration suite before changing relationship policies; do not rely only on unit mocks.

When a phase lands, update §0 and the corresponding section, retain non-obvious decisions, and run `graphify update .`.

## 2. Objective

Make part merging a safe canonicalization workflow: exactly one surviving catalog part, deliberate treatment of every dependent record, truthful preservation of business history, fresh catalog/search presentation, and a time-limited reversible window for operator mistakes.

## 3. As Built — Child-Record Collision Fix

Commit `f39d120` modified:

- `packages/api/services/partMergeService.js`
- `packages/api/tests/partMergeService.test.js`

Completed work:

- `part_number`: soft-deletes source rows already active on the keep part; then ranks remaining source rows by `part_number` and retires `rn > 1` before assigning only `rn = 1`. This prevents immediate partial-index collision on `ux_part_number_active_unique`.
- `part_application`: removes source links already present on the keep part; then ranks by `application_id`, deletes duplicates, and assigns only one row per application. This prevents immediate `(part_id, application_id)` uniqueness collisions.
- Removed invalid `part.barcode` override mapping; source barcodes transfer via `part_barcode`.
- Local rollback-only SQL reproduced the old `part_number` collision for keep part 1024 / `90915-YZZE1`; the fixed query reassigned two rows with no active duplicate.
- Focused service tests passed (9 tests). API lint completed with zero errors and unrelated repository warnings. The full API suite could not authenticate to its expected test database in this workspace.

## 4. Relationship Policy Audit — As Built

`executeMerge()` currently moves only five hard-coded foreign-key tables: goods-receipt lines, invoice lines, PO lines, credit-note lines, and inventory transactions. It separately handles part numbers, applications, and barcodes.

The relationship-policy matrix is implemented in `mergeChildRecords()` and `reassignForeignKeys()`. Each `part_id` reference is one of:

- **Move:** active operational data, with deduplication where necessary.
- **Aggregate:** inventory/statistical data where per-part uniqueness makes direct reassignment unsafe.
- **Preserve:** immutable history/audit rows; resolve current catalog identity through `merged_into_part_id` rather than rewriting history.
- **Rebuild/invalidate:** cache, search, or derived data.

The following policies were implemented:

- `part_tag` moves unless `mergeTags` is explicitly false.
- `part_inventory_stats` aggregates last-counted/audit state.
- Open `staged_sale_line` rows move; completed/rejected sales retain original attribution.
- Existing aliases reconcile before merge-created provenance aliases are added.
- AI/dedupe data is invalidated, exclusions are transferred, and historical/audit rows are preserved.

Do not bulk-update every table blindly. Moving historical invoice/receipt/inventory rows changes what an old document appears to refer to. Make this an explicit product decision per table.

## 5. Merge Execution and Presentation Hardening — As Built

Current strengths:

- The merge itself is one database transaction; failures before `COMMIT` roll back.
- Source parts remain as inactive rows with `merged_into_part_id` pointing to the survivor.
- The cleanup UI navigates to Parts after success; `PartsPage` reloads its list when mounted.

Implemented hardening:

- Merges take deterministic transaction-scoped advisory locks, then revalidate under the locks. A migration trigger makes all covered part/child/inventory writers take the same locks.
- Historical transaction-document rows preserve original attribution; inventory transactions move only after WAC reads original-owner stock.
- WAC includes signed quantities and uses the pre-reassignment stock snapshot, retaining survivor WAC for non-positive combined stock.
- The merge writes a survivor upsert and source deletes to `meili_sync_outbox` inside its transaction. The existing worker provides retries, dead-letter status, and observability.

Still required: real-PostgreSQL integration tests covering the policy matrix, concurrent writers, WAC ordering, outbox retry, and revert safety.

## 6. Expiring Merge Revert — As Built

`part_merge_log` remains the compact immutable audit trail. Reversible before-images are held separately in time-limited snapshots so audit retention is never coupled to snapshot storage.

Implemented design:

1. `part_merge_operation` and `part_merge_snapshot` capture before-images for every mutated relationship and expire after 24 hours.
2. `parts:merge_revert` is granted to Admin and Manager roles. The cleanup page lists eligible operations and requires a reason.
3. Revert restores snapshots in one transaction, records actor/reason/timestamp, and queues catalog upserts transactionally.
4. Revert refuses later part edits or new inventory transactions; use a forward correction when it is unsafe.
5. A daily worker marks operations expired and purges detailed snapshots 90 days after their undo window. `part_merge_log` remains intact.

## 7. Verification

```bash
# Focused merge coverage
npm run -w packages/api test -- --runInBand packages/api/tests/partMergeService.test.js

# API lint
npm run -w packages/api lint

# Web lint and production build
npm run -w packages/web lint
npm run -w packages/web build

# Schema/migration drift check when DB credentials are configured
npm run -w packages/api migrate:verify -- --host localhost

# Refresh graph context after changes
graphify update .
```

## 8. Change Log

| Date | Session | Change |
|---|---|---|
| 2026-09-21 | Codex + product owner | Documented committed child-uniqueness fix and the deferred relationship-policy, concurrency, and expiring-undo work. |
| 2026-09-21 | Antigravity | Implemented full FK policy matrix (§4-A/B/C) + WAC fix (§5) in commit `85c336e`. All 28 FK references classified; 18 unit tests passing. Remaining: concurrency hardening, Meili durable sync, expiring undo (§6). |
| 2026-09-21 | Codex + product owner | Implemented advisory-lock serialization, transactional Meili outbox events, pre-reassignment signed WAC, 24-hour permission-gated revert with 90-day snapshot retention, maintenance job, and cleanup-page action. |
