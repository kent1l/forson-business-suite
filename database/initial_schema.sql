--
-- PostgreSQL database schema
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: adjustment_reason; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.adjustment_reason (
    reason_id integer NOT NULL,
    reason_text character varying(255) NOT NULL,
    description text
);

ALTER TABLE public.adjustment_reason OWNER TO postgres;

CREATE SEQUENCE public.adjustment_reason_reason_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.adjustment_reason_reason_id_seq OWNED BY public.adjustment_reason.reason_id;

--
-- Name: application; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.application (
    application_id integer NOT NULL,
    make character varying(100) NOT NULL,
    model character varying(100) NOT NULL,
    engine character varying(100)
);

ALTER TABLE public.application OWNER TO postgres;

CREATE SEQUENCE public.application_application_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.application_application_id_seq OWNED BY public.application.application_id;

--
-- Name: brand; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.brand (
    brand_id integer NOT NULL,
    brand_name character varying(100) NOT NULL,
    brand_code character varying(10) NOT NULL
);

ALTER TABLE public.brand OWNER TO postgres;

CREATE SEQUENCE public.brand_brand_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.brand_brand_id_seq OWNED BY public.brand.brand_id;

--
-- Name: customer; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.customer (
    customer_id integer NOT NULL,
    first_name character varying(100) NOT NULL,
    last_name character varying(100),
    company_name character varying(255),
    phone character varying(50),
    email character varying(100),
    address text,
    customer_type_id integer,
    date_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    is_active boolean DEFAULT true
);

ALTER TABLE public.customer OWNER TO postgres;

CREATE SEQUENCE public.customer_customer_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.customer_customer_id_seq OWNED BY public.customer.customer_id;

--
-- Name: customer_type; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.customer_type (
    customer_type_id integer NOT NULL,
    type_name character varying(50) NOT NULL
);

ALTER TABLE public.customer_type OWNER TO postgres;

CREATE SEQUENCE public.customer_type_customer_type_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.customer_type_customer_type_id_seq OWNED BY public.customer_type.customer_type_id;

--
-- Name: document_sequence; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.document_sequence (
    prefix character varying(10) NOT NULL,
    period character varying(10) NOT NULL,
    last_number integer NOT NULL
);

ALTER TABLE public.document_sequence OWNER TO postgres;

--
-- Name: employee; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.employee (
    employee_id integer NOT NULL,
    employee_code character varying(20),
    first_name character varying(100) NOT NULL,
    last_name character varying(100) NOT NULL,
    position_title character varying(100),
    permission_level_id integer NOT NULL,
    username character varying(50) NOT NULL,
    password_hash text NOT NULL,
    password_salt text NOT NULL,
    is_active boolean DEFAULT true,
    date_hired timestamp with time zone,
    date_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by integer
);

ALTER TABLE public.employee OWNER TO postgres;

CREATE SEQUENCE public.employee_employee_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.employee_employee_id_seq OWNED BY public.employee.employee_id;

--
-- Name: event_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.event_log (
    event_log_id bigint NOT NULL,
    event_timestamp timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    event_type character varying(100) NOT NULL,
    event_description text,
    user_id integer
);

ALTER TABLE public.event_log OWNER TO postgres;

CREATE SEQUENCE public.event_log_event_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.event_log_event_log_id_seq OWNED BY public.event_log.event_log_id;

--
-- Name: goods_receipt; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.goods_receipt (
    grn_id integer NOT NULL,
    grn_number character varying(50) NOT NULL,
    receipt_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    supplier_id integer NOT NULL,
    received_by integer NOT NULL
);

ALTER TABLE public.goods_receipt OWNER TO postgres;

CREATE SEQUENCE public.goods_receipt_grn_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.goods_receipt_grn_id_seq OWNED BY public.goods_receipt.grn_id;

--
-- Name: goods_receipt_line; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.goods_receipt_line (
    grn_line_id integer NOT NULL,
    grn_id integer NOT NULL,
    part_id integer NOT NULL,
    quantity numeric(12,4) NOT NULL,
    cost_price numeric(12,2) NOT NULL
);

