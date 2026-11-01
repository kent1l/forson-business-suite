# Vehicle fitment — completion and verification record

Date: 2026-11-01. Parent: [evidence-aware resolver plan](../2026-10-29_vehicle-fitment-evidence-aware-resolver.md).

## Status at a Glance

| Phase | Current state |
|---|---|
| 0 | Done previously. Historical read-only investigation and red baselines remain in this directory. |
| 0.5 | Done locally. Shared link writers preserve restrictions, enforce permissions, avoid post-commit pool acquisition and never derive vehicle-engine facts from link saves. |
| 1 | Done locally. Original four migrations retained; one additive integrity migration rehearsed twice on each disposable fixture. No business database changes. |
| 2 | Done locally. Clause spans/provenance, collision safety, semantic deduplication, mutually exclusive interpretations and review persistence covered by focused tests. |
| 3 | Done locally. Transactional rules, concurrency/idempotency, versioned edits, safe staging/display, manual evidence review and separate source/compatibility approvals implemented. |
| 4 | Manual evidence registry implemented. Live/paid research deliberately gated; manual entry works without providers. |
| 5 | Local verification complete; exact results are in `verification-2026-11-01.json`. Production/staff measurements, migration, deployment and operational acceptance remain pending. |
| Deferred | Paid search providers, mandatory extra AI judgment, embeddings, destructive taxonomy merges/cleanup and global VIN catalog remain deferred. |

## For a New Session or Agent Picking This Up

1. Read root `AGENTS.md`, the parent plan and this record. Inspect `git status` and `git log`: the starting revision was `7a19433`; `edd8021` appeared as a checkpoint during this session. Existing web display changes were preserved and extended.
2. Run `graphify query "fitmentLinkService fitment evidence review rule save" --budget 2000` and inspect source. Graph queries have previously returned unrelated subgraphs; source and executable checks remain authoritative.
3. Recall Hindsight with `forson-business-suite` and `vehicle_fitment` if available. Recall timed out during this session; missing memory access is not a prerequisite.
4. Re-run the disposable database and browser commands below before rollout. Never point destructive test fixtures or reset scripts at the business database.
5. Update this document and the parent status when production verification becomes available. Run `graphify update .` after subsequent changes.

## Decisions and As Built

The business objective remains accurate part-application entry without interpreting missing details as universal compatibility. Engine/model/chassis identification is separate from externally supported part compatibility. Existing legacy records are retained as unverified observations.

| Decision | Accepted implementation and consequence |
|---|---|
| D10 — rule ownership | `part_application_rule` owns every distinct effect, year range and typed qualifier. The single legacy `part_application` row is a positive discovery projection. Every writer uses `saveFitmentLink`; restrictions are never silently folded into the first link. |
| D11 — save consistency | Part-row locking serializes semantic saves; the database unique index remains the invariant. Advisory locking serializes idempotency keys before reading the ledger. The whole request is hashed, including qualifiers and review tokens. Replays return the original result; changed bodies return 409. No-op requests do not broaden taxonomy facts. |
| D12 — evidence authority | Human extraction edits remain `needs_review/user_declared`. Recording evidence never approves compatibility. An approver must separately approve a permitted, supported, current source and then approve the exact part/application/effect/qualifier tuple. Vehicle-engine association evidence cannot satisfy this contract. |
| D13 — conservative matching | The shared evaluator checks all queried qualifiers, requires range containment for a full year-range confirmation, and treats missing values as needing details. Unverified/expired evidence cannot confirm compatibility. Explicit/potential exclusions take precedence. Power search performs SQL candidate retrieval and this same evaluation, rather than inferring compatibility through model-engine associations. |
| D14 — historical identity | Changing/deleting a shared application identity with claim/rule history is blocked in SQL; the legacy application-merge endpoint also refuses automatic reassignment. A reviewer creates and links a replacement claim instead of changing the meaning of existing evidence. No legacy taxonomy mappings were cleaned up. |
| D15 — additive consumers | Catalog and all three part index document builders add atomic `fitment_rules`, schema version 2 and discovery-only confirmation semantics. Existing text consumers remain usable; text-only offline data does not confirm compatibility. No mobile source/Expo dependency changes were needed. |

### Phase 1 migration and history

New migration: `database/migrations/20261101_01_fitment_review_integrity.sql`, mirrored in the baseline schema. It adds `fitment_rule_source` to preserve multiple source claims per semantic rule; evidence claim type, rights, assessment and expiry; the missing model display toggle used by existing routes; guards for every unrestricted qualifier and for application identity history. Existing migration files/checksums were not changed.

