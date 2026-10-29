# Vehicle Fitment — Investigation-First Resolver and Relationship Integrity Plan

> Forson Business Suite | Date: 2026-10-29
> Planning branch observed: `vehicle-fitment-fixes-and-improvements`
> Status: Phase 0 investigation/design completed on 2026-10-29; see the [evidence and implementation contracts](./vehicle-fitment-phase0/README.md). Read-only development DB audit, offline parser checks and disposable real API/SQL fixtures executed. No application changes, migrations, commits or deployment.
> Related history: [Fitment parsing, linking and display](./2026-09-10_fitment-parsing-linking-display.md). Its historical completion claims must be rechecked; this plan does not reset or certify earlier work.

## 0. Status at a Glance

| Phase | Scope | Status |
|---|---|---|
| 0 | Actual code/database investigation, reproducible baseline, decisions and revised implementation contracts | Done: audit/mapping, baseline, decisions and contracts; 19 disposable API/SQL scenarios and 21 executable acceptance groups (10 integration oracles plus 11 parser baseline cases; 3 pass / 18 fail). Later-phase implementation and deeper verification pending. See [investigation](./vehicle-fitment-phase0/README.md) |
| 0.5 | Standalone hardening: code-only fixes independent of v2 schema (section 4.4) | Not started |
| 1 | Canonical identity, scoped relationships and safe migration | Not started; selected contracts in linked Phase 0 investigation |
| 2 | Clause-aware extraction, grounded resolution and candidate reconciliation | Not started; selected contracts in linked Phase 0 investigation |
| 3 | Review experience, authoritative save validation and reusable corrections | Not started |
| 4 | Selective sourced research and evidence registry (conditional: start only after Phases 1–3 show measured value, see section 8) | Not started |
| 5 | Integrated verification, measured improvement and staged rollout | Not started |
| Deferred | Production embeddings and mandatory additional AI judgment layer | Explicitly deferred; see section 10 |

The linked investigation is authoritative for current Phase 0 observations and selected technical contracts; later-phase prose here remains requirements. Documentation publication is not Phase 0 completion. All schema/table and API proposals below are provisional unless identified as current repository references. The implementer must investigate alternatives, document findings and choose the smallest maintainable change that satisfies the business rules. Do not mechanically create every conceptual entity proposed in discussion.

## 1. For a New Session or Agent Picking This Up

1. Read current `AGENTS.md`, relevant nested instructions, project system context if available, and the project plan-to-docs workflow. Verify branch, working tree, migration state and authorized development database before acting. Do not overwrite unrelated changes.
2. Use Graphify queries for current code relationships, then inspect actual source; the planning-session graph query returned an unrelated Android Application subgraph and is not evidence of the fitment flow. Recall Hindsight using `forson-business-suite`, `vehicle_fitment` and `fitment resolver`; missing memory access must not block the self-contained requirements here.
3. Start with Phase 0. Read the real database catalog and migrations, reproduce current behavior, and document findings before selecting a schema or modifying application behavior.
4. Maintain this document as work proceeds. If the available documentation tool is create-only, write a linked investigation/revision document and identify which version is authoritative. Do not conceal stale decisions in older sections.
5. After each phase, record itemized completed/pending work, evidence, changed contracts, risks and the next action. Distinguish code written, migrations applied, tests passed, live UI verified and deployed.
6. After code changes run `graphify update .` on the verified repository host. Store reusable non-obvious decisions in Hindsight, not duplicate call graphs or progress logs.

## 2. Business Objective and Required Outcomes

Make fitment entry accurate, understandable and non-repetitive while preserving fast local lookup. Support engine-only, model-only, chassis-based and qualified combined applications without fabricating complete vehicles or implying universal compatibility.

User stories:
- A partsman enters a shared-make model list and receives one canonical proposal per model, with missing specifications clearly marked.
- A receiver enters multiple engines without model details and links distinct engine-based claims without creating artificial vehicles.
- A clerk enters a chassis-based body/suspension application without being forced to specify an irrelevant engine.
- A reviewer sees why a proposal exists, its source clause, restrictions, evidence and existing-link status, then resolves uncertainty before approval.
- A maintainer can explain why the database design was selected and demonstrate improvement against the old behavior.

