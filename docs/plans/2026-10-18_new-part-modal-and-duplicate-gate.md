# New Part Modal and Duplicate Gate — Investigation and Implementation Handoff

> **Forson Business Suite** | **Date:** 2026-10-18 | **Branch:** `new-part-bugs-fix`
> **Status:** Investigation complete; implementation not started. User requested explanation and a plan only. Application code is unchanged.

## 0. Status at a Glance

| Phase | Status | Reference |
|---|---|---|
| Trace causes and verify current gate | Complete: source tracing, existing tests and isolated execution | §3–4, §8 |
| Preserve modal drafts and refresh lookup lists | Not started | §5 |
| Unify part duplicate resolution contract | Not started | §6 |
| Adopt shared dialog in every creation entry point | Not started | §7 |
| Browser and database regression verification | Not started | §8 |
| Improve matching quality and outage observability | Optional follow-up, deferred | §9 |

## 1. For a New Session or Agent Picking This Up

Before starting:

1. Run `graphify query "PartForm JevGateService postWithJevConfirmation GoodsReceiptPage catalogPrefill"` for the current code map.
2. Recall Hindsight using `forson-business-suite`, `new-part-creation`, and `jev` for this investigation and previous gate decisions.
3. Check `git status`, `git log`, and §0 against the actual code. Investigation baseline was `c5e0ea4`; no fix was implemented in this session.
4. The current user authorization is planning only. Begin application changes only after an implementation request.

When implementing a phase, update its checklist and verification evidence, retain non-obvious decisions, and run `graphify update .`.

## 2. Objective and Decisions Already Taken

Creating or reusing a brand/group inside a part draft must preserve all entered part data. Creating a part from Parts, Goods Receipt, POS, or Invoicing must offer the same duplicate decision workflow, then continue in the originating screen.

- The user explicitly requested investigation and instructions, without implementing fixes.
- The requested choices are use the existing candidate or create a separate part. A proper Cancel/Back action must also preserve the draft without creating anything.
- High-confidence part matches currently block both choices. Meeting the request requires changing the part API policy as well as frontend integration.
- Proposed implementation details below are recommendations, not already shipped or separately approved policy changes.
- Keep backend validation of unique barcodes and other actual data constraints. Choosing a separate part does not make a conflicting barcode valid.
- Reusing a catalog part must not overwrite that part with the abandoned new-part draft's price, tags, barcodes, applications, brand, or group.
- User clarification: a genuinely different brand requires a separate SKU, even when the description/application/part number matches. Compare resolved canonical brand identities before applying AI similarity. A renamed/aliased spelling of the same brand is not a different brand; an unknown/missing brand is not proof of equality or difference.

## 3. Verified Causes

### 3.1 Goods Receipt destroys the form during a lookup refresh

`PartForm.jsx:290` calls `onBrandGroupAdded()` before patching the chosen brand/group ID. Goods Receipt passes its page-wide `fetchInitialData`, including through `GoodsReceiptModals.jsx` and its separate cataloging modal.

`GoodsReceiptPage.jsx:167` sets `loading = true`; line 879 returns only a Loading paragraph. This removes the modal subtree, including `PartForm` and all its local draft state. Once loading completes, the form mounts with its defaults or original prefill. The modal-open flag survives in the page, which makes the reopened empty form appear to have reset spontaneously.

There is a second reset mechanism in the Goods Receipt cataloging form: `catalogPrefill` is memoized on `[catalogTarget, brands, groups]`. Refreshing either lookup array recreates `initialValues`. `PartForm` makes `getInitialState` depend on `initialValues`, `part`, settings and edit mode, then its effect at lines 157–159 replaces `formData` whenever that callback changes. Tags and barcodes have analogous source-prop reset effects. Fixing only the page's Loading return is therefore insufficient for the prefilled cataloging path.

### 3.2 Other entry points have different problems

| Entry point | Verified behavior |
|---|---|
| Invoicing | Its `PartForm` has no `onBrandGroupAdded` prop. The unconditional callback call throws after brand/group creation, before selecting the returned ID and closing the inner modal. The brand/group may already be saved although the UI reports failure. |
| POS | Its lookup callback also reloads customers and selects Walk-in, potentially replacing the transaction's selected customer. It does not use Goods Receipt's page-wide loading mechanism in that callback. |
| Parts | Refreshes the catalog and lookup lists, but keeps the form mounted. Lookup-array changes alone do not occur in `getInitialState` dependencies. A universal brand-refresh-induced reset on this page was not established. |
| Purchase Order | Has another direct part-creation path and its own lookup refresh callback. It should adopt the shared behavior to prevent a remaining inconsistency. |