The migration is additive and idempotent. Tests load a schema-only development dump into a newly named database, apply the migration twice, seed synthetic data and exercise actual Express/auth/SQL. The owning parent process drops that database in `finally`. No production or development business rows are copied into it. Full-suite runs additionally load standard reference seeds from repository migrations and advance sequences after explicit fixture IDs.

### Phase 2 review and reconciliation

The parser retains original text, exact clause text/span, field provenance and all duplicate source clauses. Engine-code collisions are unresolved choices; shorthand still expands into atomic engines. Ambiguous multi-model/multi-engine combinations are not preselected. Candidate identity includes all modes and qualifiers, preserving punctuation and meaningful differences.

Persistent reviews are scoped to actor/part/text and serialized at creation. Dismissals survive unchanged reparses; restoring one requires a reason. Parse responses include `review_version`. Patches require the version, validate edited canonical identities and retain the original source. Saves bind to the stored candidate, part and taxonomy version. Conflicting interpretations cannot both be applied from one review. Review persistence failures return 503 with manual-entry recovery instead of silently losing the decision history.

### Phase 3 UI, writers and contracts

The existing manager and part form are extended. The UI submits an explicit claim payload, preserves every typed restriction, stages engine/chassis-only claims, prevents uncertain/already-linked bulk selection, uses stable retry keys and persists identity/year corrections through review tokens. Display grouping keeps disjoint years, qualifiers, scope modes and evidence states separate. Identification and compatibility are labeled separately.

The manager's Evidence action records a source with title, optional public HTTPS URL and a bounded permitted excerpt. Editors can capture a source; `applications:approve` controls source and compatibility approvals. These are separate explicit buttons, each requiring a review reason. Compatibility approval is bound to a rule version and an exact matching approved source. Evidence invalidation reopens dependent rules; expiry is checked on current reads/search.

Current API contracts (integer IDs follow the existing physical schema):

| Operation | Current contract |
|---|---|
| `POST /applications/parse-fitment-text` | `{text,part_id?,disable_ai?}` → canonical proposals, source/residue, `review_id`, `review_version`, taxonomy version, dispositions and existing-link state. |
| `PATCH /applications/fitment-reviews/:id` | `{expected_version,candidate_id,disposition,reason,edited_payload?}` or versioned `dismiss[]`; returns the updated version. No silent first-candidate fallback is accepted. |
| `POST /parts/:id/applications` | Canonical IDs/labels plus typed qualifiers/effect; parsed requests additionally carry `review_id,candidate_id,expected_version`. Optional `Idempotency-Key`. Returns saved 201 or existing 200; conflicting/stale requests 409, invalid identity/scope 422. |
| `PUT /parts/:id/application-rules/:ruleId` | Required version plus edited qualifiers. Null explicitly clears a qualifier. Edits revoke compatibility approval and update the discovery projection where applicable. |
| `DELETE /parts/:id/application-rules/:ruleId` | `{expected_version}` removes one active alternative, retains history and replaces/removes the legacy projection as needed. |
| Legacy delete routes | Return 409 `RULE_SELECTION_REQUIRED`: refresh the manager and select the exact rule/version. A discovery projection cannot identify which restriction/exclusion to remove. |
| Legacy `PUT /part-applications/:id` | Version required; year edits are audited and reopen compatibility review. New manager uses rule-specific edits. |
| `GET /parts/:id/fitment-evidence` | `applications:view`; up to 100 sources belonging to this part. |
| `POST /applications/fitment-research` | Live provider unavailable → 503/manual recovery. Explicit offline/manual capture stores supplied evidence as needs-review; no parser output or model memory is manufactured into a source. Default rights are metadata-only. |
| `POST /applications/fitment-evidence/:id/approval` | Approver-only `{expected_version,decision,reason}`; approve/reject/invalidate with transactional audit and dependent-rule invalidation. |
| `POST /parts/:id/application-rules/:ruleId/approval` | Approver-only `{expected_version,decision,reason,evidence_ids}`; exact part compatibility evidence required. Source approval alone changes no compatibility. |
| `POST /applications/fitment-alias` | Atomic synonyms only, scoped parent checked; new aliases enter pending review. Existing approver endpoint remains separate. Corrections remain separate records and never approve compatibility. |

Errors preserve the existing `{code,message}` convention. New side effects use the transaction's outbox client. Part creation/edit and purchase-line catalog creation share the same rule policy. The existing bulk-update endpoint remains 501 and cannot mutate fitments.

Part merge compares the complete semantic tuple, handles multiple sources sequentially, retains all claim sources and moves distinct rules without unioning years. Merge snapshots now include rules, claims and their joins; undo restores dependency order. Undo refuses unsnapshotted/new rules or older merges without fitment snapshots. Dedupe-queue trigger reinsertion is tolerated during restoration.

