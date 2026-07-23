# Forson Business Suite — Complete System Context & Specification

> **Generated:** 2026-07-23 | **App Version:** 2.5.1 (web) / 2.0.0 (monorepo)
> **Purpose:** Primary knowledge base for LLM architect agents for planning, dependency tracking, and feature development.

---

## 1. Executive Summary & Tech Stack

- **Application Purpose:** Full-stack automotive parts business management system. Covers inventory, purchasing (PO + GRN), POS sales, invoicing, accounts receivable (A/R), credit notes, employee/role management, tax tracking, document management, cheque printing, vehicle application cataloguing, and full-text search via Meilisearch. Targets small-to-mid automotive parts distributors in the Philippines (currency: ₱, timezone: Asia/Manila).

- **Frontend Framework & Styling:** React 19 + Vite 7, Tailwind CSS v4 (via `@tailwindcss/vite` plugin). Single-page application with custom in-app navigation (no React Router — page state managed via `useState`). Served via Nginx reverse proxy in production.

- **Backend & API Layer:** Node.js + Express REST API (`packages/api/index.js`, port 3001). No ORM — raw SQL via `node-postgres` (`pg` Pool). Routes registered via `registerRoute()` helper with graceful error isolation. Global `process.env.TZ = 'Asia/Manila'`.

- **Database & Persistence:** PostgreSQL 15. Schema baseline: `database/initial_schema.sql`. Migrations in `database/migrations/` — idempotent SQL, tracked by SHA-256 checksums in `schema_migrations`. WAC (Weighted Average Cost) computed via DB trigger on `inventory_transaction`. Invoice payment status auto-updated via trigger on `invoice_payments`.

- **Authentication & Security:** Stateless JWT. `protect` middleware (`packages/api/middleware/authMiddleware.js`) verifies `Authorization: Bearer <token>`. On each request, user permissions are fetched live from `role_permission` + `permission` tables (keyed by `permission_level_id` from JWT payload). Permission check: `hasPermission(key)` middleware; admin bypass at `permission_level_id = 10`. Session stored client-side in `localStorage` (`userSession` key). Cross-tab logout synced via `storage` events. Auto-logout on 401 via global `auth-error` CustomEvent. Nginx adds standard security headers (X-Frame-Options, CSP, HSTS).

- **External Services & APIs:**
  - **Meilisearch** — Full-text search for `parts` and `applications` indexes. Synced via durable outbox worker (`meili-outbox-worker.js`) + PostgreSQL LISTEN/NOTIFY triggers. Separate repair worker (`search-repair-worker.js`) for index drift correction.
  - **Google Gemini / OpenAI / OpenRouter** — LLM integration (`packages/api/services/llmRouter.js`) for AI-assisted duplicate part detection and verification. Provider selected via `LLM_PROVIDER` env var with API key pool rotation support.
  - **Deduplication Engine** — Internal background worker (`dedupe-scan-worker.js`) that scans for duplicate parts using `deduplicationEngine.js` + `duplicateFinder.js`, with AI verification via LLM.
  - **Cycle Count Engine** — Internal scheduled service (`services/cycleCountService.js`) for inventory auditing workflows.
  - **Backup Service** — On-demand and scheduled PostgreSQL `pg_dump` backups exposed via API; configurable retention (`BACKUP_RETENTION_DAYS`).

---

## 2. Global Directory & Module Map