Non-negotiable principles:
- Relational identities and approved facts are authoritative. AI and embeddings retrieve or propose; they do not establish compatibility.
- Extraction, identity resolution, verified vehicle configuration and part compatibility are separate claims.
- Unknown is not unrestricted. Missing market is not worldwide; missing engine is not all engines; uncertain fuel is not the actual `other` fuel category.
- No automatic taxonomy creation, compatibility approval or bulk approval of unresolved combinations.
- Preserve original text, field provenance, meaningful variants, exclusions and human decisions.

## 3. Planning Evidence and Access Limits

At authoring, project MCP showed branch `vehicle-fitment-fixes-and-improvements` and an initially clean working tree. The recent log includes a fitment/year-range part-creation change; the implementing agent must inspect it rather than assume the historical manager is the sole entry point.

Repository search confirmed current references to `parseFitmentText`, `buildShortlist` and `mergeFitmentCandidates`; migration search found existing `engine`, `vehicle_engine_fitment`, and partial application uniqueness indexes in `database/migrations/20260909_02_vehicle_engine_master_data.sql`. This is a reason to evaluate reuse before replacement, not proof of live schema state.

Discovery starting points, not an exhaustive dependency map:
- `packages/api/helpers/fitmentTextParser.js`
- `packages/api/routes/partApplicationRoutes.js`
- `packages/api/routes/applicationRoutes.js`
- `packages/api/services/ai/features/vehicleFitmentParserAI.js`
- `packages/web/src/pages/PartApplicationManager.jsx`
- `database/initial_schema.sql`, `database/migrations/`
- Existing taxonomy index, engine grammar, model pools, JEV integration, application display/search helpers and newly changed part-creation flow: locate through current tools.

> Superseded (see Phase 0 investigation): the original authoring session had no live database, runtime reproduction or API test access. Phase 0 later obtained these against the development database and disposable fixtures; findings F01–F18 are now verified observations. Browser and provider checks remain unrun.

Original authoring-time note: previous concerns about grounding, inheritance and reconciliation are investigation hypotheses, not newly verified defects. Do not copy historical test counts or database counts as current evidence.

## 4. Phase 0 — Mandatory Investigation and Design Gate

Phase 0 execution record: [vehicle-fitment-phase0/README.md](./vehicle-fitment-phase0/README.md), including F01–F18, D01–D09, captured SQL/results, exact current parser outputs and the outstanding gate checklist. Phase0 investigation/design is complete; target implementation has not started. Red acceptance cases and deeper subchecks are tracked explicitly in the investigation.

### 4.1 Investigation scope

Perform read-only discovery against the authorized development database. Record database identity/environment without secrets, PostgreSQL version, migration status/drift, and actual columns, foreign keys, check constraints, unique/partial indexes, triggers and dependent views. If access is unavailable, record the blocker and arrange an approved copy/access path; do not invent schema results or mark this phase complete.

Investigate:
- End-to-end flows for part creation/edit, application manager, parser API, direct/manual application saves, alias learning, bulk operations, search indexing, display and relevant mobile consumers.
- How `application`, `part_application`, `engine`, legacy `vehicle_engine`, `vehicle_engine_fitment`, model/make and aliases actually relate; identify authoritative versus deprecated structures.
- Real duplicate identity patterns, alias ambiguity, orphaned relationships, mismatched parents, NULL uniqueness gaps, combined engine codes, repeated part links, contradictory specs and overly broad records. Use bounded aggregate/sample queries and redact sensitive data.
- Current engine-only, make-only, model-only and mixed application support. Determine whether existing tables already represent the desired scopes and where semantics, not schema, are the real gap.
- Candidate identity, local/AI merging, clause context, ID/name agreement, shortlist completeness, output schema enforcement, already-linked checks, dismissal state and save-time races.
- Whether learned aliases incorrectly turn a whole application phrase into a global entity alias; distinguish correction examples from identity synonyms.
- All consumers that may interpret NULL as wildcard, including SQL, search documents and UI filters. Determine evidence/approval behavior for legacy records.
- Existing research/provider adapters, citations, caching, budgets and evidence/retention terms. Do not adopt historical pricing/free-tier assumptions without checking current provider documentation.