ALTER TABLE public.goods_receipt_line OWNER TO postgres;

CREATE SEQUENCE public.goods_receipt_line_grn_line_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.goods_receipt_line_grn_line_id_seq OWNED BY public.goods_receipt_line.grn_line_id;

--
-- Name: group; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."group" (
    group_id integer NOT NULL,
    group_name character varying(100) NOT NULL,
    group_code character varying(10) NOT NULL
);

ALTER TABLE public."group" OWNER TO postgres;

CREATE SEQUENCE public.group_group_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.group_group_id_seq OWNED BY public."group".group_id;

--
-- Name: inventory_transaction; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.inventory_transaction (
    inv_trans_id bigint NOT NULL,
    part_id integer NOT NULL,
    transaction_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    trans_type character varying(50) NOT NULL,
    quantity numeric(12,4) NOT NULL,
    unit_cost numeric(12,2),
    reference_no character varying(100),
    employee_id integer,
    location character varying(100),
    notes text
);

ALTER TABLE public.inventory_transaction OWNER TO postgres;

CREATE SEQUENCE public.inventory_transaction_inv_trans_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.inventory_transaction_inv_trans_id_seq OWNED BY public.inventory_transaction.inv_trans_id;

--
-- Name: invoice; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invoice (
    invoice_id integer NOT NULL,
    invoice_number character varying(50) NOT NULL,
    customer_id integer NOT NULL,
    employee_id integer NOT NULL,
    invoice_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    total_amount numeric(12,2) NOT NULL,
    amount_paid numeric(12,2) DEFAULT 0.00,
    status character varying(20) DEFAULT 'Paid'::character varying
);

ALTER TABLE public.invoice OWNER TO postgres;

CREATE SEQUENCE public.invoice_invoice_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.invoice_invoice_id_seq OWNED BY public.invoice.invoice_id;

--
-- Name: invoice_line; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invoice_line (
    invoice_line_id integer NOT NULL,
    invoice_id integer NOT NULL,
    part_id integer NOT NULL,
    quantity numeric(12,4) NOT NULL,
    sale_price numeric(12,2) NOT NULL,
    discount_amount numeric(12,2) DEFAULT 0.00
);

ALTER TABLE public.invoice_line OWNER TO postgres;

CREATE SEQUENCE public.invoice_line_invoice_line_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.invoice_line_invoice_line_id_seq OWNED BY public.invoice_line.invoice_line_id;

--
-- Name: part; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.part (
    part_id integer NOT NULL,
    internal_sku character varying(50),
    detail text,
    brand_id integer NOT NULL,
    group_id integer NOT NULL,
    barcode character varying(100),
    is_active boolean DEFAULT true,
    last_cost numeric(12,2) DEFAULT 0.00,
    last_sale_price numeric(12,2) DEFAULT 0.00,
    last_cost_date timestamp with time zone,
    last_sale_price_date timestamp with time zone,
    search_text text,
    reorder_point integer DEFAULT 0,
    preferred_quantity integer DEFAULT 1,
    low_stock_warning boolean DEFAULT false,
    warning_quantity integer DEFAULT 0,
    measurement_unit character varying(20) DEFAULT 'pcs'::character varying,
    tax_rate_id integer,
    is_tax_inclusive_price boolean DEFAULT false,
    is_price_change_allowed boolean DEFAULT true,
    is_using_default_quantity boolean DEFAULT true,
    is_service boolean DEFAULT false,
    date_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by integer,
    date_modified timestamp with time zone,
    modified_by integer
);

ALTER TABLE public.part OWNER TO postgres;

CREATE SEQUENCE public.part_part_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.part_part_id_seq OWNED BY public.part.part_id;

--
-- Name: part_application; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.part_application (
    part_app_id integer NOT NULL,
    part_id integer NOT NULL,
    application_id integer NOT NULL,
    year_start integer,
    year_end integer,
    date_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by integer,
    date_modified timestamp with time zone,
    modified_by integer
);

