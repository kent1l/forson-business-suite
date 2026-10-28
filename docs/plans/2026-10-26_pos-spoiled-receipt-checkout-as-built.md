# POS Spoiled Receipt Override & Checkout Errors — As Built

**Status:** Completed and verified locally.  
**Context:** Follow-up to the physical receipt suggestions and Sales History receipt correction work.  
**Delivery:** Working-tree changes; no migration required.

## 1. Status at a Glance

| Area | Status | Deliverables & Notes |
|---|---|---|
| Spoiled suggestion checkout | Completed | Corrected the spoilage audit insert's parameter list; the original suggestion is spoiled and the replacement is issued atomically. |
| Receipt field and checkout messages | Completed | Normal replacement field styling, explicit original-paper spoilage note, server reasons shown for single and split payments. |
| Focused verification | Passed | Five real PostgreSQL checkout regressions, 12 existing receipt API/schema tests, Chromium interaction check, 13 web test files, build and lints. |

## 2. For a New Session or Agent Picking This Up

Before starting:
1. Run `graphify query "POSPage physicalDocumentService spoiled suggestion checkout"` for current code relationships.
2. Recall Hindsight with tags `forson-business-suite`, `pos-spoiled-receipt` for debugging context.
3. Confirm this record against `git status`, `git log`, and the current implementation.

After further changes, update this record, retain new non-obvious decisions, and run `graphify update .`.

## 3. Business Objective & Decisions

Cashiers must be able to mark a suggested preprinted receipt spoiled and complete the sale using an unused replacement. The field shows the replacement, so choosing the spoilage reason must not color that field as though the replacement is spoiled. A neutral note identifies the original suggested receipt and states that spoilage takes effect at checkout.

Occupied receipt errors identify the reference, whether it is issued/spoiled/voided, and instruct the cashier to choose an unused number. Both POS payment paths show API validation messages for all response statuses; errors without a useful server message retain a fallback.

## 4. Architecture & As Built

### Shared posting service

`postPhysicalDocument` records original-paper spoilage and replacement issuance inside the caller's transaction. The spoilage audit query already used a literal `SPOILED` event type but also supplied it as a bound argument, yielding nine values for eight placeholders. Removing the redundant argument fixes the failure and correctly aligns the original reference, replacement, reason, notes and actor.

Validation and posting retain the existing occupied-reference checks and error codes. Their messages now also give the next action. No receipt-number reassignment or automatic renumbering behavior was added.

### Shared control and POS

`PhysicalDocumentControl` keeps the replacement input's ordinary appearance after confirming `SPOILED_SUGGESTION`. Its status text names `exception.spoiled_reference`. POS single and split payment catches use `getSaleErrorMessage`, which prefers a server message/error string, preserves errors raised before a request is sent, and falls back when needed.

### Verification

Real PostgreSQL tests exercise `POST /api/invoices`: successful cash checkout with spoilage, rejection of issued/spoiled/voided replacements, and rollback after a later payment validation error. Assertions cover registry identities/states, source links, exact spoilage audit fields, and absence of partial invoices/events after failure.

The Chromium fixture intercepts API requests and verifies editing the suggested receipt, confirming spoilage, retaining the replacement and token, normal field styling, explicit original-paper status, and cancellation restoring the suggestion.

## 5. Explicitly Deferred

Release/version changes, production deployment, and commits are outside this bug fix. No schema change is needed.

## 6. Files Touched

- `packages/api/services/physicalDocumentService.js`
- `packages/api/tests/physicalDocumentCheckout.test.js`
- `packages/web/src/components/common/PhysicalDocumentControl.jsx`
- `packages/web/src/pages/POSPage.jsx`
- `packages/web/src/utils/saleErrorMessage.js`
- `packages/web/tests/saleErrorMessage.test.js`
- `packages/web/tests/physicalDocumentBrowser.mjs`
- `packages/web/tests/fixtures/physicalDocumentBrowser.html`
- This record and generated graph updates.

## 7. Verification Commands

The database tests use the existing isolated `forson_receipt_control_20261022_test` database, preserving immutable audit records and using unique fixtures. They do not modify live sales.

```bash
docker exec -e DB_NAME=forson_receipt_control_20261022_test forson_backend_dev npm test -- --runInBand tests/physicalDocumentCheckout.test.js tests/physicalDocumentSystem.test.js tests/physicalDocumentAPI.test.js
docker exec -i forson_backend_dev node --input-type=module < packages/web/tests/physicalDocumentBrowser.mjs
npm run -w packages/web test
npm run -w packages/web build
npm run -w packages/api lint
npm run -w packages/web lint
git diff --check
graphify update .
```

Five checkout tests and the 12 existing receipt tests passed. All 13 web test files, Chromium checks, and the production build passed. Both full linters reported zero errors with existing warnings; changed JavaScript files also passed targeted lint checks.

The code graph refreshed successfully (7,684 nodes, 13,541 edges). Graphify reported 30 source-metadata extraction warnings and skipped HTML rendering because the graph exceeds 5,000 nodes; it updated the code graph and report. Deep semantic indexing of this document was not run.

## 8. Change Log

- **2026-10-26:** Fixed spoiled-suggestion checkout failure, clarified original/replacement presentation, exposed checkout validation reasons, and added database/browser regressions.