Reproduce reported repeated suggestions and wrong inheritance on disposable/test fixtures and, read-only, the real taxonomy. Include the owner's literal input `TOYOTA HILUX, FORTUNER, HI-ACE`. Capture actual current output and expected differences. Record failures honestly; synthetic engine/chassis examples are illustrative, not real compatibility evidence.

### 4.2 Required investigation documentation

Record findings incrementally, not retrospectively after implementation. Use this structure in the plan or a linked repository investigation document:

| Finding ID | Question/hypothesis | Source or query/test | Observed result | Operational impact | Decision/action | Verification status |
|---|---|---|---|---|---|---|

For every material decision record: decision ID, problem, alternatives, chosen approach, supporting code/database evidence, rejected alternative, trade-offs, migration impact, expected measurable improvement, validation method and remaining uncertainty. Link relevant artifacts rather than duplicating function inventories. State whether a choice is proposed, accepted, superseded or blocked.

Required Phase 0 outputs:
- Current-state summary and reproducible baseline with actual outputs.
- Relationship diagram and field semantics for the selected design.
- Existing-to-target mapping and data-quality/duplicate report.
- Evidence-backed decisions: reuse versus extend versus replace existing applications; unknown/unrestricted representation; uniqueness/null handling; canonical entity keys; scoped aliases; qualifiers/exclusions; legacy treatment; permissions; research architecture.
- Exact migration and API/UI contracts for later phases: real paths, affected tables, FK/index/check designs, request/response schemas, validation and error behavior, compatibility and rollback.
- Before/after measurement plan with agreed thresholds, fixtures, environment and command list.
- Updated implementation phases, dependencies, acceptance criteria and explicitly deferred items.

### 4.3 Gate and authority

Do not begin application/schema implementation until those outputs are documented and mandatory behavior is covered by executable acceptance cases. Phase 0 may add documentation and isolated reproducibility/test artifacts, but must not mutate production or silently clean live data. Run potentially destructive tests only in a disposable database.

The implementing agent may decide ordinary implementation details after recording evidence. Obtain owner approval before broadening scope, destructive/irreversible data changes, semantic reinterpretation of legacy fitments, material recurring paid services, or weakening the safeguards here. If blocked, continue independent discovery and report the exact missing prerequisite; do not claim complete investigation.

### 4.4 Phase 0.5 — Standalone hardening (code-only, no v2 schema)

Verified Phase 0 defects that need no new tables and should ship ahead of the v2 work, each with a regression test taken from the Phase 0 baseline:
- F18: release/avoid post-commit pool acquisition in link saves (use the transaction client for the outbox).
- F09: enforce `applications:edit` on staged part-create, purchase-line catalog and bulk link writers; reject atomically.
- F10: duplicate/no-op link saves return an explicit existing outcome and do not widen `vehicle_engine_fitment` years.
- F06: validate ID/name/parent agreement on application writes.
- F11: engine search must not match through a model association when the application names a different engine.
- F01: stop carrying years/displacement/fuel across clauses unless wording establishes scope.
- F12: reject whole-phrase global alias learning.

Constraints: development environment only. **No record fixing here**: the Toyota Hiace (14/29), Isuzu D-Max (23/81) and engine 1NRFE/1NR-FE (11/15) mappings, and any legacy data change, are owner-run on an authorized environment after rehearsal, never in dev. Code fixes must handle the duplicates safely (unresolved choice, no guessed ID) rather than clean them. Exit: the relevant Phase 0 baseline cases turn green without schema changes; run the full API tests and `graphify update .`.

## 5. Phase 1 — Canonical Identities and Scoped Relationships

### Design requirements; physical schema to be finalized in Phase 0

Separate canonical make/model/generation/chassis identities, canonical engine identities, verified vehicle-engine configurations, and part-application claims/rules. Engines are independent of models; vehicle make and engine manufacturer are not interchangeable. A full vehicle-configuration table is optional if existing relationships suffice. Do not create empty generations/families or a generic rule engine merely to match the conceptual diagram.

Support engine-only, model/generation-only, chassis-only, qualified combined, and carefully governed make-level claims. Atomic engines remain distinct; family membership does not imply member compatibility. Do not expand an engine-only claim to every vehicle using that engine or generate Cartesian products of engines/models/drivetrains.

