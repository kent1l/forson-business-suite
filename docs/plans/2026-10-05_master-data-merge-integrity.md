# Master Data Merge Integrity — Supplier, Customer, Brand, and Group

> **Forson Business Suite** | **Date:** 2026-10-05 | **Branch:** `master`
> **Status:** Phase 1 committed; phase 2 implemented in the working tree. Phase 3 is partly started; phase 4 and rollout remain. Neither new migration has been deployed.

## 0. Status at a Glance

| Phase | Status | Outcome |
|---|---|---|
| Current behavior and schema audit | Complete | Existing services, tests, migrations, live foreign keys, constraints, and merged rows were inspected |
| Merge contract and relationship policy | Implemented in working tree | Runtime policy registry is checked against PostgreSQL before preview and execution |
| Schema and audit infrastructure | Phase 1 committed; draft guard in working tree | Inactive state, merge constraints, aliases, audit tables, namespaced locks, FK/draft guards, and catalog drift tests |
| Transactional merge engine | Implemented in working tree | Shared engine handles collisions, wallets, tags, aliases, drafts, snapshots, outbox, and atomic postconditions |
| API and review UI | Partially implemented | Structured blockers, impact, fingerprint, and basic blocker display; history, revert UI, stale-client handling, and full review layout remain |
| Tests and rollout | Partially implemented | Rollback-only PostgreSQL suites cover key paths; broader relationship, concurrency, route, and deployment verification remain |

## 1. For a New Session or Agent Picking This Up

Before implementation:

1. Run `graphify query "supplier customer brand group merge deduplication foreign keys inactive aliases wallet drafts"` for a current code map.
2. Recall hindsight with tags `forson-business-suite`, `master-data-merge` for phase 1 lock and guard decisions.
3. Read this document and `docs/plans/2026-09-21_part-merge-reliability.md`. Reuse the part merge's transaction, lock, snapshot, history, and invariant patterns where the entity rules agree.
4. Query `pg_constraint` in the target database for every foreign key referencing `supplier`, `customer`, `brand`, or `"group"`. Treat the live catalog and all unapplied migrations as inputs; do not trust a hard-coded service list by itself.
5. Confirm this document's status against `git log`, `git status`, and migration status before changing code.
6. Keep the relationship policy registry and its schema-drift integration test in the same change. A newly introduced foreign key must make the test fail until its merge policy is declared.

When a phase lands, update §0 and the relevant phase, retain non-obvious decisions to hindsight, and run `graphify update .`.

## 2. Objective and Required Postcondition

When an operator nominates a healthy canonical supplier, customer, brand, or group, every business record owned by a selected duplicate must point to that canonical ID after the merge. The source records remain only as retired merge tombstones for traceability.

A successful merge must satisfy all of these conditions in the same database transaction:

1. The canonical record exists, is active, and is not itself merged.
2. Every selected source points to the canonical record through `merged_into_*_id`, has `is_merged = TRUE`, and has `is_active = FALSE` where that entity supports active state.
3. No operational document, ledger, balance, tag, part, alias ownership row, or active draft still uses a source ID.
4. Uniqueness collisions and incompatible financial state are resolved explicitly before any source is retired.
5. The merge records its actor, source and canonical IDs, before-images, counts, decisions, and completion state.
6. Any error, invariant failure, or concurrent conflict rolls the entire merge back.

Merge provenance is the only allowed reference to a retired source: `merged_into_*_id`, immutable merge audit/snapshot records, and an alias provenance value if retained for audit. These are not operational ownership links and must be excluded explicitly from the zero-reference assertion.

## 3. Verified Current State

### 3.1 Existing implementation

- `PartyMergeService` handles suppliers and customers with a hand-maintained list of relationship columns. It blocks active drafts with a text regular expression and blocks every customer that has a wallet.
- `EntityMergeService` handles brands and groups. It only updates `part.brand_id` or `part.group_id`, creates one alias for each source record, and sets the source merge flags.
- Both services use one transaction, advisory locks for the selected IDs, row locks on the selected master records, and execution-time revalidation.
- Neither service writes a merge operation/history record or reversible snapshots.
- Supplier/customer sources are marked `is_merged`, but the service does not set `is_active = FALSE`.
- Brand/group tables do not currently have `is_active`; `is_merged` is their only retirement state.
- Ordinary supplier and customer update routes can edit a merged row and can reactivate it because their `UPDATE` statements do not reject `is_merged = TRUE`.
- Current preview counts are incomplete. Brand/group preview reports only parts. Party preview reports only the service's configured columns and does not describe collision risk or special consolidation work.

