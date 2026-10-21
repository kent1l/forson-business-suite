# GRN JSON Import — Catalog Retrieval and Jev Verification

> **Forson Business Suite** | **Date:** 2026-10-21 | **Baseline:** `7a44447` | **Status:** Implemented and verified locally; changes are uncommitted at handoff. Production deployment and a representative receipt pilot were not performed.

## 0. Status at a Glance

| Phase | Status | Reference |
|---|---|---|
| A. Compatible cleaned-item contract | Complete | §4-A |
| B. Catalog retrieval | Complete | §4-B |
| C. Jev comparison and cancellation | Complete | §4-C |
| D. Review UI and request handling | Complete | §4-D |
| E. Local verification | Complete | §6 |
| Production rollout / receipt pilot | Not performed | §5 |

## 1. For a New Session or Implementer

Before starting:
1. Run `graphify query "findPartCandidates partCandidateService GRN import supplier_item_text"` for current code relationships.
2. Recall Hindsight with tags `forson-business-suite`, `grn-import`, `catalog-matching` for compatibility and matching decisions.
3. Check `git log` / `git status` and the verification results before trusting this status table. These changes were not committed or deployed by this session.

When changing this feature, update this document and its status table, retain non-obvious decisions to Hindsight, and run `graphify update .`.

## 2. Business Objective and Settled Decisions

Find existing catalog products from extracted group, brand, part number and identifying details before staff create a duplicate part. Compare the results against the supplier's actual wording with Jev, while leaving the final selection and row confirmation to the receiver.

- `supplier_item_text` is an **optional schema v1 extension**, not a schema-version bump. Existing v1 imports still work through description/raw-text fallback. No database migration is required.
- Cleaned text preserves identifying brand, part numbers, model, grade, dimensions, pack size and orientation; transaction quantities, prices, totals, discounts and receiving marks are excluded. Original `raw_text` stays intact and is sent separately to Jev.
- Omitting the new field leaves it absent from the normalized payload so legacy payload hashes/idempotency remain compatible. Explicit new-field content participates in the hash.
- External web enrichment remains separate and is not substituted for source facts.
- Brand/group hints improve ranking without excluding differently classified or labeled catalog items. Deleted identifiers and inactive parts are excluded.
- Jev is advisory. Recommendations never select or confirm a part, set receiving quantities/prices, create a part, commit a GRN or post stock.

## 3. Architecture

Candidate requests resolve original line facts from `source_payload.lines` by `line_no`, applying reviewed corrections where present. Review rows contain receiving decisions, not duplicated transcription fields.

Retrieval combines bounded Meilisearch query variants with PostgreSQL identifier, token and trigram matching. SQL always participates, even when the index returns hits. Results hydrate against the active catalog, deduplicate by part, and return at most 20 candidates. Lookup has a 2-second budget.

The service instantiates the existing `JevClient`; the earlier GRN matcher incorrectly treated its class export as an instance. A typed Choice compares up to 20 candidates with cleaned text, original raw text and structured receipt identity, including when only one candidate exists. `no_match` is an explicit choice. Confidence below 0.85 is uncertain; a sufficiently confident match is promoted and marked as a recommendation. Unavailable/timed-out Jev leaves catalog results usable. Verification has a 3.5-second deadline and aborts the provider request on cancellation.

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

- [x] Construct a real Jev client and verify single/multiple candidate sets using raw and cleaned receipt text.
- [x] Surface recommendation, no reliable match, uncertainty, unavailability and timeout separately.
- [x] Preserve product/specification distinctions and keep final selection manual.
- [x] Propagate caller cancellation to the provider and enforce a verification deadline.

### D. Review UI and request handling

- [x] Display raw receipt and cleaned item text together, plus identifier/brand/group evidence and Jev recommendation confidence.
- [x] Debounce searches by 300 ms, abort superseded requests, retain at most two active client requests, and ignore results from an old row/version/import.
- [x] Preserve source payload after saving review changes; PATCH responses do not include that payload.
- [x] Prefill new-part detail from cleaned identity when available. Existing create-part and duplicate-resolution flows remain available.

## 5. Explicitly Deferred / Operational Follow-up

- Production deployment, production provider configuration and a representative supplier-receipt accuracy/latency pilot were not performed. The live provider smoke check used entirely invented text, not business records.
- No automatic part selection, supplier-code mapping, web crawling, catalog mutation or financial workflow changes were added.
- No new indexes or durable Jev-decision cache were added. Measure retrieval on representative catalog size before deciding whether additional indexes or caching are necessary.

## 6. Verification

Passed locally:

```bash
npm run -w packages/api test -- --runInBand grnImport.test.js jevClient.test.js
npm run -w packages/api test -- --runInBand purchaseOrderParserAI.test.js
docker exec -e DB_NAME=forson_grn_import_test forson_backend_dev node tests/partCandidateService_db_test.js
docker exec -e DB_NAME=forson_grn_import_test -e JEV_ENABLED=false forson_backend_dev node tests/grnImportWorkflow_db_test.js
LD_LIBRARY_PATH=/tmp/grn-browser-libs/usr/lib/x86_64-linux-gnu node packages/web/tests/grnImportBrowser.mjs
npm run -w packages/web build
git diff --check
```

The standalone database runners enforce the disposable database name. Catalog SQL runs against real PostgreSQL; repeatable search/AI assertions use controlled external-provider responses. Database fixtures in the matcher runner are rolled back. The workflow runner retains its existing test-record lifecycle.

The browser runner checks cleaned/raw evidence, recommendation/no-match/uncertainty, search failure, late responses, display names, creation/cancellation, duplicate resolution, permissions, responsiveness and commit/provenance. The live Jev smoke check with invented TESTBRAND products returned the correct `test_a` choice through the existing configured provider. API/frontend lint reports warnings only; the production web build passes with its existing chunk-size warning.

## 7. Files Touched

- `packages/api/helpers/grnImportSchema.js`
- `packages/api/services/grnImportService.js`
- `packages/api/services/partCandidateService.js`
- `packages/api/services/jevClient.js`
- `packages/api/routes/goodsReceiptRoutes.js`
- `packages/api/tests/grnImport.test.js`
- `packages/api/tests/grnImportWorkflow_db_test.js`
- `packages/api/tests/partCandidateService_db_test.js`
- `packages/api/tests/jevClient.test.js`
- `packages/web/src/hooks/useGrnImportReview.js`
- `packages/web/src/components/goods-receipt/ImportReviewDrawer.jsx`
- `packages/web/src/pages/GoodsReceiptPage.jsx`
- `packages/web/tests/grnImportBrowser.mjs`
- `docs/plans/2026-10-20_grn-external-json-extraction-prompt.md`
- `docs/plans/2026-10-20_grn-external-json-ingestion.final.md`
- This handoff.

## 8. Change Log

- 2026-10-21: Implemented and locally verified the compatible schema extension, broader catalog retrieval, functioning Jev comparison, evidence UI and cancellation safeguards. Production rollout and representative receipt pilot remain operational follow-up.
