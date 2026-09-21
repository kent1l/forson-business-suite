# Part Merge Reliability — Developer Handoff

> **Forson Business Suite** | **Date:** 2026-09-21 | **Branch:** `master`
> **Status:** Unique-child collision fix is committed. Full merge-domain audit, explicit relationship policies, and reversible-merge design are not started.

## 0. Status at a Glance

| Item | Status | Reference |
|---|---|---|
| `part_number` collision fix | **Done** in `f39d120` | §3 |
| `part_application` collision fix | **Done** in `f39d120` | §3 |
| Barcode transfer through `part_barcode` | **Done** in `f39d120` | §3 |
| Full foreign-key policy audit | **Not started** | §4 |
| Tag, staged-sale, inventory-stats, and alias handling | **Not started** | §4 |
| Merge concurrency hardening | **Not started** | §5 |
| Expiring merge-revert capability | **Not started** | §6 |

## 1. For a New Session or Agent Picking This Up

Before implementation:

1. Run `graphify query "PartMergeService executeMerge mergeChildRecords reassignForeignKeys undo merge"`.
2. Recall hindsight with query `"part merge PostgreSQL child uniqueness and undo"` and tags `forson-business-suite`, `part-merge`.
3. Confirm this document against `git status` and `git log --oneline -10`.
4. Inspect live foreign keys referencing `part` before deciding a migration policy; do not rely only on the initial schema.

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

## 4. Relationship Policy Audit — Not Started

`executeMerge()` currently moves only five hard-coded foreign-key tables: goods-receipt lines, invoice lines, PO lines, credit-note lines, and inventory transactions. It separately handles part numbers, applications, and barcodes.

Required next step: build a relationship-policy matrix from the live schema. For each `part_id` reference, choose one of:

- **Move:** active operational data, with deduplication where necessary.
- **Aggregate:** inventory/statistical data where per-part uniqueness makes direct reassignment unsafe.
- **Preserve:** immutable history/audit rows; resolve current catalog identity through `merged_into_part_id` rather than rewriting history.
- **Rebuild/invalidate:** cache, search, or derived data.

Known gaps requiring explicit decisions:

- `part_tag`: UI exposes `mergeTags`, but execution does not merge tags.
- `part_inventory_stats`: not moved or reconciled.
- `staged_sale` / active draft references: not moved.
- Existing `part_aliases`: new aliases are created but existing aliases are not reconciled.
- AI/dedupe, cycle-count, WAC-correction, and stock-reconciliation records: likely historical/audit data; preserve unless product policy says otherwise.

Do not bulk-update every table blindly. Moving historical invoice/receipt/inventory rows changes what an old document appears to refer to. Make this an explicit product decision per table.

## 5. Merge Execution and Presentation Hardening — Not Started

Current strengths:

- The merge itself is one database transaction; failures before `COMMIT` roll back.
- Source parts remain as inactive rows with `merged_into_part_id` pointing to the survivor.
- The cleanup UI navigates to Parts after success; `PartsPage` reloads its list when mounted.

Required improvements:

- Lock or otherwise serialize child-row and dependent-record edits; locking only `part` rows does not prevent all concurrent child edits.
- Decide whether historical transaction lines should be reassigned or preserve their original part identity.
- Revisit WAC logic: it uses net stock by part but ignores non-positive net quantities when calculating weighted value, which can misstate WAC after returns/adjustments.
- Make search synchronization durable/observable. `syncMeilisearch()` runs after commit and logs failures rather than surfacing or recording a durable retry outcome.
- Add integration tests that prove the intended policy for every migrated/aggregated/preserved relationship.

## 6. Expiring Merge Revert — Not Started

There is no merge-revert endpoint, UI, or sufficient snapshot today. `part_merge_log` stores rules and counts, not before-images or per-row ownership mappings, so a correct undo cannot be reconstructed after the fact.

Recommended design:

1. Before merge mutations, write a merge operation record with `undo_expires_at`, survivor/source part before-images, and per-row ownership mappings for every row moved, deleted, aggregated, or soft-deleted.
2. Add a permission-gated revert endpoint and UI action available only before expiry.
3. Revert in one transaction: reactivate source parts, restore pre-merge scalar values, restore rows by their recorded primary keys/original owners, undo aggregates, and record `reverted_at`/actor/reason.
4. Block undo if later activity makes allocation ambiguous (for example new sales, receipts, adjustments, or survivor edits after merge). Offer a forward correction instead.
5. On expiry, retain a compact immutable merge audit record but purge/archive the heavy snapshots and mappings on a scheduled job. Never delete the audit log merely to manage storage.

## 7. Verification

```bash
# Focused merge coverage
npm run -w packages/api test -- --runInBand packages/api/tests/partMergeService.test.js

# API lint
npm run -w packages/api lint

# Schema/migration drift check when DB credentials are configured
npm run -w packages/api migrate:verify -- --host localhost

# Refresh graph context after changes
graphify update .
```

## 8. Change Log

| Date | Session | Change |
|---|---|---|
| 2026-09-21 | Codex + product owner | Documented committed child-uniqueness fix and the deferred relationship-policy, concurrency, and expiring-undo work. |