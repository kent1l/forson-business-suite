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

## Sales History — Summary (detailed)

Title: Sales History — Summary Cards

Summary

The Sales History page includes a compact and expanded "Summary" section that provides a quick at-a-glance view of sales performance for the selected date range. The summary aggregates invoice-level data (gross, refunds, net, A/R) and payment-level data (cash vs non-cash collections, payment method breakdown) to help finance and operations teams quickly understand daily/period cash flows and collection effectiveness.

Why this exists

- Provide fast insights (Net Sales, Collected, Cash after Refunds, Collection Rate, A/R Outstanding) without navigating to detailed reports.
- Surface payment mix (cash vs non-cash) and top customer contribution for operational decisions.

Metrics and formulas

- Gross Sales: Sum of `invoice.total_amount` for all invoices in the selected date range where invoice.status != 'Cancelled'.
- Refunds: Sum of `invoice.refunded_amount` (or `credit_note` totals when computing approximate cash refunds). Backend `invoice` queries send `refunded_amount` with invoices; for approximate cash refunds the frontend calls `/api/payments/refunds-approx` which aggregates `credit_note.total_amount`.
- Net Sales: Sum of `net_amount` per invoice. Backend computes `GREATEST(i.total_amount - r.refunded_amount, 0) AS net_amount` so frontend trusts `net_amount` when present and falls back to `max(total - refunded, 0)`.
- Invoices Issued: Count of active invoices in range (excludes cancelled).
- Avg Net Invoice: `Net Sales / (count of invoices with net_amount > 0)`.
- Amount Collected: Sum of `min(invoice.amount_paid, invoice.net_amount)` for active invoices (collection capped at net to avoid overstatement).
- Collection Rate: `Amount Collected / Net Sales` (capped at 100%).
- A/R Outstanding: Sum of `GREATEST(balance_due, 0)` across invoices (backend exposes `balance_due` via invoice queries using `GREATEST((i.total_amount - r.refunded_amount) - i.amount_paid, 0) AS balance_due`).
- Refund Rate: `Refunds / Gross Sales` (capped at 100%).

- Cash Collection (phase 1 heuristic): The frontend calls `/api/payments` (payments_unified view) and aggregates payments by method. Cash calculations:
  - Identify cash methods: preferred path is to use `GET /api/payment-methods` (when `ENABLE_SPLIT_PAYMENTS === 'true'`) and treat `pm.type === 'cash'` as cash methods. Fallback: legacy string comparison to `'cash'`.
  - For each payment row returned by `/api/payments`:
    - `amount` = `amount_paid` (value applied to invoice)
    - `tendered_amount` = `tendered_amount` (if present); use `amount` as fallback when tendered is null.
    - `change` = `max(tendered_amount - amount, 0)`
    - If method is cash: `cashCollected += tendered_amount` (or amount fallback); `changeReturned += change`.
    - If non-cash: `nonCashCollected += amount`.
  - `cashCollectedNet = max(sum(tendered) - sum(change), 0)` — this resolves to sum(amount) for well-formed rows, and correctly handles payments that included change.
  - `cashMix = cashCollected / (cashCollected + nonCashCollected)` (zero when denominator is zero).
  - `approxNetCashAfterRefunds = max(cashCollectedNet - refundsApprox, 0)`, where `refundsApprox` is obtained via `/api/payments/refunds-approx` which sums `credit_note.total_amount` for the date range. Note: this is an approximation and assumes refunds were cash-outs.

Data sources & API routes

- Invoices: `GET /api/invoices?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` — returns invoice rows including `total_amount`, `refunded_amount`, `net_amount`, `amount_paid`, `balance_due`, `status`, `invoice_number`, and customer fields.
- Payments: `GET /api/payments?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` — returns payments from `payments_unified` view. Important: current implementation returns `payment_id, customer_id, employee_id, created_at AS payment_date, amount_paid AS amount, tendered_amount, COALESCE(legacy_method, method_name) AS payment_method, reference` and uses `(created_at AT TIME ZONE 'Asia/Manila')::date` for range filtering.
- Refunds approximation (credit notes): `GET /api/payments/refunds-approx?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` — returns `{ total_refunds }` computed from `credit_note` table using Manila date-zone conversion.
- Payment Methods: `GET /api/payment-methods` (and `/api/payment-methods/enabled`) — returns `method_id, code, name, type, enabled, sort_order, config` and is used to identify cash-type methods and to display the payment-method breakdown when split payments are enabled.

