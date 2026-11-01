# Vehicle Combinations and Direct Part Links — Implementation Record

> Forson Business Suite | Date: 2026-11-01 | Starting revision: `70e12db`
> Supersedes the evidence/approval requirements in [the earlier resolver plan](./2026-10-29_vehicle-fitment-evidence-aware-resolver.md). The owner explicitly requested vehicle classification and immediate part linking without storing evidence or requiring approval.

## Status at a Glance

| Work | Status |
|---|---|
| Reusable vehicle classification | Done: complete classification uniqueness, optional fields, management/editing and picker labels |
| Direct part links | Done: shared transactional writer, no new claim/evidence/review records, optional link details |
| Entry UI and lookup | Done: direct linking, transient parsing, Linked display, evidence controls removed, approval-independent matching |
| Migration | Applied/checksum-verified on local development; applied twice on disposable fixtures; fresh baseline SQL also loads |
| Verification | 14 real PostgreSQL/API groups, 142 focused API regression tests, web tests/build/lint, phone/desktop browser contracts and six live read-only HTTP checks passed |
| Production rollout | Not performed; apply migration before deploying the updated code |
| Historical evidence deletion | Intentionally excluded: old records remain archived in place |

## For a New Session or Agent Picking This Up

1. Read `AGENTS.md`, inspect `git status`/`git log`, and verify this record against the current code and authorized environment.
2. Run `graphify query "vehicleCombination fitmentLinkService applicationRoutes" --budget 2000`. Use the resulting sources; graph matches can be noisy.
3. Recall Hindsight with `forson-business-suite`, `vehicle_fitment`, and `direct linking`. Earlier evidence-aware requirements are superseded by the owner's explicit preference recorded here.
4. Check migration status/checksums. Never run destructive fixtures against business databases; the database test creates/drops only a named owned fixture using a schema-only dump.
5. After changes, update this record, retain non-obvious decisions, and run `graphify update .`.

## Business Objective and Decisions Already Taken

Staff need to create/select vehicle combinations and associate them with parts. A link is immediately useful for lookup; evidence capture and approval add work that the owner does not need.

- Preserve make/model/chassis/engine identities and their parent validation. Partial combinations, including engine-only and chassis-only, are allowed.
- Make years, market, variant/trim, drivetrain, transmission, generation, fuel and displacement reusable classification fields on `application`.
- Installation position belongs to the part link. A link can also carry more specific classification details, such as a narrower year range.
- Stop new claim, evidence, research-job, correction-log and review-session writes in the normal entry/linking flow. Parsing is a transient aid; only selected combinations and links are persisted.
- Remove evidence/approval UI and matching gates. Preserve existing evidence/history tables and rows rather than deleting business records.
- Keep basic consistency checks, concurrency/version protection and duplicate prevention. Existing explicit exclusions and known conflicting vehicle details still apply.
- Do not mark links as externally verified. `linked` is the normal match status. Incomplete classification can still be returned with `needs_details`; this never depends on evidence or approval.

## Architecture and As Built

### 1. Reusable classifications — Done

`application` retains its canonical identity IDs and adds `year_start`, `year_end`, `market`, `variant_descriptor`, `drivetrain`, `transmission`, `generation`, `fuel_type_qualifier`, and `displacement_liters_qualifier`.

A PostgreSQL unique index covers the full classification tuple with NULL equality and case/whitespace normalization for descriptor fields. Different transmissions/variants/year ranges can share the same make/model/chassis/engine without collapsing. `vehicleCombination.js` validates input before writes. `application_view` exposes the complete classification, including engine defaults for fuel/displacement.

The management form accepts partial information and all optional classification fields. Shared combination edits update dependent lookup data and enqueue linked parts for indexing. Deleting a still-linked combination is blocked to prevent silently removing its links. Application merge continues to require unlinking when links/history exist; it does not silently fold distinct links together.

### 2. Direct links — Done

`part_application_rule` remains the authoritative storage for individual links, optional per-link details and existing exclusions. This reuses the existing multi-link representation without discarding disjoint years or qualifiers. `part_application` remains the legacy positive-link projection.

`saveFitmentLink` is shared by direct link entry, staged part creation/edit and purchase-line catalog creation. It retains transactional part locking, semantic duplicate protection and retry idempotency. It no longer creates `fitment_claim` or `fitment_rule_source` rows and no longer requires persisted review tokens. New link approval/evidence columns are NULL; existing historical values are ignored by the active flow.

When supplied details equal the reusable combination's details, the link inherits rather than copying them. Distinct per-link values remain explicit. SQL helpers apply those effective details consistently to link lists, lookup, structured catalog documents, searchable labels and year tokens. The link editor uses raw per-link years so a position-only edit does not accidentally freeze inherited years.

### 3. Entry, search and retired workflows — Done

The description panel finds combinations on request, lets staff edit/select them and saves directly. It records no dismissal/correction/review history. Conflicting parse interpretations remain explicit choices; retry keys survive a failed save.

Evidence controls/component were removed. Previous evidence/research/approval/review/correction endpoints return HTTP 410, preventing obsolete clients from continuing to store evidence. Taxonomy alias maintenance remains separate; it is not required for linking.