Within a rule qualifiers combine with AND; separate positive application alternatives combine with OR. Preserve explicit exclusions with defined precedence and prevent a broader inclusion from masking them. Unknown queried qualifiers yield Needs details, not confirmed compatibility. Explicitly unrestricted scope requires supporting evidence and approval; incomplete source descriptions remain review claims.

Use typed foreign keys and structured core qualifiers where practical. Select an explicit representation for specified/unrestricted/not-supplied semantics; do not rely on a bare NULL wildcard. Derive parent make/model where appropriate or enforce consistency when retained. Scope engine/chassis identifiers by their real namespace and variants; do not impose unverified global uniqueness.

### Migration and cleanup safeguards

- Reuse existing taxonomy and applications where appropriate; document exact differences before adding tables.
- Build a dry-run old-to-canonical mapping; no automatic fuzzy engine merges or meaningful suffix stripping.
- Repoint dependent relationships atomically, deduplicate only semantically identical links/rules, preserve provenance and retain merge/audit mappings.
- Define null-aware semantic uniqueness and concurrent insert behavior at database and API boundaries. Do not rely only on an application fingerprint/hash or client checks.
- Preserve restrictive differences, history, raw text and unresolved legacy claims. Never bulk certify old rows merely because they exist.
- Add idempotent migrations following current naming/checksum conventions; keep baseline schema aligned only through matching migrations. Verify on a disposable copy, compare relationships before/after, test rerun and rollback/forward recovery.

Exit: identity and scope cases work without fake vehicles, no unintended fitment expansion, duplicate prevention is race-safe, and all affected consumers have a migration/compatibility path.

## 6. Phase 2 — Clause-Aware Resolver and Reconciliation

Pipeline: original text → clause-aware extraction → exact/approved alias lookup → relevant coherent candidates and approved corrections → AI fallback for unresolved wording → executable schema/domain validation → interpretation reconciliation → semantic deduplication → existing-link detection → uncertainty classification.

Required behavior:
- `TOYOTA HILUX, FORTUNER, HI-ACE` resolves to Toyota Hilux, Toyota Fortuner and canonical Toyota Hiace where approved taxonomy supports them. Shared make is validated against parent relationships. Engine, fuel, displacement, years and chassis stay not supplied. These are model-level claims, not all-variant compatibility certification.
- Multiple named engines resolve individually without inventing models. Preserve exact variants and approved engine grammar; near engine codes cannot be auto-substituted by fuzzy/vector similarity.
- Share make in coherent lists; share years/engine/fuel only when wording explicitly establishes scope. A phrase saying 'same years' does not automatically say 'same engine/fuel'. Mark ambiguous trailing qualifiers rather than distribute blindly.
- Use canonical IDs and verify ID/name/parent agreement. A valid but incorrect existing ID must fail validation. Canonical labels come from the database, not model wording.
- Preserve source spans/clauses and field provenance: explicit text, approved alias, approved stored fact, contextual resolution, or unresolved inference.
- Reconcile same-clause alternatives: identical interpretation merges evidence; uncertain local versus corrected AI interpretation is resolved or exposed as mutually exclusive alternatives. Do not merely concatenate both.
- Unknown is not equivalent to unrestricted. Do not automatically merge broad/specific or overlapping-year claims, remove exclusions, or discard separate source clauses just because the strings resemble each other.
- Return one unique proposal per true application; already-linked proposals are visibly non-addable. Dismissed proposals do not reappear in the same review absent changed input or new evidence, with a reason shown.

Exit: baseline repeated-suggestion and inheritance failures become passing regressions without losing legitimate distinct applications.

## 7. Phase 3 — Review, Save Contracts and Knowledge Reuse

Extend existing UI flows rather than introduce a parallel application module. Inspect current part-creation and manager surfaces; preserve compact mobile/desktop and keyboard workflows.

Show canonical entities, scope, missing qualifiers, original text, rationale, provenance, sources, conflicts and already-linked status. Separate identification from compatibility verification. Suggested states: Sourced suggestion, Needs review, Unresolved, Already linked. Keep approval lifecycle separate from these display states. Uncertain alternatives are not preselected for bulk save.

Distinguish linking approved applications, creating taxonomy, correcting extraction, approving identity aliases, and approving compatibility. Staff confirmation of extraction is not external verification. Store approved correction examples separately from aliases and reject context-unsafe/global alias learning.

