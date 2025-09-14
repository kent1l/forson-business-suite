# Forson Business Suite — Features Documentation

This document records feature descriptions, design decisions, UX flows, integration points, and implementation notes for major features in the Forson Business Suite.

Guidelines for adding new feature documentation

- Purpose: Each feature should have a clear description of what it does, the motivation, the user flows it affects, backend and frontend components involved, API endpoints, database schema changes (if any), and any migrations or setup steps required.
- Location: Add new feature sections inside this file under a clear header. For large features, create a dedicated `docs/features/<feature-name>.md` and add a short index entry here.
- Format:
  - Title: A short descriptive name.
  - Summary: 2–3 sentence summary of the intent and user benefit.
  - UX Flow: Step-by-step user-facing flow(s) including conditional branches and screenshots/ASCII diagrams when helpful.
  - Data Flow & API: List relevant frontend components, API endpoints, and payload format examples.
  - DB Changes: Schema changes, migration filenames, and reasoning.
  - Error Modes: Common failure modes and guidance on handling them.
  - Edge Cases: Known edge cases and recommendations.
  - Backwards Compatibility: Notes about legacy flows and fallbacks.
  - Deployment & Testing: Any special deployment steps, integration tests to add, and manual test checklist.
  - Files Changed: A summary list of files that implement the feature (frontend and backend), and the main functions to inspect.

- Review: When adding a feature doc, include links to the PR or issue that introduced it, and record any follow-up tasks.

---

## Split Payments (detailed)

Title: Split Payment / Multi-method checkout

Summary

The Split Payment feature enables recording an invoice that is paid using multiple payment methods (e.g., part cash + part credit card), capturing per-method references, tendered amounts, and physical receipt numbers when required. It supports both a modern split-payment modal for POS and a legacy fallback for simple single-method invoicing.

User benefit

- Allows customers to pay with multiple methods in a single checkout.
- Captures required metadata per method (e.g., card reference, receipt number) for reconciliation.
- Supports manual settlement flows and marking payments as settled.

Feature flags / settings

- `ENABLE_SPLIT_PAYMENTS` (string 'true' / 'false'): when true, Invoicing and POS pages will use the split-payment modal flow to collect payment lines.
- `PAYMENT_METHODS` (comma-separated string): legacy fallback list used when the app doesn't fetch payment methods from the API.

High-level UX flows

1. InvoicingPage (checkout with split payments enabled)
   - User creates invoice lines and clicks "Post Invoice".
   - Instead of immediately posting the invoice, the app opens the Split Payment modal.
   - The modal lists one or more payment lines, each with:
     - Payment Method (select)
     - Amount
     - Tendered amount (optional, if method allows giving change)
     - Reference (if method requires it; label configurable)
     - Payment status (for existing payments in edit scenario)
   - The modal validates:
     - Each line must have a payment method selected
     - Each line must have amount_paid > 0
     - Required references and physical receipt numbers are present based on method config
     - Total payments must be >= total due (allowing small rounding tolerance)
   - On confirm, the frontend calls the API to create the invoice, then posts the payments to `/invoices/:id/payments`. The backend updates invoice balances and triggers Meilisearch sync if required.

2. Legacy single-payment flow (split payments disabled)
   - User selects a single payment method on the Invoicing page.
   - On Post Invoice, the system sets `amount_paid = subtotal` if the selected method string equals `cash` (case-insensitive). For non-cash methods, `amount_paid = 0` (invoice created unpaid). This is an intentional behavior but can be changed.

Frontend components involved

- `packages/web/src/pages/InvoicingPage.jsx`
  - Entry point for checkout in the invoicing UI. Opens `SplitPaymentModal` when `ENABLE_SPLIT_PAYMENTS === 'true'`.
  - `handleConfirmSplitPayment(payments, physicalReceiptNo)`:
    - Sends POST /invoices (invoice payload without payments)
    - Then sends POST /invoices/:id/payments with payload { payments, physical_receipt_no }

