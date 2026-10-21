# GRN JSON Import — Catalog Retrieval and Jev Verification

> **Forson Business Suite** | **Date:** 2026-10-21 | **Baseline:** `4982c93` | **Status:** Implemented and verified locally; the cleaned-only, automatic-population and review usability changes are uncommitted at handoff. Production deployment and a representative receipt pilot were not performed.

## 0. Status at a Glance

| Phase | Status | Reference |
|---|---|---|
| A. Compatible cleaned-item contract | Complete | §4-A |
| B. Catalog retrieval | Complete | §4-B |
| C. Jev comparison and cancellation | Complete | §4-C |
| D. Review UI and request handling | Complete | §4-D |
| E. Local verification | Complete | §6 |
| F. Automatic population and saving | Complete | §4-F |
| G. Confirmation and review usability | Complete | §4-G |
| Production rollout / receipt pilot | Not performed | §5 |

## 1. For a New Session or Implementer

Before starting:
1. Run `graphify query "findPartCandidates partCandidateService GRN import supplier_item_text"` for current code relationships.
2. Recall Hindsight with tags `forson-business-suite`, `grn-import`, `catalog-matching` for compatibility and matching decisions.
3. Check `git log` / `git status` and the verification results before trusting this status table. These changes were not committed or deployed by this session.

When changing this feature, update this document and its status table, retain non-obvious decisions to Hindsight, and run `graphify update .`.

## 2. Business Objective and Settled Decisions

Find existing catalog products from extracted group, brand, part number and identifying details before staff create a duplicate part. Compare the results against the supplier's actual wording with Jev, automatically filling strong catalog selections while preserving manual overrides and separate receipt-row confirmation.

- `supplier_item_text` is an **optional schema v1 extension**, not a schema-version bump. Existing v1 imports still work through a cleaned-description fallback. No database migration is required.
- Cleaned text preserves identifying brand, part numbers, model, grade, dimensions, pack size and orientation; transaction quantities, prices, totals, discounts and receiving marks are excluded. Original `raw_text` may remain in older payloads but is neither displayed nor used for catalog matching or Jev verification. If cleaned identity and description are absent, automatic matching is skipped and manual search remains available.
- Omitting the new field leaves it absent from the normalized payload so legacy payload hashes/idempotency remain compatible. Explicit new-field content participates in the hash.
- External web enrichment remains separate and is not substituted for source facts.
- Brand/group hints improve ranking without excluding differently classified or labeled catalog items. Deleted identifiers and inactive parts are excluded.
- Per the latest user instruction, strong matches now select and save the catalog part automatically. A Jev decision of at least 0.85 confidence qualifies. When Jev is unavailable/timed out, a unique exact brand-and-identifier match can qualify only if product wording, identifying numbers/specifications and any supplied group are consistent. Explicit Jev no-match/uncertainty and partial searches veto automatic selection. Receiving quantities, returns, prices, row confirmation and posting remain separate.

## 3. Architecture

Candidate requests resolve original line facts from `source_payload.lines` by `line_no`, applying reviewed corrections where present. Review rows contain receiving decisions, not duplicated transcription fields.

Retrieval combines bounded Meilisearch query variants with PostgreSQL identifier, token and trigram matching. SQL always participates, even when the index returns hits. Results hydrate against the active catalog, deduplicate by part, and return at most 20 candidates. Lookup has a 2-second budget.

The service instantiates the existing `JevClient`; the earlier GRN matcher incorrectly treated its class export as an instance. A typed Choice compares up to 20 candidates with cleaned item text and structured receipt identity only, including when only one candidate exists. `no_match` is an explicit choice. Confidence below 0.85 is uncertain; a sufficiently confident match is promoted and marked as a recommendation. Unavailable/timed-out Jev leaves catalog results usable. Verification has a 3.5-second deadline and aborts the provider request on cancellation.

Search text entered by the receiver affects retrieval only; it does not replace receipt evidence sent to Jev. Candidate calls remain outside write transactions. Network disconnects cancel obsolete Jev requests.

## 4. As Built by Phase

### A. Compatible cleaned-item contract

- [x] Validate optional string/null `lines[].supplier_item_text`, maximum 2,000 code points, using existing control-character checks.
- [x] Permit it as a line-level extraction-issue field; expose it in capabilities `optional_line_fields`.
- [x] Preserve old normalized shapes/hashes when omitted.
- [x] Update the [extraction prompt](2026-10-20_grn-external-json-extraction-prompt.md) and [schema contract](2026-10-20_grn-external-json-ingestion.final.md).

### B. Catalog retrieval

