# Vehicle Fitment — Parsing, Linking & Display — PRD & Developer Handoff

> **Forson Business Suite** | **PRD-FBS-FIT-002** | **Version:** 1.0
> **Date:** 2026-09-10 | **Branch:** `parts-fitment-improvement`
> **Status:** Phases 6-9 all built (2026-09-10), uncommitted in git as of this doc. Migrations applied on the dev DB. Verified by 44 API unit tests, 11 web unit tests, a live run of the parser against the real taxonomy, and a production build. **Not yet verified by live browser click-through** -- see §10.
> **Predecessor:** [`2026-09-09_vehicle-fitment-improvement.md`](./2026-09-09_vehicle-fitment-improvement.md) (PRD-FBS-FIT-001, Phases 0–5 — all built). This document is the follow-on effort and continues its phase numbering at Phase 6.

---

## 0. Status at a Glance

Read this first. It is the only section that changes often — update it as phases land.

| Item | Status | Reference |
|---|---|---|
| Phase 6 — Engine identity cleanup + alias infrastructure | **Done** | §6 |
| Phase 7 — Deterministic local fitment parser (no AI on the happy path) | **Done** | §7 |
| Phase 8 — AI demoted to shortlist fallback + alias learning loop | **Done** | §8 |
| Phase 9 — Display-only engine-code compression (`4D55/56`) | **Done** | §9 |
| Phase 9c — Shared-SUFFIX compression (`1GD/1KD/2KD-FTV`) both sides | **Done** | §9c |
| Phase 10 — Dense display: shorthand dictionary, short years, dropped make | **Done, not yet enabled per preset** | §10 |
| Which density option each surface uses (A–F) | **Awaiting the user's pick** | §10c |
| Splitting legacy `4D55/56/65` (engine_id 8) into three rows | **Done** — fanned out to 3 applications, 0 part links affected | §6.1 |
| Keeping Meilisearch index atomic (never store compressed codes) | **Done** — index untouched; compression is render-only | §9.4 |
| Live browser click-through of the review panel | **Not done** | §10 |
| Real staff input samples to tune segmentation + seed aliases | **Still open — needs the user** | §11 |
| Taxonomy self-growth (new makes/models/engines usable immediately) | **Working** — verified end to end | §7.1 |
| Duplicate model rows (`D-Max`/`DMAX`, `Hiace`/`HI-ACE`) blocking those names | **Known, not fixed** — needs the merge tool | §0, §12 |
| Displacement for `4D55` and `4D65` | **Left NULL deliberately** — not confidently known | §6.1 |
| Taxonomy dedupe/merge tool | **Still deferred** (inherited from FIT-001 §10) | FIT-001 §10 |
| Bulk CSV import/export of part-to-vehicle mappings | **Still deferred** (inherited from FIT-001 §10) | FIT-001 §10 |

**Ready for next phase?** All four phases are built and verified by tests. The two open items are the live browser click-through (§10) and the real staff input corpus (§11), which is the only thing genuinely blocked on the user.

**Taxonomy coverage, measured against the real dev DB (2026-09-10, after the §9b fixes):** every make/model/engine typed verbatim resolves except:

- **6 of 273 engine codes** — `1.2`, `1.5`, `2L`, `3L`, `5L` (deliberately excluded, see §7.3) and `BYD476ZQC + Dual Motors` (the `+` is read as a clause separator).
- **8 of 155 model names** — all genuine ambiguity, not parser defects: `Ranger` (Ford *and* Hino), `Rosa` (Mitsubishi Fuso *and* Hino) are real cross-make homonyms that resolve correctly once a make is given; `D-Max`/`DMAX` (both Isuzu) and `Hiace`/`HI-ACE` (both Toyota) are **duplicate taxonomy rows — a data-quality problem needing the deferred merge tool** (§12).

Escalations to AI carry a shortlist rather than the full taxonomy: for two sample residues the grounding dropped from 20 makes / 155 models / 272 engines to 1/6/4 and 7/8/8.

---

## 1. For a New Session or Agent Picking This Up

**Before starting:**

1. Run `graphify query "vehicle fitment parsing and application linking"` and
   `graphify explain "engine taxonomy"` for a current view of the code structure.
   File references in this document can drift — trust a fresh query over old prose.
2. Call hindsight `recall` with a narrow query such as
   `"vehicle fitment engine code parsing"`, tags `["forson-business-suite", "vehicle_fitment"]`.
   That holds the non-obvious rationale not duplicated here.
3. Read the predecessor doc `docs/plans/2026-09-09_vehicle-fitment-improvement.md`
   (§3 Decisions Already Taken, §5 Architecture, §15 Phase 5 As Built) — this
   document assumes that schema and the existing AI parser exist.
4. Confirm the Status at a Glance table above is still accurate against
   `git log --oneline -20`. If commits touching fitment exist that aren't
   reflected here, this document is stale — update it before relying on it.

**When you finish a phase or make a non-obvious decision:**

1. Update the Status at a Glance table and the relevant phase section.
2. Retain new architectural decisions/gotchas to hindsight (not things merely
   visible in the diff), tagged `["forson-business-suite", "vehicle_fitment"]`.
