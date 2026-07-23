# Expense Recording Module (v1) — PRD & Developer Handoff

> **Forson Business Suite** | **PRD-FBS-EXP-001** | **Version:** 1.0
> **Date:** 2026-07-23 | **Author:** Forson (Senior Partner & Lead Architect)
> **Status:** Approved for Development

---

## 1. Business Objective & Operational Value

### Problem
Expense records are currently maintained in a manual Excel sheet with inconsistent categorization, no audit trail, and no connection to the store's operational data. As the business grows, this creates:
- **No real-time visibility** into operating costs vs. revenue
- **No audit trail** — who recorded what, when, and what was modified
- **Inconsistent categorization** — same expense type logged under different names
- **No search or filtering** — finding a specific expense requires scrolling through spreadsheets
- **Manual data entry friction** — discourages timely recording

### Solution
A structured Expense Recording module within FBS that:
1. Replaces the Excel sheet with a normalized, audited, searchable expense ledger
2. Provides admin-managed expense categories for consistent classification
3. Includes AI-assisted natural language expense entry to reduce input friction
4. Establishes the foundation for future financial modules (AP, Payroll, Treasury, PDC)

### Success Metrics
- Excel sheet fully retired for expense tracking within 2 weeks of deployment
- Average expense entry time < 30 seconds (with AI assist)
- Zero uncategorized expenses after first month
- Expense summary available on dashboard with monthly totals

---

## 2. Scope

### In Scope (v1)
| Feature | Description |
|---|---|
| Expense Categories | Admin CRUD — create, rename, deactivate, reorder categories |
| Expense Recording | Manual structured entry — amount, date, category, payee, payment method, notes, reference no. |
| AI-Assisted Classification | Natural language input → LLM auto-fills category, amount, payee, date, payment method |
| Expense Listing & Filtering | Paginated list with date range, category, payment method, payee filters |
| Expense Summary | Totals by category, monthly comparison (dashboard widget) |
| Audit Trail | Full created/modified metadata on all records |

### Out of Scope (v1)
- Supplier payments / Accounts Payable (future AP module)
- Payroll integration (future Payroll module — "Salaries & Wages" is a manual category for now)
- Cheque lifecycle tracking (future PDC module — cheque number is a reference field only)
- Bank balance reconciliation (future Treasury module)
- Budget vs. actual tracking (v2)
- Multi-branch expense allocation
- Fixed asset purchases and depreciation

### Future Integration Points
The schema is designed so these connect *additively* later:
- `payment_method_id` → links to future Treasury/Bank Balance module
- `cheque_reference` → links to future PDC/Cheque Register module
- `payroll_run_id` (nullable, future) → auto-populated by Payroll module for salary entries
- Category totals → feed into future Income Statement report

---

## 3. User Stories & Acceptance Criteria

### Epic 1: Expense Category Management

**US 1.1 — Create Expense Category**
> As an admin, I want to create expense categories so that expenses are consistently classified.

**Acceptance Criteria:**
- [ ] Admin can create a category with a name (unique) and optional description
- [ ] System rejects duplicate category names (case-insensitive)
- [ ] New categories are immediately available for expense entry
- [ ] Category list is ordered by `sort_order` then alphabetical

**US 1.2 — Edit Expense Category**
> As an admin, I want to rename or update expense category descriptions.

**Acceptance Criteria:**
- [ ] Admin can edit category name and description
- [ ] Existing expenses retain their category reference (FK)
- [ ] Renaming a category does not create a duplicate

**US 1.3 — Deactivate Expense Category**
> As an admin, I want to deactivate a category I no longer use, without losing historical expense records.

**Acceptance Criteria:**
- [ ] Deactivated categories do not appear in the category dropdown for new expenses
- [ ] Historical expenses with the deactivated category remain visible and filterable
- [ ] Admin can reactivate a deactivated category

**US 1.4 — Reorder Expense Categories**
> As an admin, I want to set the display order of categories in the dropdown.

**Acceptance Criteria:**
- [ ] Admin can set `sort_order` per category
- [ ] Dropdown and filter lists respect sort order

---

### Epic 2: Expense Recording

**US 2.1 — Record Expense (Manual Entry)**
> As a manager or admin, I want to manually record an expense with all relevant details.

