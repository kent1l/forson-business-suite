# Product Requirement Document: Forson Business Suite

**Version:** 1.0
**Date:** August 9, 2025
**Status:** Draft

## 1. Overview

The Forson Business Suite is a modern, integrated software solution designed to replace the existing Microsoft Access-based system at Forson Auto Parts Supply. This application will streamline all core business operations, from inventory and procurement to sales and reporting, by providing a single source of truth and automating key workflows. The system is built on a scalable, API-first architecture to support future growth.

## 2. Goals & Success Metrics

This project aims to achieve specific business objectives, which will be measured by the following key performance indicators (KPIs).

| Goal | Success Metric | Target |
| :--- | :--- | :--- |
| **Improve Operational Efficiency** | Reduce average order processing time. | 50% reduction |
| **Enhance Data Accuracy** | Decrease inventory discrepancies found during stock counts. | 75% reduction |
| **Provide Real-Time Intelligence** | Time required to generate key financial reports. | < 5 minutes |
| **Ensure System Reliability** | System uptime during business hours (Mon-Sat, 8 AM - 5 PM). | 99.9% |

## 3. Scope

### 3.1 In-Scope Modules

* Inventory Management
* Procurement (Suppliers & Purchase Orders)
* Sales Order Processing (Quotes, Invoices, POS)
* Accounting (General Ledger, AR/AP)
* Reporting & Business Intelligence
* User Management & Security

### 3.2 Out-of-Scope (Future Phases)

* E-commerce platform integration
* Dedicated supplier and customer web portals
* Advanced HR and payroll features
* Mobile application for warehouse barcode scanning

## 4. Stakeholders & User Personas

| Persona | Role | Key Responsibilities |
| :--- | :--- | :--- |
| **Crisha** | Inventory Clerk | Manages part catalog, processes goods receipts, monitors stock levels, performs stock adjustments. |
| **Kent** | Sales Manager | Oversees sales operations, creates quotes and invoices, manages customer relationships, analyzes sales data. |
| **Dalia** | Accountant | Manages Accounts Receivable (AR) and Accounts Payable (AP), generates financial statements, reconciles accounts. |
| **Ronie** | Warehouse Staff | Picks and packs orders, receives incoming stock, conducts physical inventory counts. |

## 5. Assumptions & Constraints

* The system must be able to integrate with legacy Access databases for the initial data migration phase.
* The application will be deployed on-premise within the local network.
* The initial release will focus on core inventory and sales workflows as defined in the MVP.

## 6. Functional Requirements

### 6.1 Inventory Management

| ID | Requirement |
| :--- | :--- |
| **FR-INV-01** | The system shall provide a central catalog for all parts with fields including `part_id`, `internal_sku`, `detail`, `brand_id`, `group_id`, `is_active`, `last_cost`, `last_sale_price`, `reorder_point`, and `warning_quantity`. |
| **FR-INV-02** | The system shall automatically generate a unique `internal_sku` for each new part created. |
| **FR-INV-03** | The system shall calculate `stock_on_hand` for each part in real-time by summing all transactions in the `inventory_transaction` table. |
| **FR-INV-04** | The system shall display a visual alert on the dashboard and inventory page for any part where `stock_on_hand` is less than or equal to its `reorder_point`. |

### 6.2 Sales Order Processing

| ID | Requirement |
| :--- | :--- |
| **FR-SAL-01** | The system shall provide a dedicated Point of Sale (POS) interface for processing immediate sales, defaulting to a "Walk-in" customer. |
| **FR-SAL-02** | The system shall provide a separate Invoicing interface for creating detailed invoices, suitable for credit-based sales. |
| **FR-SAL-03** | When an invoice is created, the system must automatically generate a "Sale" transaction in the `inventory_transaction` table for each line item, decrementing the stock quantity. |
| **FR-SAL-04** | The system shall allow the creation of sales quotes that can be converted into invoices. |

### 6.3 User Management & Security

| ID | Requirement |
| :--- | :--- |
| **FR-SEC-01** | The system shall support three user roles: Clerk (Level 1), Manager (Level 5), and Admin (Level 10). |
| **FR-SEC-02** | Access to sensitive features (e.g., Settings, Employee Management) must be restricted to authorized roles on both the frontend UI and the backend API. |
| **FR-SEC-03** | The system shall maintain an audit trail (`event_log`) of all critical actions, recording the `user_id` and timestamp. |

## 7. Non-Functional Requirements

| ID | Category | Requirement |
| :--- | :--- | :--- |
| **NFR-PERF-01** | Performance | The system must support up to 100 concurrent users with sub-second response times for all database queries. |
| **NFR-REL-01** | Reliability | The system must maintain 99.9% uptime during business hours (Mon-Sat, 8 AM - 5 PM). |
| **NFR-SEC-01** | Security | All data transmission must be encrypted (HTTPS). All user passwords must be securely hashed and salted. |
| **NFR-BCK-01** | Backups | The database must be backed up automatically on a daily basis, with a retention policy of 30 days. |

## 8. Information Architecture & Data Model

* **System Components:**
    * **Web Front-end:** A single-page application (SPA) built with **React**.
    * **Back-end Services:** A RESTful API built with **.NET/C#**.
    * **Database:** A **Microsoft SQL Server** database.
* **Data Model:** The database design is centered around core entities such as `Part`, `Customer`, `Supplier`, `Invoice`, and `Inventory_Transaction`, with appropriate relationships to enforce data integrity.

## 9. User Flows

**Sample Workflow: Purchase Order to Payment**
1.  **PO Creation:** An Inventory Clerk identifies a low-stock item and creates a Purchase Order (PO) for a specific supplier.
2.  **Goods Receipt:** Warehouse Staff receives the incoming stock, verifies it against the PO, and confirms the receipt in the system. Stock levels are automatically updated.
3.  **Invoice Entry:** An Accountant enters the supplier's invoice into the Accounts Payable (AP) ledger, linking it to the goods receipt.
4.  **Payment:** The Accountant generates a payment voucher and marks the supplier invoice as "Paid."

## 10. Milestones & Roadmap

| Phase | Title | Key Deliverables | Timeline |
| :--- | :--- | :--- | :--- |
| **Phase 1** | MVP | Core Inventory, Procurement (Suppliers), and Sales (Invoicing/POS) modules. | 3 Months |
| **Phase 2** | Financials & BI | Full Accounting module and advanced Reporting features. | 2 Months |
| **Phase 3** | Expansion | Customer Relationship Management (CRM) features and a basic supplier portal. | 2 Months |

## 11. Appendices

### 11.1 Glossary

| Term | Definition |
| :--- | :--- |
| **SKU** | Stock Keeping Unit. The unique internal identifier for a part. |
| **PO** | Purchase Order. A formal document requesting goods from a supplier. |
| **GRN** | Goods Receipt Note. A document confirming the receipt of goods from a supplier. |
| **AR/AP** | Accounts Receivable / Accounts Payable. |

### 11.2 Risk Analysis

| Risk | Mitigation Strategy |
| :--- | :--- |
| **Data Migration Errors** | Develop and test automated migration scripts. Perform a full data validation and reconciliation post-migration. |
| **User Adoption** | Involve key users throughout the development process for feedback and conduct thorough User Acceptance Testing (UAT). |
| **Scope Creep** | Adhere strictly to the phased rollout plan. All new feature requests must be formally documented and approved for a future release phase. |