3. Run `graphify update .` so the next query reflects your changes.

---

## 2. Business Objective & Operational Value

### Problem

Phase 5 (FIT-001 §15) shipped AI-assisted natural-language fitment entry. It
works, but it is **AI-first for every single input**. Two structural costs
follow from that:

1. **The prompt carries the entire taxonomy on every call.**
   `vehicleFitmentParserAI._loadGroundingData()` reads *all* makes, *all* models
   and *all* engines and formats them into the prompt. That is currently 20
   makes, 155 models and 271 engines, and it grows monotonically as the catalog
   grows. Latency and cost both scale with catalog size rather than with input
   complexity.
2. **The easy cases pay the same price as the hard ones.** Most real staff input
   is highly regular — a known model, a year range, a displacement, a known
   engine code. None of that requires a language model, and sending it to one
   makes entry slower and non-deterministic (the same text can parse differently
   on two attempts, which erodes staff trust in the review panel).

There is a third, sharper problem specific to **engine codes**. Staff write
compressed forms like `4D55/6`, `4JA1/B1`, `4JA1-T`, `JT`. These look messy but
are in fact the *most* rule-governed part of the input — and they are exactly
where an LLM is most dangerous, because asked to expand `4JA1/B1` it will
readily produce plausible-but-nonexistent engine codes.

### Solution

Three coordinated changes:

- **Parsing:** a deterministic local parser handles the regular majority in
  microseconds with zero hallucination risk. AI is demoted to a fallback for
  genuine residue only, and when it *is* called it receives a small shortlist
  prompt instead of the whole taxonomy.
- **Linking:** engines stay atomic. Every engine is its own row and is linked to
  a part individually, because a part that fits a 4D55 does **not** necessarily
  fit a 4D56. The one legacy row that violates this gets split.
- **Display:** similar engine codes on the same part are recombined into
  shorthand (`4D55/56`) **purely at render time**, so the UI stays readable
  without the shorthand ever entering the schema, the API payload, or the
  search index.

---

## 3. Decisions Already Taken (do not relitigate)

1. **Deterministic-first, AI-as-fallback — not AI-removal.** The AI path stays
   for genuinely ambiguous free text. It stops being the default entry point.

2. **Engines are stored atomically and linked individually.** `4D55/6` in staff
   input means *two distinct engines*, resolved to two `engine` rows and two
   `application` links. It does **not** mean one "engine family" row.
   *Rationale:* a part fitting a 4D55 does not always fit a 4D56. A merged
   family row would assert a fitment that was never true and could not later be
   corrected without unpicking the merged row. This was explicitly weighed
   against the alternative (one family row, slash form canonical) and rejected.

3. **Combining/abbreviating engine codes is a display concern only.** The
   compressed form is never stored, never submitted, never exported, and never
   indexed. See §9.

4. **Variant suffixes are distinct engines, never collapsed.** `4JA1` and
   `4JA1-T` are a naturally-aspirated and a turbo engine. The seeded taxonomy
   already models these as separate rows (`4JA1-L`, `4JH1-TC`, `4JJ1-TCX`,
   `4D56-HP`, `1KR-VET`, `WL-T` — 53 of 271 engine codes carry a variant
   suffix). Neither the parser nor the display formatter may treat a variant
   suffix as noise.

5. **Engine codes are never fuzzy-matched.** `4D56` and `4D55` are edit distance
   1 and are different engines. Engine resolution is exact-match or
   alias-match only. Model names may tolerate limited fuzziness; makes barely
   need it.

6. **A grammar proposes, the gazetteer disposes.** Every expansion produced by
   the slash grammar must be confirmed against an existing `engine` row before
   it is offered. An expansion matching nothing becomes a review candidate,
   never a silent invention.

7. **When in doubt, emit `null` and let a human resolve it.** A confidently
   wrong match is worse than no match. This mirrors the existing rule in
   `vehicleFitmentParserAI._validateResult` — the local parser is *also*
   untrusted and only proposes; the review panel remains mandatory.

8. **The review panel and existing ID re-validation stay exactly as they are.**
   No auto-commit is introduced by any phase in this document.

---

## 4. Real-World Domain Model

The input staff type is a compressed description of a **set** of fitments:

```
"Fits Hilux 2005-2015 2.5L Diesel, also Fortuner same years"
  → 2 fitments; the second inherits make and year range from the first

"4D55/6"          → 2 engines: 4D55, 4D56
"4JA1/B1"         → 2 engines: 4JA1, 4JB1
"4JA1-T"          → 1 engine, distinct from 4JA1 (turbo)
"JT"              → 1 bare short code; resolvable only by exact match or alias
```

Two distinct compressions are in play and must not be confused:

- **Clause-level compression** ("also Fortuner same years") — carries context
  forward across clauses. Handled by segmentation (§7.2).
- **Token-level compression** (`4D55/6`) — an enumeration of codes packed into
  one token by right-aligned overlay. Handled by the engine grammar (§7.3).