ALTER TABLE public.part_application OWNER TO postgres;

CREATE SEQUENCE public.part_application_part_app_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.part_application_part_app_id_seq OWNED BY public.part_application.part_app_id;

--
-- Name: part_number; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.part_number (
    part_number_id integer NOT NULL,
    part_id integer NOT NULL,
    part_number character varying(100) NOT NULL,
    number_type character varying(50),
    display_order integer NOT NULL
);

ALTER TABLE public.part_number OWNER TO postgres;

CREATE SEQUENCE public.part_number_part_number_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.part_number_part_number_id_seq OWNED BY public.part_number.part_number_id;

CREATE SEQUENCE public.part_number_display_order_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.part_number_display_order_seq OWNED BY public.part_number.display_order;

--
-- Name: permission_level; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.permission_level (
    permission_level_id integer NOT NULL,
    level_name character varying(50) NOT NULL
);

ALTER TABLE public.permission_level OWNER TO postgres;

--
-- Name: price_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.price_history (
    price_history_id integer NOT NULL,
    part_id integer NOT NULL,
    supplier_id integer,
    cost_price numeric(12,2),
    sale_price numeric(12,2),
    date_recorded timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    recorded_by integer,
    notes character varying(255)
);

ALTER TABLE public.price_history OWNER TO postgres;

CREATE SEQUENCE public.price_history_price_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.price_history_price_history_id_seq OWNED BY public.price_history.price_history_id;

--
-- Name: settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.settings (
    setting_key character varying(50) NOT NULL,
    setting_value text,
    description text
);

ALTER TABLE public.settings OWNER TO postgres;

--
-- Name: supplier; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.supplier (
    supplier_id integer NOT NULL,
    supplier_name character varying(255) NOT NULL,
    contact_person character varying(100),
    phone character varying(50),
    email character varying(100),
    address text,
    date_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by integer,
    date_modified timestamp with time zone,
    modified_by integer,
    is_active boolean DEFAULT true
);

ALTER TABLE public.supplier OWNER TO postgres;

CREATE SEQUENCE public.supplier_supplier_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.supplier_supplier_id_seq OWNED BY public.supplier.supplier_id;

--
-- Name: tax_rate; Type: TABLE; Schema: public; Owner: postgres
--
CREATE TABLE public.tax_rate (
    tax_rate_id integer NOT NULL,
    rate_name character varying(50) NOT NULL,
    rate_percentage numeric(8,6) NOT NULL,
    is_default boolean DEFAULT false
);

ALTER TABLE public.tax_rate OWNER TO postgres;

CREATE SEQUENCE public.tax_rate_tax_rate_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.tax_rate_tax_rate_id_seq OWNED BY public.tax_rate.tax_rate_id;