```
/
├── packages/
│   ├── api/                         # Node.js/Express backend (port 3001)
│   │   ├── index.js                 # Entry point — mounts all routes, starts workers
│   │   ├── db.js                    # pg.Pool singleton; exports query(), getClient()
│   │   ├── middleware/
│   │   │   └── authMiddleware.js    # protect(), hasPermission(), isAdmin()
│   │   ├── routes/                  # One file per resource domain (see §4)
│   │   ├── services/
│   │   │   ├── cycleCountService.js     # Cycle count engine & scheduling
│   │   │   ├── deduplicationEngine.js   # Duplicate detection orchestration
│   │   │   ├── duplicateFinder.js       # SQL-based candidate generation
│   │   │   ├── llmRouter.js             # Multi-provider LLM abstraction
│   │   │   ├── meiliOutboxService.js    # Outbox queue for Meilisearch sync
│   │   │   ├── partMergeService.js      # Part merge transaction logic
│   │   │   └── taxCalculationService.js # Tax-inclusive/exclusive computation
│   │   ├── helpers/
│   │   │   ├── pagination.js            # parsePaginationQuery(), paginatedResponse()
│   │   │   ├── normalizePart.js         # Part data normalization
│   │   │   ├── normalizeSku.js          # SKU normalization utilities
│   │   │   ├── codeGenerator.js         # Auto-generate GRN/PO/Invoice numbers
│   │   │   ├── documentNumberGenerator.js # Document sequence (prefix + period)
│   │   │   ├── paymentTermsHelper.js    # Due date calculations
│   │   │   ├── receiptNumberFormatter.js
│   │   │   ├── chequeAmountWords.js     # Number to words (cheque printing)
│   │   │   ├── partNumberSoftDelete.js  # Soft-delete part number logic
│   │   │   └── pdf/                     # PDF generation helpers
│   │   ├── meilisearch.js           # MeiliSearch client, syncPartWithMeili(), removePartFromMeili()
│   │   ├── meilisearch-setup.js     # Index creation, settings, filterable attributes
│   │   ├── meili-outbox-worker.js   # Durable outbox polling worker (default on)
│   │   ├── meili-listener.js        # Legacy LISTEN/NOTIFY for parts (opt-in)
│   │   ├── meili-app-listener.js    # LISTEN/NOTIFY for applications index
│   │   ├── search-repair-worker.js  # Periodic index drift repair
│   │   ├── dedupe-scan-worker.js    # Background duplicate scan worker
│   │   ├── config/                  # Additional config modules
│   │   ├── templates/               # Email/document templates
│   │   └── scripts/                 # migrate.js and utility scripts
│   │
│   ├── web/                         # React 19 + Vite 7 SPA (port 5173 dev)
│   │   └── src/
│   │       ├── main.jsx             # React DOM root render
│   │       ├── App.jsx              # Root: setup check -> auth guard -> MainLayout
│   │       ├── api.js               # Axios instance (baseURL=/api), JWT interceptor, 401 event dispatch
│   │       ├── constants.js         # ICONS, shared constants
│   │       ├── contexts/
│   │       │   ├── AuthContext.jsx  # AuthProvider: user, permissions, login(), logout(); localStorage-backed
│   │       │   └── SettingsContext.jsx # SettingsProvider: fetches /api/settings on mount
│   │       ├── pages/               # One file per page/screen (see §5)
│   │       ├── components/
│   │       │   ├── layout/          # MainLayout.jsx, sidebar navigation
│   │       │   ├── ui/              # Modal, Icon, SortableHeader, PaginationControls, SearchBar
│   │       │   ├── forms/           # PartForm, PurchaseOrderForm, etc.
│   │       │   ├── reports/         # SalesReport, SalesByCustomerReport, etc.
│   │       │   ├── accounts-receivable/  # CustomerInvoiceDetailsModal, AR components
│   │       │   ├── refunds/         # InvoiceDetailsModal, credit note UI
│   │       │   ├── pos/             # POS line item, cart, payment flow components
│   │       │   ├── invoice/         # Invoice viewer, split payment UI
│   │       │   ├── dashboard/       # Dashboard stat cards, chart components
│   │       │   ├── applications/    # Vehicle application selector
│   │       │   ├── cycleCount/      # Cycle count execution components
│   │       │   ├── parts-cleanup/   # Duplicate merge/cleanup UI
│   │       │   ├── document-management/ # Document upload, preview, share
│   │       │   └── settings/        # Settings panel components
│   │       ├── hooks/
│   │       │   ├── useDraft.js      # Draft save/restore for POS/invoicing
│   │       │   ├── useSavedSales.js # Saved sale slots
│   │       │   └── useTypeahead.js  # Typeahead search hook
│   │       ├── utils/
│   │       │   ├── currency.js      # PHP formatting
│   │       │   ├── sortData.js      # Generic table sort
│   │       │   ├── paginatedResponse.js # getPaginatedPayload()
│   │       │   ├── csv.js           # CSV export helpers
│   │       │   ├── downloadFile.js
│   │       │   ├── receiptNumberFormatter.js
│   │       │   ├── status.js        # Invoice/PO status helpers
│   │       │   └── terms.js         # Payment terms formatting
│   │       ├── helpers/
│   │       │   └── applicationTextHelper.js # formatApplicationText()
│   │       ├── services/            # Web-side service wrappers
│   │       └── constants/           # Additional constant modules
│   │
│   └── mobile/                      # Expo 56 / React Native 0.85.3 app
│       └── src/
│           ├── app/                 # Expo Router file-based routes
│           ├── screens/
│           │   └── LoginScreen.jsx  # Mobile login (only screen currently built out)
│           ├── api/
│           │   └── client.js        # Axios client for mobile -> backend
│           ├── store/
│           │   ├── useAuthStore.js
│           │   ├── usePosStore.js
│           │   ├── useCycleCountStore.js
│           │   └── useSettingsStore.js  # Zustand stores
│           ├── components/          # Shared React Native components
│           ├── hooks/               # Mobile-specific hooks
│           └── constants/           # Mobile constants
│
├── database/
│   ├── initial_schema.sql           # Full DDL baseline (tables, triggers, views, seed data)
│   ├── migrations/                  # Incremental idempotent SQL files (filename-ordered)
│   ├── seeds/                       # Optional seed data (run with --include-seeds)
│   └── validation/                  # Schema validation helpers
│
├── nginx/
│   ├── nginx.conf                   # Base nginx config (gzip, security headers)
│   └── conf.d/                      # Site-specific vhost configs
│
├── scripts/
│   ├── start-dev.sh                 # Docker Compose dev up
│   ├── reset-dev-db.sh              # Nuke & recreate local DB
│   ├── update-prod.sh               # Production update script
│   ├── migrate-prod.sh              # Run migrations in production container
│   └── sync-mobile-version.sh       # Sync mobile app version
│
├── docker-compose.yml               # Base service definitions
├── docker-compose.dev.yml           # Dev overrides (volume mounts, hot reload)
├── docker-compose.prod.yml          # Production config (pull images, named volumes)
├── .env.example                     # Required env var template
├── package.json                     # Monorepo root (npm workspaces: packages/*)
└── AGENTS.md                        # Agent operational rules
```

---

## 3. Database Schema & Data Models

### Core Lookup Tables

| Table | Key Columns | Notes |
|---|---|---|
| `permission_level` | `permission_level_id` (PK serial), `level_name` | Seeded: 1=Inventory Clerk, 2=Parts Man, 3=Purchaser, 4=Cashier, 5=Secretary, 7=Manager, 10=Admin |
| `permission` | `permission_id` (PK serial), `permission_key` (unique), `description`, `category` | 30+ granular permission keys |
| `role_permission` | `permission_level_id` FK, `permission_id` FK (composite PK) | N:M — role to permission mapping |
| `settings` | `setting_key` (PK varchar), `setting_value`, `description` | KV store: COMPANY_NAME, DEFAULT_CURRENCY_SYMBOL, etc. |
| `payment_term` | `payment_term_id` (PK serial), `term_name`, `days_to_due` (unique) | Payment terms lookup |
| `tax_rate` | `tax_rate_id` (PK serial), `rate_name`, `rate_percentage` (numeric 8,6), `is_default` | |
| `brand` | `brand_id`, `brand_name` (unique), `brand_code` (unique) | |
| `group` | `group_id`, `group_name` (unique), `group_code` (unique) | Part category groups |
| `tag` | `tag_id`, `tag_name` (unique) | Tags for parts and customers |

### People & Auth

| Table | Key Columns | Relationships |
|---|---|---|
| `employee` | `employee_id`, `employee_code`, `first_name`, `last_name`, `username` (unique), `password_hash`, `password_salt`, `permission_level_id` FK, `is_active`, `date_hired`, `created_by` (self-ref FK) | N:1 to `permission_level` |
| `customer` | `customer_id`, `first_name`, `last_name`, `company_name`, `phone`, `email` (unique), `address`, `is_active` | Walk-in customer seeded at ID 1 |
| `supplier` | `supplier_id`, `supplier_name` (unique), `contact_person`, `phone`, `email`, `address`, `is_active` | Audited: `created_by`, `modified_by` to `employee` |

