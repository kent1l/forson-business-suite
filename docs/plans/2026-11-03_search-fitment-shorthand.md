# Search Fitment Shorthand — Implementation Record

> Forson Business Suite | Date: 2026-11-03 | Starting revision: `e8d17f1`
> Continues [Applications Grouped by Model](./2026-11-03_applications-model-grouping.md).

## Status at a Glance

| Work | Status |
|---|---|
| Trace existing search displays and data sources | Done: six web surfaces used plain labels or inconsistent formatting |
| Structured search fitments | Done: additive PostgreSQL `fitment_rules` in Power Search and Parts responses |
| Shared shorthand display | Done: POS, invoicing, Power Search, Parts, goods receipt, purchase orders |
| Verification | Done: 16 disposable PostgreSQL/API scenarios, 15 web test files, six-page browser contracts at 390px/1280px, lint/build |
| Deployment | Not performed; deploy frontend/backend together; no migration or reindex required |

## For a New Session or Agent Picking This Up

1. Read `AGENTS.md`, check `git status`/`git log`, and confirm this status against the current source. This record describes uncommitted implementation changes verified locally.
2. Run `graphify query "PartFitmentText searchFitmentText powerSearchRoutes" --budget 1800` for current relationships.
3. Recall Hindsight with `forson-business-suite`, `vehicle_fitment`, and `search-fitment-shorthand` for the owner's display preference. This document remains the durable source if memory is unavailable.
4. Re-run the commands below; the PostgreSQL fixture creates/drops only an owned disposable database using a schema-only dump and synthetic data.
5. Update this record after changes, retain non-obvious decisions, and run `graphify update .`.

## Objective and Decisions

The owner wants vehicle fitments already displayed in part-search results to reuse the applications page's shorthand method. All six existing web search consumers now use one display component and formatter. Example: `Isuzu Elf (4BC2/E1 · Chassis: NKR · 90-95 · Manual)`.

The display hierarchy is fitting position → make → model → engine → chassis → years → generation → variant → drivetrain → transmission → fuel → displacement → market. Position is shown before the make, for example `Front Left · Toyota Hilux (2KD-FTV)`. Entries sort by position, make/model, then naturally by engine/chassis and remaining details; absent values sort last and stay omitted. Each position retains its own vehicle groups so different positions cannot share an ambiguous shorthand label. Exclusions remain labeled and separate, following ordinary combinations for the same position/model. The same hierarchy applies to full tooltips, the application picker and linked-fitment labels. Applications taxonomy rows do not have a part-specific fitting position and continue with make/model/engine/chassis. Search relevance of parts and application-picker results is preserved.

Search strings cannot safely be reverse-parsed to reconstruct combinations. The search endpoints therefore add current structured active rules from PostgreSQL using the existing `fitmentRulesSql` helper. Meilisearch continues to select/rank parts; its labels no longer determine the new display. Existing `applications` fields remain for older clients.

Engine codes compress through the same `compressEngineCodes` helper used by the applications overview. Compression stays cosmetic. Grouping preserves canonical make/model identity, exact chassis, raw year bounds, classifications, qualifier modes, and inclusion/exclusion. Different contexts appear as separate segments under the same model label. Exclusions carry an explicit `Excluded:` label. Per the owner's follow-up, missing details have no placeholder text: model-only entries show the model label, engine-only entries show the code, and empty parentheses/separators are omitted. The same rule applies to tooltips, accessible text, and Applications summaries/detail cells.

Full codes and four-digit years are available in the native tooltip and screen-reader text. An authoritative empty rule list displays nothing rather than resurrecting an old index label. Legacy opaque strings remain verbatim when structured data is absent. No guessed parsing or global formatted-label cache is introduced.

## As Built

### 1. Search response data — Done

- `/power-search/parts` adds `fitment_rules` from its existing PostgreSQL display query.
- `/parts`, including paginated requests, adds the same structured rules.
- Shared SQL resolves effective link-level details over reusable combination defaults, retains exclusions, and filters inactive rules. Existing permissions and result ordering remain intact.

