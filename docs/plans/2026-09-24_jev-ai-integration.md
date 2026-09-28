# Jev AI Integration & Data Cleanup — Developer Handoff

> **Forson Business Suite** | **Date:** 2026-09-24 | **Branch:** `master`
> **Status:** Phases 0–4 implemented. Jev gates remain configuration-gated and fail open until a deployment supplies `OPENROUTER_API_KEY` and enables Jev.

## 0. Status at a Glance

| Phase | Status | Reference |
|---|---|---|
| 0: Schema Infrastructure (Migrations) | **Complete** | §5-0 |
| 1: Brand & Group Management Feature (UI + AI Scan) | **Implementation Complete; Cleanup Pending** | §5-1 — Jev is configuration-gated; an administrator still needs to review real data |
| 2: Customer & Supplier Merge Feature (UI + AI Scan) | **Implementation Complete; Cleanup Pending** | §5-2 |
| 3: Local-First Features (Cross-ref, basic scoring) | **Implementation Complete** | §5-3 |
| 4: Activate Jev Gates (Brand, Group, Cust, Supp, Part) | **Implementation Complete; Configuration Pending** | §5-4 |
| 5: Inline Parsers (Expenses, Fitment, PO) | **Implementation Complete; Configuration Pending** | §5-5 |
| 6: Background & Batch (Dedup worker, nightly scoring) | **Implementation Complete; Configuration Pending** | §5-6 |

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
- [x] Refreshed the management UX with name/code search across both the directory and review queue, filtered select-all, clear selection state, and a shared merge review that accepts two or more selected records. Administrators choose the canonical record, see linked-part impact, and explicitly confirm before execution.
- [x] Scan results are persisted to the phase-0 duplicate-suggestion tables. A completed merge marks the selected suggestion as merged and dismisses any stale pending suggestions involving the source entity.
- [x] Added focused service tests in `packages/api/tests/entityMergeService.test.js`.
- [x] Added `packages/api/services/jevClient.js`: a server-side, typed Jev Noul client through OpenRouter's Decisions API using `typesafe/jev-1.13`. Scans use Jev to discard lower-confidence trigram candidates when the existing `OPENROUTER_API_KEY` is configured; malformed/unavailable Jev responses safely preserve the local advisory candidate rather than blocking cleanup. The UI reports whether Jev participated in the scan.
- [x] Added a durable, shared Jev duplicate-decision cache. It retains positive and negative Noul probabilities separately from the human-review suggestion workflow, and only reuses a decision when the unordered pair, normalized names/codes, configured model, and versioned prompt all still match.
- [x] Documented the deployment-only Jev configuration in `.env.example` and added contract/fallback tests in `packages/api/tests/jevClient.test.js`.

#### Remaining operational work

- [ ] Ensure `OPENROUTER_API_KEY` is present in the deployment environment, then enable `JEV_ENABLED=true`. The Decisions endpoint and pinned model are represented in `.env.example`; until the OpenRouter key is configured, scans continue to use their safe local `pg_trgm` fallback.
- [ ] An administrator must run the scans and manually review/merge the real brand and group duplicates. This session intentionally did not change production-like master data.

### 5-2: Customer & Supplier Merge Feature — Implementation Complete; Cleanup Pending

#### As built (2026-09-27)

- [x] Added the transaction-safe customer/supplier merge service and protected API workflows for directory listing, scan, suggestions, preview, merge, and dismissal.
- [x] Customer merges reassign invoices, payments, tags (with conflict-safe tag de-duplication), sales/AR/withholding records, and related historical references. Supplier merges reassign goods receipts, purchase orders, bills, AP records, freight references, and related historical references.
- [x] Active drafts referring to a selected party block the merge. Customer wallet records also block merging until balances are deliberately consolidated, avoiding accidental loss of financial state.
- [x] Added Jev-filtered trigram scanning with deterministic local fallback, preserving the human review requirement.
- [x] Added the duplicate-cleanup workflow to the existing Customers and Suppliers pages, including canonical selection, impact preview, explicit confirmation, and suggestion dismissal.
- [x] Added focused `partyMergeService` tests.

#### Remaining operational work

- [ ] An administrator must run the customer and supplier scans and manually review, merge, or dismiss real-data suggestions. Records with active drafts or customer wallets require their respective workflow/balance cleanup before they can merge.

### 5-3: Local-First Features — Implementation Complete

#### As built (2026-09-27)