### Parts Catalogue

| Table | Key Columns | Relationships |
|---|---|---|
| `part` | `part_id`, `internal_sku` (unique), `detail`, `brand_id` FK, `group_id` FK, `barcode`, `is_active`, `last_cost`, `wac_cost`, `last_sale_price`, `reorder_point`, `tax_rate_id` FK, `is_tax_inclusive_price`, `is_service`, `measurement_unit`, `is_price_change_allowed`, `is_using_default_quantity` | Audited; WAC auto-updated by trigger |
| `part_number` | `part_number_id`, `part_id` FK, `part_number`, `number_type`, `display_order` | Unique per (part_id, part_number); supports OEM, aftermarket, etc. |
| `part_tag` | `part_id` FK, `tag_id` FK (composite PK) | N:M parts to tags |
| `part_exclusion` | `part_id_1`, `part_id_2` (ordered), `source`, `reason` | Deduplication exclusion list |

### Vehicle Applications

| Table | Key Columns | Relationships |
|---|---|---|
| `vehicle_make` | `make_id`, `make_name` (unique) | |
| `vehicle_model` | `model_id`, `make_id` FK, `model_name` | Unique per (make_id, model_name) |
| `vehicle_engine` | `engine_id`, `model_id` FK, `engine_name` | Unique per (model_id, engine_name) |
| `application` | `application_id`, `make_id` FK, `model_id` FK, `engine_id` FK | Unique constraint on (make_id, model_id, engine_id) |
| `part_application` | `part_app_id`, `part_id` FK, `application_id` FK, `year_start`, `year_end` | N:M parts to applications |
| `application_view` | (VIEW) | Joins application + vehicle_make/model/engine for display |

### Inventory

| Table | Key Columns | Notes |
|---|---|---|
| `inventory_transaction` | `inv_trans_id` (bigserial), `part_id` FK, `transaction_date`, `trans_type`, `quantity`, `unit_cost`, `reference_no`, `employee_id` FK, `notes` | Types: StockIn, StockOut, Adjustment; WAC trigger fires on StockIn |

### Purchasing

| Table | Key Columns | Relationships |
|---|---|---|
| `purchase_order` | `po_id`, `po_number` (unique), `supplier_id` FK, `employee_id` FK, `order_date`, `expected_date`, `total_amount`, `status` (Pending/Approved/Received/Cancelled), `notes` | |
| `purchase_order_line` | `po_line_id`, `po_id` FK (CASCADE), `part_id` FK, `quantity`, `cost_price`, `quantity_received` | |
| `goods_receipt` | `grn_id`, `grn_number` (unique), `receipt_date`, `supplier_id` FK, `received_by` FK | |
| `goods_receipt_line` | `grn_line_id`, `grn_id` FK (CASCADE), `part_id` FK, `quantity`, `cost_price`, `sale_price` | |

### Sales & Invoicing

| Table | Key Columns | Notes |
|---|---|---|
| `invoice` | `invoice_id`, `invoice_number` (unique), `customer_id` FK, `employee_id` FK, `invoice_date`, `total_amount`, `amount_paid`, `status` (Unpaid/Partially Paid/Paid), `terms`, `payment_terms_days`, `due_date`, `physical_receipt_no` | Status auto-updated by trigger |
| `invoice_line` | `invoice_line_id`, `invoice_id` FK (CASCADE), `part_id` FK, `quantity`, `sale_price`, `cost_at_sale`, `discount_amount` | |
| `draft_transaction` | `draft_id`, `employee_id` FK (CASCADE), `transaction_type`, `draft_data` (jsonb), `last_updated` | One draft per (employee, type) |
| `staged_sale` | (see stagedSaleRoutes) | POS sales pending manager approval |

### Payments

| Table | Key Columns | Notes |
|---|---|---|
| `payment_methods` | `method_id`, `code` (unique), `name`, `type` (cash/card/bank/mobile/credit/voucher/other), `enabled`, `sort_order`, `config` (jsonb) | Config keys: `requires_reference`, `change_allowed`, `settlement_type` |
| `invoice_payments` | `payment_id`, `invoice_id` FK (CASCADE), `method_id` FK, `amount_paid`, `tendered_amount`, `change_amount`, `reference`, `metadata` (jsonb), `created_at`, `created_by` FK | Split-payment table; validated by DB trigger |
| `customer_payment` | `payment_id`, `customer_id` FK, `employee_id` FK, `payment_date`, `amount`, `tendered_amount`, `payment_method`, `reference_number`, `notes`, `method_id` FK | Legacy A/R payment table |
| `invoice_payment_allocation` | `allocation_id`, `invoice_id` FK, `payment_id` FK, `amount_allocated` | Links `customer_payment` to specific invoices |
| `payments_unified` | (VIEW) | Union of `customer_payment` + `invoice_payments` for reporting |

### Credit Notes & Documents

| Table | Key Columns | Notes |
|---|---|---|
| `credit_note` | `cn_id`, `cn_number` (unique), `invoice_id` FK, `employee_id` FK, `refund_date`, `total_amount`, `notes` | |
| `credit_note_line` | `cn_line_id`, `cn_id` FK (CASCADE), `part_id` FK, `quantity`, `sale_price` | |
| `documents` | `id` (uuid PK, gen_random_uuid()), `document_type`, `reference_id`, `file_path`, `metadata` (jsonb), `created_at`, `updated_at` | GIN index on metadata; indexed by doc_type, reference_id, created_at |

### Search Sync (Meilisearch)

| Table | Notes |
|---|---|
| `meili_sync_outbox` | Durable outbox for part sync events (see 20260415 migration) |
| `search_repair_jobs` | Tracks repair job status (see 20260416 migration) |

### Sequences & Misc

| Table | Notes |
|---|---|
| `document_sequence` | `(prefix, period)` composite PK; tracks last_number for auto-generated document IDs |
| `schema_migrations` | Migration tracking (SHA-256 checksums) |
| `part_merge_log` | Audit log for part merge operations |
| `part_aliases` | Legacy part number aliases post-merge |
| `invoice_due_date_log` | Tracks due date changes for A/R audit |