### 3.2 Live database findings on 2026-10-05

- The database contains 1 merged supplier, 1 merged customer, 13 merged brands, and 4 merged groups.
- The merged supplier and merged customer are both still marked active, confirming the retirement defect.
- The audited operational references currently have zero rows pointing to those already merged records. Existing data is therefore clean in that limited respect; the issue is future merge correctness and inactive state.
- The live schema has 38 foreign keys to the four master tables, including merge-state self references, duplicate suggestions, aliases, and business relationships.
- The migration ledger is applied through `20260928_02_jev_batch_decision_cache.sql`. Repository migrations `20260928_03_sales_correction_cases.sql` and `20261005_01_cycle_count_auto_assign_staff.sql` were not in that live ledger during the audit; neither introduces a reference to these four entities.
- The focused mock-based service tests pass: 2 suites, 8 tests. They confirm today's narrow SQL sequence, but they do not exercise PostgreSQL uniqueness, real foreign keys, wallets, drafts, concurrent writers, audit snapshots, or rollback postconditions.

### 3.3 Gaps that can break or weaken a merge

1. `ar_adjustment_authorization_log.customer_id` exists in PostgreSQL but is absent from the customer relationship list.
2. Draft detection searches serialized JSON for `supplier_id` or `customer_id`. Purchase-order drafts store the supplier under `selectedSupplier`, so a live PO draft can escape the current check.
3. Reassigning `goods_receipt.supplier_id` can create duplicate `(supplier_id, supplier_invoice_no)` or `(supplier_id, physical_receipt_no)` values under existing unique indexes.
4. Reassigning `withholding_tax_certificate.customer_id` can create a duplicate active `(customer_id, certificate_no)`.
5. Customer tags need a union/deduplicate operation. Direct reassignment can violate the `(customer_id, tag_id)` primary key.
6. Customer wallets need financial consolidation. Direct reassignment violates the one-wallet-per-customer constraint, while simply deleting a wallet loses value and audit history.
7. Existing brand/group aliases owned by a source are not moved to the canonical owner. Only the source record's current name/code is added as a new alias.
8. New child documents can be inserted against a source between preview and execution unless child writers participate in the same lock protocol or the database rejects references to retired masters.
9. There is no durable merge history, before-image, or safe undo window comparable to part merges.
10. A future migration can add a new foreign key without updating either service, leaving linked documents on a retired record.

## 4. Decisions Already Taken

- The operator-selected canonical record wins. Its code, name, contact fields, terms, credit settings, and active state are not automatically overwritten from a source.
- All operational and historical business documents will be re-parented to the canonical ID, matching the requested behavior. Reports that join a document to current master data will consequently show the canonical name. Merge audit and aliases preserve the old identity.
- No invoice, receipt, order, payment, certificate, ledger entry, or wallet transaction may be deleted merely to make a merge succeed.
- Ambiguous uniqueness collisions block execution and appear in preview with the exact conflicting records. The operator must correct, void, cancel, or otherwise resolve them through their owning workflow before retrying.
- Set-like relationships such as tags and aliases are unioned and deduplicated automatically.
- Additive financial state such as a customer wallet is consolidated only after its ledger proves internally consistent. A mismatch blocks the merge for reconciliation.
- Runtime SQL will use a reviewed policy registry, not arbitrary dynamic updates of every catalog foreign key. A real-database drift test compares that registry with `pg_constraint`, providing safety and future completeness.
- Merge retirement is distinct from ordinary manual deactivation. A merged source cannot be edited, reactivated, selected in a new transaction, or used as a future canonical target.
- Duplicate suggestions and AI decision caches are workflow metadata. Relevant suggestion details are copied into the merge operation audit, then stale actionable rows/cache entries are removed or terminally archived so they cannot keep producing source-based work.
- The whole operation is atomic. Partial merge states are never committed.

## 5. Relationship Policy Matrix

### 5.1 Supplier

