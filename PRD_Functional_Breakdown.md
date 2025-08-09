# Forson Business Suite: Functional Requirement Document (Code-Audited)

This document provides a breakdown of the application's features based on the implemented codebase.

---

## Module: Core System & User Management

| Feature                | How it Works |
|------------------------|--------------|
| **First-Run Admin Setup** | On initial startup, the `App.jsx` component calls the `GET /api/setup/status` endpoint. If no admin exists, it renders the `SetupPage.jsx`, which uses `POST /api/setup/create-admin` to create the first administrator account. |
| **Secure User Login** | A user submits credentials via `LoginScreen.jsx`. The `POST /api/login` endpoint in `employeeRoutes.js` validates them against the `employee` table and returns a JWT, which is stored in local storage by `App.jsx`. |
| **Role-Based Access Control (RBAC)** | The `authMiddleware.js` (`protect`, `isAdmin`) is applied to sensitive API routes to check the JWT's `permission_level_id`. The frontend `Sidebar.jsx` and admin pages conditionally render UI based on the user's permission level stored in the session. |

---

## Module: Inventory & Part Management

| Feature                  | How it Works |
|--------------------------|--------------|
| **Part Catalog & Management** | The `PartsPage.jsx` provides full CRUD functionality. A modal containing the `PartForm.jsx` is used for creating and updating parts via the RESTful endpoints in `partRoutes.js`. |
| **Automatic SKU Generation** | When a new part is created via `POST /api/parts`, the backend API transactionally queries the `brand` and `group` tables for their codes, gets the next number from the `document_sequence` table (using `FOR UPDATE` to prevent race conditions), and constructs the final SKU. |
| **Part Number Management** | From `PartsPage.jsx`, the `PartNumberManager.jsx` component is opened in a modal. It allows users to add a list of numbers, which are processed by `POST /api/parts/:partId/numbers`, and reorder them, which is saved via `PUT /api/parts/:partId/numbers/reorder`. |
| **Part Application Management** | From `PartsPage.jsx`, the `PartApplicationManager.jsx` component allows users to link a part to a vehicle from the `application` table. This creates a record in the `part_application` junction table with an optional year range. |
| **Intelligent Display Name** | The `displayNameHelper.js` function is used by all part-related API endpoints to construct a formatted string: `GroupName (BrandName)` |

---

## Module: Sales & Transactions

| Feature                | How it Works |
|------------------------|--------------|
| **Goods Receipt Workflow** | The `GoodsReceiptPage.jsx` allows a user to select a supplier and add parts. Upon posting, the `POST /api/goods-receipts` endpoint uses the `documentNumberGenerator.js` helper to create a GRN number, creates a record in `goods_receipt` and `goods_receipt_line`, and adds `"StockIn"` entries to the `inventory_transaction` table. |
| **Invoicing & POS Workflows** | Both the `InvoicingPage.jsx` and the faster `POSPage.jsx` use the `POST /api/invoices` endpoint. This endpoint creates an invoice and its line items, and, most importantly, creates negative-quantity `"Sale"` entries in the `inventory_transaction` table to provide a complete audit trail. |
| **Inventory Ledger (`inventory_transaction`)** | This table is the single source of truth for stock levels. All transactional workflows (Goods Receipt, Invoicing, Stock Adjustment) create immutable records here. The current `stock_on_hand` is always calculated by summing the `quantity` column for a given part. |