### DB Triggers Summary

| Trigger | Table | Event | Action |
|---|---|---|---|
| `trg_update_wac` | `inventory_transaction` | AFTER INSERT (StockIn only) | Recomputes `part.wac_cost` and `last_cost` |
| `invoice_payments_validate` | `invoice_payments` | BEFORE INSERT/UPDATE | Validates payment method config constraints |
| `invoice_payments_update_balance_*` | `invoice_payments` | AFTER INSERT/UPDATE/DELETE | Updates `invoice.amount_paid` and `invoice.status` |
| Meilisearch NOTIFY triggers | `part` | INSERT/UPDATE/DELETE | PostgreSQL NOTIFY to meili-outbox-worker or listener |

---

## 4. API Endpoints & Routes Registry

**Base path:** `/api` | All routes use `protect` unless noted. Admin-only routes use `isAdmin`.

### Auth & Setup

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/login` | None | Employee login; returns JWT + user + permissions |
| `GET` | `/api/setup/status` | None | Returns `{ isAdminCreated: bool }` |
| `POST` | `/api/setup/create-admin` | None | Creates first admin employee |
| `GET` | `/api/setup/mobile-version` | None | Returns current mobile app version |
| `GET` | `/api/_debug/whoami` | `protect` | Dev-only: returns decoded JWT user |
| `GET` | `/health` | None | Uptime check `{ status: 'ok' }` |

### Employee & Permissions

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/employees` | `isAdmin` | List employees (paginated) |
| `GET` | `/api/employees/:id` | `isAdmin` | Get single employee |
| `POST` | `/api/employees` | `isAdmin` | Create employee (hashes password with bcrypt) |
| `PUT` | `/api/employees/:id` | `isAdmin` | Update employee |
| `PUT` | `/api/profile` | `protect` | Update own profile/password |
| `GET` | `/api/roles` | `isAdmin` | List permission levels |
| `GET` | `/api/permissions` | `isAdmin` | List all permission keys |
| `GET/PUT` | `/api/roles/:id/permissions` | `isAdmin` | Get/set permissions for a role |

### Parts

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/parts` | `parts:view` | List parts (paginated, filterable) |
| `GET` | `/api/parts/:id` | `parts:view` | Get single part with numbers/applications/inventory |
| `POST` | `/api/parts` | `parts:create` | Create part |
| `PUT` | `/api/parts/:id` | `parts:edit` | Update part |
| `PUT` | `/api/parts/bulk-update` | `parts:edit` | Bulk update part fields |
| `DELETE` | `/api/parts/:id` | `parts:delete` | Soft-delete part |
| `GET` | `/api/parts/:partId/numbers` | `parts:view` | List part numbers |
| `POST` | `/api/parts/:partId/numbers` | `parts:edit` | Add part number |
| `DELETE` | `/api/parts/:partId/numbers/:numberId` | `parts:edit` | Remove part number |
| `PUT` | `/api/parts/:partId/numbers/reorder` | `parts:edit` | Reorder part numbers |
| `GET` | `/api/sync-parts-to-meili` | `isAdmin` | Trigger full Meilisearch sync |
| `POST` | `/api/reindex/parts` | None | Trigger parts reindex |
| `POST` | `/api/repair-search-index` | `isAdmin` | Start search repair job |
| `POST` | `/api/repair-search-index/:job_id/cancel` | `isAdmin` | Cancel repair job |

### Part Merge & Deduplication

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/parts/merge/suggestions` | `parts:merge` | List AI-detected duplicate suggestions |
| `GET` | `/api/parts/merge/suggestions/:id` | `parts:merge` | Get suggestion detail |
| `POST` | `/api/parts/merge/suggestions/:id/dismiss` | `parts:merge` | Dismiss suggestion |
| `POST` | `/api/parts/merge/merge-preview` | `parts:merge` | Preview merge result |
| `POST` | `/api/parts/merge/merge` | `parts:merge` | Execute part merge |
| `POST` | `/api/parts/merge/exclude` | `parts:merge` | Mark two parts as not duplicates |
| `POST` | `/api/parts/merge/trigger-scan` | `parts:merge` | Manually trigger dedupe scan |
| `POST` | `/api/parts/merge/worker-toggle` | `parts:merge` | Enable/disable dedupe worker |

### Part Numbers (standalone)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/part-numbers` | `protect` | Search part numbers |

### Applications (Vehicle)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/applications` | None | List applications |
| `POST` | `/api/applications` | None | Create application |
| `PUT` | `/api/applications/:id` | None | Update application |
| `DELETE` | `/api/applications/:id` | None | Delete application |
| `GET` | `/api/application-search` | None | Meilisearch application search |
| `POST` | `/api/reindex/applications` | None | Re-sync applications to Meilisearch |
| `GET` | `/api/parts/:partId/applications` | `parts:view` | List applications for a part |
| `POST` | `/api/parts/:partId/applications` | None | Link application to part |
| `PUT` | `/api/part-applications/:partAppId` | None | Update part-application link (years) |
| `DELETE` | `/api/parts/:partId/applications/:appId` | None | Unlink application from part |

### Brands, Groups, Tags

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET/POST` | `/api/brands` | None | List or create brands |
| `GET/POST` | `/api/groups` | None | List or create groups |
| `GET/POST` | `/api/tags` | `protect` | List or create tags |
| `GET/PUT` | `/api/customers/:id/tags` | `customers:view` | Get/set customer tags |

### Inventory

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/inventory` | `inventory:view` | List inventory (stock levels, WAC, last cost) |
| `POST` | `/api/inventory/adjust` | None | Manual stock adjustment |
| `GET` | `/api/inventory/transactions` | `inventory:view` | List inventory transactions |

### Cycle Count

| Method | Path | Auth | Description |
|---|---|---|---|
| Various | `/api/inventory/cycle-count/...` | `cycle_count:execute` / `cycle_count:manage` | Full cycle count workflow: request audit, assign items, submit counts, approve, recount, batch trigger |

