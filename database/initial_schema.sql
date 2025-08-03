-- =================================================================
--  Forson Business Suite - PostgreSQL Database Schema
--  Version 1.6 (PSQL Execution Script)
-- =================================================================

-- Drop tables in reverse order of creation to handle dependencies
DROP TABLE IF EXISTS invoice_line CASCADE;
DROP TABLE IF EXISTS invoice CASCADE;
DROP TABLE IF EXISTS customer CASCADE;
DROP TABLE IF EXISTS customer_type CASCADE;
DROP TABLE IF EXISTS event_log CASCADE;
DROP TABLE IF EXISTS adjustment_reason CASCADE;
DROP TABLE IF EXISTS document_sequence CASCADE;
DROP TABLE IF EXISTS price_history CASCADE;
DROP TABLE IF EXISTS goods_receipt_line CASCADE;
DROP TABLE IF EXISTS goods_receipt CASCADE;
DROP TABLE IF EXISTS inventory_transaction CASCADE;
DROP TABLE IF EXISTS part_application CASCADE;
DROP TABLE IF EXISTS part_number CASCADE;
DROP TABLE IF EXISTS part CASCADE;
DROP TABLE IF EXISTS application CASCADE;
DROP TABLE IF EXISTS employee CASCADE;
DROP TABLE IF EXISTS supplier CASCADE;
DROP TABLE IF EXISTS "group" CASCADE;
DROP TABLE IF EXISTS brand CASCADE;
DROP TABLE IF EXISTS permission_level CASCADE;


-- =================================================================
--  1. Lookup & System Tables (No Dependencies)
-- =================================================================

CREATE TABLE permission_level (
    permission_level_id INTEGER PRIMARY KEY,
    level_name VARCHAR(50) NOT NULL
);

CREATE TABLE brand (
    brand_id SERIAL PRIMARY KEY,
    brand_name VARCHAR(100) UNIQUE NOT NULL,
    brand_code VARCHAR(10) UNIQUE NOT NULL
);

CREATE TABLE "group" (
    group_id SERIAL PRIMARY KEY,
    group_name VARCHAR(100) UNIQUE NOT NULL,
    group_code VARCHAR(10) UNIQUE NOT NULL
);

CREATE TABLE application (
    application_id SERIAL PRIMARY KEY,
    make VARCHAR(100) NOT NULL,
    model VARCHAR(100) NOT NULL,
    engine VARCHAR(100)
);

CREATE TABLE document_sequence (
    prefix VARCHAR(10) NOT NULL,
    period VARCHAR(10) NOT NULL,
    last_number INTEGER NOT NULL,
    PRIMARY KEY (prefix, period)
);

CREATE TABLE adjustment_reason (
    reason_id SERIAL PRIMARY KEY,
    reason_text VARCHAR(255) UNIQUE NOT NULL,
    description TEXT
);

CREATE TABLE customer_type (
    customer_type_id SERIAL PRIMARY KEY,
    type_name VARCHAR(50) UNIQUE NOT NULL
);

-- =================================================================
--  2. Core Data Tables (With Dependencies)
-- =================================================================

CREATE TABLE employee (
    employee_id SERIAL PRIMARY KEY,
    employee_code VARCHAR(20) UNIQUE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    position_title VARCHAR(100),
    permission_level_id INTEGER NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    date_hired TIMESTAMP WITH TIME ZONE,
    date_created TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    FOREIGN KEY (permission_level_id) REFERENCES permission_level (permission_level_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by) REFERENCES employee (employee_id) ON DELETE SET NULL
);

CREATE TABLE supplier (
    supplier_id SERIAL PRIMARY KEY,
    supplier_name VARCHAR(255) UNIQUE NOT NULL,
    contact_person VARCHAR(100),
    phone VARCHAR(50),
    email VARCHAR(100),
    address TEXT,
    date_created TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    date_modified TIMESTAMP WITH TIME ZONE,
    modified_by INTEGER,
    FOREIGN KEY (created_by) REFERENCES employee (employee_id) ON DELETE SET NULL,
    FOREIGN KEY (modified_by) REFERENCES employee (employee_id) ON DELETE SET NULL
);

CREATE TABLE part (
    part_id SERIAL PRIMARY KEY,
    internal_sku VARCHAR(50) UNIQUE,
    detail TEXT,
    brand_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    barcode VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    last_cost NUMERIC(12, 2) DEFAULT 0.00,
    last_sale_price NUMERIC(12, 2) DEFAULT 0.00,
    last_cost_date TIMESTAMP WITH TIME ZONE,
    last_sale_price_date TIMESTAMP WITH TIME ZONE,
    search_text TEXT,
    reorder_point INTEGER DEFAULT 0,
    preferred_quantity INTEGER DEFAULT 1,
    low_stock_warning BOOLEAN DEFAULT FALSE,
    warning_quantity INTEGER DEFAULT 0,
    measurement_unit VARCHAR(20) DEFAULT 'pcs',
    tax_rate NUMERIC(5, 4) DEFAULT 0.00,
    is_tax_inclusive_price BOOLEAN DEFAULT FALSE,
    is_price_change_allowed BOOLEAN DEFAULT TRUE,
    is_using_default_quantity BOOLEAN DEFAULT TRUE,
    is_service BOOLEAN DEFAULT FALSE,
    date_created TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    date_modified TIMESTAMP WITH TIME ZONE,
    modified_by INTEGER,
    FOREIGN KEY (brand_id) REFERENCES brand (brand_id) ON DELETE RESTRICT,
    FOREIGN KEY (group_id) REFERENCES "group" (group_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by) REFERENCES employee (employee_id) ON DELETE SET NULL,
    FOREIGN KEY (modified_by) REFERENCES employee (employee_id) ON DELETE SET NULL
);