The display formatter in Phase 9 is the exact inverse of token-level
compression, which gives a testable round-trip property (§9.3).

---

## 5. Architecture — Where the New Code Lives

There is **no shared package** in this repo (`packages/` holds only `api`,
`web`, `mobile`), so parser and formatter are separate implementations on each
side, each following its local convention.

| Concern | Location | Notes |
|---|---|---|
| Taxonomy index + cache | `packages/api/helpers/vehicleTaxonomyIndex.js` (new) | Replaces the 3 per-request queries in `_loadGroundingData` |
| Deterministic parser | `packages/api/helpers/fitmentTextParser.js` (new) | **Pure** — no DB, no network. Taxonomy-in / candidates-out, so it is fully unit-testable |
| Engine code grammar | `packages/api/helpers/engineCodeGrammar.js` (new) | Slash expansion + normalization. Also pure |
| AI fallback | `packages/api/services/ai/features/vehicleFitmentParserAI.js` (existing) | Modified: shortlist prompt instead of full taxonomy |
| Route orchestration | `packages/api/routes/partApplicationRoutes.js` (existing) | Local parse first, escalate residue |
| Display formatter | `packages/web/src/utils/engineCodeFormat.js` (new) | Follows the existing `packages/web/src/utils/*.js` convention (`receiptNumberFormatter.js`, `currency.js`, …) |

Keeping the parser and grammar **pure** is deliberate: it is what makes the
engine-code rules cheap to test exhaustively, which is where the correctness
risk actually concentrates.

For anything else about current structure, run
`graphify query "vehicle fitment parsing"` rather than trusting a file list here.

---

## 6. Phase 6 — Engine Identity Cleanup + Alias Infrastructure — As Built

Do this first. It is small, and Phases 7–8 depend on the alias tables.

### 6.1 Split the legacy `4D55/56/65` row

`engine_id = 8`, `engine_code = '4D55/56/65'` is a single row holding three
engines — it directly contradicts Decision 2, and it is the one row that would
let a part recorded as "fits 4D55" silently claim it fits a 4D65.

**As built:** `20260910_01_split_engine_families.sql`. `4D55` and `4D65` were
created (`4D56` already existed as engine_id 61); the single family application
fanned out to three; the family engine row was deleted; and a
`engine_code_no_slash_chk` CHECK constraint now prevents any slash-coded engine
from being reintroduced through the taxonomy UI. Post-migration the database has
0 slash-coded engines and `part_application` was unchanged at 23 rows.

**Deliberate departure from the original plan:** the first draft of the
migration copied the family row's 2.50L displacement onto all three members.
That was wrong -- 2.50L describes the 4D56 only -- and it would have replaced one
inaccurate assertion with three. The migration now backfills 4D56 alone and
leaves `4D55` and `4D65` NULL, matching the precedent in
`20260909_05_engine_displacement_fuel_type.sql` of leaving uncertain specs empty
rather than guessing. **Someone with the reference data should fill these two
in.**

**Verified on the dev DB (2026-09-10) before writing the migration:**

```
engine_id | engine_code | apps | part_links
        8 | 4D55/56/65  |    1 |          0
```

One `application` row references it and **zero `part_application` rows** do. No
part fitment data has to be fanned out — the migration only has to repoint or
duplicate a single application row. **Re-run the verification query in §10
before writing the migration**; if `part_links` is no longer 0, fan each
existing part link out to all three engines (that is the honest reading of the
original intent) and say so in the migration comment.

Migration steps (filename per the project convention —
**Asia/Manila date**, e.g. `20260910_01_split_engine_families.sql`):

1. Ensure `4D55`, `4D56`, `4D65` each exist as their own `engine` row
   (case-insensitive insert-if-missing, matching the additive style of
   `20260909_07_seed_vehicle_taxonomy.sql`).
2. Fan the single `application` row out to the three engine ids, respecting the
   partial unique indexes from `20260909_02` (`ON CONFLICT DO NOTHING`).
3. Fan out `part_application` links only if the count above is non-zero.
4. Delete `engine_id = 8`, then record `4D55/56/65` as an **alias** (§6.2) so
   staff typing the old form still resolve instantly.
5. Guard against reintroduction: a `CHECK` on `engine.engine_code` rejecting
   `/`, or — if that is too strict for a genuine future code — a comment plus a
   data-quality query in §10. Prefer the CHECK; nothing in the seeded 271 codes
   contains a slash.

### 6.2 Alias tables

Three tables, same shape, following existing migration style:

```sql
vehicle_make_alias  (alias_id, make_id  FK, alias_text, source, created_at)
vehicle_model_alias (alias_id, model_id FK, alias_text, source, created_at)
engine_alias        (alias_id, engine_id FK, alias_text, source, created_at)
```

- `alias_text` is stored **normalized** (§7.3) with a case-insensitive unique
  index per table, so lookup is an exact hit on the normalized form.
- `source` distinguishes `'seed'` from `'learned'` (§8.3) — needed so a bad
  learned alias can be pruned without touching the curated seed set.