### Purchasing

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/purchase-orders` | `purchase_orders:view` | List POs (paginated) |
| `GET` | `/api/purchase-orders/:id` | `purchase_orders:view` | Get PO with lines |
| `POST` | `/api/purchase-orders` | `purchase_orders:edit` | Create PO |
| `PUT` | `/api/purchase-orders/:id` | `purchase_orders:edit` | Update PO |
| `PUT` | `/api/purchase-orders/:id/status` | `purchase_orders:edit` | Change PO status |
| `DELETE` | `/api/purchase-orders/:id` | `purchase_orders:edit` | Delete PO |
| `GET` | `/api/goods-receipts` | `goods_receipt:create` | List GRNs |
| `GET` | `/api/goods-receipts/:id` | `goods_receipt:create` | Get GRN with lines |
| `POST` | `/api/goods-receipts` | None | Create GRN (records inventory transactions; WAC trigger fires) |
| `PUT` | `/api/goods-receipts/:id` | `goods_receipt:edit` | Edit GRN |

### Customers & Suppliers

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/customers` | `customers:view` or `pos:use` | List customers (paginated) |
| `GET` | `/api/customers/with-balances` | `ar:view` | Customers with outstanding A/R |
| `GET` | `/api/customers/:id/unpaid-invoices` | `ar:view` | Customer unpaid invoices |
| `POST` | `/api/customers` | `customers:edit` | Create customer |
| `PUT` | `/api/customers/:id` | `customers:edit` | Update customer |
| `DELETE` | `/api/customers/:id` | `customers:edit` | Delete customer |
| `GET` | `/api/suppliers` | None | List suppliers |
| `POST` | `/api/suppliers` | None | Create supplier |
| `DELETE` | `/api/suppliers/:id` | None | Delete supplier |

### Sales / POS

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/sales/staging` | `pos:use` | List staged (pending) sales |
| `GET` | `/api/sales/staging/my-activity` | `pos:use` | Current user staged sales |
| `GET` | `/api/sales/staging/:id` | `pos:use` | Get staged sale |
| `POST` | `/api/sales/staging` | `pos:use` | Submit sale for approval |
| `POST` | `/api/sales/staging/:id/approve-post` | `invoicing:create` | Approve staged sale; creates invoice |
| `POST` | `/api/sales/staging/:id/reject` | `pos:use` | Reject staged sale |

### Invoicing

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/invoices` | `invoicing:create` | List invoices (paginated, filterable) |
| `GET` | `/api/invoices/:id` | `invoicing:create` | Get invoice with lines and payments |
| `POST` | `/api/invoices` | None | Create invoice directly |
| `DELETE` | `/api/invoices/:id` | `invoice:delete` | Void/delete invoice |
| `PUT` | `/api/invoices/:id/due-date` | `invoicing:create` | Update invoice due date |
| `PUT` | `/api/invoices/:id/physical-receipt-no` | `invoice:edit_receipt_no` | Set physical receipt number |
| `POST` | `/api/invoices/:id/payments` | `protect` + `invoicing:create` | Add split payment to invoice |
| `PUT` | `/api/invoices/payments/:payment_id/settle` | `invoicing:create` | Settle an on-account payment |

### Payments (A/R)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/payments` | `ar:receive_payment` | Record customer payment |
| `POST` | `/api/payments/:id/settle` | `ar:receive_payment` | Settle a payment |
| `POST` | `/api/payments/:id/fail` | `ar:receive_payment` | Mark payment as failed |
| `POST` | `/api/payments/webhook` | None | Payment webhook |
| `GET/POST/PUT/DELETE` | `/api/payment-methods/...` | `protect` / `settings:edit` | CRUD payment methods |
| `PATCH` | `/api/payment-methods/reorder` | `protect` | Reorder payment methods |
| `GET/POST/PUT/DELETE` | `/api/payment-terms/...` | `protect` / `isAdmin` | CRUD payment terms |

### Accounts Receivable

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/ar/dashboard-stats` | `ar:view` | A/R summary KPIs |
| `GET` | `/api/ar/customer-summary` | `ar:view` | Per-customer balance summary |
| `GET` | `/api/ar/customer-invoices/:customerId` | `ar:view` | All invoices for customer |
| `GET` | `/api/ar/aging-summary` | `ar:view` | A/R aging buckets (current, 30, 60, 90+ days) |
| `GET` | `/api/ar/trends` | `ar:view` | A/R trend chart data |
| `GET` | `/api/ar/drill-down-invoices` | `ar:view` | Filtered invoice drill-down |
| `GET` | `/api/ar/invoice-due-date-history/:invoiceId` | `ar:view` | Due date change log |

### Refunds / Credit Notes

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/refunds` | `invoicing:create` | List credit notes |
| `POST` | `/api/refunds` | `invoicing:create` | Create credit note (reverses invoice lines, restores stock) |

### Drafts

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/drafts/:type` | `protect` | Get draft for current user + type |
| `POST` | `/api/drafts/:type` | `protect` | Save/overwrite draft |
| `DELETE` | `/api/drafts/:type` | `protect` | Clear draft |

### Reporting

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/reporting/sales` | `reports:view` | Sales summary report |
| `GET` | `/api/reporting/sales-by-customer` | `reports:view` | Sales grouped by customer |
| `GET` | `/api/reporting/sales-history` | `reports:view` | Detailed sales history |
| `GET` | `/api/tax-reports/summary` | `reports:view` | Tax summary by rate |
| `GET` | `/api/tax-reports/detailed` | `reports:view` | Line-level tax detail |
| `GET` | `/api/tax-reports/rates-usage` | `reports:view` | Tax rate usage stats |
| `GET` | `/api/tax-reports/export` | `reports:view` | CSV export of tax report |

### Dashboard

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/dashboard/stats` | None | Core KPI stats |
| `GET` | `/api/dashboard/enhanced-stats` | None | Extended dashboard metrics |
| `GET` | `/api/dashboard/sales-chart` | None | Chart-ready sales data |
| `GET` | `/api/dashboard/low-stock-items` | None | Parts below reorder point |
| `GET` | `/api/dashboard/search-sync-health` | None | Meilisearch sync health status |
| `GET` | `/api/dashboard/search-sync-alerts` | None | Active sync alerts |

### Search

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/power-search` | `protect` | Meilisearch-powered global part search |
| `GET` | `/api/application-search` | None | Meilisearch application search |

