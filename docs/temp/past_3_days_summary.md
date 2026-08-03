# Forson Business Suite (FBS) — Master 3-Day Consolidation & Knowledge Handoff

> **Target Directory:** `docs/temp/`  
> **Coverage Window:** August 1, 2026 – August 3, 2026  
> **Author:** Antigravity AI (Pair Programming System)  
> **Status:** Production-Ready & Verified  

---

## 1. Executive Overview & Timeline Summary

Over the past 3 days (August 1–3, 2026), the Forson Business Suite (FBS) codebase underwent significant architectural evolution across three primary domains:
1. **Mobile Barcode Scanner & VisionCamera v5 Upgrade** (*Aug 1, 2026*): Complete performance optimization of the Expo/React Native barcode pipeline, zero-allocation Levenshtein distance matching, Android CameraX torch fix, and screen-space Region of Interest (ROI) reticle filtering.
2. **Accounts Receivable (A/R) 5-Phase Master Hardening Job** (*Aug 2, 2026*): A massive 5-phase architectural rollout introducing immutable event-driven A/R ledgers (`ar_ledger`), a unified Customer Wallet (`customer_wallet`), Post-Dated Cheque (PDC) lifecycle state machine with automated bounce/credit hold handling, and server-side Statement of Account (SOA) PDF reporting.
3. **PDC Treasury Module Decoupling, SOA Ledger Backfill & Global Pagination/Sort Standardization** (*Aug 3, 2026*): Decoupling PDC management into a top-level Treasury workspace, fixing `SELECT FOR UPDATE` PostgreSQL outer join queries, backfilling historical payments into `ar_ledger`, and standardizing backend SQL `WHERE` -> `ORDER BY` -> `LIMIT/OFFSET` pagination across all business modules.

---

## 2. Initiative 1: Mobile Barcode Scanner Pipeline & VisionCamera v5 Upgrade (Aug 1, 2026)