- Seed with market shorthand: `Mits`/`Mitsu` → Mitsubishi, `Chevy` → Chevrolet,
  `Fuso` → Mitsubishi Fuso, `Nissan Diesel`/`UD` → UD Trucks / Nissan Diesel,
  plus `4D55/56/65` → the three split engines. **Ask the user to review the
  seed alias list before committing it** — this is business vocabulary, not a
  technical choice.

### 6.3 Acceptance

- `SELECT * FROM engine WHERE engine_code ~ '/'` returns 0 rows.
- No `part_application` row lost a fitment (compare counts before/after).
- Alias lookup for `4D55/56/65` returns all three engine ids.

---

## 7. Phase 7 — Deterministic Local Parser — As Built

Pure module. No AI. Handles the regular majority of input.

### 7.1 Taxonomy index (`vehicleTaxonomyIndex.js`)

Load makes, models, engines, and the three alias tables **once** into normalized
lookup maps; cache in memory; invalidate on any taxonomy write (the routes that
create makes/models/engines already exist — hook invalidation there) with a TTL
as a backstop. The taxonomy is small enough (20 / 155 / 271) that this is
trivially affordable, and it also speeds up the AI path by removing the three
per-request queries in `_loadGroundingData`.

### 7.2 Segmentation and context carry-forward

Split input on `;`, newlines, `,`, ` and `, `also`, `+` into clauses. Each
clause yields one candidate fitment. A clause **inherits** unstated
make/model/year from the preceding clause:

```
"Hilux 2005-2015 2.5L diesel, also Fortuner same years"
  → {model: Hilux,    year: 2005-2015, disp: 2.5, fuel: diesel}
  → {model: Fortuner, year: 2005-2015, disp: 2.5, fuel: diesel}   ← inherited
```

This is where most real-world messiness lives, and it is pure logic.

### 7.3 Engine code grammar (`engineCodeGrammar.js`)

**Normalization.** Uppercase, collapse whitespace. Normalize
`4JA1 - T` / `4JA1T` / `4JA1-T` to one form. **Never strip the hyphen segment
itself** — `4JA1` must stay distinct from `4JA1-T` (Decision 4).

**Token shape.** Find candidate spans with roughly
`\b\d?[A-Z]{1,4}\d{0,3}[A-Z]?(?:\s*[-/]\s*[A-Z0-9]{1,5})*\b`, then hand each
span to the resolver.

**Resolution order:**

1. **Exact gazetteer hit on the raw token first.** Cheap, and it respects codes
   staff have already entered verbatim. (After Phase 6 no slash codes remain in
   `engine`, but this ordering keeps the parser correct regardless.)
2. **Exact alias hit.**
3. **Slash expansion — right-aligned overlay.** One rule covers every observed
   form:

   ```
   expand(base, suffix) = base.slice(0, base.length - suffix.length) + suffix

   4D55 / "6"   → 4D5 + 6   → 4D56
   4JA1 / "B1"  → 4J  + B1  → 4JB1
   4D55 / "56"  → 4D  + 56  → 4D56
   4D55 / "65"  → 4D  + 65  → 4D65
   ```

   Each `/`-segment overlays onto the **original base**, not onto the previous
   expansion. Every expansion must then confirm against an existing `engine`
   row (Decision 6); one that matches nothing is emitted as a review candidate
   with a `null` id, never invented.
4. **Variant suffixes (`-T`, `-TC`, `-TCX`, `-L`, `-HP`, `-FE`, …): exact or
   alias only.** Never shave a suffix to reach a base code.
5. **Bare short codes (`JT`): exact or alias only, never fuzzy.** Two characters
   cannot be fuzzy-matched safely (`JT` / `JX` / `4JT`). If unresolved, it goes
   to human review — an LLM cannot usefully guess this either; only a person can
   say which engine `JT` is. This is the case where Phase 8's learned aliases
   pay off most.

### 7.4 The dimensions that need no matching at all

Pure regex, no gazetteer:

- **Years:** `2005-2015`, `2005 to 2015`, `'05-'15`, `2015+`, `up to 2018`
- **Displacement:** `2.5L`, `2.5 liter`, `2500cc`, bare `2.5`
- **Fuel:** diesel / gas / gasoline, plus market shorthand `CRDi`, `TDi`,
  `dCi`, `D4D`, `EFI` → map onto the existing
  `engine_fuel_type_chk` values (`diesel`, `gasoline`, `hybrid`, `mild_hybrid`,
  `electric`, `other`) from `20260909_05`.

### 7.5 Make / model matching

Exact → normalized (case, hyphens, spaces: `Hi-Lux` → `HILUX`, `L 300` → `L300`)
→ alias → limited fuzzy (trigram or Levenshtein ≤2, **only** for tokens ≥5
chars). Longest-span-first so multi-word models (`Grand Vitara`, `Canter`) win
over their first token.

**Disambiguation prior:** when a dimension is ambiguous (e.g. bare `2.5`),
prefer the engine that already co-occurs with the resolved make/model in
existing `part_application` rows. This is data the system has and the LLM does
not.

### 7.6 Output contract

