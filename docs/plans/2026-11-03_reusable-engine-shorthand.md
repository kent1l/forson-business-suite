# Reusable Engine Shorthand — Implementation Record

> Forson Business Suite | Date: 2026-11-03 | Starting revision: `fd832bb`
> Continues [search fitment shorthand](./2026-11-03_search-fitment-shorthand.md).

## Status at a Glance

| Work | Status |
|---|---|
| Display audit | Done: all existing web engine/fitment renderers inspected; mobile has no current fitment UI |
| Standalone formatter | Done: one compression implementation and shared normalization/fallback/full-label API |
| Display integration | Done: search, applications, part editing, linked fitments, candidates, pickers, filters and cleanup cards |
| Legacy formatter consistency | Done: shared engine formatting, complete context grouping and cache-key corrections |
| Verification | Done: 16 web test files, three phone/desktop browser contracts, targeted lint and production build |
| Deployment | Not performed; frontend change, no migration or reindex needed |

## For a New Session or Agent Picking This Up

1. Read root `AGENTS.md` and confirm the status against `git status` and `git log`. This record describes locally verified workspace changes.
2. Run `graphify query "engineCodeDisplay EngineCodeText formatEngineCodes" --budget 1800` for current relationships.
3. Recall Hindsight with `forson-business-suite`, `vehicle_fitment`, and `engine-shorthand` for the display-only constraint and owner preferences.
4. Run the verification commands below before changing compression rules. Existing round-trip fixtures also underpin API parser checks.
5. Update this record, retain non-obvious decisions and run `graphify update .` after changes.

## Objective and Decisions

The owner requested reusable engine shorthand across every existing engine-fitment display. The compressor already existed, but callers duplicated normalization/list fallbacks and several views built their own raw labels. The implementation now has one dependency-free engine presentation module plus one accessible React label.

Compression remains display-only. Canonical engine codes, IDs, form values, parser expansion, links, indexes and catalog storage remain atomic. Only codes belonging to the same recorded vehicle context may be passed as one fitment list. An Applications overview may summarize a model's codes because its expanded panel retains the exact combinations.

The previous preferences remain in force: fitting position before make; then model, engine, chassis, years and classifications; no missing-detail placeholders. Full codes remain available in tooltips and accessible text. Individual edit/unlink/remove controls retain their original identifiers even where a summary compresses several engines.

## As Built

### 1. Pure presentation API — Done

`packages/web/src/utils/engineCodeDisplay.js` owns the existing prefix/shared-suffix algorithm and all guards. It imports only the pure display comparator, with no React, browser, network or API dependency.

```js
formatEngineCodes(['4BC2', '4BE1']); // '4BC2/E1'
formatEngineCodes(['4BC2', '4BE1'], { compact: false }); // '4BC2, 4BE1'
getEngineCodeDisplay(['4BC2', '4BE1']);
// { codes: ['4BC2', '4BE1'], text: '4BC2/E1', full: '4BC2, 4BE1', compressed: true }
```

`normalizeEngineCodes` trims, uppercases, deduplicates and naturally sorts display copies. `formatEngineCodes` accepts a single code or list and supports an optional fallback separator. Empty data produces empty text. Unsafe suffixes, unrelated codes and lists exceeding the existing readable cap fall back to complete codes. `engineCodeFormat.js` re-exports the same compressor for compatibility; there is no second implementation.

`EngineCodeText` renders shorthand with a complete native tooltip and full atomic codes for screen readers. It leaves missing values blank.

### 2. Consumers — Done

- Shared search text, Applications summaries, linked-fitment grouping and the legacy application-text helper use the same formatter/metadata API.
- Applications engine summaries and individual engine cells use `EngineCodeText`; long summary lists receive normalized display codes from the shared API.
- Application picker labels, part-form chips, parsed candidates and linked-fitment headers use the common fitment formatter. Linked engine rows use `EngineCodeText`.
- Vehicle-filter and cascade-form engine option labels use `formatEngineCodes`; their selected IDs and raw entry values are unchanged.
- Cleanup comparison cards use `PartFitmentText`, enabling the same safe shorthand and complete context display rather than raw application rows.
- Individual staged chips and editor choices remain atomic to preserve their remove/select behavior. A single engine naturally displays as its full code.