-- Set default values for ID columns
ALTER TABLE ONLY public.adjustment_reason ALTER COLUMN reason_id SET DEFAULT nextval('public.adjustment_reason_reason_id_seq'::regclass);
ALTER TABLE ONLY public.application ALTER COLUMN application_id SET DEFAULT nextval('public.application_application_id_seq'::regclass);
ALTER TABLE ONLY public.brand ALTER COLUMN brand_id SET DEFAULT nextval('public.brand_brand_id_seq'::regclass);
ALTER TABLE ONLY public.customer ALTER COLUMN customer_id SET DEFAULT nextval('public.customer_customer_id_seq'::regclass);
ALTER TABLE ONLY public.customer_type ALTER COLUMN customer_type_id SET DEFAULT nextval('public.customer_type_customer_type_id_seq'::regclass);
ALTER TABLE ONLY public.employee ALTER COLUMN employee_id SET DEFAULT nextval('public.employee_employee_id_seq'::regclass);
ALTER TABLE ONLY public.event_log ALTER COLUMN event_log_id SET DEFAULT nextval('public.event_log_event_log_id_seq'::regclass);
ALTER TABLE ONLY public.goods_receipt ALTER COLUMN grn_id SET DEFAULT nextval('public.goods_receipt_grn_id_seq'::regclass);
ALTER TABLE ONLY public.goods_receipt_line ALTER COLUMN grn_line_id SET DEFAULT nextval('public.goods_receipt_line_grn_line_id_seq'::regclass);
ALTER TABLE ONLY public."group" ALTER COLUMN group_id SET DEFAULT nextval('public.group_group_id_seq'::regclass);
ALTER TABLE ONLY public.inventory_transaction ALTER COLUMN inv_trans_id SET DEFAULT nextval('public.inventory_transaction_inv_trans_id_seq'::regclass);
ALTER TABLE ONLY public.invoice ALTER COLUMN invoice_id SET DEFAULT nextval('public.invoice_invoice_id_seq'::regclass);
ALTER TABLE ONLY public.invoice_line ALTER COLUMN invoice_line_id SET DEFAULT nextval('public.invoice_line_invoice_line_id_seq'::regclass);
ALTER TABLE ONLY public.part ALTER COLUMN part_id SET DEFAULT nextval('public.part_part_id_seq'::regclass);
ALTER TABLE ONLY public.part_application ALTER COLUMN part_app_id SET DEFAULT nextval('public.part_application_part_app_id_seq'::regclass);
ALTER TABLE ONLY public.part_number ALTER COLUMN part_number_id SET DEFAULT nextval('public.part_number_part_number_id_seq'::regclass);
ALTER TABLE ONLY public.part_number ALTER COLUMN display_order SET DEFAULT nextval('public.part_number_display_order_seq'::regclass);
ALTER TABLE ONLY public.price_history ALTER COLUMN price_history_id SET DEFAULT nextval('public.price_history_price_history_id_seq'::regclass);
ALTER TABLE ONLY public.supplier ALTER COLUMN supplier_id SET DEFAULT nextval('public.supplier_supplier_id_seq'::regclass);
ALTER TABLE ONLY public.tax_rate ALTER COLUMN tax_rate_id SET DEFAULT nextval('public.tax_rate_tax_rate_id_seq'::regclass);