The local parser must emit **the same row shape** that
`vehicleFitmentParserAI._validateResult` already returns (`make`, `make_id`,
`model`, `model_id`, `engine`, `engine_id`, `displacement_liters`, `fuel_type`,
`year_start`, `year_end`, `confidence`), so the existing review panel in
`PartApplicationManager.jsx` renders local and AI results interchangeably with
no UI branching.

### 7.7 Acceptance

- A unit-test table covering, at minimum: `4D55/6`, `4JA1/B1`, `4JA1-T`, `JT`,
  `4D55/56/65`, `4JJ1-TCX`, plus the carry-forward example in §7.2.
- Round-trip test against the Phase 9 formatter (§9.3).
- A corpus check: collect real staff free-text samples (**still to be gathered
  from the user — see §11**) and measure what fraction resolves fully locally.

---

## 8. Phase 8 — AI Demoted to Shortlist Fallback + Alias Learning — As Built

### 8.1 Escalation decision

After the local pass, compute token coverage per clause. Escalate to AI **only**
when a clause has unresolved dimensions *or* significant unexplained leftover
text. A fully-resolved parse returns immediately with **zero AI calls**.

### 8.2 Shortlist prompt

When escalation does happen, replace the full-taxonomy grounding block in
`vehicleFitmentParserAI._formatGroundingPrompt` with **only** the candidates the
local pass shortlisted, plus the unparsed span. This turns a prompt that scales
with the catalog into one of roughly a couple hundred tokens.

Keep `_validateResult` exactly as-is — LLM-returned ids stay untrusted and are
still re-checked against the taxonomy snapshot.

### 8.3 Alias learning loop

When staff **accept** a proposed row in the review panel, record the raw input
span → resolved id as a `source = 'learned'` alias (§6.2). Every AI escalation
then makes the next identical input free, and the AI call rate decays toward
near-zero on the business's actual working vocabulary.

Guard rails: only learn from an explicit accept (never from a silent save),
never learn an alias that collides with an existing canonical code, and keep
`source` distinct so learned aliases can be audited or pruned in bulk.

### 8.4 Acceptance

- Instrument and report: share of parses served locally vs. escalated, and mean
  latency for each path. This is the number that tells you whether the phase
  worked.
- Escalated prompts are demonstrably shortlist-sized, not full-taxonomy.

---

## 9. Phase 9 — Display-Only Compression — As Built

`packages/web/src/utils/engineCodeFormat.js`, consumed by every fitment display
site — one shared utility, not inline logic per page.

### 9.1 The rule

Longest-common-prefix collapse, the exact inverse of §7.3's overlay:

```
{4D55, 4D56}  → prefix "4D5", tails "5","6"    → 4D55/6
{4JA1, 4JB1}  → prefix "4J",  tails "A1","B1"  → 4JA1/B1
```

### 9.2 Safety rules — refusing to compress is always acceptable

Compression is cosmetic, so any doubt means render the codes separately:

1. **Group only within an identical context** — same make, model, and year range
   on that part. Otherwise "Hilux 4D56 2005-2010" and "L300 4D55 1995-2000"
   would merge into a fitment claim that was never entered.
2. **Every tail must be non-empty.** Rejects `{4JA1, 4JA1-T}` (one tail empty) —
   correctly keeping the NA and turbo engines visibly distinct.
3. **Reject any tail containing a variant separator.** `{4JJ1-TC, 4JJ1-TCX}`
   stays uncompressed; variant suffixes carry mechanical meaning.
4. **Prefix ≥ 2 chars and ≥ half the shortest code.** Rejects `{JT, JX}`.
5. **All tails the same length**, keeping the reverse overlay unambiguous.
6. **Cap the group at 3–4 members**, else list plainly — `4D55/6/65/8` stops
   being readable.
7. **Never lose information:** the full expanded list goes in a `title`/tooltip.

### 9.3 Round-trip property

`compress({4D55, 4D56})` → `"4D55/6"` and `parse("4D55/6")` → `{4D55, 4D56}`.
Test both directions over a shared fixture list; it is the cheapest guard
against the two implementations drifting apart.

### 9.4 What must stay atomic

The compressed form must never appear in:

- **The Meilisearch index.** The `display` string and
  `searchable_applications` built in `partApplicationRoutes.js` (see
  `getPartDataForMeili`) keep individual codes — a staff member searching
  `4D56` must hit the part. Compress in the React render only.
- The API payload, any export/CSV, or any stored column.

---

## 9b. Taxonomy Coverage Bugs (found by asking "does it actually self-grow?")

Caught only by parsing **every real taxonomy row** and checking it resolves --
the fixture-based tests could not see any of this, because the fixture happened
to use `4D`/`4J`-shaped codes throughout. Keep the §10 coverage check.