| Relationship | Policy | Special rule |
|---|---|---|
| `goods_receipt.supplier_id` | Move | Preflight both supplier-scoped receipt-number unique indexes; conflicting GRNs block |
| `goods_receipt.freight_supplier_id` | Move | Nullable; canonical supplier replaces each source |
| `goods_receipt_freight.supplier_id` | Move | Nullable; retain freight bill/payment links |
| `purchase_order.supplier_id` | Move | Update saved PO drafts as described in §5.5 |
| `supplier_bill.supplier_id` | Move | Preserve bill, allocation, payment, and ledger IDs |
| `ap_ledger.supplier_id` | Move | Preserve immutable entry amounts and order |
| `ap_payment.supplier_id` | Move | Preserve allocations and cheque/PDC relationships |
| `cheque_clearance_log.supplier_id` | Move | Preserve the clearance audit row |

### 5.2 Customer

| Relationship | Policy | Special rule |
|---|---|---|
| `invoice.customer_id` | Move | Preserve invoice and payment relationships |
| `customer_payment.customer_id` | Move | Preserve payment allocations, physical receipts, and PDC state |
| `staged_sale.customer_id` | Move | Include open and completed rows per the requested all-document policy |
| `ar_adjustment.customer_id` | Move | Preserve adjustment allocations and authorization evidence |
| `ar_adjustment_authorization_log.customer_id` | Move | Currently missing from `PartyMergeService`; include nullable rows |
| `ar_ledger.customer_id` | Move | Preserve immutable entry amounts and order |
| `withholding_tax_line.customer_id` | Move | Preserve invoice/payment/certificate links |
| `withholding_tax_certificate.customer_id` | Move after collision check | Duplicate active certificate numbers under the canonical customer block |
| `cheque_clearance_log.customer_id` | Move | Preserve clearance evidence |
| `customer_tag.customer_id` | Union/deduplicate | Insert missing canonical tags, then remove source ownership rows |
| `customer_wallet` and `customer_wallet_transaction` | Consolidate | See §5.4; never discard balance or transaction history |

### 5.3 Brand and group

| Relationship | Policy | Special rule |
|---|---|---|
| `part.brand_id` | Move | Trigger durable catalog/search upserts for every affected part |
| `part.group_id` | Move | Trigger durable catalog/search upserts for every affected part |
| Existing `brand_alias.brand_id` / `group_alias.group_id` | Union/deduplicate | Move all source aliases, then add the source record's own name/code |
| Alias `source_*_id` | Audit provenance | May point at the retired source only if explicitly exempted as immutable provenance; otherwise copy source ID into merge audit and null it |

### 5.4 Customer wallet consolidation

Wallets require a deterministic financial operation inside the merge transaction:

1. Lock canonical and source wallet rows in wallet-ID order.
2. For every wallet, verify stored `balance` equals the signed sum of its transaction amounts. If a legacy opening balance or other exception exists, require a documented reconciliation entry before merge.
3. Ensure a canonical wallet row exists.
4. Move source transactions to the canonical wallet and customer ID without changing amounts, references, actors, or timestamps.
5. Recompute `balance_after` for the combined stream ordered by `(created_at, transaction_id)` and reject any sequence that becomes negative.
6. Set the canonical wallet balance to the final recomputed balance and delete the now-empty source wallet rows.
7. Snapshot every affected wallet and transaction before mutation so rollback/revert can restore the original chains.

### 5.5 Draft and non-FK references

- Replace source IDs in active server-side drafts through a versioned registry of known JSON paths and transaction types. At minimum this includes PO `selectedSupplier`, generic `supplier_id`, goods-receipt supplier/freight supplier fields, and saved sales/customer fields found in the actual payload schemas.
- Do not use a text regular expression as the authority. Parse JSON and update typed paths while accepting numeric and string representations.
- Preview lists each affected draft and whether it can be safely rewritten. Unknown payload versions block the merge rather than being guessed.
- Search the codebase and database for denormalized source IDs in JSON, arrays, caches, materialized tables, and external search documents. Declare each as move, rebuild, invalidate, or audit-only in the registry.
- Browser-local saved sales are outside the server transaction. When loaded or posted, the API must resolve a retired ID to its canonical ID and return the canonical entity. This server-side redirect also protects offline or stale clients.

## 6. Phase 1 — Schema and Invariants

Implemented in `20261005_02_master_data_merge_phase1.sql`, the two merge services, and `masterDataMergePolicy.js`. The migration backfills retired rows, adds the four entity constraints, alias and audit tables, namespaced advisory locks, FK write guards, and relationship indexes. The merge services now set `is_active = FALSE` when retiring sources and use the same entity-specific lock namespaces as the database guards. `masterDataMergePolicy.test.js` applies the migration inside a rollback-only real-PostgreSQL transaction, compares the policy registry to `pg_constraint`, and exercises a retired-source write guard. Local validation passed; deployment migration status and production behavior remain unverified.