### Tax Rates

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/tax-rates` | `protect` | List tax rates |
| `POST` | `/api/tax-rates` | `isAdmin` | Create tax rate |
| `DELETE` | `/api/tax-rates/:id` | `isAdmin` | Delete tax rate |

### Cheques

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET/POST/PUT/DELETE` | `/api/cheques/templates/...` | `cheques:view` / `cheques:manage_settings` | CRUD cheque templates |
| `GET/POST/PUT/DELETE` | `/api/cheques/printer-profiles/...` | same | Printer profile management |
| `GET/POST` | `/api/cheques/history` / `/api/cheques/records` | `cheques:view` / `cheques:create` | Cheque print history |
| `POST` | `/api/cheques/generate-pdf` | `cheques:create` | Generate cheque PDF |
| `POST` | `/api/cheques/reprint/:id` | `cheques:create` | Reprint cheque |
| `GET/POST` | `/api/cheques/settings-export` / `settings-import` | `cheques:manage_settings` | Import/export cheque settings |

### Documents

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/documents` | `documents:view` | List documents (paginated, filterable) |
| `GET` | `/api/documents/:id/preview` | `documents:view` | Preview document |
| `GET` | `/api/documents/:id/download` | `documents:download` | Download document file |
| `POST` | `/api/documents/:id/share` | `documents:share` | Share document link |

### Settings

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/settings` | `protect` | Get all settings KV |
| `PUT` | `/api/settings` | `settings:edit` | Bulk update settings |