## Verification

Current results: 16/16 real PostgreSQL API scenarios, 103/103 focused API tests, 11/11 pure baseline cases and 15/15 display tests pass. Browser checks pass at 390px and 1280px, including source capture and separate approvals. Full API: 108 suites pass; 1,491 tests pass, two baseline finance tests fail and one is skipped. API/web lint report zero errors (existing warnings remain); web production build passes with the existing large-chunk warning. All owned fixture databases were dropped. Lookup p50/p95 and exact environments are in the machine-readable record.

Graphify updated successfully after sandbox escalation. It reported 30 extraction issues, including an existing document node without `source_file`; the 7,922-node graph exceeded the configured HTML limit, so HTML regeneration was skipped. Code graph JSON/report were updated; prose semantic indexing was not attempted. Hindsight recall timed out and memory access did not block the durable handoff.

Machine-readable observations: [verification-2026-11-01.json](./verification-2026-11-01.json). They distinguish actual PostgreSQL scenarios, browser contract fixtures, pure parser fixtures and full-suite limitations. Historical `acceptance.cjs` consumes historical baseline JSON by default; its original 21/21 completion assertion is not a current integrated acceptance result.

Commands (run from repo root, with local container/network access):

```bash
# Read-only schema copy. This includes no business table data.
docker exec forson_db pg_dump -U postgres -d forson_business_suite --schema-only --no-owner --no-privileges > /tmp/fitment-phase0-schema.sql
# Only the generated owned *_test database is mutated and dropped.
FITMENT_PHASE0_SCHEMA=/tmp/fitment-phase0-schema.sql node packages/api/tests/fitmentResolver_db_test.js
FITMENT_PHASE0_SCHEMA=/tmp/fitment-phase0-schema.sql FITMENT_JEST_CONTAINER=forson_backend_dev node packages/api/tests/fitmentResolver_db_test.js --full-jest
npm run -w packages/api test -- --runInBand tests/fitmentTextParser.test.js tests/fitmentResolverPhase1To3.test.js
node docs/plans/vehicle-fitment-phase0/baseline.cjs --enforce
npm run -w packages/api lint
npm run -w packages/web lint
npm run -w packages/web build
npm run -w packages/web test
node packages/web/tests/engineCodeFormat.test.js
# Chromium in the development image; API requests are intercepted contract fixtures.
docker exec -i -e FITMENT_BROWSER_BASE_URL=http://forson_frontend_dev:5173 forson_backend_dev node --input-type=module < packages/web/tests/fitmentResolverBrowser.mjs
graphify update .
git diff --check
```

Full API verification used the development image because host Chromium lacks `libasound.so.2`. Two finance failures were also reproduced against a temporary `7a19433` reference checkout with the same disposable schema/reference seeds: the supplier-payment method availability case in `chequeReplacementAndDeletion.test.js`, and the same-month preview case in `transactionDateService.test.js`. They are not fitment regressions. No finance implementation was modified to silence them.

Lookup timing uses 100 warm-ups and 1,000 measured DB-query-plus-evaluator calls at concurrency five. This is a small synthetic fixture, excludes HTTP/provider latency, and is not a production-scale claim or a percentage improvement. Staff correction rates, real-store field accuracy and production query budgets still require representative authorized samples/telemetry.

## Files and Rollout

Implementation spans the parser/schema/matcher helpers; `fitmentLinkService`, `fitmentReviewService`, `fitmentEvidenceService` and merge service; application/link/part/power-search routes; catalog and part-index builders; manager/part-form/display helpers and `FitmentEvidenceReview`; the additive migration/baseline; and reusable API/browser/unit checks. Use the actual Git diff for the precise footprint; no deployment or Git commit is implied by this record.

Before deploying, take the normal backup and rehearse migration on an authorized staging copy with the ordinary migration runner/checksum verification. Apply the new migration before enabling the new writers/UI. Preserve all four earlier migrations and legacy data. Verify outbox/index rebuilds and current catalog clients, then measure production/staff outcomes. The reviewed Hiace/D-Max/engine duplicate cleanup remains owner-run and was not attempted here.

Rollback should keep additive history tables and data. Pause fitment editing and prefer a forward fix if a new writer fails. An older writer only understands the first legacy projection, so reverting application code is not a safe substitute for preserving multi-rule restrictions; review that rollback on the staging copy first. No production rollout, live external search, spending or destructive data reset is authorized/performed by this implementation session.

## Change Log

| Date | Change |
|---|---|
| 2026-11-01 | Verified the earlier completion claims against source, completed remaining integrity/UI/consumer work and recorded reproducible local evidence and the remaining operational gates. |