The shared form's reset-by-object-identity behavior is fragile, but it is not evidence that every parent currently triggers the same reset. Browser regression coverage should distinguish these paths.

### 3.3 Duplicate handling is only integrated on Parts

- `PartsPage.jsx:90` creates through `postWithJevConfirmation`.
- Goods Receipt (`:428`), POS (`:396`), Invoicing (`:249`), and `PurchaseOrderForm.jsx:459` call `api.post('/parts', ...)` directly.
- Those direct callers attach a generic toast error handler. When the API returns its expected duplicate HTTP 409, the user sees a save failure instead of a decision dialog.
- The existing helper only handles a 409 with `confirmation_required: true`. High-confidence conflicts set that field to false, so even Parts cannot resolve them through its dialog.
- The helper uses `window.confirm`: OK means reuse; Cancel means create a separate record. There is no genuine cancel action.
- The reuse response from `/parts` contains only `existing`, `part_id`, `display_name`, and Jev metadata. Directly reusing it in sales/receipt handlers would omit normal price, cost, tax and other part data. Replacing the POST call alone is incomplete.

### 3.4 Goods Receipt also has a separate cataloging API

`POST /api/purchase-orders/:id/lines/:lineId/catalog` currently bypasses Jev. It reuses the first active exact match on brand, group and normalized detail; otherwise it creates a part. It locks the PO line and atomically links the resulting part and clears `draft_part_data`.

This entry point needs explicit treatment for the requested consistent workflow. Preserve its atomic operation; do not replace it with separate create-and-link requests.

## 4. How the Automatic Creation Gate Works Today

This is the synchronous creation gate in `jevGateService.js`, not the background duplicate scanner or the Parts Cleanup merge workflow. It does not merge records.

1. `POST /api/parts` invokes `findPartDuplicate` before beginning the creation transaction.
2. If Jev is not configured/enabled, Meilisearch is absent, or detail plus part numbers is shorter than three characters, the gate returns no match.
3. It searches the active `parts` Meilisearch index using entered part numbers plus detail, requesting at most eight candidates.
4. It compares the proposed detail/part-number text with each candidate's display name, numbers and SKU through Jev's duplicate decision API.
5. Candidates are evaluated sequentially. The first candidate meeting the confirmation threshold is returned; it is not necessarily the highest probability among the eight.
6. The API applies the following policy. The repository `.env` threshold entries match these code defaults; the running process configuration was not inspected.

| Jev probability | Current outcome |
|---|---|
| Below 0.80 | Continue checking; create if no candidate qualifies |
| At least 0.80 and below 0.92 | Return 409 with `confirmation_required: true` |
| At least 0.92 | Return 409 with `confirmation_required: false`; block creation |

7. The helper prompts only for the middle band, then repeats the POST with `jev_confirmation: { candidate_id, action: 'use_existing' | 'create_new' }`.
8. The API reevaluates the match and honors the choice only when the fresh result is still in the confirmation band and has the identical candidate ID. A different candidate or a score crossing 0.92 causes another conflict, which the one-retry helper does not resolve.
9. Search/provider failures allow normal creation. If a provider evaluation fails partway through the candidate list, the service returns no match without evaluating the remaining candidates.

The proposed part's selected brand/group are not explicitly passed to the comparison. Candidate brand/group are fetched but not mapped as structured comparison fields; the candidate display name may contain some of that information. Applications, dimensions and barcode evidence are not explicitly compared. Therefore a 92% result is a model estimate based on limited text, not a database proof that two products are identical.

## 5. Phase 1 — Preserve Drafts — Not Started