- [x] **C1 (Cross-Ref):** Added the permission-protected `GET /api/power-search/interchangeable-parts?part_ids=…` lookup. It uses local PostgreSQL `REGEXP_REPLACE(LOWER(...))` normalization, ignores short identifiers and soft-deleted aliases, and returns only other active catalog records. `PowerSearchPage` requests it after the ordinary Meilisearch result and renders the "Interchangeable Part Numbers" section below the results.
- [x] **B3 (Cycle Count Priority):** Replaced the additive score with a local multiplier: count age × 30-day stock-out velocity × WAC/last-cost value × adjustment-since-last-count risk. Negative stock and an explicitly requested audit remain hard overrides. `20260927_01_cycle_count_priority_scoring.sql` seeds the cost weight (`0.01`) and adjustment multiplier (`2`), both editable under Cycle Count settings.
- [x] **C2 (Reorder Engine):** The existing local 90-day velocity/cover candidate engine now uses each part's delivered purchase-order history when available. Reorder quantity covers the greater of the existing 30-day floor or measured lead time plus seven days; it retains the 30-day floor when there is no trustworthy PO-to-receipt history. Pack-size and supplier-minimum rules remain out of scope.

#### Verification (2026-09-27)

- `npm run -w packages/api test -- --runInBand tests/analyticsPhase4.test.js tests/powerSearchInterchangeableParts.test.js tests/cycleCountPriority.test.js` — 23 tests passed.
- `npm run -w packages/api lint` — passes with the repository's existing warnings only.
- `npm run -w packages/web build` — passes.
- `docker compose exec -T backend node scripts/migrate.js up` and `verify` — migration applied locally and checksums verified.

### 5-4: Activate Jev Gates — Implementation Complete; Configuration Pending

#### As built (2026-09-27)

- [x] Added `JevGateService`, a shared fail-open real-time gate layer. It evaluates only bounded local candidate sets; provider errors, malformed answers, low confidence, and unavailable Meilisearch all preserve the existing workflow.
- [x] **B1 (Brand / Group Gate):** `POST /api/brands` and `POST /api/groups` first reuse a normalized exact active record without an AI call. Otherwise they present active local records as a Jev `Choice` set. A confidence at or above the respective `JEV_*_GATE_THRESHOLD` (default `0.90`) returns the canonical existing record with `existing: true` instead of creating another record. Choice requests use the Decisions API's required keyed `criteria` format.
- [x] **B2 (Group Predict):** Added permission-protected `GET /api/parts/predict-group?detail=<text>`. It makes a Jev `Choice` prediction from active groups. `PartForm.jsx` calls it on Part Detail blur only while Group is empty, displays the suggestion, and never overwrites an operator's explicit group choice.
- [x] **C3/C4 (Customer/Supplier Gates):** `POST /api/customers` and `POST /api/suppliers` first apply a bounded local `pg_trgm` candidate query, then Jev `Noul`. A high-confidence duplicate returns HTTP `409` with the existing record's identity; the respective pages show the returned message.
- [x] **A4 (Part Gate):** `POST /api/parts` first asks Meilisearch for at most eight active catalog candidates, then evaluates only those with Jev `Noul`. A high-confidence duplicate returns HTTP `409` with the candidate identity before any transaction or SKU sequence update.
- [x] Added configurable thresholds to `.env.example`: brand/group gate `0.90`, group prediction `0.80`, party local blocking `0.55`, party gate `0.90`, and part gate `0.92`.
- [x] Extended the Jev client contract for typed `Choice` requests and added focused client/gate tests.

#### Remaining operational work

- [ ] Set `OPENROUTER_API_KEY` and `JEV_ENABLED=true` in the deployment environment, then observe the thresholds against cleaned production master data. Without a configured Jev client, every Phase 4 gate is intentionally inactive and normal creation continues.

#### Follow-up: Operator-confirmed confidence band (implemented 2026-09-28)

- [x] Exact normalized Brand/Group matches and high-confidence Jev decisions retain automatic reuse/block behavior.
- [x] Added configurable mid-bands. The API returns an authenticated `confirmation_required` response with candidate identity, confidence, and model rather than silently using or blocking a record.
- [x] Added a shared confirmation prompt to Brand, Group, Customer, Supplier, and Part create flows. **Use existing** returns that record; **Create new** is accepted only after the backend re-evaluates the same candidate and confirms it remains in the mid-band, so a stale client cannot bypass a high-confidence decision.
- [x] Defaults: Brand/Group `0.80–0.89`, Customer/Supplier `0.80–0.89`, Part `0.80–0.91`; lower confidence preserves the normal workflow. `JEV_BRAND_CONFIRM_THRESHOLD`, `JEV_GROUP_CONFIRM_THRESHOLD`, `JEV_PARTY_CONFIRM_THRESHOLD`, and `JEV_PART_CONFIRM_THRESHOLD` configure the lower bounds.