Phase 0 must finalize route names and exact contracts by adapting existing routes. Required operations and payload semantics:
- Parse/reconcile: input text, optional part context and review version; output stable candidate/alternative identities, canonical IDs, field scope/provenance, raw spans, existing links, issues and evidence status.
- Research: a precise candidate claim plus identifiers and missing evidence; output queued/completed/failed status, citations and supported/contradicted/insufficient assessment without silently approving.
- Approve/link: explicit reviewed candidate/rule identity, part, canonical IDs, qualifiers, evidence references and concurrency/version token; output saved/existing/conflict/needs-review outcomes.
- Corrections/aliases: distinct reviewable operations, scope and audit trail; no compatibility creation as a side effect.

Server revalidates every save path, not just parser callers: identity, relationships, restrictions, authorization, review/evidence requirements, duplicates, stale edits and concurrent requests. Define retry/idempotency semantics and atomic writes. Derive permissions from existing permission keys; seed new keys only if required. Never trust client-owned verification flags. Preserve raw claims, reviewer, timestamps and changes.

Exit: API contract and authorization tests, retry/race tests and real browser review prove safeguards cannot be bypassed through direct calls or alternate entry points.

## 8. Phase 4 — Selective Research and Evidence Registry

Conditional: begin only after Phases 1–3 are verified and the acceptance corpus shows that unresolved terms or unsupported relationships remain a material staff burden. Phases 1–3 must not depend on it. Internet search is for unknown identifiable terms (for example an unlearned model or engine name): it returns cited, staff-reviewed suggestions only. It never creates taxonomy, aliases or compatibility automatically.

Research only after local resolution for unknown identifiable terms, unsupported relationships, material conflicts, unclear restrictions or exact branded part-number application verification. Formatting uncertainty goes to extraction; missing vehicle identifiers go to staff. Keep research off every keystroke and the checkout critical path.

Check reusable approved evidence first; fetch known authoritative URLs directly. Deduplicate equivalent queued questions without conflating different markets, years, restrictions or parts. Bound queries, retries, latency and spending; provider fallback must retain citations and respect quotas/terms, not bypass them.

Store where permitted: exact claim, canonical references, source URL/title, supporting passage, scope, retrieval date, reviewer/approval, contradictory evidence and invalidation/research reason. Distinguish an engine-model association from evidence that a particular part fits. Search snippets/model agreement are not sufficient approval evidence. No results means unresolved, not nonexistent.

Keep search/fetch adapters separate from extraction models. Use existing model-pool infrastructure if suitable; do not introduce an extra service solely for orchestration. Treat fetched content as untrusted data. Guard server fetches against SSRF/private network access, redirects, excessive payloads and timeouts; do not send sensitive business/customer data to providers.

Investigate current provider/source storage permissions before persistent reuse, especially Google search-grounding restrictions. Free generation does not imply free search. Record current checked terms/pricing in the investigation rather than prescribing an unverified provider.

Evaluate the existing JEV integration selectively on supplied evidence with Supported, Contradicted and Insufficient outcomes. It must not assert facts from memory, override hard conflicts or create/approve records. Shadow comparison is allowed; mandatory use is deferred until measured benefit justifies latency/cost. Local/manual entry remains usable during provider failures.

## 9. Phase 5 — Verification, Improvement Evidence and Rollout

### Acceptance matrix

| Case | Required result |
|---|---|
| Shared Toyota model list | Canonical models, validated shared make, no invented specs |
| Repeated text/aliases/local+AI same interpretation | One semantic proposal with merged provenance |
| Existing link, repeated request, concurrent save | No duplicate link/rule; explicit existing/conflict outcome |
| Engine-only multiple engines | Atomic engine applications; no fabricated models or automatic vehicle expansion |
| Chassis-only non-engine part | Chassis scope retained; no mandatory irrelevant engine |
| Make-only source | Broad claim; not universal compatibility unless explicitly evidenced |
| Conflicting parent or valid-but-wrong ID | Rejected or unresolved; no silent coercion |
| Unknown versus unrestricted | Different semantics; no wildcard from missing text |
| Different variants/exclusions/positions/years/market | Meaningful distinctions preserved |
| Paired chassis/engine alternatives | No Cartesian-product compatibility |
| Ambiguous clause/trailing qualifier | Explicit uncertainty; no blind inheritance |
| Incorrect legacy relationships | Flagged/reviewed, not promoted to truth |
| Changed data or stale review | Revalidation and conflict handling |
| Alias learning | Scoped identity synonyms only; full corrections remain corrections |
| No research result/provider outage | Unresolved plus usable manual/local workflow |
| Direct unauthorized API/bulk save | Server blocks without partial unauthorized mutation |
| Real taxonomy and new taxonomy writes | Coverage/disambiguation and cache invalidation verified |
| Search/display after migration | Canonical atomic facts indexed; display compression never alters identity |