- `packages/web/src/components/ui/SplitPaymentModal.jsx`
  - Primary modal UI for split payment capture.
  - Responsibilities:
    - Fetch payment methods from API (`/payment-methods/enabled`) or fall back to `settings.PAYMENT_METHODS`.
    - Provide UI to add/remove payment lines.
    - Auto-allocate remaining amount to a line via "FILL" button.
    - Validate payment lines (method selected, amount > 0, references/receipt when required).
    - Compose formatted payments and call the `onConfirm(formattedPayments, physicalReceiptNo)` passed by the parent.
  - Important behaviors/constraints:
    - `amount_paid` must be > 0 for every line. The modal prevents confirmation if any line is zero-valued.
    - The modal uses `method.config` properties (e.g., requires_reference, requires_receipt_no, change_allowed, reference_label) when method objects are provided by the API. Legacy setting fallback uses heuristics to populate these configs.

Backend endpoints & DB interactions

- POST /invoices
  - Creates a new invoice record with the lines payload.
  - In legacy flow may be called with `amount_paid` and `payment_method` to record immediate payment.

- POST /invoices/:id/payments
  - Accepts `payments: [{ method_id, amount_paid, tendered_amount, reference, metadata }]` and optional `physical_receipt_no`.
  - Backend validates method_id (numeric) or supports legacy_ prefixed strings and may create transient method entries if metadata includes method_name.
  - Inserts into `invoice_payments`, updates invoice balances, and optionally marks payments as `settled` based on settlement_type.

- POST /payments/:id/settle
  - Marks a payment record as settled (used for manual reconciliation).

Database changes / migrations

- Migrations that added settlement support:
  - `20250903_add_meili_related_triggers.sql` (related Meilisearch triggers)
  - `20250906_add_part_number_soft_delete.sql` and others (see `database/migrations` directory). The exact migration that added `payment_status`/`settled_at` to `invoice_payments` should be listed here; reference the migrations folder for the applied change.

Failure modes & edge cases

- Invalid method_id type (string instead of numeric) previously caused a backend 500 due to SQL type mismatch. Frontend change: resolve method_id before send (or send `legacy_{index}` strings) to prevent this.
- If invoice creation succeeds but the subsequent payments POST fails, the invoice exists but has no payments applied. The frontend currently surfaces the backend error and rethrows; consider offering retry/void options.
- Race conditions when multiple clients update an invoice simultaneously: the backend should rely on transactions where possible.

Backwards compatibility

- If the API is unreachable or payment-methods API is missing, the modal falls back to `settings.PAYMENT_METHODS` and synthesizes `method.config` heuristics.
- Legacy calls to POST /invoices with `payment_method` and `amount_paid` still work.

Manual test checklist

- Create invoice with split payments (two or more methods) and confirm total due is covered and payments show up on invoice details.
- Test card payment that requires reference (verify validation blocks submission without reference).
- Test cash payment with change (tendered_amount > amount_paid) and verify change calculation.
- Test creating an invoice where payment POST fails; verify messaging and the ability to retry.
- Test physical receipt required flows: ensure `physical_receipt_no` is passed and backend rejects duplicates (409) and the frontend surfaces the message.

Files changed (summary)

- Frontend:
  - `packages/web/src/pages/InvoicingPage.jsx` (opens modal, handles invoice & payments POST)
  - `packages/web/src/components/ui/SplitPaymentModal.jsx` (modal UI and validation)
  - `packages/web/src/components/ui/PaymentModal.jsx` (small quick-payment modal used in POS)
  - `packages/web/src/pages/POSPage.jsx` (POS flow changed to pass paymentMethods to PaymentModal and coerce method ids)
  - `packages/web/src/components/refunds/InvoiceDetailsModal.jsx` (display payment status and manual settle action)

- Backend: relevant routes that accept payments (see `packages/api/routes/*`) and database migrations in `database/migrations/`.

Notes and future improvements

- Consider making invoice + payments creation atomic in the backend to avoid transient unpaid invoices.
- Improve UX by labeling the Post Invoice button differently when split payments are enabled (e.g., "Checkout"), or by offering two buttons: "Post Unpaid Invoice" and "Post & Receive Payment".
- Replace settings-based payment dropdowns with API-driven payment method objects across all pages for consistency.

---

Add new feature documentation

1. If the feature is small and self-contained, add a new section in this file under a clear header.
2. For larger features, create `docs/features/<feature-name>.md`, populate it using the format above, and add an entry here referencing the new file.
3. When adding documentation, also update the related PR description and reference the feature doc path.
4. Keep `docs/FEATURES.md` as the single index for feature-level docs.

(End of file)