1. **The engine-token regex was far too narrow: 82 of 273 real engine codes
   (30%) did not parse when typed verbatim.** It could not see `D4BA`,
   `HR12DE`, `10PA1`, `YD25DDTi`, `1.5L Ti-VCT`, `Cummins ISF 2.8` or
   `EcoBlue 2.0 Bi-Turbo`. Fixed by matching **known codes as literal spans**
   from the taxonomy index (`engineCodeTokens`, longest-first) *before* the
   numeric passes -- otherwise `extractDisplacement` ate the `1.5L` out of
   `1.5L Ti-VCT`. The loose regex now only does the job it is suited to:
   nominating code-shaped tokens the catalog has **not** seen yet. Result: 82
   failures down to 6.

2. **The literal matcher initially matched code prefixes, which was dangerous.**
   It took `4D55` out of `4D55/6` (losing the second engine) and matched `4JA1`
   inside `4JA1-T` -- collapsing a turbo engine into its naturally aspirated
   base, precisely the thing Decision 4 forbids. Fixed by widening the span
   boundary for engine codes to exclude `/`, `-`, `_` and `.`, so a code that is
   merely the prefix of a longer code token cannot match.

3. **Model names containing `&`, `/` or parentheses never matched** (`C&E
   Series`, `Every / Multicab`, `300 Series (Dutro)`), because the internal
   separator class only allowed whitespace, hyphen, underscore and dot.

4. **The seeded `FUSO` make alias shadowed a real model.** This catalog has a
   Mitsubishi model literally named `FUSO` (model_id 1), and makes are matched
   before models, so the alias broke `Fuso Super Great` and `Fuso The Great`.
   The alias was removed from the seed migration with a comment explaining why.

---

## 9a. Bugs Found and Fixed During Implementation

Both were caught by running the parser against the *real* taxonomy rather than
the test fixture, which is why §10 keeps that step.

1. **Ordinary words were being proposed as engine codes.** The engine-token
   regex is deliberately loose, so it also nominated words like `Grand`, `some`
   and `van`, each becoming a junk "(new engine)" candidate row for staff to
   clean up. Fixed with `looksLikeEngineCode()` in `fitmentTextParser.js`: an
   unresolved span is only kept if it actually looks like a code (contains a
   digit or separator, or is a short all-caps designation). Regression tests
   cover it.

2. **An empty shortlist would have crippled the AI fallback.** When the residue
   resembled nothing in the taxonomy, `buildShortlist` correctly returned
   nothing -- but passing an empty grounding to the AI parser means
   `_validateResult` strips *every* id the model returns, since it validates
   against the grounding snapshot. The route now falls back to full-taxonomy
   grounding whenever the shortlist is empty: correctness beats the token
   saving. Regression test covers the empty-shortlist case.

A third, smaller issue: `+` served both as a clause separator and as the
open-ended year marker (`2015+`), so year ranges were being split apart. The
clause splitter now only treats `+` as a separator when it does not follow a
digit.

---

## 9c. Shared-Suffix Compression — As Built

Prefix compression alone only captured Mitsubishi/Isuzu-style codes and left the
very common Toyota style untouched, because those differ at the FRONT
(`1GD-FTV` / `2KD-FTV` share a suffix, not a prefix). Measured on a realistic
part, prefix-only compression saved just 8%.

The mirror rule now runs as a fallback on both sides, keeping them exact
inverses:

```
{1GD-FTV, 1KD-FTV, 2GD-FTV, 2KD-FTV} -> 1GD/1KD/2GD/2KD-FTV
{4JJ1-TC, 4JK1-TC, 4JH1-TC}          -> 4JH1/4JJ1/4JK1-TC
```

Saving went from 8% to **28%**. Two guards, both tested:

- **The shared part must be a whole hyphen-delimited segment.** `1G/1K/2G/2KD-FTV`
  would save two more characters but reads as gibberish, and the hyphen boundary
  is what makes the form unambiguous to expand back.
- **A head equal to the final segment's base disables the rule.** For
  `4JA1/4JA1-L` the suffix reading would silently drop the naturally aspirated
  4JA1, so it falls through to the overlay rule instead.

The parser's `expandSharedSuffix` only fires when the LAST segment carries a
hyphen and the earlier ones do not, which is what keeps `4D55/6` and `1KR-DE/VE`
on the overlay path.

---

## 10. Phase 10 — Dense Display — As Built

Three further compressions, all presentation-only, all off by default behind a
`dense` option on `formatApplicationText` (individually switchable via
`shortenYears`, `useShorthand`, `dropRedundantMake`).

### 10a. Shorthand dictionary

`display_short` on `vehicle_make` / `vehicle_model` / `engine`
(`20260910_03_display_shorthand.sql`), served by
`GET /applications/display-dictionary` from the cached taxonomy index.

This is deliberately **not** the alias tables from `20260910_02`: aliases map
many input spellings onto one row and include variants nobody would want on
screen; `display_short` is one curated preferred abbreviation per row, for
rendering only. Seeded for 4 makes, 15 models and 5 engines —
**the seed list is business vocabulary and should be reviewed by someone who
works the counter.** Anything left NULL renders with its full name.

### 10b. Year shorthand

`packages/web/src/utils/yearShorthand.js`. `2005-2015` → `05-15`, `2015+` →
`15+`, `up to 2018` → `≤18`. The century pivot matches the parser's
`expandTwoDigitYear` (70–99 → 19xx), and any year that would round-trip to the
wrong century keeps all four digits — a range containing one is never
half-shortened.