-- Add Primary Keys and Constraints
ALTER TABLE ONLY public.adjustment_reason ADD CONSTRAINT adjustment_reason_pkey PRIMARY KEY (reason_id);
ALTER TABLE ONLY public.adjustment_reason ADD CONSTRAINT adjustment_reason_reason_text_key UNIQUE (reason_text);
ALTER TABLE ONLY public.application ADD CONSTRAINT application_pkey PRIMARY KEY (application_id);
ALTER TABLE ONLY public.brand ADD CONSTRAINT brand_brand_code_key UNIQUE (brand_code);
ALTER TABLE ONLY public.brand ADD CONSTRAINT brand_brand_name_key UNIQUE (brand_name);
ALTER TABLE ONLY public.brand ADD CONSTRAINT brand_pkey PRIMARY KEY (brand_id);
ALTER TABLE ONLY public.customer ADD CONSTRAINT customer_email_key UNIQUE (email);
ALTER TABLE ONLY public.customer ADD CONSTRAINT customer_pkey PRIMARY KEY (customer_id);
ALTER TABLE ONLY public.customer_type ADD CONSTRAINT customer_type_pkey PRIMARY KEY (customer_type_id);
ALTER TABLE ONLY public.customer_type ADD CONSTRAINT customer_type_type_name_key UNIQUE (type_name);
ALTER TABLE ONLY public.document_sequence ADD CONSTRAINT document_sequence_pkey PRIMARY KEY (prefix, period);
ALTER TABLE ONLY public.employee ADD CONSTRAINT employee_employee_code_key UNIQUE (employee_code);
ALTER TABLE ONLY public.employee ADD CONSTRAINT employee_pkey PRIMARY KEY (employee_id);
ALTER TABLE ONLY public.employee ADD CONSTRAINT employee_username_key UNIQUE (username);
ALTER TABLE ONLY public.event_log ADD CONSTRAINT event_log_pkey PRIMARY KEY (event_log_id);
ALTER TABLE ONLY public.goods_receipt ADD CONSTRAINT goods_receipt_grn_number_key UNIQUE (grn_number);
ALTER TABLE ONLY public.goods_receipt_line ADD CONSTRAINT goods_receipt_line_pkey PRIMARY KEY (grn_line_id);
ALTER TABLE ONLY public.goods_receipt ADD CONSTRAINT goods_receipt_pkey PRIMARY KEY (grn_id);
ALTER TABLE ONLY public."group" ADD CONSTRAINT group_group_code_key UNIQUE (group_code);
ALTER TABLE ONLY public."group" ADD CONSTRAINT group_group_name_key UNIQUE (group_name);
ALTER TABLE ONLY public."group" ADD CONSTRAINT group_pkey PRIMARY KEY (group_id);
ALTER TABLE ONLY public.inventory_transaction ADD CONSTRAINT inventory_transaction_pkey PRIMARY KEY (inv_trans_id);
ALTER TABLE ONLY public.invoice ADD CONSTRAINT invoice_invoice_number_key UNIQUE (invoice_number);
ALTER TABLE ONLY public.invoice_line ADD CONSTRAINT invoice_line_pkey PRIMARY KEY (invoice_line_id);
ALTER TABLE ONLY public.invoice ADD CONSTRAINT invoice_pkey PRIMARY KEY (invoice_id);
ALTER TABLE ONLY public.part_application ADD CONSTRAINT part_application_part_id_application_id_key UNIQUE (part_id, application_id);
ALTER TABLE ONLY public.part_application ADD CONSTRAINT part_application_pkey PRIMARY KEY (part_app_id);
ALTER TABLE ONLY public.part ADD CONSTRAINT part_internal_sku_key UNIQUE (internal_sku);
ALTER TABLE ONLY public.part_number ADD CONSTRAINT part_number_part_id_part_number_key UNIQUE (part_id, part_number);
ALTER TABLE ONLY public.part_number ADD CONSTRAINT part_number_pkey PRIMARY KEY (part_number_id);
ALTER TABLE ONLY public.part ADD CONSTRAINT part_pkey PRIMARY KEY (part_id);
ALTER TABLE ONLY public.permission_level ADD CONSTRAINT permission_level_pkey PRIMARY KEY (permission_level_id);
ALTER TABLE ONLY public.price_history ADD CONSTRAINT price_history_pkey PRIMARY KEY (price_history_id);
ALTER TABLE ONLY public.settings ADD CONSTRAINT settings_pkey PRIMARY KEY (setting_key);
ALTER TABLE ONLY public.supplier ADD CONSTRAINT supplier_pkey PRIMARY KEY (supplier_id);
ALTER TABLE ONLY public.supplier ADD CONSTRAINT supplier_supplier_name_key UNIQUE (supplier_name);
ALTER TABLE ONLY public.tax_rate ADD CONSTRAINT tax_rate_pkey PRIMARY KEY (tax_rate_id);

