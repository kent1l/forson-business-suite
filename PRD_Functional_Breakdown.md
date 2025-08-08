# Forson Business Suite: Functional Requirement Document

This document provides a detailed breakdown of the application's features, their purpose, and their technical implementation. It is intended for developers, project managers, and stakeholders to understand the complete functionality of the system.

### **Module: Core System & User Management**

| What is this feature? | Why is it important? | How does it work? |
| :--- | :--- | :--- |
| **First-Run Admin Setup** | Ensures the application is secure from the very first use by preventing unauthorized access to an unconfigured system. | On initial startup, the API checks if an admin (`permission_level_id = 10`) exists. If not, the frontend displays a dedicated setup page to create the first admin account. This page is never shown again unless the database is empty. |
| **Secure User Login** | Provides secure access to the application and is the foundation for all role-based permissions. | A user enters their credentials. The backend API compares a hashed version of the provided password against the `password_hash` stored in the `employee` table. On success, it generates a JSON Web Token (JWT). |
| **Role-Based Access Control (RBAC)** | Prevents unauthorized users from performing sensitive actions (e.g., deleting records, viewing financial reports) and hides restricted UI elements. | The JWT contains the user's `permission_level_id`. A backend middleware (`authMiddleware.js`) checks this ID on protected API routes. The frontend UI conditionally renders buttons and navigation links based on the same ID. |
| **Centralized Settings** | Allows an administrator to manage application-wide business rules (e.g., company name, tax rates, payment methods) from a single UI, without needing to change the code. | A dedicated `settings` table in the database stores key-value pairs. An admin-only "Settings" page provides a UI to update these values. A global React Context (`SettingsContext.js`) loads these settings on startup and makes them available to all components. |

### **Module: Inventory & Part Management**

| What is this feature? | Why is it important? | How does it work? |
| :--- | :--- | :--- |
| **Part Catalog & Management** | The central repository for all inventory items. Provides full CRUD (Create, Read, Update, Delete) functionality for managing product information. | A dedicated "Parts" page with a filterable and sortable table of all items in the `part` table. A modal form allows managers to add new parts or edit existing ones. |
| **Automatic SKU Generation** | Automates the creation of unique, professional SKUs, eliminating manual errors and ensuring consistency. | When a new part is created, the backend API reads the `brand_code` and `group_code`, queries the `document_sequence` table for the next number in that series, and constructs the final SKU (e.g., `FLT-BOS-0001`). |
| **Part Number Management** | Allows a single inventory item to be associated with multiple manufacturer or supplier part numbers, which is critical for cross-referencing and searching. | In the "Parts" page, a "Manage Numbers" button opens a modal. This UI allows users to add a list of numbers (separated by commas/semicolons) and reorder them. The order is saved in the `part_number` table's `display_order` column. |
| **Part Application Management** | Links parts to the specific vehicles they fit, including a year range, which is a core business requirement for an auto parts store. | In the "Parts" page, a "Manage Applications" button opens a modal. This UI allows users to select a vehicle from the `application` table and link it to the part, storing the relationship and year range in the `part_application` junction table. |
| **Intelligent Display Name** | Creates a consistent, human-readable name for each part that is used throughout the entire application (reports, invoices, POS). | A backend helper function (`displayNameHelper.js`) is used by all part-related API endpoints to construct a formatted string: `GroupName (BrandName) | Detail | PartNumber1; PartNumber2`. |

### **Module: Sales & Transactions**

| What is this feature? | Why is it important? | How does it work? |
| :--- | :--- | :--- |
| **Goods Receipt Workflow** | A dedicated interface for accurately recording incoming stock from suppliers, ensuring the inventory ledger is always up-to-date. | A "Goods Receipt" page where a user selects a supplier and adds parts from a searchable list. Upon posting, the backend API creates a record in `goods_receipt` and `goods_receipt_line`, and creates "StockIn" entries in the `inventory_transaction` table. |
| **Invoicing Workflow** | A professional interface for creating formal invoices, primarily for credit-based or business-to-business sales. | An "Invoicing" page where a user selects a customer and a payment method. The system fetches payment methods from the settings. Based on the selected method (e.g., "On Account"), the backend API sets the invoice `status` to "Paid" or "Unpaid". |
| **Point of Sale (POS) Interface** | A separate, dedicated interface optimized for fast, real-time, in-person sales. | A "POS" page with a two-panel layout. A large search bar is used to quickly add items to a cart. A "Checkout" button opens a payment modal to process the sale and print a formatted receipt. It defaults to a "Walk-in" customer but allows for selecting registered customers. |
| **Inventory Ledger (`inventory_transaction`)** | The single source of truth for all stock movements. This immutable ledger provides a complete audit trail for every part. | All transactional workflows (Goods Receipt, Invoicing, Stock Adjustment) create records in this table. Sales create negative quantity entries, while receipts and positive adjustments create positive entries. The `stock_on_hand` is always calculated by summing this table. |

### **Module: Business Intelligence & Reporting**

| What is this feature? | Why is it important? | How does it work? |
| :--- | :--- | :--- |
| **Power Search** | An advanced search tool that allows users to find parts by filtering across multiple criteria simultaneously (e.g., brand, group, application, year). | A dedicated "Power Search" page with multiple text-based filter inputs. As the user types, it sends a debounced request to a specialized backend API endpoint that dynamically builds a complex SQL query to find matching parts. |
| **Reporting Engine** | A centralized "Reporting" page with a tabbed interface for viewing all key business reports. All reports are filterable by date and exportable to CSV. | The page contains multiple report components. Each component calls a dedicated backend API endpoint that performs the necessary calculations and aggregations on the database. The frontend is responsible for displaying the data and handling the CSV export. |