- [ ] Add a lookup-only brand/group refresh callback to every parent. It updates lookup options without invoking page loading, reloading customers, changing customer/supplier/PO selections, or refreshing transaction state.
- [ ] Supply the missing Invoicing callback. Make the shared callback contract safe if omitted; a defensive optional call alone does not refresh the missing options.
- [ ] After successful brand/group creation or reuse, upsert the returned option and patch only `brand_id` or `group_id` using functional state updates. Close only the inner modal. A refresh failure after a successful save must not be reported as failed creation.
- [ ] Define a part-edit session boundary: initialize on modal opening, target-part change or explicit start-new/reset. Snapshot prefill and applicable defaults once per session. Do not replace a dirty draft merely because settings or source-object identities change.
- [ ] Keep form data, tags, barcodes, linked applications and dirty-state baseline synchronized to that session boundary. Preserve intentional edit-target changes, bulk edit and reset-on-reopen behavior.
- [ ] Stabilize Goods Receipt's prefill for the selected PO line; lookup refreshes must not reconstruct the live draft.
- [ ] Ensure stale optional group predictions cannot apply to a different draft session or supersede a manually selected group.

## 6. Phase 2 — Shared Part Resolution Contract — Not Started

- [ ] Keep candidate detection separate from the part creation policy. For parts, return an actionable duplicate decision for every qualifying match, including probability >= 0.92. Keep the score as evidence and use stronger wording for high confidence.
- [ ] Apply the brand identity rule first: distinct known canonical brands are separate catalog products, not reuse candidates. Show cross-brand matches as related alternatives if useful, without forcing reuse or blocking separate SKU creation. Missing/unknown brand requires review; do not infer equality from similar descriptions. Resolve aliases/retired brand IDs before comparison.
- [ ] Do not globally change `#noulMatch` in a way that silently changes customer/supplier gates. Adapt the part policy or add an explicit part-only mode.
- [ ] Use a machine-readable duplicate response code, candidate ID, confidence, comparison data and explicit available actions. HTTP 409 may remain the internal protocol; the UI consumes it as a decision state without an error toast.
- [ ] Validate candidate IDs consistently, require an explicit action, and reject malformed/stale confirmations. On reuse, reload the current canonical active part from PostgreSQL and return the enriched part shape expected by transaction handlers.
- [ ] On explicit separate creation, honor the acknowledged part decision across both confidence bands. Recheck database validity and normal uniqueness constraints. Do not let a repeated model score crossing a band silently invalidate the same reviewed candidate.
- [ ] Bind confirmation to the reviewed payload/candidate, for example through a short-lived server-signed decision token. A changed draft needs a new review. If the candidate changed/retired/merged, return a fresh review state instead of creating blindly or looping retries.
- [ ] Extend the atomic PO-line catalog endpoint to consume the same resolution contract. Present its existing exact candidate through the shared choice workflow as well. Preserve PO-line locks, status/permission checks, original line quantity/cost, and atomic linking/creation/clearing of draft metadata.
- [ ] Reuse must leave existing master data unchanged. Creation remains transactional. No schema migration is expected for a stateless signed-decision approach; reassess if durable override history is selected.

## 7. Phase 3 — Shared Dialog and All Callers — Not Started

- [ ] Implement one part-specific controller/helper plus reusable dialog, used by every part-creation caller. Keep the generic brand/group helper compatible unless separately redesigning those workflows.
- [ ] Offer three clearly labelled actions: **Use existing part**, **Create separate part**, **Back to editing**. Closing or Escape means Back; it must never imply creation.
- [ ] Show submitted versus candidate description, SKU/part numbers, brand/group and available identifying details. Treat model probability as supporting information, not certainty.
- [ ] Return an explicit outcome such as `{ outcome: 'created' | 'existing' | 'cancelled', part }`. Only the first two may run a parent's success continuation.
- [ ] Disable repeated submits while saving/reviewing. Preserve the draft on cancellation, network/validation failure and refreshed candidate review. Bound stale-decision retries and require another explicit user decision.
- [ ] Update Parts, Goods Receipt, POS, Invoicing and Purchase Order creation. Also update Goods Receipt's PO-line cataloging form through its atomic endpoint.
- [ ] In Parts, refresh the list and preserve the existing new-part application-manager continuation only for newly created parts.
- [ ] In POS/Invoicing/Goods Receipt/PO, feed the fully resolved part through the existing add/update-line logic, once. If already in the document, preserve its existing quantity-increment behavior and page pricing rules. Use current state in async callbacks to avoid losing edits made while the dialog was open.
- [ ] Distinguish success text for created versus reused. Preserve page-specific tag defaults for newly created records; do not apply them to a reused catalog row.

## 8. Verification and Acceptance Criteria

### Completed during investigation