Phase 1 creates the audit infrastructure but the existing endpoints do not yet write merge operations/snapshots. The old execution paths remain incomplete and should not be enabled for general merges until phase 2 moves every registered operational relationship and enforces zero references. The catalog test covers the local post-migration schema; rerun it against each target database before enabling the new engine.

1. Add `is_active BOOLEAN NOT NULL DEFAULT TRUE` to brand and group. Backfill every already merged brand/group to inactive.
2. Backfill every merged supplier/customer to `is_active = FALSE`, including the two live rows found by this audit.
3. Strengthen merge-state checks for all four entities:
   - merged implies `merged_into_*_id IS NOT NULL` and inactive;
   - unmerged implies `merged_into_*_id IS NULL`;
   - an entity cannot point to itself.
4. Add `supplier_alias` and `customer_alias` tables so old names/codes remain searchable without leaving operational rows on a source. Apply normalized uniqueness appropriate to each entity.
5. Add a generic `master_data_merge_operation` table and `master_data_merge_snapshot` table modeled on part merge operations. Store entity type, canonical ID, source IDs, actor, timestamps, status, undo expiry, impact JSON, decisions, and before-images.
6. Namespace advisory locks by entity type and ID. Raw numeric locks shared across unrelated entity tables should be replaced with stable entity-specific keys.
7. Add database guards to serialize source/canonical changes with merge execution and prevent new operational rows from referencing an inactive or merged master. Existing historical rows remain valid until a merge moves them.
8. Add indexes needed by the complete relationship registry and zero-reference checks.

## 7. Phase 2 — Unified Transactional Merge Engine

**As built in the working tree:** `MasterDataMergeService` is now the only execution path for supplier, customer, brand, and group; the old service classes retain directory/scanning behavior and delegate preview/execution. Execution requires the preview fingerprint and the existing route permission middleware. It checks the live FK catalog against the policy registry, takes entity-specific advisory and master-row locks, recomputes impact and blockers under those locks, records a merge operation plus before-images, applies special policies and ordinary FK moves, retires sources, checks zero operational references and other invariants, then marks the operation active before commit. Every error rolls the API transaction back.

- Supplier receipt numbers and customer certificate numbers block with conflicting record IDs. The owning document workflow must resolve them; execution does not silently void or delete documents.
- Customer tags and all four entities' aliases are unioned with normalized deduplication. Existing alias provenance is preserved where present.
- Customer wallets are locked and checked against their ledgers. Transactions retain amounts/references/actors, move to the canonical wallet, and receive chronological running balances; inconsistent or negative streams block.
- Active server drafts use known JSON keys and transaction types. PO `selectedSupplier`, goods-receipt supplier/freight paths, generic supplier/customer IDs, and saved customer fields are rewritten. Unknown payloads with possible source IDs block. Migration `20261005_03_master_data_merge_draft_guard.sql` serializes known draft paths with merge locks and rejects new retired IDs.
- Source-related duplicate suggestions are snapshotted and terminally archived; brand/group decision cache rows involving a source are snapshotted and invalidated. Affected part IDs receive durable Meilisearch upserts in the merge transaction.
- Review fingerprints include master identity, relationship row identities, aliases, suggestions, drafts, wallet state, impact, and blockers. A stale fingerprint returns `409`.

**Still outside phase 2:** browser-local saved sales and stale transaction submissions need phase 3 API redirects or explicit conflicts. The preview fingerprint has no expiry yet; phase 3 specifies a short-lived token. The old `parts_reassigned` display remains a compact summary pending the full impact UI. No migration was applied to the live local database; integration tests apply both migrations inside rolled-back PostgreSQL transactions.

Build one shared engine with entity-specific policy adapters. Supplier/customer and brand/group may keep separate discovery/scanning logic, but execution must use the same lifecycle:

