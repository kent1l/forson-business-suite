# Product Requirement Document: Forson Business Suite
**Version:** 1.1 (Code-audited)  
**Date:** August 9, 2025  

---

## 1. Overview
The Forson Business Suite is a modern, integrated software solution designed to replace a legacy Microsoft Access-based system. This application streamlines core business operations, from inventory and procurement to sales and reporting, by providing a single source of truth and automating key workflows. The system is built on a scalable, API-first architecture using a Node.js backend and a React frontend to support future growth.

---

## 2. Goals & Success Metrics

| Goal                       | Success Metric                                        | Target          |
|----------------------------|-------------------------------------------------------|-----------------|
| Improve Operational Efficiency | Reduce average order processing time.                  | 50% reduction   |
| Enhance Data Accuracy      | Decrease inventory discrepancies found during stock counts. | 75% reduction   |
| Provide Real-Time Intelligence | Time required to generate key financial reports.         | < 5 minutes     |
| Ensure System Reliability  | System uptime during business hours.                  | 99.9%           |

---

## 3. Scope

### 3.1 In-Scope Modules
- Inventory Management  
- Sales Order Processing (Invoices, POS)  
- User Management & Security  
- Reporting & Business Intelligence  
- Supplier & Customer Management  

### 3.2 Out-of-Scope (Future Phases)
- Sales Quotes  
- E-commerce platform integration  
- Dedicated supplier and customer web portals  
- Advanced HR and payroll features  

---

## 4. Functional Requirements

### 4.1 Inventory Management

| ID          | Requirement |
|-------------|-------------|
| **FR-INV-01** | The system shall provide a central catalog for all parts with fields including `part_id`, `internal_sku`, `detail`, `brand_id`, `group_id`, `is_active`, `last_cost`, and `last_sale_price`. |
| **FR-INV-02** | The system shall automatically generate a unique `internal_sku` for each new part created, following the format `GROUP-BRAND-SEQ`. |
| **FR-INV-03** | The system shall calculate `stock_on_hand` for each part in real-time by summing all transactions in the `inventory_transaction` table. |
| **FR-INV-04** | The system shall display a visual alert on the dashboard for any part where `stock_on_hand` is less than or equal to its `warning_quantity` and the `low_stock_warning` flag is enabled. |

---

### 4.2 Sales Order Processing

| ID          | Requirement |
|-------------|-------------|
| **FR-SAL-01** | The system shall provide a dedicated Point of Sale (POS) interface for processing immediate sales, defaulting to a "Walk-in" customer. |
| **FR-SAL-02** | The system shall provide a separate Invoicing interface for creating detailed invoices, suitable for credit-based or B2B sales. |
| **FR-SAL-03** | When an invoice is created, the system must automatically generate a "Sale" transaction in the `inventory_transaction` table for each line item, decrementing the stock quantity. |

---

### 4.3 User Management & Security

| ID          | Requirement |
|-------------|-------------|
| **FR-SEC-01** | The system shall support three user roles: Clerk (Level 1), Manager (Level 5), and Admin (Level 10), as defined in the `permission_level` table. |
| **FR-SEC-02** | Access to sensitive features (e.g., Settings, Employee Management) must be restricted to authorized roles on both the frontend UI and the backend API. |

---

## 5. Information Architecture & Data Model

**System Components:**
- **Web Frontend:** A single-page application (SPA) built with React and Vite.  
- **Backend Services:** A RESTful API built with Node.js and Express.  
- **Database:** A PostgreSQL database.  
- **Data Model:** The database design is centered around core entities such as `part`, `customer`, `supplier`, `invoice`, and `inventory_transaction`, with appropriate relationships to enforce data integrity.
