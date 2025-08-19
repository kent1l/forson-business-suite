--
-- PostgreSQL database schema (Idempotent & Safe for Existing Databases)
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', 'public', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TABLES (Using 'IF NOT EXISTS' for safety)
--

CREATE TABLE IF NOT EXISTS public.permission_level (
    permission_level_id serial PRIMARY KEY,
    level_name character varying(50) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS public.employee (
    employee_id serial PRIMARY KEY,
    employee_code character varying(20) UNIQUE,
    first_name character varying(100) NOT NULL,
    last_name character varying(100) NOT NULL,
    position_title character varying(100),
    permission_level_id integer NOT NULL REFERENCES public.permission_level(permission_level_id) ON DELETE RESTRICT,
    username character varying(50) NOT NULL UNIQUE,
    password_hash text NOT NULL,
    password_salt text NOT NULL,
    is_active boolean DEFAULT true,
    date_hired timestamp with time zone,
    date_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by integer REFERENCES public.employee(employee_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.brand (
    brand_id serial PRIMARY KEY,
    brand_name character varying(100) NOT NULL UNIQUE,
    brand_code character varying(10) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS public."group" (
    group_id serial PRIMARY KEY,
    group_name character varying(100) NOT NULL UNIQUE,
    group_code character varying(10) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS public.tax_rate (
    tax_rate_id serial PRIMARY KEY,
    rate_name character varying(50) NOT NULL,
    rate_percentage numeric(8,6) NOT NULL,
    is_default boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.part (
    part_id serial PRIMARY KEY,
    internal_sku character varying(50) UNIQUE,
    detail text,
    brand_id integer NOT NULL REFERENCES public.brand(brand_id) ON DELETE RESTRICT,
    group_id integer NOT NULL REFERENCES public."group"(group_id) ON DELETE RESTRICT,
    barcode character varying(100),
    is_active boolean DEFAULT true,
    last_cost numeric(12,2) DEFAULT 0.00,
    wac_cost numeric(12, 2) DEFAULT 0.00,
    last_sale_price numeric(12,2) DEFAULT 0.00,
    last_cost_date timestamp with time zone,
    last_sale_price_date timestamp with time zone,
    reorder_point integer DEFAULT 0,
    low_stock_warning boolean DEFAULT false,
    warning_quantity integer DEFAULT 0,
    measurement_unit character varying(20) DEFAULT 'pcs'::character varying,
    tax_rate_id integer REFERENCES public.tax_rate(tax_rate_id) ON DELETE SET NULL,
    is_tax_inclusive_price boolean DEFAULT false,
    is_price_change_allowed boolean DEFAULT true,
    is_using_default_quantity boolean DEFAULT true,
    is_service boolean DEFAULT false,
    date_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by integer REFERENCES public.employee(employee_id) ON DELETE SET NULL,
    date_modified timestamp with time zone,
    modified_by integer REFERENCES public.employee(employee_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.application (
    application_id serial PRIMARY KEY,
    make character varying(100) NOT NULL,
    model character varying(100) NOT NULL,
    engine character varying(100)
);

CREATE TABLE IF NOT EXISTS public.part_number (
    part_number_id serial PRIMARY KEY,
    part_id integer NOT NULL REFERENCES public.part(part_id) ON DELETE CASCADE,
    part_number character varying(100) NOT NULL,
    number_type character varying(50),
    display_order integer,
    UNIQUE (part_id, part_number)
);

CREATE TABLE IF NOT EXISTS public.part_application (
    part_app_id serial PRIMARY KEY,
    part_id integer NOT NULL REFERENCES public.part(part_id) ON DELETE CASCADE,
    application_id integer NOT NULL REFERENCES public.application(application_id) ON DELETE CASCADE,
    year_start integer,
    year_end integer,
    UNIQUE (part_id, application_id)
);

CREATE TABLE IF NOT EXISTS public.supplier (
    supplier_id serial PRIMARY KEY,
    supplier_name character varying(255) NOT NULL UNIQUE,
    contact_person character varying(100),
    phone character varying(50),
    email character varying(100),
    address text,
    is_active boolean DEFAULT true,
    date_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by integer REFERENCES public.employee(employee_id) ON DELETE SET NULL,
    date_modified timestamp with time zone,
    modified_by integer REFERENCES public.employee(employee_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.goods_receipt (
    grn_id serial PRIMARY KEY,
    grn_number character varying(50) NOT NULL UNIQUE,
    receipt_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    supplier_id integer NOT NULL REFERENCES public.supplier(supplier_id) ON DELETE RESTRICT,
    received_by integer NOT NULL REFERENCES public.employee(employee_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.goods_receipt_line (
    grn_line_id serial PRIMARY KEY,
    grn_id integer NOT NULL REFERENCES public.goods_receipt(grn_id) ON DELETE CASCADE,
    part_id integer NOT NULL REFERENCES public.part(part_id) ON DELETE RESTRICT,
    quantity numeric(12,4) NOT NULL,
    cost_price numeric(12,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.customer (
    customer_id serial PRIMARY KEY,
    first_name character varying(100) NOT NULL,
    last_name character varying(100),
    company_name character varying(255),
    phone character varying(50),
    email character varying(100) UNIQUE,
    address text,
    is_active boolean DEFAULT true,
    date_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.invoice (
    invoice_id serial PRIMARY KEY,
    invoice_number character varying(50) NOT NULL UNIQUE,
    customer_id integer NOT NULL REFERENCES public.customer(customer_id) ON DELETE RESTRICT,
    employee_id integer NOT NULL REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
    invoice_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    total_amount numeric(12,2) NOT NULL,
    amount_paid numeric(12,2) DEFAULT 0.00, -- This will be deprecated but kept for now
    status character varying(20) DEFAULT 'Unpaid'::character varying, -- Changed default
    terms TEXT
);

CREATE TABLE IF NOT EXISTS public.invoice_line (
    invoice_line_id serial PRIMARY KEY,
    invoice_id integer NOT NULL REFERENCES public.invoice(invoice_id) ON DELETE CASCADE,
    part_id integer NOT NULL REFERENCES public.part(part_id) ON DELETE RESTRICT,
    quantity numeric(12,4) NOT NULL,
    sale_price numeric(12,2) NOT NULL,
    cost_at_sale numeric(12,2),
    discount_amount numeric(12,2) DEFAULT 0.00
);

CREATE TABLE IF NOT EXISTS public.customer_payment (
    payment_id serial PRIMARY KEY,
    customer_id integer NOT NULL REFERENCES public.customer(customer_id) ON DELETE RESTRICT,
    employee_id integer NOT NULL REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
    payment_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    amount numeric(12,2) NOT NULL,
    payment_method character varying(50),
    reference_number character varying(100),
    notes text
);

CREATE TABLE IF NOT EXISTS public.invoice_payment_allocation (
    allocation_id serial PRIMARY KEY,
    invoice_id integer NOT NULL REFERENCES public.invoice(invoice_id) ON DELETE CASCADE,
    payment_id integer NOT NULL REFERENCES public.customer_payment(payment_id) ON DELETE CASCADE,
    amount_allocated numeric(12,2) NOT NULL,
    UNIQUE (invoice_id, payment_id)
);


CREATE TABLE IF NOT EXISTS public.inventory_transaction (
    inv_trans_id bigserial PRIMARY KEY,
    part_id integer NOT NULL REFERENCES public.part(part_id) ON DELETE RESTRICT,
    transaction_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    trans_type character varying(50) NOT NULL,
    quantity numeric(12,4) NOT NULL,
    unit_cost numeric(12,2),
    reference_no character varying(100),
    employee_id integer REFERENCES public.employee(employee_id) ON DELETE SET NULL,
    notes text
);

CREATE TABLE IF NOT EXISTS public.document_sequence (
    prefix character varying(10) NOT NULL,
    period character varying(10) NOT NULL,
    last_number integer NOT NULL,
    PRIMARY KEY (prefix, period)
);

CREATE TABLE IF NOT EXISTS public.settings (
    setting_key character varying(50) PRIMARY KEY,
    setting_value text,
    description text
);

CREATE TABLE IF NOT EXISTS public.permission (
    permission_id serial PRIMARY KEY,
    permission_key character varying(100) NOT NULL UNIQUE,
    description text,
    category character varying(50)
);

CREATE TABLE IF NOT EXISTS public.role_permission (
    permission_level_id integer NOT NULL REFERENCES public.permission_level(permission_level_id) ON DELETE CASCADE,
    permission_id integer NOT NULL REFERENCES public.permission(permission_id) ON DELETE CASCADE,
    PRIMARY KEY (permission_level_id, permission_id)
);

CREATE TABLE IF NOT EXISTS public.purchase_order (
    po_id serial PRIMARY KEY,
    po_number character varying(50) NOT NULL UNIQUE,
    supplier_id integer NOT NULL REFERENCES public.supplier(supplier_id) ON DELETE RESTRICT,
    employee_id integer NOT NULL REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
    order_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    expected_date timestamp with time zone,
    total_amount numeric(12,2) NOT NULL,
    status character varying(20) DEFAULT 'Pending'::character varying,
    notes text
);

CREATE TABLE IF NOT EXISTS public.purchase_order_line (
    po_line_id serial PRIMARY KEY,
    po_id integer NOT NULL REFERENCES public.purchase_order(po_id) ON DELETE CASCADE,
    part_id integer NOT NULL REFERENCES public.part(part_id) ON DELETE RESTRICT,
    quantity numeric(12,4) NOT NULL,
    cost_price numeric(12,2) NOT NULL,
    quantity_received numeric(12,4) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.draft_transaction (
    draft_id serial PRIMARY KEY,
    employee_id integer NOT NULL REFERENCES public.employee(employee_id) ON DELETE CASCADE,
    transaction_type character varying(20) NOT NULL,
    draft_data jsonb NOT NULL,
    last_updated timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (employee_id, transaction_type)
);


--
-- WAC CALCULATION TRIGGER
--
CREATE OR REPLACE FUNCTION public.update_wac_on_goods_receipt()
RETURNS TRIGGER AS $$
DECLARE
    current_stock NUMERIC;
    current_wac NUMERIC;
    new_quantity NUMERIC;
    new_cost NUMERIC;
    new_wac NUMERIC;
BEGIN
    new_quantity := NEW.quantity;
    new_cost := NEW.cost_price;

    SELECT
        COALESCE((SELECT SUM(quantity) FROM public.inventory_transaction WHERE part_id = NEW.part_id), 0),
        COALESCE(p.wac_cost, 0)
    INTO
        current_stock,
        current_wac
    FROM public.part p
    WHERE p.part_id = NEW.part_id;

    IF (current_stock + new_quantity) > 0 THEN
        new_wac := ((current_stock * current_wac) + (new_quantity * new_cost)) / (current_stock + new_quantity);
    ELSE
        new_wac := new_cost;
    END IF;

    UPDATE public.part
    SET
        wac_cost = new_wac,
        last_cost = new_cost,
        last_cost_date = CURRENT_TIMESTAMP
    WHERE part_id = NEW.part_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_wac ON public.goods_receipt_line;

CREATE TRIGGER trg_update_wac
AFTER INSERT ON public.goods_receipt_line
FOR EACH ROW
EXECUTE FUNCTION public.update_wac_on_goods_receipt();

--
-- SEED DATA (Using 'ON CONFLICT DO NOTHING' for safety)
--
INSERT INTO public.permission_level (permission_level_id, level_name) VALUES (1, 'Clerk'), (5, 'Manager'), (10, 'Admin') ON CONFLICT (level_name) DO NOTHING;

INSERT INTO public.settings (setting_key, setting_value) VALUES
('COMPANY_NAME', ''), ('COMPANY_ADDRESS', ''), ('COMPANY_PHONE', ''), ('COMPANY_EMAIL', ''), ('COMPANY_WEBSITE', ''),
('DEFAULT_CURRENCY_SYMBOL', '₱'), ('DEFAULT_PAYMENT_TERMS', 'Due upon receipt'), ('INVOICE_FOOTER_MESSAGE', 'Thank you for your business!'),
('PAYMENT_METHODS', 'Cash,Credit Card,Bank Transfer,On Account'), ('DEFAULT_IS_TAX_INCLUSIVE', 'false')
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO public.customer (first_name, last_name, is_active) VALUES ('Walk-in', 'Customer', true) ON CONFLICT (email) DO NOTHING;

INSERT INTO public.permission (permission_key, description, category) VALUES
('dashboard:view', 'Can view the main dashboard', 'General'), ('pos:use', 'Can use the Point of Sale system', 'Sales'),
('invoicing:create', 'Can create new invoices', 'Sales'), ('goods_receipt:create', 'Can create new goods receipts', 'Inventory'),
('inventory:view', 'Can view inventory levels', 'Inventory'), ('inventory:adjust', 'Can adjust stock quantities', 'Inventory'),
('parts:view', 'Can view parts list', 'Parts'), ('parts:create', 'Can create new parts', 'Parts'),
('parts:edit', 'Can edit existing parts', 'Parts'), ('parts:delete', 'Can delete parts', 'Parts'),
('suppliers:view', 'Can view suppliers', 'Entities'), ('suppliers:edit', 'Can create/edit suppliers', 'Entities'),
('customers:view', 'Can view customers', 'Entities'), ('customers:edit', 'Can create/edit customers', 'Entities'),
('applications:view', 'Can view vehicle applications', 'Entities'), ('applications:edit', 'Can create/edit vehicle applications', 'Entities'),
('purchase_orders:view', 'Can view purchase orders', 'Purchasing'), ('purchase_orders:edit', 'Can create/edit purchase orders', 'Purchasing'),
('reports:view', 'Can view all reports', 'Reporting'), ('employees:view', 'Can view employee list', 'Admin'),
('employees:edit', 'Can create/edit employees', 'Admin'), ('settings:view', 'Can view application settings', 'Admin'),
('settings:edit', 'Can edit application settings', 'Admin'),
('ar:view', 'Can view Accounts Receivable', 'Financials'), ('ar:receive_payment', 'Can receive customer payments', 'Financials')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO public.role_permission (permission_level_id, permission_id) SELECT 1, p.permission_id FROM public.permission p WHERE p.permission_key IN ('dashboard:view', 'pos:use', 'invoicing:create', 'inventory:view', 'parts:view', 'suppliers:view', 'customers:view', 'applications:view') ON CONFLICT DO NOTHING;
INSERT INTO public.role_permission (permission_level_id, permission_id) SELECT 5, p.permission_id FROM public.permission p WHERE p.permission_key IN ('dashboard:view', 'pos:use', 'invoicing:create', 'goods_receipt:create', 'inventory:view', 'inventory:adjust', 'parts:view', 'parts:create', 'parts:edit', 'parts:delete', 'suppliers:view', 'suppliers:edit', 'customers:view', 'customers:edit', 'applications:view', 'applications:edit', 'reports:view', 'purchase_orders:view', 'purchase_orders:edit', 'ar:view', 'ar:receive_payment') ON CONFLICT DO NOTHING;
INSERT INTO public.role_permission (permission_level_id, permission_id) SELECT 10, p.permission_id FROM public.permission p ON CONFLICT DO NOTHING;