### 5-5: Inline Parsers — Implementation Complete; Configuration Pending
- [x] **A2 (Expense):** `expenseParserAI.js` uses Jev `Score` to choose the normal or reasoning parser tier, `Choice` for bounded active-category classification, and `Noul` to confirm a locally plausible supplier/payee alias. Low-confidence, malformed, unavailable, or disabled decisions preserve the existing parser result.
- [x] **A3 (Fitment):** `vehicleFitmentParserAI.js` uses bounded Jev `Choice` requests for close model candidates and fuel type only after taxonomy validation. The Describe Fitment UI now refreshes reviewable suggestions after a 600 ms typing pause; stale requests cannot overwrite newer text.
- [x] **A5 (PO):** `purchaseOrderParserAI.js` uses Jev `Choice` across only the close Meilisearch matches. A high-confidence choice resolves an otherwise ambiguous structured line without a generative parsing call; all other lines retain the existing local/LLM fallback and editable ambiguity.

### 5-6: Background & Batch — Implementation Complete; Configuration Pending

#### As built (2026-09-28)

- [x] **A1 (Dedup Worker):** `DeduplicationEngine.analyzeClusterWithAI()` first sends its already-bounded cluster to Jev `Noul`. Only a very high-confidence all-distinct result (probability at or below `JEV_DEDUPE_PREFILTER_REJECT_THRESHOLD`, default `0.10`) skips the free group LLM and writes negative `JEV_PREFILTER` cache rows. Positive, uncertain, disabled, malformed, and unavailable decisions still use the free LLM, preserving explainable review groups.
- [x] **B3/C2 (Jev Overlay):** Added the expiring `jev_inventory_score` store and the nightly `JevInventoryScoringService`. It evaluates only a bounded number of locally eligible cycle-count and reorder candidates (`JEV_INVENTORY_SCORE_MAX_CANDIDATES`, default `50`) using Jev `Score`.
- [x] Cycle-count batch generation reads fresh confident scores only and applies a modest 0.90/1.15 multiplier to ordinary local priorities. Negative stock and explicit audit requests remain hard local overrides and are never sent to Jev.
- [x] The reorder board displays and ranks by an advisory 0–2 Jev urgency score when a fresh decision is available; absent/stale decisions are neutral (`1`), retaining the local reorder recommendation behavior.
- [x] The refresh is scheduled for 01:30 Manila/server time by default (`JEV_INVENTORY_SCORE_SCHEDULE`), ahead of the existing default 02:00 cycle-count batch. It is not scheduled at all without a configured Jev client.
- [x] Added focused service tests and migration-backed persistence. All provider/configuration failures are fail-open.

#### Remaining operational work

- [ ] Apply `20260928_01_jev_inventory_scoring.sql` with the normal migration workflow before enabling the API process that schedules the overlay.
- [ ] Set `OPENROUTER_API_KEY` and `JEV_ENABLED=true`, then observe the pre-filter rejection rate and score distribution before increasing the 50-candidate cap. The new batch behavior is intentionally dormant without those settings.

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
- `packages/api/services/jevClient.js`
- `packages/api/services/jevGateService.js`
- `packages/api/services/partyMergeService.js`
- `packages/api/services/cycleCountService.js`
- `packages/api/services/analytics/registry/sources.js`
- `packages/api/services/analytics/registry/metrics/inventory.js`
- `packages/api/services/analytics/boards/inventory.js`
- `packages/api/routes/powerSearchRoutes.js`
- `packages/api/routes/partyMergeRoutes.js`
- `packages/api/tests/partyMergeService.test.js`
- `packages/api/tests/entityMergeService.test.js`
- `packages/api/tests/jevClient.test.js`
- `packages/api/tests/jevGateService.test.js`
- `.env.example`
- `packages/web/src/components/layout/MainLayout.jsx`
- `packages/web/src/config/navigation.js`
- `packages/web/src/pages/EntityManagementPage.jsx`
- `packages/web/src/pages/PartyMergePage.jsx`
- `packages/web/src/pages/CustomersPage.jsx`
- `packages/web/src/pages/SuppliersPage.jsx`
- `packages/web/src/components/forms/PartForm.jsx`
- `packages/web/src/pages/PowerSearchPage.jsx`
- `packages/web/src/pages/SettingsPage.jsx`
- `database/migrations/20260927_01_cycle_count_priority_scoring.sql`
- `database/migrations/20260928_01_jev_inventory_scoring.sql`
- `packages/api/services/deduplicationEngine.js`
- `packages/api/services/jevInventoryScoringService.js`
- `packages/api/services/cycleCountService.js`
- `packages/api/services/analytics/registry/sources.js`
- `packages/api/services/analytics/registry/metrics/inventory.js`
- `packages/api/services/analytics/boards/inventory.js`
- `packages/api/tests/jevInventoryScoringService.test.js`
- `packages/api/tests/powerSearchInterchangeableParts.test.js`
- `packages/api/tests/cycleCountPriority.test.js`
- `docs/plans/2026-09-24_jev-ai-integration.md`