1. Validate IDs, permission, entity type, and distinct canonical/source membership.
2. Start a transaction and acquire namespaced locks in deterministic order.
3. Lock all selected master rows and revalidate that the canonical is healthy/active and every source is unmerged.
4. Recompute preview under the locks. If its policy fingerprint differs from the confirmed preview, return `409` and require a fresh review.
5. Run collision and financial integrity checks. Return structured blockers containing table, field, source ID, canonical ID, and conflicting record identifiers.
6. Create the pending merge operation and snapshot every row that will be changed, including drafts, aliases, tags, wallets, and source master rows.
7. Apply special policies first: wallet consolidation, tag/alias union, and any operator-approved conflict resolution.
8. Move every ordinary relationship to the canonical ID using the reviewed registry.
9. Rewrite active drafts and invalidate/rebuild denormalized caches and search records.
10. Archive the selected suggestion details into the operation; dismiss/remove all remaining actionable suggestions and invalidate duplicate decision caches involving a source.
11. Retire sources with `is_active = FALSE`, `is_merged = TRUE`, and the canonical `merged_into_*_id`.
12. Run postconditions before commit:
    - zero operational FK rows point to a source;
    - zero registered draft paths contain a source;
    - sources are inactive and point directly to the healthy canonical;
    - the canonical is active and unmerged;
    - wallet balances and ledger invariants reconcile;
    - affected parts have durable search/catalog sync work queued.
13. Mark the operation complete and commit. Any failure rolls back snapshots, relationship moves, source retirement, and sync events together.

Do not allow merge chains. If a stale client supplies an already merged ID, resolve it for read/navigation purposes but reject merge execution and require the operator to select the current healthy canonical explicitly.

## 8. Phase 3 — Preview, API, and UI

**Partially done:** preview now returns per-relationship counts, structured blockers, affected draft names, wallet total, and a policy fingerprint. The existing merge pages send that fingerprint, show basic blockers, and disable blocked merges. Remaining: full impact matrix, explicit historical-name acknowledgment, token expiry, history/revert views, read-only retired-row behavior across normal endpoints, and stale-client ID handling.

1. Return a structured preview with one count per relationship, affected draft names, aliases/tags to union, wallet totals, collision blockers, warnings, and the postcondition scope.
2. Generate a short-lived preview token/fingerprint bound to entity type, canonical ID, source IDs, policy version, and observed conflict state. Execution requires it and rechecks under locks.
3. Replace the party page's single linked-record total and the entity page's parts-only total with the full impact matrix.
4. Show blocking conflicts as actionable links where possible, such as the two GRNs sharing a supplier document number or certificates sharing a customer/certificate number.
5. Require an explicit acknowledgment that historical documents will display under the canonical master after merge.
6. After success, refresh the directory, affected detail drawers, balances, suggestions, and catalog search state.
7. Add merge history for all four entity types. Show actor, time, canonical/source records, counts, status, blockers encountered, and revert eligibility.
8. Make retired rows read-only. Normal edit/delete/reactivate endpoints must return a clear `409` with the canonical ID for merged sources.
9. All entity lookup and transaction-write endpoints must exclude merged/inactive choices and safely redirect stale submitted IDs to the canonical record or return an explicit conflict according to workflow risk.

## 9. Phase 4 — Guarded Revert

Follow the part merge model with a limited undo window, but validate entity-specific risks:

1. Revert from snapshots in one transaction and record actor plus mandatory reason.
2. Refuse revert when an affected row was subsequently edited, when new wallet activity makes the old wallet chains unsafe, when a source's old unique values now conflict, or when a source/canonical took part in another merge.
3. Restore source active/merge state, relationship ownership, drafts, aliases/tags, wallets, suggestions where useful, and catalog/search events.
4. Keep the compact operation audit permanently. Expire and later purge detailed snapshots using the same retention approach as part merge.
5. If safe automatic revert cannot be proven, leave the merge intact and require a forward correction. Never perform a best-effort partial undo.

## 10. Phase 5 — Verification and Rollout

**Partially done:** `masterDataMergeService.test.js` exercises the shared engine against real PostgreSQL inside a rolled-back transaction. It covers brand/group success, aliases and outbox, supplier receipt collisions, PO/GRN draft rewriting and stale-draft rejection, customer tag/wallet consolidation, certificate and wallet blockers, unknown drafts, stale fingerprints, and a late outbox failure rolled back to a savepoint. The phase 1 policy/schema test remains. Full FK fixture coverage, true concurrent-writer tests, route behavior, staging data audit, and deployment verification remain.

### 10.1 Required automated coverage

