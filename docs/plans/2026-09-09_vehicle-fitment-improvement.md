# Vehicle Fitment / Application — PRD & Developer Handoff

> **Forson Business Suite** | **PRD-FBS-FIT-001** | **Version:** 1.0
> **Date:** 2026-09-09 | **Branch:** `parts-fitment-improvement` | **PR:** [#181](https://github.com/kent1l/forson-business-suite/pull/181)
> **Status:** Phases 0, 1 (1a + 1b), 2, and 3 built and verified on the dev stack. Phases 4 and 5 not started.

---

## 0. Status at a Glance

Read this first. It is the only section that changes often — update it as phases land.

| Item | Status | Reference |
|---|---|---|
| Schema redesign — engine as global master data | **Done** | §7, Phase 0 |
| Data integrity fixes (year constraint, indexes, rename-sync triggers) | **Done** | Phase 2 |
| Unified taxonomy creation UX (`ApplicationCascadeForm`, engine-only mode) | **Done** | Phase 3 |
| Engine `displacement_liters` / `fuel_type` fields | **Done** | Phase 1a |
| Taxonomy seeded with real reference data (20 makes, 155 models, 270 engines, 400 fitment mappings) | **Done** | Phase 1b |
| Pre-existing duplicate-casing makes (Toyota/TOYOTA, Isuzu/ISUZU, "KIA "/KIA) | **Fixed** | §9.1 |
| Near-duplicate engine codes (`1TR` vs `1TR-FE`, etc.) | **Known, not fixed** — needs the merge tool | §9.2 |
| Vehicle-based part search (free text + structured filters) | **Done** | Phase 4 |
| AI-assisted fitment entry ("describe it, review it, save it") | **Not started** | Phase 5 |
| Taxonomy dedupe/merge tool | **Deferred** | §10 |
| Bulk CSV import/export of part-to-vehicle mappings | **Deferred** | §10 |
| All 6 new migrations applied on dev DB (`forson_db`) | **Done, uncommitted in git as of this doc** | §8 |

**Ready for next phase?** Yes — Phase 4 depends on Phase 0 (schema), Phase 1 (seeded taxonomy), and Phase 2 (index), all of which are done. Phase 5 depends mainly on Phase 1's seeded taxonomy for AI grounding quality, also done. Either phase can be picked up next; there's no blocker.

---

## 1. For a New Session or Agent Picking This Up

This document is the durable source of truth — the interactive plan-mode file this work originated from lives outside the repo (`~/.claude/plans/`) and will not be available to you. Read this document fully before writing any code.

**Before starting:**
1. Run `graphify query "vehicle fitment"` (or `graphify explain "vehicle fitment"`) to get a scoped view of the current code structure — the schema and routes have changed significantly since the last time graphify's wiki/report was written, so prefer a fresh query over trusting old wiki pages about this feature.
2. Call the `hindsight` MCP's `recall` tool with a query like `"vehicle fitment engine schema architecture"` and `tags: ["vehicle-fitment", "forson-business-suite"]` — this retrieves the non-obvious implementation decisions and gotchas that aren't fully spelled out in code comments (see §11 for what's stored there).
3. Check `git log --oneline -- database/migrations/` for anything after `20260909_07_seed_vehicle_taxonomy.sql` to confirm this document's "Status at a Glance" table is still current — if migrations exist that aren't listed in §8, this document is stale; update it before relying on it.

**When you finish a phase or make a non-obvious decision:**
1. Update §0's status table and add a "Phase N — As Built" section (following the pattern of §12–§15) before ending your session.
2. Call `hindsight`'s `sync_retain` for any new architectural decision, gotcha, or rationale that isn't obvious from reading the diff alone (see the retain-to-hindsight skill in this repo's `.claude/skills/` for the exact workflow). Do not retain things that are simply discoverable by reading the code or this doc.
3. Run `graphify update .` so the next session's graph queries reflect your changes.

---

## 2. Business Objective & Operational Value

### Problem
Forson Business Suite records which vehicles a part fits, but the original schema and UX didn't match how aftermarket parts retail actually works:
- Engine was modeled as a property of one vehicle model, so a physical engine used across many makes/models (e.g. Mitsubishi's `4D56`, used in the L300, Strada, Adventure, and Isuzu Bison) had to be recreated as a separate row per model — tedious and incomplete by construction.
- There was no way to search parts by vehicle at all — year was captured but never queried, and there were no make/model/engine filters anywhere.
- Two inconsistent UX paths existed for creating a new make/model/engine: a safe cascading combobox on the admin taxonomy page, and raw, unvalidated text inputs on the day-to-day part-editing flow — with the weaker path being the one staff actually used most.
- The taxonomy itself was purely reactive: it only contained whatever had already been fitted to a part, rather than a real reference list of the vehicles this business deals in.
- Missing data-integrity constraints (no `year_start <= year_end` check) and a Meilisearch/mobile-catalog sync gap on taxonomy renames.

### Solution
Restructure engine into shared, global master data with a vehicle↔engine cross-reference that builds itself as a side effect of normal fitment entry; seed the taxonomy with a real reference list up front; unify the creation UX around one safe pattern everywhere; and (next) add real vehicle-based search and AI-assisted natural-language fitment entry.

---

## 3. Decisions Already Taken (do not relitigate)

These were discussed and settled with the business owner across several planning sessions. Don't re-ask about them.

- **Engine codes are fully global**, not scoped per make or per model — matches how real aftermarket supplier catalogs work.
- **Engine-only fitment is a first-class, primary entry path** (not an edge case) — staff frequently know "this fits a 4D56" without knowing or caring which vehicles use that engine.
- **The vehicle↔engine cross-reference (`vehicle_engine_fitment`) builds itself automatically** as staff link parts to full make+model+engine fitments — no separate maintenance workflow was wanted or built.
- **A part-level `is_universal` flag** exists for genuinely generic items (hose clamps, fasteners) that should skip fitment entirely and always surface in vehicle-filtered search.
- **Displacement and fuel type are genuinely useful, independently-referenced search dimensions** in this retail vertical (fuel type is often asked before make/model; displacement is the common fallback when the exact engine code isn't known) — not just a naming-duplication cleanup. This reversed an earlier "skip structured engine fields" recommendation once discussed further.
- **Vehicle-based search must support natural mixed queries** ("oil filter hilux 2015") in the existing single search box, not only guided dropdown filters — both are wanted, see Phase 4.
- **AI-assisted fitment entry should reuse this app's existing AI infrastructure** (`packages/api/services/ai/`, e.g. `expenseParserAI.js`) rather than building new AI plumbing — see Phase 5.
- **The vehicle taxonomy seed data came from the business owner directly** (a real reference table of makes/models/engines relevant to their market — Philippine aftermarket, ~20 makes from Toyota to heavy-truck brands like Hino and Mitsubishi Fuso), reviewed for internal consistency before loading (3 conflicting engine-code rows were found and resolved with the owner — see §9.2).
- **Taxonomy dedupe/merge tooling and bulk part-to-vehicle CSV import are explicitly deferred** — see §10 for why and what would trigger revisiting them.

---

## 4. Real-World Domain Model (why this isn't just a UX problem)

If you're new to this feature, read this section before touching the schema. It's the source of the biggest design decision in this project.

In aftermarket parts retail, a "fitment" isn't one rigid vehicle row — it exists at varying levels of specificity:
1. **Full vehicle fitment** — Make + Model + Engine + Year range (most precise).
2. **Model-level, engine-agnostic** — "fits all Hilux variants 2005–2015 regardless of engine."
3. **Engine-only, vehicle-agnostic** — "fits any vehicle using a 4D56 engine." A fuel injector or turbo cataloged by engine code alone genuinely doesn't care what vehicle it's bolted into.
4. **Universal/generic** — fits essentially anything (hose clamps, generic fasteners) — not tied to vehicle taxonomy at all (`part.is_universal`).

The pre-existing schema only supported tier 1. Phase 0 (below) reshapes the schema to support all four tiers without forcing staff to pick a tier explicitly — it falls out naturally from which fields they fill in.

---

## 5. Architecture — Current Schema (Post Phase 0/1a)

```
vehicle_make (make_id PK, make_name UNIQUE)
vehicle_model (model_id PK, make_id FK, model_name, UNIQUE(make_id, model_name))
engine (engine_id PK, engine_code UNIQUE, notes, displacement_liters numeric(4,2), fuel_type text)
  -- fuel_type CHECK: 'diesel' | 'gasoline' | 'hybrid' | 'mild_hybrid' | 'electric' | 'other' | NULL
vehicle_engine_fitment (id PK, model_id FK, engine_id FK, year_start, year_end, UNIQUE(model_id, engine_id))
  -- which models are known to use which engines, and when. Auto-derived (see §6) and seeded (Phase 1b).
application (application_id PK, make_id FK NULL, model_id FK NULL, engine_id FK NULL)
  -- at least one of the three must be set (CHECK constraint); any combination is valid.
  -- uniqueness enforced via 7 partial unique indexes (one per specificity tier), NOT a single
  -- UNIQUE(make_id, model_id, engine_id) -- Postgres treats NULLs as distinct per-column in a
  -- multi-column unique constraint, which would silently allow duplicate engine-only rows.
part_application (part_app_id PK, part_id FK, application_id FK, year_start, year_end,
                   UNIQUE(part_id, application_id), CHECK(year_start <= year_end))
part (..., is_universal boolean DEFAULT false)
```

`application_view` joins the above for display (`make`, `model`, `engine` name columns alongside the `*_id` columns).

---

## 6. The Auto-Derived Vehicle↔Engine Map

`packages/api/routes/partApplicationRoutes.js`'s `deriveVehicleEngineFitment()` runs on every `POST /parts/:partId/applications` and `PUT /part-applications/:partAppId`. Whenever the linked `application` has both a concrete `model_id` and `engine_id`, it upserts into `vehicle_engine_fitment`, widening the year range with `LEAST`/`GREATEST` (which skip `NULL` arguments in Postgres, so this correctly widens even when one side has no year data yet — do not wrap these in a `CASE WHEN ... IS NULL` guard, that was tried and it breaks the widening entirely).

This means every time staff fitment a part to a full make+model+engine combo — which they do anyway for precise fitments — the system learns "this engine appears in this model" for free. Phase 1b's seed data pre-populates this table so the cross-reference is rich from day one instead of only after months of accumulated fitment entries.

---

## 7. Phase 0 — Schema Redesign — As Built

Migrations: `20260909_02_vehicle_engine_master_data.sql`, `20260909_03_fitment_integrity_and_taxonomy_sync.sql` (also covers Phase 2), `20260909_04_parts_view_add_is_universal.sql`.

- Created the global `engine` table; transformed the old per-model `vehicle_engine` table into `vehicle_engine_fitment`, preserving all existing data (no loss — confirmed row counts match pre/post migration).
- Relaxed `application.make_id/model_id/engine_id` to independently nullable with a `CHECK` requiring at least one set, and replaced the old single `UNIQUE(make_id, model_id, engine_id)` with 7 partial unique indexes (`application_full_unique_idx`, `application_make_model_unique_idx`, `application_make_engine_unique_idx`, `application_model_engine_unique_idx`, `application_make_only_unique_idx`, `application_model_only_unique_idx`, `application_engine_only_unique_idx`).
- Added `part.is_universal boolean DEFAULT false`; wired a checkbox into `PartForm.jsx` that hides the Applications section when checked.
- Fixed every backend file that referenced the now-dropped `vehicle_engine` table: `applicationRoutes.js`, `applicationSearchRoutes.js`, `partApplicationRoutes.js`, `partRoutes.js`, `dataUtilsRoutes.js`, `meili-outbox-worker.js`, `meili-app-listener.js`, `meili-listener.js`, `services/catalogSyncService.js`, `services/partMergeService.js`.

**Verified:** partial unique indexes reject duplicate engine-only rows; the `CHECK` constraint rejects all-NULL rows; existing application data (21 rows) preserved with correct engine remapping.

---

## 8. Phase 1 — As Built

### 1a. Engine displacement + fuel type

Migration: `20260909_05_engine_displacement_fuel_type.sql`.

- Added `displacement_liters numeric(4,2)` and `fuel_type text` (CHECK: `diesel`/`gasoline`/`hybrid`/`mild_hybrid`/`electric`/`other`) to `engine`.
- Backfilled 7 of the 12 pre-existing engine rows where a confident cross-reference existed (`C240`→2.4L diesel, `1.2`→1.2L gasoline, `F6A`→0.66L gasoline, `4D55/56/65`→2.5L diesel, `1TR`→2.0L gasoline, `1NRFE`→1.3L gasoline, `1.5`→1.5L gasoline); left 5 NULL rather than guess (`6D20`, `SD22`, `4GE1`, `KC2700`, `ITR`).
- `packages/api/routes/applicationRoutes.js`: `resolveEngine()` accepts and persists `displacement_liters`/`fuel_type` **only when creating a new engine row** — editing an existing engine's specs is a deliberate separate action via the new `PUT /engines/:id` endpoint, not a side effect of linking a fitment.
- `packages/web/src/components/applications/ApplicationCascadeForm.jsx`: added Displacement/Fuel Type inputs, shown once an engine code is entered. When an *existing* engine is selected and its specs are edited, the form calls `PUT /engines/:id` itself before submitting the application payload.

### 1b. Taxonomy seeded with real reference data

Migrations: `20260909_06_dedupe_preexisting_make_casing.sql`, `20260909_07_seed_vehicle_taxonomy.sql`.

- Loaded a 387-row reference table (provided directly by the business owner) covering 20 makes — Toyota, Mitsubishi, Suzuki, Ford, Nissan, Honda, Isuzu, Hyundai, Kia, Chevrolet, Foton, JAC, BYD, MG, Geely, Chery, Chana, Mitsubishi Fuso, Hino, and UD Trucks/Nissan Diesel — covering light vehicles through heavy trucks, matching the Philippine aftermarket market this business serves.
- Final counts: 20 makes, 155 models, 270 engines, 400 `vehicle_engine_fitment` rows.
- The source CSV had 3 internal inconsistencies (same engine code, different displacement/fuel type across rows) — resolved with the owner before loading, not guessed: `2GD-FTV`→2.4L diesel, `15E4E`→1.5L gasoline, `JLH-3G15TD`→mild_hybrid (same 1.5L displacement, treated as a mild-hybrid variant of the base engine).
- The seed migration matches existing makes/models/engines **case-insensitively** and never overwrites an existing row's attributes — purely additive.

See §9 for two data-quality issues surfaced and how each was handled.

---

## 9. Data Quality Issues Found During Seeding

### 9.1 Pre-existing duplicate-casing makes (fixed)

Before Phase 3's normalization shipped, the database had already accumulated case-variant duplicate makes, each with real linked models and parts on both sides:

| Duplicate pair | Kept (canonical) | Merged away |
|---|---|---|
| `Toyota` (id 2, 1 model: Tamaraw, 0 part links) | `TOYOTA` (id 12, 4 models incl. Vios with 3 part links) | id 2 |
| `Isuzu` (id 23, 1 model: DMAX, 1 part link) | `ISUZU` (id 3, 3 models, 3 part links) | id 23 |
| `KIA ` (id 10, trailing space, 1 model: Bongo, 1 part link) | `KIA` (id 22, 1 model: Carnival, 1 part link) | id 10 |

`20260909_06_dedupe_preexisting_make_casing.sql` reassigns each duplicate's `vehicle_model` rows and any `application` rows pointing at the old `make_id` directly, then deletes the now-empty duplicate row. This was a **narrow, one-time fix for these 3 known duplicates**, not the general taxonomy merge tool (still deferred, §10) — don't generalize this migration's approach into a reusable pattern without building proper conflict handling (name collisions, engine merging, etc.).

### 9.2 Near-duplicate engine codes (known, not fixed)

A few old ad-hoc engine entries are near-duplicates of new canonical codes from the seed data — same physical engine, different string, both now live in the database:

| Old code (pre-existing) | New canonical code (from seed) | Model |
|---|---|---|
| `1TR` | `1TR-FE` | Toyota Innova / Hi-Ace |
| `1NRFE` | `1NR-FE` | Toyota Vios |
| `1.5` | `2NR-FE` | Toyota Vios |

These were **deliberately left unmerged** — merging engine codes safely (reassigning `application`/`part_application` references, handling the partial unique index constraints) is exactly the deferred taxonomy merge tool's job (§10), not something to improvise during a data seed. If you build that tool, this table is your first real test case.

---

## 10. Explicitly Deferred

- **Taxonomy dedupe/merge tool** (admin UI to merge duplicate makes/models/engines, e.g. §9.2's table). Revisit if duplicate volume becomes a recurring pain point, or when someone needs to clean up §9.2's known duplicates.
- **Bulk CSV import/export of part-to-vehicle mappings** (not the taxonomy itself, which is now seeded — this is bulk *linking specific inventory parts* to vehicles). No confirmed recurring bulk-data source (e.g. supplier fitment guides) exists yet. If pursued, it belongs in `packages/api/routes/dataUtilsRoutes.js`'s `ENTITY_CONFIG` pattern.

---

## 11. What's in Hindsight (don't duplicate here, don't skip recalling it)

The following architectural rationale and gotchas were retained to the `hindsight` MCP rather than only living in this document — call `recall` (tags: `vehicle-fitment`, `forson-business-suite`) before doing further work in this area:

- The `LEAST`/`GREATEST` NULL-handling gotcha in `deriveVehicleEngineFitment()` (§6).
- The rationale for partial unique indexes over a single `UNIQUE` constraint (§5, §7).
- The full pre-existing duplicate-make resolution reasoning (§9.1) and the known near-duplicate engine list (§9.2).
- The fuel-type taxonomy (`diesel`/`gasoline`/`hybrid`/`mild_hybrid`/`electric`/`other`) and why it isn't just diesel/gasoline.

---

## 12. Phase 2 — Data Integrity — As Built

Migration: `20260909_03_fitment_integrity_and_taxonomy_sync.sql` (shared with part of Phase 0's follow-through).

- `part_application` gained `CHECK (year_start <= year_end)` (existing violating rows backfilled first) and an index on `(year_start, year_end)`.
- New `notify_application_change()` helper plus `AFTER UPDATE` triggers on `vehicle_make`, `vehicle_model`, and `engine` fire the same Meilisearch/`catalog_change_log` sync that already existed for `application`/`part_application` changes — previously, renaming a make/model/engine silently went stale in search and the mobile offline catalog.
- `packages/web/src/pages/PartApplicationManager.jsx` and the corresponding backend routes in `partApplicationRoutes.js` gained `applications:view`/`applications:edit` permission gating, matching `ApplicationsPage.jsx` (previously ungated on both ends).
- Deleted the stray dead file `ApplicationSearchCombobox.jsx.new`.

**Verified:** year-range violations rejected with a clean 400; renaming an engine or make fires a `meili_app_sync` notification (confirmed via `LISTEN`).

---

## 13. Phase 3 — Unified Taxonomy UX — As Built

- Extracted `packages/web/src/components/applications/ApplicationCascadeForm.jsx` from `ApplicationsPage.jsx`'s inline `ApplicationForm` — a cascading Make→Model→Engine combobox with case-insensitive existing-match detection ("Create new X" only offered when nothing matches).
- Added an **"Engine only (fits any vehicle with this engine)"** checkbox mode — hides Make/Model, searches/creates against the global `engine` list directly. This is the primary new entry path for the common "I only know the engine code" case.
- Retired `NewApplicationModal.jsx` (raw, unvalidated text inputs) — `PartApplicationManager.jsx`'s "+ New" flow now opens the same shared cascading form.
- Backend `resolveMake`/`resolveModel`/`resolveEngine` helpers in `applicationRoutes.js` do case-insensitive, whitespace-trimmed get-or-create, closing the dedupe gap at the API layer (not just the UI) — this is what a Phase 5 AI parser or any future bulk import would also go through.

**Not built:** staged/pre-save fitment entry (adding fitments to a part before it's first saved) — this was scoped in the original plan but deprioritized as a nice-to-have; `PartApplicationManager`/`PartForm.jsx`'s Applications section still requires the part to exist first. Pick this up if it becomes a real friction point.

**Verified:** end-to-end in-browser (Playwright against the live dev stack) — engine-only creation, cascading combobox, and the shared "+ New" modal all render and function correctly with no console errors beyond a pre-existing, unrelated branding-logo 404.

---

## 14. Phase 4 — Vehicle-Based Part Search — As Built

### 4a. Free-text mixed queries — verified complete from Phase 0/2

`searchable_applications` already contained make/model/engine text at all 3 primary sync sites (`partApplicationRoutes.js`, `partRoutes.js`, `meili-outbox-worker.js`) via `withYearTokens()`. Year tokens expand the full range (e.g. 2010–2020 → individual year tokens `2010 2011 ... 2020`, capped at 40 tokens).

Gap fixed in this phase: `meili-listener.js` was using a boundary-only year approach (concatenating `year_start` and `year_end` as raw strings). Upgraded to import `withYearTokens` from `helpers/vehicleFitmentSearch.js` and fetch `application_year_ranges` separately, making all 4 sync sites consistent. Mid-range years (e.g. searching "2015" for a 2010–2020 part) now work across all sync paths.

### 4b. Structured filters — new in this phase

**Backend (`packages/api/routes/powerSearchRoutes.js`):**
- New optional query params: `make_id`, `model_id`, `engine_id` (integers), `year` (integer).
- When any vehicle dimension is set, a DB query runs first to collect candidate `part_id` values:
  - `engine_id` matches both direct `application.engine_id` rows AND applications linked to any model that uses that engine via `vehicle_engine_fitment` (so a part fitted "engine-only" surfaces when searching by model that has that engine).
  - All specified dimensions are AND-ed together.
  - `year` filters `part_application` rows by `year_start ≤ year ≤ year_end`, NULLs allowed.
  - `is_universal = true` parts always union in, with status filter applied.
- Results are intersected with Meilisearch's ranked output for keyword relevance. Vehicle-only (no keyword) bypasses the ranking and returns the vehicle set directly (up to 200).
- `is_universal` added to `filterableAttributes` in `meilisearch-setup.js`.

**Frontend:**
- New shared `packages/web/src/components/VehicleFilterBar.jsx`:
  - Cascading Make → Model → Engine selects (Model disabled until Make selected; Engine disabled until Model selected).
  - Year free-text input.
  - Compact mode (`compact` prop) for the POS sidebar.
  - "Clear" button appears when any filter is set.
  - Calls `onChange({ make_id, model_id, engine_id, year })` (nulls for unset).
- `PowerSearchPage.jsx`: VehicleFilterBar wired below search bar; search triggers on keyword OR vehicle filter change; all vehicle params passed to `/power-search/parts`.
- `POSPage.jsx`: VehicleFilterBar (compact) wired below the search row; same vehicle param forwarding.

**Verified:** Node syntax check (`--check`) passes on all modified API files; `vite build` succeeds with no errors.

---

## 15. Phase 5 — AI-Assisted Fitment Entry — Not Started

Goal: staff type a natural description ("Fits Toyota Hilux 2005-2015 2.5L & 3.0L Diesel, also fits Fortuner same years") and get back a pre-filled, editable list of structured fitment rows to confirm.

- New feature module `packages/api/services/ai/features/vehicleFitmentParserAI.js`, following the exact pattern of `expenseParserAI.js`/`partDeduplicationAI.js` (`llmClient.executeWithPool`, `wrapJsonInstruction`/`sanitizeInput`, schema-validated JSON output). Ground it with existing `vehicle_make`/models/`engine` lists so it prefers matching existing IDs over inventing near-duplicates.
- New endpoint `POST /applications/parse-fitment-text` in `partApplicationRoutes.js` — proposes only, never writes.
- Frontend: a "Describe fitment" box in `PartApplicationManager.jsx`, rendering parsed candidates as editable rows via `ApplicationCascadeForm` before a single "Save" commits through the normal endpoints.
- **Safety-critical:** validate any `make_id`/`model_id`/`engine_id` the model claims to have matched actually exists before using it — never trust an LLM-returned ID directly into a write.
- Phase 1b's seeded taxonomy makes this feature's grounding data rich from day one — most fitment descriptions should match existing entries rather than the model needing to propose new ones.

---

## 16. Files Touched So Far

- Migrations: `database/migrations/20260909_02` through `20260909_07` (6 files).
- `packages/api/helpers/vehicleFitmentSearch.js` (new) — shared year-token flattening for `searchable_applications`.
- `packages/api/routes/applicationRoutes.js`, `partApplicationRoutes.js`, `applicationSearchRoutes.js`, `partRoutes.js`, `dataUtilsRoutes.js`.
- `packages/api/meili-outbox-worker.js`, `meili-app-listener.js`, `meili-listener.js`.
- `packages/api/services/catalogSyncService.js`, `partMergeService.js`.
- `packages/web/src/components/applications/ApplicationCascadeForm.jsx` (new, replaces `NewApplicationModal.jsx`, deleted).
- `packages/web/src/pages/ApplicationsPage.jsx`, `PartApplicationManager.jsx`, `packages/web/src/components/forms/PartForm.jsx`.
- Deleted: `ApplicationSearchCombobox.jsx.new` (stray dead file), `NewApplicationModal.jsx`.

## 17. Verification Commands

```bash
# Apply pending migrations
docker exec forson_backend_dev node scripts/migrate.js status
docker exec forson_backend_dev node scripts/migrate.js up

# Confirm taxonomy counts
docker exec forson_db psql -U postgres -d forson_business_suite -c \
  "SELECT (SELECT count(*) FROM vehicle_make) AS makes, (SELECT count(*) FROM vehicle_model) AS models, \
          (SELECT count(*) FROM engine) AS engines, (SELECT count(*) FROM vehicle_engine_fitment) AS fitments;"

# Frontend build check
docker exec forson_frontend_dev sh -c "cd /app && npx vite build"
```

Use the `run` skill for a full in-browser pass before shipping any further phase — see the earlier sessions' Playwright-against-live-stack approach (via a `mcr.microsoft.com/playwright` container on `--network host`, since the sandbox host lacks browser system libraries and has no passwordless sudo to install them) if `chromium-cli` isn't available.

## 18. Change Log

- **2026-09-09** — Phases 0, 1 (1a+1b), 2, 3 built, verified end-to-end (API + in-browser), and documented. Pre-existing duplicate-casing makes fixed; near-duplicate engine codes flagged for the future merge tool. Not yet committed to git as of this document's creation — confirm `git status` before assuming this work is on the remote branch.
- **2026-09-10** — Phase 4 built and verified (build passes). Files changed: `packages/api/routes/powerSearchRoutes.js` (vehicle filter params + DB pre-filter), `packages/api/meili-listener.js` (upgraded to `withYearTokens` full expansion), `packages/api/meilisearch-setup.js` (added `is_universal` to filterableAttributes), `packages/web/src/components/VehicleFilterBar.jsx` (new), `packages/web/src/pages/PowerSearchPage.jsx` (wired VehicleFilterBar), `packages/web/src/pages/POSPage.jsx` (wired VehicleFilterBar compact). No migrations required.