**Acceptance Criteria:**
- [ ] Form fields: amount (required, > 0), expense date (required, default today), category (required), payee (optional), payment method (required), reference no. (optional), notes (optional)
- [ ] Amount is stored as numeric(12,2) in PHP
- [ ] Expense date cannot be more than 365 days in the future
- [ ] Reference number is free-text (max 100 chars) — for OR#, receipt#, cheque#, etc.
- [ ] On save, the record is committed with `created_by` = current user, `created_at` = now
- [ ] Success confirmation shows a summary of the saved expense

**US 2.2 — Record Expense (AI-Assisted Entry)**
> As a user, I want to type a natural language description and have the system auto-fill the expense form fields.

**Acceptance Criteria:**
- [ ] A text input labeled "Quick Entry (Natural Language)" is available above the manual form
- [ ] On submit, the system calls the LLM to parse the text into structured fields
- [ ] LLM receives: current active categories, current date, few-shot examples from prior corrections
- [ ] AI-suggested values pre-fill the manual form (amount, category, payee, payment method, date, notes)
- [ ] Each AI-suggested field shows a visual indicator (e.g., light blue highlight) to distinguish from manually entered values
- [ ] Low-confidence suggestions (< 0.70) show a warning badge
- [ ] User MUST review and click "Save" — no auto-save without human confirmation
- [ ] If the LLM is unavailable or errors, show a non-blocking warning and fall back to manual entry
- [ ] If the user corrects an AI-suggested field before saving, the original AI suggestion + user correction is stored in `expense_ai_correction` for learning loop

**US 2.3 — Edit Expense**
> As a manager or admin, I want to edit an existing expense record.

**Acceptance Criteria:**
- [ ] All fields except `created_by` and `created_at` are editable
- [ ] `modified_by` and `updated_at` are automatically updated
- [ ] Edit history is not tracked at field-level in v1 (YAGNI) — only last-modified metadata

**US 2.4 — Void Expense**
> As a manager or admin, I want to void (soft-delete) an expense recorded in error.

**Acceptance Criteria:**
- [ ] Voiding sets `is_void = true`, `voided_by`, `voided_at`, `void_reason`
- [ ] Voided expenses are excluded from summary totals by default
- [ ] Voided expenses remain in the database (no hard delete)
- [ ] A toggle "Show voided" is available in the expense list
- [ ] Void reason is required (min 5 chars)

---

### Epic 3: Expense Listing & Filtering

**US 3.1 — View Expense List**
> As a user with permission, I want to view a paginated list of expenses sorted by date (newest first).

**Acceptance Criteria:**
- [ ] Default sort: `expense_date DESC, created_at DESC`
- [ ] Columns: Date, Category, Payee, Amount, Payment Method, Reference No., Notes (truncated), Created By
- [ ] Pagination with configurable page size (default 25)
- [ ] Row click opens an edit/detail modal

**US 3.2 — Filter Expenses**
> As a user, I want to filter expenses by date range, category, payment method, and payee.

**Acceptance Criteria:**
- [ ] Date range filter (from/to, inclusive)
- [ ] Category filter (dropdown, multi-select optional in v1 — single select is fine)
- [ ] Payment method filter (dropdown)
- [ ] Payee filter (text search, case-insensitive partial match)
- [ ] "Show voided" toggle (default off)
- [ ] Filters are applied server-side via query parameters
- [ ] Active filter chips are displayed with a "Clear All" button

---

### Epic 4: Expense Summary

**US 4.1 — Category Totals**
> As a manager, I want to see total expenses per category for a given date range.

**Acceptance Criteria:**
- [ ] API endpoint returns: `[{ category_name, category_id, total_amount, count }]`
- [ ] Sorted by total_amount DESC
- [ ] Excludes voided expenses
- [ ] Respects the same date range filter from the list view

**US 4.2 — Monthly Comparison**
> As a manager, I want to compare expense totals month-over-month for the current year.

**Acceptance Criteria:**
- [ ] API endpoint returns: `[{ month, year, total_amount, count }]` for the last 12 months
- [ ] Excludes voided expenses
- [ ] Frontend renders a simple bar chart (Recharts — already used in dashboard)

---

## 4. Database Schema / Migration Specifications

### Migration File
`database/migrations/20260723_expense_module.sql`

### 4.1 Table: `expense_category`

