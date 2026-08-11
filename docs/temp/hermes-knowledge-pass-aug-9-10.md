# Hermes Agent Knowledge Pass: August 9-10, 2026

This document synthesizes all system changes, architectural decisions, and bug fixes implemented between August 9 and 10, 2026. It is optimized for agent ingestion to provide immediate context for ongoing development on the Forson Business Suite.

## 1. SOA-Gen Offline API & Reconciliation
A new standalone utility was added for offline Statement of Account (SOA) generation and ledger reconciliation.

*   **API (`packages/api/routes/soaGenRoutes.js`)**: Mounts `POST /api/soa-gen/generate`. Reconciles customers and ledgers without DB settings queries, defaulting to static fallback parameters.
*   **Matching Logic**: Prioritizes `CUSTOMER_ID` and `COMPANY_NAME`/`Correspondent` mapping keys. Handles name-only matching and normalizes by stripping `CUST-` prefixes to avoid template duplication.
*   **Output**: Capable of generating custom PDF pages or compiling multiple records into ZIP archives (using Node's `child_process exec()` against the `zip` CLI).
*   **Frontend (`packages/web/src/App.jsx`)**: Mounts `SoaGenPage` at a case-insensitive `/soa-gen` route, bypassing auth templates and sidebars. Provides CSV file uploaders (`customers.csv`, `transactions.csv`), a summary list preview, and bulk generation features.

## 2. Paperless-ngx Integration & Normalization
The integration with Paperless for dynamic receipt image attachment (`paperlessService.js`) was hardened to prevent false positive matches.

*   **Normalization Rules (`normalizeToHyphen`)**: Standardizes receipt prefixes to a hyphenated format (e.g., `CI_1011` to `CI-1011`). Crucially, this regex (`/^([A-Za-z]+)[-_ ]+(.+)$/`) only modifies known prefixes (`CI`, `DR`, `SI`, `VAT`, `OR`, `DM`, `INV`, `PMT`). Arbitrary prefixes are returned unchanged.
*   **Placeholder Guard (`isValidReceiptQuery`)**: Immediately rejects placeholder strings (`'-'`, `'—'`, `'N/A'`, `'none'`, `'null'`, `''`) and non-alphanumeric queries. `findDocumentByReceiptNo` returns `null` for these to prevent Paperless's `title__icontains=-` from falsely matching unrelated hyphenated documents.
*   **Indexing**: Results are mapped under both raw and normalized keys. The SOA generator route correctly uses `paperlessService.normalizeToHyphen(rNo)` for `paperlessMatchMap` lookups.

## 3. Physical Receipt Uniqueness & Schema Updates
The physical receipt number is now explicitly tracked and validated across the system.

*   **New Field**: `customer_payment` table added `physical_receipt_no` (`VARCHAR(50)`) via migration `20260810_01_add_physical_receipt_no_to_customer_payment.sql`. *(CRITICAL: Never edit `initial_schema.sql` or existing migrations directly).*
*   **Uniqueness Enforcement**: Migration `20260810_02_enforce_physical_receipt_uniqueness.sql` introduces the `is_physical_receipt_no_taken` stored procedure. It checks across `invoice`, `customer_payment`, and `staged_sale` tables. Endpoints (`POST /api/payments`, `POST /api/invoices`, etc.) return `HTTP 409 Conflict` if the receipt number is taken.
*   **Reference Separation**: `invoice_payments.reference` is strictly reserved for per-method instrument tracking (e.g., GCash ref, cheque #). Invoice creation routes no longer pollute this field with physical receipt numbers.
*   **SOA Display Standards**: 
    *   **Primary Ref**: Physical receipt number (`OR-xxxxx`), retrieved by left-joining `customer_payment`.
    *   **Sub Ref**: System-generated codes (`PMT-YYYYMM-XXXX`, `INV-xxxx`, `CN-xxxx`).
    *   **Notes**: Internal method references are appended to entry descriptions (e.g., `'Via: GCASH (Ref: 111233)'`).

## 4. A/R Balance Reset & Database Cleanup
Guidelines established for safely resetting A/R data without corrupting the append-only ledger or inventory.

*   **Inventory Safety**: It is completely safe to cascade-delete invoices to reset A/R. Inventory is computed dynamically from `inventory_transaction`, which has no foreign keys referencing `invoice` or `invoice_line`.
*   **Incorrect Reset Approach**: Simply updating invoice status to `'Unpaid'` is incorrect and will cause the system to evaluate them as outstanding debt.
*   **One-Time Cleanup Script (`docs/temp/once_ar_cleanup.sql`)**: Provided as a safe PostgreSQL cleanup utility. Wraps deletions in a single transaction and temporarily disables triggers on `ar_ledger`, `customer_wallet`, `invoice_payments`, `customer_payment`, `credit_note`, `invoice`, etc., to bypass the `trg_ar_ledger_immutable` constraint. It also clears all customer credit hold flags.

## 5. Testing & CI Pipeline Constraints
*   **Puppeteer v23+ Buffers**: `page.pdf()` now returns a `Uint8Array`. Helper functions returning PDFs for `options.returnBuffer` must wrap the result in `Buffer.from(pdfTypedArray)` to ensure `Buffer.isBuffer(pdfBuffer)` assertions pass in tests.
*   **Containerized PDF Rendering**: Host OS environments often lack shared libraries (like `libasound.so.2`) required by headless Chromium. Unit and integration tests invoking Puppeteer MUST be executed inside the backend Docker container (e.g., `docker compose exec backend npx jest tests/<file>.test.js`).
*   **Dynamic Auth Mocks**: Integration tests that insert test employees in `beforeAll` (e.g., `receivePaymentPhysicalReceipt.test.js`) must update the `authMiddleware` mock dynamically (e.g., `req.user.employee_id = testEmployeeId`). Hardcoding `employee_id: 1` causes PostgreSQL foreign key constraint violations (`customer_payment_employee_id_fkey`) because `beforeAll` generates dynamic IDs via auto-increment.