### Admin / Data Utilities

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/data/export/:entity` | `data-utils:export` | Export entity as CSV |
| `POST` | `/api/data/import/:entity` | `isAdmin` + file upload | Import CSV for entity |
| `GET` | `/api/backups` | `backups:view` | List backup files |
| `POST` | `/api/backups/` | `backups:create` | Create on-demand backup |
| `POST` | `/api/backups/restore` | `backups:restore` | Restore from backup file |
| `DELETE` | `/api/backups/:filename` | `backups:delete` | Delete backup file |
| `POST` | `/api/backups/upload` | `backups:create` | Upload backup file |
| `GET` | `/api/health/meilisearch` | None | Meilisearch health check |
| `POST` | `/api/health/meilisearch/reconfigure` | None | Reconfigure Meilisearch settings |

---

## 5. Frontend Architecture & UI Components

### Page / Route Structure

Navigation is **state-based** (no URL routing library). `currentPage` state in `AppContent` controls which page renders inside `MainLayout`.

| Page Component | `currentPage` Key | Description |
|---|---|---|
| `Dashboard.jsx` | `dashboard` | KPI cards, sales chart, low-stock alerts, sync health |
| `POSPage.jsx` | `pos` | Point-of-sale cart, part search, payment modal, draft save/restore |
| `InvoicingPage.jsx` | `invoicing` | Invoice list, create invoice, payment recording |
| `SalesHistoryPage.jsx` | `sales-history` | Historical invoice lookup and detail |
| `AccountsReceivablePage.jsx` | `accounts-receivable` | A/R dashboard, aging, customer balances |
| `CashierApprovalDesk.jsx` | `cashier-approval` | Manager approval desk for staged POS sales |
| `GoodsReceiptPage.jsx` | `goods-receipt` | Create new GRN from PO or ad-hoc |
| `GoodsReceiptHistoryPage.jsx` | `goods-receipt-history` | GRN lookup, line detail |
| `PurchaseOrderPage.jsx` | `purchase-orders` | PO list view |
| `PurchaseOrderEditorPage.jsx` | `po-editor` | Create/edit PO with line items |
| `InventoryPage.jsx` | `inventory` | Stock levels, WAC, last cost, adjustments |
| `CycleCountExecutionPage.jsx` | `cycle-count` | Inventory audit workflow |
| `PartsPage.jsx` | `parts` | Parts catalogue list, filters, search |
| `PartApplicationManager.jsx` | `part-applications` | Manage vehicle applications for a part |
| `PartNumberManager.jsx` | `part-numbers` | Manage part numbers/aliases |
| `PartsCleanupPage.jsx` | `parts-cleanup` | Duplicate detection, merge UI |
| `ApplicationsPage.jsx` | `applications` | Vehicle applications CRUD (make/model/engine) |
| `CustomersPage.jsx` | `customers` | Customer list, profile, tag management |
| `SuppliersPage.jsx` | `suppliers` | Supplier list and CRUD |
| `EmployeesPage.jsx` | `employees` | Employee management, role assignment |
| `ReportingPage.jsx` | `reporting` | Sales and tax reports |
| `DocumentsPage.tsx` | `documents` | Document management (upload, preview, download, share) |
| `ChequePrintingPage.jsx` | `cheques` | Cheque template editor and print workflow |
| `PowerSearchPage.jsx` | `power-search` | Global Meilisearch-powered part search |
| `SettingsPage.jsx` | `settings` | Company info, payment methods, payment terms, tax rates |
| `LoginScreen.jsx` | (pre-auth) | Username/password login form |
| `SetupPage.jsx` | (pre-auth) | First-run admin creation |
| `MobileSetupPage.jsx` | `/mobile-setup` path | Mobile app deep-link setup |

### Global & Local State Management

**No Redux or Zustand on web.** State is managed via:

| Mechanism | Scope | Usage |
|---|---|---|
| `AuthContext` | Global | `user`, `permissions`, `login()`, `logout()`, `isAuthenticated`. Backed by `localStorage.userSession`. |
| `SettingsContext` | Global (post-auth) | Company settings fetched from `/api/settings` on mount; exposes `{ settings, loading }`. |
| `useState` / `useReducer` | Component-local | Page-level state: form fields, modal open/close, selected items, pagination, sort. |
| `useDraft` hook | Cross-session | Reads/writes draft transaction state to `/api/drafts/:type` for persistence across page refreshes. |
| `useSavedSales` hook | Session | Manages POS saved sale slots in memory. |
| `useTypeahead` hook | Component | Debounced API calls for autocomplete fields. |

**Mobile** uses Zustand stores (`useAuthStore`, `usePosStore`, `useCycleCountStore`, `useSettingsStore`) and TanStack Query v5 for data fetching.

### Core Component Library

**Layout:**
- `MainLayout.jsx` — Sidebar nav, page switcher, header with user info

**UI Primitives:**
- `Modal.jsx` — Reusable modal wrapper
- `Icon.jsx` — Icon renderer (maps `ICONS` constants to SVG)
- `SortableHeader.jsx` — Clickable column header with sort state
- `PaginationControls.jsx` — Page prev/next with count display
- `SearchBar.jsx` — Debounced search input

**Forms:**
- `PartForm.jsx` — Create/edit part (brand, group, tax rate, flags)
- `PurchaseOrderForm.jsx` — PO line-item editor

**Domain Components (by feature):**
- `pos/` — Cart lines, part search typeahead, payment flow, receipt preview
- `invoice/` — Invoice viewer, InvoiceDetailsModal, split payment UI
- `accounts-receivable/` — CustomerInvoiceDetailsModal, aging table
- `refunds/` — Credit note creation flow
- `dashboard/` — Stat cards, Recharts-based sales chart
- `reports/` — SalesReport, SalesByCustomerReport
- `applications/` — Vehicle application selector tree
- `cycleCount/` — Count submission, approval queue
- `parts-cleanup/` — Merge candidate cards, diff viewer
- `document-management/` — Document list, preview panel, share modal
- `settings/` — Payment method config, tax rate editor, company form
- `EditHistory.jsx` — Generic edit audit trail
- `Receipt.jsx` — Printable receipt layout

---

## 6. Business Logic, Workflows & Data Flows

### Workflow 1: POS Sale to Invoice

1. **Client:** Cashier opens `POSPage` -> searches parts via `useTypeahead` -> adds lines to cart (`useState`)
2. **Draft:** Cart auto-saved to `/api/drafts/pos` on change via `useDraft`
3. **Submit:** Cashier submits -> `POST /api/sales/staging` -> creates `staged_sale` record with `status=pending`
4. **Approval:** Manager opens `CashierApprovalDesk` -> sees pending staged sales -> `POST /api/sales/staging/:id/approve-post` -> backend creates `invoice`, `invoice_line` rows, records `inventory_transaction` (StockOut)
5. **Payment:** Cashier records payment -> `POST /api/invoices/:id/payments` -> inserts `invoice_payments` row -> DB trigger updates `invoice.amount_paid` and `invoice.status`
6. **Response:** Frontend shows receipt via `Receipt.jsx`

### Workflow 2: Goods Receipt to Inventory Update

1. **Client:** Purchaser opens `GoodsReceiptPage` -> selects supplier, optionally links PO, adds line items (part + qty + cost)
2. **Submit:** `POST /api/goods-receipts` -> backend inserts `goods_receipt` + `goods_receipt_line` rows, then inserts `inventory_transaction` (StockIn) for each line
3. **WAC Trigger:** `trg_update_wac` fires AFTER INSERT on `inventory_transaction` WHERE `trans_type='StockIn'` -> computes new WAC: `(prev_stock * current_wac + qty * cost) / (prev_stock + qty)` -> updates `part.wac_cost` and `part.last_cost`
4. **Search Sync:** Meilisearch outbox detects part change -> `meili-outbox-worker` picks up event -> syncs updated part document to `parts` index

### Workflow 3: Part Deduplication

1. **Worker:** `dedupe-scan-worker.js` runs `runScanCycle()` on schedule
2. **Finder:** `duplicateFinder.js` runs SQL to identify candidate pairs (similar SKU/part number patterns, same brand+group)
3. **AI Verification:** Candidate pairs passed to `llmRouter.js` -> calls configured LLM (Gemini/OpenAI/OpenRouter) -> LLM returns `isDuplicate: bool` + reasoning
4. **Storage:** Confirmed duplicates stored in merge suggestion table; dismissed pairs added to `part_exclusion`
5. **Merge:** User reviews in `PartsCleanupPage` -> selects canonical part -> `POST /api/parts/merge/merge` -> `partMergeService.js` executes: transfers part_numbers, part_applications, invoice_lines, inventory_transactions to canonical; soft-deletes source; logs to `part_merge_log`

### Workflow 4: A/R Payment Collection

1. **Client:** Accountant opens `AccountsReceivablePage` -> views aging summary -> drills into customer -> sees unpaid/partially paid invoices
2. **Payment:** `POST /api/payments` with `{ customer_id, amount, method_id, invoice_allocations[] }` -> inserts `customer_payment` + `invoice_payment_allocation` rows -> backend recomputes invoice balances
3. **Cheque:** If paying by cheque -> `ChequePrintingPage` -> selects template -> `POST /api/cheques/generate-pdf` -> returns PDF blob -> browser prints

### Workflow 5: Full-Text Part Search

1. **Client:** User types in `PowerSearchPage` or POS typeahead -> calls `GET /api/power-search?q=...`
2. **Backend:** `powerSearchRoutes.js` calls Meilisearch `parts` index with query + configured typo tolerance + filters
3. **Sync path:** Part changes in PostgreSQL trigger `pg_notify` -> `meili-outbox-worker` dequeues -> calls `syncPartWithMeili()` -> Meilisearch index updated with exponential backoff retry

---

## 7. Configuration, Envs & Execution Scripts

### Environment Variables (from `.env.example`)

```bash
# PostgreSQL
DB_HOST=db
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=<secret>
DB_NAME=forson_business_suite

# JWT
JWT_SECRET=<long-random-string>

# Backup
BACKUP_RETENTION_DAYS=7

# Meilisearch
MEILISEARCH_HOST=http://meilisearch:7700
MEILISEARCH_MASTER_KEY=<secret>

# Runtime
NODE_ENV=development                         # development | staging | production

# Background Workers (default: all enabled)
DISABLE_MEILI_OUTBOX_WORKER=false
DISABLE_MEILI_APPLICATIONS_LISTENER=false
ENABLE_LEGACY_MEILI_PART_LISTENER=false      # opt-in only
DISABLE_SEARCH_REPAIR_WORKER=false
DISABLE_DEDUPE_SCAN_WORKER=false