### 10c. Dropping a redundant make

The biggest single saving, and the one with a real trap. Dropping "Toyota" from
"Toyota Hilux" is safe because no other make has a Hilux — but this catalog has
a **Ranger under both Ford and Hino** and a **Rosa under both Mitsubishi Fuso and
Hino**. Dropping the make on those would put a wrong answer in front of someone
at the counter.

The dictionary endpoint therefore also returns `ambiguousModels`, computed from
the live taxonomy, and the make is dropped only when every model shown under it
is unique catalog-wide. **Until the dictionary loads (or if it fails),
`modelNeedsMake` returns true and no make is ever dropped** — the UI degrades to
the long-but-correct form, never to a wrong short one.

### Measured on the sample part (13 fitments, rendered by the real formatter)

| Rendering | Chars |
|---|---|
| A — current | 213 |
| E — dense (shorthand + short years + make dropped) | 169 (−21%) |
| F — dense, engine codes on hover | 90 (−58%) |

### Still open

`dense` is implemented but **not yet switched on in any preset** — which surface
gets which option (A–F) is the user's pick, presented at
<https://claude.ai/code/artifact/c1b57c8d-b6d0-4b9a-b248-0332d295777b>. Density
is per preset, so the POS suggestion, table cell and Power Search panel can each
differ.

### Incidental fix

`applicationCache.js` and `displayDictionary.js` now import the axios client
lazily, and `applicationTextHelper.js` uses explicit `.js` extensions. This makes
the whole formatter chain loadable under plain `node --test`, which is what
allowed the dense rules to be tested end to end rather than by inspection.

---

## 11. Verification Commands

```bash
# Re-check the engine-family split is still safe before writing the Phase 6 migration
docker compose -f docker-compose.dev.yml exec -T db \
  psql -U postgres -d forson_business_suite -c "
SELECT e.engine_id, e.engine_code,
       (SELECT count(*) FROM application a WHERE a.engine_id=e.engine_id) AS apps,
       (SELECT count(*) FROM part_application pa
          JOIN application a2 ON pa.application_id=a2.application_id
         WHERE a2.engine_id=e.engine_id) AS part_links
FROM engine e WHERE e.engine_code ~ '/' ORDER BY e.engine_code;"

# Taxonomy counts (baseline as of 2026-09-10: 20 makes / 155 models / 271 engines,
# 53 of which carry a variant suffix)
docker compose -f docker-compose.dev.yml exec -T db \
  psql -U postgres -d forson_business_suite -c "
SELECT (SELECT count(*) FROM vehicle_make)  AS makes,
       (SELECT count(*) FROM vehicle_model) AS models,
       (SELECT count(*) FROM engine)        AS engines,
       (SELECT count(*) FROM engine WHERE engine_code ~ '-') AS variant_coded;"

# Parser unit tests (pure modules — no DB or network needed)
cd packages/api && npm test

# Frontend build check. NOTE: `npm run build` can fail with EACCES trying to
# empty packages/web/dist (the directory is owned by the container). That is an
# environment issue, not a code failure -- build to a scratch dir to confirm:
cd packages/web && npx vite build --outDir /tmp/webdist --emptyOutDir

# TAXONOMY COVERAGE CHECK -- do not skip. Parses every make/model/engine in the
# database and reports any that do not resolve. This is what caught the §9b
# bugs; the fixture tests were blind to all of them.
docker compose -f docker-compose.dev.yml exec -T backend node -e "
const idx = require('/usr/src/app/helpers/vehicleTaxonomyIndex');
const { parseFitmentText } = require('/usr/src/app/helpers/fitmentTextParser');
idx.getIndex().then(i => {
  const missE = i.engines.filter(e => !parseFitmentText(e.engine_code, i).fitments.some(f => f.engine_id === e.engine_id)).map(e => e.engine_code);
  const missM = i.models.filter(m => !parseFitmentText(m.model_name, i).fitments.some(f => f.model_id === m.model_id)).map(m => m.model_name);
  console.log('engines unmatched:', missE.length + '/' + i.engines.length, missE.join(' | '));
  console.log('models unmatched:', missM.length + '/' + i.models.length, missM.join(' | '));
  process.exit(0);
});
"

# End-to-end check of the parser against the REAL taxonomy. Both bugs in §9a
# were invisible to the fixture-based tests and only appeared here, so do not
# skip this step.
docker compose -f docker-compose.dev.yml exec -T backend node -e "
const idx = require('/usr/src/app/helpers/vehicleTaxonomyIndex');
const { parseFitmentText } = require('/usr/src/app/helpers/fitmentTextParser');
idx.getIndex().then(i => {
  for (const t of ['4D55/6', '4JA1/B1', 'Mits L300 4D56', 'Fits Hilux 2005-2015 2.5L Diesel, also Fortuner same years']) {
    const r = parseFitmentText(t, i);
    console.log(t, '->', r.fullyResolved, JSON.stringify(r.fitments.map(f => f.engine || f.model)));
  }
  process.exit(0);
});"
```