```sql
CREATE TABLE IF NOT EXISTS expense_category (
    category_id     SERIAL PRIMARY KEY,
    category_name   VARCHAR(100) NOT NULL UNIQUE,
    description     TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_by      INTEGER REFERENCES employee(employee_id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    modified_by     INTEGER REFERENCES employee(employee_id),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_category_name_lower
    ON expense_category (LOWER(category_name));

-- Helpful index for dropdown ordering
CREATE INDEX IF NOT EXISTS idx_expense_category_sort
    ON expense_category (is_active, sort_order, category_name);
```

### 4.2 Table: `expense`

```sql
CREATE TABLE IF NOT EXISTS expense (
    expense_id          BIGSERIAL PRIMARY KEY,
    expense_date        DATE NOT NULL,
    category_id         INTEGER NOT NULL REFERENCES expense_category(category_id),
    amount              NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    payee               VARCHAR(200),
    payment_method_id   INTEGER REFERENCES payment_methods(method_id),
    payment_method_text VARCHAR(50) NOT NULL DEFAULT 'Cash',
    reference_no        VARCHAR(100),
    notes               TEXT,
    is_void             BOOLEAN NOT NULL DEFAULT false,
    voided_by           INTEGER REFERENCES employee(employee_id),
    voided_at           TIMESTAMPTZ,
    void_reason         TEXT,
    created_by          INTEGER NOT NULL REFERENCES employee(employee_id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    modified_by         INTEGER REFERENCES employee(employee_id),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Future integration (nullable, not used in v1):
    payroll_run_id      BIGINT
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_expense_date ON expense (expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expense_category ON expense (category_id);
CREATE INDEX IF NOT EXISTS idx_expense_payment_method ON expense (payment_method_id);
CREATE INDEX IF NOT EXISTS idx_expense_payee ON expense (LOWER(payee));
CREATE INDEX IF NOT EXISTS idx_expense_void ON expense (is_void);
CREATE INDEX IF NOT EXISTS idx_expense_created_by ON expense (created_by);
```