# Meilisearch Tuning
MEILI_SETUP_MAX_RETRIES=4
MEILI_SETUP_RETRY_DELAY=200
MEILI_TYPO_ENABLED=true
MEILI_TYPO_MIN_WORD_SIZE=4
MEILI_TYPO_MIN_WORD_SIZE_TWO=8

# LLM Provider for Deduplication
LLM_PROVIDER=google                          # google | openai | openrouter
GEMINI_API_KEY=<key>
GEMINI_API_KEY_POOL=<key1,key2,...>
OPENAI_API_KEY=<key>
OPENAI_MODEL=gpt-4o-mini
OPENROUTER_API_KEY=<key>
OPENROUTER_MODEL=google/gemini-2.0-flash-exp:free
OPENROUTER_FALLBACK_MODEL=deepseek/deepseek-chat

# Vite build-time (injected as globals: __APP_VERSION__, __APP_COMMIT_SHA__, __APP_BUILD_DATE__)
VITE_APP_VERSION=
VITE_APP_COMMIT_SHA=
VITE_APP_BUILD_DATE=
VITE_PROXY_TARGET=http://forson_backend_dev:3001
```

### NPM / Shell Commands

| Command | Description |
|---|---|
| `./scripts/start-dev.sh` | Start all dev containers (Docker Compose dev stack) |
| `docker compose down` | Stop all containers |
| `./scripts/reset-dev-db.sh` | Drop and recreate local dev database |
| `npm test` | Run all workspace tests |
| `npm run -w packages/api test` | Run API tests only |
| `npx jest --config jest.config.js test/myFile.test.js` | Run single test file (in `packages/api`) |
| `npm run lint` | Lint all workspaces |
| `npm run -w packages/web lint` | Lint web package only |
| `npm run -w packages/api migrate -- --host localhost` | Run pending migrations (local) |
| `npm run -w packages/api migrate:status -- --host localhost` | Show migration status |
| `npm run -w packages/api migrate:verify -- --host localhost` | Detect schema drift |
| `sudo docker compose -f docker-compose.prod.yml up -d --pull=always --remove-orphans` | Start production stack |
| `sudo docker compose -f docker-compose.prod.yml exec -T backend node scripts/migrate.js up` | Run migrations in production |
| `./scripts/update-prod.sh` | Full production update (pull + migrate + restart) |
| `npm run -w packages/web dev` | Start Vite dev server (port 5173) |
| `npm run -w packages/web build` | Build production web bundle |

### Docker Services

| Service | Container Name | Image | Purpose |
|---|---|---|---|
| `backend` | `forson_backend_dev` / `forson_backend` | `kentonel/forson-backend` | Express API (port 3001) |
| `frontend` | `forson_frontend_dev` / `forson_frontend` | `kentonel/forson-frontend` | React SPA via Nginx (port 80/443) |
| `db` | `forson_db` | `postgres:15` | PostgreSQL database |
| `meilisearch` | `forson_meilisearch` | `getmeili/meilisearch` | Full-text search engine (port 7700) |

### CI/CD (GitHub Actions)

- **Push to `master`:** Builds Docker images; pushes to Docker Hub (`kentonel/forson-backend`, `kentonel/forson-frontend`) and GHCR.
- **Git tag `v*`:** Production deploy over SSH (currently disabled in CI YAML; done manually via `update-prod.sh`).
- Build metadata injected at build time: `__APP_VERSION__`, `__APP_COMMIT_SHA__`, `__APP_BUILD_DATE__`.

---

## Appendix: Permission Keys Reference

| Key | Category | Description |
|---|---|---|
| `dashboard:view` | General | View Dashboard |
| `pos:use` | General | Use Point of Sale |
| `invoicing:create` | Sales & A/R | Create Invoices |
| `invoice:delete` | Sales & A/R | Delete Invoices |
| `invoice:edit_receipt_no` | Sales & A/R | Edit physical receipt number |
| `ar:view` | Sales & A/R | View Accounts Receivable |
| `ar:receive_payment` | Sales & A/R | Receive Customer Payments |
| `inventory:view` | Inventory & Purchasing | View Inventory |
| `inventory:adjust` | Inventory & Purchasing | Adjust Stock Levels |
| `goods_receipt:create` | Inventory & Purchasing | Create Goods Receipts |
| `goods_receipt:edit` | Inventory & Purchasing | Edit Goods Receipts |
| `purchase_orders:view` | Inventory & Purchasing | View Purchase Orders |
| `purchase_orders:edit` | Inventory & Purchasing | Create/Edit Purchase Orders |
| `cycle_count:execute` | Inventory & Purchasing | Execute cycle count counts |
| `cycle_count:manage` | Inventory & Purchasing | Manage cycle count workflow |
| `parts:view` | Data Management | View Parts |
| `parts:create` | Data Management | Create Parts |
| `parts:edit` | Data Management | Edit Parts |
| `parts:delete` | Data Management | Delete Parts |
| `parts:merge` | Data Management | Merge duplicate parts |
| `suppliers:view` | Data Management | View Suppliers |
| `suppliers:edit` | Data Management | Create/Edit Suppliers |
| `customers:view` | Data Management | View Customers |
| `customers:edit` | Data Management | Create/Edit Customers |
| `applications:view` | Data Management | View Vehicle Applications |
| `applications:edit` | Data Management | Create/Edit Vehicle Applications |
| `documents:view` | Data Management | View documents |
| `documents:download` | Data Management | Download documents |
| `documents:share` | Data Management | Share documents |
| `cheques:view` | Finance | View cheque history/templates |
| `cheques:create` | Finance | Print/generate cheques |
| `cheques:manage_settings` | Finance | Manage cheque templates & printer profiles |
| `employees:view` | Administration | View Employees |
| `employees:edit` | Administration | Create/Edit Employees |
| `settings:view` | Administration | View Settings |
| `settings:edit` | Administration | Edit Settings |
| `reports:view` | Administration | View Reports |
| `data-utils:export` | System Utilities | Export Data (CSV) |
| `data-utils:import` | System Utilities | Import Data (CSV) |
| `backups:view` | System Utilities | View & Download Backups |
| `backups:create` | System Utilities | Create On-Demand Backups |
| `backups:restore` | System Utilities | Restore from Backup |
| `backups:delete` | System Utilities | Delete Backups |