---

## 12. Open Question for the User

**Real staff input samples.** The segmentation rules (§7.2) and the seed alias
list (§6.2) should be tuned against 15–20 examples of the free text staff
actually type today (or the phrasing that appears on supplier catalogs and part
boxes), not against assumptions. Phases 6 and 7 can start without this; §7.7's
corpus check and §6.2's alias seed cannot be finalized without it.

---

## 13. Explicitly Deferred

Inherited from FIT-001 §10 and still deferred — deprioritized, not next up:

- **Taxonomy dedupe/merge tool.** Would revisit when near-duplicate engine codes
  (FIT-001 §9.2, e.g. `1TR` vs `1TR-FE`) start producing wrong fitments rather
  than just untidy lists. Note that Phase 6's alias tables provide part of the
  machinery a merge tool would need.
- **Bulk CSV import/export of part-to-vehicle mappings.** Would revisit if a
  supplier supplies a machine-readable fitment catalog.

---

## 14. What's in Hindsight (don't duplicate here, don't skip recalling it)

Rationale, gotchas and debugging lessons for this feature live in hindsight
under tags `["forson-business-suite", "vehicle_fitment"]`. Recall it rather than
expecting this document to carry the *why* behind every implementation detail.
See also FIT-001 §11.

---

## 15. Files Touched

**New:**

- `database/migrations/20260910_01_split_engine_families.sql`
- `database/migrations/20260910_02_taxonomy_alias_tables.sql`
- `packages/api/helpers/engineCodeGrammar.js` — pure slash-overlay grammar and key normalization
- `packages/api/helpers/vehicleTaxonomyIndex.js` — cached taxonomy + alias + co-occurrence index
- `packages/api/helpers/fitmentTextParser.js` — pure deterministic parser and `buildShortlist`
- `packages/api/tests/fitmentTextParser.test.js` — 44 tests
- `packages/api/tests/fixtures/engineCodeRoundTrip.json` — shared round-trip truth table
- `packages/web/src/utils/engineCodeFormat.js` — display-only compression (prefix + shared suffix)
- `packages/web/src/utils/yearShorthand.js` — two-digit year notation
- `packages/web/src/helpers/displayDictionary.js` — curated shorthand + ambiguous-model data
- `packages/web/tests/denseDisplay.test.js` — 17 tests
- `database/migrations/20260910_03_display_shorthand.sql`
- `packages/web/tests/engineCodeFormat.test.js` — 11 tests

**Modified:**

- `packages/api/services/ai/features/vehicleFitmentParserAI.js` — accepts a `grounding` shortlist
- `packages/api/routes/partApplicationRoutes.js` — local-first orchestration, merge, `/applications/fitment-alias`
- `packages/api/routes/applicationRoutes.js` — taxonomy-index invalidation at 4 write sites
- `packages/web/src/pages/PartApplicationManager.jsx` — grouped display, parse-source line, alias learning
- `packages/web/src/helpers/applicationTextHelper.js` — engine compression + `dense` mode; this is the single integration point that lights up POS, Power Search, Parts table, GRN, PO and Invoicing
- `packages/web/src/helpers/applicationCache.js` — lazy axios import so the chain is unit-testable

For current structure, prefer `graphify query "vehicle fitment parsing"` over this list.

---

## 16. Change Log

| Date | Session | Change |
|---|---|---|
| 2026-09-10 | Planning session (Claude Opus 5) | Document created. Phases 6–9 planned; Decisions 1–8 settled with the user; engine-family split verified safe against the dev DB (1 application, 0 part links). Nothing built yet. |
| 2026-09-10 | Implementation session, cont. 2 (Claude Opus 5) | Added shared-suffix compression on both sides (§9c, 8% → 28% saving) and Phase 10 dense display (§10): `display_short` dictionary + endpoint, year shorthand, and dropping a redundant make guarded by catalog-wide model-name ambiguity. Migration `20260910_03` applied. Web tests 11 → 90 (17 new dense tests), API 56 → 63. `dense` is built but not yet enabled in any preset — awaiting the user's per-surface pick. |
| 2026-09-10 | Implementation session, cont. (Claude Opus 5) | Answered "does the taxonomy actually self-grow?" — it does (invalidation is wired at all 4 taxonomy write sites plus the alias endpoint, and the API is a single non-clustered process), but the check exposed that 82/273 engine codes and 15/155 model names did not parse at all. Four coverage bugs found and fixed (§9b); engine failures now 6/273, model failures 8/155 and all of those are genuine ambiguity or duplicate rows. Test count 44 → 56. `FUSO` make alias removed from the seed migration. |
| 2026-09-10 | Implementation session (Claude Opus 5) | Phases 6–9 all built. Both migrations applied to the dev DB and checksums verified. 44 API + 11 web unit tests passing; web production build clean. Three bugs found and fixed during implementation (§9a). Departed from the plan on one point: displacement is no longer copied from the family row to all members (§6.1). Live browser click-through still outstanding; real staff input corpus still needed from the user (§11). |