Frontend implementation notes (`SalesHistoryPage.jsx` summary logic)

- The summary is a `useMemo` that depends on `invoices`, `payments`, `refundsApprox`, and `paymentMethods`.
- It filters out invoices with `status === 'Cancelled'`.
- It uses a defensive `currencySafeNumber()` helper to coerce numbers safely.
- The payment aggregation relies on `p.reference` to detect payments attached to invoices (invoice payments use `reference = invoice_number`), and skips payments whose `reference` looks like an invoice number but is not present in the current invoice list. This avoids counting payments tied to deleted invoices.
- Payment method grouping uses `p.payment_method` (returned by the `/api/payments` endpoint as `COALESCE(legacy_method, method_name)`) and aggregates `amount` and `count` per method for the breakdown card.

Edge cases and caveats

- Timezones: All date filters use `(created_at AT TIME ZONE 'Asia/Manila')::date` on the backend when querying invoices, payments, and credit notes. The frontend sets default `startDate` and `endDate` using Manila time via `toZonedTime(new Date(), 'Asia/Manila')`, but users in different timezones should understand date-range semantics are Manila-local.
- Payments source table: Historically some payments were stored in `customer_payment` while new split payments use `invoice_payments`. The `payments_unified` view normalizes these into a consistent shape; ensure backend query doesn't filter out `invoice_payments` if you want complete data.
- Refunds approximation: `GET /api/payments/refunds-approx` aggregates `credit_note.total_amount`. This is a heuristic — refunds may not correspond to cash refunds (store credit, reversal to card, etc.). Use with caution for financial reporting.
- Payment method detection: Rely on `payment_methods.type === 'cash'` where available. Legacy entries stored as string names may require heuristics; prefer to seed `payment_methods` or enable split payments so methods are standardized.
- Null tendered amounts: Invoice payments often omit `tendered_amount` when there was exact change or when not recorded. The frontend falls back to using `amount_paid` for tendered when tendered is null so the cash totals don't undercount.

Developer notes & follow-ups

- Consider moving payments + refunds aggregation to the backend as a single `sales_summary` endpoint to reduce client-side heuristics and ensure consistent date handling and currency rounding.
- When implementing more accurate refund classification, add `refund_method` or `credit_note.refund_method` to the schema so refunds can be categorized by cash vs non-cash.
- Add unit tests for `SalesHistoryPage`'s stats computation (happy path + edge cases):
  - No invoices
  - Invoices with negative balances / overpayments
  - Payments with missing tendered_amount
  - Payments referencing deleted invoices

Files to inspect for behavior

- Frontend: `packages/web/src/pages/SalesHistoryPage.jsx` (summary computation), `packages/web/src/api.js` (API wrapper)
- Backend: `packages/api/routes/paymentRoutes.js` (payments listing & refunds endpoint), `packages/api/routes/paymentMethodRoutes.js` (payment methods), `database/initial_schema.sql` and `database/migrations` (payments_unified view and payment_methods schema)

Manual verification checklist

1. Select a date range with known invoices & payments.
2. Verify `/api/invoices` returns invoice rows with `net_amount`, `refunded_amount`, `amount_paid`, `balance_due` for the range.
3. Verify `/api/payments` returns payment rows (both `customer_payment` and `invoice_payments`) and that `payment_method` is populated as `COALESCE(legacy_method, method_name)`.
4. Verify `/api/payments/refunds-approx` returns the expected `total_refunds` matching credit notes.
5. In the UI, confirm that the Summary cards show non-zero values for Net Sales, Collected, Approx Net Cash, and that the Payment Methods card lists methods with amounts when data exists.

---

End of Sales History — Summary section
