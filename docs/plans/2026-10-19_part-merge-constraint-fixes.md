# Part Merge Constraint Fixes — Developer Handoff

> **Forson Business Suite** | **Date:** 2026-10-19 | **Branch:** `master`
> **Status:** Implemented and verified in the development workspace; changes are uncommitted. No catalog merges were committed during verification.

## 0. Status at a Glance

| Item | Status | Reference |
|---|---|---|
| Diagnose reported SKU groups | Done; two errors confirmed in backend logs | §3 |
| Shared source tag collision | Fixed | §4 |
| Alias conflict-target schema mismatch | Fixed without schema changes | §4 |
| Exclusion endpoint constraint | Fixed; latent issue found during audit | §4 |
| PostgreSQL regressions and service tests | 33 tests passed; focused ESLint passed | §5 |
| Supplied groups, every survivor | 13 full workflow checks passed and rolled back | §5 |
| Pending suggestions, every survivor | 176 groups / 372 full workflow checks passed and rolled back | §5 |
| Production deployment / actual catalog merges | Outside this change | §6 |

## 1. For a New Session or Agent Picking This Up

Before starting:

1. Run `graphify query "PartMergeService mergeChildRecords createAliases part_exclusion"` for current code relationships.
2. Recall Hindsight with tags `forson-business-suite`, `part-merge` and query `part merge constraint failures October 2026`.
3. Confirm the status above against `git status`, recent commits, and the running environment. The audit counts are a snapshot, not a continuing guarantee about future data.

When changing this workflow, update this document, retain non-obvious decisions, and run `graphify update .`.

## 2. Objective and Context

Fix HTTP 500 errors from `POST /api/parts/merge/merge` for the supplied STLI, SILA, CLDI, and BRCY/BREX groups, and determine whether other merge candidates can encounter the same errors. The backend performs the merge in one transaction with part locks and before/after snapshots; failures roll back the transaction.

## 3. Diagnosis — As Built

Backend logs confirmed:

- `23505`, `part_tag_pkey`: survivor 2733 (`BREX-XHYX-0001`) has no tags, while sources 4483, 5505, and 6846 all carry tag 2. Removing only tags already on the survivor leaves three source rows competing for `(2733, 2)` during reassignment.
- `42P10` in `createAliases`: the STLI attempt reached `ON CONFLICT (alias_value, alias_type)`, but the live `part_aliases` table has only a non-unique lookup index on these columns. The historical creation migration defines a unique index; the reason that index is absent from this installation was not established. Every merge preserving source aliases encounters this invalid conflict target on that schema.

Related code review found that exclusion reassignment could create equal or reversed endpoints before its later cleanup. The live `chk_order` CHECK requires `part_id_1 < part_id_2`; `ON CONFLICT` cannot suppress CHECK violations. No exclusion rows touch the supplied groups, and the pending-group audit found no current exclusion-order failure cases.

## 4. Fixes and Decisions — As Built

- Tags: remove both survivor overlaps and surplus source rows before updating the remaining rows. Preserve one copy of every tag; respect `mergeTags: false`.
- Aliases: insert distinct incoming provenance records only when the same survivor/value/type/source tuple is absent. Use untargeted `ON CONFLICT DO NOTHING`, supporting installations both with and without the historical global unique index. Do not add a global uniqueness constraint as part of this bug fix: shared part numbers can have multiple source identities, and existing data need not satisfy global uniqueness.
- Exclusions: map endpoints, filter internal pairs before insertion, canonicalize with `LEAST`/`GREATEST`, and retain creation/source/reason metadata. Existing destination pairs win on conflict.
- Leave the historical-document, inventory, snapshot, and outbox policies in place. No migration or baseline-schema edit is needed.

## 5. Verification — As Built

Automated verification:

```bash
docker exec forson_backend_dev npx jest --config jest.config.js tests/partMergeService.test.js tests/partMergeConstraints.test.js --runInBand
docker exec forson_backend_dev npx eslint services/partMergeService.js tests/partMergeService.test.js tests/partMergeConstraints.test.js
```

The new constraint suite uses real PostgreSQL temporary tables inside transactions, shadowing public tables on its own connection. It covers source/survivor tag overlaps, disabled tag merging, both exclusion ordering directions and internal-pair removal, alias insertion with either index layout, idempotency, and shared alias provenance. Fixtures are rolled back.

Additional one-off verification used `/tmp/verify-part-merges.js` and `/tmp/verify-pending-part-merges.js`, piped to `docker exec -i forson_backend_dev node`. These scripts are session-local. They called the complete `executeMerge` workflow against existing data while intercepting its final COMMIT to inspect the resulting tag union, source retirement, and SKU aliases, then issuing ROLLBACK. Each run checked that the original parts remained unmerged afterward.

- Supplied IDs: `[2635,4630]`, `[668,702,703,704]`, `[1008,6374]`, `[6846,4483,2733,2982,5505]`.
- All 13 possible survivors across those groups passed.
- All 176 valid pending suggestion groups passed with every survivor choice: 372 workflows, zero failures or cycle-count blockers.
- Eleven pending groups share tags, but none currently has the precise source-only shared-tag arrangement that caused the supplied BREX failure. They were still vulnerable to the alias conflict-target error.
- The development API reloaded and reported that it was running on port 3001.

## 6. Explicitly Deferred

Production deployment and committing actual part merges are outside this bug fix. Operators can retry the merges through the development UI. This work does not determine why the historical alias unique index is absent, nor does it change global alias-uniqueness policy.

## 7. Files Touched

- `packages/api/services/partMergeService.js`
- `packages/api/tests/partMergeService.test.js`
- `packages/api/tests/partMergeConstraints.test.js`
- `docs/plans/2026-10-19_part-merge-constraint-fixes.md`
- Graphify generated outputs from the required incremental update.

## 8. Change Log

- **2026-10-19:** Confirmed live errors, repaired tag/alias/exclusion handling, added PostgreSQL regression coverage, and verified supplied and pending groups with rollback-only full merges.
