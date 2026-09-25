# Jev AI Integration & Data Cleanup — Developer Handoff

> **Forson Business Suite** | **Date:** 2026-09-24 | **Branch:** `master`
> **Status:** Planning complete. Implementation has not started.

## 0. Status at a Glance

| Phase | Status | Reference |
|---|---|---|
| 0: Schema Infrastructure (Migrations) | **Complete** | §5-0 |
| 1: Brand & Group Management Feature (UI + AI Scan) | **Partially Complete** | §5-1 — merge workflow is built; Jev enrichment and manual cleanup remain |
| 2: Customer & Supplier Merge Feature (UI + AI Scan) | **Not Started** | §5-2 |
| 3: Local-First Features (Cross-ref, basic scoring) | **Not Started** | §5-3 |
| 4: Activate Jev Gates (Brand, Group, Cust, Supp, Part) | **Not Started** | §5-4 |
| 5: Inline Parsers (Expenses, Fitment, PO) | **Not Started** | §5-5 |
| 6: Background & Batch (Dedup worker, nightly scoring) | **Not Started** | §5-6 |

## 1. For a New Session or Agent Picking This Up

Before starting:
1. Run `graphify query "Jev TypeSafe AI integration parts expense vehicle fitment deduplication merge"` for a current view of the code structure.
2. Call hindsight's `recall` with a query about this feature and its established tags (`jev`, `forson-business-suite`, `ai-integration`) — retrieves the non-obvious decisions/gotchas not reasonable to fully duplicate here.
3. Confirm this document's "Status at a Glance" table is still accurate against `git log` / the running system before trusting it.

When you finish a phase or make a non-obvious decision:
1. Update the Status at a Glance table and the relevant phase section.
2. Retain new architectural decisions/gotchas to hindsight.
3. Run `graphify update .` so the next query reflects your changes.

## 2. Objective / Context

Replace expensive, slow generative LLMs with TypeSafe AI's Jev (a non-autoregressive decision model using `Noul`, `Choice`, and `Score` primitives) to make AI classification instant (<150ms) and dramatically cheaper (~$0.0001/call). 
This allows Forson Business Suite to use AI *inline* during user interactions (e.g., duplicate prevention gates, instant categorization) rather than just in background queues. 

Because Jev requires clean data choices to be accurate, this integration includes a significant data cleanup effort. The cleanup relies on building new merge management features (for Brands, Groups, Customers, and Suppliers) backed by the same AI pipeline used for parts, ensuring the database provides a clean foundation for the new real-time AI gates.

## 3. Decisions Already Taken

- **Free LLMs are NOT being replaced entirely.** For background tasks like the `dedupe-scan-worker` (A1), Jev is inserted as a *pre-filter* to instantly resolve clear matches/non-matches. The free LLMs (e.g., Gemma 4 via OpenRouter) are retained to handle the ambiguous edge cases.
- **Local-first where possible.** The Part Number Cross-Reference (C1) will be built using 100% local SQL queries (reusing `normalizeSku.js` logic) without any API calls. Cycle count prioritization (B3) and Reorder recommendations (C2) will start as local scoring formulas. Jev will only be layered on later.
- **Merge features must be built BEFORE activating Jev gates.** You cannot gate part creation (A4) or brand creation (B1) effectively if the existing data contains duplicates. The merge UIs are built first, used to clean the data, and then the gates are activated.
- **Alias over Rename.** When merging Brands or Groups, existing SKUs remain unchanged. We will write `brand_alias` rows instead of rewriting the `{GROUP_CODE}-{BRAND_CODE}` prefix on thousands of historical part records.

## 4. Architecture / Domain Model

- **The AI Cleanup Pipeline:** Mirrors the existing `deduplicationEngine.js`. 
  1. SQL Blocking (`pg_trgm` `SIMILARITY()`) → 2. Jev Confidence Scoring (Noul) → 3. Free LLM for explanations on ambiguous pairs → 4. Admin Review UI.