### 2. Shared UI — Done

- `PartFitmentText` delegates to `formatSearchFitments`; compact displays allow two lines and full-text tooltips, while Power Search wraps complete model entries onto separate lines.
- POS, invoicing, goods receipt and purchase-order suggestion rows put the fitment below the part name. Stock/price stack below on phones and remain beside the identity on wider screens.
- Parts retains a horizontal-scroll table with a minimum width so fixed identity columns cannot collapse the application column on phones.
- Existing transaction selection, editing, linking and persisted engine data are unchanged.

### 3. Verification — Done

- All 16 authenticated Express/PostgreSQL scenarios passed. The new scenario checks both search routes, including paginated Parts, with current classifications, a narrower link year range, exclusions, and absence of an unlinked rule despite index hits containing no fitment labels. The disposable database was dropped afterward.
- All 15 web test files passed. Formatter cases cover shorthand, full codes, separate contexts, cross-make identities, partial entries, unsafe suffixes, modes, legacy fallback, authoritative empty lists, per-link detail changes, and natural ordering independent of source-row order.
- Browser contracts passed on all six actual pages at 390px and 1280px. Checks cover shorthand, preserved context pairings, precedence over stale index labels, tooltip/accessibility contents, readable fitment width, and absence of writes. APIs are intercepted fixtures; database SQL/auth behavior is tested separately.
- API/web lint passed with zero errors and existing warnings. Production web build passed with existing import/chunk-size warnings.
- Synthetic desktop POS screenshot reviewed. Mobile browser checks caught and resolved zero-width suggestion/table fitment cells.
- Graphify refreshed the code graph (8,012 nodes); it reported 30 existing extraction issues and skipped HTML above its configured node limit. Prose semantic indexing was not attempted. Hindsight retention returned no confirmation within the bounded wait; this repository record is the confirmed handoff.

## Files Touched

- API `partRoutes.js`, `powerSearchRoutes.js`, and `vehicleCombinations_db_test.js`.
- Web `PartFitmentText.jsx`, `searchFitmentText.js`, `fitmentDisplayOrder.js`, POS/Invoicing/PowerSearch/Parts/GoodsReceipt pages and `PurchaseOrderForm.jsx`. Ordering follow-up also aligns Applications rows, the application picker, linked-fitment labels and qualifier summaries.
- `searchFitmentText.test.js`, `searchFitmentsBrowser.mjs`, and its HTML/JSX fixture.
- This record and generated Graphify outputs. Use the actual diff and graph query for the current map.

## Verification Commands

```bash
FITMENT_PHASE0_SCHEMA=/tmp/vehicle-direct-link-schema.sql node packages/api/tests/vehicleCombinations_db_test.js
npm run -w packages/web test
npm run -w packages/api lint
npm run -w packages/web lint
npm run -w packages/web build
docker exec -i -e FITMENT_BROWSER_BASE_URL=http://forson_frontend_dev:5173 forson_backend_dev node --input-type=module < packages/web/tests/searchFitmentsBrowser.mjs
graphify update .
git diff --check
```

The schema-only dump prerequisite is documented in the earlier direct-link record. No full API-suite result or production-scale performance measurement is claimed.

## Rollout and Deferred Work

Deploy frontend/backend together for structured shorthand. Older labels remain usable during mixed-version deployment, with legacy text rendered verbatim. No migration, taxonomy cleanup or search-index rebuild is required. Mobile-app changes, printed/exported labels and cleanup comparison cards are outside this search-display change.

## Change Log

| Date | Change |
|---|---|
| 2026-11-03 | Added structured search fitments and shared shorthand across six search surfaces; verified real SQL/auth and phone/desktop browser contracts. |
| 2026-11-03 | Owner follow-up: show available fitment details only; omit missing-detail placeholders across search displays and the Applications page. |
| 2026-11-03 | Owner follow-up: apply identity-first field ordering and deterministic natural sorting to fitment entries and align table/picker/manager displays. |
| 2026-11-03 | Owner follow-up: fitting position precedes the make; retain separate position/model groups and the remaining detail order. |