**Design notes:**
- `payment_method_id` is nullable + `payment_method_text` is a denormalized fallback. In v1, if the user selects a known payment method from `payment_methods` table, we store both the FK and the text. If they type a custom method (e.g., "Cash on Hand"), we store just the text. This avoids a hard FK dependency while keeping future Treasury integration clean.
- `payroll_run_id` is included as a nullable column for future Payroll module integration. It has no FK constraint in v1 (the `payroll_run` table doesn't exist yet). The Payroll module will add the FK when it creates its table.

### 4.3 Table: `expense_ai_correction`

```sql
CREATE TABLE IF NOT EXISTS expense_ai_correction (
    correction_id       BIGSERIAL PRIMARY KEY,
    expense_id          BIGINT NOT NULL REFERENCES expense(expense_id),
    field_name          VARCHAR(50) NOT NULL,
    ai_suggestion       TEXT,
    user_correction     TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expense_ai_correction_expense
    ON expense_ai_correction (expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_ai_correction_field
    ON expense_ai_correction (field_name);
```

**Purpose:** When a user corrects an AI-suggested field, store the original suggestion and the correction. These are used as few-shot examples in future LLM calls to improve classification accuracy (learning loop without fine-tuning).

### 4.4 Seed Data: Default Expense Categories

```sql
INSERT INTO expense_category (category_name, description, sort_order, created_by)
VALUES
    ('Rent',                       'Store and warehouse rental',                    1,  NULL),
    ('Utilities',                  'Electricity, water, internet, phone',          2,  NULL),
    ('Salaries & Wages',           'Regular pay, overtime, holiday pay, 13th month', 3, NULL),
    ('Transportation & Delivery',  'Freight, courier, fuel for delivery vehicle',  4,  NULL),
    ('Repairs & Maintenance',      'Store fixtures, equipment, vehicle maintenance', 5, NULL),
    ('Office Supplies',            'Paper, printer ink, miscellaneous supplies',   6,  NULL),
    ('Permits, Licenses & Taxes',  'Business permit, BIR filings, local taxes',    7,  NULL),
    ('Bank Charges & Fees',        'Bank fees, transaction charges, withdrawal fees', 8, NULL),
    ('Marketing & Advertising',    'Signage, flyers, online ads',                   9,  NULL),
    ('Professional Fees',          'Accountant, lawyer, consultant',              10,  NULL),
    ('Insurance',                  'Store, vehicle, inventory insurance',          11,  NULL),
    ('Miscellaneous',              'One-off expenses that do not fit other categories', 99, NULL)
ON CONFLICT DO NOTHING;
```

**Note:** `created_by` is NULL for seed data. The migration runner or a post-migration script should set this to the admin employee ID if one exists.

### 4.5 Permission Keys

```sql
INSERT INTO permission (permission_key, description, category) VALUES
    ('expenses:view',    'View expense records',           'Finance'),
    ('expenses:create',  'Create expense records',         'Finance'),
    ('expenses:edit',    'Edit expense records',           'Finance'),
    ('expenses:void',    'Void expense records',           'Finance'),
    ('expenses:manage_categories', 'Manage expense categories', 'Finance')
ON CONFLICT (permission_key) DO NOTHING;
```

**Role assignment (in migration or post-migration seed):**
- Permission Level 7 (Manager): `expenses:view`, `expenses:create`, `expenses:edit`, `expenses:void`
- Permission Level 10 (Admin): all expense permissions + `expenses:manage_categories`
- Permission Level 5 (Secretary): `expenses:view`, `expenses:create`

---

## 5. API Contracts

### Base path: `/api/expenses`

All routes use `protect` middleware unless noted.

### 5.1 Expense Categories

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/expense-categories` | `expenses:view` | List active categories (sorted) |
| `GET` | `/api/expense-categories/all` | `expenses:manage_categories` | List all categories including inactive |
| `POST` | `/api/expense-categories` | `expenses:manage_categories` | Create category |
| `PUT` | `/api/expense-categories/:id` | `expenses:manage_categories` | Update category |
| `PUT` | `/api/expense-categories/:id/toggle-active` | `expenses:manage_categories` | Activate/deactivate |
| `PUT` | `/api/expense-categories/reorder` | `expenses:manage_categories` | Batch update sort_order |

#### POST `/api/expense-categories`
**Request:**
```json
{
  "category_name": "Marketing & Advertising",
  "description": "Signage, flyers, online ads",
  "sort_order": 9
}
```

**Response (201):**
```json
{
  "category_id": 9,
  "category_name": "Marketing & Advertising",
  "description": "Signage, flyers, online ads",
  "sort_order": 9,
  "is_active": true,
  "created_at": "2026-07-23T10:30:00+08:00"
}
```

**Validation:**
- `category_name`: required, 1-100 chars, unique (case-insensitive)
- `description`: optional, max 500 chars
- `sort_order`: optional, integer, default 0

---

### 5.2 Expenses

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/expenses` | `expenses:view` | List expenses (paginated, filterable) |
| `GET` | `/api/expenses/:id` | `expenses:view` | Get single expense |
| `POST` | `/api/expenses` | `expenses:create` | Create expense |
| `PUT` | `/api/expenses/:id` | `expenses:edit` | Update expense |
| `PUT` | `/api/expenses/:id/void` | `expenses:void` | Void expense |
| `GET` | `/api/expenses/summary/by-category` | `expenses:view` | Category totals for date range |
| `GET` | `/api/expenses/summary/monthly` | `expenses:view` | Monthly totals (last 12 months) |

#### GET `/api/expenses`
**Query Parameters:**
| Param | Type | Default | Description |
|---|---|---|---|
| `page` | int | 1 | Page number |
| `limit` | int | 25 | Items per page (max 100) |
| `date_from` | date (YYYY-MM-DD) | null | Filter: expense_date >= date_from |
| `date_to` | date (YYYY-MM-DD) | null | Filter: expense_date <= date_to |
| `category_id` | int | null | Filter by category |
| `payment_method_id` | int | null | Filter by payment method |
| `payee` | string | null | Case-insensitive partial match |
| `show_void` | bool | false | Include voided expenses |
| `sort_by` | string | `expense_date` | `expense_date`, `amount`, `created_at` |
| `sort_dir` | string | `desc` | `asc` or `desc` |

**Response (200):**
```json
{
  "data": [
    {
      "expense_id": 1,
      "expense_date": "2026-07-23",
      "amount": "2500.00",
      "payee": "Meralco",
      "reference_no": "OR-2026-0456",
      "notes": "Electricity bill for July",
      "is_void": false,
      "category": {
        "category_id": 2,
        "category_name": "Utilities"
      },
      "payment_method": {
        "method_id": 1,
        "name": "Cash"
      },
      "payment_method_text": "Cash",
      "created_by": {
        "employee_id": 1,
        "first_name": "Onel",
        "last_name": "Pilar"
      },
      "created_at": "2026-07-23T10:30:00+08:00",
      "updated_at": "2026-07-23T10:30:00+08:00"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 25,
    "totalItems": 48,
    "totalPages": 2
  }
}
```

#### POST `/api/expenses`
**Request:**
```json
{
  "expense_date": "2026-07-23",
  "category_id": 2,
  "amount": 2500.00,
  "payee": "Meralco",
  "payment_method_id": 1,
  "payment_method_text": "Cash",
  "reference_no": "OR-2026-0456",
  "notes": "Electricity bill for July"
}
```

**Response (201):** Same shape as single expense GET.

**Validation:**
- `expense_date`: required, valid date, not more than 365 days in the future
- `category_id`: required, must reference an active category
- `amount`: required, numeric, > 0, max 99,999,999.99
- `payee`: optional, max 200 chars
- `payment_method_id`: optional, must reference an enabled payment method if provided
- `payment_method_text`: required if `payment_method_id` is null, max 50 chars
- `reference_no`: optional, max 100 chars
- `notes`: optional, no length limit (TEXT)

---

### 5.3 AI-Assisted Expense Parsing

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/expenses/parse` | `expenses:create` | Parse natural language → structured expense fields |

#### POST `/api/expenses/parse`
**Request:**
```json
{
  "text": "paid 2500 to Meralco for electricity last friday, cash"
}
```

**Response (200):**
```json
{
  "parsed": {
    "amount": 2500.00,
    "category_id": 2,
    "category_name": "Utilities",
    "payee": "Meralco",
    "payment_method_id": 1,
    "payment_method_text": "Cash",
    "expense_date": "2026-07-18",
    "reference_no": null,
    "notes": "electricity",
    "confidence": {
      "overall": 0.95,
      "category": 0.98,
      "amount": 1.0,
      "date": 0.90,
      "payment_method": 0.95
    }
  },
  "raw_llm_response": { ... },
  "provider": "google"
}
```

**Error handling:**
- If LLM is unavailable or times out (10s max): `503` with `{ "error": "AI parsing unavailable", "fallback": "manual" }` — frontend falls back to manual form
- If LLM returns unparseable JSON: `422` with same fallback flag
- If text is empty or < 3 chars: `400` with `{ "error": "Text too short for parsing" }`

**LLM Prompt Architecture (server-side):**

```
System: You are an expense classification assistant for a Philippine auto parts retail store.
Parse the user's natural language expense description into structured fields.
Return ONLY valid JSON — no markdown, no explanation.

Context:
- Current date: {current_date}
- Currency: PHP (₱)
- Active expense categories: {category_list_as_json}
- Active payment methods: {payment_methods_as_json}

Few-shot examples:
{prior_corrections_as_examples}

User: {user_text}

Respond with this exact JSON schema:
{
  "amount": number,
  "category_name": string (must match one of the provided categories),
  "payee": string|null,
  "payment_method_name": string|null (must match one of the provided methods, or null),
  "expense_date": "YYYY-MM-DD",
  "reference_no": string|null,
  "notes": string|null,
  "confidence": {
    "overall": number (0-1),
    "category": number (0-1),
    "amount": number (0-1),
    "date": number (0-1),
    "payment_method": number (0-1)
  }
}
```

**Implementation notes:**
- Use existing `llmRouter.js` — no new LLM infrastructure needed
- Provider is selected via `LLM_PROVIDER` env var (same as deduplication)
- Few-shot examples: query `expense_ai_correction` table, get the last 50 corrections, format as input→output pairs. This is the learning loop.
- Date resolution: The LLM is given the current date and must resolve relative dates ("last friday", "yesterday", "last week") to absolute `YYYY-MM-DD`.
- Category matching: The LLM must return a `category_name` that exactly matches one of the provided categories. The backend then resolves this to `category_id`. If the LLM returns a non-matching name, the backend sets `category_id = null` and `confidence.category = 0`.

---

## 6. Frontend Architecture

### 6.1 New Pages

| Page Component | `currentPage` Key | Description |
|---|---|---|
| `ExpensesPage.jsx` | `expenses` | Expense list + filters + summary |
| `ExpenseCategoriesPage.jsx` | `expense-categories` | Admin category management |

### 6.2 New Components

| Component | Location | Description |
|---|---|---|
| `ExpenseForm.jsx` | `components/forms/` | Manual expense entry/edit form |
| `ExpenseQuickEntry.jsx` | `components/expenses/` | Natural language input + AI parse trigger |
| `ExpenseList.jsx` | `components/expenses/` | Paginated, filterable expense table |
| `ExpenseSummaryCards.jsx` | `components/expenses/` | Category totals + monthly chart |
| `ExpenseCategoryManager.jsx` | `components/expenses/` | Category CRUD UI |

### 6.3 Sidebar Navigation

Add under a new "Finance" section in `MainLayout.jsx` sidebar:
- Expenses (`expenses`) — icon: receipt/clipboard
- Expense Categories (`expense-categories`) — icon: tag/folder — admin only

### 6.4 Dashboard Integration

Add a new dashboard stat card: "Total Expenses (This Month)" showing the sum of non-voided expenses for the current month, with a small sparkline of the last 6 months.

### 6.5 AI Quick Entry UX Flow

```
┌─────────────────────────────────────────────────────┐
│  Quick Entry (Natural Language)                     │
│  ┌─────────────────────────────────────────────┐    │
│  │ paid 2500 to Meralco for electricity...     │    │
│  └─────────────────────────────────────────────┘    │
│  [ Parse with AI ]                                   │
│                                                      │
│  ── After parsing ──                                 │
│  ┌─────────────────────────────────────────────┐    │
│  │ Amount:  ₱2,500.00  ◆AI                      │    │
│  │ Date:    Jul 18, 2026  ◆AI                    │    │
│  │ Category: Utilities  ◆AI (98% confident)      │    │
│  │ Payee:   Meralco  ◆AI                         │    │
│  │ Method:  Cash  ◆AI                            │    │
│  │ Notes:   electricity  ◆AI                    │    │
│  │ Reference: ___________                        │    │
│  └─────────────────────────────────────────────┘    │
│  [ Save Expense ]  [ Clear ]                         │
└─────────────────────────────────────────────────────┘

◆AI = field was AI-suggested (light blue highlight)
Low confidence (<70%) = amber warning badge
```

---

## 7. Edge Cases, Security & Performance

### Edge Cases
| Scenario | Handling |
|---|---|
| AI suggests a category that doesn't exist | Backend sets `category_id = null`, `confidence.category = 0`. Frontend highlights category field with "Please select a category" |
| AI suggests a date in the future | Backend clamps to today. Frontend shows the date with a note |
| User enters amount with commas ("2,500") | Frontend normalizes before sending; backend also strips non-numeric chars |
| Payment method is ambiguous ("card" — debit or credit?) | LLM returns `payment_method_name = null` if ambiguous; user selects manually |
| Duplicate expense (same amount, date, payee) | v1: No blocking — just a soft warning toast. v2: Add duplicate detection |
| Voiding an already-voided expense | Reject with 409 Conflict |
| Editing a voided expense | Reject with 409 Conflict — voided expenses are immutable |
| Category deleted (hard) while expenses exist | FK constraint prevents — categories can only be deactivated, never hard-deleted |
| LLM provider rate limit hit | `llmRouter.js` already has API key pool rotation. If all keys exhausted, return 503 fallback |

### Security
- All endpoints behind `protect` + `hasPermission()` middleware
- Amount field validated server-side (numeric, > 0, max 99,999,999.99) — never trust client
- Natural language text sanitized before LLM prompt injection (strip SQL/control chars)
- LLM API keys never exposed to frontend — all LLM calls are server-side via `llmRouter.js`
- Expense records are financial data — `created_by` audit is mandatory and immutable
- Void reason required to prevent silent deletion of financial records

### Performance Targets
- Expense list query: < 50ms for up to 10,000 records (indexed on `expense_date`, `category_id`)
- AI parse endpoint: < 3 seconds (LLM round-trip). Timeout at 10s with graceful fallback
- Summary by category: < 100ms (aggregate query with date range index)
- Category dropdown load: < 20ms (small table, cached in frontend after first load)

---

## 8. Implementation Plan — Phase Breakdown

### Phase 1: Database & Categories (Est. 2-3 hours)
1. Create migration file `20260723_expense_module.sql` with all 3 tables + seed data + permissions
2. Run migration against dev database
3. Implement expense category routes (`routes/expenseCategoryRoutes.js`)
4. Register routes in `index.js`
5. Build `ExpenseCategoryManager.jsx` UI component
6. Test category CRUD end-to-end

### Phase 2: Expense CRUD (Est. 3-4 hours)
1. Implement expense routes (`routes/expenseRoutes.js`) — list, get, create, update, void
2. Implement summary routes (by-category, monthly)
3. Register routes in `index.js`
4. Build `ExpenseForm.jsx` (manual entry/edit)
5. Build `ExpenseList.jsx` with filters and pagination
6. Build `ExpensesPage.jsx` combining list + form + summary
7. Add sidebar navigation entry
8. Test expense CRUD end-to-end

### Phase 3: AI-Assisted Entry (Est. 3-4 hours)
1. Implement `/api/expenses/parse` endpoint in `routes/expenseRoutes.js`
2. Build LLM prompt builder with category context + few-shot examples
3. Integrate with `llmRouter.js`
4. Implement `expense_ai_correction` recording on save (diff AI suggestions vs. final saved values)
5. Build `ExpenseQuickEntry.jsx` component
6. Integrate quick entry into `ExpensesPage.jsx`
7. Test AI parse with various natural language inputs
8. Test fallback when LLM is unavailable

### Phase 4: Dashboard & Polish (Est. 1-2 hours)
1. Add dashboard stat card for monthly expense total
2. Add 6-month expense sparkline to dashboard
3. Add void expense UI (void button + reason modal)
4. Polish: loading states, empty states, error toasts
5. Final end-to-end testing

---

## 9. Files to Create / Modify

### New Files
| File | Purpose |
|---|---|
| `database/migrations/20260723_expense_module.sql` | Schema migration |
| `packages/api/routes/expenseCategoryRoutes.js` | Category API routes |
| `packages/api/routes/expenseRoutes.js` | Expense API routes + AI parse endpoint |
| `packages/api/services/expenseAIParser.js` | LLM prompt builder + response parser |
| `packages/web/src/pages/ExpensesPage.jsx` | Main expenses page |
| `packages/web/src/pages/ExpenseCategoriesPage.jsx` | Category management page |
| `packages/web/src/components/forms/ExpenseForm.jsx` | Expense entry/edit form |
| `packages/web/src/components/expenses/ExpenseQuickEntry.jsx` | Natural language AI entry |
| `packages/web/src/components/expenses/ExpenseList.jsx` | Filterable expense table |
| `packages/web/src/components/expenses/ExpenseSummaryCards.jsx` | Summary widgets |
| `packages/web/src/components/expenses/ExpenseCategoryManager.jsx` | Category CRUD UI |

### Files to Modify
| File | Change |
|---|---|
| `packages/api/index.js` | Register new route files |
| `packages/web/src/components/layout/MainLayout.jsx` | Add sidebar entries for Expenses + Categories |
| `packages/web/src/pages/Dashboard.jsx` | Add expense summary stat card + sparkline |
| `database/seeds/` (or migration) | Add permission keys + role assignments |

---

## 10. Open Questions for Development

1. **Should `payment_method_text` be free-text or constrained to the `payment_methods` table?**
   - Recommendation: Allow both. If `payment_method_id` is provided, use it. Otherwise, store `payment_method_text` as free-text. This handles "Cash on Hand" which may not be in the payment methods table.

2. **Should the AI parser support batch parsing?** (e.g., "I paid 2500 for electricity and 500 for water")
   - Recommendation: v1 = single expense per parse. v2 = batch parsing. Keep it simple.

3. **Should expense dates be allowed in the past beyond a certain limit?**
   - Recommendation: Allow any past date (for backfilling from Excel). Only restrict future dates (max 365 days ahead). This supports the Excel migration use case.

4. **CSV import for Excel migration?**
   - Not in v1 scope, but the existing `/api/data/import/:entity` pattern can be extended later. For now, manual backfilling or a one-time import script is sufficient.

---

## 11. Verification Checklist

- [ ] Migration runs cleanly on dev database (idempotent)
- [ ] Permission keys registered and assigned to roles
- [ ] Category CRUD works (create, edit, deactivate, reorder)
- [ ] Expense create works with all field validations
- [ ] Expense list pagination + filters work
- [ ] Expense edit updates `modified_by` and `updated_at`
- [ ] Expense void requires reason and sets `voided_by`/`voided_at`
- [ ] Voided expenses excluded from summary totals
- [ ] AI parse endpoint returns structured fields with confidence scores
- [ ] AI parse fallback works when LLM is unavailable
- [ ] AI corrections are stored in `expense_ai_correction` table
- [ ] Dashboard shows monthly expense total
- [ ] All endpoints enforce permission middleware
- [ ] Sidebar navigation shows Expenses for authorized users only