- **The Jev Cascade:** Most user actions (like creating a part or searching) will **never** call Jev. Real-time Jev calls are heavily gated. E.g., `POST /api/parts` only calls Jev if local Meilisearch finds a fuzzy candidate first.
- **Data Growth Loop:** Jev decisions actively enrich the database. Confirmed expense categorizations update vector centroids; confirmed PO line matches build cataloging history; brand disambiguations write to aliases.

*(For detailed code locations, use Graphify as directed in §1).*

## 5. Per-Phase Detail

### 5-0: Schema Infrastructure (Migrations) — Complete
- Add `merged_into_customer_id` and `is_merged` to `customer` table.
- Add `merged_into_supplier_id` and `is_merged` to `supplier` table.
- Add `merged_into_brand_id` and `is_merged` to `brand` table.
- Add `merged_into_group_id` and `is_merged` to `group` table.
- Create suggestion tables: `customer_duplicate_suggestion`, `brand_duplicate_suggestion`, etc.

Implemented in `database/migrations/20260924_01_jev_entity_merge_infrastructure.sql`:

- Adds soft-merge pointers and `is_merged` flags for customers, suppliers, brands, and groups, with consistency checks and lookup indexes.
- Adds pairwise duplicate-suggestion tables for those four entities. Each captures confidence, detection method, optional AI reasoning, review/merge audit fields, and prevents duplicate pairs regardless of ordering.

### 5-1: Brand & Group Management Feature — Partially Complete

#### As built (2026-09-25)

- [x] Added `EntityMergeService`, shared by Brands and Groups. It validates edit/merge requests, blocks already-merged records, takes transaction advisory locks, reassigns `part.brand_id` / `part.group_id`, preserves the retired values as aliases, and soft-merges the source records.
- [x] Added preview, single/bulk edit, duplicate scan, pending-suggestion list, confirmed merge, and dismiss endpoints under both `/api/brands` and `/api/groups`.
- [x] Added `brand_alias` and `group_alias` tables, lookup indexes, `brands:manage` / `groups:manage` permissions, and Admin/Manager grants in `20260924_02_brand_group_merge_management.sql`. The migration has been applied and checksum-verified on the local development database.
- [x] Added the permission-gated Brands and Groups management views. They show active master data with part counts, support inline/bulk edits, run an advisory PostgreSQL trigram scan, require a merge-preview confirmation, and never rewrite historical SKU prefixes.
- [x] Scan results are persisted to the phase-0 duplicate-suggestion tables. A completed merge marks the selected suggestion as merged and dismisses any stale pending suggestions involving the source entity.
- [x] Added focused service tests in `packages/api/tests/entityMergeService.test.js`.

#### Remaining before Phase 1 can be called complete

- [ ] Add a Jev adapter/configuration and use it to enrich or filter the trigram candidates. There is currently no Jev package, client, credential configuration, or existing TypeSafe AI integration in this repository, so no external AI call was invented. The live scan deliberately reports `pg_trgm` / `normalized_name` matches only and labels Jev enrichment as pending.
- [ ] An administrator must run the scans and manually review/merge the real brand and group duplicates. This session intentionally did not change production-like master data.

### 5-2: Customer & Supplier Merge Feature — Not Started
- **Backend:** Create `CustomerMergeService` (reassigns `invoice`, `customer_payment`, `customer_tag`, `draft_transaction`) and `SupplierMergeService` (reassigns `goods_receipt`, `purchase_order`). Include robust conflict detection (e.g., open drafts).
- **Frontend:** Add duplicate scan workflows and suggestions drawers to existing Customer/Supplier pages.
- **Execution:** Run the scan and merge duplicates.