### 2.1 Workspace & Dependency Configuration
- **Package Upgrade:** Upgraded `react-native-vision-camera` to `^5.2.1` and migrated scanning logic to `vision-camera-barcode-scanner`.
- **Metro Workspace Resolution:** Added `extraNodeModules` proxy in [`packages/mobile/metro.config.js`](file:///home/dev-server/docker/forson-business-suite/packages/mobile/metro.config.js) to resolve hoisted `node_modules` in npm workspaces.
- **Expo App Manifest:** Updated [`packages/mobile/app.json`](file:///home/dev-server/docker/forson-business-suite/packages/mobile/app.json) to remove legacy VisionCamera Expo plugins and declare explicit camera permissions (`NSCameraUsageDescription`, `android.permission.CAMERA`).

### 2.2 Scanner Pipeline Performance (`packages/mobile/src/utils/scannerPipeline.ts`)
- **Zero-Allocation Levenshtein Matching:** Replaced dynamic array allocation per frame with $O(1)$ exact-match fast paths and static reusable DP buffers (`LEV_PREV_BUFFER`, `LEV_CURR_BUFFER`) to eliminate garbage collection (GC) thrashing at 30 FPS.
- **Screen-Space ROI Reticle Filtering:** Implemented `computeScreenRect` and `selectBestRoiBarcode` to transform frame coordinates (accounting for 1280x720 landscape sensor orientation vs portrait display bounds). Scanned codes outside the visual reticle are ignored, and candidates closest to reticle center with 8px padding are prioritized.
- **Consensus & Checksum Validation:** Enforced strict EAN-13 / UPC-A Modulo-10 checksum validation and reduced consensus window size to 3 frames (`BUDGET_WINDOW_SIZE = 3`) for instantaneous, glitch-free scanning.

### 2.3 Camera Component & POS Integration (`packages/mobile/src/components/ui/PremiumScanner.tsx`)
- **VisionCamera v5 Constraints:** Replaced deprecated `useCameraFormat` with `constraints={[{ fps: 30 }]}` on `<Camera />`.
- **Android CameraX Torch Crash Fix:** Resolved `OperationCanceledException: Camera is not active` on Android by passing `torchMode={isCameraActive && torch === 'on' ? 'on' : undefined}`. Passing `undefined` prevents `useTorchModeUpdater` from attempting native torch calls before the capture session is active.
- **Manual SKU Fallback Mode:** Integrated a manual barcode/SKU text input drawer (`drawerState === 'manual'`) accessible via top HUD bar keyboard icon for unreadable/damaged physical labels.
- **POS Direct Add (`packages/mobile/src/app/pos.tsx`):** Added `handleResolveBarcode` handler via `SearchBar.tsx`. Valid barcode scans instantly add items to cart, while unmapped barcodes trigger an inline "SKU Not Found (404)" drawer.

---

## 3. Initiative 2: Accounts Receivable (A/R) 5-Phase Master Hardening Job (Aug 2, 2026)

This master 5-phase job eliminated A/R data inconsistencies, introduced double-entry accounting integrity, and built a modern customer settlement infrastructure.

```
       ┌──────────────────────────────────────────────────────────┐
       │   A/R MASTER 5-PHASE ARCHITECTURAL ENGINE PIPELINE       │
       └────────────────────────────┬─────────────────────────────┘
                                    │
    ┌───────────────────────────────┼───────────────────────────────┐
    ▼                               ▼                               ▼
┌───────────────────────┐ ┌───────────────────────┐ ┌───────────────────────┐
│ PHASE 1: DATA ACCURACY│ │ PHASE 2: IMMUTABLE    │ │ PHASE 3: UNIFIED      │
│ & AGING REPAIR        │ │ EVENT-DRIVEN LEDGER   │ │ CUSTOMER WALLET       │
│ • Fix trigger status  │ │ • ar_ledger table     │ │ • customer_wallet     │
│ • COALESCE aging fallback│ • Immutability trigger│ │ • Store wallet method │
│ • Integrity check API │ │ • Authoritative API   │ │ • Overpayment engine  │
└───────────────────────┘ └───────────────────────┘ └───────────────────────┘
                                    │
                                    ├───────────────────────────────┐
                                    ▼                               ▼
                        ┌───────────────────────┐ ┌───────────────────────┐
                        │ PHASE 4: PDC & BOUNCE │ │ PHASE 5: SOA PDF &    │
                        │ LIFECYCLE ENGINE      │ │ UI OVERHAUL           │
                        │ • 5-state PDC engine  │ │ • 4-tab AR Workspace  │
                        │ • Reversal processor  │ │ • SOA PDF generator   │
                        │ • Credit hold logic   │ │ • Form glassmorphism  │
                        └───────────────────────┘ └───────────────────────┘
```

---

### 3.1 Phase 1: Core Data Accuracy, Status Logic Fixes & Aging Calculation

- **Problem:** Invoices with partial refunds were assigned `status = 'Partially Refunded'`, causing them to vanish from A/R queries filtering `WHERE status IN ('Unpaid', 'Partially Paid')`. Invoices with `due_date IS NULL` used `COALESCE(due_date, CURRENT_DATE - 91 days)`, falsely marking fresh invoices as 90+ days overdue.
- **Migrations Applied:**
  - `database/migrations/20260802_01_fix_ar_trigger_status.sql`: Rewrote PL/pgSQL function `update_invoice_balance_after_payment()`. Removed the `'Partially Refunded'` branch. Invoices with remaining balance now stay `'Unpaid'` or `'Partially Paid'`. Only two terminal states exist: `'Fully Refunded'` (refund $\ge$ total) and `'Paid'` (settled $\ge$ net amount).
  - `database/migrations/20260802_02_reconcile_ar_balances.sql`: Idempotently backfilled 82 historical invoices (76 reclassified as `'Paid'`, 6 restored to `'Unpaid'`).
- **Backend API Adjustments (`packages/api/routes/arRoutes.js` & `customerRoutes.js`):**
  - Updated all 4 aging endpoints (`/ar/aging-summary`, `/ar/customer-summary`, `/ar/customer-invoices/:customerId`, `/ar/drill-down-invoices`): changed `COALESCE(i.due_date, CURRENT_DATE - INTERVAL '91 days')` to `COALESCE(i.due_date, i.invoice_date)`.
  - Added `GET /api/ar/verify-integrity`: Endpoint comparing trigger-maintained `invoice.amount_paid` vs raw sum of settled payments to detect data drift.
  - Refactored `/customers/:id/unpaid-invoices`: Replaced deprecated `invoice_payment_allocation` join with direct `invoice.amount_paid` reading and `credit_note` LATERAL subquery.

---

### 3.2 Phase 2: Immutable Event-Driven A/R Ledger Architecture (`ar_ledger`)

- **Architecture:** Shifted financial source-of-truth to an append-only event ledger `ar_ledger` providing 100% mathematical determinism and zero balance drift.
- **Ledger Event Enum (`ar_ledger_entry_type`):**
  - `INVOICE_POSTED` (+ debit)
  - `PAYMENT_SETTLED` (- credit)
  - `CREDIT_MEMO_APPLIED` (- credit)
  - `DEBIT_ADJUSTMENT` (+ manual debit)
  - `CREDIT_ADJUSTMENT` (- manual credit)
  - `PDC_BOUNCED_REVERSAL` (+ debit reversal)
  - `BOUNCE_FEE_PENALTY` (+ penalty debit)
- **Migrations Applied:**
  - `database/migrations/20260802_03_create_ar_ledger.sql`: Created `ar_ledger` table, PL/pgSQL function `append_ar_ledger_entry(...)` with `FOR UPDATE` customer row-locking, immutability trigger `trg_ar_ledger_immutable` (blocks `UPDATE` and `DELETE`), and view `vw_customer_ar_balance` (`ledger_balance = SUM(amount)`).
  - `database/migrations/20260802_04_backfill_ar_ledger.sql`: Backfilled historical invoices, settled payments, and credit notes into `ar_ledger`.
  - `database/migrations/20260802_05_seed_ar_manage_permission.sql`: Seeded permission `ar:manage` for manual AR ledger adjustments.
- **Services & Routes:**
  - [`packages/api/services/arLedgerService.js`](file:///home/dev-server/docker/forson-business-suite/packages/api/services/arLedgerService.js): Service wrapper for `append_ar_ledger_entry`.
  - Event hooks added to [`invoiceRoutes.js`](file:///home/dev-server/docker/forson-business-suite/packages/api/routes/invoiceRoutes.js), [`refundRoutes.js`](file:///home/dev-server/docker/forson-business-suite/packages/api/routes/refundRoutes.js), and [`paymentRoutes.js`](file:///home/dev-server/docker/forson-business-suite/packages/api/routes/paymentRoutes.js).
  - Authoritative API endpoints: `GET /api/ar/dashboard-stats` (derives Total Receivables via `SUM(ledger_balance)`), `GET /api/ar/ledger/:customerId` (chronological transaction timeline), `POST /api/ar/ledger/:customerId/adjustment` (manual debits/credits protected by `ar:manage`).

---

### 3.3 Phase 3: Unified Customer Wallet & Liability Engine (`customer_wallet`)

- **Architecture:** Handles negative liabilities (overpayments, advance deposits, store credit refunds) and adds reusable payment method `store_wallet` ('Store Wallet / Account Credit', `settlement_type = 'on_account'`) across POS, Invoicing, and A/R Receive Payment.
- **Migrations Applied:**
  - `database/migrations/20260802_06_create_customer_wallet.sql`: Created `customer_wallet` (`wallet_id`, `customer_id UNIQUE`, `balance numeric(12,2) >= 0`) and `customer_wallet_transaction` audit table (`OVERPAYMENT_CREDIT`, `ADVANCE_DEPOSIT`, `STORE_CREDIT_REFUND`, `INVOICE_PAYMENT_DRAWDOWN`, `MANUAL_ADJUSTMENT`). Implemented `append_wallet_transaction()` with `FOR UPDATE` row-locking.
- **Services, Endpoints & UI:**
  - [`packages/api/services/customerWalletService.js`](file:///home/dev-server/docker/forson-business-suite/packages/api/services/customerWalletService.js) & [`packages/api/routes/walletRoutes.js`](file:///home/dev-server/docker/forson-business-suite/packages/api/routes/walletRoutes.js): `GET /api/customers/:id/wallet`, `POST /api/customers/:id/wallet/adjust`, `GET /api/ar/customer-liabilities`.
  - **Overpayment Engine:** Excess payment amounts automatically credited to `customer_wallet` as `OVERPAYMENT_CREDIT`.
  - **Wallet Drawdown Engine:** Paying via `store_wallet` deducts from `customer_wallet.balance` (`INVOICE_PAYMENT_DRAWDOWN`) and posts settlement to `ar_ledger`.
  - **Frontend Components:** [`CustomerWalletModal.jsx`](file:///home/dev-server/docker/forson-business-suite/packages/web/src/components/ar/CustomerWalletModal.jsx) and [`CustomerWalletBadge.jsx`](file:///home/dev-server/docker/forson-business-suite/packages/web/src/components/ar/CustomerWalletBadge.jsx).

---

### 3.4 Phase 4: PDC & Bounced Cheque Lifecycle Engine

- **State Machine Architecture:**
  - PDC Payment States: `RECEIVED` $\rightarrow$ `HELD_IN_SAFE` $\rightarrow$ `DEPOSITED` $\rightarrow$ `CLEARED` | `BOUNCED`. Instant payments default to `CLEARED`.
- **Migrations Applied:**
  - `database/migrations/20260802_07_pdc_lifecycle_and_credit_hold.sql`: Added `pdc_status` enum column to `invoice_payments`, added `credit_hold` (boolean) and `credit_hold_reason` (text) to `customer`.
- **Service & Automated Bounced Cheque Processor ([`packages/api/services/pdcService.js`](file:///home/dev-server/docker/forson-business-suite/packages/api/services/pdcService.js)):**
  - When a cheque is marked `BOUNCED`:
    1. Sets `invoice_payments.payment_status = 'failed'` and `pdc_status = 'BOUNCED'`.
    2. Runs `update_invoice_balance_after_payment()` trigger, re-opening original invoice balance.
    3. Appends `PDC_BOUNCED_REVERSAL` (+amount) to `ar_ledger`.
    4. Appends optional `BOUNCE_FEE_PENALTY` (+fee) to `ar_ledger`.
    5. Sets `customer.credit_hold = true` with reason `"Bounced Cheque #<ref>"`.
- **Collections & Clearance Desk Endpoints:**
  - `GET /api/ar/collections-clearance`: Lists pending bank transfers and PDCs awaiting clearance.
  - `POST /api/ar/collections-clearance/:paymentId/verify`: Settles payment / marks PDC `CLEARED`.
  - `POST /api/ar/collections-clearance/:paymentId/fail`: Triggers automated bounce reversal workflow.
- **Credit Limit & Credit Hold Enforcement:**
  - Integrated into credit invoice creation: customers on `credit_hold` are blocked unless overridden with `ar:override_credit_limit` permission.

---

### 3.5 Phase 5: Workspace Overhaul, Server-Side SOA PDF Generator & UI Polish

- **4-Tab AR Workspace ([`AccountsReceivablePage.jsx`](file:///home/dev-server/docker/forson-business-suite/packages/web/src/pages/AccountsReceivablePage.jsx)):**
  - **Tab 1: Overview & Aging** (KPI Cards, Aging Chart, Date Range Filter, Enhanced Customer Summary Table).
  - **Tab 2: Customer Ledger & SOA** (Customer Selector, Date Filter, Ledger Table with running balance, SOA PDF export button).
  - **Tab 3: PDC & Clearance Desk** (Status filters: `ALL`, `RECEIVED`, `HELD_IN_SAFE`, `DEPOSITED`, `CLEARED`, `BOUNCED` with clearance verification and bounce action buttons).
  - **Tab 4: Customer Wallet Management** (Wallet overview table, deposit modal, transaction audit log).
- **Server-Side SOA PDF Generator ([`packages/api/helpers/pdf/soaPdf.js`](file:///home/dev-server/docker/forson-business-suite/packages/api/helpers/pdf/soaPdf.js)):**
  - Uses Puppeteer and HTML/CSS template to generate official Statement of Account PDFs.
  - Includes header, customer details, itemized transactions (`Invoice Charged`, `Payment Received`), payment channel, credit notes, payment terms, pending cheques footnote (uncleared PDCs in vault), and PH aging breakdown.
  - Endpoints: `GET /api/ar/customers/:customerId/soa/pdf` and `GET /api/ar/customers/:customerId/ledger`.
- **ReceivePaymentForm UI Polish ([`ReceivePaymentForm.jsx`](file:///home/dev-server/docker/forson-business-suite/packages/web/src/components/ar/ReceivePaymentForm.jsx)):**
  - Modern dark glassmorphism header, customer avatar & wallet badge, real-time KPI stat cards, overpayment prompt banner, split payment breakdown, sticky action bar (`Ctrl+S`/`Esc`).
- **Migration File Standardization:**
  - Standardized all 7 A/R migrations into strict chronological format:
    - `20260802_01_fix_ar_trigger_status.sql`
    - `20260802_02_reconcile_ar_balances.sql`
    - `20260802_03_create_ar_ledger.sql`
    - `20260802_04_backfill_ar_ledger.sql`
    - `20260802_05_seed_ar_manage_permission.sql`
    - `20260802_06_create_customer_wallet.sql`
    - `20260802_07_pdc_lifecycle_and_credit_hold.sql`

---

## 4. Initiative 3: Aug 3 Enhancements, PDC Treasury Decoupling & Global Pagination/Sort (Aug 3, 2026)

### 4.1 Top-Level PDC & Treasury Page Decoupling
- **Standalone Module:** Decoupled PDC management out of Accounts Receivable into a top-level page [`PdcTreasuryPage.jsx`](file:///home/dev-server/docker/forson-business-suite/packages/web/src/pages/PdcTreasuryPage.jsx), listed under 'Finance & Expenses' in [`Sidebar.jsx`](file:///home/dev-server/docker/forson-business-suite/packages/web/src/components/Sidebar.jsx).
- **Permissions & DB Migration:** Seeded `pdc:view` and `pdc:manage` via `20260803_02_seed_pdc_permissions.sql`.
- **Multi-Invoice Cheque Aggregation:** Split payments for single physical instruments covering multiple invoices now group into a single row on the PDC desk with an invoice count badge.
- **Cheque Re-deposit & Audit History:** Added `onRedepositCheque` (re-deposits bounced cheques with optional credit hold release) and `onViewHistory` (clearance history modal).

### 4.2 Critical Bug Fixes & Ledger Backfill
- **PostgreSQL `FOR UPDATE` Outer Join Fix:** Fixed SQL error in [`pdcService.js`](file:///home/dev-server/docker/forson-business-suite/packages/api/services/pdcService.js) where PostgreSQL threw an error on `SELECT ... FROM customer_payment cp LEFT JOIN payment_methods pm ... FOR UPDATE`. Scoped clauses explicitly to `FOR UPDATE OF cp` or `FOR UPDATE OF ip`.
- **SOA Endpoint Column Fix:** Removed non-existent column reference `c.payment_terms` from `GET /ar/customers/:customerId/ledger` and `GET /ar/customers/:customerId/soa/pdf` in [`arRoutes.js`](file:///home/dev-server/docker/forson-business-suite/packages/api/routes/arRoutes.js).
- **Missing Payments Backfill Migration:** Created `20260803_02_backfill_missing_ar_ledger_payments.sql`. Dropped `ar_ledger_payment_id_fkey` constraint so `ar_ledger` can track payments from both `invoice_payments` and unified `customer_payment`. Backfilled 42 missing cleared payments (totaling ₱14,090.00 for customer FLORDELIZA ANDAMON) into `ar_ledger`.
- **Search UI Debouncing & Stutter Fix:** Separated `fetchCustomerSummary` table querying from `fetchDashboardData` full page skeleton state in `AccountsReceivablePage.jsx`. Implemented a 300ms debounced input handler in [`CustomerSummaryTable.jsx`](file:///home/dev-server/docker/forson-business-suite/packages/web/src/components/ar/CustomerSummaryTable.jsx).

### 4.3 Global Pagination, Search, & Server-Side Sorting Standardization
- **Standardized Backend Query Model:** Standardized all major FBS list endpoints (`Customer AR Summary`, `Customers`, `Suppliers`, `Employees`, `Vehicle Applications`, `Purchase Orders`, `Parts`, `Inventory`, `Sales Summary Report`).
- **SQL Execution Sequence:** Enforced strict SQL clause order:
  $$\text{SQL Execution Pipeline: } \text{WHERE (Filters/Search)} \longrightarrow \text{ORDER BY (Sorting)} \longrightarrow \text{LIMIT / OFFSET (Pagination)}$$
- **Frontend Contract:** Frontend components automatically reset page number to `1` whenever search queries, active filters, or sort columns change.

---

## 5. Verification & Testing Matrix

| Suite / Module | Total Tests | Status | Key Verification Scope |
|---|---|---|---|
| `arLedger.test.js` | 8 / 8 | **PASSED** | Immutable ledger posting, balance calculations, debit/credit adjustments |
| `customerWallet.test.js` | 9 / 9 | **PASSED** | Wallet balance retrieval, overpayment credit auto-posting, drawdown payments |
| `pdcLifecycle.test.js` | 6 / 6 | **PASSED** | 5-state PDC flow, bounce reversal, credit hold toggle, FOR UPDATE locking |
| `soaPdf.test.js` | 3 / 3 | **PASSED** | SOA HTML render, Puppeteer PDF generation, running balance formatting |
| **Combined AR Suite** | **26 / 26** | **PASSED** | 100% clean test execution across container environment |
| **Vite Web Bundle** | Built in 17.96s | **PASSED** | Zero build warnings or missing module errors |
| **Database Migrations** | 83 / 83 Applied | **PASSED** | 0 pending migrations, 0 checksum drift detected via `migrate:verify` |

---

## 6. Crucial Knowledge Transfer Notes for Next AI Agent

1. **`invoice.amount_paid` & `ar_ledger` Source of Truth:**
   - Always read customer financial balances from `vw_customer_ar_balance` (`b.ledger_balance`) or `invoice.amount_paid`. Never re-aggregate balances from `invoice_payment_allocation` (deprecated).
2. **PostgreSQL `FOR UPDATE` Scoping Rule:**
   - When executing `SELECT ... FOR UPDATE` on queries with `LEFT JOIN` or `INNER JOIN`, ALWAYS specify table target aliases (e.g. `FOR UPDATE OF cp`). Omitting the target table alias causes PostgreSQL to attempt locking outer-joined rows, throwing a fatal runtime exception.
3. **PDC Double-Entry Rule:**
   - Instant cash/bank payments log `PAYMENT_SETTLED` directly to `ar_ledger`. PDCs/cheques receive `pdc_status = 'RECEIVED'` and MUST NOT be credited to `ar_ledger` until verified as `CLEARED` via the PDC Treasury desk.
4. **Graphify Protocol Compliance:**
   - After editing any backend or frontend code, ALWAYS run `graphify update .` to update `graphify-out/graph.json` without API costs.