- [x] Read immutable source fields and reviewed corrections in the authenticated candidate route.
- [x] Match normalized SKU/part identifiers, including spaces/hyphens, plus group/brand/detail tokens and trigram similarity.
- [x] Search multiple index variants and combine index and SQL results, including index-only results hydrated from PostgreSQL.
- [x] Exclude inactive catalog rows and retired identifiers; return evidence, manufacturer/alternate numbers and stock unit with bounded results.
- [x] Distinguish a search outage from a completed search with no candidates.

### C. Jev comparison and cancellation

- [x] Construct a real Jev client and verify single/multiple candidate sets using cleaned item text only, excluding original raw text.
- [x] Surface recommendation, no reliable match, uncertainty, unavailability and timeout separately.
- [x] Preserve product/specification distinctions; populate qualified selections automatically with manual override available.
- [x] Propagate caller cancellation to the provider and enforce a verification deadline.

### D. Review UI and request handling

- [x] Display cleaned item text only, plus identifier/brand/group evidence and Jev recommendation confidence.
- [x] Debounce searches by 300 ms, abort superseded requests, retain at most two active client requests, and ignore results from an old row/version/import.
- [x] Preserve cleaned source text after saving review changes; PATCH responses do not include that payload.
- [x] Prefill new-part detail from cleaned identity when available. Existing create-part and duplicate-resolution flows remain available.

### F. Automatic population and saving

- [x] Opening a writable IN_REVIEW import starts a pass over included, unassigned, unconfirmed rows that have cleaned identity. Existing selections, excluded rows, raw-only rows and committed reviews are skipped.
- [x] The candidate service returns server-qualified `automatic_match` alongside candidates; manual search queries do not trigger automatic choices.
- [x] Keep at most two active lookups; manual picker searches take priority and mark that row for manual handling. Raw text remains excluded throughout.
- [x] Populate part ID, display name and stock UOM only. Preserve distinct receipt rows and all extracted/edited quantities, returns and prices. Highlight automatically filled catalog fields; show compact progress, unmatched count and retry control.
- [x] Automatically persist accepted choices using ordinary typed set_row actions, in batches capped at the API's 50-action limit. Automatic saves send only automatic entries; manual entries remain pending until explicit save, confirmation, or draft creation.
- [x] Serialize saves and replay pending manual edits over responses. A manual part choice made during matching wins. Version conflicts refresh the review, preserve manual work and allow retry; stale automatic choices are dropped.
- [x] Reopening skips persisted part selections. Commit flushes pending changes and uses the resulting latest version.

### G. Confirmation and review usability

- [x] Fix the queued-only Confirm Row/Header interaction. Confirmation now flushes edits through the serialized save path immediately; its visible confirmed state comes from the successful response. Saving disables repeated confirmation clicks; errors use the page's existing error notification.
- [x] Catalog selection and stock UOM are required before confirming a row. Confirmations bind supplier, currency, part and stock-unit/conversion identity. Changing prices, delivered quantities or returns does not invalidate the catalog confirmation; selecting another part, changing stock units or correcting identifying source facts does. Existing reviews with older digests show a confirmation button again.
- [x] Missing/unknown cost, missing sale price, extraction uncertainty (including unscoped/unknown issue codes) and TOTAL_MISMATCH notes do not block draft creation or require explanations. Supplied prices must still be nonnegative finite values. Blank unit cost becomes 0 in the editable draft and is not treated as free goods; unknown imported sale price stays null through draft creation, loading, edits and saving. Explicit reviewed sale prices are retained rather than replaced with default markup. Catalog matching, valid quantities/returns, active catalog/UOM checks, document completeness and supported currency remain enforced.
- [x] Keep extraction uncertainty as collapsed informational notes without mandatory explanation/resolution prompts. Notes do not flag otherwise confirmed rows in Needs Attention Only; actual required fields and catalog confirmation govern readiness. This fixes AMBIGUOUS_VALUE notes about handwritten 180/1000 with a null field, which previously bypassed the financial-field exception.
- [x] Simplify rows to catalog part, delivered quantity, unit cost and sale price. Put returns and supporting facts under More details. Remove price-classification controls and per-row AI badges; keep cleaned supplier identity visible. Collapse advisory extraction notes and remove redundant confirmation alerts.
- [x] Show a subtle blue highlight on AI-filled fields with one shared legend. Store cosmetic `ai_filled_fields` arrays in existing JSON review state, seeded from extraction and updated by automatic-match actions. Manual field edits remove their highlight, including after save/reopen; highlights do not confer confirmation. Legacy reviews infer original quantity/cost highlights from source values until first edit. No migration or external schema change is required.
- [x] Verify actual confirmation clicks, disabled unmatched confirmation, retained confirmation after manual price edits, removal of edited-field highlights, desktop/phone layouts and zero-cost draft readback using browser and real PostgreSQL tests. Automatic matching race/conflict checks continue to pass.