The combination picker queries authoritative PostgreSQL classification rows, so a newly created or corrected combination is available immediately without waiting for an applications index rebuild. Application index writers also include full classifications. Part index/catalog documents use schema version 3, include effective classification details, and omit approval/evidence metadata. The older `fitment_confirmation: false` field remains for client compatibility; it has no gating role.

Matching ignores historical approval, evidence status and evidence expiry. Exact matches report `linked`; known conflicts and exclusions remain effective. Universal parts require no evidence approval.

### 4. Migration and history — Done on development

Migration: `database/migrations/20261101_02_vehicle_combinations_direct_links.sql`.

- Adds optional classification columns and replaces known old application uniqueness indexes with the complete tuple index.
- Removes approval guards while keeping relational scope validation and row versioning.
- Allows shared classification corrections and protects deletion while live part links exist.
- Makes new link approval/evidence metadata optional with no default.
- Recreates the application view without removing the legacy columns required by older consumers.
- Deletes no existing evidence, claims, links or taxonomy rows; all previous migration files/checksums are unchanged.

The baseline mirrors the migration and includes canonical engine/application bootstrap prerequisites from the existing engine/identity migrations. A new empty database can load the baseline before the migration runner processes historical files.

## Files Touched

- `database/initial_schema.sql` and `database/migrations/20261101_02_vehicle_combinations_direct_links.sql`
- API classification/rule/matcher/document helpers; shared link service; application, search, part and link routes
- Application/part index writers and catalog sync shaping
- Web combination form/picker, management page, part manager/form and display helpers
- API/database/display/browser tests; the earlier database command forwards to the new direct-link fixture
- This record, the superseded plan headers, inventory manual and system context

Use `git diff --stat` and Graphify for the exact current footprint and call relationships.

## Verification

Passed:

- Migration applied twice in disposable PostgreSQL fixtures, then applied/checksum-verified on local `forson_business_suite`.
- Fresh `database/initial_schema.sql` load in a separate owned empty database; fixture dropped afterward.
- 14 authenticated Express/PostgreSQL groups: direct links without approval permissions, no source writes, concurrent retries, complete combination identity, local search, inheritance, partial scopes, transient parse saves, retired endpoints, invalid input/permissions, shared edits, staged writers, matching/catalog and selective unlinking. Fixture database dropped afterward.
- Six focused API regression suites: 142 tests, including parser, classifier, purchase-line cataloging, power search and merge constraints/service checks. These ran with the disposable database credentials.
- Web test command: all 13 test files passed, including 15 display checks.
- Browser contracts at 390px and 1280px: direct saves, retries, descriptor preservation, alternative selection, optional form fields, distinct picker labels and absence of evidence/approval calls. API calls were intercepted fixtures; database behavior was checked separately.
- API and web lint: zero errors; existing warnings remain. Web production build passed with its existing chunk-size warning.
- Six authenticated read-only HTTP checks through the backend and frontend proxy returned 200 for classification management, search and an existing part's links.
- Graphify refreshed the code graph (7,950 nodes). It reported 30 existing extraction issues, including a document node missing `source_file`; HTML generation was skipped because the graph exceeds the 5,000-node limit. Prose semantic indexing was not attempted. The revised owner preference and handoff path were retained in Hindsight.

No full API-suite result or production deployment is claimed.

Commands from the repository root:

```bash
docker exec forson_db pg_dump -U postgres -d forson_business_suite --schema-only --no-owner --no-privileges > /tmp/vehicle-direct-link-schema.sql
FITMENT_PHASE0_SCHEMA=/tmp/vehicle-direct-link-schema.sql node packages/api/tests/vehicleCombinations_db_test.js --regression-jest
npm run -w packages/web test
npm run -w packages/api lint
npm run -w packages/web lint
npm run -w packages/web build
docker exec -i -e FITMENT_BROWSER_BASE_URL=http://forson_frontend_dev:5173 forson_backend_dev node --input-type=module < packages/web/tests/fitmentResolverBrowser.mjs
docker exec forson_backend_dev node scripts/migrate.js up --from 20261101_02_vehicle_combinations_direct_links.sql --to 20261101_02_vehicle_combinations_direct_links.sql
docker exec forson_backend_dev node scripts/migrate.js verify --from 20261101_02_vehicle_combinations_direct_links.sql --to 20261101_02_vehicle_combinations_direct_links.sql
graphify update .
git diff --check
```

## Rollout and Deferred Work

Apply the new migration before the updated backend/UI on another environment, using the normal migration runner. Rebuild part search documents through the normal outbox/reindex process to refresh previously indexed classification labels. The combination picker and structured vehicle filtering use the database immediately.

Production migration/deployment and historical table deletion were not performed. No additional approval workflow, external research provider, VIN catalog or destructive taxonomy cleanup is part of this change. Rolling back to evidence-aware application code would reintroduce the unwanted gates; prefer a forward fix while retaining history.

## Change Log

| Date | Change |
|---|---|
| 2026-11-01 | Implemented owner-requested vehicle classifications/direct links, applied development migration, and recorded verified results and rollout boundaries. |
