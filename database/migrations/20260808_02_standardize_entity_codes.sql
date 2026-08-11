-- Migration: 20260808_02_standardize_entity_codes.sql
-- Description: Add customer_code and supplier_code columns, backfill entity codes 
--              for Customer, Employee, Supplier, and SOA using standardized PREFIX-YYYYMM-XXXX format.

BEGIN;

-- 1. Add missing code columns
ALTER TABLE customer ADD COLUMN IF NOT EXISTS customer_code VARCHAR(30);
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS supplier_code VARCHAR(30);

-- 2. Backfill customer_code for existing customers
UPDATE customer
SET customer_code = 'CUST-' || TO_CHAR(COALESCE(date_created, CURRENT_TIMESTAMP), 'YYYYMM') || '-' || LPAD(customer_id::text, 4, '0')
WHERE customer_code IS NULL;

-- 3. Backfill supplier_code for existing suppliers
UPDATE supplier
SET supplier_code = 'SUPP-' || TO_CHAR(COALESCE(date_created, CURRENT_TIMESTAMP), 'YYYYMM') || '-' || LPAD(supplier_id::text, 4, '0')
WHERE supplier_code IS NULL;

-- 4. Backfill employee_code for existing employees
UPDATE employee
SET employee_code = 'EMP-' || TO_CHAR(COALESCE(date_created, date_hired, CURRENT_TIMESTAMP), 'YYYYMM') || '-' || LPAD(employee_id::text, 4, '0')
WHERE employee_code IS NULL;

-- 5. Seed document_sequence for CUST, SUPP, EMP, and SOA for the current month
DO $$
DECLARE
    v_period text;
    v_max_cust int;
    v_max_supp int;
    v_max_emp  int;
BEGIN
    v_period := TO_CHAR(CURRENT_TIMESTAMP, 'YYYYMM');

    SELECT COALESCE(MAX(customer_id), 0) INTO v_max_cust FROM customer;
    SELECT COALESCE(MAX(supplier_id), 0) INTO v_max_supp FROM supplier;
    SELECT COALESCE(MAX(employee_id), 0) INTO v_max_emp  FROM employee;

    INSERT INTO document_sequence (prefix, period, last_number)
    VALUES ('CUST', v_period, v_max_cust)
    ON CONFLICT (prefix, period) DO UPDATE
    SET last_number = GREATEST(document_sequence.last_number, EXCLUDED.last_number);

    INSERT INTO document_sequence (prefix, period, last_number)
    VALUES ('SUPP', v_period, v_max_supp)
    ON CONFLICT (prefix, period) DO UPDATE
    SET last_number = GREATEST(document_sequence.last_number, EXCLUDED.last_number);

    INSERT INTO document_sequence (prefix, period, last_number)
    VALUES ('EMP', v_period, v_max_emp)
    ON CONFLICT (prefix, period) DO UPDATE
    SET last_number = GREATEST(document_sequence.last_number, EXCLUDED.last_number);
END $$;

COMMIT;