CREATE TABLE customer (
    customer_id SERIAL PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100),
    company_name VARCHAR(255),
    phone VARCHAR(50),
    email VARCHAR(100) UNIQUE,
    address TEXT,
    customer_type_id INTEGER,
    date_created TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_type_id) REFERENCES customer_type (customer_type_id) ON DELETE SET NULL
);

-- =================================================================
--  3. Junction & Transactional Tables
-- =================================================================

CREATE TABLE part_number (
    part_number_id SERIAL PRIMARY KEY,
    part_id INTEGER NOT NULL,
    part_number VARCHAR(100) NOT NULL,
    number_type VARCHAR(50),
    FOREIGN KEY (part_id) REFERENCES part (part_id) ON DELETE CASCADE,
    UNIQUE (part_id, part_number)
);

CREATE TABLE part_application (
    part_app_id SERIAL PRIMARY KEY,
    part_id INTEGER NOT NULL,
    application_id INTEGER NOT NULL,
    year_start INTEGER,
    year_end INTEGER,
    date_created TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    date_modified TIMESTAMP WITH TIME ZONE,
    modified_by INTEGER,
    FOREIGN KEY (part_id) REFERENCES part (part_id) ON DELETE CASCADE,
    FOREIGN KEY (application_id) REFERENCES application (application_id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES employee (employee_id) ON DELETE SET NULL,
    FOREIGN KEY (modified_by) REFERENCES employee (employee_id) ON DELETE SET NULL,
    UNIQUE (part_id, application_id)
);

CREATE TABLE inventory_transaction (
    inv_trans_id BIGSERIAL PRIMARY KEY,
    part_id INTEGER NOT NULL,
    transaction_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    trans_type VARCHAR(50) NOT NULL,
    quantity NUMERIC(12, 4) NOT NULL,
    unit_cost NUMERIC(12, 2),
    reference_no VARCHAR(100),
    employee_id INTEGER,
    location VARCHAR(100),
    notes TEXT,
    FOREIGN KEY (part_id) REFERENCES part (part_id) ON DELETE RESTRICT,
    FOREIGN KEY (employee_id) REFERENCES employee (employee_id) ON DELETE SET NULL
);

CREATE TABLE goods_receipt (
    grn_id SERIAL PRIMARY KEY,
    grn_number VARCHAR(50) UNIQUE NOT NULL,
    receipt_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    supplier_id INTEGER NOT NULL,
    received_by INTEGER NOT NULL,
    FOREIGN KEY (supplier_id) REFERENCES supplier (supplier_id) ON DELETE RESTRICT,
    FOREIGN KEY (received_by) REFERENCES employee (employee_id) ON DELETE RESTRICT
);

CREATE TABLE goods_receipt_line (
    grn_line_id SERIAL PRIMARY KEY,
    grn_id INTEGER NOT NULL,
    part_id INTEGER NOT NULL,
    quantity NUMERIC(12, 4) NOT NULL,
    cost_price NUMERIC(12, 2) NOT NULL,
    FOREIGN KEY (grn_id) REFERENCES goods_receipt (grn_id) ON DELETE CASCADE,
    FOREIGN KEY (part_id) REFERENCES part (part_id) ON DELETE RESTRICT
);

CREATE TABLE price_history (
    price_history_id SERIAL PRIMARY KEY,
    part_id INTEGER NOT NULL,
    supplier_id INTEGER,
    cost_price NUMERIC(12, 2),
    sale_price NUMERIC(12, 2),
    date_recorded TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    recorded_by INTEGER,
    notes VARCHAR(255),
    FOREIGN KEY (part_id) REFERENCES part (part_id) ON DELETE CASCADE,
    FOREIGN KEY (supplier_id) REFERENCES supplier (supplier_id) ON DELETE SET NULL,
    FOREIGN KEY (recorded_by) REFERENCES employee (employee_id) ON DELETE SET NULL
);

CREATE TABLE event_log (
    event_log_id BIGSERIAL PRIMARY KEY,
    event_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    event_type VARCHAR(100) NOT NULL,
    event_description TEXT,
    user_id INTEGER,
    FOREIGN KEY (user_id) REFERENCES employee (employee_id) ON DELETE SET NULL
);

CREATE TABLE invoice (
    invoice_id SERIAL PRIMARY KEY,
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    customer_id INTEGER NOT NULL,
    employee_id INTEGER NOT NULL,
    invoice_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    total_amount NUMERIC(12, 2) NOT NULL,
    amount_paid NUMERIC(12, 2) DEFAULT 0.00,
    status VARCHAR(20) DEFAULT 'Paid',
    FOREIGN KEY (customer_id) REFERENCES customer (customer_id) ON DELETE RESTRICT,
    FOREIGN KEY (employee_id) REFERENCES employee (employee_id) ON DELETE RESTRICT
);

CREATE TABLE invoice_line (
    invoice_line_id SERIAL PRIMARY KEY,
    invoice_id INTEGER NOT NULL,
    part_id INTEGER NOT NULL,
    quantity NUMERIC(12, 4) NOT NULL,
    sale_price NUMERIC(12, 2) NOT NULL,
    discount_amount NUMERIC(12, 2) DEFAULT 0.00,
    FOREIGN KEY (invoice_id) REFERENCES invoice (invoice_id) ON DELETE CASCADE,
    FOREIGN KEY (part_id) REFERENCES part (part_id) ON DELETE RESTRICT
);

-- =================================================================
--  Add initial data for lookup tables
-- =================================================================

INSERT INTO permission_level (permission_level_id, level_name) VALUES
(10, 'Admin'),
(5, 'Manager'),
(1, 'Clerk');

-- =================================================================
--  Script End
-- =================================================================