### 5-3: Local-First Features — Not Started
- **C1 (Cross-Ref):** Add secondary SQL query in `powerSearchRoutes.js` using `REGEXP_REPLACE` to find parts with identical normalized part numbers. Display in a new "Interchangeable Part Numbers" section below Power Search results.
- **B3 (Cycle Count Priority):** Implement a local scoring formula (velocity × cost × days_since_count × adjustment_flag).
- **C2 (Reorder Engine):** Implement local velocity/lead-time formula.

### 5-4: Activate Jev Gates — Not Started
*Prerequisite: Stages 1 and 2 must be complete and data cleaned.*
- **B1 (Brand Gate):** Before inserting a new brand, evaluate against existing brands via Jev `Choice`. High confidence = return existing ID.
- **B2 (Group Predict):** New endpoint `GET /api/parts/predict-group?detail=<text>`. Auto-selects group in `PartForm.jsx` on blur.
- **C3/C4 (Cust/Supp Gate):** Gate `POST /api/customers` and `POST /api/suppliers` with `pg_trgm` + Jev `Noul`.
- **A4 (Part Gate):** `POST /api/parts` pre-checks Meilisearch candidates using Jev `Noul`. High confidence blocks insert (HTTP 409).

### 5-5: Inline Parsers — Not Started
- **A2 (Expense):** Update `expenseParserAI.js` to use Jev `Score` for ambiguity pre-screening, `Choice` for standard categories, and `Noul` for supplier alias confirmation.
- **A3 (Fitment):** Update `vehicleFitmentParserAI.js` to use `Choice` to instantly disambiguate fuel types and close make/model matches from `fuzzyResolveModel()`. Enable live typeahead in UI.
- **A5 (PO):** Update `purchaseOrderParserAI.js` to use Jev `Choice` instead of the generative LLM when disambiguating ambiguous PO line Meilisearch matches.

### 5-6: Background & Batch — Not Started
- **A1 (Dedup Worker):** Update `deduplicationEngine.js`. Add Jev `Noul` as a pre-filter *before* the free LLM call in `analyzeClusterWithAI()`.
- **B3/C2 (Jev Overlay):** Layer Jev `Score` on top of the local formulas built in Phase 3 for nuanced edge cases.

## 6. Explicitly Deferred

- **Full replacement of Free LLMs:** We are deliberately keeping the free LLMs (OpenRouter) as the fallback tier in the pipeline to provide explainability (reasoning sentences) for highly ambiguous cases.
- **Automatic Merging:** All merge operations require human confirmation. AI is advisory only.

## 7. Files Touched So Far

- `database/initial_schema.sql`
- `database/migrations/20260924_01_jev_entity_merge_infrastructure.sql`
- `database/migrations/20260924_02_brand_group_merge_management.sql`
- `packages/api/routes/brandRoutes.js`
- `packages/api/routes/groupRoutes.js`
- `packages/api/services/entityMergeService.js`
- `packages/api/tests/entityMergeService.test.js`
- `packages/web/src/components/layout/MainLayout.jsx`
- `packages/web/src/config/navigation.js`
- `packages/web/src/pages/EntityManagementPage.jsx`
- `docs/plans/2026-09-24_jev-ai-integration.md`

## 8. Verification Commands

- `docker compose exec -T backend node scripts/migrate.js status`
- `docker compose exec -T backend node scripts/migrate.js up`
- `docker compose exec -T backend node scripts/migrate.js verify`
- `npm run -w packages/api test -- --runInBand tests/entityMergeService.test.js`
- `docker compose exec -T backend npm test -- --runInBand` (full suite passed)
- `npm run -w packages/api lint` (passes with pre-existing warnings only)
- `npm run -w packages/web lint` (passes with pre-existing warnings only)
- `npm run -w packages/web build`

## 9. Change Log

- **2026-09-24** (Antigravity): Created initial plan document based on interactive planning session. Consolidated dependencies and rollout strategy.
- **2026-09-25** (Codex): Resumed the interrupted Phase 1 implementation, completed and verified the local merge-management workflow and migration, and documented the remaining Jev-adapter/manual-cleanup work.