- Keep focused unit tests for validation and SQL/policy dispatch.
- Add real-PostgreSQL integration tests that create every relationship type, execute a merge, and assert the zero-reference postcondition.
- Add a schema-drift test that compares all `pg_constraint` foreign keys targeting the four master tables with the policy registry. Exemptions must be named and justified; an unknown FK fails the suite.
- Test supplier receipt-number collisions for both unique indexes and prove the transaction makes no changes when blocked.
- Test duplicate customer withholding certificates.
- Test tag and alias overlap, including case/normalization variants.
- Test zero, one, and multiple customer wallets; transaction rebasing; inconsistent balance rejection; and rollback after a late failure.
- Test actual draft payload shapes, especially PO `selectedSupplier`, string IDs, nested freight suppliers, saved sales, and unknown-version rejection.
- Test a concurrent writer attempting to create a child document against a source during merge.
- Test ordinary updates cannot reactivate or edit a merged source.
- Test stale API submissions resolve or reject retired IDs according to the declared endpoint policy.
- Test durable Meilisearch/catalog outbox events for brand/group part reassignment.
- Test guarded revert success and every safety refusal.

### 10.2 Existing-data audit before enabling the new engine

Run a read-only report in staging and production that shows:

- merged rows still active;
- every operational reference to a merged row;
- merge chains or self references;
- supplier receipt-number collisions that would appear after candidate consolidation;
- customer certificate collisions;
- wallet balance versus transaction-sum mismatches;
- active drafts containing retired IDs;
- aliases still owned by merged brands/groups;
- migration checksum/status and registry-versus-catalog drift.

Repair existing merged rows with a dedicated idempotent data migration or reviewed repair command. Do not silently fold unrelated data repair into a user's next merge.

### 10.3 Suggested verification commands

```bash
npm run -w packages/api test -- --runInBand packages/api/tests/partyMergeService.test.js packages/api/tests/entityMergeService.test.js
npm run -w packages/api test -- --runInBand packages/api/tests/masterDataMergePolicy.test.js
npm run -w packages/api test -- --runInBand packages/api/tests/masterDataMergeService.test.js
npm run -w packages/api test -- --runInBand packages/api/tests/masterDataMerge_db_test.js
npm run -w packages/api lint
npm run -w packages/web lint
npm run -w packages/web build
npm run -w packages/api migrate:status -- --host localhost
npm run -w packages/api migrate:verify -- --host localhost
graphify update .
```

Roll out behind a setting such as `ENABLE_SAFE_MASTER_DATA_MERGE`. Apply migrations and run the existing-data audit first, enable preview in staging, execute fixture merges for all four entity types, then enable execution. Keep the old execution endpoints disabled once the new engine is active so two merge semantics cannot coexist.

## 11. Expected Files and Components

- `database/migrations/<timestamp>_master_data_merge_integrity.sql`
- `packages/api/services/masterDataMergeService.js` (new shared execution engine)
- `packages/api/services/masterDataMergePolicies.js` (explicit registry and special handlers)
- `packages/api/services/partyMergeService.js`
- `packages/api/services/entityMergeService.js`
- `packages/api/routes/partyMergeRoutes.js`
- `packages/api/routes/brandRoutes.js`
- `packages/api/routes/groupRoutes.js`
- `packages/api/routes/customerRoutes.js`
- `packages/api/routes/supplierRoutes.js`
- `packages/api/tests/masterDataMerge_db_test.js`
- `packages/api/tests/partyMergeService.test.js`
- `packages/api/tests/entityMergeService.test.js`
- `packages/web/src/pages/PartyMergePage.jsx`
- `packages/web/src/pages/EntityManagementPage.jsx`
- a shared merge impact/history component if the two pages would otherwise duplicate behavior

## 12. Explicitly Deferred

- Automatic merging based only on similarity or AI confidence. Every merge remains human-confirmed.
- Automatic choice between colliding legal/accounting documents. Those conflicts require their owning correction/void workflow.
- Deleting retired source master rows. Tombstones are retained for redirects, aliases, and audit.
- General deduplication of employees, vehicle fitment masters, payment terms, or other entities. Their relationship and collision policies need separate review.

## 13. Change Log

| Date | Session | Change |
|---|---|---|
| 2026-10-05 | Codex + product owner | Verified current supplier/customer/brand/group merge behavior against source, tests, migrations, and the live development schema; documented the complete safe-merge plan. |
| 2026-10-05 | Codex | Implemented phase 1 schema, namespaced locks, write guards, aliases, audit storage, policy registry, and PostgreSQL drift/guard tests in the working tree. Migration was tested inside a rolled-back transaction; it was not deployed. |
| 2026-10-05 | Codex | Implemented the phase 2 shared transactional engine, draft write guard, minimal fingerprint/blocker UI wiring, and rollback-only PostgreSQL coverage. New migrations were not deployed. |