The audit found no current engine-fitment rendering in the mobile app: catalog fields are stored/read but no screen renders them. No mobile UI, offline schema, Expo dependency, backend, stored data or printed/exported document was changed. The versioned Expo 56 docs were consulted before completing the audit; no mobile implementation was necessary.

### 3. Grouping and legacy behavior — Done

Linked groups preserve identity IDs and missing-engine contexts, deduplicate displayed codes while retaining every underlying rule, and share normalization/fallback logic. Legacy model/engine collapsing now keys on complete qualifiers, year bounds, effects and modes rather than just a model name. Mixed engine-only/opaque entries survive make/model merging. Formatted-text cache keys include actual application details and grouping options so an existing ID cannot return a stale engine label after changes.

### 4. Verification — Done

- All 16 web test files passed, including existing parser/compressor round-trip fixtures and new reusable-API, unsafe variant, empty/single/long list, deduplication, context-boundary, cache and legacy-mode checks.
- `engineDisplaysBrowser.mjs` passed at 390px/1280px: reusable label tooltip/accessibility, cleanup shorthand, linked-manager shorthand, two distinct edit/unlink controls and two separate staged-entry remove controls; no writes occurred.
- Existing six-page search browser contracts and Applications browser contracts passed at both widths. API calls are intercepted fixtures; no real transaction is created.
- Targeted lint passed with zero errors and existing warnings. Production build passed with existing import/chunk-size warnings. `git diff --check` passed.
- No API or mobile source changed, so no PostgreSQL or mobile build result is claimed for this refactor.
- Graphify refreshed the code graph (8,042 nodes), with 30 existing extraction issues and HTML skipped above the configured node limit. Prose semantic indexing was not attempted. The reusable API and display-only constraints were retained in Hindsight.

## Files Touched

- `engineCodeDisplay.js`, `engineCodeFormat.js`, `EngineCodeText.jsx`.
- Search/model/legacy application display helpers.
- Application model rows, application picker, cascade form, vehicle filters, part form, cleanup comparison card and linked-fitment manager.
- Engine display unit/browser tests and the shared browser fixture.
- This handoff and generated Graphify outputs. Use the diff and graph query for the current source map.

## Verification Commands

```bash
npm run -w packages/web test
npm run -w packages/web build
docker exec -i -e FITMENT_BROWSER_BASE_URL=http://forson_frontend_dev:5173 forson_backend_dev node --input-type=module < packages/web/tests/engineDisplaysBrowser.mjs
docker exec -i -e FITMENT_BROWSER_BASE_URL=http://forson_frontend_dev:5173 forson_backend_dev node --input-type=module < packages/web/tests/searchFitmentsBrowser.mjs
docker exec -i -e FITMENT_BROWSER_BASE_URL=http://forson_frontend_dev:5173 forson_backend_dev node --input-type=module < packages/web/tests/applicationModelsBrowser.mjs
graphify update .
git diff --check
```

Targeted ESLint covered the formatter, existing display helpers and all changed UI consumers.

## Deployment and Deferred Work

Deploy the web bundle normally; no migration, index rebuild, API rollout or dependency installation is needed. Future mobile fitment UI can reuse the pure engine formatter but must first obtain complete structured context; never reverse-parse opaque catalog labels or replace stored/indexed engine codes with shorthand. No new mobile fitment UI was requested by this consolidation.

## Change Log

| Date | Change |
|---|---|
| 2026-11-03 | Extracted reusable engine presentation API and component, connected all existing web consumers, preserved atomic actions and verified regressions. |
