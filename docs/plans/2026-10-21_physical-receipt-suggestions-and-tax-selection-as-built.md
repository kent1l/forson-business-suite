# Physical Receipt Suggestions, Cashier Assignment & Tax Selection — As Built

**Status:** Completed  
**Branch:** `auto-receipt-increment-and-tax-selection`  
**Commits:** `ff4b3cd`, `3c2b439`, `6d83a43`, `9ad7ffd`  
**Authoritative Plan Reference:** `docs/plans/2026-10-21_physical-receipt-suggestions-and-tax-selection-v2.md`

---

## 1. Status at a Glance

| Phase / Area | Status | Commits | Key Deliverables & Notes |
|---|---|---|---|
| **Phase 1: Schema & DB Invariants** | Completed | `ff4b3cd`, `3c2b439` | `20261021_01_physical_document_system.sql`, `20261021_02_collection_group_index.sql`. Tables: `physical_document_type`, `physical_document_series`, `physical_document_registry`, `customer_payment_collection_group`, etc. |
| **Phase 2: Shared API & Cashier Posting** | Completed | `3c2b439` | `physicalDocumentService.js`, `physicalDocumentRoutes.js`, guarded `stagedSaleRoutes.js` (`PARTSMAN_RECEIPT_ASSIGNMENT_PROHIBITED`), updated `invoiceRoutes.js`, `paymentRoutes.js` (`POST /payments/collection-group`). |
| **Phase 3: Settings Management** | Completed | `3c2b439` | Series & Types CRUD, Selection Policy matrix, sequence adjustments with audit log, and spoilage registration/corrections. |
| **Phase 4: Connected UI** | Completed | `6d83a43` | `PhysicalDocumentControl.jsx` (short-label + mono reference, Portal popover, Esc/back focus restore), `PhysicalDocumentSettings.jsx`, wired in POS, Invoicing, Cashier Approval Desk, and Receive Payment form. |
| **Phase 5: Tests & Rollout Verification** | Completed | `ff4b3cd`, `3c2b439`, `6d83a43`, `9ad7ffd` | API Jest suites (11/11 pass), Web tests (122/122 pass), Web build (0 errors, 17.6s), Web & API lint (0 errors). |

---

## 2. For a New Session or Agent Picking This Up

Before starting:
1. Run `graphify query "physical document receipts series"` for a live view of the code topology and symbol relationships.
2. Verify migration status with `docker compose exec -T backend node scripts/migrate.js status`.
3. Run tests inside Docker: `docker compose exec -T backend npx jest tests/physicalDocumentSystem.test.js tests/physicalDocumentAPI.test.js` and `npm run -w packages/web test`.

When making further changes:
1. Always run `graphify update .` to update the AST graph.
2. Adhere strictly to the zero-yapping and diff-first policies in `.agents/rules/`.

---

## 3. Core Architecture & Key Decisions

1. **Pre-Printed Paper Receipt Reality:**
   - Pre-printed paper booklets exist physically at cash registers.
   - Suggestions follow `HIGHEST_PLUS_ONE` or `LAST_ISSUED_PLUS_ONE`. Notebook mode never auto-increments and never remembers references.
2. **Exact Cashier Assignment at Posting Time:**
   - Invoicing and Cashier Approval Desk require an explicit assignment decision (`PAPER` with reference or `NOTEBOOK`).
   - Staging is strictly assignment-free: POST `/sales/staging` rejects physical receipt assignment with 422 `PARTSMAN_RECEIPT_ASSIGNMENT_PROHIBITED`.
   - Legacy `-STG-...` suffix mutations and while-loop auto-renumbering loops were completely excised.
3. **Mandatory Skip Popover:**
   - Any manual edit diverging from the active suggestion triggers a popover requiring reason selection (`NEW_BOOKLET`, `SPOILED_SUGGESTION`, `OTHER_NOT_SPOILED`).
   - Pure formatting changes (e.g. `si 100` -> `SI-100`) bypass the prompt.
4. **Document Selection Policy:**
   - Managed per document type: `FIXED_DEFAULT`, `LAST_SUCCESSFUL` (only updated upon successful transaction commit), or `ALWAYS_ASK`.
   - Notebook is never remembered as a sticky default.
5. **Grouped Multi-Instrument Collection Adapter:**
   - When a collection payment is split across multiple tenders (e.g., Cash + Cheque), `POST /payments/collection-group` wraps them under a single `customer_payment_collection_group` and shares the single physical collection receipt without partial index collision.

---

## 4. Verification Record

- **Database Migrations:** 242 applied, 0 pending, 0 drift.
- **Backend API Tests:** `packages/api/tests/physicalDocumentSystem.test.js` and `packages/api/tests/physicalDocumentAPI.test.js` passing 100% (11/11 tests).
- **Frontend Utilities & Web Tests:** `packages/web/tests/physicalDocumentFormat.test.js` and full suite passing 100% (122/122 tests).
- **Linting:** `npm run -w packages/api lint` (0 errors), `npm run -w packages/web lint` (0 errors).
- **Web Build:** `npm run -w packages/web build` succeeded cleanly in 17.6s.
