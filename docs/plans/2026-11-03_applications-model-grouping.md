# Applications Grouped by Model — Implementation Record

> Forson Business Suite | Date: 2026-11-03 | Starting revision: `b483ed8`
> Builds on [Vehicle Combinations and Direct Part Links](./2026-11-01_vehicle-combinations-direct-links.md).

## Status at a Glance

| Work | Status |
|---|---|
| Idea evaluation and display design | Done: model overview with expandable exact combinations |
| Group-aware API pagination | Done: opt-in `groupBy=model`; existing flat response retained |
| Model rows and combination management | Done: compact summaries, shorthand, exact detail panel, individual actions |
| Verification | Done: 15 disposable PostgreSQL/API scenarios, 14 web test files, phone/desktop browser contracts, lint and build |
| Deployment | Not performed; no migration required |

## For a New Session or Agent Picking This Up

1. Read root `AGENTS.md`; check `git status` and `git log` against this record. Implementation was verified as uncommitted workspace changes.
2. Run `graphify query "ApplicationsPage ApplicationModelRow model grouping" --budget 1800` for current code relationships.
3. Recall Hindsight with `forson-business-suite`, `vehicle_fitment`, and `applications-model-grouping` for the user's grouping preference and its rationale.
4. Re-run the verification commands below before extending this behavior. The PostgreSQL fixture creates and drops only its own database; it never copies business rows.
5. After changes, update this status table, retain non-obvious decisions, and run `graphify update .`.

## Objective and Evaluation

The owner wants one applications-page row per vehicle model, with chassis, engines and classification details summarized using comma-separated values or established engine shorthand such as `4BC2/E1`.

This is practical for browsing a catalog containing many combinations of the same model. Independent summary lists alone can imply nonexistent chassis/engine/classification pairings. The implementation therefore combines a compact overview with an expandable table of the exact recorded combinations. Editing and deleting always target an individual application ID.

## Decisions Already Taken

- Group by canonical model ID, which already identifies its make. Identical names belonging to different makes stay separate. Duplicate taxonomy identities are not merged.
- Keep combinations without a model as individual partial entries, including make-only, engine-only and chassis-only records.
- Paginate complete model groups in the API. Grouping an already paginated flat list would lose combinations or repeat a model on several pages.
- Engine compression uses the existing safe display helper. Full codes remain available in the title and expanded panel; no compressed values are stored or submitted.
- Unknown fields read “Not specified.” Disjoint year ranges remain separate ranges; they never become a wider continuous period.
- Summary values describe recorded combinations, without asserting every possible cross-product of the displayed values.

## As Built

### 1. Grouped API — Done

`GET /api/applications?groupBy=model&paginated=1` returns the existing pagination envelope with model-group objects in `data`. Each group contains a stable `group_key`, make/model labels, a representative engine for sorting, identity metadata and complete `combinations` rows. `total` counts groups. Make/model/engine sorting has deterministic tie breakers. Model-less entries use application identity as their key.

Matching groups are selected before pagination, then their full combinations are loaded with linked-part counts and existing row enrichment. Search selects matching groups while keeping the entire model available for context. Requests without `groupBy=model` preserve the flat contract. Existing authorization remains in force.

### 2. Model overview and details — Done

The page shows make, model, chassis summary, engine summary, labeled classification chips and a details button. Long value lists show three values and a “more” control; classification summaries show three fields and a remaining-detail count. Expansion exposes the full combinations, their exact years and classifications, linked counts and permission-gated edit/delete buttons. Model expansion is keyboard operable and exposes its state through ARIA attributes.

The table scrolls within its container on narrow screens. Styling follows the existing primary-color and dark-theme conventions. Pagination labels count model groups. Request sequencing prevents stale page/sort responses from replacing current results; deleting the final group on a page moves to the last valid page.

### 3. Verification — Done

- Disposable PostgreSQL/Express/auth checks: 15 scenarios passed, including all prior direct-link scenarios plus grouped pagination, cross-make homonyms, partial entries, complete group membership, metadata/version preservation, permissions, deterministic sorting and search context. Fixture database dropped afterward.
- Web tests: all 14 files passed, including new checks for safe compression, duplicate summary values, explicit missing qualifiers, disjoint years and unchanged input records.
- Chromium contract checks passed at 390px and 1280px: one default model row, shorthand, keyboard expansion, exact pairings, versioned edits, individual deletion, viewer permissions, bounded page width, empty state and error state. An eight-combination model also exercises the long-list disclosure. Requests are intercepted synthetic fixtures; database behavior is verified separately.
- API/web lint: zero errors, existing warnings remain. Production web build passed with existing import/chunk-size warnings.
- Visual review used the synthetic expanded desktop view. The fixture uses a separate module entry because the running Vite server did not resolve a newly added inline HTML proxy module.
- Graphify refreshed the code graph. It reported 30 existing extraction issues (including a document node without `source_file`) and skipped HTML generation because the graph exceeds 5,000 nodes. Prose semantic indexing was not attempted.
- Hindsight recall succeeded. End-of-session retention was attempted but returned no confirmation; the durable implementation record remains the confirmed handoff source.

## Files Touched

- `packages/api/routes/applicationRoutes.js`
- `packages/api/tests/vehicleCombinations_db_test.js`
- `packages/web/src/pages/ApplicationsPage.jsx`
- `packages/web/src/components/applications/ApplicationModelRow.jsx`
- `packages/web/src/helpers/applicationModelSummary.js`
- `packages/web/src/components/ui/PaginationControls.jsx`
- `packages/web/tests/applicationModelSummary.test.js`
- `packages/web/tests/applicationModelsBrowser.mjs`
- `packages/web/tests/fixtures/applicationModelsBrowser.html` and `.jsx`
- This implementation record; generated Graphify outputs.

## Verification Commands

Run from the repository root with local development networking/container access:

```bash
FITMENT_PHASE0_SCHEMA=/tmp/vehicle-direct-link-schema.sql node packages/api/tests/vehicleCombinations_db_test.js
npm run -w packages/web test
npm run -w packages/api lint
npm run -w packages/web lint
npm run -w packages/web build
docker exec -i -e FITMENT_BROWSER_BASE_URL=http://forson_frontend_dev:5173 forson_backend_dev node --input-type=module < packages/web/tests/applicationModelsBrowser.mjs
graphify update .
git diff --check
```

The schema-only fixture prerequisite can be recreated with the command in the previous direct-link record. No full API-suite run or production-scale performance measurement is claimed.

## Deployment and Deferred Work

Deploy backend and frontend together so the page can request the grouped contract. No schema or search-index change is needed. An older frontend can continue using the flat API contract. Very large per-model payloads may eventually warrant lazy-loaded detail panels; current group responses deliberately include complete combinations. Taxonomy merges and changes to part-level fitment displays remain outside this work.

## Change Log

| Date | Change |
|---|---|
| 2026-11-03 | Evaluated and implemented model grouping, verified API and UI contracts, and recorded the result. |