## 8. Verification Commands

- `docker compose exec -T backend node scripts/migrate.js status`
- `docker compose exec -T backend node scripts/migrate.js up`
- `docker compose exec -T backend node scripts/migrate.js verify`
- `npm run -w packages/api test -- --runInBand tests/entityMergeService.test.js`
- `npm run -w packages/api test -- --runInBand tests/jevClient.test.js tests/entityMergeService.test.js`
- `npm run -w packages/api test -- --runInBand tests/jevClient.test.js tests/jevGateService.test.js`
- `npm run -w packages/api test -- --runInBand tests/deduplicationEngineJev.test.js tests/analyticsPhase4.test.js tests/cycleCountPriority.test.js tests/jevInventoryScoringService.test.js` (25 tests passed)
- `docker compose exec -T backend node scripts/migrate.js up` and `verify` (applied and checksum-verified `20260928_01_jev_inventory_scoring.sql` locally)
- `npm run -w packages/web build` (passes; existing chunk-size/dynamic-import warnings only)
- Live Jev smoke tests (2026-09-25): a fictional duplicate-company payload returned `typesafe/jev-1.13-20260917` with Noul probability `0.96`. OpenRouter's official tutorial payload also returned valid Noul (`0.96`), Choice (`payments`, confidence `0.64`), and Score (`1.99`) answers from TypeSafe. No system master data was sent externally.
- Duplicate-scan upsert regression (2026-09-25): PostgreSQL `EXPLAIN` successfully compiled the explicit unordered-pair conflict targets for both brand and group suggestion tables; this fixes the prior `ON CONFLICT DO UPDATE requires inference specification` 500.
- `docker compose exec -T backend npm test -- --runInBand` (full suite passed)
- `npm run -w packages/api lint` (passes with pre-existing warnings only)
- `npm run -w packages/web lint` (passes with pre-existing warnings only)
- `npm run -w packages/web build`

## 9. Change Log

- **2026-09-24** (Antigravity): Created initial plan document based on interactive planning session. Consolidated dependencies and rollout strategy.
- **2026-09-25** (Codex): Resumed the interrupted Phase 1 implementation, completed and verified the local merge-management workflow and migration, added the OpenRouter Jev Noul duplicate-scoring adapter, and smoke-tested it successfully with a fictional payload.
- **2026-09-25** (Codex): Modernized the Brands and Groups manager with searchable records and suggestions plus a safeguarded multi-record merge review flow; production web build and focused merge/Jev tests passed.
- **2026-09-25** (Codex): Added fingerprinted persistent Jev duplicate-decision caching to avoid repeat Decisions API calls on unchanged pairs while automatically invalidating on input, model, or prompt changes.
- **2026-09-27** (Codex): Implemented Phase 2 customer and supplier duplicate cleanup: Jev-assisted scans, explicit merge review, transactional historical-reference reassignment, and safeguards for active drafts and customer wallets. Real-data review remains an administrator task.
- **2026-09-27** (Codex): Implemented Phase 3 local-first workflows: exact normalized part-number cross-references in Power Search, cost/velocity/age/adjustment-based cycle-count priority, and lead-time-aware reorder cover using delivered PO history with a conservative 30-day fallback.
- **2026-09-27** (Codex): Implemented Phase 4 real-time Jev gates: bounded local candidate selection, typed Choice/Noul validation, brand reuse, group prediction, customer/supplier duplicate blocking, and part duplicate blocking. All gates are configuration-gated and fail open on unavailable AI/search services.
- **2026-09-28** (Codex): Corrected Jev Choice requests to use the Decisions API's keyed `criteria` contract after live HTTP 400 responses, and made exact normalized brand/group matches resolve locally before bounded AI evaluation. This prevents exact duplicates from reaching database uniqueness errors and shows the Part form's existing-record feedback.
- **2026-09-28** (Codex): Implemented Phase 5 inline Jev decisions: expense ambiguity/category/payee-alias checks, fitment fuel/model choices with debounced live suggestions, and PO catalog candidate choices. All are configuration-gated and fail open to the established local/generative paths.
- **2026-09-28** (Codex): Implemented Phase 6 background Jev overlays: conservative Noul negative pre-filtering before free deduplication LLM calls, bounded nightly Score refreshes for cycle-count and reorder candidates, short-lived advisory score persistence, and hard local safety overrides.