Use pure parser tests, API integration tests against a disposable real PostgreSQL database, migration rehearsal, concurrency tests and browser checks. Include representative real store samples, ambiguous negative cases and historical engine/display round-trip regressions. Clearly distinguish fixture-based tests from actual-taxonomy checks.

Measure before/after using the same corpus/environment: duplicate suggestion rate, unsupported approvals, field accuracy, restriction loss, staff corrections, local-resolution rate, lookup/parse p50/p95, research requests and cost per approved relationship. Define denominators and sample limitations. Target zero false confirmations and restriction loss in the acceptance corpus, and zero duplicate saves under the concurrency suite. Ordinary indexed part/fitment lookup has a sub-100 ms service target measured separately from network AI/research latency; finalize realistic parser/research budgets in Phase 0. Do not claim a percentage gain without execution evidence.

Roll out additively/behind flags where justified, shadow compare old/new outputs, migrate on an authorized environment only after rehearsal, verify index/outbox consumers and maintain a rollback/disable path. No automatic production deployment or data reset is authorized by this planning request.

## 10. Explicitly Deferred

- Embedding all fitments or replacing relational matching with vectors. Revisit only if lexical/alias retrieval benchmarks expose a measurable gap; candidate retrieval cannot certify compatibility.
- Mandatory additional judgment/model layers. Revisit after shadow evaluation of the existing integration.
- A complete global vehicle/VIN catalog, automatic exhaustive configurations, bulk external catalog ingestion, and unrelated ERP refactors.
- A generic taxonomy-merge administration module unless Phase 0 proves it is necessary for this scope. Safe targeted cleanup and prevention are included; UI scope expansion requires an explicit decision.

Deferred means deprioritized, not an unstarted required phase. Unknowns required for safe implementation belong in Phase 0's blocker list instead.

## 11. Required Implementation and Verification Record

For each phase maintain:
- Status: Done / Partially done with checked and pending substeps / Not started / Not verified.
- Findings and decision IDs; updated schema/API/UI contracts and deviations from this plan.
- Files/migrations actually changed, environment applied to, audit/mapping artifacts and rollback steps.
- Commands run, real outputs or concise result references, failures, blockers and checks not run.
- Measured improvements and remaining risks; next exact action.

Planning-session footprint: this document only. The paths in section 3 are inspection starting points, not files changed by this handoff. No application code, database migrations or model configurations were changed. Repository documentation persistence does not imply a Git commit. Remote `graphify update .` was not run: no verified remote execution tool was available.

Candidate verification commands from current root instructions, to confirm against actual package scripts/environment before use: `npm run -w packages/api test`, `npm run -w packages/api lint`, `npm run -w packages/web lint`, migration status/verify commands from `AGENTS.md`, relevant web build/browser tests, and `graphify update .`. None were run for this planning handoff. Never run reset scripts on a real business database.

## 12. Change Log

| Date | Change |
|---|---|
| 2026-10-29 | Created investigation-first handoff consolidating resolver accuracy, semantic deduplication, scoped vehicle/engine relationships, review safeguards, evidence reuse and selective research. Phase 0 must select and document the actual implementation against current code and database before later phases begin. |
| 2026-10-29 | Investigated Phase 0 against local development PostgreSQL and actual parser/validator/merge functions; linked evidence, complete preserving identity mapping, design contracts, measured baselines, 19 disposable API/SQL reproductions (including pool starvation and staged-link authorization bypass) and explicit later-phase verification limits; completed Phase0 discovery/design without application implementation. |