## 5. Explicitly Deferred / Operational Follow-up

- Production deployment, production provider configuration and a representative supplier-receipt accuracy/latency pilot were not performed. The live provider smoke check used entirely invented text, not business records.
- No supplier-code mapping, web crawling, automatic part creation, automatic row confirmation or financial workflow changes were added. Automatic selection of qualifying existing parts is now implemented under §4-F.
- No new indexes or durable Jev-decision cache were added. Measure retrieval on representative catalog size before deciding whether additional indexes or caching are necessary.

## 6. Verification

Passed locally:

```bash
npm run -w packages/api test -- --runInBand grnImport.test.js jevClient.test.js
npm run -w packages/api test -- --runInBand purchaseOrderParserAI.test.js
docker exec -e DB_NAME=forson_grn_import_test forson_backend_dev node tests/partCandidateService_db_test.js
docker exec -e DB_NAME=forson_grn_import_test -e JEV_ENABLED=false forson_backend_dev node tests/grnImportWorkflow_db_test.js
LD_LIBRARY_PATH=/tmp/grn-browser-libs/usr/lib/x86_64-linux-gnu node packages/web/tests/grnImportBrowser.mjs
LD_LIBRARY_PATH=/tmp/grn-browser-libs/usr/lib/x86_64-linux-gnu node packages/web/tests/grnImportAutoMatchBrowser.mjs
npm run -w packages/web build
git diff --check
```

The standalone database runners enforce the disposable database name. Catalog SQL runs against real PostgreSQL; repeatable search/AI assertions use controlled external-provider responses. Database fixtures in the matcher runner are rolled back. The workflow runner retains its existing test-record lifecycle.

The automatic-matching browser runner additionally verifies automatic persistence before opening a picker, two-request concurrency, edits during PATCH, late-result/manual-choice races, save conflicts, retry, reopening and latest-version commit. The workflow browser runner also reproduces the handwritten ambiguity note and verifies imported null sale prices remain blank, can be entered/cleared, and are sent as null on draft save. Real PostgreSQL readback verifies null prices after import and subsequent draft updates. The workflow browser runner checks cleaned-only evidence and raw-text exclusion, recommendation/no-match/uncertainty, search failure, late responses, display names, creation/cancellation, duplicate resolution, permissions, responsiveness and commit/provenance. The live Jev smoke check with invented TESTBRAND products returned the correct `test_a` choice through the existing configured provider. API/frontend lint reports warnings only; the production web build passes with its existing chunk-size warning.

## 7. Files Touched

- `packages/api/helpers/grnImportSchema.js`
- `packages/api/services/grnImportService.js`
- `packages/api/services/grnDraftService.js`
- `packages/api/services/grnLineIdentityService.js`
- `packages/api/services/partCandidateService.js`
- `packages/api/services/jevClient.js`
- `packages/api/routes/goodsReceiptRoutes.js`
- `packages/api/tests/grnImport.test.js`
- `packages/api/tests/grnImportWorkflow_db_test.js`
- `packages/api/tests/partCandidateService_db_test.js`
- `packages/api/tests/jevClient.test.js`
- `packages/web/src/components/ui/MathExpressionInput.jsx`
- `packages/web/src/hooks/useGrnImportReview.js`
- `packages/web/src/utils/grnImportReview.js`
- `packages/web/src/components/goods-receipt/ImportReviewDrawer.jsx`
- `packages/web/src/pages/GoodsReceiptPage.jsx`
- `packages/web/tests/grnImportBrowser.mjs`
- `packages/web/tests/grnImportAutoMatchBrowser.mjs`
- `packages/web/tests/fixtures/grnImportBrowser.html`
- `docs/plans/2026-10-20_grn-external-json-extraction-prompt.md`
- `docs/plans/2026-10-20_grn-external-json-ingestion.final.md`
- This handoff.

## 8. Change Log

- 2026-10-21: Implemented and locally verified the compatible schema extension, broader catalog retrieval, functioning Jev comparison, evidence UI and cancellation safeguards. Production rollout and representative receipt pilot remain operational follow-up.

- 2026-10-21 clarification: Per user direction, original raw text is hidden and excluded from retrieval and Jev. Cleaned supplier_item_text is primary; legacy cleaned description is the only text fallback. Cleaned-only JSON rows are accepted without raw_text or description.

- 2026-10-21 automatic-population request: qualifying catalog parts now populate and save on review opening, with manual-override protection, conflict recovery, progress/retry and receiving values preserved. Supersedes the earlier manual-selection-only decision.