- [x] Graphify queries and direct source tracing across all web `PartForm` callers, API gate and confirmation helper.
- [x] Existing gate/client suites: **2 suites, 13 tests passed** using the command below.
- [x] An ephemeral Node assertion harness executed the actual part gate with controlled search/Jev responses: 0.79 allowed; 0.80/0.91 confirmed; 0.92/0.99 blocked.
- [x] The same harness executed the actual confirmation-helper body with isolated API/window dependencies: middle-band conflict opened one dialog and made two POSTs; high-band conflict opened zero dialogs and rejected after one POST.
- [x] `git diff --check` passed. `graphify update .` was attempted but failed with `Operation not permitted`; the graph was not refreshed. The document remains the handoff source.
- [ ] No end-to-end browser reproduction was performed. Modal lifecycle findings are source-verified. No real Jev requests, business-data writes, migrations, or production checks were performed.

```bash
npm run -w packages/api test -- --runInBand --runTestsByPath tests/jevGateService.test.js tests/jevClient.test.js
```

### Required after implementation

- [ ] Browser: in each entry point, fill description, numbers, price/cost, unit, tax, tags, barcodes, applications and flags; create/reuse a brand, then a group; all other values survive and the returned selection stays selected.
- [ ] Browser: Goods Receipt generic creation AND prefilled PO cataloging survive lookup refreshes; POS keeps its selected customer; Invoicing selects the saved brand/group without a callback error.
- [ ] Browser: middle/high-band reuse, separate creation, Back, close, Escape, API failure and double-submit all behave consistently on Parts, Goods Receipt, POS, Invoicing and Purchase Order.
- [ ] API/DB: reuse returns a complete active canonical part without inserting/updating catalog data; separate creates exactly one part; invalid action, expired/payload-changed decisions and retired/changed candidates require valid resolution.
- [ ] API/DB: PO-line resolution creates or reuses and links atomically, preserves quantities/costs, rejects stale line/status and rolls back failures.
- [ ] Regression: edited part, bulk edit, reopening a fresh modal, brand/group duplicate resolution, unique barcode conflicts and unavailable Jev/search remain correct.
- [ ] Use deterministic provider fixtures for confidence boundaries; PostgreSQL integration coverage must use a disposable database. Do not use real model probabilities as test expectations.

```bash
# Existing baseline, then add the new route/dialog/DB coverage described above.
npm run -w packages/api test -- --runInBand --runTestsByPath tests/jevGateService.test.js tests/jevClient.test.js
npm run -w packages/web test
npm run -w packages/web lint
npm run -w packages/web build
git diff --check
graphify update .
```

## 9. Optional Improvements and Explicit Deferrals

Recommended order: fix draft loss and consistent user decisions first, then improve matching evidence before tuning thresholds.

| Improvement | Benefit / tradeoff |
|---|---|
| Include explicit brand, group, part numbers and fitment/specification evidence | Helps distinguish similarly named physical products. More valuable than treating a text-only model probability as proof. |
| Rank the bounded candidate set and show multiple credible candidates | Avoids stopping at the first moderate match when a better match exists later. Costs additional evaluation time/requests; measure latency first. |
| Deterministic DB identifier checks and fallback matching | Reduces dependence on active-only, potentially lagging search results. Keep true unique-barcode constraints separate from advisory similarity. |
| Remember an explicit distinct-part decision after successful creation | May reduce repeat cleanup suggestions, but should be payload/identity scoped and invalidated after material edits. The current creation gate does not consult cleanup exclusions. Requires separate design. |
| Measure gate outages, latency, reuse and overrides | Makes the existing allow-on-outage behavior visible and gives evidence for future threshold changes. |

Deferred: automatic merges, changing customer/supplier/brand/group duplicate policy, globally retuning thresholds, redesigning the background scanner, mandatory manager approval/reason fields and historical duplicate cleanup. None are necessary to fix the two reported behaviors.

## 10. Files Touched So Far

- `docs/plans/2026-10-18_new-part-modal-and-duplicate-gate.md` — investigation and pending instructions only.
- Graphify-generated metadata may change when this document is registered. Application source and test files were not edited.

## 11. Change Log

- 2026-10-18: Traced reset/unmount and missing callback causes, direct-POST integration gaps, high-confidence block policy, sparse reuse response and atomic PO cataloging exception. Verified 13 baseline tests plus isolated gate/helper boundaries. Wrote this plan; no fixes implemented.
- 2026-10-18: User clarified that a different brand requires a new SKU. Added canonical brand identity as a deterministic rule preceding AI similarity; no implementation performed.