-- Add Foreign Keys
ALTER TABLE ONLY public.customer ADD CONSTRAINT customer_customer_type_id_fkey FOREIGN KEY (customer_type_id) REFERENCES public.customer_type(customer_type_id) ON DELETE SET NULL;
ALTER TABLE ONLY public.employee ADD CONSTRAINT employee_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.employee(employee_id) ON DELETE SET NULL;
ALTER TABLE ONLY public.employee ADD CONSTRAINT employee_permission_level_id_fkey FOREIGN KEY (permission_level_id) REFERENCES public.permission_level(permission_level_id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.event_log ADD CONSTRAINT event_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.employee(employee_id) ON DELETE SET NULL;
ALTER TABLE ONLY public.goods_receipt_line ADD CONSTRAINT goods_receipt_line_grn_id_fkey FOREIGN KEY (grn_id) REFERENCES public.goods_receipt(grn_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.goods_receipt_line ADD CONSTRAINT goods_receipt_line_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.part(part_id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.goods_receipt ADD CONSTRAINT goods_receipt_received_by_fkey FOREIGN KEY (received_by) REFERENCES public.employee(employee_id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.goods_receipt ADD CONSTRAINT goods_receipt_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.supplier(supplier_id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.inventory_transaction ADD CONSTRAINT inventory_transaction_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employee(employee_id) ON DELETE SET NULL;
ALTER TABLE ONLY public.inventory_transaction ADD CONSTRAINT inventory_transaction_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.part(part_id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.invoice ADD CONSTRAINT invoice_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customer(customer_id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.invoice ADD CONSTRAINT invoice_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employee(employee_id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.invoice_line ADD CONSTRAINT invoice_line_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoice(invoice_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.invoice_line ADD CONSTRAINT invoice_line_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.part(part_id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.part_application ADD CONSTRAINT part_application_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.application(application_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.part_application ADD CONSTRAINT part_application_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.employee(employee_id) ON DELETE SET NULL;
ALTER TABLE ONLY public.part_application ADD CONSTRAINT part_application_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES public.employee(employee_id) ON DELETE SET NULL;
ALTER TABLE ONLY public.part_application ADD CONSTRAINT part_application_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.part(part_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.part ADD CONSTRAINT part_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brand(brand_id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.part ADD CONSTRAINT part_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.employee(employee_id) ON DELETE SET NULL;
ALTER TABLE ONLY public.part ADD CONSTRAINT part_group_id_fkey FOREIGN KEY (group_id) REFERENCES public."group"(group_id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.part ADD CONSTRAINT part_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES public.employee(employee_id) ON DELETE SET NULL;
ALTER TABLE ONLY public.part ADD CONSTRAINT part_tax_rate_id_fkey FOREIGN KEY (tax_rate_id) REFERENCES public.tax_rate(tax_rate_id) ON DELETE SET NULL;
ALTER TABLE ONLY public.part_number ADD CONSTRAINT part_number_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.part(part_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.price_history ADD CONSTRAINT price_history_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.part(part_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.price_history ADD CONSTRAINT price_history_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.employee(employee_id) ON DELETE SET NULL;
ALTER TABLE ONLY public.price_history ADD CONSTRAINT price_history_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.supplier(supplier_id) ON DELETE SET NULL;
ALTER TABLE ONLY public.supplier ADD CONSTRAINT supplier_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.employee(employee_id) ON DELETE SET NULL;
ALTER TABLE ONLY public.supplier ADD CONSTRAINT supplier_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES public.employee(employee_id) ON DELETE SET NULL;

--
-- 👇 START OF SEED DATA SECTION
--

-- Populate the permission_level table with the required roles
INSERT INTO public.permission_level (permission_level_id, level_name) VALUES
(1, 'Clerk'),
(2, 'Parts Man'),
(3, 'Purchaser'),
(5, 'Manager'),
(10, 'Admin');

-- Populate the settings table with default values
INSERT INTO public.settings (setting_key, setting_value, description) VALUES
('COMPANY_NAME', '', 'The official name of the company.'),
('COMPANY_ADDRESS', '', 'The physical address of the company.'),
('COMPANY_PHONE', '', 'The main contact phone number for the company.'),
('COMPANY_EMAIL', '', 'The main contact email for the company.'),
('COMPANY_WEBSITE', '', 'The official company website.'),
('DEFAULT_CURRENCY_SYMBOL', '$', 'The currency symbol to be used on invoices and reports.'),
('DEFAULT_PAYMENT_TERMS', 'Due upon receipt', 'The default payment terms displayed on new invoices.'),
('INVOICE_FOOTER_MESSAGE', 'Thank you for your business!', 'A message to be displayed at the bottom of receipts and invoices.'),
('PAYMENT_METHODS', 'Cash,Credit Card,Bank Transfer,On Account', 'A comma-separated list of accepted payment methods.'),
('DEFAULT_IS_TAX_INCLUSIVE', 'false', 'Sets the default for whether new parts are tax inclusive by default.');

-- Create the default "Walk-in" customer for the POS system
INSERT INTO public.customer (first_name, last_name, is_active) VALUES
('Walk-in', 'Customer', true);

--
-- 👆 END OF SEED DATA SECTION
--
