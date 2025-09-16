--
-- PostgreSQL database dump
--

-- Dumped from database version 15.13
-- Dumped by pg_dump version 15.13

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

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: notify_meili_sync(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.notify_meili_sync() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  payload json;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    payload = json_build_object('action', 'delete', 'part_id', OLD.part_id);
    PERFORM pg_notify('meili_sync', payload::text);
    RETURN OLD;
  ELSE
    -- INSERT or UPDATE
    payload = json_build_object('action', 'upsert', 'part_id', NEW.part_id);
    PERFORM pg_notify('meili_sync', payload::text);
    RETURN NEW;
  END IF;
END;
$$;


ALTER FUNCTION public.notify_meili_sync() OWNER TO postgres;

--
-- Name: notify_meili_upsert_for_part(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.notify_meili_upsert_for_part(p_part_id integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF p_part_id IS NOT NULL THEN
    PERFORM pg_notify('meili_sync', json_build_object('action','upsert','part_id',p_part_id)::text);
  END IF;
END;
$$;


ALTER FUNCTION public.notify_meili_upsert_for_part(p_part_id integer) OWNER TO postgres;

--
-- Name: prevent_customer_payment_direct_insert(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.prevent_customer_payment_direct_insert() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
BEGIN
    -- Allow inserts only from legacy invoice creation (single payments)
    -- This is identified by having a reference_number that matches invoice pattern
    IF NEW.reference_number IS NULL OR NOT (NEW.reference_number ~ '^INV-\d{6}-\d+$') THEN
        RAISE WARNING 'Direct inserts into customer_payment are deprecated. Use invoice_payments for new payments and payments_unified for queries.';
    END IF;
    
    RETURN NEW;
END;
$_$;


ALTER FUNCTION public.prevent_customer_payment_direct_insert() OWNER TO postgres;

--
-- Name: trg_application_notify(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.trg_application_notify() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT part_id FROM part_application WHERE application_id = COALESCE(NEW.application_id, OLD.application_id) LOOP
    PERFORM notify_meili_upsert_for_part(r.part_id);
  END LOOP;
  -- Also notify applications index to refresh this application doc
  PERFORM pg_notify('meili_app_sync', json_build_object('action', CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END, 'application_id', COALESCE(NEW.application_id, OLD.application_id))::text);
  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION public.trg_application_notify() OWNER TO postgres;

--
-- Name: trg_brand_notify(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.trg_brand_notify() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT part_id FROM part WHERE brand_id = COALESCE(NEW.brand_id, OLD.brand_id) LOOP
    PERFORM notify_meili_upsert_for_part(r.part_id);
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION public.trg_brand_notify() OWNER TO postgres;

--
-- Name: trg_group_notify(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.trg_group_notify() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT part_id FROM part WHERE group_id = COALESCE(NEW.group_id, OLD.group_id) LOOP
    PERFORM notify_meili_upsert_for_part(r.part_id);
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION public.trg_group_notify() OWNER TO postgres;

--
-- Name: trg_part_application_notify(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.trg_part_application_notify() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM notify_meili_upsert_for_part(COALESCE(NEW.part_id, OLD.part_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION public.trg_part_application_notify() OWNER TO postgres;

--
-- Name: trg_part_number_notify(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.trg_part_number_notify() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM notify_meili_upsert_for_part(COALESCE(NEW.part_id, OLD.part_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION public.trg_part_number_notify() OWNER TO postgres;

--
-- Name: trg_part_tag_notify(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.trg_part_tag_notify() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM notify_meili_upsert_for_part(COALESCE(NEW.part_id, OLD.part_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION public.trg_part_tag_notify() OWNER TO postgres;

--
-- Name: trg_tag_notify(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.trg_tag_notify() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT part_id FROM part_tag WHERE tag_id = COALESCE(NEW.tag_id, OLD.tag_id) LOOP
    PERFORM notify_meili_upsert_for_part(r.part_id);
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION public.trg_tag_notify() OWNER TO postgres;

--
-- Name: update_invoice_balance_after_payment(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_invoice_balance_after_payment() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    total_settled numeric(12,2);
    total_refunded numeric(12,2);
    invoice_total numeric(12,2);
    net_amount numeric(12,2);
BEGIN
    -- Get the invoice total, settled payments, and refunds
    SELECT 
        i.total_amount,
        COALESCE(SUM(CASE WHEN ip.payment_status = 'settled' THEN ip.amount_paid ELSE 0 END), 0),
        COALESCE(SUM(cn.total_amount), 0)
    INTO invoice_total, total_settled, total_refunded
    FROM invoice i
    LEFT JOIN invoice_payments ip ON i.invoice_id = ip.invoice_id
    LEFT JOIN credit_note cn ON i.invoice_id = cn.invoice_id
    WHERE i.invoice_id = COALESCE(NEW.invoice_id, OLD.invoice_id)
    GROUP BY i.invoice_id, i.total_amount;
    
    -- Calculate net amount after refunds
    net_amount := GREATEST(invoice_total - total_refunded, 0);
    
    -- Update the invoice with only settled payments counting toward amount_paid
    UPDATE invoice 
    SET 
        amount_paid = total_settled,
        status = CASE 
            WHEN total_settled >= net_amount AND net_amount > 0 THEN 'Paid'
            WHEN total_refunded >= invoice_total THEN 'Fully Refunded'
            WHEN total_refunded > 0 AND total_settled >= (net_amount) THEN 'Partially Refunded'
            WHEN total_refunded > 0 THEN 'Partially Refunded'
            WHEN total_settled > 0 THEN 'Partially Paid'
            ELSE 'Unpaid'
        END
    WHERE invoice_id = COALESCE(NEW.invoice_id, OLD.invoice_id);
    
    RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION public.update_invoice_balance_after_payment() OWNER TO postgres;

--
-- Name: update_wac_on_inventory_transaction(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_wac_on_inventory_transaction() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    prev_stock NUMERIC;
    current_wac NUMERIC;
    new_quantity NUMERIC := NEW.quantity;
    new_cost NUMERIC := COALESCE(NEW.unit_cost, 0);
    new_wac NUMERIC;
    sale_price_from_grn NUMERIC;
BEGIN
    -- Calculate previous stock excluding the newly inserted transaction
    SELECT COALESCE(SUM(quantity), 0)
    INTO prev_stock
    FROM public.inventory_transaction
    WHERE part_id = NEW.part_id
      AND inv_trans_id <> NEW.inv_trans_id;

    SELECT COALESCE(wac_cost, 0)
    INTO current_wac
    FROM public.part p
    WHERE p.part_id = NEW.part_id;

    IF (prev_stock + new_quantity) > 0 THEN
        new_wac := ((prev_stock * current_wac) + (new_quantity * new_cost)) / (prev_stock + new_quantity);
    ELSE
        new_wac := new_cost;
    END IF;

    -- Update WAC and last_cost
    UPDATE public.part
    SET
        wac_cost = new_wac,
        last_cost = new_cost,
        last_cost_date = CURRENT_TIMESTAMP
    WHERE part_id = NEW.part_id;

    -- If this is a StockIn transaction from GRN, also update last_sale_price
    IF NEW.trans_type = 'StockIn' AND NEW.reference_no LIKE 'GRN%' THEN
        -- Find the sale_price from goods_receipt_line for this part and GRN
        SELECT grl.sale_price
        INTO sale_price_from_grn
        FROM public.goods_receipt_line grl
        JOIN public.goods_receipt gr ON gr.grn_id = grl.grn_id
        WHERE gr.grn_number = NEW.reference_no
          AND grl.part_id = NEW.part_id
        LIMIT 1;

        -- Update last_sale_price if we found a sale_price
        IF sale_price_from_grn IS NOT NULL THEN
            UPDATE public.part
            SET
                last_sale_price = sale_price_from_grn,
                last_sale_price_date = CURRENT_TIMESTAMP
            WHERE part_id = NEW.part_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_wac_on_inventory_transaction() OWNER TO postgres;

--
-- Name: validate_invoice_payment_trigger(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.validate_invoice_payment_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    PERFORM validate_payment_constraints(
        NEW.method_id,
        NEW.reference,
        NEW.tendered_amount,
        NEW.amount_paid
    );
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.validate_invoice_payment_trigger() OWNER TO postgres;

--
-- Name: validate_payment_constraints(integer, text, numeric, numeric); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.validate_payment_constraints(p_method_id integer, p_reference text, p_tendered_amount numeric, p_amount_paid numeric) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
    method_config jsonb;
    requires_ref boolean;
    change_allowed boolean;
BEGIN
    -- Get method configuration
    SELECT config INTO method_config 
    FROM payment_methods 
    WHERE method_id = p_method_id AND enabled = true;
    
    IF method_config IS NULL THEN
        RAISE EXCEPTION 'Invalid or disabled payment method: %', p_method_id;
    END IF;
    
    -- Check reference requirement
    requires_ref := COALESCE((method_config->>'requires_reference')::boolean, false);
    IF requires_ref AND (p_reference IS NULL OR trim(p_reference) = '') THEN
        RAISE EXCEPTION 'Reference is required for this payment method';
    END IF;
    
    -- Check change allowance
    change_allowed := COALESCE((method_config->>'change_allowed')::boolean, true);
    IF NOT change_allowed AND p_tendered_amount > p_amount_paid THEN
        RAISE EXCEPTION 'Change is not allowed for this payment method';
    END IF;
    
    RETURN true;
END;
$$;


ALTER FUNCTION public.validate_payment_constraints(p_method_id integer, p_reference text, p_tendered_amount numeric, p_amount_paid numeric) OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: application; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.application (
    application_id integer NOT NULL,
    make_id integer,
    model_id integer,
    engine_id integer
);


ALTER TABLE public.application OWNER TO postgres;

--
-- Name: application_application_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.application_application_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.application_application_id_seq OWNER TO postgres;

--
-- Name: application_application_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.application_application_id_seq OWNED BY public.application.application_id;


--
-- Name: vehicle_engine; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vehicle_engine (
    engine_id integer NOT NULL,
    model_id integer,
    engine_name character varying(100)
);


ALTER TABLE public.vehicle_engine OWNER TO postgres;

--
-- Name: vehicle_make; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vehicle_make (
    make_id integer NOT NULL,
    make_name character varying(100) NOT NULL
);


ALTER TABLE public.vehicle_make OWNER TO postgres;

--
-- Name: vehicle_model; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vehicle_model (
    model_id integer NOT NULL,
    make_id integer NOT NULL,
    model_name character varying(100) NOT NULL
);


ALTER TABLE public.vehicle_model OWNER TO postgres;

--
-- Name: application_view; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.application_view AS
 SELECT a.application_id,
    a.make_id,
    a.model_id,
    a.engine_id,
    vmk.make_name AS make,
    vmd.model_name AS model,
    veng.engine_name AS engine
   FROM (((public.application a
     LEFT JOIN public.vehicle_make vmk ON ((a.make_id = vmk.make_id)))
     LEFT JOIN public.vehicle_model vmd ON ((a.model_id = vmd.model_id)))
     LEFT JOIN public.vehicle_engine veng ON ((a.engine_id = veng.engine_id)));


ALTER TABLE public.application_view OWNER TO postgres;

--
-- Name: brand; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.brand (
    brand_id integer NOT NULL,
    brand_name character varying(100) NOT NULL,
    brand_code character varying(10) NOT NULL
);


ALTER TABLE public.brand OWNER TO postgres;

--
-- Name: brand_brand_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.brand_brand_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.brand_brand_id_seq OWNER TO postgres;

--
-- Name: brand_brand_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.brand_brand_id_seq OWNED BY public.brand.brand_id;


--
-- Name: credit_note; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.credit_note (
    cn_id integer NOT NULL,
    cn_number character varying(50) NOT NULL,
    invoice_id integer NOT NULL,
    employee_id integer NOT NULL,
    refund_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    total_amount numeric(12,2) NOT NULL,
    notes text
);


ALTER TABLE public.credit_note OWNER TO postgres;

--
-- Name: credit_note_cn_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.credit_note_cn_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.credit_note_cn_id_seq OWNER TO postgres;

--
-- Name: credit_note_cn_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.credit_note_cn_id_seq OWNED BY public.credit_note.cn_id;


--
-- Name: credit_note_line; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.credit_note_line (
    cn_line_id integer NOT NULL,
    cn_id integer NOT NULL,
    part_id integer NOT NULL,
    quantity numeric(12,4) NOT NULL,
    sale_price numeric(12,2) NOT NULL
);


ALTER TABLE public.credit_note_line OWNER TO postgres;

--
-- Name: credit_note_line_cn_line_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.credit_note_line_cn_line_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.credit_note_line_cn_line_id_seq OWNER TO postgres;

--
-- Name: credit_note_line_cn_line_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.credit_note_line_cn_line_id_seq OWNED BY public.credit_note_line.cn_line_id;


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
    is_active boolean DEFAULT true,
    date_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.customer OWNER TO postgres;

--
-- Name: customer_customer_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.customer_customer_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.customer_customer_id_seq OWNER TO postgres;

--
-- Name: customer_customer_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.customer_customer_id_seq OWNED BY public.customer.customer_id;


--
-- Name: customer_payment; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.customer_payment (
    payment_id integer NOT NULL,
    customer_id integer NOT NULL,
    employee_id integer NOT NULL,
    payment_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    amount numeric(12,2) NOT NULL,
    tendered_amount numeric(12,2),
    payment_method character varying(50),
    reference_number character varying(100) NOT NULL,
    notes text,
    method_id integer
);


ALTER TABLE public.customer_payment OWNER TO postgres;

--
-- Name: TABLE customer_payment; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.customer_payment IS 'DEPRECATED: This table is deprecated as of 2025-09-13. Use the payments_unified view instead. This table is maintained for legacy single-payment invoices only.';


--
-- Name: COLUMN customer_payment.payment_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.customer_payment.payment_id IS 'DEPRECATED: Use payments_unified.payment_id instead';


--
-- Name: COLUMN customer_payment.amount; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.customer_payment.amount IS 'DEPRECATED: Use payments_unified.amount_paid instead';


--
-- Name: COLUMN customer_payment.payment_method; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.customer_payment.payment_method IS 'DEPRECATED: Use payments_unified.method_name instead';


--
-- Name: customer_payment_payment_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.customer_payment_payment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.customer_payment_payment_id_seq OWNER TO postgres;

--
-- Name: customer_payment_payment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.customer_payment_payment_id_seq OWNED BY public.customer_payment.payment_id;


--
-- Name: customer_tag; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.customer_tag (
    customer_id integer NOT NULL,
    tag_id integer NOT NULL
);


ALTER TABLE public.customer_tag OWNER TO postgres;

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
-- Name: documents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_type character varying(50),
    reference_id character varying(100),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    file_path text,
    metadata jsonb
);


ALTER TABLE public.documents OWNER TO postgres;

--
-- Name: draft_transaction; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.draft_transaction (
    draft_id integer NOT NULL,
    employee_id integer NOT NULL,
    transaction_type character varying(20) NOT NULL,
    draft_data jsonb NOT NULL,
    last_updated timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.draft_transaction OWNER TO postgres;

--
-- Name: draft_transaction_draft_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.draft_transaction_draft_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.draft_transaction_draft_id_seq OWNER TO postgres;

--
-- Name: draft_transaction_draft_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.draft_transaction_draft_id_seq OWNED BY public.draft_transaction.draft_id;


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

--
-- Name: employee_employee_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.employee_employee_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.employee_employee_id_seq OWNER TO postgres;

--
-- Name: employee_employee_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.employee_employee_id_seq OWNED BY public.employee.employee_id;


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

--
-- Name: goods_receipt_grn_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.goods_receipt_grn_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.goods_receipt_grn_id_seq OWNER TO postgres;

--
-- Name: goods_receipt_grn_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.goods_receipt_grn_id_seq OWNED BY public.goods_receipt.grn_id;


--
-- Name: goods_receipt_line; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.goods_receipt_line (
    grn_line_id integer NOT NULL,
    grn_id integer NOT NULL,
    part_id integer NOT NULL,
    quantity numeric(12,4) NOT NULL,
    cost_price numeric(12,2) NOT NULL,
    sale_price numeric(12,2)
);


ALTER TABLE public.goods_receipt_line OWNER TO postgres;

--
-- Name: goods_receipt_line_grn_line_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.goods_receipt_line_grn_line_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.goods_receipt_line_grn_line_id_seq OWNER TO postgres;

--
-- Name: goods_receipt_line_grn_line_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

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

--
-- Name: group_group_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.group_group_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.group_group_id_seq OWNER TO postgres;

--
-- Name: group_group_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

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
    notes text
);


ALTER TABLE public.inventory_transaction OWNER TO postgres;

--
-- Name: inventory_transaction_inv_trans_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.inventory_transaction_inv_trans_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.inventory_transaction_inv_trans_id_seq OWNER TO postgres;

--
-- Name: inventory_transaction_inv_trans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

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
    status character varying(20) DEFAULT 'Unpaid'::character varying,
    terms text,
    payment_terms_days integer,
    due_date timestamp with time zone,
    physical_receipt_no character varying(50),
    CONSTRAINT check_invoice_status CHECK (((status)::text = ANY ((ARRAY['Unpaid'::character varying, 'Paid'::character varying, 'Partially Paid'::character varying, 'Partially Refunded'::character varying, 'Fully Refunded'::character varying, 'Cancelled'::character varying])::text[])))
);


ALTER TABLE public.invoice OWNER TO postgres;

--
-- Name: invoice_invoice_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.invoice_invoice_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.invoice_invoice_id_seq OWNER TO postgres;

--
-- Name: invoice_invoice_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

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
    cost_at_sale numeric(12,2),
    discount_amount numeric(12,2) DEFAULT 0.00
);


ALTER TABLE public.invoice_line OWNER TO postgres;

--
-- Name: invoice_line_invoice_line_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.invoice_line_invoice_line_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.invoice_line_invoice_line_id_seq OWNER TO postgres;

--
-- Name: invoice_line_invoice_line_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.invoice_line_invoice_line_id_seq OWNED BY public.invoice_line.invoice_line_id;


--
-- Name: invoice_payment_allocation; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invoice_payment_allocation (
    allocation_id integer NOT NULL,
    invoice_id integer NOT NULL,
    payment_id integer NOT NULL,
    amount_allocated numeric(12,2) NOT NULL
);


ALTER TABLE public.invoice_payment_allocation OWNER TO postgres;

--
-- Name: invoice_payment_allocation_allocation_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.invoice_payment_allocation_allocation_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.invoice_payment_allocation_allocation_id_seq OWNER TO postgres;

--
-- Name: invoice_payment_allocation_allocation_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.invoice_payment_allocation_allocation_id_seq OWNED BY public.invoice_payment_allocation.allocation_id;


--
-- Name: invoice_payments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invoice_payments (
    payment_id integer NOT NULL,
    invoice_id integer NOT NULL,
    method_id integer NOT NULL,
    amount_paid numeric(12,2) NOT NULL,
    tendered_amount numeric(12,2),
    change_amount numeric(12,2) DEFAULT 0.00 NOT NULL,
    reference character varying(200),
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by integer,
    payment_status character varying(20) DEFAULT 'settled'::character varying NOT NULL,
    settled_at timestamp with time zone,
    settlement_reference character varying(200),
    attempt_metadata jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT chk_change_calculation CHECK ((((tendered_amount IS NULL) AND (change_amount = (0)::numeric)) OR ((tendered_amount IS NOT NULL) AND (change_amount = (tendered_amount - amount_paid))))),
    CONSTRAINT chk_payment_status CHECK (((payment_status)::text = ANY ((ARRAY['settled'::character varying, 'pending'::character varying, 'on_account'::character varying])::text[]))),
    CONSTRAINT invoice_payments_amount_paid_check CHECK ((amount_paid > (0)::numeric)),
    CONSTRAINT invoice_payments_change_amount_check CHECK ((change_amount >= (0)::numeric)),
    CONSTRAINT invoice_payments_check CHECK (((tendered_amount IS NULL) OR (tendered_amount >= amount_paid)))
);


ALTER TABLE public.invoice_payments OWNER TO postgres;

--
-- Name: COLUMN invoice_payments.payment_status; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.invoice_payments.payment_status IS 'Payment status: settled (funds received), pending (awaiting settlement), on_account (AR charge)';


--
-- Name: COLUMN invoice_payments.settled_at; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.invoice_payments.settled_at IS 'Timestamp when payment was marked as settled/confirmed';


--
-- Name: invoice_payments_payment_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.invoice_payments_payment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.invoice_payments_payment_id_seq OWNER TO postgres;

--
-- Name: invoice_payments_payment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.invoice_payments_payment_id_seq OWNED BY public.invoice_payments.payment_id;


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
    wac_cost numeric(12,2) DEFAULT 0.00,
    last_sale_price numeric(12,2) DEFAULT 0.00,
    last_cost_date timestamp with time zone,
    last_sale_price_date timestamp with time zone,
    reorder_point integer DEFAULT 0,
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
    modified_by integer,
    merged_into_part_id bigint
);


ALTER TABLE public.part OWNER TO postgres;

--
-- Name: COLUMN part.merged_into_part_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.part.merged_into_part_id IS 'If not null, this part has been merged into the referenced part and should be considered inactive';


--
-- Name: part_aliases; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.part_aliases (
    id bigint NOT NULL,
    part_id bigint NOT NULL,
    alias_value character varying(255) NOT NULL,
    alias_type character varying(50) NOT NULL,
    source_part_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT part_aliases_alias_type_check CHECK (((alias_type)::text = ANY ((ARRAY['sku'::character varying, 'part_number'::character varying, 'display_name'::character varying])::text[])))
);


ALTER TABLE public.part_aliases OWNER TO postgres;

--
-- Name: TABLE part_aliases; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.part_aliases IS 'Preserves old SKUs, part numbers, and names from merged parts for searchability';


--
-- Name: COLUMN part_aliases.alias_value; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.part_aliases.alias_value IS 'The old value that should redirect to the canonical part';


--
-- Name: COLUMN part_aliases.alias_type; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.part_aliases.alias_type IS 'Type of alias: sku, part_number, or display_name';


--
-- Name: COLUMN part_aliases.source_part_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.part_aliases.source_part_id IS 'The original part that this alias came from (before merge)';


--
-- Name: part_aliases_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.part_aliases_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.part_aliases_id_seq OWNER TO postgres;

--
-- Name: part_aliases_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.part_aliases_id_seq OWNED BY public.part_aliases.id;


--
-- Name: part_application; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.part_application (
    part_app_id integer NOT NULL,
    part_id integer NOT NULL,
    application_id integer NOT NULL,
    year_start integer,
    year_end integer
);


ALTER TABLE public.part_application OWNER TO postgres;

--
-- Name: part_application_part_app_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.part_application_part_app_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.part_application_part_app_id_seq OWNER TO postgres;

--
-- Name: part_application_part_app_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.part_application_part_app_id_seq OWNED BY public.part_application.part_app_id;


--
-- Name: part_merge_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.part_merge_log (
    id bigint NOT NULL,
    merged_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_employee_id bigint NOT NULL,
    keep_part_id bigint NOT NULL,
    merged_part_id bigint NOT NULL,
    field_overrides jsonb,
    merge_rules jsonb NOT NULL,
    updated_counts jsonb NOT NULL,
    warnings jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.part_merge_log OWNER TO postgres;

--
-- Name: TABLE part_merge_log; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.part_merge_log IS 'Audit trail of part merge operations';


--
-- Name: COLUMN part_merge_log.field_overrides; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.part_merge_log.field_overrides IS 'JSON object of field-level choices made during merge';


--
-- Name: COLUMN part_merge_log.merge_rules; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.part_merge_log.merge_rules IS 'JSON object of merge rules applied (merge_numbers, merge_applications, etc.)';


--
-- Name: COLUMN part_merge_log.updated_counts; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.part_merge_log.updated_counts IS 'JSON object with counts of updated records by table';


--
-- Name: COLUMN part_merge_log.warnings; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.part_merge_log.warnings IS 'JSON array of warnings generated during merge';


--
-- Name: part_merge_log_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.part_merge_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.part_merge_log_id_seq OWNER TO postgres;

--
-- Name: part_merge_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.part_merge_log_id_seq OWNED BY public.part_merge_log.id;


--
-- Name: part_number; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.part_number (
    part_number_id integer NOT NULL,
    part_id integer NOT NULL,
    part_number character varying(100) NOT NULL,
    number_type character varying(50),
    display_order integer,
    deleted_at timestamp with time zone,
    deleted_by integer
);


ALTER TABLE public.part_number OWNER TO postgres;

--
-- Name: COLUMN part_number.deleted_at; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.part_number.deleted_at IS 'Timestamp when alias was soft-deleted (NULL = active)';


--
-- Name: COLUMN part_number.deleted_by; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.part_number.deleted_by IS 'Employee who removed the alias';


--
-- Name: part_number_part_number_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.part_number_part_number_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.part_number_part_number_id_seq OWNER TO postgres;

--
-- Name: part_number_part_number_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.part_number_part_number_id_seq OWNED BY public.part_number.part_number_id;


--
-- Name: part_part_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.part_part_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.part_part_id_seq OWNER TO postgres;

--
-- Name: part_part_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.part_part_id_seq OWNED BY public.part.part_id;


--
-- Name: part_tag; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.part_tag (
    part_id integer NOT NULL,
    tag_id integer NOT NULL
);


ALTER TABLE public.part_tag OWNER TO postgres;

--
-- Name: parts_view; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.parts_view AS
 SELECT p.part_id,
    p.internal_sku,
    p.detail,
    p.brand_id,
    p.group_id,
    p.barcode,
    p.is_active,
    p.last_cost,
    p.wac_cost,
    p.last_sale_price,
    p.merged_into_part_id,
    p.date_created,
    p.date_modified,
    b.brand_name,
    g.group_name,
    string_agg((pn.part_number)::text, '; '::text ORDER BY pn.display_order) AS part_numbers,
    concat_ws(' | '::text,
        CASE
            WHEN ((g.group_name IS NOT NULL) OR (b.brand_name IS NOT NULL)) THEN TRIM(BOTH FROM replace(((((g.group_name)::text || ' ('::text) || (b.brand_name)::text) || ')'::text), '()'::text, ''::text))
            ELSE NULL::text
        END, string_agg((pn.part_number)::text, '; '::text ORDER BY pn.display_order), p.detail) AS display_name,
    p.date_created AS created_at,
    p.date_modified AS modified_at,
    ''::text AS tags
   FROM (((public.part p
     LEFT JOIN public.brand b ON ((p.brand_id = b.brand_id)))
     LEFT JOIN public."group" g ON ((p.group_id = g.group_id)))
     LEFT JOIN public.part_number pn ON (((p.part_id = pn.part_id) AND (pn.deleted_at IS NULL))))
  GROUP BY p.part_id, p.internal_sku, p.detail, p.brand_id, p.group_id, p.barcode, p.is_active, p.last_cost, p.wac_cost, p.last_sale_price, p.merged_into_part_id, p.date_created, p.date_modified, b.brand_name, g.group_name;


ALTER TABLE public.parts_view OWNER TO postgres;

--
-- Name: payment_methods; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payment_methods (
    method_id integer NOT NULL,
    code character varying(50) NOT NULL,
    name character varying(100) NOT NULL,
    type character varying(20) DEFAULT 'other'::character varying NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by integer,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_by integer,
    settlement_type character varying(20) DEFAULT 'instant'::character varying NOT NULL,
    CONSTRAINT chk_payment_method_type CHECK (((type)::text = ANY ((ARRAY['cash'::character varying, 'card'::character varying, 'bank'::character varying, 'mobile'::character varying, 'credit'::character varying, 'voucher'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT payment_methods_settlement_type_check CHECK (((settlement_type)::text = ANY ((ARRAY['instant'::character varying, 'delayed'::character varying, 'on_account'::character varying])::text[])))
);


ALTER TABLE public.payment_methods OWNER TO postgres;

--
-- Name: COLUMN payment_methods.settlement_type; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.payment_methods.settlement_type IS 'Defines when payment is considered settled: instant (immediately), delayed (pending settlement), on_account (no payment - invoice remains due)';


--
-- Name: payment_methods_method_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.payment_methods_method_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.payment_methods_method_id_seq OWNER TO postgres;

--
-- Name: payment_methods_method_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.payment_methods_method_id_seq OWNED BY public.payment_methods.method_id;


--
-- Name: payment_term; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payment_term (
    payment_term_id integer NOT NULL,
    term_name text NOT NULL,
    days_to_due integer NOT NULL
);


ALTER TABLE public.payment_term OWNER TO postgres;

--
-- Name: payment_term_payment_term_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.payment_term_payment_term_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.payment_term_payment_term_id_seq OWNER TO postgres;

--
-- Name: payment_term_payment_term_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.payment_term_payment_term_id_seq OWNED BY public.payment_term.payment_term_id;


--
-- Name: payments_unified; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.payments_unified AS
 SELECT 'customer_payment'::text AS source_table,
    cp.payment_id,
    NULL::integer AS invoice_id,
    cp.customer_id,
    cp.employee_id,
    cp.payment_date AS created_at,
    cp.amount AS amount_paid,
    cp.tendered_amount,
    COALESCE((cp.tendered_amount - cp.amount), (0)::numeric) AS change_amount,
    cp.payment_method AS legacy_method,
    cp.method_id,
    pm.code AS method_code,
    pm.name AS method_name,
    pm.type AS method_type,
    pm.config AS method_config,
    cp.reference_number AS reference,
    jsonb_build_object('notes', cp.notes) AS metadata,
    'settled'::character varying AS payment_status,
    cp.payment_date AS settled_at,
    NULL::character varying AS settlement_reference,
    '{}'::jsonb AS attempt_metadata
   FROM (public.customer_payment cp
     LEFT JOIN public.payment_methods pm ON ((cp.method_id = pm.method_id)))
UNION ALL
 SELECT 'invoice_payments'::text AS source_table,
    ip.payment_id,
    ip.invoice_id,
    i.customer_id,
    ip.created_by AS employee_id,
    ip.created_at,
    ip.amount_paid,
    ip.tendered_amount,
    ip.change_amount,
    NULL::character varying AS legacy_method,
    ip.method_id,
    pm.code AS method_code,
    pm.name AS method_name,
    pm.type AS method_type,
    pm.config AS method_config,
    ip.reference,
    ip.metadata,
    COALESCE(ip.payment_status, 'settled'::character varying) AS payment_status,
    ip.settled_at,
    ip.settlement_reference,
    ip.attempt_metadata
   FROM ((public.invoice_payments ip
     JOIN public.invoice i ON ((ip.invoice_id = i.invoice_id)))
     JOIN public.payment_methods pm ON ((ip.method_id = pm.method_id)));


ALTER TABLE public.payments_unified OWNER TO postgres;

--
-- Name: permission; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.permission (
    permission_id integer NOT NULL,
    permission_key character varying(100) NOT NULL,
    description text,
    category character varying(50)
);


ALTER TABLE public.permission OWNER TO postgres;

--
-- Name: permission_level; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.permission_level (
    permission_level_id integer NOT NULL,
    level_name character varying(50) NOT NULL
);


ALTER TABLE public.permission_level OWNER TO postgres;

--
-- Name: permission_level_permission_level_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.permission_level_permission_level_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.permission_level_permission_level_id_seq OWNER TO postgres;

--
-- Name: permission_level_permission_level_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.permission_level_permission_level_id_seq OWNED BY public.permission_level.permission_level_id;


--
-- Name: permission_permission_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.permission_permission_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.permission_permission_id_seq OWNER TO postgres;

--
-- Name: permission_permission_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.permission_permission_id_seq OWNED BY public.permission.permission_id;


--
-- Name: purchase_order; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.purchase_order (
    po_id integer NOT NULL,
    po_number character varying(50) NOT NULL,
    supplier_id integer NOT NULL,
    employee_id integer NOT NULL,
    order_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    expected_date timestamp with time zone,
    total_amount numeric(12,2) NOT NULL,
    status character varying(20) DEFAULT 'Pending'::character varying,
    notes text
);


ALTER TABLE public.purchase_order OWNER TO postgres;

--
-- Name: purchase_order_line; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.purchase_order_line (
    po_line_id integer NOT NULL,
    po_id integer NOT NULL,
    part_id integer NOT NULL,
    quantity numeric(12,4) NOT NULL,
    cost_price numeric(12,2) NOT NULL,
    quantity_received numeric(12,4) DEFAULT 0
);


ALTER TABLE public.purchase_order_line OWNER TO postgres;

--
-- Name: purchase_order_line_po_line_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.purchase_order_line_po_line_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.purchase_order_line_po_line_id_seq OWNER TO postgres;

--
-- Name: purchase_order_line_po_line_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.purchase_order_line_po_line_id_seq OWNED BY public.purchase_order_line.po_line_id;


--
-- Name: purchase_order_po_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.purchase_order_po_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.purchase_order_po_id_seq OWNER TO postgres;

--
-- Name: purchase_order_po_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.purchase_order_po_id_seq OWNED BY public.purchase_order.po_id;


--
-- Name: role_permission; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.role_permission (
    permission_level_id integer NOT NULL,
    permission_id integer NOT NULL
);


ALTER TABLE public.role_permission OWNER TO postgres;

--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.schema_migrations (
    filename text NOT NULL,
    checksum text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    duration_ms integer NOT NULL
);


ALTER TABLE public.schema_migrations OWNER TO postgres;

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
    is_active boolean DEFAULT true,
    date_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by integer,
    date_modified timestamp with time zone,
    modified_by integer
);


ALTER TABLE public.supplier OWNER TO postgres;

--
-- Name: supplier_supplier_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.supplier_supplier_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.supplier_supplier_id_seq OWNER TO postgres;

--
-- Name: supplier_supplier_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.supplier_supplier_id_seq OWNED BY public.supplier.supplier_id;


--
-- Name: tag; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tag (
    tag_id integer NOT NULL,
    tag_name character varying(50) NOT NULL
);


ALTER TABLE public.tag OWNER TO postgres;

--
-- Name: tag_tag_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.tag_tag_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.tag_tag_id_seq OWNER TO postgres;

--
-- Name: tag_tag_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.tag_tag_id_seq OWNED BY public.tag.tag_id;


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

--
-- Name: tax_rate_tax_rate_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.tax_rate_tax_rate_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.tax_rate_tax_rate_id_seq OWNER TO postgres;

--
-- Name: tax_rate_tax_rate_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.tax_rate_tax_rate_id_seq OWNED BY public.tax_rate.tax_rate_id;


--
-- Name: vehicle_engine_engine_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.vehicle_engine_engine_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.vehicle_engine_engine_id_seq OWNER TO postgres;

--
-- Name: vehicle_engine_engine_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.vehicle_engine_engine_id_seq OWNED BY public.vehicle_engine.engine_id;


--
-- Name: vehicle_make_make_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.vehicle_make_make_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.vehicle_make_make_id_seq OWNER TO postgres;

--
-- Name: vehicle_make_make_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.vehicle_make_make_id_seq OWNED BY public.vehicle_make.make_id;


--
-- Name: vehicle_model_model_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.vehicle_model_model_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.vehicle_model_model_id_seq OWNER TO postgres;

--
-- Name: vehicle_model_model_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.vehicle_model_model_id_seq OWNED BY public.vehicle_model.model_id;


--
-- Name: application application_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.application ALTER COLUMN application_id SET DEFAULT nextval('public.application_application_id_seq'::regclass);


--
-- Name: brand brand_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.brand ALTER COLUMN brand_id SET DEFAULT nextval('public.brand_brand_id_seq'::regclass);


--
-- Name: credit_note cn_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.credit_note ALTER COLUMN cn_id SET DEFAULT nextval('public.credit_note_cn_id_seq'::regclass);


--
-- Name: credit_note_line cn_line_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.credit_note_line ALTER COLUMN cn_line_id SET DEFAULT nextval('public.credit_note_line_cn_line_id_seq'::regclass);


--
-- Name: customer customer_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer ALTER COLUMN customer_id SET DEFAULT nextval('public.customer_customer_id_seq'::regclass);


--
-- Name: customer_payment payment_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_payment ALTER COLUMN payment_id SET DEFAULT nextval('public.customer_payment_payment_id_seq'::regclass);


--
-- Name: draft_transaction draft_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.draft_transaction ALTER COLUMN draft_id SET DEFAULT nextval('public.draft_transaction_draft_id_seq'::regclass);


--
-- Name: employee employee_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee ALTER COLUMN employee_id SET DEFAULT nextval('public.employee_employee_id_seq'::regclass);


--
-- Name: goods_receipt grn_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goods_receipt ALTER COLUMN grn_id SET DEFAULT nextval('public.goods_receipt_grn_id_seq'::regclass);


--
-- Name: goods_receipt_line grn_line_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goods_receipt_line ALTER COLUMN grn_line_id SET DEFAULT nextval('public.goods_receipt_line_grn_line_id_seq'::regclass);


--
-- Name: group group_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."group" ALTER COLUMN group_id SET DEFAULT nextval('public.group_group_id_seq'::regclass);


--
-- Name: inventory_transaction inv_trans_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_transaction ALTER COLUMN inv_trans_id SET DEFAULT nextval('public.inventory_transaction_inv_trans_id_seq'::regclass);


--
-- Name: invoice invoice_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice ALTER COLUMN invoice_id SET DEFAULT nextval('public.invoice_invoice_id_seq'::regclass);


--
-- Name: invoice_line invoice_line_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_line ALTER COLUMN invoice_line_id SET DEFAULT nextval('public.invoice_line_invoice_line_id_seq'::regclass);


--
-- Name: invoice_payment_allocation allocation_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_payment_allocation ALTER COLUMN allocation_id SET DEFAULT nextval('public.invoice_payment_allocation_allocation_id_seq'::regclass);


--
-- Name: invoice_payments payment_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_payments ALTER COLUMN payment_id SET DEFAULT nextval('public.invoice_payments_payment_id_seq'::regclass);


--
-- Name: part part_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part ALTER COLUMN part_id SET DEFAULT nextval('public.part_part_id_seq'::regclass);


--
-- Name: part_aliases id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_aliases ALTER COLUMN id SET DEFAULT nextval('public.part_aliases_id_seq'::regclass);


--
-- Name: part_application part_app_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_application ALTER COLUMN part_app_id SET DEFAULT nextval('public.part_application_part_app_id_seq'::regclass);


--
-- Name: part_merge_log id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_merge_log ALTER COLUMN id SET DEFAULT nextval('public.part_merge_log_id_seq'::regclass);


--
-- Name: part_number part_number_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_number ALTER COLUMN part_number_id SET DEFAULT nextval('public.part_number_part_number_id_seq'::regclass);


--
-- Name: payment_methods method_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_methods ALTER COLUMN method_id SET DEFAULT nextval('public.payment_methods_method_id_seq'::regclass);


--
-- Name: payment_term payment_term_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_term ALTER COLUMN payment_term_id SET DEFAULT nextval('public.payment_term_payment_term_id_seq'::regclass);


--
-- Name: permission permission_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permission ALTER COLUMN permission_id SET DEFAULT nextval('public.permission_permission_id_seq'::regclass);


--
-- Name: permission_level permission_level_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permission_level ALTER COLUMN permission_level_id SET DEFAULT nextval('public.permission_level_permission_level_id_seq'::regclass);


--
-- Name: purchase_order po_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_order ALTER COLUMN po_id SET DEFAULT nextval('public.purchase_order_po_id_seq'::regclass);


--
-- Name: purchase_order_line po_line_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_order_line ALTER COLUMN po_line_id SET DEFAULT nextval('public.purchase_order_line_po_line_id_seq'::regclass);


--
-- Name: supplier supplier_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.supplier ALTER COLUMN supplier_id SET DEFAULT nextval('public.supplier_supplier_id_seq'::regclass);


--
-- Name: tag tag_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tag ALTER COLUMN tag_id SET DEFAULT nextval('public.tag_tag_id_seq'::regclass);


--
-- Name: tax_rate tax_rate_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tax_rate ALTER COLUMN tax_rate_id SET DEFAULT nextval('public.tax_rate_tax_rate_id_seq'::regclass);


--
-- Name: vehicle_engine engine_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_engine ALTER COLUMN engine_id SET DEFAULT nextval('public.vehicle_engine_engine_id_seq'::regclass);


--
-- Name: vehicle_make make_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_make ALTER COLUMN make_id SET DEFAULT nextval('public.vehicle_make_make_id_seq'::regclass);


--
-- Name: vehicle_model model_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_model ALTER COLUMN model_id SET DEFAULT nextval('public.vehicle_model_model_id_seq'::regclass);


--
-- Data for Name: application; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.application (application_id, make_id, model_id, engine_id) FROM stdin;
1	1	1	\N
2	2	2	\N
3	1	\N	\N
4	6	3	\N
5	7	4	1
6	2	\N	\N
\.


--
-- Data for Name: brand; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.brand (brand_id, brand_name, brand_code) FROM stdin;
1	MUSASHI	MUSA
2	NOK	NOKX
3	TOGU	TOGU
4	NO BRAND	NOBR
5	SGP	SGPX
6	FLEETMAX	FLEE
7	UNION ASAHI	UNAS
8	KOSA	KOSA
9	MARK POWER	MAPO
10	GERMANY	GERM
11	KOYO	KOYO
12	DENSO	DENS
13	MOHASHI	MOHA
14	SEIKEN	SEIK
15	TOP1	TOP1
16	KOREA	KORE
17	OPTIBELT	OPTI
18	ZAPPA	ZAPP
19	EXEDY	EXED
20	NBK	NBKX
21	DAIDO	DAID
22	TAIWAN	TAIW
23	MIKASA	MIKA
24	ORION	ORIO
25	BEI	BEIX
26	CIRCUIT	CIRC
27	GENUINE	GENU
28	MMC	MMCX
29	ASAHI	ASAH
30	SEALTESTED	SEAL
31	NSK	NSKX
32	TOKICO	TOKI
33	NTN	NTNX
34	FUJI	FUJI
35	MIDORI	MIDO
36	MATSUI	MATS
37	KB	KBXX
38	JAG	JAGX
39	CULTURE	CULT
40	NUVO PRO	NUPR
41	MATSUBA	MAT1
42	TW	TWXX
43	HTC	HTCX
44	GSK	GSKX
45	FEDERAL MOGUL	FEMO
46	BANDO	BAND
47	OPTIMUM	OPT1
48	GMG	GMGX
49	SPINNER	SPIN
50	SPORTEC	SPOR
51	MARUZEN	MARU
52	GMB	GMBX
53	SIRENA	SIRE
54	CHITAS	CHIT
55	CPSA	CPSA
56	SGM	SGMX
57	CASTROL	CAST
58	YSMW	YSMW
59	MIYACO	MIYA
60	DEVCON	DEVC
61	3M	3MXX
62	AISIN	AISI
63	TOYOTA PACKING	TOPA
64	COMFY	COMF
65	DERFOE	DERF
66	DK	DKXX
67	WELDIT	WELD
68	ARMTECH	ARMT
69	NIHON	NIHO
70	NISSIN	NISS
71	OURSUN	OURS
72	KWIK	KWIK
73	KICHI	KICH
74	GM GENUINE	GMGE
75	DIZ	DIZX
76	HYUNDAI MOBIS	HYMO
77	IBK	IBKX
78	OSAKA	OSAK
79	GTX	GTXX
80	ABS	ABSX
81	IZUMI	IZUM
82	HORSE	HORS
83	KEM	KEMX
84	UNIVERSAL HEAVY DUTY	UHDU
85	HEAVY DUTY	HEDU
86	BLITZ	BLIT
87	SAFEGUARD	SAFE
88	MIKOSHI	MIKO
89	ND	NDXX
90	HANSA	HANS
91	GENUINE THAILAND	GETH
92	TAISHO	TAIS
93	BOSCH	BOSC
94	VIC	VICX
95	MITOYO	MITO
96	NESINBO	NESI
97	BENDIX	BEND
98	POWERPLUS	POWE
99	EXCEL	EXCE
100	DOKURO	DOKU
101	NATIONAL	NATI
102	RSPEC	RSPE
103	FEDERAL	FEDE
104	TAIHO	TAIH
105	OEM	OEMX
106	GM	GMXX
107	NK-SL	NKSL
108	NK	NKXX
109	ART	ARTX
110	NKR	NKRX
111	SKY	SKYX
112	SPARCO	SPAR
113	TP	TPXX
114	KSM	KSMX
115	JAPAN	JAPA
116	MITSUBISHI	MITS
117	HYUNDAI	HYUN
118	GTR	GTRX
119	MS	MSXX
120	AND	ANDX
121	MFT	MFTX
122	ASUKI	ASUK
123	ERISTIC	ERIS
124	HKT	HKTX
125	CTB	CTBX
126	MAZDA	MAZD
127	DAIKEN	DAIK
128	5WORK	5WOR
129	RM	RMXX
130	REDLINE	REDL
131	COOL GEAR	COGE
132	CBS	CBSX
133	SUN	SUNX
134	KYOTO	KYOT
135	LONGWAY	LONG
136	TIMKEN	TIMK
137	JWORKS	JWOR
138	PRESSOL	PRES
139	PRESTONE	PRE1
140	MICRO	MICR
141	SURE BRAKE	SUBR
142	SURE	SURE
143	KDR	KDRX
144	ITOKO	ITOK
145	ADVICS	ADVI
146	MIZUMO	MIZU
147	MITSUBA	MIT1
148	WHIZ	WHIZ
149	DYNA POWER	DYPO
150	TAMA	TAMA
151	NIS	NISX
152	FUJI-CH	FUJ1
153	NITRO	NITR
154	HTK	HTKX
155	TORIKO	TORI
156	PETRON	PETR
157	MX	MXXX
158	KRC	KRCX
159	TOMI	TOMI
160	SHILIDUO	SHIL
161	CALTEX	CALT
162	EAGLE	EAGL
163	LUBRIGOLD	LUBR
164	GIGA	GIGA
165	SEIWA	SEIW
166	555	555X
167	DAIDO JAPAN	DAJA
168	KARSHANN	KARS
169	TP JAPAN	TPJA
170	AIRTECH	AIRT
171	KNORR JAPAN	KNJA
172	BT	BTXX
173	UNIVERSAL	UNIV
174	CS	CSXX
175	JAPAN VERSION	JAVE
176	BJOK	BJOK
177	OPE	OPEX
178	SHIMAHIDE	SHIM
179	TSK	TSKX
180	NARVA	NARV
181	XHY	XHYX
182	JKC	JKCX
183	SAMYUNG	SAMY
184	MON	MONX
185	KOYO JAPAN	KOJA
186	OCC	OCCX
187	GENERIC	GENE
188	WAGNER	WAGN
189	CCB	CCBX
190	TAK	TAKX
191	MENSCH	MENS
192	KNORR	KNOR
193	EXEDY DAIKEN	EXDA
194	AUTOLINE	AUTO
195	MOBIL	MOBI
196	HELLA	HELL
197	TITAN	TITA
198	TIGER	TIGE
199	THREE BOND	THBO
200	MARKWELL	MARK
201	PIONEER	PION
202	KIA	KIAX
203	YAQIANG	YAQI
204	PHC	PHCX
205	MAHLE	MAHL
206	MAGNA PRIME	MAPR
207	VALVOLINE	VALV
208	FUJIITO	FUJ2
209	APEX	APEX
210	NUVO	NUVO
211	JUSTAR	JUST
212	TECH LAMP	TELA
213	LUCID	LUCI
214	AKM	AKMX
215	TKK	TKKX
216	IQ	IQXX
217	AUTOVOLTS	AUT1
218	MISTUBISHI	MIST
219	KOREA OIL SEAL	KOSE
220	JBS	JBSX
221	AWF	AWFX
222	TOYOTA	TOYO
223	DAEJEN	DAEJ
224	FORD	FORD
225	ISUZU	ISUZ
226	NMK	NMKX
227	KOREA MOTORWORKS	KOMO
228	NB	NBXX
229	NISSAN	NIS1
230	JTEKT	JTEK
231	DAIDO METAL	DAME
232	HAJIME	HAJI
233	THB	THBX
234	ROCKY	ROCK
235	Maxwind	MAXW
236	JCR	JCRX
237	Enoc	ENOC
238	V-TECH	VTEC
239	HOWO	HOWO
240	WINDA	WIND
241	test	TES1
242	nanana	NANA
\.


--
-- Data for Name: credit_note; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.credit_note (cn_id, cn_number, invoice_id, employee_id, refund_date, total_amount, notes) FROM stdin;
1	CN-202509-0001	3	1	2025-09-06 23:59:19.077061+00	12000.00	Refund for Invoice #INV-202509-0003
3	CN-202509-0003	5	1	2025-09-07 01:39:57.674321+00	560.00	Refund for Invoice #INV-202509-0005
4	CN-202509-0004	4	1	2025-09-07 02:02:11.564494+00	200.00	Refund for Invoice #INV-202509-0004
5	CN-202509-0005	11	1	2025-09-08 22:33:58.466904+00	300.00	Refund for Invoice #INV-202509-0011
6	CN-202509-0006	16	1	2025-09-08 22:35:07.774354+00	1105.00	Refund for Invoice #INV-202509-0016
7	CN-202509-0007	22	1	2025-09-09 03:51:27.852436+00	370.00	Refund for Invoice #INV-202509-0022
8	CN-202509-0008	21	1	2025-09-09 03:51:39.005826+00	370.00	Refund for Invoice #INV-202509-0021
9	CN-202509-0009	20	1	2025-09-09 03:51:57.915692+00	370.00	Refund for Invoice #INV-202509-0020
10	CN-202509-0010	26	1	2025-09-09 03:57:23.037593+00	120.00	Refund for Invoice #INV-202509-0026
11	CN-202509-0011	23	1	2025-09-09 04:06:54.546878+00	1100.00	Refund for Invoice #INV-202509-0023
14	CN-202509-0014	41	1	2025-09-09 04:22:11.264412+00	1000.00	Refund for Invoice #INV-202509-0041
15	CN-202509-0015	19	1	2025-09-09 04:22:43.225645+00	1105.00	Refund for Invoice #INV-202509-0019
16	CN-202509-0016	27	1	2025-09-09 04:23:30.469185+00	4300.00	Refund for Invoice #INV-202509-0027
17	CN-202509-0017	33	1	2025-09-09 22:19:18.809265+00	2150.00	Refund for Invoice #INV-202509-0033
18	CN-202509-0018	89	1	2025-09-13 22:38:45.293444+00	290.00	Refund for Invoice #INV-202509-0089
19	CN-202509-0019	88	1	2025-09-13 22:39:00.00876+00	670.00	Refund for Invoice #INV-202509-0088
20	CN-202509-0020	90	1	2025-09-13 23:14:02.738764+00	1450.00	Refund for Invoice #INV-202509-0090
21	CN-202509-0021	117	1	2025-09-14 22:01:27.599537+00	350.00	Refund for Invoice #INV-202509-0117
22	CN-202509-0022	119	1	2025-09-14 22:02:40.25695+00	1100.00	Refund for Invoice #INV-202509-0119
23	CN-202509-0023	120	1	2025-09-14 22:04:07.734348+00	350.00	Refund for Invoice #INV-202509-0120
\.


--
-- Data for Name: credit_note_line; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.credit_note_line (cn_line_id, cn_id, part_id, quantity, sale_price) FROM stdin;
1	1	3662	4.0000	3000.00
3	3	529	1.0000	560.00
4	4	388	1.0000	200.00
5	5	499	1.0000	300.00
6	6	478	1.0000	1105.00
7	7	654	1.0000	370.00
8	8	654	1.0000	370.00
9	9	654	1.0000	370.00
10	10	1019	1.0000	120.00
11	11	901	1.0000	1100.00
14	14	1001	1.0000	1000.00
15	15	478	1.0000	1105.00
16	16	610	1.0000	4300.00
17	17	492	1.0000	1700.00
18	17	1176	1.0000	450.00
19	18	842	1.0000	290.00
20	19	306	1.0000	670.00
21	20	1983	1.0000	1450.00
22	21	653	1.0000	350.00
23	22	631	1.0000	1100.00
24	23	653	1.0000	350.00
\.


--
-- Data for Name: customer; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.customer (customer_id, first_name, last_name, company_name, phone, email, address, is_active, date_created) FROM stdin;
1	Walk-in	Customer	\N	\N	\N	\N	t	2025-09-06 11:33:02.377699+00
2	Ronilo	Pilar			\N		t	2025-09-06 23:58:48.342505+00
3	Marlon	Pilar			\N		t	2025-09-14 02:29:00.695131+00
4	Dalia	Pilar			\N		t	2025-09-15 05:26:25.535364+00
\.


--
-- Data for Name: customer_payment; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.customer_payment (payment_id, customer_id, employee_id, payment_date, amount, tendered_amount, payment_method, reference_number, notes, method_id) FROM stdin;
53	1	2	2025-09-13 08:58:58.512868+00	790.00	0.00	Cash	INV-202509-0062	\N	1
52	1	2	2025-09-13 04:30:38.274936+00	1200.00	0.00	Cash	INV-202509-0054	\N	1
51	1	2	2025-09-12 15:42:35.634757+00	41.00	0.00	Cash	INV-202509-0045	\N	1
50	1	1	2025-09-10 02:52:20.285562+00	21.00	0.00	Cash	INV-202509-0044	\N	1
49	1	1	2025-09-09 22:58:15.975524+00	370.00	0.00	Cash	INV-202509-0043	\N	1
48	1	1	2025-09-09 22:46:15.26505+00	650.00	0.00	Cash	INV-202509-0042	\N	1
47	1	1	2025-09-09 04:09:51.559293+00	1000.00	0.00	Cash	INV-202509-0041	\N	1
43	1	1	2025-09-09 03:35:42.201365+00	123.00	0.00	Cash	INV-202509-0037	\N	1
42	1	1	2025-09-09 03:35:00.753608+00	23.00	0.00	Cash	INV-202509-0036	\N	1
41	1	1	2025-09-09 03:29:19.558073+00	333.00	0.00	Cash	INV-202509-0035	\N	1
40	1	1	2025-09-09 03:28:35.317738+00	1.00	0.00	Cash	INV-202509-0034	\N	1
39	1	1	2025-09-09 03:08:44.516412+00	19340.01	0.00	Cash	INV-202509-0033	\N	1
38	2	1	2025-09-09 01:09:05.324949+00	50.00	\N	Cash			1
37	2	1	2025-09-09 01:08:41.61407+00	300.00	\N	Cash			1
36	2	1	2025-09-09 00:40:37.578197+00	800.00	\N	Cash			1
35	1	1	2025-09-09 00:37:41.78394+00	350.00	0.00	Cash	INV-202509-0030	\N	1
33	1	1	2025-09-08 22:36:00.211636+00	1230.00	0.00	Cash	INV-202509-0028	\N	1
32	1	1	2025-09-08 03:59:13.23672+00	4300.00	0.00	Cash	INV-202509-0027	\N	1
31	1	1	2025-09-08 03:58:32.042691+00	680.00	0.00	Cash	INV-202509-0026	\N	1
30	1	1	2025-09-08 02:33:12.071253+00	150.00	0.00	Cash	INV-202509-0025	\N	1
28	1	1	2025-09-08 01:42:58.677481+00	1100.00	0.00	Cash	INV-202509-0023	\N	1
27	1	1	2025-09-08 01:39:24.474559+00	370.00	0.00	Cash	INV-202509-0022	\N	1
26	1	1	2025-09-08 01:35:03.067613+00	370.00	0.00	Cash	INV-202509-0021	\N	1
25	1	1	2025-09-08 01:33:58.95491+00	370.00	0.00	Cash	INV-202509-0020	\N	1
24	1	1	2025-09-08 01:33:50.320864+00	1105.00	0.00	Cash	INV-202509-0019	\N	1
23	1	1	2025-09-07 23:47:50.315487+00	670.00	0.00	Cash	INV-202509-0018	\N	1
22	2	1	2025-09-07 23:47:13.949526+00	30.00	\N	Cash			1
21	2	1	2025-09-07 23:46:28.409191+00	10.00	\N	Cash	dff000		1
20	2	1	2025-09-07 23:25:20.651551+00	5.00	\N	Cash	ci-1234		1
14	2	1	2025-09-07 02:14:08.279014+00	230.00	\N	Cash	Legacy		1
13	2	1	2025-09-07 02:09:58.970472+00	200.00	\N	Cash	Legacy		1
9	2	1	2025-09-07 01:38:44.248274+00	100.00	\N	Cash	Legacy		1
7	2	1	2025-09-07 01:19:09.831378+00	70.00	\N	Cash	Legacy		1
6	2	1	2025-09-07 00:23:41.425607+00	130.00	\N	Cash	Legacy		1
4	2	1	2025-09-07 00:18:44.305205+00	100.00	\N	Cash	Legacy		1
19	2	1	2025-09-07 22:57:30.779433+00	100.00	\N	Cash	test101		1
18	1	1	2025-09-07 22:24:06.681335+00	30.00	0.00	Cash	INV-202509-0017	\N	1
17	1	1	2025-09-07 16:05:41.271863+00	840.00	0.00	Cash	INV-202509-0015	\N	1
16	1	1	2025-09-07 15:59:24.715166+00	280.00	0.00	Cash	INV-202509-0014	\N	1
15	1	1	2025-09-07 15:59:03.674145+00	430.00	0.00	Cash	INV-202509-0013	\N	1
12	2	1	2025-09-07 02:09:05.973158+00	300.00	\N	Cash	INV-202509-0011	\N	1
11	1	1	2025-09-07 02:08:37.463997+00	33.00	0.00	Cash	INV-202509-0010	\N	1
10	1	1	2025-09-07 02:07:39.777851+00	370.00	0.00	Cash	INV-202509-0009	\N	1
8	2	1	2025-09-07 01:37:37.069656+00	350.00	0.00	Cash	INV-202509-0007	\N	1
5	1	1	2025-09-07 00:21:54.999822+00	560.00	0.00	Cash	INV-202509-0005	\N	1
3	2	1	2025-09-06 23:58:58.337003+00	12000.00	\N	Cash	INV-202509-0003	\N	1
2	1	1	2025-09-06 23:58:16.240282+00	200.00	0.00	Cash	INV-202509-0002	\N	1
1	1	1	2025-09-06 23:58:09.595563+00	430.00	0.00	Cash	INV-202509-0001	\N	1
54	1	1	2025-09-13 09:36:04.161642+00	980.00	0.00	Cash	INV-202509-0064	\N	\N
55	1	1	2025-09-13 10:00:15.204127+00	290.00	0.00	Cash	INV-202509-0066	\N	\N
56	1	1	2025-09-13 10:02:19.950426+00	900.00	0.00	Cash	INV-202509-0068	\N	\N
57	1	1	2025-09-13 13:38:28.993387+00	620.00	0.00	Cash	INV-202509-0070	\N	\N
58	1	1	2025-09-13 23:46:12.144967+00	20000.00	\N	Cash			\N
59	2	1	2025-09-13 23:46:54.877023+00	20000.00	\N	Cash			\N
60	3	1	2025-09-14 02:39:36.055474+00	200.00	\N	Cash			\N
\.


--
-- Data for Name: customer_tag; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.customer_tag (customer_id, tag_id) FROM stdin;
\.


--
-- Data for Name: document_sequence; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.document_sequence (prefix, period, last_number) FROM stdin;
AERO-ADVI	ALL	1
ABPI-3MXX	ALL	1
AICL-ADVI	ALL	1
ABPI-5WOR	ALL	1
INV	202509	166
CN	202509	24
PO	202509	6
AERO-555X	ALL	2
AMGA-ARMT	ALL	1
AERO-3MXX	ALL	1
ABPI-555X	ALL	1
GRN	202509	7
ACCA-3MXX	ALL	5
ACCA-555X	ALL	2
\.


--
-- Data for Name: documents; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.documents (id, document_type, reference_id, created_at, updated_at, file_path, metadata) FROM stdin;
00000000-0000-0000-0000-000000000001	Invoice	INV-TEST-0001	2025-08-27 12:27:18.777201+00	2025-08-28 12:27:18.777201+00	/tmp/sample-invoice-1.pdf	{"amount": 123.45, "preview_html": "<div><h1>Invoice INV-TEST-0001</h1><p>Sample invoice preview</p></div>"}
00000000-0000-0000-0000-000000000002	GRN	GRN-TEST-0001	2025-09-01 12:27:18.777201+00	2025-09-02 12:27:18.777201+00	/tmp/sample-grn-1.pdf	{"items": 3, "preview_html": "<div><h1>GRN GRN-TEST-0001</h1><p>Goods received</p></div>"}
00000000-0000-0000-0000-000000000003	PurchaseOrders	PO-TEST-0001	2025-09-04 12:27:18.777201+00	2025-09-05 12:27:18.777201+00	/tmp/sample-po-1.pdf	{"amount": 789.00, "preview_html": "<div><h1>PO PO-TEST-0001</h1><p>Purchase order preview</p></div>"}
\.


--
-- Data for Name: draft_transaction; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.draft_transaction (draft_id, employee_id, transaction_type, draft_data, last_updated) FROM stdin;
\.


--
-- Data for Name: employee; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.employee (employee_id, employee_code, first_name, last_name, position_title, permission_level_id, username, password_hash, password_salt, is_active, date_hired, date_created, created_by) FROM stdin;
1	\N	Kent	Pilar	\N	10	kent.pilar	$2b$10$HnezMxOJqOGPg99kLhbq6.nbhcK20l6U3zRkIIuaqZHArSuHg/uOq	$2b$10$HnezMxOJqOGPg99kLhbq6.	t	\N	2025-09-06 11:40:45.799009+00	\N
2	\N	test	testLast	Test	10	test	$2b$10$fjO4G2dowoBVQ70PqnRLxehmjIWGm0YlMfbQcT.bE7WTY6uQQSG6.	$2b$10$fjO4G2dowoBVQ70PqnRLxe	t	\N	2025-09-12 09:30:28.353011+00	\N
\.


--
-- Data for Name: goods_receipt; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.goods_receipt (grn_id, grn_number, receipt_date, supplier_id, received_by) FROM stdin;
1	GRN-202509-0001	2025-09-09 00:38:49.728702+00	2	1
2	GRN-202509-0002	2025-09-09 08:20:25.512591+00	2	1
5	GRN-202509-0005	2025-09-10 00:47:38.110312+00	3	1
6	GRN-202509-0006	2025-09-10 00:55:55.533907+00	3	1
4	GRN-202509-0004	2025-09-10 02:43:07.512775+00	2	1
3	GRN-202509-0003	2025-09-10 02:52:57.018058+00	2	1
7	GRN-202509-0007	2025-09-10 02:57:37.465656+00	2	1
\.


--
-- Data for Name: goods_receipt_line; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.goods_receipt_line (grn_line_id, grn_id, part_id, quantity, cost_price, sale_price) FROM stdin;
1	1	480	1.0000	235.00	430.00
2	1	3682	1.0000	0.00	0.00
3	1	3685	1.0000	0.00	0.00
4	1	3686	1.0000	0.00	0.00
5	1	712	1.0000	218.00	930.00
6	1	710	1.0000	324.00	1200.00
7	2	5	1.0000	200.00	300.00
10	5	1042	1.0000	480.00	900.00
11	5	490	1.0000	160.00	350.00
12	6	1036	1.0000	390.00	800.00
13	6	1127	1.0000	685.00	1250.00
14	6	364	1.0000	270.00	350.00
15	6	652	1.0000	500.00	850.00
16	6	765	1.0000	460.00	800.00
17	6	857	1.0000	480.00	850.00
18	6	858	1.0000	220.00	400.00
19	6	1043	1.0000	460.00	800.00
20	6	613	1.0000	18.00	50.00
21	6	766	1.0000	0.00	800.00
22	6	697	1.0000	240.00	450.00
23	6	1476	1.0000	535.00	550.00
24	6	978	1.0000	780.00	1380.00
25	6	621	1.0000	480.00	850.00
26	6	1158	1.0000	122.00	250.00
27	6	2781	1.0000	21.00	40.00
28	6	1220	1.0000	370.00	650.00
29	6	1790	1.0000	4300.00	0.00
30	6	2408	1.0000	440.00	800.00
31	6	846	1.0000	1500.00	2600.00
32	6	1052	1.0000	714.00	1200.00
33	6	816	1.0000	240.00	420.00
34	6	1950	1.0000	530.00	800.00
35	6	3	2.0000	429.00	740.00
36	6	386	1.0000	1400.00	55.00
37	6	2262	1.0000	765.00	1400.00
38	6	476	1.0000	535.00	1000.00
39	6	717	1.0000	539.00	1800.00
40	6	6	1.0000	511.00	870.00
43	4	4	2.0000	500.00	650.00
49	3	4	4.0000	6.00	7.00
50	7	3687	3.0000	5.00	6.00
\.


--
-- Data for Name: group; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."group" (group_id, group_name, group_code) FROM stdin;
1	OIL SEAL	OISE
2	CABLE TIE	CATI
3	SUSPENSION ARM	SUAR
4	TIE ROD END	TREN
5	PITMAN ARM	PIAR
6	AIR FILTER	AIFI
7	FUEL RUBBER HOSE	FRHO
8	GREASE GUN ACCESSORY	GGAC
9	BEARING	BEAR
10	SILICON OIL	SIOI
11	BRAKE PAD	BRPA
12	RUBBER CUP	RUCU
13	GREASE	GREA
14	TIMING BELT	TIBE
15	FAN BELT	FABE
16	STABILIZER BOLT	STBO
17	SELECTOR CABLE	SECA
18	ACCELERATOR CABLE	ACCA
19	FUEL FILTER	FUFI
20	U-JOINT	UJOI
21	RELEASE BEARING	REBE
22	IDLER	IDLE
23	RIBBED BELT	RIBE
24	BELT	BELT
25	TOOTHED BELT	TOBE
26	BACK UP HORN	BUHO
27	CLUTCH DISC	CLDI
28	CLUTCH COVER	CLCO
29	THRUST WASHER	THWA
30	TIRE CARRIER	TICA
31	CLUTCH MASTER KIT	CMKI
32	PISTON PIN	PIPI
33	VALVE SEAL	VASE
34	WHEEL CYLINDER	WHCY
35	ENGINE SUPPORT	ENSU
36	TRANS SUP	TRSU
37	GLOW PLUG	GLPL
38	OIL FILTER	OIFI
39	SHUT OFF VALVE	SOVA
40	OIL PUMP	OIPU
41	SHOCK ABSORBER	SHAB
42	TEMPERATURE SENDING UNIT	TSUN
43	CLUTCH OPERATING	CLOP
44	POWER STEERING REP KIT	PSRE
45	ENGINE MOUNT	ENMO
46	CONNECTING ROD BEARING	CRBE
47	KING PIN KIT	KPKI
48	MAIN BEARING	MABE
49	TAIL LAMP SOCKET	TLSO
50	CLUTCH LEVER KIT	CLKI
51	COOLANT TANK	COTA
52	DOOR LOCK	DOLO
53	WIPER NOZZLE	WINO
54	WIND SHIELD WASHER MOTOR	WSWA
55	BRAKE SHOE	BRSH
56	IDLER BEARING	IDBE
57	TIMING CHAIN TENSIONER	TCTE
58	DOOR HANDLE	DOHA
59	WIPER LINKAGE	WILI
60	TAIL GATE HANDLE	TGHA
61	DISTRIBUTOR ROTOR	DIRO
62	CORNER LAMP	COLA
63	FOG LAMP	FOLA
64	HEAD GASKET	HEGA
65	SUSPENSION ARM BUSHING	SABU
66	TENSIONER BEARING	TEBE
67	SIDE LAMP	SILA
68	OVERHAULING GASKET	OVGA
69	ELECTRIC FUEL PUMP	EFPU
70	FAN BLADE	FABL
71	HEAD LAMP	HELA
72	HOUSING	HOUS
73	BACK HORN	BAHO
74	HANDLE OUTSIDE	HAOU
75	HANDLE INSIDE	HAIN
76	TORQUE ROD BOLT	TRBO
77	CONTACT POINT	COPO
78	WHEEL HUB ASSEMBLY	WHAS
79	TAIL LIGHT	TALI
80	FLASHER RELAY	FLRE
81	MIRRORS	MIRR
82	ENGINE OIL	ENOI
83	CRANKSHAFT POSITION SENSOR	CPSE
84	ALTERNATOR	ALTE
85	VALVE COVER GASKET	VCGA
86	INJECTOR OIL SEAL	IOSE
87	ROCKER ARM	ROAR
88	VALVE SEAT RING	VSRI
89	VALVE GUIDE	VAGU
90	CYLINDER HEAD BOLT	CHBO
91	CONCENTRIC SLAVE CYLINDER	CSCY
92	CLUTCH RELEASE BEARING	CRB1
93	CLUTCH FORK	CLFO
94	VALVE SHIMS	VASH
95	VALVE TAPPET	VATA
96	PRECHAMBER	PREC
97	WHEEL HUB BEARING	WHBE
98	BRAKE MASTER KIT	BMKI
99	CLUTCH SLAVE	CLSL
100	BRAKE BOOSTER	BRBO
101	CYLINDER HEAD	CYHE
102	OIL PAN GASKET	OPGA
103	WIPER MOTOR	WIMO
104	RESERVOIR TANK	RETA
105	RUBBER BOOTS	RUBO
106	EPOXY	EPOX
107	MAGNETIC HORN	MAHO
108	SAND PAPER	SAPA
109	REAR VIEW MIRROR	RVMI
110	AIR CLEANER	AICL
111	CYLINDER LINER	CYLI
112	EXHAUST PIPE CONNECTOR	EPCO
113	BACK REST	BARE
114	AIR HORN SWITCH	AHSW
115	CARBURETOR  CLEANER	CACL
116	BLEEDER SCREW	BLSC
117	AIR HORN	AIHO
118	OIL COOLER	OICO
119	STOP LEAK	STLE
120	CV BOOTS	CVBO
121	WATER PUMP	WAPU
122	COOLANT	COOL
123	RADIATOR HOSE	RAHO
124	BYPASS HOSE	BYHO
125	ALTERNATOR HOSE	ALHO
126	AIR CLEANER HOSE	ACHO
127	BATTERY	BATT
128	TUBE PATCH	TUPA
129	VULCANIZING GUM	VUGU
130	TORQUE ROD  BUSHING	TRBU
131	BRAKE LINING	BRLI
132	HUB NUT	HUNU
133	TRANSMISSION SUPPORT	TRS1
134	WHEEL COVER SILVER	WCSI
135	GREASE GUN	GRGU
136	AIR HORN MAGNETIC VALVE	AHMA
137	SPEEDOMETER CABLE	SPCA
138	SPRING PIN BUSHING	SPBU
139	HANDBRAKE CABLE	HACA
140	ENGINE STOP CABLE	ESCA
141	BENDIX DRIVE	BEDR
142	CENTER POST BUSHING	CPBU
143	SHOCK ABSORBER RUBBER BUSHING	SARU
144	SPRING COLLAR BUSHING	SCBU
145	SPRING BUSHING	SPB1
146	SHIFT BOOTS	SHBO
147	SHIFT KNOB	SHKN
148	SEAT CUSHION	SECU
149	WHEEL LOCK NUT	WLNU
150	ALTERNATOR SOCKET	ALSO
151	STARTER BRUSH HOLDER	SBHO
152	CLUTCH BOOSTER	CLBO
153	STARTER ARMATURE	STAR
154	DUMPING CABLE	DUCA
155	STEERING COUPLING	STCO
156	BRAKE HOSE	BRHO
157	BRAIDED HOSE	BRH1
158	ANTENNA	ANTE
159	TEMPERATURE GAUGE	TEGA
160	TAIL GATE LOCK	TGLO
161	OIL PRESSURE SWITCH	OPSW
162	TWIN HORN	TWHO
163	BOOSTER HYDROVAC ASSY	BHAS
164	AEROTWIN	AERO
165	STARTER	STA1
166	RADIATOR MOTOR	RAMO
167	AUTO BULB	AUBU
168	FUSE LINK	FULI
169	FOOT VALVE	FOVA
170	AUTO WIRE	AUWI
171	WIPER BLADE	WIBL
172	SPARK PLUG	SPPL
173	CABIN FILTER	CAFI
174	BRAKE CALIPER KIT	BCKI
175	CENTER POST	CEPO
176	ROTOR DISC	RODI
177	CALIPER PISTON	CAPI
178	COG BELT	COBE
179	TAIL LAMP	TALA
180	VALVE SEAL CAP	VSCA
181	ENGINE VALVE	ENVA
182	HYDRAULIC OIL	HYOI
183	CV JOINT	CVJO
184	CALIPER KIT	CAKI
185	PISTON ASSY	PIAS
186	BRAKE DISC ROTOR	BDRO
187	DRIVE BELT	DRBE
188	CLUTCH CABLE	CLCA
189	IGNITION COIL	IGCO
190	CENTER LINK	CELI
191	AXLE STUD	AXST
192	EXHAUST PIPE RING	EPRI
193	FUEL CONNECTOR	FUCO
194	TORTION BALL	TOBA
195	CENTER BOLT	CEBO
196	U-BOLT	UBOL
197	VULCANIZING FLUID	VUFL
198	TIRE SEALANT	TISE
199	VULCANIZING PATCH	VUPA
200	LUG NUT	LUNU
201	PISTON RING	PIRI
202	PRIMING PUMP	PRPU
203	THERMOSTAT	THER
204	HORN	HORN
205	SPRING PIN	SPPI
206	RADIATOR COOLANT	RACO
207	RUBBER MOUNT	RUMO
208	EXHAUST BRAKE VALVE	EBVA
209	DRAIN COCK	DRCO
210	PINION NUT	PINU
211	CHECK VALVE	CHVA
212	WHEEL RIM	WHRI
213	BATTERY CLAMP	BACL
214	BOSCH RELAY	BORE
215	CENTER BEARING	CEBE
216	CROSS WRENCH	CRWR
217	FUEL PUMP	FUPU
218	FLEXIBLE PIPE	FLPI
219	CONTROL ARM ASSY	CAAS
220	COMPACT DISC HORN	CDHO
221	RADIATOR CAP	RACA
222	STRUT BAR BUSHING	SBBU
223	STEERING BEARING	STBE
224	MAGWHEEL NUT	MANU
225	HOSE CLAMP	HOCL
226	AIR BOOSTER PISTON	ABPI
227	MASTER CHECK VALVE	MCVA
228	CLUTCH BOOSTER SLEEVE	CBSL
229	AIRCON PULLEY	AIPU
230	NOZZLE SEAL	NOSE
231	TIRE	TIRE
232	AMPERE GAUGE	AMGA
233	OIL GAUGE	OIGA
234	FUEL GAUGE	FUGA
235	INJECTION PUMP BOLT	IPBO
236	BRAKE FLUID	BRFL
237	STARTER BUSHING	STBU
238	TIRE WRENCH	TIWR
239	FUEL PUMP MOTOR	FPMO
240	BALL JOINT	BAJO
241	MAGNETIC SWITCH	MASW
242	TOGGLE SWITCH	TOSW
243	EXHAUST MANIFOLD GASKET	EMGA
244	RADIATOR FAN BLADE	RFBL
245	TURBO HOSE	TUHO
246	CLUTCH KIT	CLK1
247	FUEL PUMP HEAD	FPHE
248	FAN MOTOR	FAMO
249	FUEL PUMP SENSOR	FPSE
250	DRAG LINK END	DLEN
251	CABIN AIR BAG	CABA
252	MAGNETIC VALVE	MAVA
253	GEAR OIL	GEOI
254	CONNECTING ROD ARM	CRAR
255	HALF MOON	HAMO
256	STEP BOARD	STB1
257	GAS TANK CAP	GTCA
258	BRAKE FLUID TANK	BFTA
259	FEED PUMP VALVE	FPVA
260	BOOGIE SHIM	BOSH
261	SIDE MIRROR	SIMI
262	BUMPER MIRROR	BUMI
263	TEFLON TAPE	TETA
264	ALTERNATOR PULLEY	ALPU
265	PRESSURE PLATE	PRPL
266	AXLE BOOTS	AXBO
267	LEAF SPRING	LESP
268	POWER BRAKE BOOSTER	PBBO
269	SPARKPLUG CABLE	SPC1
270	DRAG LINK HEAD	DLHE
271	TRANSMISSION BEARING	TRBE
272	INJECTOR COVER SEAL	ICSE
273	TAPERED ROLLER BRG	TRBR
274	AIR FRESHENER	AIFR
275	CAMSHAFT BUSHING	CABU
276	HYDROVAC ASSY	HYAS
277	HYDROVAC REPAIR KIT	HRKI
278	REVOLVING LAMP	RELA
279	FOG LAMP SET	FLSE
280	WEDGE BULB	WEBU
281	RAIL LAMP	RALA
282	METRIC CAP SCREW	MCSC
283	LOCAL BOLT	LOBO
284	LOCAL HEX BOLT	LHBO
285	LOCAL CAP SCREW	LCSC
286	METRIC BOLT	MEBO
287	LOCAL HEX CAP SCREW	LHCA
288	PLAIN WASHER	PLWA
289	LOCAL HEX NUT	LHNU
290	LOCK WASHER	LOWA
291	NUT	NUTX
292	BOLT	BOLT
293	DRAG LINK	DRLI
294	SIDE LAMP LED	SLLE
295	POWE SHIFTER ASSY	PSAS
296	STABILIZER LINK	STLI
297	CLUTCH FAN	CLFA
298	CRANKSHAFT PULLEY	CRPU
299	HALOGEN BULB	HABU
300	BRAKE EXPANDER	BREX
301	HYDRAULIC CYLINDER	HYCY
302	STABILIZER BUSHING	STB2
303	RADIATOR RESERVOIR TANK	RRTA
304	TUBES	TUBE
305	ALTERNATOR BRUSH	ALBR
306	HUB BOLT	HUBO
307	FLARE NUT	FLNU
308	SEALED BEAM	SEBE
309	FOOT VALVE KIT	FVKI
310	CLUTCH BOOSTER KIT	CBKI
311	TRANSMISSION LINKAGE	TRLI
312	FUEL TANK CAP	FTCA
313	LIQUID GASKET	LIGA
314	RACK END	RAEN
315	CRANKSHAFT	CRAN
316	MIGHTY GASKET	MIGA
317	GASKET PASTE	GAPA
318	OIL TREATMENT	OITR
319	ATF	ATFX
320	HEAD LIGHT	HELI
321	HEAD LIGHT MOULDING	HLMO
322	BUMPER LAMP	BULA
323	PARK LAMP	PALA
324	TRUCK LAMP	TRLA
325	SHOCK MOUNTING	SHMO
326	BACK DOOR STAY	BDST
327	CLUTCH RELEASE CYLINDER	CRCY
328	IDLER PULLEY	IDPU
329	CLUTCH RELEASE	CLRE
330	SYNCHRONIZER RING	SYRI
331	TENSIONER PULLEY	TEPU
332	IDLER SUB	IDSU
333	CONNECTING ROD	CORO
334	ENGINE BEARING	ENBE
335	HYDRAULIC TENSIONER	HYTE
336	DEFLECTOR GUIDE WHEEL	DGWH
337	STICK BEARING	STB3
338	CROSS JOINT	CRJO
339	CONTROL CABLE	COCA
340	BUSHING	BUSH
341	PISTON PIN BUSHING	PPBU
342	VALVE INSERT RING	VIRI
343	DAIDO	DAID
344	TIMING CHAIN GUIDE	TCGU
345	VENTILATION VALVE	VEVA
346	GASKET CEMENT	GACE
347	MALE CONNECTOR	MACO
348	key	KEYX
349	NOZZLE WASHER	NOWA
350	BULB TEST OKAY	BTOK
\.


--
-- Data for Name: inventory_transaction; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.inventory_transaction (inv_trans_id, part_id, transaction_date, trans_type, quantity, unit_cost, reference_no, employee_id, notes) FROM stdin;
1	480	2025-09-06 23:58:09.595563+00	StockOut	-1.0000	0.00	INV-202509-0001	1	\N
2	1014	2025-09-06 23:58:16.240282+00	StockOut	-1.0000	0.00	INV-202509-0002	1	\N
3	3662	2025-09-06 23:58:58.337003+00	StockOut	-4.0000	0.00	INV-202509-0003	1	\N
4	3662	2025-09-06 23:59:19.077061+00	Refund	4.0000	3000.00	CN-202509-0001	1	Refund for Invoice #INV-202509-0003
5	388	2025-09-07 00:13:42.614755+00	StockOut	-1.0000	0.00	INV-202509-0004	1	\N
6	529	2025-09-07 00:21:54.999822+00	StockOut	-1.0000	0.00	INV-202509-0005	1	\N
7	656	2025-09-07 00:23:15.97104+00	StockOut	-1.0000	0.00	INV-202509-0006	1	\N
8	656	2025-09-07 00:24:17.041355+00	Refund	1.0000	300.00	CN-202509-0002	1	Refund for Invoice #INV-202509-0006
9	658	2025-09-07 01:37:37.069656+00	StockOut	-1.0000	0.00	INV-202509-0007	1	\N
10	2333	2025-09-07 01:37:56.005932+00	StockOut	-5.0000	0.00	INV-202509-0008	1	\N
11	529	2025-09-07 01:39:57.674321+00	Refund	1.0000	560.00	CN-202509-0003	1	Refund for Invoice #INV-202509-0005
12	388	2025-09-07 02:02:11.564494+00	Refund	1.0000	200.00	CN-202509-0004	1	Refund for Invoice #INV-202509-0004
13	654	2025-09-07 02:07:39.777851+00	StockOut	-1.0000	0.00	INV-202509-0009	1	\N
14	654	2025-09-07 02:07:52.965765+00	StockIn	1.0000	0.00	INV-202509-0009	1	SYSTEM REVERSAL: Invoice deleted
15	1819	2025-09-07 02:08:37.463997+00	StockOut	-1.0000	0.00	INV-202509-0010	1	\N
16	1819	2025-09-07 02:08:42.839041+00	StockIn	1.0000	0.00	INV-202509-0010	1	SYSTEM REVERSAL: Invoice deleted
17	499	2025-09-07 02:09:05.973158+00	StockOut	-1.0000	0.00	INV-202509-0011	1	\N
18	841	2025-09-07 02:09:30.383057+00	StockOut	-1.0000	0.00	INV-202509-0012	1	\N
19	841	2025-09-07 02:09:39.012531+00	StockIn	1.0000	0.00	INV-202509-0012	1	SYSTEM REVERSAL: Invoice deleted
20	656	2025-09-07 02:14:24.518944+00	StockIn	1.0000	0.00	INV-202509-0006	1	SYSTEM REVERSAL: Invoice deleted
21	480	2025-09-07 15:59:03.674145+00	StockOut	-1.0000	0.00	INV-202509-0013	1	\N
22	655	2025-09-07 15:59:24.715166+00	StockOut	-1.0000	0.00	INV-202509-0014	1	\N
23	530	2025-09-07 16:05:41.271863+00	StockOut	-1.0000	0.00	INV-202509-0015	1	\N
24	655	2025-09-07 16:05:41.271863+00	StockOut	-1.0000	0.00	INV-202509-0015	1	\N
25	478	2025-09-07 22:23:55.879647+00	StockOut	-1.0000	0.00	INV-202509-0016	1	\N
26	2189	2025-09-07 22:24:06.681335+00	StockOut	-1.0000	0.00	INV-202509-0017	1	\N
27	306	2025-09-07 23:47:50.315487+00	StockOut	-1.0000	0.00	INV-202509-0018	1	\N
28	478	2025-09-08 01:33:50.320864+00	StockOut	-1.0000	0.00	INV-202509-0019	1	\N
29	654	2025-09-08 01:33:58.95491+00	StockOut	-1.0000	0.00	INV-202509-0020	1	\N
30	654	2025-09-08 01:35:03.067613+00	StockOut	-1.0000	0.00	INV-202509-0021	1	\N
31	654	2025-09-08 01:39:24.474559+00	StockOut	-1.0000	0.00	INV-202509-0022	1	\N
32	3685	2025-09-08 01:39:24.474559+00	StockOut	-1.0000	0.00	INV-202509-0022	1	\N
33	901	2025-09-08 01:42:58.677481+00	StockOut	-1.0000	0.00	INV-202509-0023	1	\N
34	2103	2025-09-08 01:56:56.594251+00	StockOut	-1.0000	0.00	INV-202509-0024	1	\N
35	390	2025-09-08 02:33:12.071253+00	StockOut	-1.0000	0.00	INV-202509-0025	1	\N
36	530	2025-09-08 03:58:32.042691+00	StockOut	-1.0000	0.00	INV-202509-0026	1	\N
37	1019	2025-09-08 03:58:32.042691+00	StockOut	-1.0000	0.00	INV-202509-0026	1	\N
38	610	2025-09-08 03:59:13.23672+00	StockOut	-1.0000	0.00	INV-202509-0027	1	\N
39	499	2025-09-08 22:33:58.466904+00	Refund	1.0000	300.00	CN-202509-0005	1	Refund for Invoice #INV-202509-0011
40	478	2025-09-08 22:35:07.774354+00	Refund	1.0000	1105.00	CN-202509-0006	1	Refund for Invoice #INV-202509-0016
41	595	2025-09-08 22:36:00.211636+00	StockOut	-1.0000	0.00	INV-202509-0028	1	\N
42	3025	2025-09-08 23:09:28.659349+00	StockOut	-1.0000	0.00	INV-202509-0029	1	\N
43	653	2025-09-09 00:37:41.78394+00	StockOut	-1.0000	0.00	INV-202509-0030	1	\N
44	480	2025-09-09 00:38:49.728702+00	StockIn	1.0000	235.00	GRN-202509-0001	1	\N
45	3682	2025-09-09 00:38:49.728702+00	StockIn	1.0000	0.00	GRN-202509-0001	1	\N
46	3685	2025-09-09 00:38:49.728702+00	StockIn	1.0000	0.00	GRN-202509-0001	1	\N
47	3686	2025-09-09 00:38:49.728702+00	StockIn	1.0000	0.00	GRN-202509-0001	1	\N
48	712	2025-09-09 00:38:49.728702+00	StockIn	1.0000	218.00	GRN-202509-0001	1	\N
49	710	2025-09-09 00:38:49.728702+00	StockIn	1.0000	324.00	GRN-202509-0001	1	\N
50	70	2025-09-09 00:39:15.541049+00	Adjustment	1.0000	\N	\N	1	
51	766	2025-09-09 00:39:55.066496+00	StockOut	-1.0000	0.00	INV-202509-0031	1	\N
52	640	2025-09-09 01:08:04.287891+00	StockOut	-1.0000	0.00	INV-202509-0032	1	\N
53	1487	2025-09-09 03:08:44.516412+00	StockOut	-1.0000	0.00	INV-202509-0033	1	\N
54	305	2025-09-09 03:08:44.516412+00	StockOut	-1.0000	0.00	INV-202509-0033	1	\N
55	654	2025-09-09 03:08:44.516412+00	StockOut	-1.0000	0.00	INV-202509-0033	1	\N
56	492	2025-09-09 03:08:44.516412+00	StockOut	-1.0000	0.00	INV-202509-0033	1	\N
57	499	2025-09-09 03:08:44.516412+00	StockOut	-1.0000	0.00	INV-202509-0033	1	\N
58	548	2025-09-09 03:08:44.516412+00	StockOut	-1.0000	0.00	INV-202509-0033	1	\N
59	470	2025-09-09 03:08:44.516412+00	StockOut	-1.0000	0.00	INV-202509-0033	1	\N
60	767	2025-09-09 03:08:44.516412+00	StockOut	-1.0000	0.00	INV-202509-0033	1	\N
61	468	2025-09-09 03:08:44.516412+00	StockOut	-1.0000	0.00	INV-202509-0033	1	\N
62	3114	2025-09-09 03:08:44.516412+00	StockOut	-1.0000	0.00	INV-202509-0033	1	\N
63	1473	2025-09-09 03:08:44.516412+00	StockOut	-1.0000	0.00	INV-202509-0033	1	\N
64	653	2025-09-09 03:08:44.516412+00	StockOut	-1.0000	0.00	INV-202509-0033	1	\N
65	1176	2025-09-09 03:08:44.516412+00	StockOut	-2.0000	0.00	INV-202509-0033	1	\N
66	956	2025-09-09 03:08:44.516412+00	StockOut	-1.0000	0.00	INV-202509-0033	1	\N
67	1486	2025-09-09 03:08:44.516412+00	StockOut	-1.0000	0.00	INV-202509-0033	1	\N
68	766	2025-09-09 03:12:26.298569+00	StockIn	1.0000	0.00	INV-202509-0031	1	SYSTEM REVERSAL: Invoice deleted
69	653	2025-09-09 03:26:33.995254+00	StockIn	1.0000	0.00	INV-202509-0030	1	SYSTEM REVERSAL: Invoice deleted
70	3687	2025-09-09 03:28:35.317738+00	StockOut	-1.0000	0.00	INV-202509-0034	1	\N
71	609	2025-09-09 03:29:19.558073+00	StockOut	-1.0000	0.00	INV-202509-0035	1	\N
72	609	2025-09-09 03:30:49.863893+00	StockIn	1.0000	0.00	INV-202509-0035	1	SYSTEM REVERSAL: Invoice deleted
73	640	2025-09-09 03:31:21.203691+00	StockIn	1.0000	0.00	INV-202509-0032	1	SYSTEM REVERSAL: Invoice deleted
74	3687	2025-09-09 03:31:41.945082+00	StockIn	1.0000	0.00	INV-202509-0034	1	SYSTEM REVERSAL: Invoice deleted
75	258	2025-09-09 03:35:00.753608+00	StockOut	-1.0000	0.00	INV-202509-0036	1	\N
76	258	2025-09-09 03:35:17.028206+00	StockIn	1.0000	0.00	INV-202509-0036	1	SYSTEM REVERSAL: Invoice deleted
77	612	2025-09-09 03:35:42.201365+00	StockOut	-1.0000	0.00	INV-202509-0037	1	\N
78	612	2025-09-09 03:35:52.418758+00	StockIn	1.0000	0.00	INV-202509-0037	1	SYSTEM REVERSAL: Invoice deleted
79	595	2025-09-09 03:40:10.500798+00	StockIn	1.0000	0.00	INV-202509-0028	1	SYSTEM REVERSAL: Invoice deleted
80	390	2025-09-09 03:40:41.620319+00	StockIn	1.0000	0.00	INV-202509-0025	1	SYSTEM REVERSAL: Invoice deleted
81	3025	2025-09-09 03:51:07.956089+00	StockIn	1.0000	0.00	INV-202509-0029	1	SYSTEM REVERSAL: Invoice deleted
82	654	2025-09-09 03:51:27.852436+00	Refund	1.0000	370.00	CN-202509-0007	1	Refund for Invoice #INV-202509-0022
83	654	2025-09-09 03:51:39.005826+00	Refund	1.0000	370.00	CN-202509-0008	1	Refund for Invoice #INV-202509-0021
84	654	2025-09-09 03:51:57.915692+00	Refund	1.0000	370.00	CN-202509-0009	1	Refund for Invoice #INV-202509-0020
85	1019	2025-09-09 03:57:23.037593+00	Refund	1.0000	120.00	CN-202509-0010	1	Refund for Invoice #INV-202509-0026
86	2103	2025-09-09 04:06:40.233761+00	StockIn	1.0000	0.00	INV-202509-0024	1	SYSTEM REVERSAL: Invoice deleted
87	901	2025-09-09 04:06:54.546878+00	Refund	1.0000	1100.00	CN-202509-0011	1	Refund for Invoice #INV-202509-0023
88	612	2025-09-09 04:07:31.100338+00	StockOut	-1.0000	0.00	INV-202509-0038	1	\N
89	901	2025-09-09 04:07:46.715321+00	StockOut	-1.0000	0.00	INV-202509-0039	1	\N
90	612	2025-09-09 04:08:07.53697+00	Refund	1.0000	3800.00	CN-202509-0012	1	Refund for Invoice #INV-202509-0038
91	612	2025-09-09 04:08:23.455786+00	StockIn	1.0000	0.00	INV-202509-0038	1	SYSTEM REVERSAL: Invoice deleted
92	901	2025-09-09 04:08:31.668998+00	StockIn	1.0000	0.00	INV-202509-0039	1	SYSTEM REVERSAL: Invoice deleted
93	903	2025-09-09 04:08:40.605893+00	StockOut	-1.0000	0.00	INV-202509-0040	1	\N
94	903	2025-09-09 04:09:03.414488+00	Refund	1.0000	630.00	CN-202509-0013	1	Refund for Invoice #INV-202509-0040
95	903	2025-09-09 04:09:24.728111+00	StockIn	1.0000	0.00	INV-202509-0040	1	SYSTEM REVERSAL: Invoice deleted
96	1001	2025-09-09 04:09:51.559293+00	StockOut	-1.0000	0.00	INV-202509-0041	1	\N
97	1001	2025-09-09 04:22:11.264412+00	Refund	1.0000	1000.00	CN-202509-0014	1	Refund for Invoice #INV-202509-0041
98	478	2025-09-09 04:22:43.225645+00	Refund	1.0000	1105.00	CN-202509-0015	1	Refund for Invoice #INV-202509-0019
99	610	2025-09-09 04:23:30.469185+00	Refund	1.0000	4300.00	CN-202509-0016	1	Refund for Invoice #INV-202509-0027
100	5	2025-09-09 08:20:25.512591+00	StockIn	1.0000	200.00	GRN-202509-0002	1	\N
101	492	2025-09-09 22:19:18.809265+00	Refund	1.0000	1700.00	CN-202509-0017	1	Refund for Invoice #INV-202509-0033
102	1176	2025-09-09 22:19:18.809265+00	Refund	1.0000	450.00	CN-202509-0017	1	Refund for Invoice #INV-202509-0033
105	4	2025-09-09 22:46:15.26505+00	StockOut	-1.0000	450.00	INV-202509-0042	1	\N
106	654	2025-09-09 22:58:15.975524+00	StockOut	-1.0000	0.00	INV-202509-0043	1	\N
107	1042	2025-09-10 00:47:38.110312+00	StockIn	1.0000	480.00	GRN-202509-0005	1	\N
108	490	2025-09-10 00:47:38.110312+00	StockIn	1.0000	160.00	GRN-202509-0005	1	\N
109	1036	2025-09-10 00:55:55.533907+00	StockIn	1.0000	390.00	GRN-202509-0006	1	\N
110	1127	2025-09-10 00:55:55.533907+00	StockIn	1.0000	685.00	GRN-202509-0006	1	\N
111	364	2025-09-10 00:55:55.533907+00	StockIn	1.0000	270.00	GRN-202509-0006	1	\N
112	652	2025-09-10 00:55:55.533907+00	StockIn	1.0000	500.00	GRN-202509-0006	1	\N
113	765	2025-09-10 00:55:55.533907+00	StockIn	1.0000	460.00	GRN-202509-0006	1	\N
114	857	2025-09-10 00:55:55.533907+00	StockIn	1.0000	480.00	GRN-202509-0006	1	\N
115	858	2025-09-10 00:55:55.533907+00	StockIn	1.0000	220.00	GRN-202509-0006	1	\N
116	1043	2025-09-10 00:55:55.533907+00	StockIn	1.0000	460.00	GRN-202509-0006	1	\N
117	613	2025-09-10 00:55:55.533907+00	StockIn	1.0000	18.00	GRN-202509-0006	1	\N
118	766	2025-09-10 00:55:55.533907+00	StockIn	1.0000	0.00	GRN-202509-0006	1	\N
119	697	2025-09-10 00:55:55.533907+00	StockIn	1.0000	240.00	GRN-202509-0006	1	\N
120	1476	2025-09-10 00:55:55.533907+00	StockIn	1.0000	535.00	GRN-202509-0006	1	\N
121	978	2025-09-10 00:55:55.533907+00	StockIn	1.0000	780.00	GRN-202509-0006	1	\N
122	621	2025-09-10 00:55:55.533907+00	StockIn	1.0000	480.00	GRN-202509-0006	1	\N
123	1158	2025-09-10 00:55:55.533907+00	StockIn	1.0000	122.00	GRN-202509-0006	1	\N
124	2781	2025-09-10 00:55:55.533907+00	StockIn	1.0000	21.00	GRN-202509-0006	1	\N
125	1220	2025-09-10 00:55:55.533907+00	StockIn	1.0000	370.00	GRN-202509-0006	1	\N
126	1790	2025-09-10 00:55:55.533907+00	StockIn	1.0000	4300.00	GRN-202509-0006	1	\N
127	2408	2025-09-10 00:55:55.533907+00	StockIn	1.0000	440.00	GRN-202509-0006	1	\N
128	846	2025-09-10 00:55:55.533907+00	StockIn	1.0000	1500.00	GRN-202509-0006	1	\N
129	1052	2025-09-10 00:55:55.533907+00	StockIn	1.0000	714.00	GRN-202509-0006	1	\N
130	816	2025-09-10 00:55:55.533907+00	StockIn	1.0000	240.00	GRN-202509-0006	1	\N
131	1950	2025-09-10 00:55:55.533907+00	StockIn	1.0000	530.00	GRN-202509-0006	1	\N
132	3	2025-09-10 00:55:55.533907+00	StockIn	2.0000	429.00	GRN-202509-0006	1	\N
133	386	2025-09-10 00:55:55.533907+00	StockIn	1.0000	1400.00	GRN-202509-0006	1	\N
134	2262	2025-09-10 00:55:55.533907+00	StockIn	1.0000	765.00	GRN-202509-0006	1	\N
135	476	2025-09-10 00:55:55.533907+00	StockIn	1.0000	535.00	GRN-202509-0006	1	\N
136	717	2025-09-10 00:55:55.533907+00	StockIn	1.0000	539.00	GRN-202509-0006	1	\N
137	6	2025-09-10 00:55:55.533907+00	StockIn	1.0000	511.00	GRN-202509-0006	1	\N
140	4	2025-09-10 02:43:07.512775+00	StockIn	2.0000	500.00	GRN-202509-0004	1	\N
145	4	2025-09-10 02:52:20.285562+00	StockOut	-3.0000	75.83	INV-202509-0044	1	\N
147	4	2025-09-10 02:52:57.018058+00	StockIn	4.0000	6.00	GRN-202509-0003	1	\N
148	3687	2025-09-10 02:57:37.465656+00	StockIn	3.0000	5.00	GRN-202509-0007	1	\N
149	3691	2025-09-12 15:42:35.634757+00	StockOut	-1.0000	0.00	INV-202509-0045	2	\N
150	842	2025-09-13 02:49:55.755657+00	StockOut	-1.0000	0.00	INV-202509-0046	2	\N
151	842	2025-09-13 02:50:16.889993+00	StockOut	-1.0000	0.00	INV-202509-0047	2	\N
152	842	2025-09-13 03:07:30.052491+00	StockOut	-1.0000	0.00	INV-202509-0048	2	\N
153	498	2025-09-13 03:08:10.326338+00	StockOut	-1.0000	0.00	INV-202509-0049	2	\N
154	842	2025-09-13 03:34:09.023643+00	StockOut	-1.0000	0.00	INV-202509-0050	2	\N
155	258	2025-09-13 03:34:23.937702+00	StockOut	-1.0000	0.00	INV-202509-0051	2	\N
156	612	2025-09-13 04:19:33.885579+00	StockOut	-1.0000	0.00	INV-202509-0052	2	\N
157	612	2025-09-13 04:23:35.455989+00	StockOut	-1.0000	0.00	INV-202509-0053	2	\N
158	841	2025-09-13 04:30:38.274936+00	StockOut	-1.0000	0.00	INV-202509-0054	2	\N
159	842	2025-09-13 05:14:23.622281+00	StockOut	-1.0000	0.00	INV-202509-0055	2	\N
160	841	2025-09-13 06:16:46.85498+00	StockOut	-1.0000	0.00	INV-202509-0056	2	\N
161	841	2025-09-13 06:16:53.776374+00	StockOut	-1.0000	0.00	INV-202509-0057	2	\N
162	843	2025-09-13 06:17:38.598415+00	StockOut	-1.0000	0.00	INV-202509-0058	2	\N
163	843	2025-09-13 06:19:13.725859+00	StockOut	-1.0000	0.00	INV-202509-0059	2	\N
164	595	2025-09-13 07:39:43.400357+00	StockOut	-1.0000	0.00	INV-202509-0060	2	\N
165	595	2025-09-13 07:41:04.57588+00	StockOut	-1.0000	0.00	INV-202509-0061	2	\N
166	1525	2025-09-13 08:58:58.512868+00	StockOut	-1.0000	0.00	INV-202509-0062	2	\N
167	767	2025-09-13 09:00:42.398758+00	StockOut	-1.0000	0.00	INV-202509-0063	2	\N
168	1110	2025-09-13 09:36:04.161642+00	StockOut	-1.0000	0.00	INV-202509-0064	1	\N
169	1014	2025-09-13 09:36:27.28476+00	StockOut	-1.0000	0.00	INV-202509-0065	1	\N
170	842	2025-09-13 10:00:15.204127+00	StockOut	-1.0000	0.00	INV-202509-0066	1	\N
171	703	2025-09-13 10:00:34.137805+00	StockOut	-1.0000	0.00	INV-202509-0067	1	\N
172	703	2025-09-13 10:02:19.950426+00	StockOut	-1.0000	0.00	INV-202509-0068	1	\N
173	2054	2025-09-13 10:32:49.45647+00	StockOut	-1.0000	0.00	INV-202509-0069	1	\N
174	704	2025-09-13 13:38:28.993387+00	StockOut	-1.0000	0.00	INV-202509-0070	1	\N
175	519	2025-09-13 13:39:44.316236+00	StockOut	-1.0000	0.00	INV-202509-0071	1	\N
176	1326	2025-09-13 13:56:37.958838+00	StockOut	-1.0000	0.00	INV-202509-0072	1	\N
177	1326	2025-09-13 13:57:27.674059+00	StockOut	-1.0000	0.00	INV-202509-0073	1	\N
178	1326	2025-09-13 14:14:31.411287+00	StockOut	-1.0000	0.00	INV-202509-0074	1	\N
179	841	2025-09-13 14:46:00.134243+00	StockOut	-1.0000	0.00	INV-202509-0075	1	\N
180	392	2025-09-13 14:47:03.169905+00	StockOut	-1.0000	0.00	INV-202509-0076	1	\N
181	1043	2025-09-13 14:48:05.932063+00	StockOut	-1.0000	460.00	INV-202509-0077	1	\N
182	491	2025-09-13 14:50:38.120025+00	StockOut	-1.0000	0.00	INV-202509-0078	1	\N
183	491	2025-09-13 15:04:03.78195+00	StockOut	-1.0000	0.00	INV-202509-0079	1	\N
184	491	2025-09-13 15:04:08.412272+00	StockOut	-1.0000	0.00	INV-202509-0080	1	\N
185	498	2025-09-13 15:05:17.059499+00	StockOut	-1.0000	0.00	INV-202509-0081	1	\N
186	498	2025-09-13 15:05:50.409663+00	StockOut	-1.0000	0.00	INV-202509-0082	1	\N
187	3687	2025-09-13 15:06:32.042597+00	StockOut	-1.0000	5.00	INV-202509-0083	1	\N
188	841	2025-09-13 19:16:16.659984+00	StockOut	-1.0000	0.00	INV-202509-0084	1	\N
189	392	2025-09-13 19:17:13.649304+00	StockOut	-1.0000	0.00	INV-202509-0085	1	\N
190	365	2025-09-13 19:18:06.50081+00	StockOut	-1.0000	0.00	INV-202509-0086	1	\N
191	1045	2025-09-13 19:18:40.240425+00	StockOut	-1.0000	0.00	INV-202509-0087	1	\N
192	306	2025-09-13 19:34:07.406508+00	StockOut	-1.0000	0.00	INV-202509-0088	1	\N
193	842	2025-09-13 22:29:18.428639+00	StockOut	-1.0000	0.00	INV-202509-0089	1	\N
194	842	2025-09-13 22:38:45.293444+00	Refund	1.0000	290.00	CN-202509-0018	1	Refund for Invoice #INV-202509-0089
195	306	2025-09-13 22:39:00.00876+00	Refund	1.0000	670.00	CN-202509-0019	1	Refund for Invoice #INV-202509-0088
196	1983	2025-09-13 23:04:42.206706+00	StockOut	-1.0000	0.00	INV-202509-0090	1	\N
197	1983	2025-09-13 23:14:02.738764+00	Refund	1.0000	1450.00	CN-202509-0020	1	Refund for Invoice #INV-202509-0090
198	498	2025-09-13 23:26:13.041019+00	StockOut	-1.0000	0.00	INV-202509-0091	1	\N
199	498	2025-09-13 23:26:16.751078+00	StockOut	-1.0000	0.00	INV-202509-0092	1	\N
200	498	2025-09-13 23:26:19.626295+00	StockOut	-1.0000	0.00	INV-202509-0093	1	\N
201	498	2025-09-13 23:26:23.030833+00	StockOut	-1.0000	0.00	INV-202509-0094	1	\N
202	498	2025-09-13 23:26:35.464437+00	StockOut	-1.0000	0.00	INV-202509-0095	1	\N
203	498	2025-09-13 23:26:44.861318+00	StockOut	-1.0000	0.00	INV-202509-0096	1	\N
204	306	2025-09-13 23:41:16.310648+00	StockOut	-1.0000	0.00	INV-202509-0097	1	\N
205	306	2025-09-13 23:41:20.666638+00	StockOut	-1.0000	0.00	INV-202509-0098	1	\N
206	306	2025-09-13 23:41:34.094047+00	StockOut	-1.0000	0.00	INV-202509-0099	1	\N
207	306	2025-09-13 23:45:11.212534+00	StockOut	-1.0000	0.00	INV-202509-0100	1	\N
208	491	2025-09-13 23:45:46.668901+00	StockOut	-1.0000	0.00	INV-202509-0101	1	\N
209	704	2025-09-14 00:11:17.206722+00	StockOut	-1.0000	0.00	INV-202509-0102	1	\N
210	704	2025-09-14 00:11:30.023126+00	StockOut	-1.0000	0.00	INV-202509-0103	1	\N
211	368	2025-09-14 00:17:37.112766+00	StockOut	-1.0000	0.00	INV-202509-0104	1	\N
212	2260	2025-09-14 00:18:03.851208+00	StockOut	-1.0000	0.00	INV-202509-0105	1	\N
213	1983	2025-09-14 00:19:13.018399+00	StockOut	-1.0000	0.00	INV-202509-0106	1	\N
214	703	2025-09-14 00:19:35.849156+00	StockOut	-1.0000	0.00	INV-202509-0107	1	\N
215	651	2025-09-14 00:23:33.262471+00	StockOut	-1.0000	0.00	INV-202509-0108	1	\N
216	491	2025-09-14 02:29:12.59327+00	StockOut	-1.0000	0.00	INV-202509-0109	1	\N
217	491	2025-09-14 02:29:49.84777+00	StockOut	-1.0000	0.00	INV-202509-0110	1	\N
218	703	2025-09-14 02:30:25.900816+00	StockOut	-1.0000	0.00	INV-202509-0111	1	\N
219	498	2025-09-14 02:31:47.604207+00	StockOut	-1.0000	0.00	INV-202509-0112	1	\N
220	5	2025-09-14 03:20:18.880124+00	StockOut	-1.0000	200.00	INV-202509-0113	1	\N
221	631	2025-09-14 03:23:52.532444+00	StockOut	-1.0000	0.00	INV-202509-0114	1	\N
222	364	2025-09-14 03:24:20.470766+00	StockOut	-1.0000	270.00	INV-202509-0115	1	\N
223	3640	2025-09-14 03:24:39.009942+00	StockOut	-1.0000	0.00	INV-202509-0116	1	\N
224	3640	2025-09-14 03:50:04.444856+00	StockIn	1.0000	0.00	INV-202509-0116	1	SYSTEM REVERSAL: Invoice deleted
225	364	2025-09-14 03:50:09.349506+00	StockIn	1.0000	270.00	INV-202509-0115	1	SYSTEM REVERSAL: Invoice deleted
226	653	2025-09-14 22:00:23.47371+00	StockOut	-1.0000	0.00	INV-202509-0117	1	\N
227	469	2025-09-14 22:01:06.638788+00	StockOut	-1.0000	0.00	INV-202509-0118	1	\N
228	653	2025-09-14 22:01:27.599537+00	Refund	1.0000	350.00	CN-202509-0021	1	Refund for Invoice #INV-202509-0117
229	1017	2025-09-14 22:02:04.008164+00	StockOut	-1.0000	0.00	INV-202509-0119	1	\N
230	631	2025-09-14 22:02:04.008164+00	StockOut	-1.0000	0.00	INV-202509-0119	1	\N
231	631	2025-09-14 22:02:40.25695+00	Refund	1.0000	1100.00	CN-202509-0022	1	Refund for Invoice #INV-202509-0119
232	766	2025-09-14 22:03:41.097701+00	StockOut	-1.0000	0.00	INV-202509-0120	1	\N
233	653	2025-09-14 22:03:41.097701+00	StockOut	-1.0000	0.00	INV-202509-0120	1	\N
234	653	2025-09-14 22:04:07.734348+00	Refund	1.0000	350.00	CN-202509-0023	1	Refund for Invoice #INV-202509-0120
235	307	2025-09-14 22:07:26.396127+00	StockOut	-1.0000	0.00	INV-202509-0121	1	\N
236	917	2025-09-14 22:08:27.271047+00	StockOut	-1.0000	0.00	INV-202509-0122	1	\N
237	491	2025-09-14 22:09:00.605242+00	StockOut	-1.0000	0.00	INV-202509-0123	1	\N
238	766	2025-09-14 22:09:33.458039+00	StockOut	-1.0000	0.00	INV-202509-0124	1	\N
239	387	2025-09-14 22:11:18.379883+00	StockOut	-1.0000	0.00	INV-202509-0125	1	\N
240	766	2025-09-14 22:12:39.498427+00	StockOut	-1.0000	0.00	INV-202509-0126	1	\N
241	387	2025-09-14 22:12:55.314013+00	StockIn	1.0000	0.00	INV-202509-0125	1	SYSTEM REVERSAL: Invoice deleted
242	498	2025-09-14 22:15:59.075996+00	StockOut	-1.0000	0.00	INV-202509-0127	1	\N
243	842	2025-09-14 22:16:56.411291+00	StockOut	-1.0000	0.00	INV-202509-0128	1	\N
244	655	2025-09-14 22:16:56.411291+00	StockOut	-1.0000	0.00	INV-202509-0128	1	\N
245	548	2025-09-14 22:17:47.694627+00	StockOut	-1.0000	0.00	INV-202509-0129	1	\N
246	703	2025-09-14 22:22:20.89067+00	StockOut	-1.0000	0.00	INV-202509-0130	1	\N
247	843	2025-09-14 22:22:30.204052+00	StockOut	-1.0000	0.00	INV-202509-0131	1	\N
248	766	2025-09-14 22:23:20.260753+00	Refund	1.0000	800.00	CN-202509-0024	1	Refund for Invoice #INV-202509-0124
249	766	2025-09-14 22:24:05.921351+00	StockIn	1.0000	0.00	INV-202509-0124	1	SYSTEM REVERSAL: Invoice deleted
250	654	2025-09-14 22:32:12.94429+00	StockOut	-1.0000	0.00	INV-202509-0132	1	\N
251	654	2025-09-14 22:32:47.316817+00	StockIn	1.0000	0.00	INV-202509-0132	1	SYSTEM REVERSAL: Invoice deleted
252	631	2025-09-14 22:33:19.237963+00	StockOut	-1.0000	0.00	INV-202509-0133	1	\N
253	654	2025-09-14 22:36:47.420439+00	StockOut	-1.0000	0.00	INV-202509-0134	1	\N
254	498	2025-09-14 22:50:48.318322+00	StockOut	-1.0000	0.00	INV-202509-0135	1	\N
255	655	2025-09-14 22:51:31.556836+00	StockOut	-1.0000	0.00	INV-202509-0136	1	\N
256	703	2025-09-15 00:16:35.052182+00	StockOut	-1.0000	0.00	INV-202509-0137	1	\N
257	703	2025-09-15 00:19:11.420632+00	StockOut	-1.0000	0.00	INV-202509-0138	1	\N
258	703	2025-09-15 00:56:22.816866+00	StockOut	-1.0000	0.00	INV-202509-0139	1	\N
259	703	2025-09-15 01:11:45.006023+00	StockOut	-1.0000	0.00	INV-202509-0140	1	\N
260	703	2025-09-15 01:12:05.857513+00	StockOut	-1.0000	0.00	INV-202509-0141	1	\N
261	703	2025-09-15 01:46:22.159757+00	StockOut	-1.0000	0.00	INV-202509-0142	1	\N
262	703	2025-09-15 01:46:41.782618+00	StockOut	-1.0000	0.00	INV-202509-0143	1	\N
263	654	2025-09-15 01:54:09.850426+00	StockOut	-1.0000	0.00	INV-202509-0144	1	\N
264	631	2025-09-15 01:54:09.850426+00	StockOut	-1.0000	0.00	INV-202509-0144	1	\N
265	654	2025-09-15 01:54:24.175971+00	StockOut	-1.0000	0.00	INV-202509-0145	1	\N
266	631	2025-09-15 01:54:24.175971+00	StockOut	-1.0000	0.00	INV-202509-0145	1	\N
267	2390	2025-09-15 01:55:17.45871+00	StockOut	-1.0000	0.00	INV-202509-0146	1	\N
268	2390	2025-09-15 02:31:20.470795+00	StockOut	-1.0000	0.00	INV-202509-0147	1	\N
269	704	2025-09-15 02:31:20.470795+00	StockOut	-1.0000	0.00	INV-202509-0147	1	\N
270	1043	2025-09-15 02:32:01.015994+00	StockOut	-1.0000	460.00	INV-202509-0148	1	\N
271	631	2025-09-15 02:35:42.503064+00	StockOut	-1.0000	0.00	INV-202509-0149	1	\N
272	704	2025-09-15 02:36:05.540763+00	StockOut	-1.0000	0.00	INV-202509-0150	1	\N
273	1831	2025-09-15 02:37:55.325076+00	StockOut	-1.0000	0.00	INV-202509-0151	1	\N
274	1042	2025-09-15 03:22:04.08162+00	StockOut	-1.0000	480.00	INV-202509-0152	1	\N
275	1042	2025-09-15 03:27:35.139874+00	StockOut	-1.0000	480.00	INV-202509-0153	1	\N
276	631	2025-09-15 03:27:55.300368+00	StockOut	-1.0000	0.00	INV-202509-0154	1	\N
277	703	2025-09-15 03:28:34.748449+00	StockOut	-1.0000	0.00	INV-202509-0155	1	\N
278	631	2025-09-15 03:29:54.036947+00	StockOut	-1.0000	0.00	INV-202509-0156	1	\N
279	3638	2025-09-15 03:30:34.201146+00	StockOut	-1.0000	0.00	INV-202509-0157	1	\N
280	631	2025-09-15 03:31:22.151872+00	StockOut	-1.0000	0.00	INV-202509-0158	1	\N
281	307	2025-09-15 03:59:51.06214+00	StockOut	-1.0000	0.00	INV-202509-0159	1	\N
282	498	2025-09-15 04:44:53.784736+00	StockOut	-1.0000	0.00	INV-202509-0160	1	\N
283	631	2025-09-15 04:56:42.829501+00	StockOut	-1.0000	0.00	INV-202509-0161	1	\N
284	841	2025-09-15 05:24:46.555038+00	StockOut	-1.0000	0.00	INV-202509-0162	1	\N
285	498	2025-09-15 05:25:05.355965+00	StockOut	-1.0000	0.00	INV-202509-0163	1	\N
286	3640	2025-09-15 05:25:48.586752+00	StockOut	-1.0000	0.00	INV-202509-0164	1	\N
287	3640	2025-09-15 05:25:59.712399+00	StockIn	1.0000	0.00	INV-202509-0164	1	SYSTEM REVERSAL: Invoice deleted
288	841	2025-09-15 05:26:10.328939+00	StockIn	1.0000	0.00	INV-202509-0162	1	SYSTEM REVERSAL: Invoice deleted
289	704	2025-09-15 05:26:43.811905+00	StockOut	-1.0000	0.00	INV-202509-0165	1	\N
290	631	2025-09-15 06:06:13.922898+00	StockOut	-1.0000	0.00	INV-202509-0166	1	\N
\.


--
-- Data for Name: invoice; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.invoice (invoice_id, invoice_number, customer_id, employee_id, invoice_date, total_amount, amount_paid, status, terms, payment_terms_days, due_date, physical_receipt_no) FROM stdin;
2	INV-202509-0002	1	1	2025-09-06 23:58:16.240282+00	200.00	200.00	Paid	\N	\N	\N	\N
3	INV-202509-0003	2	1	2025-09-06 23:58:58.337003+00	12000.00	12000.00	Fully Refunded	0	0	\N	\N
47	INV-202509-0047	1	2	2025-09-13 02:50:16.889993+00	290.00	0.00	Paid	\N	\N	\N	\N
102	INV-202509-0102	1	1	2025-09-14 00:11:17.206722+00	620.00	0.00	Unpaid	\N	\N	\N	\N
104	INV-202509-0104	1	1	2025-09-14 00:17:37.112766+00	250.00	0.00	Unpaid	\N	\N	\N	\N
7	INV-202509-0007	2	1	2025-09-07 01:37:37.069656+00	350.00	350.00	Paid	\N	\N	\N	\N
134	INV-202509-0134	1	1	2025-09-14 22:36:47.420439+00	370.00	370.00	Paid	0	0	\N	\N
5	INV-202509-0005	1	1	2025-09-07 00:21:54.999822+00	560.00	560.00	Fully Refunded	\N	\N	\N	\N
4	INV-202509-0004	2	1	2025-09-07 00:13:42.614755+00	200.00	0.00	Fully Refunded	0	0	\N	\N
108	INV-202509-0108	2	1	2025-09-14 00:23:33.262471+00	210.00	0.00	Unpaid	0	0	\N	\N
22	INV-202509-0022	1	1	2025-09-08 01:39:24.474559+00	370.00	370.00	Fully Refunded	\N	\N	\N	\N
8	INV-202509-0008	2	1	2025-09-07 01:37:56.005932+00	500.00	0.00	Paid	0	0	\N	\N
13	INV-202509-0013	1	1	2025-09-07 15:59:03.674145+00	430.00	430.00	Paid	\N	\N	\N	SI-1002
14	INV-202509-0014	1	1	2025-09-07 15:59:24.715166+00	280.00	280.00	Paid	\N	\N	\N	\N
15	INV-202509-0015	1	1	2025-09-07 16:05:41.271863+00	840.00	840.00	Paid	\N	\N	\N	\N
17	INV-202509-0017	1	1	2025-09-07 22:24:06.681335+00	30.00	30.00	Paid	\N	\N	\N	\N
21	INV-202509-0021	1	1	2025-09-08 01:35:03.067613+00	370.00	370.00	Fully Refunded	\N	\N	\N	\N
20	INV-202509-0020	1	1	2025-09-08 01:33:58.95491+00	370.00	370.00	Fully Refunded	\N	\N	\N	\N
26	INV-202509-0026	1	1	2025-09-08 03:58:32.042691+00	680.00	680.00	Partially Refunded	\N	\N	\N	SI-4312
23	INV-202509-0023	1	1	2025-09-08 01:42:58.677481+00	1100.00	1100.00	Fully Refunded	\N	\N	\N	\N
18	INV-202509-0018	1	1	2025-09-07 23:47:50.315487+00	670.00	670.00	Paid	\N	\N	\N	\N
110	INV-202509-0110	3	1	2025-09-14 02:29:49.84777+00	350.00	0.00	Unpaid	0	0	\N	\N
118	INV-202509-0118	3	1	2025-09-14 22:01:06.638788+00	580.00	580.00	Paid	0	0	\N	CI-7469
106	INV-202509-0106	1	1	2025-09-14 00:19:13.018399+00	1450.00	1450.00	Paid	\N	\N	\N	DR-9756
112	INV-202509-0112	3	1	2025-09-14 02:31:47.604207+00	830.00	830.00	Paid	0	0	\N	\N
114	INV-202509-0114	1	1	2025-09-14 03:23:52.532444+00	1100.00	1100.00	Paid	\N	\N	\N	\N
128	INV-202509-0128	3	1	2025-09-14 22:16:56.411291+00	570.00	570.00	Paid	0	0	\N	DR-8743
120	INV-202509-0120	3	1	2025-09-14 22:03:41.097701+00	1150.00	1150.00	Paid	0	0	\N	\N
122	INV-202509-0122	1	1	2025-09-14 22:08:27.271047+00	650.00	650.00	Paid	0	0	\N	\N
126	INV-202509-0126	3	1	2025-09-14 22:12:39.498427+00	800.00	800.00	Paid	0	0	\N	CI-7894
130	INV-202509-0130	2	1	2025-09-14 22:22:20.89067+00	900.00	900.00	Paid	0	0	\N	\N
140	INV-202509-0140	1	1	2025-09-15 01:11:45.006023+00	900.00	0.00	Unpaid	\N	\N	\N	\N
136	INV-202509-0136	2	1	2025-09-14 22:51:31.556836+00	280.00	0.00	Unpaid	0	0	\N	VAT-165
11	INV-202509-0011	2	1	2025-09-07 02:09:05.973158+00	300.00	300.00	Fully Refunded	0	0	\N	\N
16	INV-202509-0016	2	1	2025-09-07 22:23:55.879647+00	1105.00	0.00	Fully Refunded	0	0	\N	ci 4563
138	INV-202509-0138	1	1	2025-09-15 00:19:11.420632+00	900.00	0.00	Unpaid	\N	\N	\N	\N
142	INV-202509-0142	1	1	2025-09-15 01:46:22.159757+00	900.00	0.00	Unpaid	\N	\N	\N	\N
144	INV-202509-0144	1	1	2025-09-15 01:54:09.850426+00	1470.00	0.00	Unpaid	\N	\N	\N	\N
146	INV-202509-0146	1	1	2025-09-15 01:55:17.45871+00	900.00	0.00	Unpaid	\N	\N	\N	\N
148	INV-202509-0148	1	1	2025-09-15 02:32:01.015994+00	800.00	0.00	Unpaid	\N	\N	\N	558848888451
152	INV-202509-0152	3	1	2025-09-15 03:22:04.08162+00	900.00	0.00	Unpaid	0	0	\N	DR-4652
150	INV-202509-0150	1	1	2025-09-15 02:36:05.540763+00	620.00	620.00	Paid	\N	\N	\N	DR-4612
41	INV-202509-0041	1	1	2025-09-09 04:09:51.559293+00	1000.00	1000.00	Fully Refunded	\N	\N	\N	\N
19	INV-202509-0019	1	1	2025-09-08 01:33:50.320864+00	1105.00	1105.00	Fully Refunded	\N	\N	\N	\N
27	INV-202509-0027	1	1	2025-09-08 03:59:13.23672+00	4300.00	4300.00	Fully Refunded	\N	\N	\N	\N
33	INV-202509-0033	1	1	2025-09-09 03:08:44.516412+00	19340.01	19340.01	Partially Refunded	\N	\N	\N	\N
42	INV-202509-0042	1	1	2025-09-09 22:46:15.26505+00	650.00	650.00	Paid	\N	\N	\N	\N
43	INV-202509-0043	1	1	2025-09-09 22:58:15.975524+00	370.00	370.00	Paid	\N	\N	\N	\N
44	INV-202509-0044	1	1	2025-09-10 02:52:20.285562+00	21.00	21.00	Paid	\N	\N	\N	\N
45	INV-202509-0045	1	2	2025-09-12 15:42:35.634757+00	41.00	41.00	Paid	\N	\N	\N	TEST
1	INV-202509-0001	1	1	2025-09-06 23:58:09.595563+00	430.00	0.00	Unpaid	\N	\N	\N	\N
154	INV-202509-0153	3	1	2025-09-15 03:27:35.139874+00	900.00	900.00	Paid	0	0	\N	DR-4653
60	INV-202509-0060	1	2	2025-09-13 07:39:43.400357+00	1230.00	0.00	Paid	0	0	\N	\N
91	INV-202509-0091	1	1	2025-09-13 23:26:13.041019+00	830.00	0.00	Paid	0	0	\N	\N
92	INV-202509-0092	1	1	2025-09-13 23:26:16.751078+00	830.00	0.00	Paid	0	0	\N	\N
93	INV-202509-0093	1	1	2025-09-13 23:26:19.626295+00	830.00	0.00	Paid	0	0	\N	\N
94	INV-202509-0094	1	1	2025-09-13 23:26:23.030833+00	830.00	0.00	Paid	0	0	\N	\N
54	INV-202509-0054	1	2	2025-09-13 04:30:38.274936+00	1200.00	1200.00	Paid	\N	\N	\N	DR-6479
55	INV-202509-0055	2	2	2025-09-13 05:14:23.622281+00	290.00	0.00	Paid	0	0	\N	DR-3126
56	INV-202509-0056	2	2	2025-09-13 06:16:46.85498+00	1200.00	0.00	Paid	0	0	\N	\N
62	INV-202509-0062	1	2	2025-09-13 08:58:58.512868+00	790.00	790.00	Paid	\N	\N	\N	\N
58	INV-202509-0058	2	2	2025-09-13 06:17:38.598415+00	600.00	0.00	Paid	0	0	\N	\N
64	INV-202509-0064	1	1	2025-09-13 09:36:04.161642+00	980.00	980.00	Paid	\N	\N	\N	SI-9762
59	INV-202509-0059	2	2	2025-09-13 06:19:13.725859+00	600.00	0.00	Paid	0	0	\N	\N
66	INV-202509-0066	1	1	2025-09-13 10:00:15.204127+00	290.00	290.00	Paid	\N	\N	\N	\N
72	INV-202509-0072	2	1	2025-09-13 13:56:37.958838+00	2800.00	0.00	Paid	0	0	\N	\N
68	INV-202509-0068	1	1	2025-09-13 10:02:19.950426+00	900.00	900.00	Paid	\N	\N	\N	DR-1234
74	INV-202509-0074	2	1	2025-09-13 14:14:31.411287+00	2800.00	0.00	Paid	0	0	\N	\N
70	INV-202509-0070	1	1	2025-09-13 13:38:28.993387+00	620.00	620.00	Paid	\N	\N	\N	\N
75	INV-202509-0075	2	1	2025-09-13 14:46:00.134243+00	1200.00	0.00	Paid	0	0	\N	\N
77	INV-202509-0077	2	1	2025-09-13 14:48:05.932063+00	800.00	0.00	Paid	0	0	\N	\N
78	INV-202509-0078	2	1	2025-09-13 14:50:38.120025+00	350.00	0.00	Paid	0	0	\N	\N
79	INV-202509-0079	2	1	2025-09-13 15:04:03.78195+00	350.00	0.00	Paid	0	0	\N	\N
80	INV-202509-0080	2	1	2025-09-13 15:04:08.412272+00	350.00	0.00	Paid	0	0	\N	\N
87	INV-202509-0087	2	1	2025-09-13 19:18:40.240425+00	450.00	0.00	Paid	0	0	\N	CI-7986
46	INV-202509-0046	1	2	2025-09-13 02:49:55.755657+00	290.00	290.00	Paid	\N	\N	\N	\N
48	INV-202509-0048	1	2	2025-09-13 03:07:30.052491+00	290.00	290.00	Paid	\N	\N	\N	\N
49	INV-202509-0049	1	2	2025-09-13 03:08:10.326338+00	830.00	830.00	Paid	\N	\N	\N	SI-4567
50	INV-202509-0050	1	2	2025-09-13 03:34:09.023643+00	290.00	290.00	Paid	\N	\N	\N	\N
51	INV-202509-0051	1	2	2025-09-13 03:34:23.937702+00	141.00	141.00	Paid	0	0	\N	\N
52	INV-202509-0052	1	2	2025-09-13 04:19:33.885579+00	3800.00	3800.00	Paid	Due upon receipt	0	\N	VAT-456
53	INV-202509-0053	1	2	2025-09-13 04:23:35.455989+00	3800.00	3800.00	Paid	\N	\N	\N	DR-4562
57	INV-202509-0057	2	2	2025-09-13 06:16:53.776374+00	1200.00	1200.00	Paid	0	0	\N	\N
61	INV-202509-0061	1	2	2025-09-13 07:41:04.57588+00	1230.00	1230.00	Paid	0	0	\N	\N
63	INV-202509-0063	1	2	2025-09-13 09:00:42.398758+00	800.00	800.00	Paid	0	0	\N	\N
65	INV-202509-0065	1	1	2025-09-13 09:36:27.28476+00	200.00	200.00	Paid	0	0	\N	\N
67	INV-202509-0067	2	1	2025-09-13 10:00:34.137805+00	900.00	900.00	Paid	0	0	\N	\N
69	INV-202509-0069	2	1	2025-09-13 10:32:49.45647+00	2400.00	2400.00	Paid	0	0	\N	\N
71	INV-202509-0071	2	1	2025-09-13 13:39:44.316236+00	240.00	240.00	Paid	0	0	\N	\N
73	INV-202509-0073	2	1	2025-09-13 13:57:27.674059+00	2800.00	2800.00	Paid	0	0	\N	RCPT-001
76	INV-202509-0076	2	1	2025-09-13 14:47:03.169905+00	550.00	550.00	Paid	0	0	\N	\N
81	INV-202509-0081	2	1	2025-09-13 15:05:17.059499+00	830.00	830.00	Paid	0	0	\N	\N
82	INV-202509-0082	1	1	2025-09-13 15:05:50.409663+00	830.00	830.00	Paid	0	0	\N	\N
83	INV-202509-0083	2	1	2025-09-13 15:06:32.042597+00	6.00	6.00	Paid	0	0	\N	\N
84	INV-202509-0084	2	1	2025-09-13 19:16:16.659984+00	1200.00	1200.00	Paid	0	0	\N	SI-4596
85	INV-202509-0085	2	1	2025-09-13 19:17:13.649304+00	550.00	550.00	Paid	0	0	\N	CI-4932
86	INV-202509-0086	2	1	2025-09-13 19:18:06.50081+00	310.00	310.00	Paid	0	0	\N	CI-6753
88	INV-202509-0088	2	1	2025-09-13 19:34:07.406508+00	670.00	670.00	Paid	0	0	\N	CI-4567
89	INV-202509-0089	2	1	2025-09-13 22:29:18.428639+00	290.00	290.00	Paid	0	0	\N	\N
90	INV-202509-0090	2	1	2025-09-13 23:04:42.206706+00	1450.00	1450.00	Paid	0	0	\N	\N
100	INV-202509-0100	2	1	2025-09-13 23:45:11.212534+00	670.00	670.00	Paid	0	0	\N	\N
103	INV-202509-0103	1	1	2025-09-14 00:11:30.023126+00	620.00	0.00	Unpaid	\N	\N	\N	\N
95	INV-202509-0095	1	1	2025-09-13 23:26:35.464437+00	830.00	0.00	Paid	0	0	\N	\N
96	INV-202509-0096	1	1	2025-09-13 23:26:44.861318+00	830.00	0.00	Paid	0	0	\N	\N
101	INV-202509-0101	1	1	2025-09-13 23:45:46.668901+00	350.00	0.00	Paid	0	0	\N	\N
97	INV-202509-0097	2	1	2025-09-13 23:41:16.310648+00	670.00	0.00	Paid	0	0	\N	\N
98	INV-202509-0098	2	1	2025-09-13 23:41:20.666638+00	670.00	0.00	Paid	0	0	\N	\N
99	INV-202509-0099	2	1	2025-09-13 23:41:34.094047+00	670.00	0.00	Paid	0	0	\N	\N
105	INV-202509-0105	1	1	2025-09-14 00:18:03.851208+00	6000.00	6000.00	Paid	\N	\N	\N	\N
131	INV-202509-0131	1	1	2025-09-14 22:22:30.204052+00	600.00	600.00	Paid	\N	\N	\N	\N
111	INV-202509-0111	3	1	2025-09-14 02:30:25.900816+00	900.00	900.00	Paid	0	0	\N	\N
133	INV-202509-0133	2	1	2025-09-14 22:33:19.237963+00	1100.00	1100.00	Paid	0	0	\N	\N
109	INV-202509-0109	3	1	2025-09-14 02:29:12.59327+00	350.00	350.00	Paid	0	0	\N	\N
107	INV-202509-0107	1	1	2025-09-14 00:19:35.849156+00	900.00	900.00	Paid	\N	\N	\N	\N
129	INV-202509-0129	2	1	2025-09-14 22:17:47.694627+00	150.00	150.00	Paid	0	0	\N	DR-6482
113	INV-202509-0113	2	1	2025-09-14 03:20:18.880124+00	200.00	200.00	Paid	0	0	\N	\N
135	INV-202509-0135	2	1	2025-09-14 22:50:48.318322+00	830.00	830.00	Paid	0	0	\N	\N
137	INV-202509-0137	1	1	2025-09-15 00:16:35.052182+00	900.00	0.00	Unpaid	\N	\N	\N	\N
139	INV-202509-0139	1	1	2025-09-15 00:56:22.816866+00	900.00	0.00	Unpaid	\N	\N	\N	\N
117	INV-202509-0117	1	1	2025-09-14 22:00:23.47371+00	350.00	350.00	Fully Refunded	\N	\N	\N	\N
141	INV-202509-0141	1	1	2025-09-15 01:12:05.857513+00	900.00	0.00	Unpaid	\N	\N	\N	\N
119	INV-202509-0119	2	1	2025-09-14 22:02:04.008164+00	1380.00	1380.00	Partially Refunded	0	0	\N	\N
143	INV-202509-0143	1	1	2025-09-15 01:46:41.782618+00	900.00	900.00	Paid	\N	\N	\N	897979994451
121	INV-202509-0121	2	1	2025-09-14 22:07:26.396127+00	550.00	550.00	Paid	0	0	\N	\N
123	INV-202509-0123	2	1	2025-09-14 22:09:00.605242+00	350.00	350.00	Paid	0	0	\N	\N
127	INV-202509-0127	2	1	2025-09-14 22:15:59.075996+00	830.00	830.00	Paid	0	0	\N	\N
145	INV-202509-0145	1	1	2025-09-15 01:54:24.175971+00	1470.00	1470.00	Paid	\N	\N	\N	DR-5123
158	INV-202509-0157	2	1	2025-09-15 03:30:34.201146+00	450.00	450.00	Paid	0	0	\N	CI-8881
147	INV-202509-0147	1	1	2025-09-15 02:31:20.470795+00	1520.00	1520.00	Paid	\N	\N	\N	8979797975
164	INV-202509-0163	3	1	2025-09-15 05:25:05.355965+00	830.00	830.00	Paid	0	0	\N	\N
149	INV-202509-0149	1	1	2025-09-15 02:35:42.503064+00	1100.00	1100.00	Paid	\N	\N	\N	DR-5746
151	INV-202509-0151	2	1	2025-09-15 02:37:55.325076+00	1000.00	1000.00	Paid	0	0	\N	DR-4455
159	INV-202509-0158	2	1	2025-09-15 03:31:22.151872+00	1100.00	1100.00	Paid	0	0	\N	CI-9955
162	INV-202509-0161	3	1	2025-09-15 04:56:42.829501+00	1100.00	1100.00	Paid	0	0	\N	CI-7787
155	INV-202509-0154	3	1	2025-09-15 03:27:55.300368+00	1100.00	1100.00	Paid	Due upon receipt	0	\N	DR-4654
156	INV-202509-0155	2	1	2025-09-15 03:28:34.748449+00	900.00	900.00	Paid	0	0	\N	DR-5484
157	INV-202509-0156	2	1	2025-09-15 03:29:54.036947+00	1100.00	1100.00	Paid	0	0	\N	\N
160	INV-202509-0159	1	1	2025-09-15 03:59:51.06214+00	550.00	550.00	Paid	0	0	\N	CI-8555
166	INV-202509-0165	4	1	2025-09-15 05:26:43.811905+00	620.00	620.00	Paid	0	0	\N	CI-8885
161	INV-202509-0160	3	1	2025-09-15 04:44:53.784736+00	830.00	830.00	Paid	0	0	\N	CI-4562
167	INV-202509-0166	4	1	2025-09-15 06:06:13.922898+00	1100.00	1500.00	Paid	0	0	\N	CI-9991
\.


--
-- Data for Name: invoice_line; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.invoice_line (invoice_line_id, invoice_id, part_id, quantity, sale_price, cost_at_sale, discount_amount) FROM stdin;
1	1	480	1.0000	430.00	0.00	\N
2	2	1014	1.0000	200.00	0.00	\N
3	3	3662	4.0000	3000.00	0.00	\N
4	4	388	1.0000	200.00	0.00	\N
5	5	529	1.0000	560.00	0.00	\N
7	7	658	1.0000	350.00	0.00	\N
8	8	2333	5.0000	100.00	0.00	\N
11	11	499	1.0000	300.00	0.00	\N
13	13	480	1.0000	430.00	0.00	\N
14	14	655	1.0000	280.00	0.00	\N
15	15	530	1.0000	560.00	0.00	\N
16	15	655	1.0000	280.00	0.00	\N
17	16	478	1.0000	1105.00	0.00	\N
18	17	2189	1.0000	30.00	0.00	\N
19	18	306	1.0000	670.00	0.00	\N
20	19	478	1.0000	1105.00	0.00	\N
21	20	654	1.0000	370.00	0.00	\N
22	21	654	1.0000	370.00	0.00	\N
23	22	654	1.0000	370.00	0.00	\N
24	22	3685	1.0000	0.00	0.00	\N
25	23	901	1.0000	1100.00	0.00	\N
28	26	530	1.0000	560.00	0.00	\N
29	26	1019	1.0000	120.00	0.00	\N
30	27	610	1.0000	4300.00	0.00	\N
36	33	1487	1.0000	2200.00	0.00	\N
37	33	305	1.0000	570.00	0.00	\N
38	33	654	1.0000	370.00	0.00	\N
39	33	492	1.0000	1700.00	0.00	\N
40	33	499	1.0000	300.00	0.00	\N
41	33	548	1.0000	150.01	0.00	\N
42	33	470	1.0000	410.00	0.00	\N
43	33	767	1.0000	800.00	0.00	\N
44	33	468	1.0000	2100.00	0.00	\N
45	33	3114	1.0000	240.00	0.00	\N
46	33	1473	1.0000	450.00	0.00	\N
47	33	653	1.0000	350.00	0.00	\N
48	33	1176	2.0000	450.00	0.00	\N
49	33	956	1.0000	6600.00	0.00	\N
50	33	1486	1.0000	2200.00	0.00	\N
58	41	1001	1.0000	1000.00	0.00	\N
59	42	4	1.0000	650.00	450.00	\N
60	43	654	1.0000	370.00	0.00	\N
61	44	4	3.0000	7.00	75.83	\N
62	45	3691	1.0000	41.00	0.00	\N
63	46	842	1.0000	290.00	0.00	\N
64	47	842	1.0000	290.00	0.00	\N
65	48	842	1.0000	290.00	0.00	\N
66	49	498	1.0000	830.00	0.00	\N
67	50	842	1.0000	290.00	0.00	\N
68	51	258	1.0000	141.00	0.00	\N
69	52	612	1.0000	3800.00	0.00	\N
70	53	612	1.0000	3800.00	0.00	\N
71	54	841	1.0000	1200.00	0.00	\N
72	55	842	1.0000	290.00	0.00	\N
73	56	841	1.0000	1200.00	0.00	\N
74	57	841	1.0000	1200.00	0.00	\N
75	58	843	1.0000	600.00	0.00	\N
76	59	843	1.0000	600.00	0.00	\N
77	60	595	1.0000	1230.00	0.00	\N
78	61	595	1.0000	1230.00	0.00	\N
79	62	1525	1.0000	790.00	0.00	\N
80	63	767	1.0000	800.00	0.00	\N
81	64	1110	1.0000	980.00	0.00	\N
82	65	1014	1.0000	200.00	0.00	\N
83	66	842	1.0000	290.00	0.00	\N
84	67	703	1.0000	900.00	0.00	\N
85	68	703	1.0000	900.00	0.00	\N
86	69	2054	1.0000	2400.00	0.00	\N
87	70	704	1.0000	620.00	0.00	\N
88	71	519	1.0000	240.00	0.00	\N
89	72	1326	1.0000	2800.00	0.00	\N
90	73	1326	1.0000	2800.00	0.00	\N
91	74	1326	1.0000	2800.00	0.00	\N
92	75	841	1.0000	1200.00	0.00	\N
93	76	392	1.0000	550.00	0.00	\N
94	77	1043	1.0000	800.00	460.00	\N
95	78	491	1.0000	350.00	0.00	\N
96	79	491	1.0000	350.00	0.00	\N
97	80	491	1.0000	350.00	0.00	\N
98	81	498	1.0000	830.00	0.00	\N
99	82	498	1.0000	830.00	0.00	\N
100	83	3687	1.0000	6.00	5.00	\N
101	84	841	1.0000	1200.00	0.00	\N
102	85	392	1.0000	550.00	0.00	\N
103	86	365	1.0000	310.00	0.00	\N
104	87	1045	1.0000	450.00	0.00	\N
105	88	306	1.0000	670.00	0.00	\N
106	89	842	1.0000	290.00	0.00	\N
107	90	1983	1.0000	1450.00	0.00	\N
108	91	498	1.0000	830.00	0.00	\N
109	92	498	1.0000	830.00	0.00	\N
110	93	498	1.0000	830.00	0.00	\N
111	94	498	1.0000	830.00	0.00	\N
112	95	498	1.0000	830.00	0.00	\N
113	96	498	1.0000	830.00	0.00	\N
114	97	306	1.0000	670.00	0.00	\N
115	98	306	1.0000	670.00	0.00	\N
116	99	306	1.0000	670.00	0.00	\N
117	100	306	1.0000	670.00	0.00	\N
118	101	491	1.0000	350.00	0.00	\N
119	102	704	1.0000	620.00	0.00	\N
120	103	704	1.0000	620.00	0.00	\N
121	104	368	1.0000	250.00	0.00	\N
122	105	2260	1.0000	6000.00	0.00	\N
123	106	1983	1.0000	1450.00	0.00	\N
124	107	703	1.0000	900.00	0.00	\N
125	108	651	1.0000	210.00	0.00	\N
126	109	491	1.0000	350.00	0.00	\N
127	110	491	1.0000	350.00	0.00	\N
128	111	703	1.0000	900.00	0.00	\N
129	112	498	1.0000	830.00	0.00	\N
130	113	5	1.0000	200.00	200.00	\N
131	114	631	1.0000	1100.00	0.00	\N
134	117	653	1.0000	350.00	0.00	\N
135	118	469	1.0000	580.00	0.00	\N
136	119	1017	1.0000	280.00	0.00	\N
137	119	631	1.0000	1100.00	0.00	\N
138	120	766	1.0000	800.00	0.00	\N
139	120	653	1.0000	350.00	0.00	\N
140	121	307	1.0000	550.00	0.00	\N
141	122	917	1.0000	650.00	0.00	\N
142	123	491	1.0000	350.00	0.00	\N
145	126	766	1.0000	800.00	0.00	\N
146	127	498	1.0000	830.00	0.00	\N
147	128	842	1.0000	290.00	0.00	\N
148	128	655	1.0000	280.00	0.00	\N
149	129	548	1.0000	150.00	0.00	\N
150	130	703	1.0000	900.00	0.00	\N
151	131	843	1.0000	600.00	0.00	\N
153	133	631	1.0000	1100.00	0.00	\N
154	134	654	1.0000	370.00	0.00	\N
155	135	498	1.0000	830.00	0.00	\N
156	136	655	1.0000	280.00	0.00	\N
157	137	703	1.0000	900.00	0.00	\N
158	138	703	1.0000	900.00	0.00	\N
159	139	703	1.0000	900.00	0.00	\N
160	140	703	1.0000	900.00	0.00	\N
161	141	703	1.0000	900.00	0.00	\N
162	142	703	1.0000	900.00	0.00	\N
163	143	703	1.0000	900.00	0.00	\N
164	144	654	1.0000	370.00	0.00	\N
165	144	631	1.0000	1100.00	0.00	\N
166	145	654	1.0000	370.00	0.00	\N
167	145	631	1.0000	1100.00	0.00	\N
168	146	2390	1.0000	900.00	0.00	\N
169	147	2390	1.0000	900.00	0.00	\N
170	147	704	1.0000	620.00	0.00	\N
171	148	1043	1.0000	800.00	460.00	\N
172	149	631	1.0000	1100.00	0.00	\N
173	150	704	1.0000	620.00	0.00	\N
174	151	1831	1.0000	1000.00	0.00	\N
175	152	1042	1.0000	900.00	480.00	\N
176	154	1042	1.0000	900.00	480.00	\N
177	155	631	1.0000	1100.00	0.00	\N
178	156	703	1.0000	900.00	0.00	\N
179	157	631	1.0000	1100.00	0.00	\N
180	158	3638	1.0000	450.00	0.00	\N
181	159	631	1.0000	1100.00	0.00	\N
182	160	307	1.0000	550.00	0.00	\N
183	161	498	1.0000	830.00	0.00	\N
184	162	631	1.0000	1100.00	0.00	\N
186	164	498	1.0000	830.00	0.00	\N
188	166	704	1.0000	620.00	0.00	\N
189	167	631	1.0000	1100.00	0.00	\N
\.


--
-- Data for Name: invoice_payment_allocation; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.invoice_payment_allocation (allocation_id, invoice_id, payment_id, amount_allocated) FROM stdin;
1	1	1	430.00
2	2	2	200.00
3	3	3	12000.00
4	4	4	100.00
5	5	5	560.00
7	4	7	70.00
8	7	8	350.00
9	4	9	30.00
10	8	9	70.00
13	11	12	300.00
14	8	13	200.00
15	8	14	230.00
16	13	15	430.00
17	14	16	280.00
18	15	17	840.00
19	17	18	30.00
20	16	19	100.00
21	16	20	5.00
22	16	21	10.00
23	16	22	30.00
24	18	23	670.00
25	19	24	1105.00
26	20	25	370.00
27	21	26	370.00
28	22	27	370.00
29	23	28	1100.00
32	26	31	680.00
33	27	32	4300.00
40	33	39	19340.01
48	41	47	1000.00
49	42	48	650.00
50	43	49	370.00
51	44	50	21.00
52	45	51	41.00
53	54	52	1200.00
54	62	53	790.00
55	64	54	980.00
56	66	55	290.00
57	68	56	900.00
58	70	57	620.00
59	47	58	290.00
60	60	58	1230.00
61	91	58	830.00
62	92	58	830.00
63	93	58	830.00
64	94	58	830.00
65	95	58	830.00
66	96	58	830.00
67	101	58	350.00
68	55	59	290.00
69	56	59	1200.00
70	58	59	600.00
71	59	59	600.00
72	72	59	2800.00
73	74	59	2800.00
74	75	59	1200.00
75	77	59	800.00
76	78	59	350.00
77	79	59	350.00
78	80	59	350.00
79	87	59	450.00
80	97	59	670.00
81	98	59	670.00
82	99	59	670.00
83	109	60	200.00
\.


--
-- Data for Name: invoice_payments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.invoice_payments (payment_id, invoice_id, method_id, amount_paid, tendered_amount, change_amount, reference, metadata, created_at, created_by, payment_status, settled_at, settlement_reference, attempt_metadata) FROM stdin;
3	46	1	100.00	\N	0.00	TEST-REF-001	{}	2025-09-13 03:05:25.220639+00	1	settled	2025-09-13 03:05:25.220639+00	\N	{}
4	46	1	190.00	\N	0.00	TEST-REF-002	{}	2025-09-13 03:06:03.811096+00	1	settled	2025-09-13 03:06:03.811096+00	\N	{}
5	48	1	290.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-13 03:07:30.084536+00	2	settled	2025-09-13 03:07:30.084536+00	\N	{}
6	49	5	830.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-13 03:08:10.37517+00	2	settled	2025-09-13 03:08:10.37517+00	\N	{}
7	50	1	290.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-13 03:34:09.048326+00	2	settled	2025-09-13 03:34:09.048326+00	\N	{}
8	51	1	141.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-13 03:34:23.955764+00	2	settled	2025-09-13 03:34:23.955764+00	\N	{}
9	52	2	3800.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-13 04:19:33.915032+00	2	settled	2025-09-13 04:19:33.915032+00	\N	{}
10	53	1	3800.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-13 04:23:35.480097+00	2	settled	2025-09-13 04:23:35.480097+00	\N	{}
11	57	5	1200.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-13 06:16:53.792094+00	2	settled	2025-09-13 06:16:53.792094+00	\N	{}
12	61	1	1230.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-13 07:41:04.663758+00	2	settled	2025-09-13 07:41:04.663758+00	\N	{}
13	63	1	800.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-13 09:00:42.564496+00	2	settled	2025-09-13 09:00:42.564496+00	\N	{}
14	65	1	200.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-13 09:36:27.386936+00	1	settled	2025-09-13 09:36:27.386936+00	\N	{}
15	67	1	900.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-13 10:00:34.160151+00	1	settled	2025-09-13 10:00:34.160151+00	\N	{}
16	69	1	2400.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-13 10:32:49.526973+00	1	settled	2025-09-13 10:32:49.526973+00	\N	{}
17	71	1	240.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-13 13:39:44.393284+00	1	settled	2025-09-13 13:39:44.393284+00	\N	{}
18	73	5	2800.00	2800.00	0.00	REF123	{"method_name": "Manual Method"}	2025-09-13 14:13:58.711632+00	1	settled	2025-09-13 14:13:58.711632+00	\N	{}
19	76	17	550.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-13 14:47:03.188974+00	1	settled	2025-09-13 14:47:03.188974+00	\N	{}
20	81	18	830.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-13 15:05:17.091982+00	1	settled	2025-09-13 15:05:17.091982+00	\N	{}
21	82	18	830.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-13 15:05:50.428221+00	1	settled	2025-09-13 15:05:50.428221+00	\N	{}
22	83	18	6.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-13 15:06:32.072197+00	1	settled	2025-09-13 15:06:32.072197+00	\N	{}
23	84	1	1200.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-13 19:16:16.697144+00	1	settled	2025-09-13 19:16:16.697144+00	\N	{}
24	85	18	550.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-13 19:17:13.715079+00	1	settled	2025-09-13 19:17:13.715079+00	\N	{}
25	86	17	310.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-13 19:18:06.572143+00	1	settled	2025-09-13 19:18:06.572143+00	\N	{}
26	88	10	670.00	\N	0.00	123456789	{"method_name": "Unknown"}	2025-09-13 19:34:07.4639+00	1	settled	2025-09-13 19:34:07.4639+00	\N	{}
27	89	2	290.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-13 22:29:18.491019+00	1	settled	2025-09-13 22:29:18.491019+00	\N	{}
28	90	1	1450.00	2000.00	550.00	\N	{"method_name": "Unknown"}	2025-09-13 23:04:42.231401+00	1	settled	2025-09-13 23:04:42.231401+00	\N	{}
29	100	1	670.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-13 23:45:11.25465+00	1	settled	2025-09-13 23:45:11.25465+00	\N	{}
30	101	18	350.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-13 23:45:46.694916+00	1	pending	\N	\N	{}
31	104	18	250.00	250.00	0.00	\N	{"source": "pos", "method_name": "charge"}	2025-09-14 00:17:37.135012+00	1	pending	\N	\N	{}
32	105	1	6000.00	\N	0.00	\N	{"source": "pos", "method_name": "Cash"}	2025-09-14 00:18:03.877638+00	1	settled	2025-09-14 00:18:03.877638+00	\N	{}
33	106	1	1450.00	\N	0.00	\N	{"source": "pos", "method_name": "Cash"}	2025-09-14 00:19:13.040166+00	1	settled	2025-09-14 00:19:13.040166+00	\N	{}
35	108	18	210.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-14 00:23:33.327535+00	1	pending	\N	\N	{}
37	110	18	350.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-14 02:29:49.874586+00	1	pending	\N	\N	{}
38	111	18	900.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-14 02:30:25.918512+00	1	settled	2025-09-14 02:30:25.918512+00	\N	{}
36	109	2	350.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-14 02:29:12.623722+00	1	settled	2025-09-14 03:19:23.212648+00	\N	{}
34	107	5	900.00	900.00	0.00	\N	{"source": "pos", "method_name": "GCash"}	2025-09-14 00:19:35.874791+00	1	settled	2025-09-14 03:19:46.061848+00	\N	{}
40	113	3	200.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-14 03:20:18.901337+00	1	settled	2025-09-14 03:20:30.20804+00	\N	{}
39	112	17	830.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-14 02:31:47.625549+00	1	settled	2025-09-14 03:22:07.633048+00	\N	{}
41	114	1	1100.00	\N	0.00	\N	{"source": "pos", "method_name": "Cash"}	2025-09-14 03:23:52.561108+00	1	settled	2025-09-14 03:23:52.561108+00	\N	{}
44	117	1	350.00	\N	0.00	\N	{"source": "pos", "method_name": "Cash"}	2025-09-14 22:00:23.502405+00	1	settled	2025-09-14 22:00:23.502405+00	\N	{}
45	118	1	580.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-14 22:01:06.728611+00	1	settled	2025-09-14 22:01:06.728611+00	\N	{}
46	119	17	1380.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-14 22:02:04.033417+00	1	settled	2025-09-14 22:02:24.02274+00	\N	{}
47	120	17	1150.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-14 22:03:41.123912+00	1	settled	2025-09-14 22:06:11.888457+00	\N	{}
48	121	5	550.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-14 22:07:26.418008+00	1	settled	2025-09-14 22:07:56.031253+00	\N	{}
49	122	5	650.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-14 22:08:27.391406+00	1	settled	2025-09-14 22:08:27.391406+00	\N	{}
50	123	5	350.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-14 22:09:00.629402+00	1	settled	2025-09-14 22:09:00.629402+00	\N	{}
54	126	2	800.00	\N	0.00	974563	{"method_name": "Unknown"}	2025-09-14 22:12:39.594809+00	1	settled	2025-09-14 22:12:39.594809+00	\N	{}
55	127	1	830.00	1000.00	170.00	\N	{"method_name": "Unknown"}	2025-09-14 22:15:59.135375+00	1	settled	2025-09-14 22:15:59.135375+00	\N	{}
56	128	2	570.00	\N	0.00	123456	{"method_name": "Unknown"}	2025-09-14 22:16:56.505466+00	1	settled	2025-09-14 22:16:56.505466+00	\N	{}
58	130	1	900.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-14 22:22:20.920601+00	1	settled	2025-09-14 22:22:20.920601+00	\N	{}
59	131	1	600.00	\N	0.00	\N	{"source": "pos", "method_name": "Cash"}	2025-09-14 22:22:30.221791+00	1	settled	2025-09-14 22:22:30.221791+00	\N	{}
60	133	1	1100.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-14 22:33:19.328316+00	1	settled	2025-09-14 22:33:19.328316+00	\N	{}
61	134	1	370.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-14 22:36:47.486604+00	1	settled	2025-09-14 22:36:47.486604+00	\N	{}
57	129	10	150.00	\N	0.00	456987	{"method_name": "Unknown"}	2025-09-14 22:17:47.80708+00	1	settled	2025-09-14 22:49:41.829938+00	\N	{}
62	135	5	830.00	\N	0.00	7897974513	{"method_name": "Unknown"}	2025-09-14 22:50:48.38868+00	1	settled	2025-09-14 22:50:48.38868+00	\N	{}
63	136	17	280.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-14 22:51:31.641804+00	1	pending	\N	\N	{}
64	143	5	900.00	900.00	0.00	897979994451	{"source": "pos", "method_name": "GCash", "extra_fields": {"reference": "897979994451"}, "method_config": {"change_allowed": false, "max_split_count": null, "reference_label": "Reference No.", "settlement_type": "instant", "requires_reference": true, "requires_receipt_no": false}}	2025-09-15 01:46:41.87271+00	1	settled	2025-09-15 01:46:41.87271+00	\N	{}
65	145	1	1470.00	\N	0.00	DR-5123	{"source": "pos", "method_name": "Cash", "extra_fields": {}, "method_config": {"change_allowed": true, "max_split_count": null, "reference_label": "", "settlement_type": "instant", "requires_reference": false, "requires_receipt_no": false}}	2025-09-15 01:54:24.211552+00	1	settled	2025-09-15 01:54:24.211552+00	\N	{}
66	147	5	1520.00	1520.00	0.00	8979797975	{"source": "pos", "method_name": "GCash", "extra_fields": {"reference": "8979797975"}, "method_config": {"change_allowed": false, "max_split_count": null, "reference_label": "Reference No.", "settlement_type": "instant", "requires_reference": true, "requires_receipt_no": false}}	2025-09-15 02:31:20.512009+00	1	settled	2025-09-15 02:31:20.512009+00	\N	{}
67	148	10	800.00	800.00	0.00	558848888451	{"source": "pos", "method_name": "Cheque", "extra_fields": {"reference": "558848888451"}, "method_config": {"change_allowed": false, "max_split_count": null, "reference_label": "Cheque Number", "settlement_type": "delayed", "requires_reference": true, "requires_receipt_no": true}}	2025-09-15 02:32:01.038847+00	1	pending	\N	\N	{}
68	149	1	1100.00	\N	0.00	DR-5746	{"source": "pos", "method_name": "Cash"}	2025-09-15 02:35:42.566064+00	1	settled	2025-09-15 02:35:42.566064+00	\N	{}
69	150	5	620.00	620.00	0.00	DR-4612	{"source": "pos", "method_name": "GCash"}	2025-09-15 02:36:05.590051+00	1	settled	2025-09-15 02:36:05.590051+00	\N	{}
70	151	5	1000.00	\N	0.00	9874565132	{"method_name": "Unknown"}	2025-09-15 02:37:55.344571+00	1	settled	2025-09-15 02:37:55.344571+00	\N	{}
72	154	5	900.00	\N	0.00	66444233388	{"method_name": "Unknown"}	2025-09-15 03:27:35.186256+00	\N	settled	2025-09-15 03:27:35.186256+00	\N	{}
73	155	1	1100.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-15 03:27:55.325823+00	\N	settled	2025-09-15 03:27:55.325823+00	\N	{}
74	156	12	900.00	\N	0.00	6479	{"method_name": "Unknown"}	2025-09-15 03:28:34.777452+00	\N	settled	2025-09-15 03:28:34.777452+00	\N	{}
75	157	5	1100.00	\N	0.00	878977975	{"method_name": "Unknown"}	2025-09-15 03:29:54.058125+00	\N	settled	2025-09-15 03:29:54.058125+00	\N	{}
76	158	17	450.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-15 03:30:34.236718+00	\N	settled	2025-09-15 03:30:34.236718+00	\N	{}
77	159	17	1100.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-15 03:31:22.174367+00	\N	settled	2025-09-15 03:31:22.174367+00	\N	{}
78	160	17	550.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-15 03:59:51.099403+00	\N	settled	2025-09-15 03:59:51.1+00	\N	{}
79	161	17	830.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-15 04:44:53.866451+00	\N	settled	2025-09-15 04:44:53.868+00	\N	{}
80	162	10	1100.00	\N	0.00	45445554	{"method_name": "Unknown"}	2025-09-15 04:56:42.859377+00	\N	settled	2025-09-15 04:57:05.907251+00	\N	{}
81	1	17	100.00	\N	0.00	\N	{}	2025-09-15 05:22:54.003409+00	\N	on_account	\N	\N	{}
83	164	1	830.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-15 05:25:05.37496+00	\N	settled	2025-09-15 05:25:05.375+00	\N	{}
85	166	17	620.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-15 05:26:43.872676+00	\N	on_account	\N	\N	{}
86	166	1	200.00	\N	0.00	\N	{"ar_batch": true, "customer_id": 4}	2025-09-15 06:02:42.78396+00	\N	settled	2025-09-15 06:02:42.787+00	\N	{}
87	166	5	100.00	\N	0.00	5554848488	{"ar_batch": true, "customer_id": 4}	2025-09-15 06:02:42.78396+00	\N	settled	2025-09-15 06:02:42.807+00	\N	{}
88	166	10	320.00	\N	0.00	778444844	{"ar_batch": true, "customer_id": 4}	2025-09-15 06:04:35.116261+00	\N	settled	2025-09-15 06:04:44.515057+00	\N	{}
89	167	17	1100.00	\N	0.00	\N	{"method_name": "Unknown"}	2025-09-15 06:06:13.946006+00	\N	on_account	\N	\N	{}
90	167	5	400.00	\N	0.00	454454545	{"ar_batch": true, "customer_id": 4}	2025-09-15 06:07:03.59989+00	\N	settled	2025-09-15 06:07:03.603+00	\N	{}
91	167	1	1100.00	\N	0.00	\N	{"ar_batch": true, "customer_id": 4}	2025-09-15 06:07:40.840473+00	\N	settled	2025-09-15 06:07:40.842+00	\N	{}
\.


--
-- Data for Name: part; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.part (part_id, internal_sku, detail, brand_id, group_id, barcode, is_active, last_cost, wac_cost, last_sale_price, last_cost_date, last_sale_price_date, reorder_point, low_stock_warning, warning_quantity, measurement_unit, tax_rate_id, is_tax_inclusive_price, is_price_change_allowed, is_using_default_quantity, is_service, date_created, created_by, date_modified, modified_by, merged_into_part_id) FROM stdin;
7	OISE-MUSA-0007	123*184*15*28	1	1	\N	t	293.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
8	OISE-MUSA-0008	130*146*14	1	1	\N	t	225.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
9	OISE-MUSA-0009	130*150*14	1	1	\N	t	97.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
10	OISE-MUSA-0010	145*175*14	1	1	\N	t	214.00	0.00	380.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
11	OISE-MUSA-0011	154*172*14	1	1	\N	t	185.00	0.00	320.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
12	OISE-MUSA-0012	155*185*13*16	1	1	\N	t	205.00	0.00	370.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
13	OISE-MUSA-0013	155*190*17	1	1	\N	t	287.00	0.00	490.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
14	OISE-MUSA-0014	165*195*19	1	1	\N	t	660.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
15	OISE-MUSA-0015	17.4*30*7	1	1	\N	t	30.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
16	OISE-MUSA-0016	17.5*32*7	1	1	\N	t	33.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
17	OISE-MUSA-0017	18*32*7	1	1	\N	t	33.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
18	OISE-MUSA-0018	19*32*8	1	1	\N	t	33.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
19	OISE-MUSA-0019	22*35*8	1	1	\N	t	34.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
20	OISE-MUSA-0020	25*40*8.9	1	1	\N	t	83.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
21	OISE-MUSA-0021	28*40*8	1	1	\N	t	42.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
22	OISE-MUSA-0022	29*36*8	1	1	\N	t	38.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
23	OISE-MUSA-0023	30*40*7	1	1	\N	t	29.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
24	OISE-MUSA-0024	30*44*7	1	1	\N	t	35.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
25	OISE-MUSA-0025	32*45*8	1	1	\N	t	53.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
26	OISE-MUSA-0026	32*47*16	1	1	\N	t	35.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
27	OISE-MUSA-0027	42*65*9	1	1	\N	t	52.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
28	OISE-MUSA-0028	44*60*7; BLACK	1	1	\N	t	37.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
29	OISE-MUSA-0029	44*60*7; BROWN	1	1	\N	t	300.00	0.00	520.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
30	OISE-MUSA-0030	46*102*10*16	1	1	\N	t	131.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
31	OISE-MUSA-0031	46*95*10*14	1	1	\N	t	138.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
32	OISE-MUSA-0032	48*70*12	1	1	\N	t	49.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
33	OISE-MUSA-0033	50*106*11	1	1	\N	t	113.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
34	OISE-MUSA-0034	50*65*10	1	1	\N	t	54.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
35	OISE-MUSA-0035	54*64*9*24	1	1	\N	t	71.00	0.00	201.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
36	OISE-MUSA-0036	55*78*12	1	1	\N	t	57.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
37	OISE-MUSA-0037	55*78*8	1	1	\N	t	131.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
38	OISE-MUSA-0038	56*114*10	1	1	\N	t	364.00	0.00	630.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
39	OISE-MUSA-0039	56*122*10.5	1	1	\N	t	97.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
40	OISE-MUSA-0040	57*123*14.5*29.5	1	1	\N	t	165.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
41	OISE-MUSA-0041	58*80*10	1	1	\N	t	82.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
42	OISE-MUSA-0042	60*72*18	1	1	\N	t	58.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
43	OISE-MUSA-0043	60*72*12	1	1	\N	t	53.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
44	OISE-MUSA-0044	60*82*12	1	1	\N	t	73.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
45	OISE-MUSA-0045	65*120.5*10	1	1	\N	t	131.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
46	OISE-MUSA-0046	65*77*12	1	1	\N	t	47.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
47	OISE-MUSA-0047	70*112*10*18.5	1	1	\N	t	100.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
48	OISE-MUSA-0048	71*142*14	1	1	\N	t	111.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
49	OISE-MUSA-0049	74.4*93.5*6.8	1	1	\N	t	118.00	0.00	210.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
50	OISE-MUSA-0050	74*142.9*17.5	1	1	\N	t	97.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
51	OISE-MUSA-0051	75*100*14.5*19.5	1	1	\N	t	330.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
52	OISE-MUSA-0052	75*121*13	1	1	\N	t	102.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
53	OISE-MUSA-0053	76*94*12	1	1	\N	t	128.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
54	OISE-MUSA-0055	78*162*16	1	1	\N	t	189.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
55	OISE-MUSA-0056	78*163*16	1	1	\N	t	205.00	0.00	370.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
56	OISE-MUSA-0057	82*121*12*19	1	1	\N	t	125.00	0.00	215.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
57	OISE-MUSA-0058	95*120*13	1	1	\N	t	350.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
58	OISE-MUSA-0059	95*125*13.5*21.5	1	1	\N	t	467.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
59	OISE-MUSA-0060	95*132*12*21.5	1	1	\N	t	136.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
60	OISE-MUSA-0061	55*72*9	1	1	\N	t	77.00	0.00	135.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
61	OISE-MUSA-0062	35*55*8	1	1	\N	t	45.00	0.00	80.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
62	OISE-MUSA-0063	38*50*6	1	1	\N	t	42.00	0.00	75.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
63	OISE-MUSA-0064	74*100*10	1	1	\N	t	92.00	0.00	160.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
64	OISE-MUSA-0065	58*75*9	1	1	\N	t	62.00	0.00	105.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
5	OISE-MUSA-0005	120*153*15; SPRING TYPE	1	1		t	200.00	200.00	200.00	2025-09-09 08:20:25.512591+00	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	2025-09-09 08:19:44.438048+00	1	\N
3	OISE-MUSA-0003	109*137*13	1	1		t	429.00	429.00	740.00	2025-09-10 00:55:55.533907+00	2025-09-10 00:55:55.533907+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	2025-09-09 03:46:28.130994+00	1	\N
65	OISE-MUSA-0066	155*180*17	1	1	\N	t	181.00	0.00	310.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
66	OISE-MUSA-0067	70*100*13	1	1	\N	t	96.00	0.00	165.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
67	OISE-MUSA-0068	35*58*10	1	1	\N	t	82.00	0.00	140.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
68	OISE-MUSA-0069	35*58*8.5	1	1	\N	t	76.00	0.00	130.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
69	OISE-MUSA-0070	95*120*13	1	1	\N	t	350.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
70	OISE-NOKX-0001	100*120/158*16	2	1	\N	t	600.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
71	OISE-NOKX-0002	100*124*14.5	2	1	\N	t	400.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
72	OISE-NOKX-0003	105*135*14	2	1	\N	t	350.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
73	OISE-NOKX-0004	120*140*10.5	2	1	\N	t	220.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
74	OISE-NOKX-0005	120*150*14	2	1	\N	t	220.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
75	OISE-NOKX-0006	128*148*14	2	1	\N	t	400.00	0.00	685.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
76	OISE-NOKX-0007	12*22*7	2	1	\N	t	45.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
77	OISE-NOKX-0008	138*152*12	2	1	\N	t	240.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
78	OISE-NOKX-0009	14.8*30*5	2	1	\N	t	34.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
79	OISE-NOKX-0010	14.8*30*7.5	2	1	\N	t	50.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
80	OISE-NOKX-0011	14.8*32*7.5	2	1	\N	t	50.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
81	OISE-NOKX-0012	14*24*6	2	1	\N	t	38.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
82	OISE-NOKX-0013	155*180*17	2	1	\N	t	250.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
83	OISE-NOKX-0014	15*32*7	2	1	\N	t	32.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
84	OISE-NOKX-0015	16*28*7	2	1	\N	t	55.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
85	OISE-NOKX-0016	16*30*7	2	1	\N	t	30.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
86	OISE-NOKX-0017	17*30*7	2	1	\N	t	45.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
87	OISE-NOKX-0018	17*35*8	2	1	\N	t	48.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
88	OISE-NOKX-0019	17*38*7	2	1	\N	t	70.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
89	OISE-NOKX-0020	18*28*8	2	1	\N	t	40.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
90	OISE-NOKX-0021	18*30*7	2	1	\N	t	45.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
91	OISE-NOKX-0022	18*32*7	2	1	\N	t	45.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
92	OISE-NOKX-0023	18*32*7.9	2	1	\N	t	90.00	0.00	160.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
93	OISE-NOKX-0024	20*30*7	2	1	\N	t	60.00	0.00	110.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
94	OISE-NOKX-0025	20*31*7	2	1	\N	t	38.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
95	OISE-NOKX-0026	22*35*8	2	1	\N	t	50.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
96	OISE-NOKX-0027	22*38*8	2	1	\N	t	60.00	0.00	120.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
97	OISE-NOKX-0028	23*34*65	2	1	\N	t	60.00	0.00	120.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
98	OISE-NOKX-0029	24*38.2*8.5	2	1	\N	t	180.00	0.00	320.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
99	OISE-NOKX-0030	24*41*8.5	2	1	\N	t	160.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
100	OISE-NOKX-0031	25*35*6	2	1	\N	t	45.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
101	OISE-NOKX-0032	25*36*5	2	1	\N	t	70.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
102	OISE-NOKX-0033	25*37*8	2	1	\N	t	45.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
103	OISE-NOKX-0034	25*38*7/7.8	2	1	\N	t	60.00	0.00	120.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
104	OISE-NOKX-0035	25*40*10	2	1	\N	t	90.00	0.00	160.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
105	OISE-NOKX-0036	26*37*10.5	2	1	\N	t	65.00	0.00	125.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
106	OISE-NOKX-0037	27*43*9	2	1	\N	t	50.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
107	OISE-NOKX-0038	28*38*10/15	2	1	\N	t	74.00	0.00	160.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
108	OISE-NOKX-0039	28*40*8	2	1	\N	t	40.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
109	OISE-NOKX-0040	28*41*6.5	2	1	\N	t	70.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
110	OISE-NOKX-0041	28*47*10	2	1	\N	t	100.00	0.00	190.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
111	OISE-NOKX-0042	28*47*8	2	1	\N	t	50.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
112	OISE-NOKX-0043	30*45*6	2	1	\N	t	40.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
113	OISE-NOKX-0044	30*45*8	2	1	\N	t	60.00	0.00	115.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
114	OISE-NOKX-0045	30*46*7	2	1	\N	t	65.00	0.00	120.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
115	OISE-NOKX-0046	30*46*8	2	1	\N	t	65.00	0.00	120.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
116	OISE-NOKX-0047	30*50*11	2	1	\N	t	65.00	0.00	120.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
117	OISE-NOKX-0048	30*50*8	2	1	\N	t	90.00	0.00	160.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
118	OISE-NOKX-0049	31*46*8	2	1	\N	t	70.00	0.00	160.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
119	OISE-NOKX-0050	32*45*8	2	1	\N	t	55.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
120	OISE-NOKX-0051	32*46*6	2	1	\N	t	55.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
121	OISE-NOKX-0052	32*47*7	2	1	\N	t	80.00	0.00	180.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
122	OISE-NOKX-0053	32*48*10	2	1	\N	t	70.00	0.00	130.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
123	OISE-NOKX-0054	32*48*8	2	1	\N	t	55.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
124	OISE-NOKX-0055	34*48*7	2	1	\N	t	100.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
125	OISE-NOKX-0056	34*50*7	2	1	\N	t	65.00	0.00	125.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
126	OISE-NOKX-0057	34*54*9/15.5	2	1	\N	t	90.00	0.00	160.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
127	OISE-NOKX-0058	34*63*9/15.5	2	1	\N	t	105.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
128	OISE-NOKX-0059	35*41.5*5/9.1	2	1	\N	t	60.00	0.00	130.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
129	OISE-NOKX-0060	35*47*7	2	1	\N	t	72.00	0.00	180.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
130	OISE-NOKX-0061	35*48*8	2	1	\N	t	100.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
131	OISE-NOKX-0062	35*50*11	2	1	\N	t	70.00	0.00	130.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
132	OISE-NOKX-0063	35*50*8	2	1	\N	t	58.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
133	OISE-NOKX-0064	35*55*11	2	1	\N	t	70.00	0.00	130.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
134	OISE-NOKX-0065	35*55*8	2	1	\N	t	60.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
135	OISE-NOKX-0066	35*56*8/11.5	2	1	\N	t	120.00	0.00	220.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
136	OISE-NOKX-0067	35*58*10	2	1	\N	t	80.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
137	OISE-NOKX-0068	35*62*10/16.5	2	1	\N	t	150.00	0.00	290.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
138	OISE-NOKX-0069	35*65*12	2	1	\N	t	100.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
139	OISE-NOKX-0070	36.5*50.5*7	2	1	\N	t	75.00	0.00	140.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
140	OISE-NOKX-0071	36*52*10	2	1	\N	t	70.00	0.00	130.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
141	OISE-NOKX-0072	37*50*6	2	1	\N	t	75.00	0.00	140.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
142	OISE-NOKX-0073	37*62*14	2	1	\N	t	120.00	0.00	210.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
143	OISE-NOKX-0074	38*44*17.5	2	1	\N	t	90.00	0.00	160.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
144	OISE-NOKX-0075	38*47*10	2	1	\N	t	80.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
145	OISE-NOKX-0076	38*51*13/15	2	1	\N	t	170.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
146	OISE-NOKX-0077	38*52*6/14	2	1	\N	t	100.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
147	OISE-NOKX-0078	38*58*11	2	1	\N	t	80.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
148	OISE-NOKX-0079	38*65*12/19	2	1	\N	t	120.00	0.00	220.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
149	OISE-NOKX-0080	38*74*11	2	1	\N	t	90.00	0.00	160.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
150	OISE-NOKX-0081	39.5*60*10	2	1	\N	t	80.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
151	OISE-NOKX-0082	39*50.4*8.5	2	1	\N	t	100.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
152	OISE-NOKX-0083	40*52*7	2	1	\N	t	65.00	0.00	120.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
153	OISE-NOKX-0084	40*56*8	2	1	\N	t	55.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
154	OISE-NOKX-0085	40*64*12	2	1	\N	t	180.00	0.00	320.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
155	OISE-NOKX-0086	40*68*11	2	1	\N	t	90.00	0.00	160.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
156	OISE-NOKX-0087	40*75*122	2	1	\N	t	120.00	0.00	210.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
157	OISE-NOKX-0088	41*53*7	2	1	\N	t	90.00	0.00	160.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
158	OISE-NOKX-0089	42*55*9	2	1	\N	t	70.00	0.00	125.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
159	OISE-NOKX-0090	42*60*7	2	1	\N	t	100.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
160	OISE-NOKX-0091	42*60*9	2	1	\N	t	100.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
161	OISE-NOKX-0092	44*65*11	2	1	\N	t	65.00	0.00	140.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
162	OISE-NOKX-0093	45*58*9	2	1	\N	t	80.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
163	OISE-NOKX-0094	45*72*12/19.5	2	1	\N	t	140.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
164	OISE-NOKX-0095	46*102*10/16	2	1	\N	t	170.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
165	OISE-NOKX-0096	47.7*73.08*9.5/15	2	1	\N	t	200.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
166	OISE-NOKX-0097	48*62*9	2	1	\N	t	100.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
167	OISE-NOKX-0098	48*62*9/24	2	1	\N	t	75.00	0.00	140.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
168	OISE-NOKX-0099	48*65*9	2	1	\N	t	70.00	0.00	140.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
169	OISE-NOKX-0100	48*70*9	2	1	\N	t	90.00	0.00	160.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
170	OISE-NOKX-0101	48*82*12	2	1	\N	t	110.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
171	OISE-NOKX-0102	50*68*9	2	1	\N	t	90.00	0.00	160.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
172	OISE-NOKX-0103	50*70*9	2	1	\N	t	95.00	0.00	170.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
173	OISE-NOKX-0104	51.9*66*8/10	2	1	\N	t	100.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
174	OISE-NOKX-0105	52*72*8/11	2	1	\N	t	100.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
175	OISE-NOKX-0106	52*73*10	2	1	\N	t	80.00	0.00	180.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
176	OISE-NOKX-0107	52*84*14	2	1	\N	t	110.00	0.00	220.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
177	OISE-NOKX-0108	54*65*13	2	1	\N	t	130.00	0.00	240.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
178	OISE-NOKX-0109	54*76*8/11	2	1	\N	t	120.00	0.00	240.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
179	OISE-NOKX-0110	56*81*8	2	1	\N	t	115.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
180	OISE-NOKX-0111	57*79*9/13.5	2	1	\N	t	100.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
181	OISE-NOKX-0112	58*74*10	2	1	\N	t	70.00	0.00	125.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
182	OISE-NOKX-0113	58*80*10	2	1	\N	t	100.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
183	OISE-NOKX-0114	58*82*10	2	1	\N	t	170.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
184	OISE-NOKX-0115	60*77*12	2	1	\N	t	100.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
185	OISE-NOKX-0116	65*88*11/16.5	2	1	\N	t	160.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
186	OISE-NOKX-0117	68*124*11.5/27	2	1	\N	t	380.00	0.00	660.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
187	OISE-NOKX-0118	68*90*10	2	1	\N	t	135.00	0.00	240.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
188	OISE-NOKX-0119	70*92*8.5	2	1	\N	t	150.00	0.00	290.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
189	OISE-NOKX-0120	72*94*12	2	1	\N	t	140.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
190	OISE-NOKX-0121	72*96*9	2	1	\N	t	150.00	0.00	260.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
191	OISE-NOKX-0122	73*90*8	2	1	\N	t	115.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
192	OISE-NOKX-0123	74*100*10	2	1	\N	t	120.00	0.00	210.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
193	OISE-NOKX-0124	74*143*17.5	2	1	\N	t	300.00	0.00	520.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
194	OISE-NOKX-0125	75*108*10/19.5	2	1	\N	t	300.00	0.00	520.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
195	OISE-NOKX-0126	75*112*10/17.5	2	1	\N	t	300.00	0.00	520.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
196	OISE-NOKX-0127	76*94*12	2	1	\N	t	140.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
197	OISE-NOKX-0128	78.5*113*12/22	2	1	\N	t	290.00	0.00	510.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
198	OISE-NOKX-0129	80*100*10	2	1	\N	t	130.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
199	OISE-NOKX-0130	80*143*10/37	2	1	\N	t	350.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
200	OISE-NOKX-0131	83*100*9	2	1	\N	t	160.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
201	OISE-NOKX-0132	86*143*10/37	2	1	\N	t	360.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
202	OISE-NOKX-0133	90*113*15	2	1	\N	t	250.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
203	OISE-NOKX-0134	95*118*10	2	1	\N	t	220.00	0.00	385.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
204	OISE-NOKX-0135	75*105*15	2	1	\N	t	120.00	0.00	210.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
205	OISE-NOKX-0136	74*97*12	2	1	\N	t	90.00	0.00	160.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
206	OISE-NOKX-0137	86.6*110*4.5/6.2	2	1	\N	t	80.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
207	OISE-NOKX-0138	40.5*74*10/19	2	1	\N	t	140.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
208	OISE-NOKX-0139	65*120.5*10	2	1	\N	t	80.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
209	OISE-NOKX-0140	68.6*86*8.6/11.4	2	1	\N	t	180.00	0.00	320.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
210	OISE-NOKX-0141	77*102*9.5/21.5	2	1	\N	t	200.00	0.00	390.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
211	OISE-NOKX-0142	60*85*10	2	1	\N	t	80.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
212	OISE-NOKX-0143	60*72*12	2	1	\N	t	100.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
213	OISE-NOKX-0144	60*90*10	2	1	\N	t	135.00	0.00	240.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
214	OISE-NOKX-0145	62*75*6/9.5	2	1	\N	t	140.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
215	OISE-NOKX-0146	46*53*6.5/8	2	1	\N	t	80.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
216	OISE-NOKX-0147	56*99.4*8	2	1	\N	t	110.00	0.00	220.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
217	OISE-NOKX-0148	52*70*9	2	1	\N	t	95.00	0.00	170.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
218	OISE-NOKX-0149	32*42*10/12.5	2	1	\N	t	150.00	0.00	290.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
219	OISE-NOKX-0150	28*45*8	2	1	\N	t	40.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
220	OISE-NOKX-0151	63*80*7.7	2	1	\N	t	90.00	0.00	160.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
221	OISE-NOKX-0152	70*122*12/30.3	2	1	\N	t	300.00	0.00	520.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
222	OISE-NOKX-0153	77*102*9.5/21.5	2	1	\N	t	200.00	0.00	390.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
223	OISE-NOKX-0154	60*88*935/16.5	2	1	\N	t	45.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
224	OISE-NOKX-0155	74.4*99.4*8	2	1	\N	t	90.00	0.00	160.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
225	OISE-NOKX-0156	45*55*10.5	2	1	\N	t	70.00	0.00	130.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
226	OISE-NOKX-0157	20*34*7	2	1	\N	t	65.00	0.00	125.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
227	OISE-NOKX-0158	35*56*9/14.8	2	1	\N	t	50.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
228	OISE-NOKX-0159	35*41*55/9.1	2	1	\N	t	60.00	0.00	130.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
229	OISE-NOKX-0160	58*103*12/19.5	2	1	\N	t	120.00	0.00	220.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
230	OISE-NOKX-0161	38*44*12.8*17.5	2	1	\N	t	90.00	0.00	160.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
231	OISE-NOKX-0162	32*47*6	2	1	\N	t	48.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
232	OISE-NOKX-0163	35*62*9.5	2	1	\N	t	100.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
233	OISE-NOKX-0164	154*175*13	2	1	\N	t	290.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
234	OISE-NOKX-0165	155*172*14	2	1	\N	t	290.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
235	OISE-NOKX-0166	32.5*43*67	2	1	\N	t	55.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
236	OISE-NOKX-0167	57.12*67*5.5	2	1	\N	t	130.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
237	OISE-NOKX-0168	95*132*12/21.5	2	1	\N	t	300.00	0.00	510.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
238	OISE-NOKX-0169	68*90*10/18	2	1	\N	t	135.00	0.00	240.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
239	OISE-NOKX-0170	72*85*9	2	1	\N	t	32.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
240	OISE-NOKX-0171	35*55.4*13	2	1	\N	t	70.00	0.00	130.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
241	OISE-NOKX-0172	77*93*10	2	1	\N	t	100.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
242	OISE-NOKX-0173	31.75*48*8/9	2	1	\N	t	90.00	0.00	160.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
243	OISE-NOKX-0174	80*105*13/20	2	1	\N	t	130.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
244	OISE-NOKX-0175	33*50*11	2	1	\N	t	65.00	0.00	120.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
245	OISE-NOKX-0176	160*182*17	2	1	\N	t	550.00	0.00	950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
246	OISE-NOKX-0177	50.85*69.85*11	2	1	\N	t	34.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
247	OISE-NOKX-0178	40*75*12	2	1	\N	t	100.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
248	OISE-NOKX-0179	70*142*12/36.3	2	1	\N	t	70.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
249	OISE-NOKX-0180	102*116*14	2	1	\N	t	170.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
250	OISE-NOKX-0181	115*156*26	2	1	\N	t	360.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
251	OISE-NOKX-0182	64*133*13	2	1	\N	t	300.00	0.00	520.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
252	OISE-NOKX-0183	125*150*14	2	1	\N	t	250.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
253	OISE-NOKX-0184	77*102*10/19	2	1	\N	t	300.00	0.00	520.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
254	OISE-NOKX-0185	80*98*10	2	1	\N	t	300.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
255	OISE-NOKX-0186	45*65*10	2	1	\N	t	90.00	0.00	160.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
256	OISE-TOGU-0001	100*135*10	3	1	\N	t	160.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
257	OISE-TOGU-0002	104*139*13	3	1	\N	t	520.00	0.00	855.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
259	OISE-TOGU-0003	120*140*10.5	3	1	\N	t	125.00	0.00	215.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
260	OISE-TOGU-0004	125*150*14	3	1	\N	t	250.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
261	OISE-TOGU-0005	15*30*7	3	1	\N	t	28.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
262	OISE-TOGU-0006	17*28*7	3	1	\N	t	30.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
263	OISE-TOGU-0007	17*31*7.8	3	1	\N	t	48.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
264	OISE-TOGU-0008	17*32*7	3	1	\N	t	25.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
265	OISE-TOGU-0009	19*32*7/8	3	1	\N	t	32.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
266	OISE-TOGU-0010	19*38*7	3	1	\N	t	60.00	0.00	105.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
267	OISE-TOGU-0011	20*32*7	3	1	\N	t	30.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
268	OISE-TOGU-0012	20*36*7	3	1	\N	t	48.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
269	OISE-TOGU-0013	22*34*6.5	3	1	\N	t	45.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
270	OISE-TOGU-0014	22*40*10	3	1	\N	t	60.00	0.00	105.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
271	OISE-TOGU-0015	23*35*6.5/7	3	1	\N	t	55.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
272	OISE-TOGU-0016	23*40*8	3	1	\N	t	90.00	0.00	155.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
273	OISE-TOGU-0017	24*35*5.6	3	1	\N	t	28.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
274	OISE-TOGU-0018	30*42*8	3	1	\N	t	25.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
275	OISE-TOGU-0019	30*54*10	3	1	\N	t	35.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
276	OISE-TOGU-0020	32*53*7	3	1	\N	t	30.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
277	OISE-TOGU-0021	34*48*8	3	1	\N	t	38.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
278	OISE-TOGU-0022	35*48*15	3	1	\N	t	40.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
279	OISE-TOGU-0023	37*65*12.5	3	1	\N	t	60.00	0.00	105.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
280	OISE-TOGU-0024	38*52*6	3	1	\N	t	25.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
281	OISE-TOGU-0025	40*75*10/16.5	3	1	\N	t	126.00	0.00	215.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
282	OISE-TOGU-0026	41*55*9	3	1	\N	t	30.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
283	OISE-TOGU-0027	43*64.2*6.2/7.2	3	1	\N	t	52.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
284	OISE-TOGU-0028	45*58*6.5/14.5	3	1	\N	t	60.00	0.00	105.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
285	OISE-TOGU-0029	45*62*6	3	1	\N	t	61.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
286	OISE-TOGU-0030	45*64*6.5/19	3	1	\N	t	60.00	0.00	105.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
287	OISE-TOGU-0031	48*80*14	3	1	\N	t	80.00	0.00	140.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
288	OISE-TOGU-0032	50*67*11	3	1	\N	t	50.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
289	OISE-TOGU-0033	50*68*9	3	1	\N	t	48.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
290	OISE-TOGU-0034	51*65*9	3	1	\N	t	40.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
291	OISE-TOGU-0035	54*82*8/11	3	1	\N	t	53.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
292	OISE-TOGU-0036	58*74*10	3	1	\N	t	42.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
293	OISE-TOGU-0037	58*75*9	3	1	\N	t	48.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
294	OISE-TOGU-0038	60*103*10/34.5	3	1	\N	t	170.00	0.00	290.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
295	OISE-TOGU-0039	60*103*12/20	3	1	\N	t	90.00	0.00	155.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
296	OISE-TOGU-0040	63*81*7.5/11.5	3	1	\N	t	120.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
297	OISE-TOGU-0041	67*90*12.5/20	3	1	\N	t	105.00	0.00	180.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
298	OISE-TOGU-0042	70*92*12/18	3	1	\N	t	98.00	0.00	170.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
299	OISE-TOGU-0043	72*94*10	3	1	\N	t	98.00	0.00	170.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
300	OISE-TOGU-0044	80*96*9	3	1	\N	t	90.00	0.00	155.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
301	OISE-TOGU-0045	80*98*10	3	1	\N	t	38.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
302	SUAR-SGPX-0001	RH	5	3	\N	t	245.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
303	TREN-SGPX-0001	LH/RH W/ GREASE FITTINGS	5	4	\N	t	195.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
304	PIAR-SGPX-0001	\N	5	5	\N	t	240.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
305	AIFI-FLEE-0001	\N	6	6	\N	t	330.00	0.00	570.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
306	AIFI-FLEE-0002	\N	6	6	\N	t	380.00	0.00	670.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
307	AIFI-FLEE-0003	\N	6	6	\N	t	300.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
308	AIFI-FLEE-0004	\N	6	6	\N	t	250.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
309	AIFI-FLEE-0005	\N	6	6	\N	t	280.00	0.00	490.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
310	AIFI-FLEE-0006	\N	6	6	\N	t	390.00	0.00	690.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
311	AIFI-FLEE-0007	\N	6	6	\N	t	230.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
312	AIFI-FLEE-0008	\N	6	6	\N	t	300.00	0.00	530.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
313	AIFI-FLEE-0009	\N	6	6	\N	t	230.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
314	AIFI-FLEE-0010	\N	6	6	\N	t	240.00	0.00	430.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
315	AIFI-FLEE-0011	\N	6	6	\N	t	240.00	0.00	480.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
316	AIFI-FLEE-0012	\N	6	6	\N	t	175.00	0.00	305.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
317	AIFI-FLEE-0013	\N	6	6	\N	t	1200.00	0.00	2100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
318	AIFI-FLEE-0014	\N	6	6	\N	t	930.00	0.00	1650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
319	AIFI-FLEE-0015	\N	6	6	\N	t	550.00	0.00	970.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
320	AIFI-FLEE-0016	\N	6	6	\N	t	325.00	0.00	570.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
321	AIFI-FLEE-0017	\N	6	6	\N	t	310.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
322	AIFI-FLEE-0018	\N	6	6	\N	t	450.00	0.00	800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
323	AIFI-FLEE-0019	\N	6	6	\N	t	425.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
324	AIFI-FLEE-0020	\N	6	6	\N	t	300.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
325	AIFI-FLEE-0021	\N	6	6	\N	t	575.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3041	BEAR-NTNX-0022	\N	33	9	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
326	AIFI-FLEE-0022	\N	6	6	\N	t	575.00	0.00	980.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
327	AIFI-FLEE-0023	\N	6	6	\N	t	150.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
328	AIFI-FLEE-0024	\N	6	6	\N	t	300.00	0.00	530.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
329	AIFI-FLEE-0025	\N	6	6	\N	t	200.00	0.00	370.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
330	AIFI-FLEE-0026	\N	6	6	\N	t	380.00	0.00	670.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
331	AIFI-FLEE-0027	\N	6	6	\N	t	220.00	0.00	390.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
332	AIFI-FLEE-0028	\N	6	6	\N	t	450.00	0.00	800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
333	AIFI-FLEE-0029	\N	6	6	\N	t	240.00	0.00	420.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
334	AIFI-FLEE-0030	\N	6	6	\N	t	168.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
335	AIFI-FLEE-0031	\N	6	6	\N	t	350.00	0.00	610.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
336	AIFI-FLEE-0032	\N	6	6	\N	t	680.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
337	AIFI-FLEE-0033	\N	6	6	\N	t	190.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
338	AIFI-FLEE-0034	\N	6	6	\N	t	180.00	0.00	320.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
339	AIFI-FLEE-0035	\N	6	6	\N	t	210.00	0.00	370.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
340	AIFI-FLEE-0036	\N	6	6	\N	t	350.00	0.00	610.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
341	AIFI-FLEE-0037	\N	6	6	\N	t	250.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
342	AIFI-FLEE-0038	\N	6	6	\N	t	360.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
343	AIFI-FLEE-0039	\N	6	6	\N	t	350.00	0.00	610.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
344	AIFI-FLEE-0040	\N	6	6	\N	t	380.00	0.00	660.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
345	AIFI-FLEE-0041	\N	6	6	\N	t	580.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
346	AIFI-FLEE-0042	\N	6	6	\N	t	280.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
347	AIFI-FLEE-0043	\N	6	6	\N	t	410.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
348	AIFI-FLEE-0044	\N	6	6	\N	t	240.00	0.00	480.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
349	AIFI-FLEE-0045	\N	6	6	\N	t	168.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
350	AIFI-FLEE-0046	\N	6	6	\N	t	180.00	0.00	320.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
351	AIFI-FLEE-0047	\N	6	6	\N	t	540.00	0.00	950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
352	AIFI-FLEE-0048	\N	6	6	\N	t	355.00	0.00	610.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
353	AIFI-FLEE-0049	\N	6	6	\N	t	230.00	0.00	410.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
354	AIFI-FLEE-0050	\N	6	6	\N	t	320.00	0.00	570.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
355	AIFI-FLEE-0051	\N	6	6	\N	t	250.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
356	AIFI-FLEE-0052	\N	6	6	\N	t	280.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
357	AIFI-FLEE-0053	\N	6	6	\N	t	330.00	0.00	570.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
358	AIFI-FLEE-0054	\N	6	6	\N	t	410.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
359	AIFI-FLEE-0055	\N	6	6	\N	t	480.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
360	AIFI-FLEE-0056	\N	6	6	\N	t	380.00	0.00	670.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
361	AIFI-FLEE-0057	\N	6	6	\N	t	480.00	0.00	840.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
362	AIFI-FLEE-0058	\N	6	6	\N	t	950.00	0.00	1670.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
363	AIFI-FLEE-0059	\N	6	6	\N	t	280.00	0.00	490.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
365	AIFI-UNAS-0002	\N	7	6	\N	t	258.00	0.00	310.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
366	AIFI-UNAS-0003	\N	7	6	\N	t	564.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
367	AIFI-UNAS-0004	\N	7	6	\N	t	1065.00	0.00	1400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
368	AIFI-UNAS-0005	ELEMENT	7	6	\N	t	204.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
369	AIFI-UNAS-0006	ELEMENT	7	6	\N	t	324.00	0.00	390.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
370	AIFI-UNAS-0007	ELEMENT W/ FIN	7	6	\N	t	426.00	0.00	510.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
371	AIFI-UNAS-0008	ELEMENT 01'-03"	7	6	\N	t	554.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
372	AIFI-UNAS-0009	ELEMENT	7	6	\N	t	204.00	0.00	245.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
373	AIFI-UNAS-0010	ELEMENT	7	6	\N	t	306.00	0.00	370.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
374	AIFI-UNAS-0011	ELEMENT	7	6	\N	t	270.00	0.00	325.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
375	AIFI-UNAS-0012	ELEMENT	7	6	\N	t	348.00	0.00	420.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
376	AIFI-UNAS-0013	ELEMENT	7	6	\N	t	348.00	0.00	420.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
377	AIFI-UNAS-0014	ELEMENT	7	6	\N	t	1020.00	0.00	1250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
378	AIFI-UNAS-0015	ELEMENT	7	6	\N	t	792.00	0.00	950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
379	AIFI-UNAS-0016	\N	7	6	\N	t	575.00	0.00	790.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
380	AIFI-UNAS-0017	\N	7	6	\N	t	684.00	0.00	950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
381	AIFI-UNAS-0018	\N	7	6	\N	t	580.00	0.00	790.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
382	AIFI-UNAS-0019	POLYURETHANE	7	6	\N	t	684.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
383	AIFI-UNAS-0020	POLYURETHANE	7	6	\N	t	612.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
384	AIFI-KOSA-0001	\N	8	6	\N	t	390.00	0.00	540.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
385	SUAR-SGPX-0002	LH	5	3	\N	t	245.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
388	FRHO-MAPO-0003	1/4"	9	7	\N	t	0.00	0.00	60.00	\N	\N	1	t	2	FT	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
389	GGAC-GERM-0001	\N	10	8	\N	t	110.00	0.00	190.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
391	SIOI-DENS-0001	\N	12	10	\N	t	38.00	0.00	95.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
392	BRPA-MOHA-0001	\N	13	11	\N	t	388.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
393	RUCU-SEIK-0001	\N	14	12	\N	t	15.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
394	RUCU-SEIK-0002	\N	14	12	\N	t	15.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
387	FRHO-MAPO-0002	5/16"	9	7	\N	t	0.00	0.00	70.00	2025-09-14 22:12:55.314013+00	\N	1	t	2	FT	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
395	RUCU-SEIK-0003	\N	14	12	\N	t	15.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
396	RUCU-SEIK-0004	\N	14	12	\N	t	15.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
397	RUCU-SEIK-0005	\N	14	12	\N	t	15.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
398	RUCU-SEIK-0007	\N	14	12	\N	t	15.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
399	RUCU-SEIK-0008	\N	14	12	\N	t	15.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
400	RUCU-SEIK-0009	\N	14	12	\N	t	15.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
401	RUCU-SEIK-0010	\N	14	12	\N	t	15.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
402	RUCU-SEIK-0011	\N	14	12	\N	t	15.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
403	RUCU-SEIK-0012	\N	14	12	\N	t	15.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
404	RUCU-SEIK-0013	\N	14	12	\N	t	13.00	0.00	25.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
405	RUCU-SEIK-0014	\N	14	12	\N	t	15.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
406	RUCU-SEIK-0015	\N	14	12	\N	t	15.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
407	RUCU-SEIK-0016	\N	14	12	\N	t	15.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
408	RUCU-SEIK-0017	\N	14	12	\N	t	15.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
409	RUCU-SEIK-0018	\N	14	12	\N	t	15.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
410	RUCU-SEIK-0019	\N	14	12	\N	t	15.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
411	RUCU-SEIK-0020	\N	14	12	\N	t	15.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
412	RUCU-SEIK-0021	\N	14	12	\N	t	15.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
413	RUCU-SEIK-0022	\N	14	12	\N	t	13.00	0.00	25.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
414	RUCU-SEIK-0023	\N	14	12	\N	t	15.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
415	RUCU-SEIK-0024	\N	14	12	\N	t	15.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
416	RUCU-SEIK-0025	\N	14	12	\N	t	15.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
417	RUCU-SEIK-0026	\N	14	12	\N	t	15.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
418	RUCU-SEIK-0027	\N	14	12	\N	t	13.00	0.00	25.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
419	RUCU-SEIK-0028	\N	14	12	\N	t	13.00	0.00	25.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
420	RUCU-SEIK-0029	\N	14	12	\N	t	18.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
421	RUCU-SEIK-0030	\N	14	12	\N	t	18.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
422	RUCU-SEIK-0031	\N	14	12	\N	t	18.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
423	RUCU-SEIK-0032	\N	14	12	\N	t	22.00	0.00	30.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
424	RUCU-SEIK-0033	\N	14	12	\N	t	18.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
425	RUCU-SEIK-0034	\N	14	12	\N	t	18.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
426	RUCU-SEIK-0035	\N	14	12	\N	t	18.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
427	RUCU-SEIK-0036	\N	14	12	\N	t	18.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
428	RUCU-SEIK-0037	\N	14	12	\N	t	18.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
429	RUCU-SEIK-0038	\N	14	12	\N	t	18.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
430	RUCU-SEIK-0039	\N	14	12	\N	t	18.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
431	RUCU-SEIK-0040	\N	14	12	\N	t	18.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
432	RUCU-SEIK-0041	\N	14	12	\N	t	18.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
433	RUCU-SEIK-0042	\N	14	12	\N	t	18.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
434	RUCU-SEIK-0043	\N	14	12	\N	t	18.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
435	RUCU-SEIK-0044	\N	14	12	\N	t	18.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
436	RUCU-SEIK-0045	\N	14	12	\N	t	18.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
437	RUCU-SEIK-0046	\N	14	12	\N	t	18.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
438	RUCU-SEIK-0047	\N	14	12	\N	t	18.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
439	RUCU-SEIK-0048	\N	14	12	\N	t	18.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
440	RUCU-SEIK-0049	\N	14	12	\N	t	18.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
441	RUCU-SEIK-0050	\N	14	12	\N	t	18.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
442	RUCU-SEIK-0051	\N	14	12	\N	t	18.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
443	RUCU-SEIK-0052	\N	14	12	\N	t	18.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
444	RUCU-SEIK-0053	\N	14	12	\N	t	18.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
445	RUCU-SEIK-0054	\N	14	12	\N	t	18.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
446	RUCU-SEIK-0055	\N	14	12	\N	t	18.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
447	RUCU-SEIK-0056	\N	14	12	\N	t	20.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
448	RUCU-SEIK-0057	\N	14	12	\N	t	20.00	0.00	50.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
449	RUCU-SEIK-0058	\N	14	12	\N	t	26.00	0.00	65.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
450	RUCU-SEIK-0059	\N	14	12	\N	t	26.00	0.00	65.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
451	RUCU-SEIK-0060	\N	14	12	\N	t	26.00	0.00	65.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
452	RUCU-SEIK-0061	\N	14	12	\N	t	22.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
453	RUCU-SEIK-0062	\N	14	12	\N	t	26.00	0.00	55.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
454	RUCU-SEIK-0063	\N	14	12	\N	t	27.00	0.00	65.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
455	RUCU-SEIK-0064	\N	14	12	\N	t	30.00	0.00	55.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
456	RUCU-SEIK-0065	\N	14	12	\N	t	26.00	0.00	55.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
457	RUCU-SEIK-0066	\N	14	12	\N	t	21.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
458	RUCU-SEIK-0067	\N	14	12	\N	t	25.00	0.00	55.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
459	RUCU-SEIK-0068	\N	14	12	\N	t	26.00	0.00	65.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
460	RUCU-SEIK-0071	\N	14	12	\N	t	28.00	0.00	55.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
461	RUCU-SEIK-0072	\N	14	12	\N	t	35.00	0.00	70.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
462	RUCU-SEIK-0074	\N	14	12	\N	t	35.00	0.00	65.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
463	RUCU-SEIK-0075	\N	14	12	\N	t	35.00	0.00	70.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
464	RUCU-SEIK-0076	\N	14	12	\N	t	62.00	0.00	110.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
465	RUCU-SEIK-0077	\N	14	12	\N	t	35.00	0.00	65.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
466	RUCU-SEIK-0078	\N	14	12	\N	t	35.00	0.00	65.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
467	GREA-TOP1-0001	16OZ	15	13	\N	t	464.00	0.00	580.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
468	TIBE-KORE-0001	\N	16	14	\N	t	1200.00	0.00	2100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
469	FABE-KORE-0001	JT	16	15	\N	t	330.00	0.00	580.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
470	STBO-KORE-0001	\N	16	16	\N	t	240.00	0.00	410.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
471	SECA-KORE-0001	\N	16	17	\N	t	900.00	0.00	1600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
472	ACCA-KORE-0001	\N	16	18	\N	t	600.00	0.00	950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
473	FUFI-KORE-0001	\N	16	19	\N	t	380.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
474	FUFI-KORE-0002	\N	16	19	\N	t	450.00	0.00	800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
475	TIBE-KORE-0002	\N	16	14	\N	t	1250.00	0.00	2200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
477	AIFI-KORE-0001	\N	16	6	\N	t	450.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
478	BEAR-KORE-0001	\N	16	9	\N	t	630.00	0.00	1105.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
479	REBE-KORE-0001	\N	16	21	\N	t	650.00	0.00	1150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
481	IDLE-KORE-0001	\N	16	22	\N	t	420.00	0.00	980.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
482	RIBE-OPTI-0001	\N	17	23	\N	t	350.00	0.00	615.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
483	BELT-OPTI-0001	\N	17	24	\N	t	195.00	0.00	340.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
484	TOBE-OPTI-0001	9.5*775	17	25	\N	t	207.00	0.00	360.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
485	TOBE-OPTI-0002	MARATHON (13*990)	17	25	\N	t	280.00	0.00	490.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
486	TOBE-OPTI-0003	MARATHON (13*1040)	17	25	\N	t	300.00	0.00	525.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
487	TOBE-OPTI-0004	MARATHON (13*1250)	17	25	\N	t	370.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
488	TOBE-OPTI-0005	MARATHON (13*660)	17	25	\N	t	200.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
489	TOBE-OPTI-0006	MARATHON (17*1420)	17	25	\N	t	676.00	0.00	1185.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
491	BUHO-ZAPP-0002	24V	18	26	\N	t	180.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
492	CLDI-EXED-0001	9"X24T	19	27	\N	t	950.00	0.00	1700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
493	CLDI-EXED-0002	10-1/4 "X14T	19	27	\N	t	850.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
494	CLDI-EXED-0003	13"X14TX38MM	19	27	\N	t	1960.00	0.00	2600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
495	CLDI-EXED-0004	9"X21T	19	27	\N	t	950.00	0.00	1300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
496	CLCO-EXED-0001	12"	19	28	\N	t	4300.00	0.00	5550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
497	CLCO-EXED-0002	10.25"	19	28	\N	t	2120.00	0.00	2800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
498	BRPA-NBKX-0001	\N	20	11	\N	t	540.00	0.00	830.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
499	THWA-DAID-0001	\N	21	29	\N	t	75.00	0.00	300.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
500	TICA-TAIW-0001	MEDIUM	22	30	\N	t	1465.00	0.00	2500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
501	OISE-NOKX-0187	95*118*10	2	1	\N	t	210.00	0.00	290.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
502	CMKI-MIKA-0001	20MM	23	31	\N	t	1350.00	0.00	2070.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
503	PIPI-ORIO-0001	30*16; KIA BESTA 2.7	24	32	\N	t	150.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
504	PIPI-ORIO-0002	43*80; ISUZU	24	32	\N	t	340.00	0.00	580.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
505	VASE-NOKX-0001	C240/C190	2	33	\N	t	22.00	0.00	40.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
506	WHCY-MIKA-0001	50.80MM	23	34	\N	t	2100.00	0.00	3100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
507	WHCY-MIKA-0002	55.56MM	23	34	\N	t	2670.00	0.00	3900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
508	WHCY-MIKA-0003	\N	23	34	\N	t	2100.00	0.00	3100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
509	WHCY-MIKA-0004	44MM	23	34	\N	t	1630.00	0.00	2800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
510	ACCA-SGPX-0001	163"	5	18	\N	t	150.00	0.00	270.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
511	ENSU-BEIX-0001	\N	25	35	\N	t	415.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
512	ENSU-BEIX-0002	\N	25	35	\N	t	290.00	0.00	510.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
513	ENSU-BEIX-0003	LH/RH	25	35	\N	t	365.00	0.00	640.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
514	ENSU-BEIX-0004	LH/RH	25	35	\N	t	500.00	0.00	880.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
515	ENSU-BEIX-0005	LH/RH	25	35	\N	t	500.00	0.00	880.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
516	TRSU-BEIX-0001	\N	25	36	\N	t	1445.00	0.00	2530.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
517	OISE-NOKX-0188	115*156*15*31	2	1	\N	t	525.00	0.00	670.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
518	GLPL-CIRC-0001	\N	26	37	\N	t	110.00	0.00	195.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
519	OIFI-GENU-0001	C-111	27	38	\N	t	105.00	0.00	240.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
520	ENSU-BEIX-0006	\N	25	35	\N	t	290.00	0.00	510.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
521	ENSU-MMCX-0001	\N	28	35	\N	t	1690.00	0.00	2300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
522	AIFI-ASAH-0001	\N	29	6	\N	t	1525.00	0.00	1600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
523	SOVA-CIRC-0001	24V	26	39	\N	t	310.00	0.00	545.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
524	OIPU-SGPX-0001	\N	5	40	\N	t	1800.00	0.00	3150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
525	VASE-NOKX-0002	\N	2	33	\N	t	22.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
526	OISE-SGPX-0001	60*80*8	5	1	\N	t	75.00	0.00	170.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
527	UJOI-SEAL-0001	\N	30	20	\N	t	110.00	0.00	195.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
528	OISE-SGPX-0002	79*99*8	5	1	\N	t	140.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
529	BEAR-NSKX-0001	\N	31	9	\N	t	300.00	0.00	560.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
530	BEAR-NSKX-0002	\N	31	9	\N	t	300.00	0.00	560.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
531	SHAB-TOKI-0001	\N	32	41	\N	t	1056.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
532	SHAB-TOKI-0002	\N	32	41	\N	t	1056.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
533	SHAB-TOKI-0003	\N	32	41	\N	t	1122.00	0.00	1600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
534	SHAB-TOKI-0004	\N	32	41	\N	t	990.00	0.00	1400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
535	BEAR-NTNX-0001	\N	33	9	\N	t	100.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
536	BEAR-KOYO-0002	\N	11	9	\N	t	138.00	0.00	240.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
537	BEAR-NTNX-0002	\N	33	9	\N	t	112.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
538	BEAR-NTNX-0003	\N	33	9	\N	t	112.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
539	BEAR-NSKX-0003	\N	31	9	\N	t	325.00	0.00	470.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
540	BEAR-KOYO-0003	\N	11	9	\N	t	112.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
541	BEAR-KOYO-0004	\N	11	9	\N	t	150.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
542	OISE-NOKX-0189	18*34*7.9	2	1	\N	t	90.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
543	OIFI-FUJI-0001	\N	34	38	\N	t	90.00	0.00	160.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
544	OIFI-FUJI-0002	\N	34	38	\N	t	480.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
545	BEAR-NSKX-0004	\N	31	9	\N	t	85.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
546	BEAR-NOKX-0001	\N	2	9	\N	t	80.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
547	TSUN-TOGU-0001	\N	3	42	\N	t	78.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
548	TSUN-TOGU-0002	\N	3	42	\N	t	78.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
549	TREN-MIKA-0001	\N	23	4	\N	t	1130.00	0.00	1900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
550	WHCY-MIKA-0005	\N	23	34	\N	t	2150.00	0.00	3200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
551	WHCY-MIKA-0006	\N	23	34	\N	t	1520.00	0.00	2200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
552	WHCY-MIKA-0007	\N	23	34	\N	t	1380.00	0.00	2000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
553	WHCY-MIKA-0008	\N	23	34	\N	t	2720.00	0.00	4000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
554	WHCY-MIKA-0009	\N	23	34	\N	t	1670.00	0.00	2500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
555	WHCY-MIKA-0010	\N	23	34	\N	t	1340.00	0.00	2000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
556	WHCY-MIKA-0011	\N	23	34	\N	t	1950.00	0.00	2900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
557	CLOP-MIDO-0001	\N	35	43	\N	t	460.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
558	CLOP-MIKA-0001	\N	23	43	\N	t	460.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
559	CLOP-MIKA-0002	\N	23	43	\N	t	460.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
560	CMKI-MIKA-0002	\N	23	31	\N	t	90.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
561	UJOI-MATS-0001	\N	36	20	\N	t	540.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
562	CLOP-MIKA-0003	\N	23	43	\N	t	460.00	0.00	780.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
563	CLOP-MIKA-0004	\N	23	43	\N	t	470.00	0.00	780.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
564	PSRE-KBXX-0001	\N	37	44	\N	t	1010.00	0.00	1700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
565	PSRE-KBXX-0002	\N	37	44	\N	t	1680.00	0.00	2800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
566	CMKI-MIKA-0003	\N	23	31	\N	t	115.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
567	CMKI-MIKA-0004	`	23	31	\N	t	240.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
568	CMKI-MIKA-0005	\N	23	31	\N	t	145.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
569	CMKI-MIKA-0006	\N	23	31	\N	t	130.00	0.00	260.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
570	CMKI-MIKA-0007	\N	23	31	\N	t	92.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
571	CMKI-MIKA-0008	\N	23	31	\N	t	130.00	0.00	260.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
572	CMKI-MIKA-0009	\N	23	31	\N	t	130.00	0.00	260.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
573	CMKI-MIKA-0010	\N	23	31	\N	t	130.00	0.00	260.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
574	CMKI-MIKA-0011	\N	23	31	\N	t	95.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
575	CMKI-MIKA-0012	\N	23	31	\N	t	125.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
576	CMKI-MIKA-0013	\N	23	31	\N	t	90.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
577	CMKI-MIKA-0014	\N	23	31	\N	t	125.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
578	CMKI-MIKA-0015	\N	23	31	\N	t	185.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
579	CMKI-MIKA-0016	\N	23	31	\N	t	130.00	0.00	260.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
580	CMKI-MIKA-0017	\N	23	31	\N	t	133.00	0.00	260.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
581	CMKI-MIKA-0018	\N	23	31	\N	t	93.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
582	BEAR-NTNX-0004	\N	33	9	\N	t	325.00	0.00	570.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
583	BEAR-NTNX-0005	\N	33	9	\N	t	400.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
584	BEAR-NTNX-0006	\N	33	9	\N	t	275.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
585	OISE-NOKX-0190	74*97*12	2	1	\N	t	215.00	0.00	370.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
586	OISE-NOKX-0191	86.6*110*4.5/6.2	2	1	\N	t	300.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
587	OISE-NOKX-0192	60*72*12; M 7B3	2	1	\N	t	90.00	0.00	170.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
588	OISE-NOKX-0193	50*72*12; R HTCR	2	1	\N	t	80.00	0.00	170.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
589	OISE-NOKX-0194	104*139*13; R KAD44L	2	1	\N	t	600.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
590	OISE-NOKX-0195	115*156*26	2	1	\N	t	360.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
591	OISE-NOKX-0196	60*72*12	2	1	\N	t	90.00	0.00	190.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
592	OISE-NOKX-0197	95*118*10	2	1	\N	t	220.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
593	OISE-NOKX-0198	74*97*12	2	1	\N	t	215.00	0.00	370.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
594	OISE-NOKX-0199	32*46*6	2	1	\N	t	55.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
596	ENMO-JAGX-0002	\N	38	45	\N	t	470.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
597	ENMO-JAGX-0003	\N	38	45	\N	t	470.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
598	ENMO-JAGX-0004	\N	38	45	\N	t	170.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
599	ENMO-JAGX-0005	\N	38	45	\N	t	315.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
600	ENMO-JAGX-0006	\N	38	45	\N	t	560.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
601	ENMO-JAGX-0007	\N	38	45	\N	t	280.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
602	ENMO-JAGX-0008	\N	38	45	\N	t	500.00	0.00	880.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
603	ENMO-JAGX-0009	\N	38	45	\N	t	470.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
604	ENMO-JAGX-0010	\N	38	45	\N	t	890.00	0.00	1580.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
605	ENMO-JAGX-0011	\N	38	45	\N	t	170.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
606	ENMO-JAGX-0012	\N	38	45	\N	t	315.00	0.00	580.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
607	ENMO-JAGX-0013	\N	38	45	\N	t	470.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
608	ENMO-JAGX-0014	\N	38	45	\N	t	390.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
610	CRBE-DAID-0002	\N	21	46	\N	t	3060.00	0.00	4300.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
611	KPKI-CULT-0001	\N	39	47	\N	t	2350.00	0.00	4000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
614	TLSO-NUPR-0002	BRAZILLA S.C CERAMIC	40	49	\N	t	20.00	0.00	60.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
615	CLKI-MAT1-0001	\N	41	50	\N	t	535.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
616	RUCU-SEIK-0079	\N	14	12	\N	t	37.00	0.00	65.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
617	COTA-TAIW-0001	\N	22	51	\N	t	950.00	0.00	1700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
618	COTA-TAIW-0002	\N	22	51	\N	t	390.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
619	COTA-TAIW-0003	\N	22	51	\N	t	290.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
620	COTA-TAIW-0004	\N	22	51	\N	t	330.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
622	DOLO-TAIW-0002	\N	22	52	\N	t	650.00	0.00	1150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
623	DOLO-TAIW-0003	\N	22	52	\N	t	520.00	0.00	900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
624	DOLO-TAIW-0004	\N	22	52	\N	t	480.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
625	DOLO-TAIW-0005	\N	22	52	\N	t	370.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
626	WINO-TAIW-0001	\N	22	53	\N	t	110.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
627	WINO-TAIW-0002	\N	22	53	\N	t	90.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
628	WINO-TAIW-0003	\N	22	53	\N	t	130.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
629	WSWA-TWXX-0001	24V	42	54	\N	t	260.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
630	BRSH-NUPR-0001	\N	40	55	\N	t	800.00	0.00	1350.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
631	BRPA-NUPR-0001	\N	40	11	\N	t	690.00	0.00	1100.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
632	IDBE-HTCX-0001	\N	43	56	\N	t	1100.00	0.00	1900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
633	TCTE-HTCX-0001	\N	43	57	\N	t	1690.00	0.00	2800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
634	TCTE-HTCX-0002	\N	43	57	\N	t	1100.00	0.00	1900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
635	DOHA-TAIW-0001	OUTER RR LH	22	58	\N	t	500.00	0.00	900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
636	DOHA-TAIW-0002	OUTER RR RH	22	58	\N	t	500.00	0.00	900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
637	WILI-TAIW-0001	ST100	22	59	\N	t	850.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
638	DOHA-TAIW-0003	BLACK INNER LH	22	58	\N	t	75.00	0.00	135.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
639	DOHA-TAIW-0004	BLACK INNER RH	22	58	\N	t	75.00	0.00	135.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
641	DIRO-GSKX-0001	\N	44	61	\N	t	60.00	0.00	120.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
642	DOHA-TAIW-0005	BLACK FRT,OUTER LH-RH	22	58	\N	t	240.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
643	DOHA-TAIW-0006	BLACK RR, OUTER LH-RH	22	58	\N	t	240.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
644	COLA-TAIW-0001	BLACK LH	22	62	\N	t	350.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
645	COLA-TAIW-0002	BLACK RH	22	62	\N	t	350.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
646	FOLA-NUPR-0001	CLEAR LH	40	63	\N	t	320.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
647	FOLA-NUPR-0002	CLEAR RH	40	63	\N	t	320.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
648	OIFI-UNAS-0001	THROW-AWAY TYPE	7	38	\N	t	247.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
649	OIFI-UNAS-0002	THROW-AWAY TYPE	7	38	\N	t	130.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
650	OIFI-UNAS-0003	THROW-AWAY TYPE	7	38	\N	t	132.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
651	FUFI-UNAS-0001	THROW-AWAY TYPE	7	19	\N	t	158.00	0.00	210.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
655	RIBE-BAND-0003	PLAIN	46	23	\N	t	201.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
657	RIBE-BAND-0005	\N	46	23	\N	t	239.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
658	SABU-OPT1-0001	\N	47	65	\N	t	590.00	0.00	950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
659	SABU-OPT1-0002	\N	47	65	\N	t	425.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
660	SABU-OPT1-0003	\N	47	65	\N	t	280.00	0.00	490.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
661	SABU-OPT1-0004	\N	47	65	\N	t	500.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
662	SABU-OPT1-0005	\N	47	65	\N	t	485.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
663	TEBE-GMGX-0002	\N	48	66	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
664	SILA-SPIN-0001	24V LONG W/ DROP LIGHT	49	67	\N	t	120.00	0.00	220.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
665	HEGA-SPOR-0001	\N	50	64	\N	t	275.00	0.00	480.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
666	HEGA-SPOR-0002	\N	50	64	\N	t	235.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
667	OVGA-SPOR-0001	ASBESTOS	50	68	\N	t	820.00	0.00	1480.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
668	RIBE-BAND-0006	\N	46	23	\N	t	347.00	0.00	590.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
656	RIBE-BAND-0004	PLAIN	46	23	\N	t	0.00	0.00	300.00	2025-09-07 02:14:24.518944+00	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
653	RIBE-BAND-0001	PLAIN	46	23	\N	t	0.00	0.00	350.00	2025-09-09 03:26:33.995254+00	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
609	CRBE-DAID-0001	\N	21	46	\N	t	0.00	0.00	3700.00	2025-09-09 03:30:49.863893+00	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
640	TGHA-TAIW-0001	CHROME	22	60	\N	t	0.00	0.00	800.00	2025-09-09 03:31:21.203691+00	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
612	MABE-DAID-0001	\N	21	48	\N	t	0.00	0.00	3800.00	2025-09-09 04:08:23.455786+00	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
669	RIBE-BAND-0007	\N	46	23	\N	t	377.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
670	RIBE-BAND-0008	\N	46	23	\N	t	427.00	0.00	730.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
671	RIBE-BAND-0009	\N	46	23	\N	t	309.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
672	RIBE-BAND-0010	\N	46	23	\N	t	446.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
673	RIBE-BAND-0011	\N	46	23	\N	t	515.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
674	RIBE-BAND-0012	\N	46	23	\N	t	907.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
675	RIBE-BAND-0013	\N	46	23	\N	t	794.00	0.00	1300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
676	RIBE-BAND-0014	\N	46	23	\N	t	691.00	0.00	1150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
677	RIBE-BAND-0015	\N	46	23	\N	t	1256.00	0.00	2000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
678	RIBE-BAND-0016	\N	46	23	\N	t	864.00	0.00	1180.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
679	RIBE-BAND-0017	\N	46	23	\N	t	1057.00	0.00	1800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
680	RIBE-BAND-0018	\N	46	23	\N	t	690.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
681	RIBE-BAND-0019	\N	46	23	\N	t	870.00	0.00	1250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
682	TOBE-BAND-0001	9.5*775	46	25	\N	t	177.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
683	TOBE-BAND-0002	9.5*640	46	25	\N	t	177.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
684	TOBE-BAND-0003	9.5*650	46	25	\N	t	177.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
685	TOBE-BAND-0004	9.5*675	46	25	\N	t	177.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
686	TOBE-BAND-0005	9.5*765	46	25	\N	t	177.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
687	TOBE-BAND-0006	9.5*950	46	25	\N	t	246.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
688	TOBE-BAND-0007	12*925/13*865 W/T	46	25	\N	t	242.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
689	TOBE-BAND-0008	12*1075/13*1015"W/T	46	25	\N	t	284.00	0.00	490.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
690	TOBE-BAND-0009	12*1125/13*165"W/T	46	25	\N	t	298.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
691	TOBE-BAND-0010	12*1150/13*1090"W/T	46	25	\N	t	324.00	0.00	480.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
692	TOBE-BAND-0011	12.5*1200"W/T	46	25	\N	t	319.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
693	TOBE-BAND-0012	12*1350/13*1300"W/T	46	25	\N	t	360.00	0.00	520.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
694	TOBE-BAND-0013	12*1375/13*1320"W/T	46	25	\N	t	386.00	0.00	580.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
695	EFPU-MARU-0001	\N	51	69	\N	t	650.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
696	COLA-NUPR-0001	CYAN	40	62	\N	t	240.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
698	SILA-SPIN-0002	LONG W/DROP LIGHT 24V	49	67	\N	t	120.00	0.00	220.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
699	SILA-SPIN-0003	LONG W/DROP LIGHT 24V	49	67	\N	t	120.00	0.00	220.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
700	SILA-SPIN-0004	LONG W/DROP LIGHT 24V	49	67	\N	t	120.00	0.00	220.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
701	SILA-SPIN-0005	LONG W/DROP LIGHT 24V	49	67	\N	t	160.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
702	SILA-SPIN-0006	SHORT W/DROP LIGHT 24V	49	67	\N	t	100.00	0.00	190.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
703	BRPA-NUPR-0002	FRONT	40	11	\N	t	530.00	0.00	900.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
704	BRPA-NUPR-0003	\N	40	11	\N	t	360.00	0.00	620.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
705	FABL-JAGX-0001	\N	38	70	\N	t	945.00	0.00	1750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
706	ENMO-JAGX-0015	\N	38	45	\N	t	1170.00	0.00	2100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
707	ENMO-JAGX-0016	\N	38	45	\N	t	1060.00	0.00	1950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
708	ENMO-JAGX-0017	\N	38	45	\N	t	1170.00	0.00	2100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
709	RUCU-SEIK-0081	\N	14	12	\N	t	14.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
711	BEAR-KOYO-0006	\N	11	9	\N	t	183.00	0.00	800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
713	BEAR-KOYO-0008	\N	11	9	\N	t	277.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
714	BEAR-KOYO-0009	\N	11	9	\N	t	307.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
715	BEAR-KOYO-0010	\N	11	9	\N	t	702.00	0.00	2200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
716	BEAR-NTNX-0007	\N	33	9	\N	t	1015.00	0.00	5000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
718	UJOI-KOYO-0002	\N	11	20	\N	t	548.00	0.00	1650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
719	UJOI-KOYO-0003	\N	11	20	\N	t	809.00	0.00	2500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
720	UJOI-KOYO-0004	\N	11	20	\N	t	539.00	0.00	1800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
721	UJOI-KOYO-0005	\N	11	20	\N	t	539.00	0.00	1800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
722	UJOI-KOYO-0006	\N	11	20	\N	t	242.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
723	UJOI-KOYO-0007	\N	11	20	\N	t	268.00	0.00	950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
724	UJOI-KOYO-0008	\N	11	20	\N	t	405.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
725	UJOI-KOYO-0009	\N	11	20	\N	t	608.00	0.00	1950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
726	UJOI-KOYO-0010	\N	11	20	\N	t	136.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
727	BEAR-NTNX-0008	\N	33	9	\N	t	408.00	0.00	1450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
728	BEAR-NTNX-0009	\N	33	9	\N	t	570.00	0.00	2500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
729	BEAR-KOYO-0011	\N	11	9	\N	t	462.00	0.00	1400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
730	BEAR-KOYO-0012	\N	11	9	\N	t	552.00	0.00	1700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
731	BEAR-KOYO-0013	\N	11	9	\N	t	666.00	0.00	2000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
732	BEAR-KOYO-0014	\N	11	9	\N	t	804.00	0.00	2500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
733	BEAR-KOYO-0015	\N	11	9	\N	t	960.00	0.00	3100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
734	UJOI-KOYO-0011	\N	11	20	\N	t	960.00	0.00	2650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
735	UJOI-KOYO-0012	\N	11	20	\N	t	548.00	0.00	1650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3327	CLRE-NSKX-0005	ENCS 112	31	329	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
736	UJOI-KOYO-0013	\N	11	20	\N	t	276.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
737	UJOI-KOYO-0014	\N	11	20	\N	t	539.00	0.00	1800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
738	UJOI-KOYO-0015	\N	11	20	\N	t	268.00	0.00	950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
739	UJOI-GMBX-0001	\N	52	20	\N	t	510.00	0.00	1400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
740	UJOI-GMBX-0002	\N	52	20	\N	t	234.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
741	UJOI-GMBX-0003	\N	52	20	\N	t	774.00	0.00	2150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
742	UJOI-GMBX-0004	\N	52	20	\N	t	273.00	0.00	770.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
743	UJOI-GMBX-0005	\N	52	20	\N	t	558.00	0.00	1550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
744	UJOI-GMBX-0006	\N	52	20	\N	t	936.00	0.00	2600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
745	UJOI-GMBX-0007	\N	52	20	\N	t	132.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
746	UJOI-GMBX-0008	\N	52	20	\N	t	246.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
747	UJOI-GMBX-0009	\N	52	20	\N	t	273.00	0.00	780.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
748	UJOI-GMBX-0010	\N	52	20	\N	t	744.00	0.00	2150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
749	UJOI-GMBX-0011	\N	52	20	\N	t	1008.00	0.00	2700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
750	UJOI-GMBX-0012	\N	52	20	\N	t	138.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
751	UJOI-GMBX-0013	\N	52	20	\N	t	786.00	0.00	2200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
752	UJOI-GMBX-0014	\N	52	20	\N	t	688.00	0.00	1950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
753	HELA-TAIW-0001	KIA BONGO LH	22	71	\N	t	1890.00	0.00	3250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
754	HELA-TAIW-0002	MIT FUSO CANTER	22	71	\N	t	690.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
755	HELA-TAIW-0003	MIT FUSO CANTER	22	71	\N	t	690.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
756	HELA-TAIW-0004	MITS FUSO FLOATING	22	71	\N	t	720.00	0.00	1350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
757	HELA-TAIW-0005	MITS FUSO FLOATING	22	71	\N	t	720.00	0.00	1350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
758	HELA-TAIW-0006	PROJECTOR TYPE	22	71	\N	t	2400.00	0.00	4100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
759	HELA-TAIW-0007	PROJECTOR TYPE	22	71	\N	t	2400.00	0.00	4100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
760	HELA-TAIW-0008	SIDE BRACKET	22	71	\N	t	1900.00	0.00	3280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
761	HELA-TAIW-0009	SIDE BRACKET	22	71	\N	t	1900.00	0.00	3280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
762	HOUS-TAIW-0001	DOUBLE SQUARE	22	72	\N	t	350.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
763	HOUS-TAIW-0002	DOUBLE SQUARE	22	72	\N	t	350.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
764	BAHO-SIRE-0001	2WIRES 12V/24V	53	73	\N	t	160.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
767	HAOU-TAIW-0003	\N	22	74	\N	t	460.00	0.00	800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
768	HAOU-TAIW-0004	\N	22	74	\N	t	460.00	0.00	800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
769	HAIN-TAIW-0001	\N	22	75	\N	t	190.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
770	HAIN-TAIW-0002	\N	22	75	\N	t	190.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
771	HAIN-TAIW-0003	\N	22	75	\N	t	220.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
772	HAIN-TAIW-0004	\N	22	75	\N	t	220.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
773	HAIN-TAIW-0005	\N	22	75	\N	t	420.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
774	HAOU-TAIW-0005	FRT BLACK	22	74	\N	t	400.00	0.00	780.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
775	HAOU-TAIW-0006	FRT BLACK	22	74	\N	t	400.00	0.00	780.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
776	HAOU-TAIW-0007	BLACK	22	74	\N	t	325.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
777	HAOU-TAIW-0008	BLACK	22	74	\N	t	325.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
778	HAOU-TAIW-0009	\N	22	74	\N	t	495.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
779	HAOU-TAIW-0010	\N	22	74	\N	t	290.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
780	HAOU-TAIW-0011	\N	22	74	\N	t	290.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
781	HAOU-TAIW-0012	\N	22	74	\N	t	255.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
782	HAOU-TAIW-0013	\N	22	74	\N	t	255.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
783	HAOU-TAIW-0014	\N	22	74	\N	t	140.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
784	HAOU-TAIW-0015	\N	22	74	\N	t	140.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
785	HAIN-TAIW-0006	BIG GRAY F6A	22	75	\N	t	120.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
786	HAIN-TAIW-0007	BIG GRAY F6A	22	75	\N	t	120.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
787	HELA-TAIW-0010	\N	22	71	\N	t	885.00	0.00	1550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
788	HELA-TAIW-0011	\N	22	71	\N	t	885.00	0.00	1550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
789	TRBO-NOBR-0001	\N	4	76	\N	t	179.00	0.00	310.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
790	TRBO-NOBR-0002	\N	4	76	\N	t	199.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
791	TRBO-NOBR-0003	\N	4	76	\N	t	216.00	0.00	380.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
792	COPO-NOBR-0001	\N	4	77	\N	t	60.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
793	COPO-NOBR-0002	\N	4	77	\N	t	47.00	0.00	80.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
794	DOHA-NOBR-0001	CHROME LH	4	58	\N	t	140.00	0.00	240.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
795	DOHA-NOBR-0002	CHROME RH	4	58	\N	t	140.00	0.00	240.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
796	TRSU-CHIT-0001	\N	54	36	\N	t	1500.00	0.00	3060.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
797	SHAB-CPSA-0001	\N	55	41	\N	t	890.00	0.00	1370.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
798	SHAB-CPSA-0002	\N	55	41	\N	t	1030.00	0.00	1600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
799	SHAB-CPSA-0003	\N	55	41	\N	t	1250.00	0.00	1950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
800	SHAB-CPSA-0004	\N	55	41	\N	t	1300.00	0.00	2000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
801	SHAB-CPSA-0005	\N	55	41	\N	t	1620.00	0.00	2500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
802	SHAB-CPSA-0006	\N	55	41	\N	t	1180.00	0.00	1800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
803	SHAB-CPSA-0007	\N	55	41	\N	t	1200.00	0.00	1850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
804	SHAB-CPSA-0008	\N	55	41	\N	t	860.00	0.00	1350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
805	SHAB-CPSA-0009	\N	55	41	\N	t	1900.00	0.00	2700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
806	SHAB-CPSA-0010	\N	55	41	\N	t	1750.00	0.00	2700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
807	RIBE-MOHA-0001	HEAT AND OIL RESISTANT	13	23	\N	t	153.00	0.00	260.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
808	RIBE-MOHA-0002	HEAT AND OIL RESISTANT	13	23	\N	t	154.00	0.00	260.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
809	RIBE-MOHA-0003	HEAT AND OIL RESISTANT	13	23	\N	t	157.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
810	RIBE-MOHA-0004	HEAT AND OIL RESISTANT	13	23	\N	t	178.00	0.00	340.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
811	RIBE-MOHA-0005	HEAT AND OIL RESISTANT	13	23	\N	t	185.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
812	RIBE-MOHA-0006	HEAT AND OIL RESISTANT	13	23	\N	t	201.00	0.00	360.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
813	RIBE-MOHA-0007	HEAT AND OIL RESISTANT	13	23	\N	t	203.00	0.00	360.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
814	RIBE-MOHA-0008	HEAT AND OIL RESISTANT	13	23	\N	t	197.00	0.00	340.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
815	WHAS-MOHA-0001	W/ABS	13	78	\N	t	2200.00	0.00	3800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
817	TALI-SGMX-0001	LED TYPE	56	79	\N	t	1000.00	0.00	1800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
818	FLRE-MMCX-0001	24V	28	80	\N	t	230.00	0.00	395.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
819	FOLA-SGMX-0001	LED TYPE 12V YELLOW	56	63	\N	t	700.00	0.00	1200.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
820	FOLA-SGMX-0002	LED TYPE 24V YELLOW	56	63	\N	t	700.00	0.00	1200.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
821	FOLA-SGMX-0003	LED TYPE 12V YELLOW	56	63	\N	t	750.00	0.00	1300.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
822	FOLA-SGMX-0004	LED TYPE 24V YELLOW	56	63	\N	t	750.00	0.00	1300.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
823	MIRR-SGMX-0001	MIRROR HEAD	56	81	\N	t	365.00	0.00	620.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
824	MIRR-SGMX-0002	NEW MODEL	56	81	\N	t	200.00	0.00	340.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
825	MIRR-SGMX-0003	NEW MODEL E-361	56	81	\N	t	210.00	0.00	360.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
826	MIRR-SGMX-0004	E-362	56	81	\N	t	200.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
827	MIRR-SGMX-0005	CXM MIRROR HEAD E-363	56	81	\N	t	280.00	0.00	480.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
828	MIRR-SGMX-0006	7 1/2"X12 1/2"E-550	56	81	\N	t	220.00	0.00	380.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
829	MIRR-SGMX-0007	\N	56	81	\N	t	310.00	0.00	530.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
830	MIRR-SGMX-0008	6X10"OLD MODEL E-366	56	81	\N	t	130.00	0.00	230.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
831	MIRR-SGMX-0009	METAL BOLT	56	81	\N	t	250.00	0.00	430.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
832	MIRR-SGMX-0010	METAL BOLT	56	81	\N	t	250.00	0.00	430.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
833	MIRR-SGMX-0011	BOLT METAL BASE	56	81	\N	t	255.00	0.00	435.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
834	MIRR-SGMX-0012	CLAMP METAL BASE	56	81	\N	t	255.00	0.00	435.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
835	MIRR-SGMX-0013	BOLT	56	81	\N	t	315.00	0.00	540.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
836	MIRR-SGMX-0014	BOLT BLACK BASE	56	81	\N	t	66.00	0.00	130.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
837	MIRR-SGMX-0015	BOLT GREY BASE	56	81	\N	t	66.00	0.00	120.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
838	MIRR-SGMX-0016	BOLT TYPE	56	81	\N	t	125.00	0.00	240.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
839	MIRR-SGMX-0017	BOLT OLD MODEL	56	81	\N	t	125.00	0.00	215.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
840	MIRR-SGMX-0018	RH/LH	56	81	\N	t	115.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
842	ENOI-CAST-0002	LITER	57	82	\N	t	230.00	0.00	290.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
843	ENOI-CAST-0003	GAL	57	82	\N	t	418.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
844	ENOI-CAST-0004	LITER	57	82	\N	t	1996.00	0.00	2500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
845	CPSE-YSMW-0001	\N	58	83	\N	t	1500.00	0.00	2600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
847	CPSE-YSMW-0003	\N	58	83	\N	t	1500.00	0.00	2600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
848	CPSE-YSMW-0004	\N	58	83	\N	t	1500.00	0.00	2600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
849	CPSE-YSMW-0005	\N	58	83	\N	t	1500.00	0.00	2600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
850	ALTE-YSMW-0001	SINGLE PULLEY	58	84	\N	t	6500.00	0.00	11100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
851	ALTE-YSMW-0002	\N	58	84	\N	t	6500.00	0.00	11100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
852	VCGA-YSMW-0001	\N	58	85	\N	t	250.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
853	VCGA-YSMW-0002	\N	58	85	\N	t	2500.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
854	IOSE-YSMW-0001	SMALL 16V	58	86	\N	t	1020.00	0.00	1600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
855	IOSE-YSMW-0002	BIG 16V	58	86	\N	t	180.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
856	IOSE-YSMW-0003	\N	58	86	\N	t	1300.00	0.00	2275.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
859	ROAR-YSMW-0003	\N	58	87	\N	t	220.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
860	ROAR-YSMW-0004	\N	58	87	\N	t	500.00	0.00	900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
861	SABU-YSMW-0001	\N	58	65	\N	t	2800.00	0.00	4800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
862	SABU-YSMW-0002	\N	58	65	\N	t	2800.00	0.00	4800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
863	SABU-YSMW-0003	\N	58	65	\N	t	2600.00	0.00	2300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
864	SABU-YSMW-0004	W/O ABS U-RH	58	65	\N	t	2950.00	0.00	5100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
865	SABU-YSMW-0005	W/O ABS U-LH	58	65	\N	t	2950.00	0.00	5100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
866	VSRI-YSMW-0001	\N	58	88	\N	t	130.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
867	VSRI-YSMW-0002	\N	58	88	\N	t	130.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
868	VSRI-YSMW-0003	\N	58	88	\N	t	0.00	0.00	1150.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
869	VSRI-YSMW-0004	\N	58	88	\N	t	0.00	0.00	1150.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
870	VSRI-YSMW-0005	\N	58	88	\N	t	180.00	0.00	320.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
871	VSRI-YSMW-0006	\N	58	88	\N	t	180.00	0.00	320.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
872	VSRI-YSMW-0007	\N	58	88	\N	t	180.00	0.00	320.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
873	VSRI-YSMW-0008	\N	58	88	\N	t	180.00	0.00	320.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
874	VSRI-YSMW-0009	\N	58	88	\N	t	140.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
875	VSRI-YSMW-0010	\N	58	88	\N	t	140.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
876	VSRI-YSMW-0011	\N	58	88	\N	t	220.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
877	VSRI-YSMW-0012	\N	58	88	\N	t	220.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
878	VSRI-YSMW-0013	\N	58	88	\N	t	140.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
879	VSRI-YSMW-0014	\N	58	88	\N	t	140.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
880	VSRI-YSMW-0015	\N	58	88	\N	t	160.00	0.00	290.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
881	VSRI-YSMW-0016	\N	58	88	\N	t	160.00	0.00	290.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
882	VSRI-YSMW-0017	\N	58	88	\N	t	150.00	0.00	265.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
883	VSRI-YSMW-0018	\N	58	88	\N	t	150.00	0.00	265.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
884	VSRI-YSMW-0019	\N	58	88	\N	t	140.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
885	VSRI-YSMW-0020	\N	58	88	\N	t	140.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
886	VSRI-YSMW-0021	\N	58	88	\N	t	125.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
887	VSRI-YSMW-0022	\N	58	88	\N	t	125.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
888	VSRI-YSMW-0023	\N	58	88	\N	t	140.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
889	VSRI-YSMW-0024	\N	58	88	\N	t	140.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
890	VSRI-YSMW-0025	\N	58	88	\N	t	160.00	0.00	290.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
891	VSRI-YSMW-0026	\N	58	88	\N	t	160.00	0.00	290.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
892	VSRI-YSMW-0027	\N	58	88	\N	t	140.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
893	VSRI-YSMW-0028	\N	58	88	\N	t	140.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
894	VSRI-YSMW-0029	\N	58	88	\N	t	150.00	0.00	270.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
895	VSRI-YSMW-0030	\N	58	88	\N	t	150.00	0.00	270.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
896	VSRI-YSMW-0031	\N	58	88	\N	t	150.00	0.00	270.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
897	VSRI-YSMW-0032	\N	58	88	\N	t	150.00	0.00	270.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
898	VSRI-YSMW-0033	\N	58	88	\N	t	180.00	0.00	310.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
899	VSRI-YSMW-0034	\N	58	88	\N	t	180.00	0.00	310.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
900	VSRI-YSMW-0035	\N	58	88	\N	t	140.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
902	VAGU-YSMW-0002	\N	58	89	\N	t	320.00	0.00	600.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
904	VAGU-YSMW-0004	\N	58	89	\N	t	400.00	0.00	580.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
905	VAGU-YSMW-0005	\N	58	89	\N	t	480.00	0.00	820.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
906	VAGU-YSMW-0006	\N	58	89	\N	t	440.00	0.00	760.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
907	VAGU-YSMW-0007	\N	58	89	\N	t	480.00	0.00	830.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
908	VAGU-YSMW-0008	\N	58	89	\N	t	720.00	0.00	125.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
909	VAGU-YSMW-0009	\N	58	89	\N	t	360.00	0.00	620.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
910	VAGU-YSMW-0010	\N	58	89	\N	t	720.00	0.00	1250.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
911	VAGU-YSMW-0011	\N	58	89	\N	t	1280.00	0.00	2180.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
912	VAGU-YSMW-0012	\N	58	89	\N	t	720.00	0.00	1250.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
913	VAGU-YSMW-0013	\N	58	89	\N	t	1620.00	0.00	2800.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
914	VAGU-YSMW-0014	\N	58	89	\N	t	320.00	0.00	550.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
915	VAGU-YSMW-0015	\N	58	89	\N	t	320.00	0.00	550.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
916	VAGU-YSMW-0016	\N	58	89	\N	t	360.00	0.00	650.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
917	VAGU-YSMW-0017	\N	58	89	\N	t	360.00	0.00	650.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
918	VAGU-YSMW-0018	\N	58	89	\N	t	720.00	0.00	1250.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
919	VAGU-YSMW-0019	\N	58	89	\N	t	360.00	0.00	650.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
920	VAGU-YSMW-0020	\N	58	89	\N	t	360.00	0.00	650.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
921	VAGU-YSMW-0021	\N	58	89	\N	t	800.00	0.00	1380.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
922	VAGU-YSMW-0022	\N	58	89	\N	t	480.00	0.00	820.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
923	VAGU-YSMW-0023	\N	58	89	\N	t	540.00	0.00	950.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
924	VAGU-YSMW-0024	\N	58	89	\N	t	120.00	0.00	210.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
925	VAGU-YSMW-0025	\N	58	89	\N	t	120.00	0.00	210.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
926	VAGU-YSMW-0026	\N	58	89	\N	t	160.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
927	VAGU-YSMW-0027	\N	58	89	\N	t	160.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
928	VAGU-YSMW-0028	\N	58	89	\N	t	120.00	0.00	210.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
929	CHBO-YSMW-0001	\N	58	90	\N	t	120.00	0.00	210.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
930	CHBO-YSMW-0002	\N	58	90	\N	t	120.00	0.00	210.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
931	CHBO-YSMW-0003	\N	58	90	\N	t	120.00	0.00	210.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
932	CHBO-YSMW-0004	\N	58	90	\N	t	120.00	0.00	210.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
933	CHBO-YSMW-0005	\N	58	90	\N	t	120.00	0.00	210.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
934	CSCY-YSMW-0001	\N	58	91	\N	t	2800.00	0.00	4800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
935	CRB1-YSMW-0001	\N	58	92	\N	t	2800.00	0.00	4800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
936	CRB1-YSMW-0002	\N	58	92	\N	t	2800.00	0.00	4800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
937	CLFO-YSMW-0001	\N	58	93	\N	t	480.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
938	CLFO-YSMW-0002	\N	58	93	\N	t	1200.00	0.00	2100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
903	VAGU-YSMW-0003	\N	58	89	\N	t	0.00	0.00	630.00	2025-09-09 04:09:24.728111+00	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
939	CLFO-YSMW-0003	\N	58	93	\N	t	250.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
940	CLFO-YSMW-0004	\N	58	93	\N	t	250.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
941	CLFO-YSMW-0005	\N	58	93	\N	t	250.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
942	CLFO-YSMW-0006	\N	58	93	\N	t	620.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
943	VASH-YSMW-0001	\N	58	94	\N	t	100.00	0.00	180.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
944	VASH-YSMW-0002	\N	58	94	\N	t	100.00	0.00	180.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
945	VATA-YSMW-0001	\N	58	95	\N	t	350.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
946	VATA-YSMW-0002	\N	58	95	\N	t	350.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
947	VATA-YSMW-0003	\N	58	95	\N	t	350.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
948	VATA-YSMW-0004	\N	58	95	\N	t	350.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
949	VATA-YSMW-0005	\N	58	95	\N	t	350.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
950	PREC-YSMW-0001	\N	58	96	\N	t	400.00	0.00	690.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
951	PREC-YSMW-0002	\N	58	96	\N	t	400.00	0.00	690.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
952	PREC-YSMW-0003	\N	58	96	\N	t	400.00	0.00	690.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
953	PREC-YSMW-0004	\N	58	96	\N	t	400.00	0.00	690.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
954	PREC-YSMW-0005	\N	58	96	\N	t	400.00	0.00	690.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
955	WHBE-YSMW-0001	\N	58	97	\N	t	1100.00	0.00	1900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
956	BMKI-YSMW-0001	\N	58	98	\N	t	3850.00	0.00	6600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
957	CLSL-YSMW-0001	\N	58	99	\N	t	1200.00	0.00	2100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
958	BRBO-YSMW-0001	\N	58	100	\N	t	4250.00	0.00	7300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
959	WHCY-YSMW-0001	W/O ADJ W/BLEEDER	58	34	\N	t	1400.00	0.00	2400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
960	WHCY-YSMW-0002	W/O ADJ W/BLEEDER	58	34	\N	t	1400.00	0.00	2400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
961	CYHE-YSMW-0001	\N	58	101	\N	t	750.00	0.00	1300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
962	CYHE-YSMW-0002	\N	58	101	\N	t	1250.00	0.00	2200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
963	OPGA-YSMW-0001	CORK	58	102	\N	t	85.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
964	OPGA-YSMW-0002	RUBBER	58	102	\N	t	105.00	0.00	180.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
965	OPGA-YSMW-0003	RUBBER	58	102	\N	t	180.00	0.00	310.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
966	OPGA-YSMW-0004	ASB	58	102	\N	t	250.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
967	OPGA-YSMW-0005	\N	58	102	\N	t	250.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
968	OPGA-YSMW-0006	\N	58	102	\N	t	250.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
969	OPGA-YSMW-0007	\N	58	102	\N	t	230.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
970	OPGA-YSMW-0008	\N	58	102	\N	t	150.00	0.00	270.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
971	OPGA-YSMW-0009	CORK	58	102	\N	t	250.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
972	OPGA-YSMW-0010	22 HOLES RUBBER	58	102	\N	t	150.00	0.00	270.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
973	OPGA-YSMW-0011	SHORT THIN	58	102	\N	t	180.00	0.00	310.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
974	OPGA-YSMW-0012	LONG THICK	58	102	\N	t	230.00	0.00	395.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
975	OPGA-YSMW-0013	\N	58	102	\N	t	240.00	0.00	2300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
976	WIMO-YSMW-0001	\N	58	103	\N	t	1350.00	0.00	2300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
977	WIMO-YSMW-0002	\N	58	103	\N	t	1350.00	0.00	2300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
979	RETA-YSMW-0002	NISSAN/WIGO 14	58	104	\N	t	1300.00	0.00	2300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
980	CYHE-YSMW-0003	2.0MM	58	101	\N	t	480.00	0.00	820.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
981	CYHE-YSMW-0004	\N	58	101	\N	t	550.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
982	VCGA-YSMW-0003	\N	58	85	\N	t	250.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
983	VCGA-YSMW-0004	\N	58	85	\N	t	200.00	0.00	380.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
984	VCGA-YSMW-0005	\N	58	85	\N	t	130.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
985	VCGA-YSMW-0006	\N	58	85	\N	t	280.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
986	IOSE-YSMW-0004	INJECTOR NOZZLE TUBE	58	86	\N	t	65.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
987	IOSE-YSMW-0005	BIG 16V	58	86	\N	t	180.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
988	IOSE-YSMW-0006	SMALL 16V	58	86	\N	t	85.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
989	VASE-YSMW-0001	\N	58	33	\N	t	0.00	0.00	1150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
990	RUBO-MIYA-0001	\N	59	105	\N	t	35.00	0.00	60.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
991	RUBO-MIYA-0002	\N	59	105	\N	t	40.00	0.00	70.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
992	RUBO-MIYA-0003	\N	59	105	\N	t	50.00	0.00	85.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
993	RUBO-MIYA-0004	\N	59	105	\N	t	30.00	0.00	55.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
994	RUBO-MIYA-0005	\N	59	105	\N	t	28.00	0.00	55.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
995	RUBO-MIYA-0006	\N	59	105	\N	t	35.00	0.00	60.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
996	RUBO-MIYA-0007	\N	59	105	\N	t	20.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
997	RUBO-MIYA-0008	\N	59	105	\N	t	28.00	0.00	55.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
998	EPOX-DEVC-0001	\N	60	106	\N	t	65.00	0.00	90.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
999	EPOX-DEVC-0002	\N	60	106	\N	t	105.00	0.00	180.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1000	MAHO-ZAPP-0001	\N	18	107	\N	t	380.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1001	SAPA-3MXX-0001	\N	61	108	\N	t	16.00	0.00	30.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1002	CLDI-EXED-0005	11*24T	19	27	\N	t	1100.00	0.00	1950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1003	CLDI-EXED-0006	11*21T	19	27	\N	t	1100.00	0.00	1950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1004	CLDI-EXED-0007	1/2*24T	19	27	\N	t	800.00	0.00	1400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1005	CLDI-EXED-0008	1/4*24T	19	27	\N	t	850.00	0.00	1600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1006	CLDI-EXED-0009	12*21T	19	27	\N	t	1400.00	0.00	2400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1007	CLDI-EXED-0010	11*12/7	19	27	\N	t	1150.00	0.00	2100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1008	CLDI-EXED-0011	1/4	19	27	\N	t	800.00	0.00	1400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1009	CLDI-EXED-0012	8*21T	19	27	\N	t	900.00	0.00	1650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1010	CLDI-AISI-0001	9*23T	62	27	\N	t	950.00	0.00	1700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1011	CLCO-NOBR-0001	9*23T	4	28	\N	t	2250.00	0.00	3900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1012	CLCO-NOBR-0002	1/2"	4	28	\N	t	1370.00	0.00	2400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1013	CLCO-NOBR-0003	\N	4	28	\N	t	2250.00	0.00	4000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1014	ACCA-NOBR-0001	\N	4	18	\N	t	110.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1015	ACCA-NOBR-0002	\N	4	18	\N	t	110.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1016	RVMI-ORIO-0001	\N	24	109	\N	t	280.00	0.00	490.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1017	AICL-ASAH-0001	\N	29	110	\N	t	145.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1018	AICL-ASAH-0002	\N	29	110	\N	t	120.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1019	OIFI-TOPA-0001	\N	63	38	\N	t	65.00	0.00	120.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1020	CYLI-FEMO-0001	\N	45	111	\N	t	1380.00	0.00	2400.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1021	BEAR-KOYO-0016	\N	11	9	\N	t	105.00	0.00	240.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1022	EPCO-NOBR-0001	3 1/2 W/SPRING	4	112	\N	t	1100.00	0.00	2000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1023	KPKI-CULT-0002	\N	39	47	\N	t	550.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1024	KPKI-CULT-0003	\N	39	47	\N	t	650.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1025	BARE-COMF-0001	\N	64	113	\N	t	185.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1026	BEAR-NTNX-0010	\N	33	9	\N	t	1437.00	0.00	2500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1027	AHSW-ZAPP-0001	\N	18	114	\N	t	325.00	0.00	680.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1028	CACL-DERF-0001	\N	65	115	\N	t	130.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1029	UJOI-SEAL-0002	\N	30	20	\N	t	605.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1030	BLSC-SGPX-0001	\N	5	116	\N	t	12.00	0.00	25.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1031	BRPA-NUPR-0004	\N	40	11	\N	t	1050.00	0.00	1700.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1032	BRPA-NUPR-0005	\N	40	11	\N	t	1300.00	0.00	2000.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1033	AIHO-ZAPP-0001	\N	18	117	\N	t	380.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1034	CLDI-DKXX-0001	\N	66	27	\N	t	4660.00	0.00	6500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1035	CLCO-DKXX-0001	\N	66	28	\N	t	1570.00	0.00	2100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1037	OICO-NOBR-0001	SHORT	4	118	\N	t	3500.00	0.00	6200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1038	STLE-WELD-0001	\N	67	119	\N	t	58.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1039	CVBO-ARMT-0001	SHORT	68	120	\N	t	85.00	0.00	160.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1040	WAPU-GMBX-0001	\N	52	121	\N	t	1050.00	0.00	1900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1041	COOL-ARMT-0001	GAL	68	122	\N	t	0.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1044	RAHO-NIHO-0001	LOWER	69	123	\N	t	367.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1045	RAHO-NIHO-0002	UPPER	69	123	\N	t	238.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1046	RAHO-NIHO-0003	LOWER	69	123	\N	t	276.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1047	RAHO-NIHO-0004	LEFT HAND  UPPER	69	123	\N	t	255.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1048	RAHO-NIHO-0005	L-HL TYPE W/ PLY UPPER	69	123	\N	t	340.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1049	RAHO-NIHO-0006	RIGHT HAND UPPER	69	123	\N	t	255.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1050	RAHO-NIHO-0007	UPPER	69	123	\N	t	595.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1051	RAHO-NIHO-0008	S TYPE 2 3/4' UPPER	69	123	\N	t	586.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1053	RAHO-NIHO-0010	LOWER W/ PLY	69	123	\N	t	837.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1054	RAHO-NIHO-0011	Z HORSE TYPE LOWER	69	123	\N	t	672.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1055	RAHO-NIHO-0012	UPPER	69	123	\N	t	234.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1056	RAHO-NIHO-0013	UPPER	69	123	\N	t	302.00	0.00	510.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1057	RAHO-NIHO-0014	PN. 286773 UPPER	69	123	\N	t	672.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1058	RAHO-NIHO-0015	PN. 286773 UPPER EXTENDED	69	123	\N	t	676.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1059	RAHO-NIHO-0016	\N	69	123	\N	t	680.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1060	RAHO-NIHO-0017	\N	69	123	\N	t	748.00	0.00	1300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1061	RAHO-NIHO-0018	\N	69	123	\N	t	570.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1062	RAHO-NIHO-0019	\N	69	123	\N	t	620.00	0.00	950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1063	RAHO-NIHO-0020	\N	69	123	\N	t	680.00	0.00	1050.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1064	RAHO-NISS-0001	UPPER	70	123	\N	t	344.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1065	RAHO-NISS-0002	LOWER	70	123	\N	t	340.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1066	RAHO-NISS-0003	UPPER	70	123	\N	t	255.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1067	RAHO-NISS-0004	LOWER	70	123	\N	t	562.00	0.00	950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1068	RAHO-NISS-0005	UPPER	70	123	\N	t	464.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1069	RAHO-NIHO-0021	LOWER	69	123	\N	t	697.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1070	RAHO-NIHO-0022	UPPER (CB)	69	123	\N	t	268.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1071	RAHO-NIHO-0023	UPPER	69	123	\N	t	314.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1072	RAHO-NIHO-0024	LOWER	69	123	\N	t	370.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1073	RAHO-NIHO-0025	LOWER	69	123	\N	t	460.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1074	RAHO-NIHO-0026	UPPER	69	123	\N	t	302.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1075	RAHO-NIHO-0027	UPPER SEMI- STRAIGHT	69	123	\N	t	484.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1076	RAHO-NIHO-0028	LOWER SEMI-STRAIGHT	69	123	\N	t	586.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1077	RAHO-NIHO-0029	UPPER	69	123	\N	t	276.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1078	RAHO-NIHO-0030	LOWER	69	123	\N	t	269.00	0.00	510.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1079	RAHO-NIHO-0031	UPPER	69	123	\N	t	255.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1080	RAHO-NIHO-0032	LOWER	69	123	\N	t	260.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1081	RAHO-NIHO-0033	MEDIUM	69	123	\N	t	157.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1082	RAHO-NIHO-0034	BREATHER HOSE	69	123	\N	t	128.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1083	RAHO-NIHO-0035	LOWER	69	123	\N	t	340.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1084	RAHO-NIHO-0036	UPPER	69	123	\N	t	425.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1085	RAHO-NIHO-0037	LOWER	69	123	\N	t	722.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1086	RAHO-NIHO-0038	UPPER (CB)	69	123	\N	t	306.00	0.00	540.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1087	RAHO-NIHO-0039	LOWER (CB)	69	123	\N	t	306.00	0.00	540.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1088	RAHO-NIHO-0040	UPPER	69	123	\N	t	620.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1089	RAHO-NIHO-0041	LOWER	69	123	\N	t	926.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1090	RAHO-NIHO-0042	UPPER WITH PLY	69	123	\N	t	612.00	0.00	920.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1091	RAHO-NIHO-0043	LOWER WITH PLY	69	123	\N	t	476.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1092	RAHO-NIHO-0044	LOWER	69	123	\N	t	251.00	0.00	440.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1093	BYHO-NIHO-0001	\N	69	124	\N	t	128.00	0.00	240.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1094	BYHO-NIHO-0002	\N	69	124	\N	t	128.00	0.00	240.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1095	BYHO-NIHO-0003	\N	69	124	\N	t	89.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1096	BYHO-NIHO-0004	\N	69	124	\N	t	149.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1097	BYHO-NIHO-0005	U-TYPE	69	124	\N	t	110.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1098	BYHO-NIHO-0006	\N	69	124	\N	t	110.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1099	BYHO-NIHO-0007	3/4" U-TYPE	69	124	\N	t	157.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1100	BYHO-NIHO-0008	\N	69	124	\N	t	157.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1101	BYHO-NIHO-0009	\N	69	124	\N	t	110.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1102	ALHO-NIHO-0001	\N	69	125	\N	t	128.00	0.00	240.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1103	ALHO-NIHO-0002	\N	69	125	\N	t	153.00	0.00	270.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1104	ALHO-NIHO-0003	\N	69	125	\N	t	128.00	0.00	240.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1105	ALHO-NIHO-0004	\N	69	125	\N	t	98.00	0.00	180.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1106	ALHO-NIHO-0005	\N	69	125	\N	t	98.00	0.00	180.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1107	ALHO-NIHO-0006	5/8" DSL	69	125	\N	t	119.00	0.00	210.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1108	ALHO-NIHO-0007	\N	69	125	\N	t	157.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1109	ALHO-NIHO-0008	\N	69	125	\N	t	132.00	0.00	240.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1110	ACHO-NIHO-0001	5*18"	69	126	\N	t	663.00	0.00	980.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1111	ACHO-NIHO-0002	5*16"	69	126	\N	t	590.00	0.00	880.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1112	ACHO-NIHO-0003	5*6*18"	69	126	\N	t	862.00	0.00	1300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1113	ACHO-NIHO-0004	5*14"	69	126	\N	t	516.00	0.00	900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1114	BATT-OURS-0001	\N	71	127	\N	t	3375.00	0.00	4500.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1115	BATT-OURS-0002	\N	71	127	\N	t	3375.00	0.00	4500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1116	BATT-OURS-0003	\N	71	127	\N	t	1750.00	0.00	2500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1117	TUPA-KWIK-0001	\N	72	128	\N	t	11.00	0.00	15.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1118	VUGU-NOBR-0001	1.5MM*8.5	4	129	\N	t	0.00	0.00	100.00	\N	\N	1	t	2	FT	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1119	KPKI-KICH-0001	\N	73	47	\N	t	960.00	0.00	1350.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1120	TRBU-GMGE-0001	\N	74	130	\N	t	495.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1121	CLDI-EXED-0013	35MM HOLE | 35X12"X14	19	27	\N	t	1650.00	0.00	2890.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1122	CLDI-EXED-0014	13" 3/4"X141X44M	19	27	\N	t	3750.00	0.00	6565.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1123	SABU-DIZX-0001	\N	75	65	\N	t	245.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1124	AIHO-SGMX-0001	TWO TRUMPET HORN	56	117	\N	t	395.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1125	OIFI-HYMO-0001	BLUE BOX PACKAGING	76	38	\N	t	135.00	0.00	380.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1126	CLCO-AISI-0001	6-3/4"	62	28	\N	t	800.00	0.00	1450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1128	CLDI-AISI-0003	12X10 T6BB1	62	27	\N	t	1600.00	0.00	2850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1129	CLDI-AISI-0004	3EL 9-1/2"X10T	62	27	\N	t	850.00	0.00	1600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1130	BRLI-IBKX-0001	TX/TS(4/S) 4"	77	131	\N	t	1150.00	0.00	1960.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1131	HUNU-OSAK-0001	WASHER TYPE	78	132	\N	t	12.00	0.00	25.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1132	MABE-DAID-0002	\N	21	48	\N	t	1045.00	0.00	1800.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1133	MABE-DAID-0003	\N	21	48	\N	t	955.00	0.00	1650.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1134	TRS1-GTXX-0001	RR 17MM	79	133	\N	t	1685.00	0.00	2900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1135	WCSI-ABSX-0001	12*(5H)426-Q12	80	134	\N	t	965.00	0.00	1700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1136	BEAR-KOYO-0017	25*46*25 mm	11	9	\N	t	235.00	0.00	910.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1137	BEAR-NTNX-0011	45*100*27.25 mm	33	9	\N	t	296.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1138	CYLI-IZUM-0001	F/F,PF	81	111	\N	t	1343.00	0.00	4000.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1139	ALHO-HORS-0001	8 1/2" STEEL MATERIAL	82	125	\N	t	60.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1140	OPGA-NOBR-0001	CRANKCASE	4	102	\N	t	155.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1141	GRGU-NOBR-0001	ORDINARY TYPE 400CC	4	135	\N	t	360.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1142	GRGU-NOBR-0002	ORDINARY TYPE 500CC	4	135	\N	t	400.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1143	AHMA-SGMX-0001	BIG RED BOX	56	136	\N	t	200.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1144	AHMA-SGMX-0002	SMALL RED BOX	56	136	\N	t	180.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1145	ALHO-HORS-0002	9 1/2 STEEL MATERIAL	82	125	\N	t	82.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1146	UJOI-MOHA-0001	\N	13	20	\N	t	445.00	0.00	800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1147	UJOI-MOHA-0002	\N	13	20	\N	t	270.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1148	SPCA-MOHA-0001	120"	13	137	\N	t	260.00	0.00	460.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1149	SPCA-MOHA-0002	143"	13	137	\N	t	370.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1150	SPCA-MOHA-0003	\N	13	137	\N	t	240.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1151	SECA-MOHA-0001	53" LH REAR RING/STUD	13	17	\N	t	385.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1152	SPBU-KICH-0001	\N	73	138	\N	t	80.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1153	SPBU-KICH-0002	\N	73	138	\N	t	120.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1154	SPBU-KICH-0003	\N	73	138	\N	t	72.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1155	SPBU-KICH-0004	\N	73	138	\N	t	95.00	0.00	170.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1156	SPBU-KICH-0005	\N	73	138	\N	t	58.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1157	SPBU-KICH-0006	\N	73	138	\N	t	80.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1159	SPBU-KICH-0008	\N	73	138	\N	t	95.00	0.00	170.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1160	SPBU-KICH-0009	W/STEEL	73	138	\N	t	106.00	0.00	190.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1161	SPBU-KICH-0010	FRONT W/STEEL	73	138	\N	t	122.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1162	SPBU-KICH-0011	REAR W/STEEL	73	138	\N	t	138.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1163	SABU-NOBR-0001	\N	4	65	\N	t	33.00	0.00	60.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1164	SECA-MOHA-0002	\N	13	17	\N	t	465.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1165	SECA-MOHA-0003	RH|38"|FRONT RING	13	17	\N	t	365.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1166	SECA-MOHA-0004	LH|38"|REAR RING/STUD	13	17	\N	t	365.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1167	SECA-MOHA-0005	RH|43"|FRONT RING	13	17	\N	t	365.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1168	SECA-MOHA-0006	LH|43"|REAR RING /STUD	13	17	\N	t	365.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1169	SECA-MOHA-0007	RH|51"|FRONT RING	13	17	\N	t	385.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1170	SECA-MOHA-0008	LH|51"|REAR RING/STUD	13	17	\N	t	385.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1171	SECA-MOHA-0009	RH|53"|FRONT RING	13	17	\N	t	385.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1172	HACA-MOHA-0001	\N	13	139	\N	t	290.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1173	CLDI-MOHA-0001	17"X14T	13	27	\N	t	5140.00	0.00	8800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1174	CLDI-MOHA-0002	7"X19T|REF.DDK2850	13	27	\N	t	670.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1175	CLDI-MOHA-0003	12"X14T	13	27	\N	t	1330.00	0.00	2300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1176	ESCA-MOHA-0001	95" W/PLASTIC	13	140	\N	t	245.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1177	ESCA-MOHA-0002	106" W/PLASTIC	13	140	\N	t	263.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1178	HACA-MOHA-0002	\N	13	139	\N	t	400.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1179	HACA-MOHA-0003	LONG |112"	13	139	\N	t	465.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1180	HACA-MOHA-0004	15"	13	139	\N	t	1450.00	0.00	2500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1181	HACA-MOHA-0005	SCREW &PIN 16"/192"	13	139	\N	t	1450.00	0.00	2500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1182	HACA-MOHA-0006	SCREW&PIN 17"/204"	13	139	\N	t	1550.00	0.00	2700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1183	HACA-MOHA-0007	\N	13	139	\N	t	135.00	0.00	240.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1184	HACA-MOHA-0008	REAR |RH	13	139	\N	t	270.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1185	BEDR-KEMX-0001	\N	83	141	\N	t	310.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1186	BEDR-KEMX-0002	\N	83	141	\N	t	670.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1187	BEDR-KEMX-0003	2C SMALL |10T	83	141	\N	t	1030.00	0.00	1800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1188	BEDR-KEMX-0004	9T	83	141	\N	t	1030.00	0.00	1800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1189	CPBU-NOBR-0001	LONG	4	142	\N	t	95.00	0.00	165.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1190	SARU-NOBR-0001	\N	4	143	\N	t	6.00	0.00	25.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1191	SCBU-NOBR-0001	\N	4	144	\N	t	33.00	0.00	80.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1192	SPB1-NOBR-0001	RUBBER MODEL	4	145	\N	t	38.00	0.00	80.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1193	SPB1-NOBR-0002	RUBBER MODEL	4	145	\N	t	82.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1194	SPB1-NOBR-0003	RUBBER MODEL	4	145	\N	t	122.00	0.00	230.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1195	SPB1-NOBR-0004	RUBBER MODEL	4	145	\N	t	17.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1196	SHBO-UHDU-0001	BLACK	84	146	\N	t	175.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1197	SHKN-HEDU-0001	STAINLESS DESIGN	85	147	\N	t	250.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1198	SECU-NOBR-0001	\N	4	148	\N	t	350.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1199	SILA-SGMX-0001	LED TYPE	56	67	\N	t	115.00	0.00	210.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1201	SILA-SGMX-0003	LED TYPE	56	67	\N	t	160.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1203	SHAB-CPSA-0011	GAS/DIESEL 86-06 REAR	55	41	\N	t	960.00	0.00	1700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1204	SHAB-CPSA-0012	GAS/DIESEL 82-88 REAR	55	41	\N	t	1250.00	0.00	2200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1202	SILA-SGMX-0004-merged-1201	LED TYPE	56	67	\N	f	160.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	2025-09-13 00:06:50.247424+00	\N	1201
1200	SILA-SGMX-0002-merged-1199	LED TYPE	56	67	\N	f	115.00	0.00	210.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	2025-09-13 00:06:50.413982+00	\N	1199
1205	WLNU-NOBR-0001	16NUTS+1KEY|CHROME 45MM	4	149	\N	t	620.00	0.00	1085.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1206	MIRR-SGMX-0019	WIDE MIRROR METAL BASE	56	81	\N	t	245.00	0.00	480.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1207	MIRR-SGMX-0020	BOLT(PLASTC EDGE)	56	81	\N	t	125.00	0.00	230.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1208	MIRR-SGMX-0021	CLAMP(PLASTIC EDGE)	56	81	\N	t	145.00	0.00	270.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1209	MIRR-SGMX-0022	W/BRACKET	56	81	\N	t	1050.00	0.00	1800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1210	MIRR-SGMX-0023	BUMPER MIRROR 5 3/4"	56	81	\N	t	87.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1211	MIRR-SGMX-0024	MIRROR HEAD 6"	56	81	\N	t	185.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1212	MIRR-SGMX-0025	\N	56	81	\N	t	280.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1213	SHAB-CPSA-0013	\N	55	41	\N	t	2475.00	0.00	4300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1214	MIRR-SGMX-0026	12 1/4"X9 1/4	56	81	\N	t	400.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1215	MIRR-SGMX-0027	NEW MODEL	56	81	\N	t	210.00	0.00	390.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1216	MIRR-SGMX-0028	\N	56	81	\N	t	200.00	0.00	370.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1217	MIRR-SGMX-0029	MIRROR HEAD	56	81	\N	t	280.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1218	MIRR-SGMX-0030	7 1/2"X12 1/2"	56	81	\N	t	220.00	0.00	390.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1219	MIRR-SGMX-0031	WITH ANGLE MIRROR 8 1/2"	56	81	\N	t	350.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1221	MIRR-SGMX-0033	SUPER CARRY RH/LH	56	81	\N	t	300.00	0.00	530.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1222	MIRR-SGMX-0034	RH|LH	56	81	\N	t	500.00	0.00	950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1223	MIRR-SGMX-0035	OLD MODEL 6X10"	56	81	\N	t	130.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1224	MIRR-SGMX-0036	STRAIGHT BOLT 6X10"	56	81	\N	t	130.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1225	SHKN-HEDU-0002	STAINLESS DESIGN	85	147	\N	t	250.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1226	SHKN-HEDU-0003	RUBBER TYPE	85	147	\N	t	250.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1227	ALSO-NOBR-0001	W/O WIRE	4	150	\N	t	2.00	0.00	5.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1228	ALSO-NOBR-0002	W/O WIRE	4	150	\N	t	2.00	0.00	5.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1229	ALSO-NOBR-0003	W/O WIRE	4	150	\N	t	2.00	0.00	5.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1230	ALSO-NOBR-0004	W/O WIRE	4	150	\N	t	2.00	0.00	5.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1231	SBHO-BLIT-0001	\N	86	151	\N	t	360.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1232	SBHO-BLIT-0002	\N	86	151	\N	t	360.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1233	SBHO-BLIT-0003	\N	86	151	\N	t	460.00	0.00	800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1234	WHCY-MOHA-0001	FRONT RH|1 1/8"	13	34	\N	t	530.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1235	WHCY-MOHA-0002	FRONT LH|1 1/8"	13	34	\N	t	530.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1236	WHCY-MOHA-0003	FRONT RH|1 1/8"	13	34	\N	t	530.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1237	WHCY-MOHA-0004	FRONT LH|1 1/8"	13	34	\N	t	530.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1238	WHCY-MOHA-0005	\N	13	34	\N	t	340.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1239	WHCY-MOHA-0006	FRONT LH|1 1/4"	13	34	\N	t	540.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1240	CLSL-MOHA-0001	DIESEL 92-93 13/16"	13	99	\N	t	425.00	0.00	860.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1241	CLSL-MOHA-0002	90-97 11/16"	13	99	\N	t	385.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1242	CLSL-MOHA-0003	92-97 13/16"	13	99	\N	t	425.00	0.00	840.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1243	WHCY-MOHA-0007	REAR RH 7/8"	13	34	\N	t	445.00	0.00	860.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1244	WHCY-MOHA-0008	REAR LH 7/8"	13	34	\N	t	445.00	0.00	860.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1245	BRBO-MOHA-0001	METAL TUBE|OEM TYPE	13	100	\N	t	1730.00	0.00	3000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1246	BRBO-MOHA-0002	\N	13	100	\N	t	1730.00	0.00	3000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1247	BRBO-MOHA-0003	\N	13	100	\N	t	1730.00	0.00	3000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1248	BRBO-MOHA-0004	\N	13	100	\N	t	1800.00	0.00	3100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1249	EFPU-BLIT-0001	\N	86	69	\N	t	660.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1250	EFPU-BLIT-0002	\N	86	69	\N	t	660.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1251	BRBO-MOHA-0006	\N	13	100	\N	t	2030.00	0.00	3500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1252	BRBO-MOHA-0007	\N	13	100	\N	t	1850.00	0.00	3550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1253	BRPA-MOHA-0002	FRONT	13	11	\N	t	280.00	0.00	490.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1254	CLBO-MOHA-0001	\N	13	152	\N	t	1800.00	0.00	3100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1255	CLSL-MOHA-0004	5/8"	13	99	\N	t	360.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1256	CLSL-MOHA-0005	7/8"	13	99	\N	t	360.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1257	CLSL-MOHA-0006	3/4"	13	99	\N	t	350.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1258	BMKI-MOHA-0001	7/8"|SCRUM W/TUBE |SHORT BODY	13	98	\N	t	1550.00	0.00	2700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1259	CMKI-MOHA-0001	2.5 DSL 95|5/8"	13	31	\N	t	740.00	0.00	1300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1260	CMKI-MOHA-0002	5/8"	13	31	\N	t	810.00	0.00	1400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1261	CLSL-MOHA-0007	13/16"	13	99	\N	t	480.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1262	CLSL-MOHA-0008	94-07|97-00|3/4"	13	99	\N	t	500.00	0.00	900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1263	CLSL-MOHA-0009	97-00|13/16"	13	99	\N	t	385.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1264	CLSL-MOHA-0010	96-03|3/4"	13	99	\N	t	320.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1265	CLSL-MOHA-0011	\N	13	99	\N	t	385.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1266	AIFI-KOSA-0002	95-100|95-99	8	6	\N	t	355.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1267	FUFI-KOSA-0001	BY PASS	8	19	\N	t	270.00	0.00	530.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1268	FUFI-KOSA-0002	\N	8	19	\N	t	240.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1269	FUFI-KOSA-0003	\N	8	19	\N	t	190.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1270	FUFI-KOSA-0004	STRAIGHT TYPE	8	19	\N	t	52.00	0.00	95.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1271	FUFI-KOSA-0005	L-TYPE	8	19	\N	t	52.00	0.00	95.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1272	FUFI-KOSA-0006	S-TYPE	8	19	\N	t	52.00	0.00	95.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1273	FUFI-KOSA-0007	SMALL STRAIGHT-TYPE	8	19	\N	t	52.00	0.00	95.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1274	FUFI-KOSA-0008	T-TYPE	8	19	\N	t	52.00	0.00	95.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1275	FUFI-KOSA-0009	T-TYPE	8	19	\N	t	52.00	0.00	95.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1276	FUFI-KOSA-0010	RIGHT-TYPE	8	19	\N	t	52.00	0.00	95.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1277	CLBO-MOHA-0002	\N	13	152	\N	t	1350.00	0.00	2300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1278	CLBO-MOHA-0003	\N	13	152	\N	t	1350.00	0.00	2300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1279	CLBO-MOHA-0004	\N	13	152	\N	t	1350.00	0.00	2300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1280	CLBO-MOHA-0005	\N	13	152	\N	t	870.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1281	CLBO-MOHA-0006	\N	13	152	\N	t	1150.00	0.00	2000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1282	BRBO-MOHA-0008	B-13	13	100	\N	t	1650.00	0.00	2850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1283	BRBO-MOHA-0009	\N	13	100	\N	t	1750.00	0.00	3000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1284	BRBO-MOHA-0010	AE100|2E 3 STUDS	13	100	\N	t	1750.00	0.00	3000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1285	BRBO-MOHA-0011	\N	13	100	\N	t	1750.00	0.00	3000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1286	BRBO-MOHA-0012	\N	13	100	\N	t	3000.00	0.00	5500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1287	CLBO-MOHA-0007	\N	13	152	\N	t	2300.00	0.00	4000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1288	BRBO-MOHA-0013	\N	13	100	\N	t	2050.00	0.00	3550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1289	AIFI-KOSA-0003	\N	8	6	\N	t	270.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1290	AIFI-KOSA-0004	\N	8	6	\N	t	230.00	0.00	430.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1291	AIFI-KOSA-0005	\N	8	6	\N	t	390.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1292	AIFI-KOSA-0006	\N	8	6	\N	t	260.00	0.00	570.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1293	AIFI-KOSA-0007	\N	8	6	\N	t	270.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1294	AIFI-KOSA-0008	\N	8	6	\N	t	270.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1295	AIFI-KOSA-0009	\N	8	6	\N	t	270.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1296	AIFI-KOSA-0010	\N	8	6	\N	t	230.00	0.00	430.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1297	AIFI-KOSA-0011	\N	8	6	\N	t	250.00	0.00	570.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1298	AIFI-KOSA-0012	\N	8	6	\N	t	220.00	0.00	430.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1299	AIFI-KOSA-0013	\N	8	6	\N	t	355.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1300	AIFI-KOSA-0014	\N	8	6	\N	t	240.00	0.00	430.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1301	AIFI-KOSA-0015	\N	8	6	\N	t	175.00	0.00	330.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1302	AIFI-KOSA-0016	\N	8	6	\N	t	300.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1303	AIFI-KOSA-0017	\N	8	6	\N	t	300.00	0.00	520.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1304	STAR-BLIT-0001	SHAFT 24V|11T	86	153	\N	t	1750.00	0.00	3000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1305	STAR-BLIT-0002	ND TYPE 12V |9T	86	153	\N	t	1090.00	0.00	1900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1306	STAR-BLIT-0003	24V|13T	86	153	\N	t	890.00	0.00	1600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1307	STAR-BLIT-0004	12V|9T	86	153	\N	t	890.00	0.00	1600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1308	STAR-BLIT-0005	24V|9T	86	153	\N	t	1300.00	0.00	2400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1309	DUCA-MOHA-0001	YORK/YORK	13	154	\N	t	900.00	0.00	1800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1310	DUCA-MOHA-0002	YORK/YORK	13	154	\N	t	930.00	0.00	1800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1311	DUCA-MOHA-0003	YORK/YORK	13	154	\N	t	970.00	0.00	1950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1312	DUCA-MOHA-0004	YORK/BALL	13	154	\N	t	905.00	0.00	1800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1313	DUCA-MOHA-0005	YORK/BALL	13	154	\N	t	930.00	0.00	1800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1314	DUCA-MOHA-0006	YORK/BALL	13	154	\N	t	970.00	0.00	1950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1315	OIFI-KOSA-0001	\N	8	38	\N	t	150.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1316	OIFI-KOSA-0002	\N	8	38	\N	t	120.00	0.00	260.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1317	OIFI-KOSA-0003	PRIMARY	8	38	\N	t	240.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1318	OIFI-KOSA-0004	\N	8	38	\N	t	165.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1319	CLCO-MOHA-0001	9"	13	28	\N	t	1930.00	0.00	3350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1320	CLCO-MOHA-0002	9 1/2"	13	28	\N	t	2230.00	0.00	3800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1321	CLCO-MOHA-0003	9 1/2"	13	28	\N	t	2440.00	0.00	4200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1322	CLCO-MOHA-0004	8"	13	28	\N	t	1620.00	0.00	2800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1323	CLDI-MOHA-0004	7"X18T	13	27	\N	t	720.00	0.00	1300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1324	CLDI-MOHA-0005	13"X14T |38MM	13	27	\N	t	2000.00	0.00	3500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1325	CLDI-MOHA-0006	9"X21T	13	27	\N	t	985.00	0.00	1700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1326	CLCO-MOHA-0005	8 1/2	13	28	\N	t	1620.00	0.00	2800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1327	CLCO-MOHA-0006	12"	13	28	\N	t	4660.00	0.00	8000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1328	CLDI-MOHA-0007	9 1/2"X23T	13	27	\N	t	1220.00	0.00	2100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1329	CLDI-MOHA-0008	9 1/2X 24T	13	27	\N	t	1130.00	0.00	2000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1330	CLDI-MOHA-0009	9"X22T	13	27	\N	t	985.00	0.00	1750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1331	CLDI-MOHA-0010	9 1/2"X24T	13	27	\N	t	1130.00	0.00	2000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1332	CLDI-MOHA-0011	10"X24T	13	27	\N	t	1250.00	0.00	2200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1333	STCO-SAFE-0001	DIESEL	87	155	\N	t	600.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1334	STCO-SAFE-0002	BIG	87	155	\N	t	610.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1335	STCO-SAFE-0003	FEMALE	87	155	\N	t	760.00	0.00	1350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1336	STCO-SAFE-0004	\N	87	155	\N	t	580.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1337	STCO-SAFE-0005	\N	87	155	\N	t	580.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1338	STCO-SAFE-0006	\N	87	155	\N	t	600.00	0.00	1150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1339	SHAB-CPSA-0014	\N	55	41	\N	t	1180.00	0.00	2100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1340	SHAB-CPSA-0015	LONG|RH/LH REAR	55	41	\N	t	700.00	0.00	1250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1341	SHAB-CPSA-0016	REAR	55	41	\N	t	1180.00	0.00	2100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1342	SHAB-CPSA-0017	REAR	55	41	\N	t	1360.00	0.00	2500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1343	SHAB-CPSA-0018	FRONT RH	55	41	\N	t	3900.00	0.00	6700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1344	SHAB-CPSA-0019	FRONT LH	55	41	\N	t	3900.00	0.00	6700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1345	SHAB-CPSA-0020	REAR	55	41	\N	t	1830.00	0.00	3200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1346	SHAB-CPSA-0021	REAR	55	41	\N	t	1620.00	0.00	2900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1347	ALHO-HORS-0003	STEEL MATERIAL |6 1/2"	82	125	\N	t	90.00	0.00	170.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1348	BRHO-HORS-0001	13 1/2" |FRONT M/M	82	156	\N	t	90.00	0.00	170.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1349	BRHO-HORS-0002	25" |REAR M/M	82	156	\N	t	120.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1350	BRHO-HORS-0003	22 1/2" FRONT M/M	82	156	\N	t	112.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1351	BRHO-HORS-0004	16 1/2"|W/CLAMP REAR	82	156	\N	t	160.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1352	BRHO-HORS-0005	9 1/4" |REAR F/F	82	156	\N	t	90.00	0.00	170.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1353	BRHO-HORS-0006	7"	82	156	\N	t	60.00	0.00	120.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1354	CLCO-MOHA-0007	9"	13	28	\N	t	1820.00	0.00	3100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1355	CLCO-MOHA-0008	6 3/4" |170MM	13	28	\N	t	1150.00	0.00	2000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1356	CLCO-MOHA-0009	7"	13	28	\N	t	1250.00	0.00	2200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1357	CLCO-MOHA-0010	9"	13	28	\N	t	1750.00	0.00	3000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1358	WHCY-MOHA-0009	1/8"|REAR LH UPPER	13	34	\N	t	540.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1359	WHCY-MOHA-0010	1 1/8" |REAR LH LOWER	13	34	\N	t	540.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1360	CLCO-MOHA-0011	9"	13	28	\N	t	1750.00	0.00	3000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1361	CLCO-MOHA-0012	12"	13	28	\N	t	4400.00	0.00	7550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1362	WHCY-MOHA-0011	W/TEETH 15/16"FRONT RH UPPER	13	34	\N	t	385.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1363	WHCY-MOHA-0012	W/TEETH 15/16"FRONT LH UPPER	13	34	\N	t	385.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1364	WHCY-MOHA-0013	W/TEETH 15/16"FRONT LH LOWER	13	34	\N	t	385.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1365	WHCY-MOHA-0014	W/TEETH 15/16"FRONT RH LOWER	13	34	\N	t	385.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1366	WHCY-MOHA-0015	FRONT DRUM BRAKE REAR LH	13	34	\N	t	350.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1367	SHAB-CPSA-0022	FRONT	55	41	\N	t	925.00	0.00	1650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1368	SHAB-CPSA-0023	REAR	55	41	\N	t	1030.00	0.00	1850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1369	SHAB-CPSA-0024	FRONT	55	41	\N	t	1150.00	0.00	2100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1370	SHAB-CPSA-0025	RFEAR	55	41	\N	t	1230.00	0.00	2150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1371	SHAB-CPSA-0026	REAR	55	41	\N	t	1230.00	0.00	2150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1372	SHAB-CPSA-0027	REAR	55	41	\N	t	1180.00	0.00	2150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1373	SHAB-CPSA-0028	FRONT	55	41	\N	t	1200.00	0.00	2150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1374	SHAB-CPSA-0029	REAR	55	41	\N	t	860.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1375	SHAB-CPSA-0030	REAR	55	41	\N	t	1090.00	0.00	1950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1376	SHAB-CPSA-0031	REAR	55	41	\N	t	1090.00	0.00	1950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1377	BRHO-HORS-0007	MEDIUM MF	82	156	\N	t	65.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1378	BRHO-HORS-0008	SHORT MF	82	156	\N	t	60.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1379	BRH1-HORS-0001	COLOR BLUE W/PLY	82	157	\N	t	1850.00	0.00	3200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1380	BRH1-HORS-0002	COLOR BLUE W/PLY	82	157	\N	t	3300.00	0.00	5700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1381	BRHO-HORS-0009	11 1/4" REAR F/F	82	156	\N	t	98.00	0.00	180.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1382	BRHO-HORS-0010	9 1/4"REAR F/F	82	156	\N	t	90.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1383	BRHO-HORS-0011	20" FRONT MF	82	156	\N	t	108.00	0.00	195.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1384	BRHO-HORS-0012	19" REAR MF	82	156	\N	t	108.00	0.00	195.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1385	BRHO-HORS-0013	17 1/2" REAR F/O	82	156	\N	t	150.00	0.00	270.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1386	BRHO-HORS-0014	18 1/2" W/CLAMP REAR F/O	82	156	\N	t	180.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1387	BRHO-HORS-0015	13"	82	156	\N	t	90.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1388	BRHO-HORS-0016	22"	82	156	\N	t	140.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1389	ANTE-SGMX-0001	RUBBER DUCKIE	56	158	\N	t	350.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1390	ANTE-SGMX-0002	WHIP TYPE ANTENNA W/BASE 808M 72" MODEL 1188	56	158	\N	t	530.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1391	OIPU-MIKO-0001	NEW MODEL	88	40	\N	t	3270.00	0.00	5600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1392	OIPU-MIKO-0002	OLD MODEL	88	40	\N	t	5560.00	0.00	9500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1393	OIPU-MIKO-0003	\N	88	40	\N	t	2070.00	0.00	3600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1394	OIPU-MIKO-0004	\N	88	40	\N	t	2560.00	0.00	4400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1395	EPCO-MOHA-0001	SPRING TYPE 21/2"X300MM	13	112	\N	t	950.00	0.00	1700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1396	EPCO-MOHA-0002	SPRING TYPE 4"X300MM	13	112	\N	t	1560.00	0.00	2700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1397	EPCO-MOHA-0003	SPRING TYPE 3 1/2"	13	112	\N	t	2120.00	0.00	3700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1398	EPCO-MOHA-0004	SPRING TYPE 3 1/2"	13	112	\N	t	3080.00	0.00	5300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1399	TEGA-NDXX-0001	\N	89	159	\N	t	335.00	0.00	570.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1400	TEGA-NDXX-0002	\N	89	159	\N	t	400.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1401	TEGA-NDXX-0003	\N	89	159	\N	t	265.00	0.00	480.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1402	BEDR-KEMX-0005	BIG	83	141	\N	t	310.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1403	BEDR-KEMX-0006	\N	83	141	\N	t	310.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1404	BEDR-KEMX-0007	REDUCTION	83	141	\N	t	600.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1405	BEDR-KEMX-0008	\N	83	141	\N	t	740.00	0.00	1450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1406	TALI-SGMX-0002	RH|LH |12V	56	79	\N	t	150.00	0.00	265.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1407	TALI-SGMX-0003	UNIVERSAL	56	79	\N	t	240.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1408	TALI-SGMX-0004	KENEGADE W/ LIGHT	56	79	\N	t	130.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1409	MIRR-SGMX-0037	10 1/2"	56	81	\N	t	360.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1410	MIRR-SGMX-0038	REARVIEW MIRROR METAL HANDLE 6 1/2"X12	56	81	\N	t	255.00	0.00	470.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1411	TALI-SGMX-0005	LED TYPE|3 SLOTS LENS|RED|AMBER|RED 24V	56	79	\N	t	93.00	0.00	170.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1412	TALI-SGMX-0006	LED TYPE 3 SLOTS 24V SIGNAL LENS|AMBER	56	79	\N	t	1750.00	0.00	3000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1413	TALI-SGMX-0007	LED TYPE	56	79	\N	t	535.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1414	TGLO-NOBR-0001	SCRUM	4	160	\N	t	125.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1415	TGLO-NOBR-0002	SCRUM	4	160	\N	t	125.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1416	MIRR-SGMX-0039	BOLT TYPE	56	81	\N	t	125.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1418	MIRR-SGMX-0041	BOLT OLD MODEL	56	81	\N	t	125.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1419	CLBO-HANS-0001	\N	90	152	\N	t	1100.00	0.00	1870.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1420	OPSW-HANS-0001	\N	90	161	\N	t	105.00	0.00	185.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1421	GLPL-HANS-0001	\N	90	37	\N	t	150.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1422	TWHO-HANS-0001	100MM DUAL TONE  24V	90	162	\N	t	540.00	0.00	830.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1423	BHAS-HANS-0001	DOUBLE	90	163	\N	t	2600.00	0.00	3800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1424	BHAS-HANS-0002	TWIN	90	163	\N	t	2625.00	0.00	3800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1425	BHAS-HANS-0003	ABSI 3/1.5 TWIN	90	163	\N	t	2625.00	0.00	3800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1426	CLBO-HANS-0002	\N	90	152	\N	t	1270.00	0.00	2225.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1427	CLBO-HANS-0003	(OM)3"	90	152	\N	t	1045.00	0.00	1830.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1428	AERO-HANS-0001	(SEAMLESS TYPE)WIPER BLADE	90	164	\N	t	180.00	0.00	315.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1429	AERO-HANS-0002	(SEAMLESS TYPE)WIPER BLADE	90	164	\N	t	180.00	0.00	315.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1430	STA1-HANS-0001	24V|9T	90	165	\N	t	4750.00	0.00	8315.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1431	RAMO-HANS-0001	\N	90	166	\N	t	1100.00	0.00	1925.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1432	AUBU-HANS-0001	AMBER 12V|21W	90	167	\N	t	14.00	0.00	25.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1433	AUBU-HANS-0002	AMBER 12V|21W	90	167	\N	t	14.00	0.00	25.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1434	FULI-HANS-0001	\N	90	168	\N	t	36.00	0.00	65.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1435	FULI-HANS-0002	\N	90	168	\N	t	36.00	0.00	65.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1436	FULI-HANS-0003	\N	90	168	\N	t	36.00	0.00	65.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1437	FOVA-GETH-0001	\N	91	169	\N	t	1900.00	0.00	3400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1438	FOVA-GETH-0002	\N	91	169	\N	t	1900.00	0.00	3400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1439	FOVA-GETH-0003	\N	91	169	\N	t	680.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1440	ACCA-TAIS-0001	\N	92	18	\N	t	268.00	0.00	390.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1441	ACCA-TAIS-0002	\N	92	18	\N	t	315.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1442	ACCA-TAIS-0003	\N	92	18	\N	t	348.00	0.00	540.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1443	ACCA-TAIS-0004	\N	92	18	\N	t	345.00	0.00	590.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1444	ACCA-TAIS-0005	\N	92	18	\N	t	430.00	0.00	740.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1445	ACCA-TAIS-0006	\N	92	18	\N	t	320.00	0.00	465.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1446	AUWI-NUPR-0001	\N	40	170	\N	t	505.00	0.00	900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1447	AUWI-NUPR-0002	\N	40	170	\N	t	315.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1448	AUWI-NUPR-0003	\N	40	170	\N	t	255.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1449	VASE-NOBR-0001	\N	4	33	\N	t	0.00	0.00	280.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1450	VASE-NOBR-0002	\N	4	33	\N	t	0.00	0.00	280.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1451	VASE-NOBR-0003	\N	4	33	\N	t	15.00	0.00	350.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1452	FUFI-NOBR-0002	\N	4	19	\N	t	285.00	0.00	380.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1453	WIBL-BOSC-0001	BOSCH ADVANTAGE	93	171	\N	t	235.00	0.00	380.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1454	WIBL-BOSC-0002	BOSCH ADVANTAGE	93	171	\N	t	220.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1455	SPPL-BOSC-0001	PLATINUM	93	172	\N	t	260.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1456	SPPL-BOSC-0002	PLATINUM	93	172	\N	t	240.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1457	ALTE-NIHO-0001	\N	69	84	\N	t	119.00	0.00	210.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1458	ALTE-NIHO-0002	\N	69	84	\N	t	119.00	0.00	210.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1459	HACA-ORIO-0001	\N	24	139	\N	t	240.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1460	WHCY-SGPX-0001	W/O BLEEDER	5	34	\N	t	320.00	0.00	570.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1461	WHCY-SGPX-0002	W/BLEEDER	5	34	\N	t	320.00	0.00	570.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1462	UJOI-GMGX-0001	\N	48	20	\N	t	205.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1463	UJOI-GMGX-0002	\N	48	20	\N	t	300.00	0.00	580.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1464	UJOI-GMGX-0003	\N	48	20	\N	t	180.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1465	UJOI-KOYO-0016	\N	11	20	\N	t	230.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1466	FUFI-VICX-0001	\N	94	19	\N	t	480.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1467	OIFI-VICX-0001	\N	94	38	\N	t	165.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1468	FUFI-VICX-0002	\N	94	19	\N	t	540.00	0.00	780.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1469	FUFI-VICX-0003	\N	94	19	\N	t	369.00	0.00	950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1470	SPPL-BOSC-0003	SUPPRESSED	93	172	\N	t	535.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1471	FUFI-BOSC-0001	\N	93	19	\N	t	480.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1473	CAFI-VICX-0001	\N	94	173	\N	t	325.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1477	BCKI-TOKI-0001	61.0MM	32	174	\N	t	200.00	0.00	380.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1478	BCKI-TOKI-0002	60.0MM	32	174	\N	t	200.00	0.00	380.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1479	BCKI-TOKI-0003	63.0MM	32	174	\N	t	225.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1480	BCKI-TOKI-0004	62.0MM	32	174	\N	t	200.00	0.00	380.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1481	BCKI-TOKI-0005	46.5MM	32	174	\N	t	280.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1482	BCKI-TOKI-0006	60.0MM	32	174	\N	t	280.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1483	BCKI-TOKI-0007	43.0MM	32	174	\N	t	225.00	0.00	400.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1484	BCKI-TOKI-0008	51.0MM	32	174	\N	t	200.00	0.00	350.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1485	BCKI-TOKI-0009	61.8MM	32	174	\N	t	315.00	0.00	560.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1486	CEPO-MITO-0001	\N	95	175	\N	t	1225.00	0.00	2200.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1487	CEPO-MITO-0002	IDLER ARM	95	175	\N	t	1225.00	0.00	2200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1488	CMKI-TOKI-0001	7/8"	32	31	\N	t	180.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1489	CMKI-TOKI-0002	13/16"	32	31	\N	t	200.00	0.00	380.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1491	WHCY-NESI-0001	7/8"|RR-LH	96	34	\N	t	335.00	0.00	590.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1492	WHCY-NESI-0002	7/8"|RR-RH	96	34	\N	t	335.00	0.00	590.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1493	CLOP-NESI-0001	\N	96	43	\N	t	500.00	0.00	900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1494	WHCY-NESI-0003	7/8"|RR-RH	96	34	\N	t	370.00	0.00	670.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1495	WHCY-NESI-0004	7/8"|RR-LH	96	34	\N	t	370.00	0.00	670.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1496	BMKI-NESI-0001	1-1/8"	96	98	\N	t	1445.00	0.00	2650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1497	CMKI-NESI-0001	3/4"	96	31	\N	t	835.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1498	CMKI-NESI-0002	3/4"	96	31	\N	t	725.00	0.00	1300.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1499	BRPA-NUPR-0006	\N	40	11	\N	t	1050.00	0.00	1900.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1500	BRPA-NUPR-0007	\N	40	11	\N	t	1300.00	0.00	2000.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1501	BRPA-NUPR-0008	\N	40	11	\N	t	550.00	0.00	900.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1502	BRPA-NUPR-0009	\N	40	11	\N	t	650.00	0.00	1100.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1503	BRPA-NUPR-0010	178.2MMX49.5MM FRT-RR	40	11	\N	t	1350.00	0.00	2150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1504	OIFI-UNAS-0004	\N	7	38	\N	t	144.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1505	OIFI-UNAS-0005	\N	7	38	\N	t	247.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1506	OIFI-UNAS-0006	\N	7	38	\N	t	414.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1507	FUFI-UNAS-0003	\N	7	19	\N	t	170.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1508	BRPA-BEND-0001	FRT	97	11	\N	t	1060.00	0.00	1855.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1509	BRPA-BEND-0002	FRT	97	11	\N	t	1390.00	0.00	2500.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1510	BRPA-BEND-0003	RR	97	11	\N	t	1660.00	0.00	2900.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1511	BRPA-BEND-0004	RR	97	11	\N	t	1245.00	0.00	2100.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1512	BRPA-BEND-0005	FRT	97	11	\N	t	1535.00	0.00	2200.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1513	BRPA-BEND-0006	FRT	97	11	\N	t	1390.00	0.00	2450.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1514	RODI-POWE-0001	FRT	98	176	\N	t	2060.00	0.00	3600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1515	RODI-POWE-0002	FRT |273MM (6H)	98	176	\N	t	1260.00	0.00	2200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1516	RODI-POWE-0003	FRT(6+2H) COMP TYPE	98	176	\N	t	2345.00	0.00	4100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1517	RODI-POWE-0004	FRONT |255MM	98	176	\N	t	1475.00	0.00	2580.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1518	RODI-POWE-0005	FRT(6H)	98	176	\N	t	1290.00	0.00	2300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1519	RODI-POWE-0006	FRT	98	176	\N	t	1835.00	0.00	3200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1520	BRSH-POWE-0001	FRT 4W|60MM	98	55	\N	t	1245.00	0.00	2200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1521	BRSH-POWE-0002	RR	98	55	\N	t	500.00	0.00	880.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1522	BRSH-POWE-0003	RR	98	55	\N	t	1090.00	0.00	1900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1523	BRSH-BEND-0001	\N	97	55	\N	t	2245.00	0.00	3950.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1524	CAPI-TOKI-0001	43.0MM	32	177	\N	t	390.00	0.00	690.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1525	CAPI-TOKI-0002	60.4MM	32	177	\N	t	445.00	0.00	790.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1526	CAPI-TOKI-0003	60.0MM	32	177	\N	t	445.00	0.00	790.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1527	CAPI-TOKI-0004	51.0MM	32	177	\N	t	445.00	0.00	790.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1528	CAPI-TOKI-0005	61.0MM	32	177	\N	t	390.00	0.00	690.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1529	CAPI-TOKI-0006	54.0MM	32	177	\N	t	445.00	0.00	790.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1530	CAPI-TOKI-0007	60.0MM	32	177	\N	t	445.00	0.00	790.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1531	CAPI-TOKI-0008	60.0MM	32	177	\N	t	390.00	0.00	690.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1532	CAPI-TOKI-0009	67.9MM	32	177	\N	t	445.00	0.00	790.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1533	CAPI-TOKI-0010	41.0MM	32	177	\N	t	390.00	0.00	690.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1534	BCKI-TOKI-0010	51.0MM	32	174	\N	t	200.00	0.00	380.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1490	CMKI-TOKI-0003-merged-560	5/8"	32	31	\N	f	115.00	0.00	250.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	2025-09-12 14:21:57.903416+00	\N	560
1472	OIFI-VICX-0002-merged-1467	\N	94	38	\N	f	165.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	2025-09-12 23:38:44.347898+00	\N	1467
1474	FUFI-VICX-0004-merged-1468	\N	94	19	\N	f	540.00	0.00	780.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	2025-09-12 23:38:44.517573+00	\N	1468
1535	BCKI-TOKI-0011	60.0MM	32	174	\N	t	200.00	0.00	380.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1536	BCKI-TOKI-0012	54.0MM	32	174	\N	t	115.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1537	BCKI-TOKI-0013	67.9MM	32	174	\N	t	200.00	0.00	380.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1538	BCKI-TOKI-0014	60.0MM	32	174	\N	t	280.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1539	BCKI-TOKI-0015	43.0MM	32	174	\N	t	280.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1540	AIFI-FLEE-0060	\N	6	6	\N	t	245.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1541	AIFI-FLEE-0061	\N	6	6	\N	t	290.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1542	AIFI-FLEE-0062	\N	6	6	\N	t	480.00	0.00	980.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1543	AIFI-FLEE-0063	\N	6	6	\N	t	1560.00	0.00	2800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1544	COBE-BAND-0001	12X1125 | 13X1065	46	178	\N	t	298.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1545	COBE-BAND-0002	12X1150 | 13X1090	46	178	\N	t	305.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1546	COBE-BAND-0003	12X1575 | 13X1525	46	178	\N	t	422.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1547	COBE-BAND-0004	12X1625 | 13X1580	46	178	\N	t	436.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1548	COBE-BAND-0005	12X1700 | 13X1655	46	178	\N	t	489.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1549	COBE-BAND-0006	12X1675 | 13X1630	46	178	\N	t	482.00	0.00	680.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1550	COBE-BAND-0007	12X1275 | 13X1220	46	178	\N	t	373.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1551	COBE-BAND-0008	12X1300 | 13X1250	46	178	\N	t	381.00	0.00	580.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1552	COBE-BAND-0009	12X1050 | 13X990	46	178	\N	t	277.00	0.00	380.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1553	COBE-BAND-0010	17X1060	46	178	\N	t	497.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1554	COBE-BAND-0011	17X1650	46	178	\N	t	742.00	0.00	1050.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1555	COBE-BAND-0012	17X1625	46	178	\N	t	751.00	0.00	1050.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1556	COBE-BAND-0013	17X1575	46	178	\N	t	728.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1557	COBE-BAND-0014	17X1600	46	178	\N	t	672.00	0.00	950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1558	COBE-BAND-0015	17X1370	46	178	\N	t	635.00	0.00	880.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1559	COBE-BAND-0016	17X1400	46	178	\N	t	647.00	0.00	880.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1560	COBE-BAND-0017	17X1420	46	178	\N	t	599.00	0.00	1050.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1561	OISE-KORE-0001	55*78*12; HUB	16	1	\N	t	150.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1562	MABE-DAID-0004	STD	21	48	\N	t	560.00	0.00	780.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1563	CRBE-DAID-0003	STD	21	46	\N	t	400.00	0.00	560.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1564	CRBE-DAID-0004	STD	21	46	\N	t	350.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1565	CRBE-DAID-0005	0.25	21	46	\N	t	370.00	0.00	510.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1566	CRBE-DAID-0006	STD	21	46	\N	t	350.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1567	CRBE-DAID-0007	0.25	21	46	\N	t	310.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1568	TALA-NUPR-0001	LH ORDINARY	40	179	\N	t	240.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1569	TALA-NUPR-0002	RH ORDINARY	40	179	\N	t	190.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1570	BRSH-NUPR-0002	\N	40	55	\N	t	500.00	0.00	780.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1572	VASE-NOKX-0003	BLISTER PACK	2	33	\N	t	15.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1573	VCGA-FEMO-0001	3 CYL.	45	85	\N	t	260.00	0.00	420.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1574	VCGA-FEMO-0002	4 CYL.	45	85	\N	t	200.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1575	TIBE-EXCE-0001	\N	99	14	\N	t	620.00	0.00	980.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1576	ENVA-DOKU-0001	\N	100	181	\N	t	235.00	0.00	3100.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1577	ENVA-DOKU-0002	\N	100	181	\N	t	235.00	0.00	3100.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1578	HYOI-NATI-0001	PAIL 18L	101	182	\N	t	2750.00	0.00	3100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1579	STA1-SGPX-0001	\N	5	165	\N	t	2250.00	0.00	3900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1580	CVJO-SGPX-0001	INNER	5	183	\N	t	1050.00	0.00	1800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1581	CVJO-SGPX-0002	INNER	5	183	\N	t	1050.00	0.00	1800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1582	CVJO-SGPX-0003	INNER	5	183	\N	t	1050.00	0.00	1800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1583	CAKI-RSPE-0001	\N	102	184	\N	t	220.00	0.00	400.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1584	CAPI-RSPE-0001	\N	102	177	\N	t	330.00	0.00	590.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1585	UJOI-SEAL-0003	\N	30	20	\N	t	121.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1586	UJOI-SEAL-0004	\N	30	20	\N	t	130.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1587	UJOI-SEAL-0005	\N	30	20	\N	t	145.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1588	UJOI-SEAL-0006	\N	30	20	\N	t	165.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1589	VASE-ORIO-0001	\N	24	33	\N	t	165.00	0.00	350.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1590	BEAR-NSKX-0005	\N	31	9	\N	t	560.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1591	BUHO-ZAPP-0003	12V	18	26	\N	t	160.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1592	BUHO-ZAPP-0004	24V	18	26	\N	t	180.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1593	PIAS-FEDE-0001	\N	103	185	\N	t	1330.00	0.00	2350.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1594	PIAS-FEDE-0002	\N	103	185	\N	t	1330.00	0.00	2350.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1595	BRPA-BEND-0007	\N	97	11	\N	t	1030.00	0.00	1800.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1596	BRPA-BEND-0008	\N	97	11	\N	t	1180.00	0.00	2100.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1597	BRPA-BEND-0009	\N	97	11	\N	t	1520.00	0.00	2600.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1598	BRPA-BEND-0010	\N	97	11	\N	t	1050.00	0.00	1800.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1599	BRPA-BEND-0011	\N	97	11	\N	t	1250.00	0.00	2200.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1600	BRPA-BEND-0012	\N	97	11	\N	t	1490.00	0.00	2580.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1601	BRPA-BEND-0013	\N	97	11	\N	t	980.00	0.00	1750.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1602	BRPA-BEND-0014	\N	97	11	\N	t	1110.00	0.00	1900.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1603	BRPA-BEND-0015	\N	97	11	\N	t	1260.00	0.00	2200.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1604	BRPA-BEND-0016	\N	97	11	\N	t	1260.00	0.00	2200.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1605	BRPA-BEND-0017	\N	97	11	\N	t	1090.00	0.00	2000.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1606	BRPA-BEND-0018	\N	97	11	\N	t	930.00	0.00	1700.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1607	BRPA-BEND-0019	\N	97	11	\N	t	1250.00	0.00	2200.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1608	BRPA-BEND-0020	\N	97	11	\N	t	1660.00	0.00	2900.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1609	BRSH-BEND-0002	\N	97	55	\N	t	1250.00	0.00	2200.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1610	BRSH-BEND-0003	\N	97	55	\N	t	1610.00	0.00	2800.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1611	BRSH-BEND-0004	\N	97	55	\N	t	1890.00	0.00	3300.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1612	BDRO-BEND-0001	\N	97	186	\N	t	1720.00	0.00	3000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1613	BDRO-BEND-0002	\N	97	186	\N	t	1520.00	0.00	2900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1614	BDRO-BEND-0003	\N	97	186	\N	t	2050.00	0.00	3500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1615	BDRO-BEND-0004	\N	97	186	\N	t	1410.00	0.00	2400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1616	BDRO-BEND-0005	\N	97	186	\N	t	2290.00	0.00	3900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1617	BDRO-BEND-0006	\N	97	186	\N	t	1690.00	0.00	2900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1618	BDRO-BEND-0007	\N	97	186	\N	t	2160.00	0.00	3700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1619	BDRO-BEND-0008	\N	97	186	\N	t	2560.00	0.00	4400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1620	BDRO-BEND-0009	\N	97	186	\N	t	2800.00	0.00	4800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1621	BDRO-BEND-0010	\N	97	186	\N	t	1410.00	0.00	2450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1622	BDRO-BEND-0011	\N	97	186	\N	t	2190.00	0.00	3800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1623	AICL-ASAH-0003	\N	29	110	\N	t	1050.00	0.00	1900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1624	CRBE-DAID-0008	\N	21	46	\N	t	290.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1625	CRBE-DAID-0009	\N	21	46	\N	t	320.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1626	CRBE-DAID-0010	\N	21	46	\N	t	350.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1627	CRBE-TAIH-0001	\N	104	46	\N	t	280.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1628	CRBE-TAIH-0002	\N	104	46	\N	t	310.00	0.00	580.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1629	CRBE-TAIH-0003	\N	104	46	\N	t	320.00	0.00	580.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1630	CRBE-DAID-0011	\N	21	46	\N	t	350.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1631	CRBE-TAIH-0004	\N	104	46	\N	t	480.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1632	CRBE-TAIH-0005	\N	104	46	\N	t	500.00	0.00	880.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1633	FABE-KORE-0002	\N	16	15	\N	t	400.00	0.00	680.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1634	FABE-KORE-0003	\N	16	15	\N	t	240.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1635	FABE-KORE-0004	\N	16	15	\N	t	300.00	0.00	520.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1636	PIPI-KORE-0001	\N	16	32	\N	t	1000.00	0.00	450.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1637	FABE-KORE-0005	\N	16	15	\N	t	400.00	0.00	680.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1638	FABE-KORE-0006	\N	16	15	\N	t	240.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1639	FABE-KORE-0007	\N	16	15	\N	t	300.00	0.00	520.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1640	PIPI-KORE-0002	\N	16	32	\N	t	1000.00	0.00	450.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1641	TIBE-NBKX-0001	\N	20	14	\N	t	2100.00	0.00	3600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1642	BRPA-NBKX-0005	\N	20	11	\N	t	1950.00	0.00	3450.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1644	DRBE-NBKX-0001	\N	20	187	\N	t	1250.00	0.00	2250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1645	WHBE-NBKX-0001	\N	20	97	\N	t	1980.00	0.00	3400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1646	CLCA-NBKX-0001	\N	20	188	\N	t	850.00	0.00	1680.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1647	IGCO-NBKX-0001	\N	20	189	\N	t	1350.00	0.00	2450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1648	WHCY-MIKA-0012	11/16" W/B R.RH	23	34	\N	t	370.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1649	BEAR-KOYO-0018	\N	11	9	\N	t	58.00	0.00	125.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1650	BEAR-NSKX-0006	\N	31	9	\N	t	460.00	0.00	780.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1651	BEAR-NSKX-0007	\N	31	9	\N	t	489.00	0.00	800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1652	BEAR-KOYO-0019	\N	11	9	\N	t	90.00	0.00	180.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1653	BEAR-NSKX-0008	\N	31	9	\N	t	225.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1654	BEAR-KOYO-0020	\N	11	9	\N	t	225.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1655	BEAR-NSKX-0009	\N	31	9	\N	t	580.00	0.00	900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1656	BEAR-NSKX-0010	\N	31	9	\N	t	1275.00	0.00	2850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1657	BEAR-NTNX-0012	\N	33	9	\N	t	781.00	0.00	1250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1658	BEAR-NTNX-0013	\N	33	9	\N	t	686.00	0.00	1180.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1659	SHAB-TOKI-0005	\N	32	41	\N	t	2970.00	0.00	4400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1660	SHAB-TOKI-0006	\N	32	41	\N	t	1650.00	0.00	2600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1661	SHAB-TOKI-0007	\N	32	41	\N	t	990.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1662	SHAB-TOKI-0008	\N	32	41	\N	t	990.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1663	TIBE-OEMX-0001	\N	105	14	\N	t	650.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1664	TIBE-OEMX-0002	154RU25.4	105	14	\N	t	270.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1665	TIBE-OEMX-0003	83ZBS19	105	14	\N	t	320.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1666	TIBE-OEMX-0004	99YU19	105	14	\N	t	690.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1667	HEGA-GMXX-0001	#15	106	64	\N	t	1800.00	0.00	3200.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1668	HEGA-GMXX-0002	#17	106	64	\N	t	1980.00	0.00	3450.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1669	HEGA-GMXX-0003	#58	106	64	\N	t	1890.00	0.00	3350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1670	FUFI-NKSL-0001	009-0	107	19	\N	t	160.00	0.00	290.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1671	FUFI-NKSL-0002	\N	107	19	\N	t	160.00	0.00	290.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1672	FUFI-NKSL-0003	\N	107	19	\N	t	465.00	0.00	800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1673	FUFI-NKXX-0001	\N	108	19	\N	t	255.00	0.00	460.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1674	AUWI-NKXX-0001	\N	108	170	\N	t	638.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1675	PIAS-ARTX-0001	STD	109	185	\N	t	740.00	0.00	1350.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1676	PIAS-ARTX-0002	\N	109	185	\N	t	2990.00	0.00	5300.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1677	PIAS-ARTX-0003	STD	109	185	\N	t	3680.00	0.00	6500.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1678	CELI-NKRX-0001	\N	110	190	\N	t	3500.00	0.00	6350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1679	CELI-NKXX-0001	\N	108	190	\N	t	1800.00	0.00	3400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1680	CEPO-NKXX-0001	STEERING DAMPER RH	108	175	\N	t	5450.00	0.00	9400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1681	CEPO-NKXX-0002	STEERING DAMPER LH	108	175	\N	t	4350.00	0.00	7600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1682	TREN-NKXX-0001	THIS MODEL RH SIDE ONLY	108	4	\N	t	1190.00	0.00	2400.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1683	TREN-NKXX-0002	W/RH&LH SIDE	108	4	\N	t	1190.00	0.00	2400.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1684	CRB1-NKXX-0001	W/SLEEVE|13 ONWARDS	108	92	\N	t	5200.00	0.00	8950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1685	CRB1-NKXX-0002	W/SLEEVE	108	92	\N	t	5200.00	0.00	8950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1686	BATT-OURS-0004	\N	71	127	\N	t	3500.00	0.00	6200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1687	AXST-NOBR-0001	12*65	4	191	\N	t	26.00	0.00	50.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1688	AXST-NOBR-0002	14*60	4	191	\N	t	26.00	0.00	50.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1689	AXST-NOBR-0003	10*52	4	191	\N	t	16.00	0.00	30.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1690	AXST-NOBR-0004	72*38	4	191	\N	t	18.00	0.00	30.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1691	AXST-NOBR-0005	1*45	4	191	\N	t	25.00	0.00	50.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1692	EPRI-NOBR-0001	\N	4	192	\N	t	140.00	0.00	360.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1693	EPRI-NOBR-0002	\N	4	192	\N	t	140.00	0.00	360.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1694	EPRI-NOBR-0003	\N	4	192	\N	t	140.00	0.00	360.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1695	EPRI-NOBR-0004	\N	4	192	\N	t	850.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1696	EPRI-NOBR-0005	\N	4	192	\N	t	950.00	0.00	1700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1697	FUCO-NOBR-0001	\N	4	193	\N	t	60.00	0.00	120.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1698	TOBA-GMXX-0001	\N	106	194	\N	t	2800.00	0.00	5000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1699	SECA-NOBR-0001	43"	4	17	\N	t	340.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1700	CEBO-NOBR-0001	\N	4	195	\N	t	25.00	0.00	55.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1701	UBOL-NOBR-0001	W/NUT	4	196	\N	t	53.00	0.00	110.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1702	VUFL-KWIK-0001	KWIKSOL	72	197	\N	t	311.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1703	TISE-SKYX-0001	\N	111	198	\N	t	53.00	0.00	95.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1704	VUPA-KWIK-0001	\N	72	199	\N	t	30.00	0.00	55.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1705	LUNU-SPAR-0001	CHROME SHORT	112	200	\N	t	768.00	0.00	1350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1706	LUNU-NOBR-0001	CHROME LONG W/ BUILT IN WASHER	4	200	\N	t	116.00	0.00	205.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1707	LUNU-NOBR-0002	CHROME	4	200	\N	t	464.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1708	LUNU-NOBR-0003	CHROME	4	200	\N	t	464.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1709	LUNU-NOBR-0004	CHROME	4	200	\N	t	609.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1710	LUNU-NOBR-0005	CHROME SHORT W/ BUILT IN WASHER	4	200	\N	t	87.00	0.00	155.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1711	COBE-BAND-0018	\N	46	178	\N	t	222.00	0.00	355.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1712	COBE-BAND-0019	\N	46	178	\N	t	246.00	0.00	380.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1713	COBE-BAND-0020	\N	46	178	\N	t	249.00	0.00	370.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1714	COBE-BAND-0021	\N	46	178	\N	t	284.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1715	COBE-BAND-0022	\N	46	178	\N	t	291.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1716	COBE-BAND-0023	\N	46	178	\N	t	331.00	0.00	480.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1717	COBE-BAND-0024	\N	46	178	\N	t	422.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1718	COBE-BAND-0025	\N	46	178	\N	t	177.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1719	COBE-BAND-0026	\N	46	178	\N	t	194.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1720	COBE-BAND-0027	\N	46	178	\N	t	251.00	0.00	380.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1721	COBE-BAND-0028	\N	46	178	\N	t	232.00	0.00	420.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1722	COBE-BAND-0029	\N	46	178	\N	t	278.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1723	COBE-BAND-0030	\N	46	178	\N	t	357.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1724	COBE-BAND-0031	\N	46	178	\N	t	359.00	0.00	580.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1725	COBE-BAND-0032	\N	46	178	\N	t	269.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1726	OIFI-UNAS-0007	THROW-AWAY TYPE	7	38	\N	t	650.00	0.00	800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1727	PIRI-TPXX-0001	\N	113	201	\N	t	2675.00	0.00	4500.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1728	PIRI-TPXX-0002	\N	113	201	\N	t	2675.00	0.00	4800.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1729	BEAR-KOYO-0021	\N	11	9	\N	t	159.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1730	BEAR-NSKX-0011	\N	31	9	\N	t	1395.00	0.00	2500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1731	BEAR-NSKX-0012	\N	31	9	\N	t	797.00	0.00	1400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1732	BEAR-NSKX-0013	\N	31	9	\N	t	854.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1733	BEAR-KOYO-0022	\N	11	9	\N	t	1011.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1734	BEAR-KOYO-0023	\N	11	9	\N	t	815.00	0.00	1450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1735	BEAR-NTNX-0014	\N	33	9	\N	t	507.00	0.00	900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1736	BEAR-NTNX-0015	\N	33	9	\N	t	510.00	0.00	900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1737	BEAR-KOYO-0024	\N	11	9	\N	t	624.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1738	BEAR-NTNX-0016	\N	33	9	\N	t	269.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1739	BEAR-KOYO-0025	\N	11	9	\N	t	355.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1740	BEAR-NTNX-0017	\N	33	9	\N	t	168.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1741	BEAR-NSKX-0014	\N	31	9	\N	t	436.00	0.00	860.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1742	BEAR-KSMX-0001	\N	114	9	\N	t	127.00	0.00	225.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1743	BEAR-KOYO-0026	\N	11	9	\N	t	83.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1744	BEAR-NSKX-0015	\N	31	9	\N	t	768.00	0.00	1400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1745	BEAR-NTNX-0018	\N	33	9	\N	t	616.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1746	BEAR-KOYO-0027	\N	11	9	\N	t	1255.00	0.00	2200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1747	BEAR-NSKX-0016	\N	31	9	\N	t	3198.00	0.00	5600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1748	BEAR-KOYO-0028	\N	11	9	\N	t	2347.00	0.00	4150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1749	BEAR-NSKX-0017	\N	31	9	\N	t	1390.00	0.00	3350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1750	BEAR-NSKX-0018	\N	31	9	\N	t	815.00	0.00	1450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1751	BEAR-KOYO-0029	\N	11	9	\N	t	189.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1752	SILA-SPIN-0007	24V LED CLEAR|SHORT W/DROP LIGHT	49	67	\N	t	100.00	0.00	190.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1753	HEGA-FEMO-0002	CARBON	45	64	\N	t	1235.00	0.00	2200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1754	AIFI-UNAS-0021	FIGHTER ELEMENT	7	6	\N	t	1872.00	0.00	2300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1755	AIFI-UNAS-0022	POLYURETHANE	7	6	\N	t	3000.00	0.00	3400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1756	CYHE-JAPA-0001	MARK POWER |(I-MP)	115	101	\N	t	11000.00	0.00	19500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1757	CYHE-JAPA-0002	MARK POWER |(I-MP)	115	101	\N	t	11000.00	0.00	19500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1758	OIFI-MITS-0001	\N	116	38	\N	t	185.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1759	PRPU-DENS-0001	\N	12	202	\N	t	285.00	0.00	560.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1760	OIFI-HYUN-0001	\N	117	38	\N	t	145.00	0.00	255.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1761	BMKI-ORIO-0001	7/8 W/ TUBE	24	98	\N	t	850.00	0.00	1550.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1762	BMKI-ORIO-0002	13/16|140MM W/TUBE	24	98	\N	t	950.00	0.00	1750.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1763	THER-OEMX-0001	\N	105	203	\N	t	395.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1764	HORN-BOSC-0001	DISC COMPACT	93	204	\N	t	385.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1765	SABU-ORIO-0001	RH, NO LUMP	24	65	\N	t	245.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1766	SABU-ORIO-0002	RH, NO LUMP	24	65	\N	t	245.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1767	SABU-ORIO-0003	FRONT LOWER ARM RH	24	65	\N	t	895.00	0.00	1950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1768	SABU-ORIO-0004	FRONT LOWER ARM LH	24	65	\N	t	895.00	0.00	1950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1769	MABE-DAID-0005	\N	21	48	\N	t	885.00	0.00	1650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1770	MABE-DAID-0006	\N	21	48	\N	t	1850.00	0.00	3250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1771	SAPA-3MXX-0002	\N	61	108	\N	t	16.00	0.00	30.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1772	SAPA-3MXX-0003	\N	61	108	\N	t	16.00	0.00	30.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1773	ACCA-TAIS-0007	\N	92	18	\N	t	220.00	0.00	380.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1774	ACCA-TAIS-0008	\N	92	18	\N	t	250.00	0.00	440.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1775	ACCA-GTRX-0001	\N	118	18	\N	t	235.00	0.00	410.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1776	FUFI-OSAK-0001	\N	78	19	\N	t	360.00	0.00	380.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1777	SPPI-MSXX-0001	\N	119	205	\N	t	260.00	0.00	370.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1778	RACO-DERF-0001	1L	65	206	\N	t	120.00	0.00	190.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1779	RACO-DERF-0002	1L	65	206	\N	t	120.00	0.00	190.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1780	RUMO-NOBR-0001	\N	4	207	\N	t	600.00	0.00	0.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1781	CMKI-ANDX-0001	\N	120	31	\N	t	1300.00	0.00	0.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1782	CMKI-ANDX-0002	\N	120	31	\N	t	1300.00	0.00	0.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1783	EBVA-OEMX-0001	FP415	105	208	\N	t	1200.00	0.00	0.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1784	DRCO-MFTX-0001	A/T	121	209	\N	t	250.00	0.00	0.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1785	DRCO-MFTX-0002	\N	121	209	\N	t	250.00	0.00	0.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1786	DRCO-MFTX-0003	\N	121	209	\N	t	250.00	0.00	0.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1787	FUFI-ASUK-0001	\N	122	19	\N	t	420.00	0.00	0.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1788	FUFI-ASUK-0002	\N	122	19	\N	t	310.00	0.00	0.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1789	OIFI-ASUK-0001	\N	122	38	\N	t	370.00	0.00	0.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1791	EBVA-HKTX-0001	\N	124	208	\N	t	2280.00	0.00	0.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1792	EBVA-HKTX-0002	\N	124	208	\N	t	2500.00	0.00	0.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1793	EBVA-HKTX-0003	\N	124	208	\N	t	2500.00	0.00	0.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1794	EBVA-HKTX-0004	\N	124	208	\N	t	2250.00	0.00	0.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1795	PINU-OEMX-0001	\N	105	210	\N	t	290.00	0.00	0.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1796	PINU-OEMX-0002	\N	105	210	\N	t	220.00	0.00	0.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1797	PINU-OEMX-0003	\N	105	210	\N	t	240.00	0.00	0.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1798	PINU-OEMX-0004	\N	105	210	\N	t	240.00	0.00	0.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1799	PINU-OEMX-0005	\N	105	210	\N	t	160.00	0.00	0.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1800	WIMO-NOBR-0001	\N	4	103	\N	t	1620.00	0.00	0.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1801	CHVA-OEMX-0001	\N	105	211	\N	t	450.00	0.00	0.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1802	WIMO-NOBR-0002	\N	4	103	\N	t	1620.00	0.00	0.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1803	WIMO-NOBR-0003	\N	4	103	\N	t	1400.00	0.00	0.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1804	BATT-OURS-0005	\N	71	127	\N	t	3375.00	0.00	5800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1805	BATT-OURS-0006	\N	71	127	\N	t	3500.00	0.00	6200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1806	UJOI-GMBX-0015	\N	52	20	\N	t	180.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1807	TALI-SGMX-0008	BULB TYPE	56	79	\N	t	180.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1808	WHRI-NOBR-0001	\N	4	212	\N	t	1050.00	0.00	1900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1809	BRSH-NBKX-0002	\N	20	55	\N	t	1350.00	0.00	2450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1810	BRSH-NBKX-0003	\N	20	55	\N	t	850.00	0.00	1580.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1811	BRSH-NBKX-0004	\N	20	55	\N	t	1250.00	0.00	2300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1812	BRSH-NBKX-0005	\N	20	55	\N	t	1250.00	0.00	2300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1813	BACL-NOBR-0001	\N	4	213	\N	t	45.00	0.00	80.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1814	BEDR-NOBR-0001	\N	4	141	\N	t	350.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1815	BORE-BOSC-0001	\N	93	214	\N	t	85.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1816	BORE-BOSC-0002	\N	93	214	\N	t	110.00	0.00	195.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1817	BRPA-MOHA-0003	\N	13	11	\N	t	180.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1818	BMKI-NOBR-0001	\N	4	98	\N	t	780.00	0.00	1400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1820	CEBE-CTBX-0001	\N	125	215	\N	t	385.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1821	IGCO-ORIO-0001	\N	24	189	\N	t	380.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1822	TIBE-MAZD-0001	\N	126	14	\N	t	650.00	0.00	1300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1823	TIBE-MAZD-0002	\N	126	14	\N	t	680.00	0.00	1400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1824	TIBE-MAZD-0003	\N	126	14	\N	t	700.00	0.00	1600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1825	CRWR-TWXX-0001	17*14*21*23	42	216	\N	t	195.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1826	FUPU-HKTX-0001	\N	124	217	\N	t	950.00	0.00	1700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1827	FUPU-HKTX-0002	\N	124	217	\N	t	950.00	0.00	1700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1828	CLCO-DAIK-0001	\N	127	28	\N	t	2250.00	0.00	3980.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1829	CLCO-DAIK-0002	\N	127	28	\N	t	1250.00	0.00	2300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1830	CLCO-DAIK-0003	\N	127	28	\N	t	1750.00	0.00	3150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1831	FLPI-5WOR-0001	\N	128	218	\N	t	520.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1832	FLPI-RMXX-0001	2 1/2	129	218	\N	t	580.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1833	FLPI-RMXX-0002	2 3/4	129	218	\N	t	620.00	0.00	1150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1834	FLPI-RMXX-0003	\N	129	218	\N	t	730.00	0.00	1300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1835	SABU-KICH-0001	\N	73	65	\N	t	370.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1836	CAAS-OEMX-0001	UPPER RH/LH	105	219	\N	t	1250.00	0.00	2200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1837	CDHO-BOSC-0001	105-118dB(A)350/420HZ	93	220	\N	t	385.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1838	CLDI-AISI-0005	\N	62	27	\N	t	1150.00	0.00	2300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1839	CLDI-AISI-0006	3/4X18T	62	27	\N	t	650.00	0.00	1300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1840	CLDI-AISI-0007	6-3/4X(170MM)X18T	62	27	\N	t	700.00	0.00	1700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1841	FUPU-OEMX-0001	\N	105	217	\N	t	550.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1842	COBE-BAND-0033	\N	46	178	\N	t	462.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1843	COBE-BAND-0034	\N	46	178	\N	t	485.00	0.00	680.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1844	COBE-BAND-0035	\N	46	178	\N	t	452.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1845	COBE-BAND-0036	\N	46	178	\N	t	508.00	0.00	720.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1846	COBE-BAND-0037	\N	46	178	\N	t	520.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1847	COBE-BAND-0038	\N	46	178	\N	t	557.00	0.00	780.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1848	COBE-BAND-0039	\N	46	178	\N	t	567.00	0.00	800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1849	OISE-NOKX-0200	32*47*6; CAMSHAFT	2	1	\N	t	56.00	0.00	120.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1850	OISE-NOKX-0201	35*47*6; CAMSHAFT	2	1	\N	t	68.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1851	OISE-NOKX-0202	28*38*10*15; EXTENSION CASE/DCY	2	1	\N	t	48.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1852	OISE-NOKX-0203	80*105*13; CRANK RR/TCR	2	1	\N	t	170.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1853	OISE-NOKX-0204	75*105*15; HUB INNER/TC	2	1	\N	t	140.00	0.00	245.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1854	AIFI-FLEE-0064	\N	6	6	\N	t	370.00	0.00	630.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1855	AIFI-FLEE-0065	\N	6	6	\N	t	300.00	0.00	520.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1856	AIFI-FLEE-0066	\N	6	6	\N	t	425.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1857	AIFI-FLEE-0067	\N	6	6	\N	t	310.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1858	WHCY-REDL-0001	\N	130	34	\N	t	380.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1859	WHCY-REDL-0002	\N	130	34	\N	t	380.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1860	WHCY-REDL-0003	\N	130	34	\N	t	380.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1861	WHCY-REDL-0004	\N	130	34	\N	t	380.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1862	WHAS-REDL-0001	\N	130	78	\N	t	1500.00	0.00	2600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1863	RACA-REDL-0001	\N	130	221	\N	t	130.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1864	RACA-REDL-0002	\N	130	221	\N	t	130.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1865	RACA-REDL-0003	\N	130	221	\N	t	130.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1866	AIFI-FLEE-0068	\N	6	6	\N	t	445.00	0.00	780.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1867	FUFI-FLEE-0001	\N	6	19	\N	t	425.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1868	FUFI-FLEE-0002	\N	6	19	\N	t	400.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1869	FUFI-FLEE-0003	METAL	6	19	\N	t	645.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1870	HEGA-FEMO-0003	\N	45	64	\N	t	990.00	0.00	1700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1871	HEGA-FEMO-0004	STEEL TYPE	45	64	\N	t	1300.00	0.00	2100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1872	CLOP-NESI-0002	\N	96	43	\N	t	370.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1873	CMKI-NESI-0003	5/8	96	31	\N	t	670.00	0.00	1150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1874	TLSO-NUPR-0003	BRAZILLA S.C CERAMIC	40	49	\N	t	18.00	0.00	50.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1875	TLSO-NUPR-0004	BRAZILLA D.C CERAMIC	40	49	\N	t	20.00	0.00	50.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1876	SPB1-JAGX-0001	RR	38	145	\N	t	18.00	0.00	50.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1877	SPB1-JAGX-0002	\N	38	145	\N	t	35.00	0.00	70.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1878	SPB1-JAGX-0003	\N	38	145	\N	t	17.00	0.00	60.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1879	SPB1-JAGX-0004	\N	38	145	\N	t	135.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1880	SPB1-JAGX-0005	RR	38	145	\N	t	115.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1881	SBBU-JAGX-0001	\N	38	222	\N	t	45.00	0.00	85.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1882	SABU-JAGX-0001	RR	38	65	\N	t	20.00	0.00	50.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1883	SBBU-JAGX-0002	\N	38	222	\N	t	50.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1884	SBBU-JAGX-0003	\N	38	222	\N	t	50.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1885	SBBU-JAGX-0004	\N	38	222	\N	t	60.00	0.00	90.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1886	SBBU-JAGX-0005	\N	38	222	\N	t	150.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1887	SBBU-JAGX-0006	\N	38	222	\N	t	40.00	0.00	70.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1888	SBBU-JAGX-0007	\N	38	222	\N	t	50.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1889	SBBU-JAGX-0008	\N	38	222	\N	t	80.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1890	STBE-KOYO-0001	\N	11	223	\N	t	648.00	0.00	680.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1891	BEAR-KOYO-0030	\N	11	9	\N	t	977.00	0.00	1050.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1892	BEAR-KOYO-0031	TAPERED ROLLER BRG	11	9	\N	t	870.00	0.00	920.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1893	BEAR-KOYO-0032	TAPERED ROLLER BRG HI-CAP	11	9	\N	t	1187.00	0.00	1250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1894	BEAR-KOYO-0033	TAPERED ROLLER BRG HI-CAP	11	9	\N	t	497.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1895	RACA-COGE-0001	STAINLESS	131	221	\N	t	80.00	0.00	140.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1896	RACA-COGE-0002	STAINLESS	131	221	\N	t	80.00	0.00	140.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1897	BRPA-NUPR-0011	\N	40	11	\N	t	520.00	0.00	800.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1898	BRPA-NUPR-0012	\N	40	11	\N	t	600.00	0.00	980.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1899	BRSH-NUPR-0003	RR	40	55	\N	t	550.00	0.00	850.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1900	BRSH-NUPR-0004	RR W/ARM	40	55	\N	t	580.00	0.00	980.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1901	MANU-HTCX-0001	\N	43	224	\N	t	50.00	0.00	85.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1902	MANU-HTCX-0002	W/O WASHER	43	224	\N	t	50.00	0.00	85.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1903	TREN-CBSX-0001	R/L	132	4	\N	t	800.00	0.00	1450.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1904	OISE-NOKX-0205	52*84*14	2	1	\N	t	96.00	0.00	170.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1905	HEGA-FEMO-0005	\N	45	64	\N	t	880.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1906	HEGA-FEMO-0006	\N	45	64	\N	t	425.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1907	TIBE-SUNX-0001	\N	133	14	\N	t	810.00	0.00	1400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1908	PIAS-FEMO-0001	\N	45	185	\N	t	900.00	0.00	3250.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1909	HOCL-CHIT-0001	4 1/2; GALVANIZE	54	225	\N	t	17.00	0.00	30.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1910	VSCA-NOKX-0001	\N	2	180	\N	t	10.00	0.00	18.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1911	ENOI-NOBR-0001	\N	4	82	\N	t	3068.00	0.00	4950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1912	ABPI-KYOT-0001	\N	134	226	\N	t	390.00	0.00	665.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1913	ABPI-KYOT-0002	\N	134	226	\N	t	390.00	0.00	680.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1914	MCVA-KYOT-0001	\N	134	227	\N	t	162.00	0.00	275.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1915	CBSL-KYOT-0001	\N	134	228	\N	t	180.00	0.00	310.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1916	CBSL-KYOT-0002	\N	134	228	\N	t	210.00	0.00	360.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1917	MCVA-KYOT-0002	\N	134	227	\N	t	162.00	0.00	275.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1918	MCVA-KYOT-0003	\N	134	227	\N	t	162.00	0.00	275.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1919	MCVA-KYOT-0004	\N	134	227	\N	t	162.00	0.00	275.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1920	MCVA-KYOT-0005	\N	134	227	\N	t	196.00	0.00	335.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1921	MCVA-KYOT-0006	\N	134	227	\N	t	196.00	0.00	335.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1922	FUPU-KYOT-0001	\N	134	217	\N	t	2900.00	0.00	5000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1923	AIPU-NOBR-0001	\N	4	229	\N	t	355.00	0.00	610.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1924	AIPU-NOBR-0002	\N	4	229	\N	t	355.00	0.00	610.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1925	BRLI-FUJI-0001	\N	34	131	\N	t	2340.00	0.00	4500.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1926	BRLI-FUJI-0002	\N	34	131	\N	t	2140.00	0.00	4200.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1927	NOSE-YSMW-0001	INJECTOR COVER SEAL	58	230	\N	t	88.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1928	HEGA-YSMW-0001	CARNIVAL	58	64	\N	t	2100.00	0.00	3600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1929	CYHE-YSMW-0005	\N	58	101	\N	t	1400.00	0.00	2450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1930	VCGA-YSMW-0007	\N	58	85	\N	t	300.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1931	BEAR-KOYO-0034	\N	11	9	\N	t	150.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1932	BEAR-KOYO-0035	\N	11	9	\N	t	210.00	0.00	390.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1933	BEAR-KOYO-0036	\N	11	9	\N	t	90.00	0.00	165.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1934	BEAR-KOYO-0037	\N	11	9	\N	t	573.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1935	BEAR-NTNX-0019	\N	33	9	\N	t	572.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1936	BEAR-KOYO-0038	\N	11	9	\N	t	369.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1937	TIRE-LONG-0001	\N	135	231	\N	t	346.67	0.00	1650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1938	BEAR-TIMK-0001	\N	136	9	\N	t	208.00	0.00	380.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1939	BEAR-KOYO-0039	\N	11	9	\N	t	226.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1940	BEAR-NTNX-0020	\N	33	9	\N	t	295.00	0.00	520.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1941	BEAR-KOYO-0040	\N	11	9	\N	t	100.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1942	BEAR-KOYO-0041	\N	11	9	\N	t	305.00	0.00	540.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1943	STAR-BLIT-0006	BSAM-30	86	153	\N	t	890.00	0.00	1400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1944	STAR-BLIT-0007	24V	86	153	\N	t	1690.00	0.00	2550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1945	ALHO-MOHA-0001	STEEL MATERIAL	13	125	\N	t	220.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1946	ALHO-MOHA-0002	STEEL MATERIAL	13	125	\N	t	220.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1947	ALHO-MOHA-0003	STEEL MATERIAL	13	125	\N	t	295.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1948	AMGA-BLIT-0001	\N	86	232	\N	t	220.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1949	OIGA-BLIT-0001	\N	86	233	\N	t	380.00	0.00	680.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1951	ALHO-MOHA-0004	STEEL MATERIAL|9 1/2	13	125	\N	t	190.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1952	ALHO-MOHA-0005	STEEL MATERIAL	13	125	\N	t	190.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1953	ALHO-MOHA-0006	STEEL MATERIAL	13	125	\N	t	190.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1954	ALHO-MOHA-0007	STEEL MATERIAL|6 1/2	13	125	\N	t	190.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1955	IPBO-KICH-0001	8*20MM	73	235	\N	t	10.00	0.00	125.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1956	CPBU-NOBR-0002	LONG PVC TYPE	4	142	\N	t	95.00	0.00	170.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1957	ALHO-CHIT-0001	\N	54	125	\N	t	80.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1958	ALHO-CHIT-0002	\N	54	125	\N	t	58.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1959	KPKI-CULT-0004	\N	39	47	\N	t	2400.00	0.00	4200.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1960	CLDI-EXED-0015	\N	19	27	\N	t	1080.00	0.00	1950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1961	EFPU-JWOR-0001	\N	137	69	\N	t	680.00	0.00	1250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1962	EFPU-JWOR-0002	\N	137	69	\N	t	680.00	0.00	1250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1963	GRGU-PRES-0001	\N	138	135	\N	t	420.00	0.00	715.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1964	BRFL-PRE1-0001	900ML	139	236	\N	t	233.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1965	BRLI-IBKX-0002	\N	77	131	\N	t	3043.00	0.00	4300.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1966	BRLI-IBKX-0003	\N	77	131	\N	t	3209.00	0.00	4500.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1967	BRLI-IBKX-0004	\N	77	131	\N	t	1622.00	0.00	2750.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1968	BRLI-IBKX-0005	\N	77	131	\N	t	2320.00	0.00	4300.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1969	BRLI-IBKX-0006	\N	77	131	\N	t	3738.00	0.00	5200.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1970	BRLI-IBKX-0007	\N	77	131	\N	t	1014.00	0.00	1550.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1971	BRLI-IBKX-0008	\N	77	131	\N	t	1420.00	0.00	2100.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1972	OIFI-MICR-0001	\N	140	38	\N	t	1185.00	0.00	1600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1973	OIFI-MICR-0002	\N	140	38	\N	t	1342.00	0.00	1900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1974	BEAR-KOYO-0042	\N	11	9	\N	t	290.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1975	BEAR-KOYO-0043	\N	11	9	\N	t	558.00	0.00	800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1976	BRFL-SUBR-0001	900ML	141	236	\N	t	196.00	0.00	240.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1977	GREA-SURE-0001	2KG MULTI-PURPOSE GREASE	142	13	\N	t	415.00	0.00	580.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1978	GREA-SURE-0002	500MG MULTI-PURPOSE GREASE	142	13	\N	t	106.00	0.00	185.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1979	GREA-SURE-0003	250MG MULTI-PURPOSE GREASE	142	13	\N	t	70.00	0.00	130.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1980	OISE-NOKX-0206	85*162*12*42.30; JAPAN	2	1	\N	t	1395.00	0.00	2500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1981	CLDI-EXED-0016	\N	19	27	\N	t	3902.00	0.00	6900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1982	BARE-COMF-0002	\N	64	113	\N	t	220.00	0.00	385.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1983	BMKI-MIKA-0001	ROUND	23	98	\N	t	860.00	0.00	1450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1984	STBU-SGPX-0001	\N	5	237	\N	t	38.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1985	CEBE-CTBX-0002	\N	125	215	\N	t	515.00	0.00	880.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1986	SECA-TAIS-0001	\N	92	17	\N	t	1150.00	0.00	1950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1987	TIWR-FUJI-0001	41*21*32*21	34	238	\N	t	2280.00	0.00	3950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1988	TIWR-KDRX-0001	21*23MM	143	238	\N	t	560.00	0.00	950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1989	FPMO-ORIO-0001	\N	24	239	\N	t	960.00	0.00	1700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1990	UJOI-SEAL-0007	\N	30	20	\N	t	1232.00	0.00	2150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1991	UJOI-SEAL-0008	\N	30	20	\N	t	242.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1992	FABE-BAND-0001	RIB BELT	46	15	\N	t	305.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1993	FUFI-UNAS-0004	V10-V12 ELEMENT TYPE	7	19	\N	t	152.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1994	HEGA-SPOR-0003	CARBON	50	64	\N	t	500.00	0.00	880.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1995	SABU-OPT1-0006	UPPER	47	65	\N	t	275.00	0.00	480.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1996	SABU-OPT1-0007	BIG 4	47	65	\N	t	590.00	0.00	950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1997	SHAB-OPT1-0001	\N	47	41	\N	t	1720.00	0.00	2700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1998	SABU-OPT1-0008	\N	47	65	\N	t	475.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1999	ENMO-OPT1-0001	\N	47	45	\N	t	2275.00	0.00	3600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2000	BAJO-REDL-0001	\N	130	240	\N	t	440.00	0.00	780.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2001	BAJO-REDL-0002	\N	130	240	\N	t	400.00	0.00	680.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2002	BAJO-REDL-0003	\N	130	240	\N	t	320.00	0.00	560.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2003	BAJO-REDL-0004	\N	130	240	\N	t	420.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2004	BAJO-REDL-0005	\N	130	240	\N	t	600.00	0.00	1050.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2005	WHCY-REDL-0005	\N	130	34	\N	t	550.00	0.00	980.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2006	WHCY-REDL-0006	\N	130	34	\N	t	550.00	0.00	980.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2007	BAJO-REDL-0006	\N	130	240	\N	t	480.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2008	COTA-TAIW-0005	\N	22	51	\N	t	290.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2009	SABU-OPT1-0009	\N	47	65	\N	t	310.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2010	SABU-OPT1-0010	\N	47	65	\N	t	205.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2011	SABU-OPT1-0011	\N	47	65	\N	t	205.00	0.00	380.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2012	SABU-OPT1-0012	\N	47	65	\N	t	275.00	0.00	480.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2013	SABU-OPT1-0013	\N	47	65	\N	t	225.00	0.00	480.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2014	SABU-OPT1-0014	\N	47	65	\N	t	205.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2015	SABU-OPT1-0015	\N	47	65	\N	t	475.00	0.00	800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2016	SABU-OPT1-0016	\N	47	65	\N	t	425.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2017	BAJO-NOBR-0001	8*10MM RH  TANZO SMALL	4	240	\N	t	139.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2018	BAJO-NOBR-0002	8*10MM LH TANZO SMALL	4	240	\N	t	139.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2019	BAJO-NOBR-0003	8*8MM RH TANZO SMALL	4	240	\N	t	139.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2020	MASW-ITOK-0001	CARBURETOR, BIG	144	241	\N	t	225.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2021	CLCO-AISI-0002	JAPAN	62	28	\N	t	1500.00	0.00	2800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2022	CLCO-AISI-0003	JAPAN	62	28	\N	t	4916.00	0.00	8700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2023	CLCO-AISI-0004	JAPAN	62	28	\N	t	3570.00	0.00	6250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2024	CLDI-AISI-0008	JAPAN	62	27	\N	t	3094.00	0.00	5550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2025	CLDI-AISI-0009	JAPAN	62	27	\N	t	6296.00	0.00	11000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2026	CMKI-ADVI-0001	JAPAN	145	31	\N	t	1058.00	0.00	1950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2027	GLPL-ITOK-0001	\N	144	37	\N	t	105.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2028	GLPL-ITOK-0002	\N	144	37	\N	t	71.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2029	GLPL-ITOK-0003	\N	144	37	\N	t	71.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2030	BRPA-NOBR-0001	FRT GTR	4	11	\N	t	266.00	0.00	480.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2031	BRPA-NOBR-0002	FRT GTR	4	11	\N	t	439.00	0.00	780.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2032	TOSW-ITOK-0001	6 TERMINAL	144	242	\N	t	60.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2033	FLRE-NOBR-0001	\N	4	80	\N	t	165.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2034	EMGA-NOBR-0001	\N	4	243	\N	t	195.00	0.00	380.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2035	CLCO-AISI-0005	JAPAN	62	28	\N	t	3345.00	0.00	6000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2036	WAPU-GMBX-0002	JAPAN	52	121	\N	t	1035.00	0.00	1900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2037	FLRE-NOBR-0002	11T	4	80	\N	t	502.00	0.00	900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2038	PIPI-MIZU-0001	30*78	146	32	\N	t	146.00	0.00	380.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2039	PIPI-MIZU-0002	34*78	146	32	\N	t	146.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2040	RIBE-MIT1-0001	\N	147	23	\N	t	210.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2041	RFBL-NOBR-0001	ME-075229	4	244	\N	t	878.00	0.00	1800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2042	CLDI-AISI-0010	JAPAN	62	27	\N	t	7106.00	0.00	12500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2043	CMKI-AISI-0001	JAPAN	62	31	\N	t	742.00	0.00	1300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2044	CMKI-AISI-0002	JAPAN	62	31	\N	t	750.00	0.00	1400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2045	WAPU-GMBX-0003	JAPAN	52	121	\N	t	1234.00	0.00	2200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2046	WAPU-GMBX-0004	JAPAN	52	121	\N	t	720.00	0.00	1480.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2047	BRFL-WHIZ-0001	270ML	148	236	\N	t	66.00	0.00	95.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2048	TUHO-YSMW-0001	\N	58	245	\N	t	3000.00	0.00	5250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2049	TUHO-YSMW-0002	\N	58	245	\N	t	3000.00	0.00	5250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2050	TUHO-YSMW-0003	\N	58	245	\N	t	3500.00	0.00	6200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2051	TUHO-YSMW-0004	\N	58	245	\N	t	3000.00	0.00	5250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2052	CRB1-YSMW-0003	\N	58	92	\N	t	2800.00	0.00	4900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2053	CYHE-YSMW-0006	\N	58	101	\N	t	240.00	0.00	480.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2054	CYHE-YSMW-0007	\N	58	101	\N	t	1350.00	0.00	2400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2055	WHCY-YSMW-0003	W/ADJ W/O BLEEDER COMMANDO	58	34	\N	t	1400.00	0.00	2450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2056	WHCY-YSMW-0004	W/ADJ W/O BLEEDER COMMANDO	58	34	\N	t	1400.00	0.00	2450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2057	CLK1-YSMW-0001	\N	58	246	\N	t	17500.00	0.00	28000.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2058	OIFI-VICX-0003	\N	94	38	\N	t	222.00	0.00	380.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2059	OIFI-VICX-0004	\N	94	38	\N	t	302.00	0.00	520.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2060	OIFI-VICX-0005	\N	94	38	\N	t	215.00	0.00	380.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2061	OIFI-VICX-0006	\N	94	38	\N	t	249.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2062	OIFI-VICX-0007	\N	94	38	\N	t	282.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2063	OIFI-VICX-0008	\N	94	38	\N	t	692.00	0.00	1180.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2064	OIFI-VICX-0009	\N	94	38	\N	t	196.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2065	OIFI-VICX-0010	\N	94	38	\N	t	712.00	0.00	1245.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2067	OIFI-VICX-0012	\N	94	38	\N	t	242.00	0.00	425.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2068	OIFI-VICX-0013	\N	94	38	\N	t	263.00	0.00	460.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2069	OIFI-VICX-0014	\N	94	38	\N	t	786.00	0.00	1375.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2070	ENVA-FUJI-0018	C240	34	181	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2071	OIFI-VICX-0015	\N	94	38	\N	t	255.00	0.00	445.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2072	OIFI-VICX-0016	\N	94	38	\N	t	402.00	0.00	705.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2073	OIFI-VICX-0017	\N	94	38	\N	t	145.00	0.00	255.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2074	OIFI-VICX-0018	\N	94	38	\N	t	153.00	0.00	270.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2075	OIFI-VICX-0019	\N	94	38	\N	t	149.00	0.00	260.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2076	OIFI-VICX-0020	\N	94	38	\N	t	158.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2077	OIFI-VICX-0021	\N	94	38	\N	t	201.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2078	OIFI-VICX-0022	\N	94	38	\N	t	141.00	0.00	245.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2079	OIFI-VICX-0023	\N	94	38	\N	t	157.00	0.00	275.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2080	OIFI-VICX-0024	\N	94	38	\N	t	367.00	0.00	640.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2081	OIFI-VICX-0025	\N	94	38	\N	t	1028.00	0.00	1800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2082	OIFI-VICX-0026	\N	94	38	\N	t	149.00	0.00	260.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2083	OIFI-VICX-0027	\N	94	38	\N	t	153.00	0.00	270.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2084	OIFI-VICX-0028	\N	94	38	\N	t	235.00	0.00	410.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2085	OIFI-VICX-0029	\N	94	38	\N	t	947.00	0.00	1655.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2086	OIFI-VICX-0030	\N	94	38	\N	t	213.00	0.00	375.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2087	BATT-DYPO-0001	\N	149	127	\N	t	4160.00	0.00	4950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2088	THER-TAMA-0001	\N	150	203	\N	t	315.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2089	HEGA-FEMO-0007	CARBON TYPE	45	64	\N	t	525.00	0.00	880.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2091	OISE-NOKX-0207	154*172*14; HUB	2	1	\N	t	370.00	0.00	480.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2092	UJOI-NISX-0001	\N	151	20	\N	t	450.00	0.00	800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2093	TREN-OPT1-0001	\N	47	4	\N	t	400.00	0.00	680.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2094	TREN-OPT1-0002	\N	47	4	\N	t	400.00	0.00	680.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2095	ENVA-FUJ1-0001	\N	152	181	\N	t	185.00	0.00	2500.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2096	FUFI-BOSC-0002	DIESEL	93	19	\N	t	295.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2097	FUFI-BOSC-0003	DIESEL	93	19	\N	t	480.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2098	SPPL-BOSC-0005	COPPER	93	172	\N	t	100.00	0.00	160.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2099	SPPL-BOSC-0006	SET FUSION	93	172	\N	t	748.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2100	AIFI-NOBR-0001	\N	4	6	\N	t	291.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2101	AIFI-NOBR-0002	\N	4	6	\N	t	433.00	0.00	780.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2102	FUFI-NOBR-0003	\N	4	19	\N	t	180.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2104	GLPL-HKTX-0001	\N	124	37	\N	t	132.00	0.00	250.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2105	THER-NOBR-0001	\N	4	203	\N	t	390.00	0.00	690.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2106	FUPU-NITR-0001	\N	153	217	\N	t	700.00	0.00	1300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2107	FPHE-NITR-0001	\N	153	247	\N	t	325.00	0.00	570.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2108	FUPU-NITR-0002	\N	153	217	\N	t	740.00	0.00	1300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2109	FPHE-NITR-0002	\N	153	247	\N	t	325.00	0.00	580.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2110	FPHE-NITR-0003	\N	153	247	\N	t	325.00	0.00	580.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2111	FAMO-NITR-0001	\N	153	248	\N	t	1450.00	0.00	2550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2112	CYLI-HTKX-0001	\N	154	111	\N	t	3025.00	0.00	5300.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2113	FPSE-NITR-0001	\N	153	249	\N	t	135.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2114	FAMO-NITR-0002	\N	153	248	\N	t	950.00	0.00	1700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2115	CMKI-NOBR-0001	\N	4	31	\N	t	1190.00	0.00	2100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2116	DLEN-MIKA-0001	\N	23	250	\N	t	1350.00	0.00	2400.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2117	DLEN-MIKA-0002	\N	23	250	\N	t	1350.00	0.00	2400.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2118	SOVA-NOBR-0001	\N	4	39	\N	t	580.00	0.00	870.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2119	CABA-TAIS-0001	\N	92	251	\N	t	2700.00	0.00	4100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2120	CABA-TAIS-0002	16MM	92	251	\N	t	2900.00	0.00	4350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2121	BEAR-NOBR-0001	\N	4	9	\N	t	3250.00	0.00	4350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2122	BEAR-NOBR-0002	\N	4	9	\N	t	3000.00	0.00	4300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2123	BEAR-NOBR-0003	\N	4	9	\N	t	500.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2124	OISE-TORI-0001	17*30*7	155	1	\N	t	45.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2125	OISE-TORI-0002	35*85*11	155	1	\N	t	70.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2126	OISE-TORI-0003	165*195*19/19.7	155	1	\N	t	800.00	0.00	1150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2127	OISE-TORI-0004	54*76*8/11	155	1	\N	t	120.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2128	OISE-TORI-0005	100*145*16.1/27.3	155	1	\N	t	450.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2129	OISE-TORI-0006	12*25*7	155	1	\N	t	35.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2130	OISE-TORI-0007	12*22*7	155	1	\N	t	45.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2131	OISE-TORI-0008	31.75*48*8/9	155	1	\N	t	110.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2132	OISE-TORI-0009	32.5*43*6.7	155	1	\N	t	180.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2133	OISE-TORI-0010	35*47*6	155	1	\N	t	60.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2134	OISE-TORI-0011	35*50*11	155	1	\N	t	70.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2135	OISE-TORI-0012	35*55*11	155	1	\N	t	70.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2136	OISE-TORI-0013	58*75*9	155	1	\N	t	75.00	0.00	190.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2137	OISE-TORI-0014	58*103*12/19.5	155	1	\N	t	185.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2138	OISE-TORI-0015	68*124*11.5/27	155	1	\N	t	380.00	0.00	670.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2139	OISE-TORI-0016	30*44*7	155	1	\N	t	60.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2140	OISE-TORI-0017	16*30*7	155	1	\N	t	30.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2141	MAVA-MIKA-0001	\N	23	252	\N	t	370.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2142	ENOI-PETR-0001	REV-X RX400 PMG PAIL 18L	156	82	\N	t	3085.00	0.00	4000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2143	HYOI-PETR-0001	HYDROTOUR PAIL 18L	156	182	\N	t	2770.00	0.00	3500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2144	GREA-PETR-0001	\N	156	13	\N	t	4500.00	0.00	5500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2145	GEOI-PETR-0001	ATF PREMIUM 1L	156	253	\N	t	221.00	0.00	270.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2146	GEOI-PETR-0002	GEP 140 PAIL 18L	156	253	\N	t	2900.00	0.00	3900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2147	GEOI-PETR-0003	GEP 90 PAIL 18L	156	253	\N	t	198.00	0.00	240.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2090	VSCA-NOKX-0002-merged-1572	\N	2	180	\N	f	10.00	0.00	270.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	2025-09-12 15:47:40.171709+00	\N	1572
2148	CRAR-MXXX-0001	\N	157	254	\N	t	2250.00	0.00	3950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2149	ENSU-KRCX-0001	\N	158	35	\N	t	1050.00	0.00	1880.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2150	TRS1-TOMI-0001	\N	159	133	\N	t	1350.00	0.00	2300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2151	HAMO-NOBR-0001	\N	4	255	\N	t	25.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2152	STB1-NOBR-0001	\N	4	256	\N	t	800.00	0.00	1400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2153	STB1-NOBR-0002	\N	4	256	\N	t	800.00	0.00	1400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2154	PINU-NOBR-0001	34.5MM	4	210	\N	t	220.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2155	PINU-NOBR-0002	40.5MM	4	210	\N	t	220.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2156	PINU-NOBR-0003	44.5MM	4	210	\N	t	200.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2157	TIWR-NOBR-0001	41*21*32	4	238	\N	t	780.00	0.00	1400.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2158	TICA-NOBR-0001	\N	4	30	\N	t	900.00	0.00	1600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2159	TICA-NOBR-0002	\N	4	30	\N	t	1100.00	0.00	1900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2160	HUNU-NOBR-0001	\N	4	132	\N	t	550.00	0.00	970.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2161	GTCA-NOBR-0001	\N	4	257	\N	t	250.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2162	GTCA-NOBR-0002	W/KEY	4	257	\N	t	250.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2163	BFTA-NOBR-0001	\N	4	258	\N	t	560.00	0.00	980.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2164	FPVA-NOBR-0001	\N	4	259	\N	t	75.00	0.00	150.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2165	BOSH-NOBR-0001	\N	4	260	\N	t	30.00	0.00	60.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2166	SIMI-SHIL-0001	\N	160	261	\N	t	150.00	0.00	270.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2167	SIMI-SHIL-0002	LH	160	261	\N	t	200.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2168	SIMI-SHIL-0003	RH	160	261	\N	t	250.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2169	BUMI-SHIL-0001	W/BOLT	160	262	\N	t	230.00	0.00	580.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2170	BUMI-SHIL-0002	W/CLIP & BOLT	160	262	\N	t	220.00	0.00	340.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2171	ENOI-CALT-0001	DELO GOLD MG 1L	161	82	\N	t	229.00	0.00	270.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2172	ENOI-CALT-0002	DELO GOLD MG GAL	161	82	\N	t	911.00	0.00	1150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2173	ENOI-CALT-0003	SUPER DIESEL CF 1L	161	82	\N	t	662.00	0.00	950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2174	ENOI-CALT-0004	SUPER DIESEL CF GAL	161	82	\N	t	166.00	0.00	220.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2175	GREA-CALT-0001	MARFAK 2KG	161	13	\N	t	644.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2176	BATT-OURS-0007	\N	71	127	\N	t	2250.00	0.00	3100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2177	ENMO-JAGX-0018	1.8 A/T 07RH	38	45	\N	t	1760.00	0.00	3100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2178	BRPA-BEND-0021	\N	97	11	\N	t	1660.00	0.00	2500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2179	HEGA-FEMO-0008	\N	45	64	\N	t	1160.00	0.00	1900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2180	RIBE-BAND-0020	\N	46	23	\N	t	331.00	0.00	480.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2181	COBE-BAND-0040	\N	46	178	\N	t	186.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2182	FABL-GTXX-0001	\N	79	70	\N	t	3000.00	0.00	5300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2183	FABL-GTXX-0002	\N	79	70	\N	t	500.00	0.00	950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2184	FABL-GTXX-0003	\N	79	70	\N	t	650.00	0.00	1250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2185	TETA-NOBR-0001	3/4*10M	4	263	\N	t	10.00	0.00	30.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2186	TIWR-KDRX-0002	35*17MM	143	238	\N	t	585.00	0.00	780.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2187	SAPA-EAGL-0001	\N	162	108	\N	t	18.00	0.00	30.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2188	SAPA-EAGL-0002	\N	162	108	\N	t	18.00	0.00	30.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2189	SAPA-EAGL-0003	\N	162	108	\N	t	18.00	0.00	30.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2190	CLBO-MOHA-0008	\N	13	152	\N	t	2030.00	0.00	2800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2191	CLBO-MOHA-0009	\N	13	152	\N	t	1600.00	0.00	2200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2192	WAPU-GMBX-0005	\N	52	121	\N	t	1645.00	0.00	2450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2193	TIWR-NOBR-0002	32*33	4	238	\N	t	1650.00	0.00	2250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2194	CLCO-DKXX-0002	12"	66	28	\N	t	5200.00	0.00	6800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2195	CLCO-DKXX-0003	\N	66	28	\N	t	6200.00	0.00	8000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2196	CLCO-DKXX-0004	\N	66	28	\N	t	1550.00	0.00	2200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2197	CLCO-DKXX-0005	\N	66	28	\N	t	2120.00	0.00	2850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2198	CLCO-DKXX-0006	\N	66	28	\N	t	6500.00	0.00	8600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2199	CLCO-DKXX-0007	\N	66	28	\N	t	5200.00	0.00	6800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2200	CLCO-DKXX-0008	\N	66	28	\N	t	9070.00	0.00	12950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2201	CMKI-MIKA-0019	\N	23	31	\N	t	800.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2202	CMKI-MIKA-0020	\N	23	31	\N	t	720.00	0.00	1250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2203	CMKI-MIKA-0021	\N	23	31	\N	t	780.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2204	CMKI-MIKA-0022	\N	23	31	\N	t	780.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2205	CMKI-MIKA-0023	\N	23	31	\N	t	990.00	0.00	1850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2206	ACHO-NIHO-0005	5*6*18	69	126	\N	t	1014.00	0.00	1600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2207	ACHO-NIHO-0006	5*6*16	69	126	\N	t	902.00	0.00	1580.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2208	RACO-DERF-0003	4L	65	206	\N	t	450.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2209	RACO-DERF-0004	4L	65	206	\N	t	450.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2210	GEOI-WHIZ-0001	PAIL 18L	148	253	\N	t	2850.00	0.00	3600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2211	GEOI-LUBR-0001	PAIL 18L	163	253	\N	t	2450.00	0.00	3450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2212	GREA-NATI-0001	PAIL 15KG, YELLOW	101	13	\N	t	3430.00	0.00	4600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2213	GEOI-NATI-0001	PAIL 18L	101	253	\N	t	3200.00	0.00	3900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2214	ENMO-JAGX-0019	\N	38	45	\N	t	670.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2215	ENMO-JAGX-0020	LH/RH	38	45	\N	t	560.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2216	ENMO-JAGX-0021	LR	38	45	\N	t	1090.00	0.00	1950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2217	ENMO-JAGX-0022	\N	38	45	\N	t	535.00	0.00	950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2218	ENMO-JAGX-0023	UPPER RH	38	45	\N	t	670.00	0.00	1180.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2219	ENMO-JAGX-0024	UPPER LH	38	45	\N	t	670.00	0.00	1180.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2220	ENMO-JAGX-0025	LH	38	45	\N	t	370.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2221	ENMO-JAGX-0026	RH	38	45	\N	t	370.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2222	IDBE-HTCX-0002	80MM	43	56	\N	t	565.00	0.00	990.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2223	IDBE-HTCX-0003	\N	43	56	\N	t	525.00	0.00	950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2224	BRPA-BEND-0022	\N	97	11	\N	t	1180.00	0.00	1800.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2225	BRPA-BEND-0023	\N	97	11	\N	t	1245.00	0.00	2000.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2226	BRPA-BEND-0024	\N	97	11	\N	t	1145.00	0.00	1900.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2227	BRPA-BEND-0025	\N	97	11	\N	t	1170.00	0.00	1900.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2228	BRPA-BEND-0026	\N	97	11	\N	t	1390.00	0.00	2200.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2229	BRPA-BEND-0027	\N	97	11	\N	t	1300.00	0.00	2100.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2230	BRPA-BEND-0028	\N	97	11	\N	t	1390.00	0.00	2200.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2231	BRPA-BEND-0029	\N	97	11	\N	t	1845.00	0.00	2900.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2232	BRPA-BEND-0030	\N	97	11	\N	t	1635.00	0.00	2600.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2233	BRPA-BEND-0031	\N	97	11	\N	t	1390.00	0.00	2200.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2234	BRPA-BEND-0032	\N	97	11	\N	t	1400.00	0.00	2200.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2235	RODI-BEND-0001	\N	97	176	\N	t	2500.00	0.00	3900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2236	RODI-BEND-0002	\N	97	176	\N	t	1570.00	0.00	2500.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2237	HEGA-FEMO-0009	\N	45	64	\N	t	815.00	0.00	1400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2238	FABL-JAGX-0002	\N	38	70	\N	t	45.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2239	FABL-JAGX-0003	\N	38	70	\N	t	945.00	0.00	1700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2240	FABL-JAGX-0004	\N	38	70	\N	t	615.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2241	FABL-JAGX-0005	\N	38	70	\N	t	945.00	0.00	1700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2242	DRBE-GENU-0001	\N	27	187	\N	t	1150.00	0.00	2000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2243	ALPU-GENU-0001	\N	27	264	\N	t	2100.00	0.00	3600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2244	WHBE-GENU-0001	\N	27	97	\N	t	1980.00	0.00	3800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2245	WHBE-GENU-0002	\N	27	97	\N	t	1950.00	0.00	3500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2246	BRPA-GENU-0001	\N	27	11	\N	t	1600.00	0.00	3000.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2247	BAJO-GENU-0001	\N	27	240	\N	t	1900.00	0.00	3500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2248	BAJO-GENU-0002	\N	27	240	\N	t	1500.00	0.00	2800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2249	DRBE-GENU-0002	\N	27	187	\N	t	1250.00	0.00	2500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2250	TEBE-GENU-0001	\N	27	66	\N	t	3800.00	0.00	6500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2251	CLDI-GENU-0001	\N	27	27	\N	t	2800.00	0.00	4800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2252	PRPL-GENU-0001	\N	27	265	\N	t	2900.00	0.00	5200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2253	TIBE-GENU-0001	\N	27	14	\N	t	1180.00	0.00	2100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2254	REBE-GENU-0001	\N	27	21	\N	t	1000.00	0.00	1750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2255	REBE-GENU-0002	\N	27	21	\N	t	1850.00	0.00	3250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2256	IGCO-GENU-0001	\N	27	189	\N	t	2000.00	0.00	3500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2257	BRSH-GENU-0001	\N	27	55	\N	t	2500.00	0.00	4500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2258	ALPU-GENU-0002	\N	27	264	\N	t	1950.00	0.00	3400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2260	CMKI-GENU-0001	\N	27	31	\N	t	3500.00	0.00	6000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2261	AXBO-ORIO-0001	\N	24	266	\N	t	102.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2263	ACHO-ORIO-0001	SHORT 4INCHES	24	126	\N	t	102.00	0.00	190.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2264	ACCA-ORIO-0001	CURVED ROUND 63INCHES	24	18	\N	t	204.00	0.00	380.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2265	BMKI-ORIO-0003	W/TUBE BLUE PISTON 7/8	24	98	\N	t	340.00	0.00	640.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2266	BAJO-ORIO-0001	\N	24	240	\N	t	476.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2267	TREN-ORIO-0001	LH/RH CURVED	24	4	\N	t	850.00	0.00	1500.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2268	STBU-ORIO-0001	RR	24	237	\N	t	60.00	0.00	120.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2269	STBU-ORIO-0002	HIGH FRT	24	237	\N	t	60.00	0.00	120.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2270	STBU-ORIO-0003	LOW FRT	24	237	\N	t	60.00	0.00	120.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2271	TCTE-NOBR-0001	\N	4	57	\N	t	1615.00	0.00	2900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2272	LESP-GIGA-0001	FRONT 63" PARABOLIC	164	267	\N	t	3808.00	0.00	6700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2273	LESP-GIGA-0002	FRONT 63" PARABOLIC	164	267	\N	t	3394.00	0.00	6000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2274	FUPU-DENS-0001	INTANK	12	217	\N	t	440.00	0.00	800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2275	CEBO-NOBR-0002	14*200MM; W/NUT	4	195	\N	t	93.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2276	UBOL-NOBR-0002	10*65*160MM; W/NUT	4	196	\N	t	42.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2277	PBBO-NOBR-0001	SHORT	4	268	\N	t	2240.00	0.00	4000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2278	SPC1-SEIW-0001	\N	165	269	\N	t	204.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2279	SPC1-SEIW-0002	\N	165	269	\N	t	272.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2280	DLHE-NOBR-0001	\N	4	270	\N	t	810.00	0.00	1500.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2281	FABL-NOBR-0001	\N	4	70	\N	t	2050.00	0.00	3000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2282	TRBE-NOBR-0001	\N	4	271	\N	t	140.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2283	DLHE-NOBR-0002	\N	4	270	\N	t	800.00	0.00	1280.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2259	BRPA-GENU-0002-merged-1642	\N	27	11	\N	f	1950.00	0.00	3750.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	2025-09-12 15:36:06.889229+00	\N	1642
2284	TREN-SGPX-0002	LH/RH W/GREASE FITTINGS	5	4	\N	t	180.00	0.00	350.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2285	OIFI-VICX-0031	\N	94	38	\N	t	318.00	0.00	570.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2286	OIFI-VICX-0032	\N	94	38	\N	t	511.00	0.00	900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2287	OIFI-VICX-0033	\N	94	38	\N	t	159.00	0.00	285.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2288	OIFI-VICX-0034	\N	94	38	\N	t	454.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2289	OIFI-VICX-0035	\N	94	38	\N	t	620.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2290	OIFI-VICX-0036	\N	94	38	\N	t	196.00	0.00	370.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2291	OIFI-VICX-0037	\N	94	38	\N	t	641.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2292	OIFI-VICX-0038	\N	94	38	\N	t	495.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2293	ICSE-YSMW-0001	36*60*12 BIG	58	272	\N	t	280.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2294	IOSE-YSMW-0007	WING	58	86	\N	t	380.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2295	ROAR-YSMW-0005	W/SCREW	58	87	\N	t	500.00	0.00	890.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2296	CYHE-YSMW-0008	\N	58	101	\N	t	750.00	0.00	1450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2297	VCGA-FEMO-0003	RF01	45	85	\N	t	145.00	0.00	270.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2298	SABU-NUPR-0001	UPPER LH	40	65	\N	t	2800.00	0.00	4400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2299	TRBR-KOYO-0001	\N	11	273	\N	t	537.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2300	ENMO-OPT1-0002	TM	47	45	\N	t	425.00	0.00	680.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2301	BEAR-KOYO-0044	\N	11	9	\N	t	227.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2302	BEAR-KOYO-0045	\N	11	9	\N	t	177.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2303	BEAR-KOYO-0046	\N	11	9	\N	t	187.00	0.00	230.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2304	BEAR-KOYO-0047	HI-CAP	11	9	\N	t	798.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2305	BAJO-555X-0001	\N	166	240	\N	t	745.00	0.00	1250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2306	BAJO-555X-0002	\N	166	240	\N	t	815.00	0.00	1450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2307	BAJO-555X-0003	\N	166	240	\N	t	1100.00	0.00	1800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2308	BAJO-555X-0004	\N	166	240	\N	t	1400.00	0.00	2280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2309	BAJO-555X-0005	\N	166	240	\N	t	1315.00	0.00	2150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2310	TREN-555X-0001	\N	166	4	\N	t	900.00	0.00	1480.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2311	TREN-555X-0002	\N	166	4	\N	t	490.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2312	BEAR-KOYO-0048	\N	11	9	\N	t	415.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2313	SPB1-OPT1-0001	\N	47	145	\N	t	55.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2314	SPB1-OPT1-0002	\N	47	145	\N	t	40.00	0.00	80.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2315	SPB1-OPT1-0003	\N	47	145	\N	t	35.00	0.00	80.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2316	SPB1-OPT1-0004	\N	47	145	\N	t	195.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2317	SABU-OPT1-0017	\N	47	65	\N	t	485.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2318	SIOI-DENS-0002	\N	12	10	\N	t	25.00	0.00	50.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2319	HEGA-NOBR-0001	AIR COMPRESSOR	4	64	\N	t	500.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2320	HEGA-NOBR-0002	AIR COMPRESSOR	4	64	\N	t	500.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2321	HEGA-NOBR-0003	AIR COMPRESSOR	4	64	\N	t	500.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2322	HEGA-NOBR-0004	AIR COMPRESSOR	4	64	\N	t	500.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2323	HEGA-NOBR-0005	AIR COMPRESSOR	4	64	\N	t	500.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2324	CRBE-DAJA-0001	\N	167	46	\N	t	1028.00	0.00	1800.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2325	CRBE-DAJA-0002	\N	167	46	\N	t	934.00	0.00	1650.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2326	CRBE-DAJA-0003	\N	167	46	\N	t	1230.00	0.00	2200.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2327	CRBE-DAJA-0004	\N	167	46	\N	t	1114.00	0.00	2000.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2328	CRBE-DAJA-0005	\N	167	46	\N	t	1189.00	0.00	2100.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2329	CRB1-GMBX-0001	\N	52	92	\N	t	308.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2330	WAPU-GMBX-0006	\N	52	121	\N	t	1755.00	0.00	3100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2331	WAPU-GMBX-0007	\N	52	121	\N	t	1399.00	0.00	1399.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2332	WAPU-GMBX-0008	\N	52	121	\N	t	1710.00	0.00	3000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2333	AIFR-KARS-0001	TREE	168	274	\N	t	34.00	0.00	60.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2334	UJOI-GMBX-0016	\N	52	20	\N	t	345.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2335	UJOI-GMBX-0017	\N	52	20	\N	t	345.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2336	UJOI-GMBX-0018	\N	52	20	\N	t	634.00	0.00	1150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2337	UJOI-GMBX-0019	\N	52	20	\N	t	996.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2338	UJOI-GMBX-0020	\N	52	20	\N	t	326.00	0.00	580.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2339	UJOI-GMBX-0021	\N	52	20	\N	t	401.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2340	UJOI-GMBX-0022	\N	52	20	\N	t	285.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2341	UJOI-GMBX-0023	\N	52	20	\N	t	482.00	0.00	860.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2342	CABU-DAJA-0001	\N	167	275	\N	t	540.00	0.00	950.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2343	CABU-DAJA-0002	\N	167	275	\N	t	829.00	0.00	1500.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2344	CRBE-DAJA-0006	\N	167	46	\N	t	1590.00	0.00	2800.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2345	CRBE-DAJA-0007	\N	167	46	\N	t	1440.00	0.00	2550.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2346	MABE-DAJA-0001	\N	167	48	\N	t	2032.00	0.00	3600.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2347	MABE-DAJA-0002	\N	167	48	\N	t	1852.00	0.00	3300.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2348	MABE-DAJA-0003	\N	167	48	\N	t	2108.00	0.00	3700.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2349	MABE-DAJA-0004	\N	167	48	\N	t	1241.00	0.00	2200.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2350	MABE-DAJA-0005	\N	167	48	\N	t	2618.00	0.00	4600.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2351	MABE-DAJA-0006	\N	167	48	\N	t	2085.00	0.00	3700.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2352	WAPU-GMBX-0009	\N	52	121	\N	t	885.00	0.00	1550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2353	WAPU-GMBX-0010	\N	52	121	\N	t	2415.00	0.00	4250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2354	WAPU-GMBX-0011	\N	52	121	\N	t	1328.00	0.00	2400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2355	WAPU-GMBX-0012	\N	52	121	\N	t	1222.00	0.00	2150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2356	WAPU-GMBX-0013	\N	52	121	\N	t	945.00	0.00	1670.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2357	WAPU-GMBX-0014	\N	52	121	\N	t	1470.00	0.00	2600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2358	WAPU-GMBX-0015	\N	52	121	\N	t	1916.00	0.00	3400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2359	WAPU-GMBX-0016	\N	52	121	\N	t	862.00	0.00	1600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2360	PIRI-TPJA-0001	\N	169	201	\N	t	1628.00	0.00	2850.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2361	PIRI-TPJA-0002	\N	169	201	\N	t	1628.00	0.00	2850.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2362	PIRI-TPJA-0003	\N	169	201	\N	t	1860.00	0.00	3260.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2363	PIRI-TPJA-0004	\N	169	201	\N	t	1860.00	0.00	3260.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2364	PIRI-TPJA-0005	\N	169	201	\N	t	1214.00	0.00	2150.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2365	PIRI-TPJA-0006	\N	169	201	\N	t	1301.00	0.00	2300.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2366	PIRI-TPJA-0007	\N	169	201	\N	t	1474.00	0.00	2600.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2367	PIRI-TPJA-0008	\N	169	201	\N	t	1474.00	0.00	2600.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2368	PIRI-TPJA-0009	\N	169	201	\N	t	1796.00	0.00	3200.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2369	PIRI-TPJA-0010	\N	169	201	\N	t	1796.00	0.00	3200.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2370	PIRI-TPJA-0011	\N	169	201	\N	t	2265.00	0.00	3980.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2371	CRBE-DAJA-0008	\N	167	46	\N	t	2055.00	0.00	3600.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2372	CRBE-DAJA-0009	\N	167	46	\N	t	1305.00	0.00	2300.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2373	CRBE-DAJA-0010	\N	167	46	\N	t	1725.00	0.00	3100.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2374	CRBE-DAJA-0011	\N	167	46	\N	t	934.00	0.00	1650.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2375	CRBE-DAJA-0012	\N	167	46	\N	t	848.00	0.00	1500.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2376	IGCO-NOBR-0001	PEN TYPE, PLUG TOP	4	189	\N	t	1759.00	0.00	3100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2377	UJOI-GMBX-0024	\N	52	20	\N	t	439.00	0.00	780.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2378	UJOI-GMBX-0025	\N	52	20	\N	t	472.00	0.00	830.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2379	CRB1-GMBX-0002	\N	52	92	\N	t	308.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2380	CABU-DAJA-0003	\N	167	275	\N	t	892.00	0.00	1600.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2381	CABU-DAJA-0004	\N	167	275	\N	t	2055.00	0.00	3600.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2382	MABE-DAJA-0007	\N	167	48	\N	t	2318.00	0.00	4100.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2383	MABE-DAJA-0008	\N	167	48	\N	t	1369.00	0.00	2400.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2384	MABE-DAJA-0009	\N	167	48	\N	t	2066.00	0.00	3700.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2385	MABE-DAJA-0010	\N	167	48	\N	t	1875.00	0.00	3300.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2386	MABE-DAJA-0011	\N	167	48	\N	t	2299.00	0.00	4100.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2387	MABE-DAJA-0012	\N	167	48	\N	t	1451.00	0.00	2600.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2388	MABE-DAJA-0013	\N	167	48	\N	t	1961.00	0.00	3450.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2389	MABE-DAJA-0014	\N	167	48	\N	t	1781.00	0.00	3150.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2390	BRPA-NBKX-0006	\N	20	11	\N	t	480.00	0.00	900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2391	BRPA-NBKX-0007	\N	20	11	\N	t	480.00	0.00	900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2392	BRPA-NBKX-0008	\N	20	11	\N	t	480.00	0.00	820.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2393	BRPA-NBKX-0009	\N	20	11	\N	t	550.00	0.00	990.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2394	BRPA-NBKX-0010	\N	20	11	\N	t	450.00	0.00	800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2395	BRPA-NBKX-0011	\N	20	11	\N	t	460.00	0.00	785.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2396	BRPA-NBKX-0012	\N	20	11	\N	t	480.00	0.00	820.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2397	HYAS-AIRT-0001	LONG	170	276	\N	t	4650.00	0.00	8150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2398	HRKI-KNJA-0001	\N	171	277	\N	t	3150.00	0.00	5500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2399	HRKI-KNJA-0002	\N	171	277	\N	t	2980.00	0.00	5300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2400	COLA-BTXX-0001	\N	172	62	\N	t	380.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2401	COLA-BTXX-0002	\N	172	62	\N	t	380.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2402	COLA-BTXX-0003	\N	172	62	\N	t	480.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2403	RELA-NOBR-0001	MEDIUM AMBER 4 1/2X6 24V	4	278	\N	t	800.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2404	FLSE-NOBR-0001	WHITE	4	279	\N	t	160.00	0.00	500.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2405	AUBU-NOBR-0001	\N	4	167	\N	t	18.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2406	AUBU-NOBR-0002	\N	4	167	\N	t	25.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2407	WEBU-UNIV-0001	\N	173	280	\N	t	55.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2409	RALA-NOBR-0001	\N	4	281	\N	t	120.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2410	HELA-BTXX-0001	\N	172	71	\N	t	1890.00	0.00	3400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2411	TALA-NOBR-0001	\N	4	179	\N	t	750.00	0.00	1400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2412	TALA-NOBR-0002	\N	4	179	\N	t	750.00	0.00	1400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2413	HELA-CSXX-0001	\N	174	71	\N	t	1200.00	0.00	2200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2414	HELA-CSXX-0002	\N	174	71	\N	t	1200.00	0.00	2200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2415	HELA-NOBR-0001	\N	4	71	\N	t	780.00	0.00	1450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2416	HELA-NOBR-0002	\N	4	71	\N	t	780.00	0.00	1450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2417	HELA-JAVE-0001	\N	175	71	\N	t	800.00	0.00	1550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2418	HELA-JAVE-0002	\N	175	71	\N	t	800.00	0.00	1550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2419	TALA-BTXX-0001	\N	172	179	\N	t	565.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2420	TALA-BTXX-0002	\N	172	179	\N	t	565.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2421	TALA-NUPR-0003	\N	40	179	\N	t	190.00	0.00	350.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2422	TALA-NUPR-0004	\N	40	179	\N	t	190.00	0.00	350.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2423	COLA-NUPR-0003	\N	40	62	\N	t	240.00	0.00	450.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2424	COLA-NUPR-0004	\N	40	62	\N	t	240.00	0.00	450.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2425	MCSC-NOBR-0001	6*75; TITANIZED	4	282	\N	t	4.00	0.00	15.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2426	MCSC-NOBR-0002	8*75; TITANIZED	4	282	\N	t	8.00	0.00	20.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2427	MCSC-NOBR-0003	10*75; TITANIZED	4	282	\N	t	13.00	0.00	30.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2428	MCSC-NOBR-0004	12*75; TITANIZED	4	282	\N	t	20.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2429	MCSC-NOBR-0005	14*75; TITANIZED	4	282	\N	t	28.00	0.00	55.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2430	MCSC-NOBR-0006	6*90; TITANIZED	4	282	\N	t	6.00	0.00	20.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2431	MCSC-NOBR-0007	8*90; TITANIZED	4	282	\N	t	10.00	0.00	25.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2432	MCSC-NOBR-0008	10*90; TITANIZED	4	282	\N	t	15.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2433	MCSC-NOBR-0009	12*90; TITANIZED	4	282	\N	t	25.00	0.00	55.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2434	LOBO-NOBR-0001	1/4*1	4	283	\N	t	2.00	0.00	5.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2435	LOBO-NOBR-0002	5*16*1	4	283	\N	t	3.00	0.00	10.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2436	LOBO-NOBR-0003	3/8*1	4	283	\N	t	4.00	0.00	10.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2437	LOBO-NOBR-0004	7/16*1	4	283	\N	t	36.00	0.00	15.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2438	LOBO-NOBR-0005	1/2*1	4	283	\N	t	9.00	0.00	15.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2439	LOBO-NOBR-0006	1/4*1 1/2	4	283	\N	t	2.00	0.00	15.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2440	LOBO-NOBR-0007	5/16*1 1/2	4	283	\N	t	4.00	0.00	15.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2441	LOBO-NOBR-0008	3/8*1 1/2	4	283	\N	t	5.00	0.00	15.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2442	LOBO-NOBR-0009	9/16*1 1/2	4	283	\N	t	13.00	0.00	20.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2443	LOBO-NOBR-0010	1/4*2	4	283	\N	t	3.00	0.00	10.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2444	LOBO-NOBR-0011	5*16*2	4	283	\N	t	5.00	0.00	10.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2445	LHBO-NOBR-0001	3/8*25	4	284	\N	t	7.00	0.00	15.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2446	LHBO-NOBR-0002	7/16*2	4	284	\N	t	9.00	0.00	20.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2447	LHBO-NOBR-0003	1/2*2	4	284	\N	t	13.00	0.00	25.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2448	LHBO-NOBR-0004	9/16*2	4	284	\N	t	17.00	0.00	30.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2449	LHBO-NOBR-0005	5/8*2	4	284	\N	t	21.00	0.00	40.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2450	LHBO-NOBR-0006	1/4*2 1/2	4	284	\N	t	4.00	0.00	10.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2451	LHBO-NOBR-0007	5/16*2 1/2	4	284	\N	t	6.00	0.00	15.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2452	LHBO-NOBR-0008	3/8*2 1/2	4	284	\N	t	8.00	0.00	15.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2453	LHBO-NOBR-0009	7/16*2 1/2	4	284	\N	t	11.00	0.00	25.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2454	LHBO-NOBR-0010	1/2*2 1/2	4	284	\N	t	16.00	0.00	50.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2455	LHBO-NOBR-0011	9/16*2 1/2	4	284	\N	t	20.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2456	LHBO-NOBR-0012	5/8*2 1/2	4	284	\N	t	25.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2457	LCSC-NOBR-0001	1/4*3	4	285	\N	t	4.00	0.00	15.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2458	LCSC-NOBR-0002	5/16*3	4	285	\N	t	7.00	0.00	20.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2459	LCSC-NOBR-0003	3/8*3	4	285	\N	t	10.00	0.00	25.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2460	LCSC-NOBR-0004	7/16*3	4	285	\N	t	13.00	0.00	30.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2461	LCSC-NOBR-0005	1/2*3	4	285	\N	t	19.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2462	LCSC-NOBR-0006	9/16*3	4	285	\N	t	23.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2463	LCSC-NOBR-0007	5/8*3	4	285	\N	t	30.00	0.00	50.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2464	LCSC-NOBR-0008	1/4*3 1/2	4	285	\N	t	5.00	0.00	15.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2465	LCSC-NOBR-0009	5/16*3 1/2	4	285	\N	t	8.00	0.00	20.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2466	LCSC-NOBR-0010	3/8*3 1/2	4	285	\N	t	11.00	0.00	25.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2467	LCSC-NOBR-0011	7/16*3 1/2	4	285	\N	t	15.00	0.00	30.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2468	LCSC-NOBR-0012	1/2*3 1/2	4	285	\N	t	21.00	0.00	40.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2469	LCSC-NOBR-0013	9/16*3 1/2	4	285	\N	t	26.00	0.00	40.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2470	LCSC-NOBR-0014	5/*3 1/2	4	285	\N	t	34.00	0.00	60.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2471	LCSC-NOBR-0015	1/4*4	4	285	\N	t	6.00	0.00	20.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2472	LCSC-NOBR-0016	5/16*4	4	285	\N	t	9.00	0.00	25.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2473	LCSC-NOBR-0017	3/8*4	4	285	\N	t	13.00	0.00	30.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2474	LCSC-NOBR-0018	7/16*4	4	285	\N	t	17.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2475	LCSC-NOBR-0019	1/2*4	4	285	\N	t	24.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2476	LCSC-NOBR-0020	9/16*4	4	285	\N	t	30.00	0.00	55.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2477	LCSC-NOBR-0021	5/8*4	4	285	\N	t	38.00	0.00	65.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2478	MEBO-NOBR-0001	6*100; TITANIZED	4	286	\N	t	7.00	0.00	15.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2479	MEBO-NOBR-0002	8*100; TITANIZED	4	286	\N	t	11.00	0.00	25.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2480	MEBO-NOBR-0003	10*100; TITANIZED	4	286	\N	t	17.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2481	MEBO-NOBR-0004	12*100; TITANIZED	4	286	\N	t	27.00	0.00	40.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2482	MEBO-NOBR-0005	6*115; TITANIZED	4	286	\N	t	12.00	0.00	20.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2483	MEBO-NOBR-0006	8*115; TITANIZED	4	286	\N	t	15.00	0.00	25.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2484	MEBO-NOBR-0007	10*115; TITANIZED	4	286	\N	t	21.00	0.00	40.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2485	MEBO-NOBR-0008	12*115; TITANIZED	4	286	\N	t	31.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2486	MEBO-NOBR-0009	6*185; TITANIZED	4	286	\N	t	14.00	0.00	30.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2487	MEBO-NOBR-0010	8*125; TITANIZED	4	286	\N	t	17.00	0.00	55.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2488	MEBO-NOBR-0011	10*125; TITANIZED	4	286	\N	t	23.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2489	MEBO-NOBR-0012	12*125; TITANIZED	4	286	\N	t	34.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2490	LHCA-NOBR-0001	1/4*1/2	4	287	\N	t	1.00	0.00	10.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2491	LHCA-NOBR-0002	5/16*1/2	4	287	\N	t	2.00	0.00	10.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2492	PLWA-NOBR-0001	GALVANIZED (GI)	4	288	\N	t	0.00	0.00	5.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2493	PLWA-NOBR-0002	GALVANIZED (GI)	4	288	\N	t	0.00	0.00	5.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2494	PLWA-NOBR-0003	GALVANIZED (GI)	4	288	\N	t	1.00	0.00	5.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2495	PLWA-NOBR-0004	GALVANIZED (GI)	4	288	\N	t	2.00	0.00	10.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2496	PLWA-NOBR-0005	GALVANIZED (GI)	4	288	\N	t	4.00	0.00	10.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2497	PLWA-NOBR-0006	GALVANIZED (GI)	4	288	\N	t	4.00	0.00	15.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2498	PLWA-NOBR-0007	GALVANIZED (GI)	4	288	\N	t	4.00	0.00	15.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2499	LHNU-NOBR-0001	\N	4	289	\N	t	26.00	0.00	15.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2500	LOWA-NOBR-0001	YELLOW	4	290	\N	t	0.00	0.00	5.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2501	LOWA-NOBR-0002	YELLOW	4	290	\N	t	0.00	0.00	5.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2502	LOWA-NOBR-0003	YELLOW	4	290	\N	t	1.00	0.00	10.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2503	LOWA-NOBR-0004	YELLOW	4	290	\N	t	2.00	0.00	10.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2504	LOWA-NOBR-0005	YELLOW	4	290	\N	t	3.00	0.00	15.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2505	LOWA-NOBR-0006	YELLOW	4	290	\N	t	4.00	0.00	20.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2506	NUTX-NOBR-0001	TITANIZED	4	291	\N	t	0.00	0.00	5.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2507	NUTX-NOBR-0002	TITANIZED	4	291	\N	t	0.00	0.00	10.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2508	NUTX-NOBR-0003	TITANIZED	4	291	\N	t	0.00	0.00	10.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2509	NUTX-NOBR-0004	TITANIZED	4	291	\N	t	0.00	0.00	10.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2510	NUTX-NOBR-0005	TITANIZED	4	291	\N	t	0.00	0.00	15.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2511	NUTX-NOBR-0006	TITANIZED	4	291	\N	t	0.00	0.00	20.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2512	BOLT-NOBR-0001	6*25; TITANIZED	4	292	\N	t	2.00	0.00	10.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2513	BOLT-NOBR-0002	8*25; TITANIZED	4	292	\N	t	3.00	0.00	15.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2514	BOLT-NOBR-0003	10*25; TITANIZED	4	292	\N	t	5.00	0.00	20.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2515	BOLT-NOBR-0004	12*25; TITANIZED	4	292	\N	t	10.00	0.00	25.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2516	BOLT-NOBR-0005	14*25; TITANIZED	4	292	\N	t	16.00	0.00	30.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2517	BOLT-NOBR-0006	16*25; TITANIZED	4	292	\N	t	22.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2518	BOLT-NOBR-0007	6*50; TITANIZED	4	292	\N	t	3.00	0.00	15.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2519	BOLT-NOBR-0008	8*50; TITANIZED	4	292	\N	t	6.00	0.00	25.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2520	BOLT-NOBR-0009	10*50; TITANIZED	4	292	\N	t	9.00	0.00	30.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2521	BOLT-NOBR-0010	12*50; TITANIZED	4	292	\N	t	14.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2522	BOLT-NOBR-0011	14*50; TITANIZED	4	292	\N	t	21.00	0.00	45.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2523	KPKI-CULT-0005	\N	39	47	\N	t	2520.00	0.00	4000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2524	KPKI-CULT-0006	\N	39	47	\N	t	910.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2525	KPKI-CULT-0007	\N	39	47	\N	t	910.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2526	KPKI-CULT-0008	\N	39	47	\N	t	1680.00	0.00	2700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2527	KPKI-CULT-0009	\N	39	47	\N	t	1680.00	0.00	2700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2528	TREN-BJOK-0001	LH | RH	176	4	\N	t	1120.00	0.00	1800.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2529	DRLI-NOBR-0001	28MM	4	293	\N	t	1120.00	0.00	1800.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2530	THER-OEMX-0002	\N	105	203	\N	t	460.00	0.00	800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2531	TIBE-NOBR-0001	\N	4	14	\N	t	430.00	0.00	900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2532	TIBE-NOBR-0002	\N	4	14	\N	t	480.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2533	OISE-NOKX-0208	160*182*17	2	1	\N	t	550.00	0.00	950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2534	OISE-NOKX-0209	39*50.4*8.5	2	1	\N	t	100.00	0.00	260.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2535	OISE-NOKX-0210	40*64*12	2	1	\N	t	50.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2536	OISE-NOKX-0211	34*63*9/15.5	2	1	\N	t	105.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2537	OISE-NOKX-0212	48*62*9	2	1	\N	t	100.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2538	OISE-NOKX-0213	28*47*8	2	1	\N	t	50.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2539	OISE-NOKX-0214	42*55*7	2	1	\N	t	70.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2540	OISE-NOKX-0215	27*43*9	2	1	\N	t	50.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2541	OISE-NOKX-0216	75*100*13	2	1	\N	t	120.00	0.00	130.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2542	OISE-NOKX-0217	20*36*7	2	1	\N	t	45.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2543	OISE-NOKX-0218	36*52*10	2	1	\N	t	65.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2544	OISE-NOKX-0219	70*142*12/36.3	2	1	\N	t	480.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2545	OISE-NOKX-0220	38*58*11	2	1	\N	t	80.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2546	OISE-NOKX-0221	75*95*10	2	1	\N	t	190.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2547	OISE-NOKX-0222	70*142*12/36.3	2	1	\N	t	480.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2548	OISE-NOKX-0223	34*63*9/15.5	2	1	\N	t	105.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2549	OISE-NOKX-0224	36*52*10	2	1	\N	t	65.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2550	BEAR-KOYO-0049	\N	11	9	\N	t	1500.00	0.00	2000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2551	SABU-NOBR-0002	\N	4	65	\N	t	235.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2552	CLCO-AISI-0006	\N	62	28	\N	t	850.00	0.00	1850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2553	PRPU-DENS-0002	\N	12	202	\N	t	350.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2554	SLLE-NOBR-0001	AUTO VOLTS |NEW GENERATION	4	294	\N	t	155.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2555	SLLE-NOBR-0002	AUTO VOLTS |NEW GENERATION	4	294	\N	t	155.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2556	SLLE-NOBR-0003	AUTO VOLTS |NEW GENERATION	4	294	\N	t	155.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2557	SABU-NOBR-0003	\N	4	65	\N	t	235.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2558	BRPA-NUPR-0013	FRT	40	11	\N	t	540.00	0.00	900.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2559	BRPA-NUPR-0014	FRT	40	11	\N	t	980.00	0.00	1500.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2560	COBE-BAND-0041	\N	46	178	\N	t	259.00	0.00	390.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2561	COBE-BAND-0042	\N	46	178	\N	t	404.00	0.00	580.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2562	COBE-BAND-0043	\N	46	178	\N	t	462.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2563	COBE-BAND-0044	\N	46	178	\N	t	474.00	0.00	680.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2564	COBE-BAND-0045	\N	46	178	\N	t	508.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2565	TEGA-REDL-0001	MECHANICAL, 144"	130	159	\N	t	600.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2566	CLOP-REDL-0001	13/16"	130	43	\N	t	300.00	0.00	880.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2567	BMKI-REDL-0001	\N	130	98	\N	t	2500.00	0.00	4400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2568	CMKI-REDL-0001	13/16"	130	31	\N	t	680.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2569	WHCY-REDL-0007	1-1/8"	130	34	\N	t	500.00	0.00	900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2570	WHCY-REDL-0008	\N	130	34	\N	t	350.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2571	WHCY-REDL-0009	\N	130	34	\N	t	350.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2572	WHCY-REDL-0010	\N	130	34	\N	t	350.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2573	WHCY-MIKA-0013	40MM	23	34	\N	t	1700.00	0.00	2900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2574	WHCY-MIKA-0014	40MM	23	34	\N	t	1700.00	0.00	2900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2575	PSAS-NOBR-0001	\N	4	295	\N	t	4700.00	0.00	6100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2576	COBE-BAND-0046	\N	46	178	\N	t	313.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2577	COBE-BAND-0047	\N	46	178	\N	t	310.00	0.00	420.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2578	COBE-BAND-0048	\N	46	178	\N	t	338.00	0.00	460.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2579	COBE-BAND-0049	\N	46	178	\N	t	331.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2580	RIBE-BAND-0021	\N	46	23	\N	t	366.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2581	RIBE-BAND-0022	\N	46	23	\N	t	404.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2582	RIBE-BAND-0023	\N	46	23	\N	t	465.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2583	RIBE-BAND-0024	\N	46	23	\N	t	360.00	0.00	490.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2584	RIBE-BAND-0025	\N	46	23	\N	t	513.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2585	RIBE-BAND-0026	\N	46	23	\N	t	664.00	0.00	900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2586	RIBE-BAND-0027	\N	46	23	\N	t	1503.00	0.00	2100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2587	RIBE-BAND-0028	\N	46	23	\N	t	984.00	0.00	1400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2588	RIBE-BAND-0029	\N	46	23	\N	t	1186.00	0.00	1700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2589	RIBE-BAND-0030	\N	46	23	\N	t	821.00	0.00	1150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2590	ENMO-JAGX-0027	\N	38	45	\N	t	270.00	0.00	480.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2591	ENMO-JAGX-0028	\N	38	45	\N	t	270.00	0.00	480.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2592	ENMO-JAGX-0029	T/M	38	45	\N	t	225.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2593	RODI-POWE-0007	\N	98	176	\N	t	3160.00	0.00	5200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2594	RODI-POWE-0008	\N	98	176	\N	t	970.00	0.00	1600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2595	BRSH-BEND-0005	\N	97	55	\N	t	1200.00	0.00	1800.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2596	BRPA-BEND-0033	\N	97	11	\N	t	2470.00	0.00	3800.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2597	BRPA-BEND-0034	RR	97	11	\N	t	1135.00	0.00	2150.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2598	BRPA-BEND-0035	FRT	97	11	\N	t	1390.00	0.00	250.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2599	BRPA-BEND-0036	FRT	97	11	\N	t	1765.00	0.00	2800.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2600	BRPA-BEND-0037	\N	97	11	\N	t	1760.00	0.00	2800.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2601	BRPA-BEND-0038	RR	97	11	\N	t	1780.00	0.00	2800.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2602	BRSH-NUPR-0005	\N	40	55	\N	t	1050.00	0.00	1700.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2603	BRPA-NUPR-0015	FRT	40	11	\N	t	550.00	0.00	900.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2604	BRPA-NUPR-0016	\N	40	11	\N	t	550.00	0.00	900.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2605	BRPA-NUPR-0017	\N	40	11	\N	t	660.00	0.00	1100.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2606	BRPA-NUPR-0018	FRT	40	11	\N	t	680.00	0.00	1100.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2607	COBE-BAND-0050	\N	46	178	\N	t	716.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2608	COBE-BAND-0051	\N	46	178	\N	t	836.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2609	COBE-BAND-0052	\N	46	178	\N	t	938.00	0.00	1300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2610	COBE-BAND-0053	\N	46	178	\N	t	645.00	0.00	1550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2611	COBE-BAND-0054	\N	46	178	\N	t	1074.00	0.00	1650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2612	COBE-BAND-0055	\N	46	178	\N	t	1091.00	0.00	1750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2613	COBE-BAND-0056	\N	46	178	\N	t	1108.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2614	COBE-BAND-0057	\N	46	178	\N	t	216.00	0.00	380.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2615	SABU-NUPR-0002	\N	40	65	\N	t	400.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2616	STLI-JAGX-0001	FRT-RH	38	296	\N	t	580.00	0.00	1015.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2617	STLI-JAGX-0002	FRT-LH	38	296	\N	t	580.00	0.00	1015.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2618	STLI-JAGX-0003	IMPTD FRT-R	38	296	\N	t	650.00	0.00	1140.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2619	STLI-JAGX-0004	IMPTD FRT-R	38	296	\N	t	650.00	0.00	1140.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2620	STLI-JAGX-0005	FRT-R	38	296	\N	t	550.00	0.00	965.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2621	STLI-JAGX-0006	FRT-L	38	296	\N	t	550.00	0.00	965.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2622	STLI-JAGX-0007	UP FRT-RH	38	296	\N	t	580.00	0.00	1015.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2623	STLI-JAGX-0008	UP FRT-L	38	296	\N	t	580.00	0.00	1015.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2624	STLI-JAGX-0009	FRT-LH	38	296	\N	t	580.00	0.00	1015.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2625	STLI-JAGX-0010	FRT-RH	38	296	\N	t	580.00	0.00	1015.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2626	STLI-JAGX-0011	UPPER	38	296	\N	t	580.00	0.00	1015.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2627	STLI-JAGX-0012	FRT	38	296	\N	t	580.00	0.00	580.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2628	STLI-JAGX-0013	FRT-R	38	296	\N	t	650.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2629	STLI-JAGX-0014	FRT-L	38	296	\N	t	650.00	0.00	1140.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2630	ENMO-JAGX-0030	\N	38	45	\N	t	350.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2631	RODI-POWE-0009	288MM	98	176	\N	t	1700.00	0.00	2800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2632	RODI-POWE-0010	RR	98	176	\N	t	2060.00	0.00	3350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2633	RODI-POWE-0011	\N	98	176	\N	t	1815.00	0.00	2950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2634	RODI-POWE-0012	257MM	98	176	\N	t	1280.00	0.00	2080.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2635	RODI-POWE-0013	FRT	98	176	\N	t	1360.00	0.00	2200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2636	SABU-OPT1-0018	LOWER	47	65	\N	t	310.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2637	AXBO-OPEX-0001	INNER|OUTER	177	266	\N	t	150.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2638	AXBO-OPEX-0002	OUTER	177	266	\N	t	150.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2639	AXBO-OPEX-0003	OUTER	177	266	\N	t	150.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2640	AXBO-OPEX-0004	OUTER	177	266	\N	t	170.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2641	HEGA-SPOR-0004	CRBON	50	64	\N	t	530.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2642	CLFA-SHIM-0001	\N	178	297	\N	t	1400.00	0.00	2500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2643	BAJO-555X-0006	\N	166	240	\N	t	835.00	0.00	1350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2644	BAJO-555X-0007	\N	166	240	\N	t	860.00	0.00	1390.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2645	BAJO-555X-0008	\N	166	240	\N	t	1090.00	0.00	1780.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2646	BAJO-555X-0009	\N	166	240	\N	t	790.00	0.00	1280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2647	BAJO-555X-0010	\N	166	240	\N	t	1090.00	0.00	1780.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2648	BAJO-555X-0011	\N	166	240	\N	t	1090.00	0.00	1780.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2649	BAJO-555X-0012	\N	166	240	\N	t	860.00	0.00	1390.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2650	BAJO-555X-0013	\N	166	240	\N	t	970.00	0.00	1580.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2651	BAJO-555X-0014	\N	166	240	\N	t	670.00	0.00	1080.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2652	AIFI-FLEE-0069	\N	6	6	\N	t	445.00	0.00	780.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2653	FLRE-OEMX-0001	12V, 10T	105	80	\N	t	750.00	0.00	1280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2654	MANU-HTCX-0003	\N	43	224	\N	t	95.00	0.00	170.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2655	TUPA-KWIK-0002	\N	72	128	\N	t	10.00	0.00	25.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2656	BEAR-KOYO-0050	\N	11	9	\N	t	939.00	0.00	1650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2657	BEAR-KOYO-0051	\N	11	9	\N	t	825.00	0.00	1450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2658	BEAR-KOYO-0052	\N	11	9	\N	t	939.00	0.00	1650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2659	BEAR-KOYO-0053	\N	11	9	\N	t	825.00	0.00	1450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2660	VASE-YSMW-0002	\N	58	33	\N	t	25.00	0.00	55.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2661	VASE-YSMW-0003	\N	58	33	\N	t	25.00	0.00	55.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2662	WHCY-REDL-0011	\N	130	34	\N	t	400.00	0.00	680.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2663	WHCY-REDL-0012	\N	130	34	\N	t	400.00	0.00	680.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2664	WHCY-REDL-0013	\N	130	34	\N	t	500.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2665	WHCY-REDL-0014	\N	130	34	\N	t	500.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2666	WHCY-REDL-0015	\N	130	34	\N	t	500.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2667	WHCY-REDL-0016	3/8"	130	34	\N	t	620.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2668	WHCY-REDL-0017	3/8"	130	34	\N	t	620.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2669	WHCY-REDL-0018	1/8"	130	34	\N	t	500.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2670	WHCY-REDL-0019	1/8"	130	34	\N	t	500.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2671	WHCY-REDL-0020	1/8"	130	34	\N	t	500.00	0.00	880.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2672	CLOP-REDL-0002	11/16"	130	43	\N	t	380.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2673	CLOP-REDL-0003	11/16"	130	43	\N	t	320.00	0.00	580.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2674	CRPU-REDL-0001	\N	130	298	\N	t	1800.00	0.00	3100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2675	BMKI-REDL-0002	\N	130	98	\N	t	3300.00	0.00	5650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2676	CMKI-REDL-0002	5/8	130	31	\N	t	700.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2677	CAKI-REDL-0001	43.0MM	130	184	\N	t	170.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2678	CAKI-REDL-0002	61.0MM	130	184	\N	t	135.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2679	CAKI-REDL-0003	54.0MM	130	184	\N	t	90.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2680	CEBO-NOBR-0003	14*220; FRT W/NUT	4	195	\N	t	204.00	0.00	360.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2681	BRHO-MIYA-0001	TD	59	156	\N	t	504.00	0.00	880.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2682	BRHO-MIYA-0002	\N	59	156	\N	t	942.00	0.00	1750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2683	BRHO-MIYA-0003	\N	59	156	\N	t	457.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2684	BRHO-MIYA-0004	\N	59	156	\N	t	512.00	0.00	900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2685	BRHO-MIYA-0005	\N	59	156	\N	t	806.00	0.00	1400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2686	ROAR-NOBR-0001	\N	4	87	\N	t	525.00	0.00	800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2687	ROAR-NOBR-0002	\N	4	87	\N	t	539.00	0.00	890.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2688	OIFI-MICR-0003	\N	140	38	\N	t	953.00	0.00	1350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2689	OIFI-MICR-0004	\N	140	38	\N	t	1730.00	0.00	2450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2690	OIFI-MICR-0005	\N	140	38	\N	t	1291.00	0.00	1900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2691	OIFI-MICR-0006	\N	140	38	\N	t	300.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2692	OIFI-MICR-0007	\N	140	38	\N	t	497.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2693	ESCA-TSKX-0001	\N	179	140	\N	t	609.00	0.00	900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2694	HABU-NARV-0001	100W	180	299	\N	t	94.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2695	HABU-NARV-0002	55W	180	299	\N	t	209.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2696	HABU-NARV-0003	70W	180	299	\N	t	512.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2697	OPGA-NOBR-0002	\N	4	102	\N	t	700.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2698	OPGA-NOBR-0003	\N	4	102	\N	t	650.00	0.00	1150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2699	OPGA-NOBR-0004	\N	4	102	\N	t	428.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2700	OPGA-NOBR-0005	\N	4	102	\N	t	520.00	0.00	900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2701	BAJO-NOBR-0004	\N	4	240	\N	t	1650.00	0.00	2800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2702	BAJO-NOBR-0005	\N	4	240	\N	t	900.00	0.00	1550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2703	BAJO-NOBR-0006	\N	4	240	\N	t	740.00	0.00	1280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2704	SABU-NOBR-0004	\N	4	65	\N	t	350.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2705	WAPU-NOBR-0001	\N	4	121	\N	t	2600.00	0.00	4450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2706	WAPU-NOBR-0002	\N	4	121	\N	t	3750.00	0.00	6400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2707	WAPU-NOBR-0003	\N	4	121	\N	t	8900.00	0.00	15200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2708	WAPU-NOBR-0004	\N	4	121	\N	t	11000.00	0.00	18700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2709	BEAR-NOBR-0004	\N	4	9	\N	t	750.00	0.00	1280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2710	BMKI-NOBR-0002	\N	4	98	\N	t	3400.00	0.00	5800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2711	BMKI-NOBR-0003	\N	4	98	\N	t	3350.00	0.00	5750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2712	BMKI-NOBR-0004	\N	4	98	\N	t	4000.00	0.00	6800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2713	BMKI-NOBR-0005	\N	4	98	\N	t	4050.00	0.00	6900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2714	BMKI-NOBR-0006	\N	4	98	\N	t	2600.00	0.00	4450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2715	CMKI-NOBR-0002	\N	4	31	\N	t	950.00	0.00	1650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2716	CLSL-NOBR-0001	\N	4	99	\N	t	650.00	0.00	1150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2717	CLSL-NOBR-0002	\N	4	99	\N	t	520.00	0.00	900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2718	FUFI-NOBR-0004	\N	4	19	\N	t	310.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2719	OIFI-NOBR-0001	\N	4	38	\N	t	1080.00	0.00	1800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2720	OIFI-NOBR-0002	BY PASS	4	38	\N	t	1100.00	0.00	1870.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2721	OIFI-NOBR-0003	BY PASS	4	38	\N	t	720.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2722	OIFI-NOBR-0004	BY PASS	4	38	\N	t	800.00	0.00	1380.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2723	BREX-XHYX-0001	\N	181	300	\N	t	2136.00	0.00	3740.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2724	HYCY-JKCX-0001	\N	182	301	\N	t	1093.00	0.00	1915.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2725	SABU-SAMY-0001	\N	183	65	\N	t	1425.00	0.00	2250.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2726	WHBE-KORE-0001	\N	16	97	\N	t	690.00	0.00	1200.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2727	STB2-JAGX-0001	\N	38	302	\N	t	9.00	0.00	25.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2728	ENMO-NUPR-0001	\N	40	45	\N	t	350.00	0.00	590.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2729	SBBU-NUPR-0001	\N	40	222	\N	t	50.00	0.00	90.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2730	STB2-NUPR-0001	\N	40	302	\N	t	45.00	0.00	95.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2731	RRTA-KORE-0001	\N	16	303	\N	t	665.00	0.00	1250.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2732	RRTA-KORE-0002	\N	16	303	\N	t	1535.00	0.00	2500.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2733	TIBE-SUNX-0002	\N	133	14	\N	t	760.00	0.00	1500.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2734	TIBE-SUNX-0003	\N	133	14	\N	t	470.00	0.00	850.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2735	TIBE-SUNX-0004	\N	133	14	\N	t	945.00	0.00	1700.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2736	TIBE-MONX-0001	\N	184	14	\N	t	2500.00	0.00	4250.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2737	OISE-NOKX-0225	46*102*10/16	2	1	\N	t	170.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2738	OISE-NOKX-0226	80*98*10	2	1	\N	t	300.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2739	VASE-NOKX-0004	\N	2	33	\N	t	12.00	0.00	280.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2740	VASE-NOKX-0005	\N	2	33	\N	t	12.00	0.00	280.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2741	BEAR-KOJA-0001	\N	185	9	\N	t	325.00	0.00	580.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2742	BEAR-KOJA-0002	\N	185	9	\N	t	220.00	0.00	395.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2743	ACCA-ORIO-0002	\N	24	18	\N	t	110.00	0.00	195.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2744	TUBE-NOBR-0002	\N	4	304	\N	t	908.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2745	BAJO-GMBX-0001	\N	52	240	\N	t	379.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2746	BAJO-GMBX-0002	\N	52	240	\N	t	548.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2747	BAJO-GMBX-0003	\N	52	240	\N	t	548.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2748	BAJO-GMBX-0004	\N	52	240	\N	t	248.00	0.00	480.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2749	UJOI-GMBX-0026	\N	52	20	\N	t	758.00	0.00	1400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2750	UJOI-GMBX-0027	\N	52	20	\N	t	495.00	0.00	890.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2751	UJOI-GMBX-0028	\N	52	20	\N	t	589.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2752	UJOI-GMBX-0029	\N	52	20	\N	t	499.00	0.00	890.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2753	ALBR-OCCX-0001	\N	186	305	\N	t	21.00	0.00	35.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2754	ALBR-OCCX-0002	\N	186	305	\N	t	24.00	0.00	40.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2755	GLPL-ITOK-0004	\N	144	37	\N	t	71.00	0.00	125.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2756	GLPL-ITOK-0005	\N	144	37	\N	t	68.00	0.00	120.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2757	STBU-OCCX-0001	\N	186	237	\N	t	135.00	0.00	235.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2758	STBU-OCCX-0002	\N	186	237	\N	t	221.00	0.00	385.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2759	STBU-OCCX-0003	\N	186	237	\N	t	206.00	0.00	360.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2760	STBU-OCCX-0004	\N	186	237	\N	t	165.00	0.00	290.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2761	STBU-OCCX-0005	\N	186	237	\N	t	131.00	0.00	230.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2762	HOCL-GENE-0001	GALVANIZED	187	225	\N	t	4.00	0.00	10.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2763	HOCL-GENE-0002	GALVANIZED	187	225	\N	t	6.00	0.00	15.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2764	HOCL-GENE-0003	GALVANIZED	187	225	\N	t	4.00	0.00	10.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2765	HOCL-GENE-0004	GALVANIZED	187	225	\N	t	4.00	0.00	15.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2766	HOCL-GENE-0005	GALVANIZED	187	225	\N	t	4.00	0.00	10.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2767	HOCL-GENE-0006	GALVANIZED	187	225	\N	t	7.00	0.00	20.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2768	HOCL-GENE-0007	GALVANIZED	187	225	\N	t	4.00	0.00	15.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2769	HUBO-GENE-0001	\N	187	306	\N	t	11.00	0.00	40.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2771	UJOI-GMBX-0030	\N	52	20	\N	t	300.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2772	BEAR-NSKX-0019	\N	31	9	\N	t	460.00	0.00	1400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2773	BEAR-NSKX-0020	\N	31	9	\N	t	373.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2774	BEAR-NSKX-0021	\N	31	9	\N	t	692.00	0.00	1950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2775	PIRI-TPXX-0003	\N	113	201	\N	t	1400.00	0.00	1960.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2776	PIRI-TPXX-0004	\N	113	201	\N	t	9990.00	0.00	15700.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2777	PIRI-TPXX-0005	\N	113	201	\N	t	7365.00	0.00	10300.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2778	ACCA-NOBR-0003	\N	4	18	\N	t	98.00	0.00	190.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2779	BMKI-WAGN-0001	\N	188	98	\N	t	120.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2780	FLNU-NOBR-0001	10*3	4	307	\N	t	10.00	0.00	25.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2782	FLNU-NOBR-0003	10*6	4	307	\N	t	43.00	0.00	80.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2783	FLNU-NOBR-0004	10*8	4	307	\N	t	60.00	0.00	105.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2784	SILA-NOBR-0001	\N	4	67	\N	t	94.00	0.00	170.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2785	SILA-NOBR-0002	\N	4	67	\N	t	130.00	0.00	230.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2786	CLDI-DKXX-0002	CHINA	66	27	\N	t	2440.00	0.00	4300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2787	CLDI-DKXX-0003	CHINA	66	27	\N	t	860.00	0.00	1600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2788	CRB1-CCBX-0001	\N	189	92	\N	t	300.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2789	OISE-TAKX-0001	65*90*13TB	190	1	\N	t	69.00	0.00	130.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2790	OISE-TAKX-0002	35*65*12TB	190	1	\N	t	60.00	0.00	120.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2791	OISE-TAKX-0003	120*140*10.5	190	1	\N	t	189.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2792	ACCA-NOBR-0004	\N	4	18	\N	t	125.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2793	SEBE-NOBR-0001	\N	4	308	\N	t	195.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2794	CLDI-MENS-0001	\N	191	27	\N	t	3015.00	0.00	4800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2795	CLDI-MENS-0002	\N	191	27	\N	t	3375.00	0.00	5300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2796	CLDI-MENS-0003	\N	191	27	\N	t	850.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2797	CLDI-MENS-0004	\N	191	27	\N	t	1115.00	0.00	1950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2798	CLDI-MENS-0005	\N	191	27	\N	t	2150.00	0.00	3400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2799	CLDI-MENS-0006	\N	191	27	\N	t	4390.00	0.00	6900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2800	CLDI-MENS-0007	\N	191	27	\N	t	3375.00	0.00	5400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2801	CLDI-MENS-0008	\N	191	27	\N	t	3375.00	0.00	5400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2802	CLCO-MENS-0001	\N	191	28	\N	t	5882.00	0.00	9300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2803	CLCO-MENS-0002	\N	191	28	\N	t	4750.00	0.00	7500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2804	CLCO-MENS-0003	\N	191	28	\N	t	5250.00	0.00	8800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2805	CLCO-MENS-0004	\N	191	28	\N	t	5610.00	0.00	8900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2806	BRBO-NOBR-0001	\N	4	100	\N	t	1860.00	0.00	3000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2807	BRBO-NOBR-0002	\N	4	100	\N	t	2650.00	0.00	4200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2808	CLDI-MENS-0009	\N	191	27	\N	t	860.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2809	CLDI-MENS-0010	\N	191	27	\N	t	1760.00	0.00	2900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2810	CLDI-MENS-0011	\N	191	27	\N	t	1463.00	0.00	2500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2811	CLDI-MENS-0012	\N	191	27	\N	t	2350.00	0.00	4000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2812	CLDI-MENS-0013	\N	191	27	\N	t	2150.00	0.00	3400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2813	CLDI-MENS-0014	\N	191	27	\N	t	2890.00	0.00	4600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2814	FVKI-KNOR-0001	\N	192	309	\N	t	750.00	0.00	1300.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2815	FVKI-KNOR-0002	\N	192	309	\N	t	750.00	0.00	1300.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2816	FVKI-KNOR-0003	\N	192	309	\N	t	800.00	0.00	1400.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2817	FVKI-KNOR-0004	\N	192	309	\N	t	750.00	0.00	1300.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2818	FVKI-KNOR-0005	\N	192	309	\N	t	800.00	0.00	1400.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2819	FVKI-KNOR-0006	\N	192	309	\N	t	840.00	0.00	1500.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2820	CBKI-KNOR-0001	\N	192	310	\N	t	820.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2821	CBKI-KNOR-0002	\N	192	310	\N	t	900.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2822	CBKI-KNOR-0003	\N	192	310	\N	t	900.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2823	CBKI-KNOR-0004	\N	192	310	\N	t	900.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2824	CBKI-KNOR-0005	\N	192	310	\N	t	950.00	0.00	1600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2825	BEAR-KOYO-0054	\N	11	9	\N	t	325.00	0.00	580.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2826	BEAR-KOYO-0055	\N	11	9	\N	t	350.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2827	BEAR-KOYO-0056	\N	11	9	\N	t	880.00	0.00	1570.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2770	BAJO-GMBX-0005-merged-2746	\N	52	240	\N	f	548.00	0.00	100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	2025-09-12 14:10:45.468791+00	\N	2746
2828	BEAR-KOYO-0057	\N	11	9	\N	t	1100.00	0.00	1950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2829	BEAR-KOYO-0058	\N	11	9	\N	t	1800.00	0.00	2500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2830	BEAR-KOYO-0059	\N	11	9	\N	t	1050.00	0.00	1950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2831	OISE-NOKX-0227	70*135*14/18	2	1	\N	t	350.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2832	OISE-NOKX-0228	130*130*14	2	1	\N	t	250.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2833	OISE-NOKX-0229	55*78*12	2	1	\N	t	100.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2834	OISE-NOKX-0230	45*68*12	2	1	\N	t	90.00	0.00	170.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2835	OISE-NOKX-0231	32*47*6	2	1	\N	t	75.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2836	CLDI-EXDA-0001	\N	193	27	\N	t	1980.00	0.00	3000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2837	BATT-DYPO-0002	\N	149	127	\N	t	3226.00	0.00	3500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2838	BATT-DYPO-0003	\N	149	127	\N	t	2525.00	0.00	2900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2839	BATT-DYPO-0004	\N	149	127	\N	t	6240.00	0.00	7000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2840	SABU-ORIO-0005	NEW MODEL, 10MM	24	65	\N	t	895.00	0.00	1600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2841	SABU-ORIO-0006	NEW MODEL, 10MM	24	65	\N	t	895.00	0.00	1600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2842	GREA-AUTO-0001	HI-TEMP 500G, BLUE	194	13	\N	t	200.00	0.00	300.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2843	RODI-NOBR-0001	\N	4	176	\N	t	2400.00	0.00	4200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2844	ENOI-MOBI-0001	SPECIAL 1L	195	82	\N	t	238.00	0.00	260.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2845	HEGA-NOBR-0006	\N	4	64	\N	t	3550.00	0.00	6300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2846	RUCU-NOBR-0001	\N	4	12	\N	t	80.00	0.00	140.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2847	RUCU-NOBR-0002	\N	4	12	\N	t	63.00	0.00	120.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2848	TRLI-NOBR-0001	8*8 RH	4	311	\N	t	120.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2849	TRLI-NOBR-0002	10*10 RH	4	311	\N	t	120.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2850	ENVA-NOBR-0001	\N	4	181	\N	t	850.00	0.00	1500.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2851	TEBE-GMBX-0001	\N	52	66	\N	t	520.00	0.00	890.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2852	FTCA-CIRC-0001	78MM W/KEY	26	312	\N	t	300.00	0.00	560.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2853	OIFI-VICX-0039	\N	94	38	\N	t	1323.00	0.00	1780.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2854	HABU-HELL-0001	\N	196	299	\N	t	112.00	0.00	190.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2855	OIFI-VICX-0040	\N	94	38	\N	t	664.00	0.00	890.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2856	OVGA-FEDE-0001	\N	103	68	\N	t	670.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2857	ENSU-FUJI-0001	\N	34	35	\N	t	1325.00	0.00	1860.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2858	ACHO-NIHO-0007	2 1/2*2*14	69	126	\N	t	324.00	0.00	470.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2859	CEBE-BEIX-0001	\N	25	215	\N	t	850.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2860	TRSU-BEIX-0002	\N	25	36	\N	t	690.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2861	VASE-NOKX-0006	\N	2	33	\N	t	12.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2862	SHAB-TITA-0001	\N	197	41	\N	t	1575.00	0.00	2150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2863	SHAB-TITA-0002	\N	197	41	\N	t	1575.00	0.00	2150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2864	BEAR-KOYO-0060	\N	11	9	\N	t	1322.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2865	WAPU-MOHA-0001	\N	13	121	\N	t	1850.00	0.00	2500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2866	BEAR-KOJA-0003	\N	185	9	\N	t	2365.00	0.00	2100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2867	UJOI-SEAL-0009	\N	30	20	\N	t	195.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2868	BRPA-NBKX-0013	\N	20	11	\N	t	310.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2869	FUFI-NBKX-0001	\N	20	19	\N	t	130.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2870	CRBE-DAID-0012	\N	21	46	\N	t	980.00	0.00	1715.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2871	CRBE-DAID-0013	\N	21	46	\N	t	980.00	0.00	1715.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2872	CRBE-DAID-0014	\N	21	46	\N	t	1000.00	0.00	1750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2873	CRBE-DAID-0015	\N	21	46	\N	t	550.00	0.00	965.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2874	MABE-DAID-0007	\N	21	48	\N	t	600.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2875	MABE-DAID-0008	\N	21	48	\N	t	650.00	0.00	1150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2876	MABE-DAID-0009	\N	21	48	\N	t	685.00	0.00	1250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2877	MABE-DAID-0010	\N	21	48	\N	t	765.00	0.00	1400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2878	MABE-TAIH-0001	\N	104	48	\N	t	453.00	0.00	780.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2879	MABE-TAIH-0002	\N	104	48	\N	t	490.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2880	MABE-TAIH-0003	\N	104	48	\N	t	525.00	0.00	900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2881	MABE-TAIH-0004	\N	104	48	\N	t	620.00	0.00	1050.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2882	MABE-DAID-0011	\N	21	48	\N	t	1450.00	0.00	2450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2883	MABE-DAID-0012	\N	21	48	\N	t	1480.00	0.00	2500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2884	MABE-DAID-0013	\N	21	48	\N	t	1525.00	0.00	2600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2885	CRBE-TAIH-0006	\N	104	46	\N	t	270.00	0.00	475.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2886	CRBE-TAIH-0007	\N	104	46	\N	t	320.00	0.00	560.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2887	OPGA-NOBR-0006	\N	4	102	\N	t	150.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2888	VCGA-NOBR-0001	\N	4	85	\N	t	145.00	0.00	280.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2889	CSCY-NOBR-0001	\N	4	91	\N	t	2800.00	0.00	4780.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2890	OIFI-VICX-0041	\N	94	38	\N	t	263.00	0.00	480.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2891	OIFI-VICX-0042	\N	94	38	\N	t	227.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2892	OIFI-VICX-0043	\N	94	38	\N	t	257.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2893	OIFI-VICX-0044	\N	94	38	\N	t	222.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2894	LESP-TIGE-0001	GIGA	198	267	\N	t	3808.00	0.00	6700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2895	LESP-TIGE-0002	\N	198	267	\N	t	3084.00	0.00	5500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2896	LESP-TIGE-0003	\N	198	267	\N	t	2901.00	0.00	5200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2897	LESP-TIGE-0004	\N	198	267	\N	t	3000.00	0.00	5300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2898	LESP-TIGE-0005	\N	198	267	\N	t	2783.00	0.00	4900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2899	LESP-TIGE-0006	\N	198	267	\N	t	2739.00	0.00	4900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2900	CLDI-DKXX-0004	\N	66	27	\N	t	2600.00	0.00	3600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2901	LIGA-THBO-0001	\N	199	313	\N	t	90.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2902	LIGA-THBO-0002	\N	199	313	\N	t	40.00	0.00	70.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2903	CLCO-AISI-0007	\N	62	28	\N	t	2006.00	0.00	2150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2904	CLCO-AISI-0008	\N	62	28	\N	t	2685.00	0.00	4700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2905	CLCO-AISI-0009	\N	62	28	\N	t	3394.00	0.00	6000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2906	UJOI-GMBX-0031	\N	52	20	\N	t	589.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2907	UJOI-GMBX-0032	\N	52	20	\N	t	345.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2908	UJOI-GMBX-0033	\N	52	20	\N	t	1440.00	0.00	2500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2909	FUFI-VICX-0006	\N	94	19	\N	t	170.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2910	CLOP-REDL-0004	\N	130	43	\N	t	450.00	0.00	800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2911	SPPL-BOSC-0007	\N	93	172	\N	t	255.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2912	HORN-BOSC-0002	12V	93	204	\N	t	145.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2913	ACCA-NUPR-0001	\N	40	18	\N	t	400.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2914	BAJO-555X-0015	\N	166	240	\N	t	825.00	0.00	1400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2915	BAJO-555X-0016	\N	166	240	\N	t	1045.00	0.00	1750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2916	BAJO-555X-0017	\N	166	240	\N	t	915.00	0.00	1550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2917	RAEN-555X-0001	\N	166	314	\N	t	925.00	0.00	1550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2918	RAEN-555X-0002	\N	166	314	\N	t	735.00	0.00	1250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2919	RAEN-555X-0003	\N	166	314	\N	t	835.00	0.00	1450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2920	SABU-OPT1-0019	\N	47	65	\N	t	345.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2921	SABU-OPT1-0020	\N	47	65	\N	t	310.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2922	BAJO-555X-0018	\N	166	240	\N	t	1425.00	0.00	2350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2923	RAEN-555X-0004	\N	166	314	\N	t	780.00	0.00	1300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2924	RAEN-555X-0005	\N	166	314	\N	t	780.00	0.00	1350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2925	RAEN-555X-0006	\N	166	314	\N	t	780.00	0.00	1300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2926	TREN-555X-0003	\N	166	4	\N	t	1700.00	0.00	2800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2927	TREN-555X-0004	\N	166	4	\N	t	1035.00	0.00	1700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2928	STLI-555X-0001	FRT-L	166	296	\N	t	835.00	0.00	1400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2929	STLI-555X-0002	FRT-R	166	296	\N	t	835.00	0.00	1400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2930	STLI-555X-0003	FRT-LH	166	296	\N	t	590.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2931	STLI-555X-0004	FRT-RH	166	296	\N	t	590.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2932	TREN-555X-0005	\N	166	4	\N	t	635.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2933	TREN-555X-0006	\N	166	4	\N	t	1200.00	0.00	1800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2934	RAEN-555X-0007	\N	166	314	\N	t	1100.00	0.00	1800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2935	BRPA-NUPR-0019	FRT	40	11	\N	t	900.00	0.00	1400.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2936	BRPA-NUPR-0020	FRT	40	11	\N	t	900.00	0.00	1400.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2937	BRPA-NUPR-0021	RR	40	11	\N	t	720.00	0.00	1200.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2938	BRPA-NUPR-0022	FRT	40	11	\N	t	1150.00	0.00	1800.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2939	BRPA-NUPR-0023	FRT	40	11	\N	t	1300.00	0.00	2000.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2940	BRPA-NUPR-0024	FRT/RR	40	11	\N	t	1700.00	0.00	2650.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2941	BRSH-NUPR-0006	RR	40	55	\N	t	680.00	0.00	1100.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2942	BRSH-NUPR-0007	\N	40	55	\N	t	500.00	0.00	780.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2943	CRAN-ORIO-0001	\N	24	315	\N	t	2250.00	0.00	3850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2944	FUPU-NOBR-0001	\N	4	217	\N	t	500.00	0.00	900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2945	MANU-MARK-0001	\N	200	224	\N	t	22.00	0.00	50.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2946	MANU-MARK-0002	\N	200	224	\N	t	22.00	0.00	50.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2947	CLCA-GSKX-0001	\N	44	188	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2948	MIGA-PION-0001	\N	201	316	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2949	HEGA-FEMO-0010	CARBON TYPE	45	64	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2950	ENOI-CALT-0005	SPECIAL 1L	161	82	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2951	BRFL-PRE1-0002	400ML	139	236	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2952	GREA-CALT-0002	2KG	161	13	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2953	GREA-CALT-0003	2KG	161	13	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2954	GREA-CALT-0004	2KG MARHAK	161	13	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2955	ENOI-CALT-0006	DIESEL 1L	161	82	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2956	OIFI-VICX-0045	\N	94	38	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2957	PRPL-AISI-0001	\N	62	265	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2958	GEOI-PETR-0004	GEP 140 1GAL	156	253	\N	t	\N	0.00	750.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2959	GEOI-PETR-0005	GEP 90 1GAL	156	253	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2960	AXBO-OPEX-0005	\N	177	266	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2961	CLDI-EXED-0017	\N	19	27	\N	t	3150.00	0.00	6500.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2962	CLDI-EXED-0018	\N	19	27	\N	t	2600.00	0.00	3700.00	\N	\N	1	t	2	PC	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2963	CLDI-EXED-0019	14x10T	19	27	\N	t	3600.00	0.00	6400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2964	CLDI-EXED-0020	\N	19	27	\N	t	850.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2965	RODI-BEND-0003	11 3/4"	97	176	\N	t	2500.00	0.00	3900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2966	RODI-BEND-0004	\N	97	176	\N	t	2190.00	0.00	3800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2967	RODI-BEND-0005	\N	97	176	\N	t	1520.00	0.00	1900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2968	RODI-BEND-0006	\N	97	176	\N	t	2420.00	0.00	4200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2969	CLCO-NOBR-0004	12"	4	28	\N	t	5200.00	0.00	6800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2970	CLCO-NOBR-0005	12"	4	28	\N	t	5200.00	0.00	6800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2971	BREX-XHYX-0002	\N	181	300	\N	t	690.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2972	CLCO-MENS-0005	\N	191	28	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2973	CLCO-MENS-0006	\N	191	28	\N	t	4750.00	0.00	7500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2974	CLCO-MENS-0007	\N	191	28	\N	t	6500.00	0.00	8600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2975	CLCO-EXED-0003	\N	19	28	\N	t	4300.00	0.00	7400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2976	CLCO-AISI-0010	\N	62	28	\N	t	3394.00	0.00	6000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2977	FUPU-KYOT-0002	\N	134	217	\N	t	470.00	0.00	800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2978	CLBO-MOHA-0010	90MM	13	152	\N	t	1600.00	0.00	2200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2979	OIFI-HYUN-0002	BLUE BOX PACKAGING	117	38	\N	t	260.00	0.00	445.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2980	CLOP-MIKA-0005	3/4"	23	43	\N	t	420.00	0.00	710.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2981	BMKI-KIAX-0001	\N	202	98	\N	t	1750.00	0.00	2975.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2982	BMKI-YAQI-0001	\N	203	98	\N	t	485.00	0.00	2600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2983	RODI-POWE-0014	\N	98	176	\N	t	3160.00	0.00	5200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2984	RODI-POWE-0015	\N	98	176	\N	t	1260.00	0.00	2200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2985	RODI-POWE-0016	\N	98	176	\N	t	1815.00	0.00	2950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2986	RODI-POWE-0017	6H	98	176	\N	t	1280.00	0.00	2080.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2987	RODI-POWE-0018	4H	98	176	\N	t	1360.00	0.00	2200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2988	RODI-POWE-0019	5H	98	176	\N	t	1700.00	0.00	2800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2989	RODI-POWE-0020	5H	98	176	\N	t	2060.00	0.00	3600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2990	RODI-POWE-0021	REAR	98	176	\N	t	2060.00	0.00	3350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2991	RODI-POWE-0022	6H	98	176	\N	t	1835.00	0.00	3200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2992	RODI-POWE-0023	6H	98	176	\N	t	1290.00	0.00	2300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2993	RODI-PHCX-0001	\N	204	176	\N	t	2400.00	0.00	4200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2994	CLDI-MENS-0015	14T*12-3/4"	191	27	\N	t	2150.00	0.00	3400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2995	CLDI-MENS-0016	14T*13-3/4"	191	27	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2996	CLDI-MENS-0017	10T*15"	191	27	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2997	CLDI-MENS-0018	14T*15"	191	27	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2998	CLDI-MENS-0019	10T*15"	191	27	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2999	SABU-TOPA-0001	LH	63	65	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3000	SABU-KIAX-0001	RH	202	65	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3001	SABU-TOPA-0002	\N	63	65	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3002	ENSU-MITS-0001	\N	116	35	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3003	CYLI-IZUM-0002	107	81	111	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3004	CYLI-IZUM-0003	103	81	111	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3005	CYLI-IZUM-0004	103	81	111	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3006	CYLI-IZUM-0005	94	81	111	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3007	CYLI-IZUM-0006	91.1	81	111	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3008	CYLI-IZUM-0007	105	81	111	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3009	CYLI-IZUM-0008	102	81	111	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3010	BRSH-GTRX-0001	\N	118	55	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3011	BRSH-NBKX-0006	REAR	20	55	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3012	BRSH-NBKX-0007	REAR	20	55	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3013	BRSH-BEND-0006	BS-1726 REAR	97	55	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3014	BRSH-NUPR-0008	REAR	40	55	\N	t	\N	0.00	\N	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3015	BRSH-NUPR-0009	REAR	40	55	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3016	BRSH-NUPR-0010	\N	40	55	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3017	CYLI-MAHL-0001	108	205	111	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3018	BRBO-AIRT-0001	\N	170	100	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3019	ACHO-NIHO-0008	5*6*18	69	126	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3020	GAPA-MAPR-0001	\N	206	317	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3021	ENOI-CALT-0007	SAE	161	82	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3022	OITR-TOP1-0001	\N	15	318	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3023	BRFL-SUBR-0002	\N	141	236	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3024	BRFL-SUBR-0003	\N	141	236	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3026	ATFX-PETR-0001	PREMIUM	156	319	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3027	GEOI-PETR-0006	\N	156	253	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3028	COOL-VALV-0001	ALL WEATHER	207	122	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3029	ENSU-MITS-0002	\N	116	35	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3030	ENOI-CALT-0008	DELO GOLD	161	82	\N	t	230.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3031	ENOI-PETR-0003	REV-X	156	82	\N	t	170.00	0.00	200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3032	AIFI-FUJ2-0001	\N	208	6	\N	t	500.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3033	AIFI-FUJ2-0002	\N	208	6	\N	t	450.00	0.00	770.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3034	AIFI-FLEE-0070	\N	6	6	\N	t	1200.00	0.00	2100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3035	AIFI-OSAK-0001	\N	78	6	\N	t	3384.00	0.00	3455.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3036	AIFI-OSAK-0002	\N	78	6	\N	t	1973.00	0.00	2100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3037	AIFI-FLEE-0071	\N	6	6	\N	t	540.00	0.00	970.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3038	HELI-APEX-0001	RIGHT	209	320	\N	t	1700.00	0.00	2900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3039	HELI-APEX-0002	LEFT	209	320	\N	t	1700.00	0.00	2900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3040	BEAR-NTNX-0021	\N	33	9	\N	t	974.00	0.00	7000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3042	BEAR-NTNX-0023	\N	33	9	\N	t	375.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3043	BEAR-KOYO-0061	101*168	11	9	\N	t	3000.00	0.00	4300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3044	BEAR-NSKX-0022	\N	31	9	\N	t	1500.00	0.00	2550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3045	BEAR-KOYO-0062	\N	11	9	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3046	BEAR-NSKX-0023	\N	31	9	\N	t	530.00	0.00	2000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3047	BRLI-IBKX-0009	\N	77	131	\N	t	3209.00	0.00	4500.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3048	BRLI-IBKX-0010	720-110	77	131	\N	t	1014.00	0.00	1550.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3049	PIRI-TPXX-0006	STD	113	201	\N	t	1592.00	0.00	4800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3050	PIRI-TPXX-0007	STD	113	201	\N	t	2407.00	0.00	6800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3051	PIRI-TPXX-0008	STD	113	201	\N	t	1589.00	0.00	4400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3052	PIRI-TPXX-0009	STD	113	201	\N	t	1754.00	0.00	5000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3053	PIRI-TPXX-0010	STD	113	201	\N	t	2026.00	0.00	5800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3054	PIRI-TPXX-0011	\N	113	201	\N	t	1754.00	0.00	5000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3055	PIRI-TPXX-0012	STD	113	201	\N	t	1027.00	0.00	3000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3056	PIRI-TPXX-0013	STD	113	201	\N	t	1754.00	0.00	5000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3057	PIRI-TPXX-0014	STD	113	201	\N	t	1100.00	0.00	3300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3058	PIRI-TPXX-0015	STD	113	201	\N	t	990.00	0.00	2800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3059	PIRI-TPXX-0016	STD	113	201	\N	t	1062.00	0.00	3000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3060	PIRI-TPXX-0017	STD	113	201	\N	t	1027.00	0.00	3000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3061	RAHO-NISS-0006	NEW MODEL LOWER	70	123	\N	t	340.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3062	RAHO-NIHO-0045	LOWER	69	123	\N	t	672.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3063	RAHO-NIHO-0046	UPPER	69	123	\N	t	595.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3064	RAHO-NISS-0007	LOWER	70	123	\N	t	562.00	0.00	950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3065	RAHO-NISS-0008	LOWER	70	123	\N	t	697.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3066	RAHO-NIHO-0047	2-3/4 UPPER	69	123	\N	t	586.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3067	RAHO-NIHO-0048	SHORT UPPER	69	123	\N	t	714.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3068	RAHO-NISS-0009	UPPER	70	123	\N	t	484.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3069	RAHO-NISS-0010	UPPER	70	123	\N	t	344.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3070	RAHO-NIHO-0049	UPPER	69	123	\N	t	238.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3071	FOLA-NUVO-0001	LH	210	63	\N	t	1250.00	0.00	2125.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3072	FOLA-NUVO-0002	RH	210	63	\N	t	1250.00	0.00	2125.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3073	TALA-NUVO-0001	LH	210	179	\N	t	380.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3074	TALA-NUVO-0002	RH	210	179	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3075	COLA-NUVO-0001	LH	210	62	\N	t	260.00	0.00	445.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3076	COLA-NUVO-0002	RH	210	62	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3077	COLA-NUVO-0003	LH	210	62	\N	t	360.00	0.00	620.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3078	TALA-NUVO-0003	\N	210	179	\N	t	350.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3079	HLMO-NUVO-0001	LH	210	321	\N	t	500.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3080	HLMO-NUVO-0002	RH LOWER	210	321	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3081	HLMO-NUVO-0003	RH LOWER	210	321	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3082	FOLA-NUVO-0003	RH	210	63	\N	t	600.00	0.00	1050.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3083	HLMO-NUVO-0004	LH LOWER	210	321	\N	t	380.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3084	HLMO-NUVO-0005	RH	210	321	\N	t	500.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3085	TALA-NUVO-0004	LH	210	179	\N	t	420.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3086	TALA-NUVO-0005	RH	210	179	\N	t	420.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3087	FOLA-NUVO-0004	LH	210	63	\N	t	600.00	0.00	1050.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3088	FOLA-NUVO-0005	RH	210	63	\N	t	600.00	0.00	1050.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3089	FOLA-NUVO-0006	LH	210	63	\N	t	600.00	0.00	1050.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3090	FOLA-NUVO-0007	LH	210	63	\N	t	320.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3091	FOLA-NUVO-0008	RH	210	63	\N	t	320.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3092	COLA-NUVO-0004	LH	210	62	\N	t	230.00	0.00	395.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3093	COLA-NUVO-0005	RH	210	62	\N	t	230.00	0.00	395.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3094	COLA-JUST-0001	LH	211	62	\N	t	350.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3095	COLA-JUST-0002	RH	211	62	\N	t	350.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3096	SILA-TELA-0001	LH	212	67	\N	t	370.00	0.00	670.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3097	SILA-TELA-0002	RH	212	67	\N	t	370.00	0.00	670.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3098	COLA-APEX-0001	LH	209	62	\N	t	380.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3099	COLA-APEX-0002	RH	209	62	\N	t	380.00	0.00	750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3100	COLA-NUVO-0006	LH	210	62	\N	t	400.00	0.00	680.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3101	COLA-NUVO-0007	RH	210	62	\N	t	400.00	0.00	680.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3102	FOLA-NUVO-0009	\N	210	63	\N	t	240.00	0.00	410.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3103	SILA-NUVO-0001	LH	210	67	\N	t	330.00	0.00	565.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3104	SILA-NUVO-0002	LH	210	67	\N	t	330.00	0.00	565.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3105	SILA-NUVO-0003	RH	210	67	\N	t	330.00	0.00	565.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3106	SILA-NUVO-0004	LH	210	67	\N	t	330.00	0.00	565.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3107	SILA-NUVO-0005	RH	210	67	\N	t	330.00	0.00	565.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3108	TALA-LUCI-0001	LH	213	179	\N	t	360.00	0.00	620.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3109	BULA-NUVO-0001	LH	210	322	\N	t	220.00	0.00	375.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3110	BULA-NUVO-0002	RH	210	322	\N	t	220.00	0.00	375.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3111	BULA-NUVO-0003	RH	210	322	\N	t	\N	0.00	\N	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3112	COLA-NUVO-0008	LH	210	62	\N	t	140.00	0.00	240.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3113	COLA-NUVO-0009	RH	210	62	\N	t	140.00	0.00	240.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3114	PALA-NUVO-0001	LH	210	323	\N	t	140.00	0.00	240.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3115	PALA-NUVO-0002	RH	210	323	\N	t	140.00	0.00	240.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3116	SILA-NUVO-0006	LH	210	67	\N	t	180.00	0.00	310.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3117	COLA-NUVO-0010	LH	210	62	\N	t	240.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3118	COLA-NUVO-0011	RH	210	62	\N	t	240.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3119	COLA-NUVO-0012	LH	210	62	\N	t	300.00	0.00	520.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3120	COLA-NUVO-0013	RH	210	62	\N	t	300.00	0.00	520.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3121	ENMO-JAGX-0031	L/R	38	45	\N	t	470.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3122	ENMO-JAGX-0032	LH	38	45	\N	t	470.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3123	ENMO-JAGX-0033	RH	38	45	\N	t	470.00	0.00	850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3124	ENMO-JAGX-0034	LH	38	45	\N	t	1645.00	0.00	2900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3125	ENMO-JAGX-0035	RH	38	45	\N	t	1645.00	0.00	2900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3126	ENMO-JAGX-0036	\N	38	45	\N	t	500.00	0.00	880.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3127	ENMO-JAGX-0037	LH	38	45	\N	t	270.00	0.00	480.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3128	ENMO-JAGX-0038	RH	38	45	\N	t	270.00	0.00	480.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3129	ENMO-JAGX-0039	LH	38	45	\N	t	670.00	0.00	1180.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3130	ENMO-JAGX-0040	\N	38	45	\N	t	315.00	0.00	680.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3131	ENMO-JAGX-0041	L/R	38	45	\N	t	315.00	0.00	580.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3132	ENMO-JAGX-0042	\N	38	45	\N	t	670.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3133	ENMO-JAGX-0043	\N	38	45	\N	t	1500.00	0.00	2650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3134	ENMO-JAGX-0044	LH	38	45	\N	t	370.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3135	ENMO-JAGX-0045	RH	38	45	\N	t	370.00	0.00	650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3136	ENMO-JAGX-0046	\N	38	45	\N	t	560.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3137	CEBE-CTBX-0003	\N	125	215	\N	t	885.00	0.00	1130.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3138	CEBE-CTBX-0004	BIG	125	215	\N	t	515.00	0.00	710.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3139	CEBE-CTBX-0005	SMALL	125	215	\N	t	518.00	0.00	880.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3140	CEBE-CTBX-0006	\N	125	215	\N	t	635.00	0.00	955.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3141	CEBE-CTBX-0007	\N	125	215	\N	t	720.00	0.00	920.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3142	CEBE-CTBX-0008	\N	125	215	\N	t	670.00	0.00	1350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3143	CEBE-CTBX-0009	\N	125	215	\N	t	480.00	0.00	900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3144	CEBE-CTBX-0010	\N	125	215	\N	t	870.00	0.00	1600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3145	CEBE-CTBX-0011	\N	125	215	\N	t	570.00	0.00	855.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3146	BMKI-YAQI-0002	\N	203	98	\N	t	1750.00	0.00	2980.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3147	TREN-ORIO-0002	\N	24	4	\N	t	240.00	0.00	410.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3148	TREN-ORIO-0003	L/R	24	4	\N	t	850.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3149	TREN-OPT1-0003	L/R	47	4	\N	t	400.00	0.00	680.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3150	TREN-AKMX-0001	\N	214	4	\N	t	520.00	0.00	950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3151	TREN-SAMY-0001	\N	183	4	\N	t	510.00	0.00	880.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3152	TREN-NOBR-0001	\N	4	4	\N	t	180.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3153	WAPU-GMBX-0017	\N	52	121	\N	t	1050.00	0.00	1900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3154	WAPU-GMBX-0018	\N	52	121	\N	t	1095.00	0.00	1900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3155	WAPU-GMBX-0019	\N	52	121	\N	t	2415.00	0.00	4250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3156	WAPU-GMBX-0020	\N	52	121	\N	t	945.00	0.00	1670.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3157	WAPU-GMBX-0021	\N	52	121	\N	t	1328.00	0.00	2400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3158	WAPU-GMBX-0022	\N	52	121	\N	t	720.00	0.00	1480.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3159	WAPU-GMBX-0023	\N	52	121	\N	t	885.00	0.00	1600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3160	WAPU-GMBX-0024	\N	52	121	\N	t	1470.00	0.00	2600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3161	WAPU-GMBX-0025	\N	52	121	\N	t	3884.00	0.00	6850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3162	WAPU-MOHA-0002	\N	13	121	\N	t	1650.00	0.00	2250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3163	WAPU-GMBX-0026	\N	52	121	\N	t	1710.00	0.00	3000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3164	WAPU-GMBX-0027	\N	52	121	\N	t	1058.00	0.00	1900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3165	WAPU-RMXX-0001	\N	129	121	\N	t	850.00	0.00	1445.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3166	WAPU-RMXX-0002	\N	129	121	\N	t	1240.00	0.00	1850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3167	WAPU-RMXX-0003	\N	129	121	\N	t	1400.00	0.00	2380.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3168	WAPU-RMXX-0004	\N	129	121	\N	t	1500.00	0.00	2550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3169	WAPU-TAIS-0001	\N	92	121	\N	t	1950.00	0.00	3025.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3170	WAPU-GMBX-0028	\N	52	121	\N	t	1240.00	0.00	1850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3171	WAPU-RMXX-0005	\N	129	121	\N	t	670.00	0.00	1040.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3172	WAPU-GTXX-0001	\N	79	121	\N	t	1826.00	0.00	3200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3173	WAPU-MOHA-0003	\N	13	121	\N	t	1580.00	0.00	2150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3174	ENSU-TKKX-0001	\N	215	35	\N	t	720.00	0.00	990.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3175	CVJO-GTXX-0001	25*24T	79	183	\N	t	1100.00	0.00	2000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3176	CVJO-GTXX-0002	24*26T	79	183	\N	t	1000.00	0.00	1750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3177	CVJO-MOHA-0001	26*21T	13	183	\N	t	985.00	0.00	1800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3178	COLA-NUVO-0014	RH	210	62	\N	t	240.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3179	COLA-NUVO-0015	LH	210	62	\N	t	240.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3180	TALA-NUVO-0006	LH	210	179	\N	t	180.00	0.00	310.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3181	TALA-NUVO-0007	RH	210	179	\N	t	180.00	0.00	310.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3182	ENMO-JAGX-0047	FRONT	38	45	\N	t	500.00	0.00	880.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3183	ENMO-JAGX-0048	FRONT	38	45	\N	t	445.00	0.00	780.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3184	ENMO-JAGX-0049	T/M	38	45	\N	t	315.00	0.00	560.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3185	ENMO-JAGX-0050	R/L	38	45	\N	t	315.00	0.00	560.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3186	ENMO-JAGX-0051	L&R	38	45	\N	t	280.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3187	ENMO-IQXX-0001	\N	216	45	\N	t	280.00	0.00	500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3188	CEBE-OPT1-0001	\N	47	215	\N	t	1095.00	0.00	1680.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3189	ENMO-JAGX-0052	\N	38	45	\N	t	625.00	0.00	1150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3190	ENMO-JAGX-0053	\N	38	45	\N	t	625.00	0.00	1150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3191	ENMO-JAGX-0054	\N	38	45	\N	t	870.00	0.00	1600.00	\N	\N	1	t	2	`	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3192	CEBE-JAGX-0001	\N	38	215	\N	t	560.00	0.00	1100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3193	CEBE-JAGX-0002	\N	38	215	\N	t	835.00	0.00	1550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3194	CEBE-JAGX-0003	\N	38	215	\N	t	800.00	0.00	1450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3195	CEBE-JAGX-0004	\N	38	215	\N	t	625.00	0.00	1180.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3196	CEBE-JAGX-0005	\N	38	215	\N	t	890.00	0.00	1250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3197	CEBE-JAGX-0006	\N	38	215	\N	t	670.00	0.00	1350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3198	CEBE-JAGX-0007	\N	38	215	\N	t	1090.00	0.00	1900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3199	CEBE-GTXX-0001	SMALL	79	215	\N	t	720.00	0.00	1260.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3200	CEBE-JAGX-0008	\N	38	215	\N	t	1060.00	0.00	1950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3201	ENMO-NUVO-0001	\N	210	45	\N	t	350.00	0.00	590.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3202	ENMO-MITO-0001	\N	95	45	\N	t	2275.00	0.00	3600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3203	CEBE-BEIX-0002	\N	25	215	\N	t	850.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3204	TRS1-BEIX-0001	\N	25	133	\N	t	690.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3205	ENSU-BEIX-0007	\N	25	35	\N	t	290.00	0.00	510.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3206	FOLA-SGMX-0005	12V LED AMBER	56	63	\N	t	750.00	0.00	1300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3207	FOLA-NOBR-0001	24V LED WHITE	4	63	\N	t	160.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3208	TRLA-SGMX-0001	12V BLUE	56	324	\N	t	115.00	0.00	210.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3209	TRLA-SGMX-0002	12V GREEN	56	324	\N	t	115.00	0.00	210.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3210	TRLA-SGMX-0003	12V WHITE	56	324	\N	t	115.00	0.00	210.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3211	TRLA-SGMX-0004	24V GREEN	56	324	\N	t	160.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3212	TRLA-SGMX-0005	24V RED	56	324	\N	t	160.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3213	SILA-AUT1-0001	24V LED GREEN	217	67	\N	t	155.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3214	SILA-AUT1-0002	24V LED RED	217	67	\N	t	155.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3215	SILA-AUT1-0003	24V LED BLUE	217	67	\N	t	155.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3216	SILA-SPIN-0008	24V LED WHITE	49	67	\N	t	70.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3217	HELA-SGMX-0001	RED	56	71	\N	t	38.00	0.00	65.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3218	CEBE-JAGX-0009	\N	38	215	\N	t	760.00	0.00	1350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3219	ENSU-BEIX-0008	\N	25	35	\N	t	500.00	0.00	860.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3220	ENSU-BEIX-0009	\N	25	35	\N	t	500.00	0.00	860.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3221	WAPU-TAIS-0002	\N	92	121	\N	t	2850.00	0.00	4850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3222	OISE-MUSA-0071	25*40*10	1	1	\N	t	83.00	0.00	200.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3223	OISE-MUSA-0072	50*70*9	1	1	\N	t	85.00	0.00	160.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3224	OISE-MUSA-0073	34*50*7	1	1	\N	t	90.00	0.00	200.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3225	OISE-MUSA-0074	56*122*10.5	1	1	\N	t	97.00	0.00	200.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3227	OISE-NOKX-0232	50*74*11; TB	2	1	\N	t	108.00	0.00	200.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3228	OISE-MUSA-0076	35*55*11	1	1	\N	t	145.00	0.00	300.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3229	OISE-TOGU-0046	127*146*10	3	1	\N	t	160.00	0.00	275.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3230	OISE-TOGU-0047	90*127*12/36	3	1	\N	t	180.00	0.00	310.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3231	BULA-NUVO-0004	RH	210	322	\N	t	280.00	0.00	480.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3232	AIFI-FLEE-0072	\N	6	6	\N	t	330.00	0.00	570.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3233	TALA-NUVO-0008	LED 12V	210	179	\N	t	380.00	0.00	665.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3234	AIFI-UNAS-0023	\N	7	6	\N	t	426.00	0.00	510.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3235	SHMO-MITO-0001	FRT	95	325	\N	t	590.00	0.00	1000.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3236	TALA-APEX-0001	LH	209	179	\N	t	750.00	0.00	1400.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3237	SHMO-MITO-0002	FRT	95	325	\N	t	760.00	0.00	1300.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3238	BDST-NOBR-0001	\N	4	326	\N	t	820.00	0.00	1395.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3239	AIFI-UNAS-0024	\N	7	6	\N	t	950.00	0.00	1000.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3240	HELA-SGMX-0002	LH	56	71	\N	t	1050.00	0.00	1800.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3241	BDST-NOBR-0002	\N	4	326	\N	t	1090.00	0.00	1855.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3242	SHMO-MITO-0003	FRT	95	325	\N	t	1095.00	0.00	1915.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3243	WAPU-TAIS-0003	\N	92	121	\N	t	1350.00	0.00	1980.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3244	WAPU-MOHA-0004	\N	13	121	\N	t	1650.00	0.00	2250.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3245	TALI-SGMX-0009	\N	56	79	\N	t	1750.00	0.00	3000.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3246	HELI-APEX-0003	LH	209	320	\N	t	1850.00	0.00	2600.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3247	OIPU-MIKO-0005	\N	88	40	\N	t	2070.00	0.00	3600.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3248	OIPU-MIKO-0006	\N	88	40	\N	t	2560.00	0.00	4400.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3249	STA1-BLIT-0001	24V	86	165	\N	t	5200.00	0.00	8800.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3250	WAPU-MMCX-0001	\N	28	121	\N	t	8900.00	0.00	15200.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3251	WAPU-MIST-0001	\N	218	121	\N	t	11000.00	0.00	18700.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3252	OISE-NOKX-0233	20*30*10/15; OCY	2	1	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3253	OISE-KOSE-0001	90*110*9	219	1	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3254	FOLA-APEX-0001	RH	209	63	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3255	STB2-JAGX-0002	FRT	38	302	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3256	OIPU-MIKO-0007	\N	88	40	\N	t	5560.00	0.00	9500.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3257	OISE-NOKX-0234	117*174*16/28; TA2Y	2	1	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3258	OISE-NOKX-0235	130*150*14; TBP	2	1	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3259	OISE-NOKX-0236	35*41*5.5/9.1; SCY	2	1	\N	t	60.00	0.00	130.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3260	OISE-NOKX-0237	130*150*14; TBP	2	1	\N	t	97.00	0.00	200.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3261	OISE-NOKX-0238	80*100*12; HTCRL	2	1	\N	t	140.00	0.00	250.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3262	OISE-TOGU-0048	127*146*10	3	1	\N	t	160.00	0.00	275.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3263	OISE-NOKX-0239	65*88*11/16.3; HTBW	2	1	\N	t	160.00	0.00	300.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3264	OISE-TOGU-0049	60*103*10/34	3	1	\N	t	170.00	0.00	290.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3265	OISE-NOKX-0240	49*100*8/10; HSCY	2	1	\N	t	170.00	0.00	290.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3266	OISE-NOKX-0241	60*88*9.5/16.5; HTBW	2	1	\N	t	250.00	0.00	450.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3267	OISE-NOKX-0242	78.5*113*11/22; TAY	2	1	\N	t	290.00	0.00	510.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3268	SHMO-MITO-0004	\N	95	325	\N	t	845.00	0.00	1450.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3269	OISE-NOKX-0243	85*162*12; HTA9Y	2	1	\N	t	1395.00	0.00	2500.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3270	STA1-BLIT-0002	\N	86	165	\N	t	5200.00	0.00	8800.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3271	OISE-NOKX-0244	40*64*42; TB5Y	2	1	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3272	OISE-NOKX-0245	24*54*9/15.5; TBC9Y	2	1	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3273	OISE-NOKX-0246	70*135*14/8; TB9Y	2	1	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3274	OISE-NOKX-0247	154*172*147	2	1	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3275	OISE-NOKX-0248	117*174*16/28; TA2Y	2	1	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3276	OISE-TOGU-0050	80*96*98	3	1	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3277	OISE-TOGU-0051	10*127*12/36	3	1	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3278	OISE-TOGU-0052	104*134*13	3	1	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3279	OISE-NOKX-0249	138*162*12; TB	2	1	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3280	OISE-NOKX-0250	83*100*8; HTCL	2	1	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3281	OISE-NOKX-0251	23*34*6.5; SCY	2	1	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3282	SABU-JAGX-0002	\N	38	65	\N	t	200.00	0.00	380.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3283	SABU-JAGX-0003	14UP BIG	38	65	\N	t	225.00	0.00	450.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3284	SABU-JAGX-0004	LOWER	38	65	\N	t	225.00	0.00	450.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3285	STB2-JAGX-0003	FRONT	38	302	\N	t	45.00	0.00	85.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3286	ENMO-JAGX-0055	14UP RH	38	45	\N	t	725.00	0.00	1250.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3287	BRBO-JBSX-0001	9"	220	100	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3288	BRBO-MOHA-0014	\N	13	100	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3289	BRBO-MOHA-0015	\N	13	100	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3290	BRBO-MOHA-0016	\N	13	100	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3291	BRBO-MOHA-0017	\N	13	100	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3292	BRBO-MOHA-0018	\N	13	100	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3293	BRBO-MOHA-0019	\N	13	100	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3294	BRBO-JBSX-0002	9"	220	100	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3295	CLBO-GTXX-0001	\N	79	152	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3296	BRBO-AWFX-0001	\N	221	100	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3297	CLOP-REDL-0005	11/16"	130	43	\N	t	380.00	0.00	700.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3298	CLOP-REDL-0006	13/16"	130	43	\N	t	300.00	0.00	550.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3299	CRCY-AKMX-0001	13/16"	214	327	\N	t	710.00	0.00	1300.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3300	CMKI-ANDX-0003	7/8"	120	31	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3301	CLOP-AISI-0001	\N	62	43	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3302	CLOP-AISI-0002	3/4"	62	43	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3303	CLOP-AISI-0003	13/16"	62	43	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3304	CLOP-AISI-0004	\N	62	43	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3305	CLOP-AISI-0005	\N	62	43	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3306	CLOP-NESI-0003	3/4"	96	43	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3307	CLSL-MOHA-0012	7/8"	13	99	\N	t	360.00	0.00	650.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3308	CLSL-MOHA-0013	11/16"	13	99	\N	t	385.00	0.00	700.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3309	CLOP-MIKA-0006	5/8"	23	43	\N	t	360.00	0.00	650.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3310	CLOP-MIKA-0007	5/8"	23	43	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3311	CLSL-ANDX-0001	B2500 3/4"	120	99	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3312	CLOP-MIDO-0002	3/4"	35	43	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3313	TEBE-MITS-0001	SMALL	116	66	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3314	IDPU-TOYO-0001	\N	222	328	\N	t	1250.00	0.00	2125.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3315	CLOP-AISI-0006	\N	62	43	\N	t	385.00	0.00	700.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3316	TEBE-GMBX-0002	\N	52	66	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3317	TEBE-GMBX-0003	\N	52	66	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3318	TEBE-GMBX-0004	\N	52	66	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3319	CRB1-NSKX-0001	ENSS 801	31	92	\N	t	615.00	0.00	1100.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3320	CLRE-NSKX-0001	608	31	329	\N	t	615.00	0.00	1100.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3321	CLRE-NSKX-0002	\N	31	329	\N	t	660.00	0.00	1150.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3322	TEBE-NSKX-0001	\N	31	66	\N	t	270.00	0.00	500.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3323	CLOP-AISI-0007	\N	62	43	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3324	CLRE-DAEJ-0001	\N	223	329	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3325	CLRE-NSKX-0003	ENCS 307	31	329	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3326	CLRE-NSKX-0004	ENSS 301	31	329	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3328	CLRE-NSKX-0006	LB ENCS5 HC08	31	329	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3329	CLRE-HYUN-0001	\N	117	329	\N	t	700.00	0.00	1250.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3330	IDPU-HYUN-0001	PLASTIC	117	328	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3331	IDBE-HTCX-0004	\N	43	56	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3332	SYRI-HYUN-0001	\N	117	330	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3333	IDBE-HTCX-0005	\N	43	56	\N	t	525.00	0.00	950.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3334	IDPU-FORD-0001	\N	224	328	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3335	TEPU-GMGX-0001	\N	48	331	\N	t	480.00	0.00	820.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3336	CLRE-ISUZ-0001	\N	225	329	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3337	TEBE-NMKX-0001	\N	226	66	\N	t	580.00	0.00	1100.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3338	CLRE-ISUZ-0002	\N	225	329	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3339	CEBE-CTBX-0012	\N	125	215	\N	t	150.00	0.00	255.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3340	TEPU-AKMX-0001	\N	214	331	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3341	IDPU-FORD-0002	\N	224	328	\N	t	1350.00	0.00	2295.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3342	TCTE-KOMO-0001	\N	227	57	\N	t	1645.00	0.00	2600.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3343	TEBE-ORIO-0001	\N	24	66	\N	t	300.00	0.00	510.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3344	CLRE-ORIO-0001	\N	24	329	\N	t	570.00	0.00	750.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3345	CLRE-KOYO-0001	\N	11	329	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3346	CLRE-KOYO-0002	\N	11	329	\N	t	702.00	0.00	1300.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3347	TEBE-KOYO-0001	\N	11	66	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3348	IDSU-TOYO-0001	\N	222	332	\N	t	985.00	0.00	1800.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3349	ALPU-HTCX-0001	\N	43	264	\N	t	1900.00	0.00	3250.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3350	TEBE-KIAX-0001	\N	202	66	\N	t	1650.00	0.00	2850.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3351	CLRE-GMBX-0001	\N	52	329	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3352	ROAR-KOMO-0001	LONG	227	87	\N	t	1645.00	0.00	2600.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3353	CLRE-NTNX-0001	\N	33	329	\N	t	350.00	0.00	595.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3354	CLRE-TOYO-0001	\N	222	329	\N	t	1750.00	0.00	2975.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3355	IDPU-NBXX-0001	\N	228	328	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3356	TEBE-GMGX-0001	\N	48	66	\N	t	480.00	0.00	820.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3357	TEBE-NIS1-0001	\N	229	66	\N	t	1985.00	0.00	3300.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3358	CLRE-ORIO-0002	\N	24	329	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3359	CLRE-NIS1-0001	\N	229	329	\N	t	1250.00	0.00	2125.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3360	ROAR-KOMO-0002	SHORT	227	87	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3361	ALPU-HTCX-0002	\N	43	264	\N	t	1900.00	0.00	3250.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3362	WHBE-KOYO-0001	\N	11	97	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3363	FABL-JAGX-0006	\N	38	70	\N	t	670.00	0.00	1200.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3364	FABL-SGMX-0001	\N	56	70	\N	t	620.00	0.00	850.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3365	CLRE-JTEK-0001	\N	230	329	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3366	MABE-TAIH-0005	SUZUKI F6A	104	48	\N	t	525.00	0.00	900.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3367	CLRE-KOYO-0003	\N	11	329	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3368	MABE-TAIH-0006	F6A	104	48	\N	t	490.00	0.00	850.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3369	CLOP-AISI-0008	\N	62	43	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3370	MABE-TAIH-0007	F6A	104	48	\N	t	620.00	0.00	1050.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3371	ALPU-TOYO-0001	\N	222	264	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3372	MABE-TAIH-0008	F6A	104	48	\N	t	453.00	0.00	780.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3373	CORO-TAIH-0001	SUZUKI F6A	104	333	\N	t	320.00	0.00	560.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3374	CORO-TAIH-0002	SUZUKI F6A	104	333	\N	t	340.00	0.00	595.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3375	TEBE-NTNX-0001	\N	33	66	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3376	CORO-TAIH-0003	SUZUKI F6A	104	333	\N	t	330.00	0.00	580.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3377	CORO-TAIH-0004	SUZUKI F6A	104	333	\N	t	270.00	0.00	475.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3378	ALPU-NOBR-0001	\N	4	264	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3379	CORO-TAIH-0005	K6A	104	333	\N	t	560.00	0.00	950.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3380	TEBE-MITS-0002	BIG	116	66	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3381	ENBE-DAME-0001	F10A	231	334	\N	t	620.00	0.00	1100.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3382	ENBE-DAME-0002	F6A	231	334	\N	t	290.00	0.00	500.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3383	ENBE-DAME-0003	F6A CONN. ROD	231	334	\N	t	290.00	0.00	500.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3384	IDPU-FORD-0003	\N	224	328	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3385	ENVA-FUJI-0001	KIA	34	181	\N	t	185.00	0.00	2500.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3386	CLRE-GMBX-0002	\N	52	329	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3387	ENVA-FUJI-0002	KIA	34	181	\N	t	185.00	0.00	2500.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3388	ENVA-FUJI-0003	F6A	34	181	\N	t	850.00	0.00	1500.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3389	IDBE-HTCX-0006	\N	43	56	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3390	ENBE-DAME-0004	6DC2 10DC6 10DC8	231	334	\N	t	2700.00	0.00	3800.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3391	HYTE-NTNX-0001	\N	33	335	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3392	ENBE-DAME-0005	F8A F10A K6A CONN. ROD	231	334	\N	t	620.00	0.00	1100.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3393	ENVA-FUJI-0004	JT	34	181	\N	t	200.00	0.00	2750.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3394	VAGU-HAJI-0001	TD25 27	232	89	\N	t	355.00	0.00	650.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3395	DGWH-KIAX-0001	\N	202	336	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3396	VAGU-HAJI-0002	4DR5	232	89	\N	t	375.00	0.00	650.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3397	TEBE-KOYO-0002	\N	11	66	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3398	VAGU-HAJI-0003	4D55 56	232	89	\N	t	390.00	0.00	700.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3399	CLRE-THBX-0001	\N	233	329	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3400	VAGU-HAJI-0004	KIA BESTA	232	89	\N	t	375.00	0.00	650.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3401	STB3-MIKA-0001	\N	23	337	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3402	VAGU-HAJI-0005	4JB1 4JA1	232	89	\N	t	375.00	0.00	650.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3403	VAGU-HAJI-0006	4JA1	232	89	\N	t	375.00	0.00	650.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3404	VAGU-HAJI-0007	4JG1 4EC1 ALTERRA	232	89	\N	t	375.00	0.00	650.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3405	BEAR-NSKX-0024	145X36	31	9	\N	t	808.00	0.00	2500.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3406	CRJO-NOBR-0001	50X168	4	338	\N	t	774.00	0.00	2150.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3407	CRJO-NOBR-0002	50X200	4	338	\N	t	539.00	0.00	1800.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3408	FABL-SGMX-0002	\N	56	70	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3409	CRJO-NOBR-0003	\N	4	338	\N	t	688.00	0.00	1950.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3410	FABL-SGMX-0003	540MM	56	70	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3411	CRJO-NOBR-0004	50X160	4	338	\N	t	809.00	0.00	2500.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3412	FABL-GSKX-0001	\N	44	70	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3413	CRJO-NOBR-0005	49X156	4	338	\N	t	608.00	0.00	1950.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3414	COCA-NOBR-0001	\N	4	339	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3415	CRJO-NOBR-0006	50X161	4	338	\N	t	809.00	0.00	2500.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3416	CRJO-NOBR-0007	47X150	4	338	\N	t	548.00	0.00	1650.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3417	MABE-TAIH-0009	K6A	104	48	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3418	CRJO-NOBR-0008	46X142	4	338	\N	t	405.00	0.00	1500.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3419	MABE-TAIH-0010	K6A	104	48	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3420	CRJO-NOBR-0009	45X931	4	338	\N	t	558.00	0.00	1550.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3421	CRJO-NOBR-0010	40X115	4	338	\N	t	273.00	0.00	780.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3422	CRJO-NOBR-0011	\N	4	338	\N	t	276.00	0.00	850.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3423	CRJO-NOBR-0012	40X113	4	338	\N	t	273.00	0.00	770.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3424	CRJO-NOBR-0013	\N	4	338	\N	t	234.00	0.00	650.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3425	CRJO-NOBR-0014	29X77	4	338	\N	t	138.00	0.00	450.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3426	ENBE-DAME-0006	6DC2 10DC6 10DC8	231	334	\N	t	2700.00	0.00	3800.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3427	ENBE-DAME-0007	\N	231	334	\N	t	2700.00	0.00	3800.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3428	MABE-TAIH-0011	KIA J2	104	48	\N	t	975.00	0.00	1700.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3429	MABE-DAME-0001	4D30 4D34	231	48	\N	t	1450.00	0.00	2450.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3430	MABE-DAME-0002	4D30 4D34	231	48	\N	t	1480.00	0.00	2500.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3431	MABE-DAME-0003	4D30 4D34	231	48	\N	t	1525.00	0.00	2600.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3432	MABE-DAME-0004	4BA1 4BA2	231	48	\N	t	1241.00	0.00	2200.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3433	MABE-DAME-0005	4G5 G5B 4D5	231	48	\N	t	641.00	0.00	1200.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3434	ENVA-FUJI-0005	K6A	34	181	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3435	MABE-DAME-0006	4M40	231	48	\N	t	1781.00	0.00	3150.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3436	ENVA-FUJI-0006	K6A	34	181	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3437	MABE-DAME-0007	4M40	231	48	\N	t	1961.00	0.00	3450.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3438	CORO-DAME-0001	4D30 4D33	231	333	\N	t	980.00	0.00	1715.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3439	ENVA-FUJI-0007	F6A	34	181	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3440	CORO-DAME-0002	4D30 4D33	231	333	\N	t	980.00	0.00	1715.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3441	ENVA-FUJI-0008	TOYOTA 2E-LU	34	181	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3442	CORO-DAME-0003	4D30 4D33	231	333	\N	t	1000.00	0.00	1750.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3443	ENVA-FUJI-0009	TOYOTA 2E-LU	34	181	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3444	CORO-DAME-0004	1C 2C	231	333	\N	t	600.00	0.00	1050.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3445	ENVA-FUJI-0010	TOYOTA 2E-LU	34	181	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3446	MABE-DAME-0008	F6A	231	48	\N	t	259.00	0.00	470.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3447	ENVA-FUJI-0011	Y2A	34	181	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3448	MABE-DAME-0009	1C 2C	231	48	\N	t	765.00	0.00	1400.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3449	ENVA-FUJI-0012	Y2M	34	181	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3450	MABE-DAME-0010	1C 2C	231	48	\N	t	685.00	0.00	1250.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3451	CORO-DAME-0005	F6 F8 FE RF	231	333	\N	t	379.00	0.00	690.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3452	CORO-DAME-0006	F6 F8 FE RF	231	333	\N	t	364.00	0.00	680.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3453	THWA-TAIH-0001	F6A	104	29	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3454	CORO-DAME-0007	4HE1-T	231	333	\N	t	2055.00	0.00	3600.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3455	BUSH-TAIH-0001	4JG2	104	340	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3456	MABE-DAME-0011	4D56	231	48	\N	t	1451.00	0.00	2600.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3457	ENVA-FUJI-0013	4JG2	34	181	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3458	CORO-DAME-0008	4D34 4M50	231	333	\N	t	1189.00	0.00	2100.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3459	ENVA-FUJI-0014	4JG2	34	181	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3460	CORO-DAME-0009	4M40	231	333	\N	t	934.00	0.00	1650.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3461	ENVA-FUJI-0015	4D33	34	181	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3462	CORO-DAME-0010	4M40	231	333	\N	t	848.00	0.00	1500.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3463	ENVA-FUJI-0016	4D33	34	181	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3464	MABE-DAME-0012	RF R2	231	48	\N	t	908.00	0.00	1650.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3465	CORO-TAIH-0006	J2	104	333	\N	t	540.00	0.00	1100.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3466	ENVA-FUJI-0017	C240	34	181	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3467	CRBE-HYUN-0001	2D0	117	46	\N	t	720.00	0.00	1225.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3468	CRBE-DAJA-0013	\N	167	46	\N	t	1725.00	0.00	3500.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3469	ENVA-ROCK-0001	4D30 4D31 4D32	234	181	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3470	PPBU-MAZD-0001	STD	126	341	\N	t	436.00	0.00	790.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3471	ENVA-ROCK-0002	4D30	234	181	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3472	PPBU-DAME-0001	SS	231	341	\N	t	209.00	0.00	380.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3473	VAGU-HAJI-0008	4D56	232	89	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3474	CLDI-AISI-0011	\N	62	27	\N	t	650.00	0.00	1350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3475	VAGU-HAJI-0009	4M40	232	89	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3476	CLDI-AISI-0012	8-1/2X20T	62	27	\N	t	1912.00	0.00	3400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3477	VAGU-HAJI-0010	6D15	232	89	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3478	CLDI-AISI-0013	10-1/4X204T	62	27	\N	t	6982.00	0.00	11900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3479	VAGU-HAJI-0011	4D55 6	232	89	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3480	CLDI-AISI-0014	\N	62	27	\N	t	1950.00	0.00	3450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3481	VAGU-HAJI-0012	8DC9	232	89	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3482	CLDI-AISI-0015	8X20T	62	27	\N	t	2171.00	0.00	3800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3483	VAGU-HAJI-0013	4M51	232	89	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3484	CLDI-AISI-0016	\N	62	27	\N	t	6409.00	0.00	11000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3485	CLCO-AISI-0011	\N	62	28	\N	t	650.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3486	VAGU-HAJI-0014	VG-2E	232	89	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3487	CLDI-HYUN-0001	9-1/2X22T	117	27	\N	t	1350.00	0.00	2300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3488	CLDI-EXED-0021	10-14 5X14T	19	27	\N	t	1480.00	0.00	2400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3489	VAGU-HAJI-0015	NAVARA	232	89	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3490	CLDI-AISI-0017	8X21T	62	27	\N	t	900.00	0.00	1650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3491	CLCO-EXED-0004	11"	19	28	\N	t	2350.00	0.00	4200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3492	VAGU-HAJI-0016	4M40	232	89	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3493	CLCO-EXED-0005	\N	19	28	\N	t	1570.00	0.00	2100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3494	VAGU-HAJI-0017	4M40	232	89	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3495	CLCO-POWE-0001	\N	98	28	\N	t	1280.00	0.00	2080.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3496	CLCO-NIS1-0001	\N	229	28	\N	t	7500.00	0.00	12750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3497	VAGU-HAJI-0018	C240	232	89	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3498	CLDI-NIS1-0001	\N	229	27	\N	t	6500.00	0.00	11050.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3499	VAGU-HAJI-0019	2C	232	89	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3500	AIFI-UNAS-0025	\N	7	6	\N	t	324.00	0.00	390.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3501	VAGU-HAJI-0020	F6A	232	89	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3502	AIFI-FLEE-0073	\N	6	6	\N	t	1090.00	0.00	1800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3503	VAGU-HAJI-0021	1RZ	232	89	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3504	CLCO-EXED-0006	\N	19	28	\N	t	9070.00	0.00	12950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3505	VAGU-HAJI-0022	B2500 WL	232	89	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3506	CLCO-EXED-0007	9-1/2"	19	28	\N	t	2120.00	0.00	2850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3507	VAGU-HAJI-0023	SD23 SD25	232	89	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3508	CLCO-EXED-0008	\N	19	28	\N	t	1750.00	0.00	3000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3509	VAGU-HAJI-0024	SENTRA	232	89	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3510	CLCO-EXED-0009	8-1/2"	19	28	\N	t	1550.00	0.00	2000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3511	VAGU-HAJI-0025	4M40	232	89	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3512	HEGA-ISUZ-0001	\N	225	64	\N	t	3550.00	0.00	6300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3513	HEGA-ISUZ-0002	\N	225	64	\N	t	590.00	0.00	1250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3514	VAGU-HAJI-0026	1C 2C	232	89	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3515	HEGA-ISUZ-0003	CARBON	225	64	\N	t	590.00	0.00	1250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3516	VAGU-HAJI-0027	1RZ	232	89	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3517	HEGA-ISUZ-0004	\N	225	64	\N	t	4100.00	0.00	7200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3518	HEGA-MITS-0001	\N	116	64	\N	t	1400.00	0.00	2550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3519	VAGU-HAJI-0028	C240	232	89	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3520	HEGA-MITS-0002	\N	116	64	\N	t	630.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3521	VAGU-HAJI-0029	YVG-L 2L	232	89	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3522	HEGA-MITS-0003	\N	116	64	\N	t	630.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3523	HEGA-HYUN-0001	\N	117	64	\N	t	1850.00	0.00	3200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3524	VAGU-HAJI-0030	4BA1	232	89	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3525	UJOI-GMGX-0004	\N	48	20	\N	t	130.00	0.00	270.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3526	VAGU-HAJI-0031	4M51	232	89	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3527	UJOI-SEAL-0010	28.5*77	30	20	\N	t	121.00	0.00	210.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3528	VAGU-HAJI-0032	K6A	232	89	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3529	UJOI-NOBR-0001	\N	4	20	\N	t	138.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3530	BEAR-KOYO-0063	K2202	11	9	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3531	ENBE-DAME-0008	4D55	231	334	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3532	VIRI-DAME-0001	10PD1	231	342	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3533	DAID-DAME-0001	10PD1	231	343	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3534	MABE-DAME-0013	1C 2C	231	48	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3535	MABE-DAME-0014	G10 G10-T	231	48	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3536	MABE-DAME-0015	G10 G10-T	231	48	\N	t	\N	0.00	\N	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3537	UJOI-MOHA-0003	\N	13	20	\N	t	260.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3538	UJOI-GMBX-0034	33*93	52	20	\N	t	545.00	0.00	950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3539	UJOI-GMBX-0035	\N	52	20	\N	t	265.00	0.00	480.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3540	OVGA-ORIO-0001	\N	24	68	\N	t	1330.00	0.00	1850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3541	UJOI-GMBX-0036	\N	52	20	\N	t	585.00	0.00	1050.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3542	UJOI-GMBX-0037	\N	52	20	\N	t	435.00	0.00	760.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3543	UJOI-GMBX-0038	\N	52	20	\N	t	325.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3544	UJOI-GMGX-0005	\N	48	20	\N	t	110.00	0.00	190.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3545	UJOI-GMGX-0006	\N	48	20	\N	t	300.00	0.00	550.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3546	UJOI-GMGX-0007	\N	48	20	\N	t	180.00	0.00	350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3547	AIFI-OSAK-0003	\N	78	6	\N	t	2448.00	0.00	2500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3548	AIFI-OSAK-0004	\N	78	6	\N	t	432.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3549	AIFI-FLEE-0074	\N	6	6	\N	t	320.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3550	OIFI-ASUK-0002	\N	122	38	\N	t	720.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3551	OIFI-UNAS-0008	\N	7	38	\N	t	1026.00	0.00	1250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3552	AIFI-NOBR-0003	\N	4	6	\N	t	390.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3553	OIFI-ASUK-0003	\N	122	38	\N	t	800.00	0.00	1380.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3554	OIFI-UNAS-0009	\N	7	38	\N	t	600.00	0.00	615.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3555	OVGA-FEMO-0001	CARBON	45	68	\N	t	2290.00	0.00	4000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3556	OVGA-FEMO-0002	CARBON	45	68	\N	t	2630.00	0.00	4500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3557	OVGA-FEMO-0003	CARBON	45	68	\N	t	2190.00	0.00	3750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3558	OVGA-FEMO-0004	CARBON	45	68	\N	t	1920.00	0.00	3300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3559	OVGA-FEMO-0005	CARBON	45	68	\N	t	1940.00	0.00	3300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3560	OVGA-FEMO-0006	CARBON	45	68	\N	t	2100.00	0.00	3600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3561	OVGA-FEMO-0007	CARBON	45	68	\N	t	2290.00	0.00	3900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3562	OVGA-FEMO-0008	CARBON	45	68	\N	t	2820.00	0.00	4800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3563	OVGA-FEMO-0009	STEEL	45	68	\N	t	3430.00	0.00	5900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3564	OVGA-FEMO-0010	STEEL	45	68	\N	t	2550.00	0.00	4400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3565	OVGA-FEMO-0011	NON-ASB	45	68	\N	t	2510.00	0.00	4300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3566	OVGA-FEMO-0012	STEEL	45	68	\N	t	2410.00	0.00	5000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3567	OVGA-FEMO-0013	CARBON	45	68	\N	t	2160.00	0.00	3700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3568	OVGA-FEMO-0014	CARBON	45	68	\N	t	1800.00	0.00	3100.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3569	OVGA-FEMO-0015	STEEL 1.40MM	45	68	\N	t	2800.00	0.00	4800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3570	OVGA-FEMO-0016	STEEL	45	68	\N	t	2240.00	0.00	3850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3571	OVGA-FEMO-0017	\N	45	68	\N	t	1970.00	0.00	3380.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3572	OVGA-FEMO-0018	COPPER	45	68	\N	t	1580.00	0.00	2700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3573	OVGA-FEMO-0019	\N	45	68	\N	t	1660.00	0.00	2850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3574	OVGA-FEMO-0020	\N	45	68	\N	t	1030.00	0.00	1800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3575	OVGA-FEMO-0021	\N	45	68	\N	t	1970.00	0.00	3355.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3576	OVGA-FEMO-0022	\N	45	68	\N	t	1390.00	0.00	2380.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3577	HEGA-FEMO-0011	CARBON	45	64	\N	t	780.00	0.00	1350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3578	HEGA-FEMO-0012	STEEL 1.50MM	45	64	\N	t	1020.00	0.00	1750.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3579	HEGA-FEMO-0013	CARBON	45	64	\N	t	670.00	0.00	1150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3580	HEGA-FEMO-0014	CARBON	45	64	\N	t	720.00	0.00	1225.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3581	HEGA-FEMO-0015	CARBON	45	64	\N	t	780.00	0.00	1350.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3582	HEGA-FEMO-0016	CARBON	45	64	\N	t	650.00	0.00	1120.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3583	HEGA-FEMO-0017	NON-ASB	45	64	\N	t	400.00	0.00	690.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3584	HEGA-FEMO-0018	CARBON 1.60MM	45	64	\N	t	740.00	0.00	1300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3585	HEGA-FEMO-0019	STEEL	45	64	\N	t	1030.00	0.00	1800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3586	HEGA-FEMO-0020	CARBON	45	64	\N	t	570.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3587	HEGA-FEMO-0021	CARBON	45	64	\N	t	710.00	0.00	1300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3588	HEGA-FEMO-0022	CARBON	45	64	\N	t	610.00	0.00	1050.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3589	HEGA-FEMO-0023	\N	45	64	\N	t	760.00	0.00	1300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3590	HEGA-FEMO-0024	CARBON	45	64	\N	t	730.00	0.00	1300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3591	HEGA-FEMO-0025	CARBON	45	64	\N	t	750.00	0.00	1300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3592	HEGA-FEMO-0026	STEEL	45	64	\N	t	1670.00	0.00	2980.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3593	HEGA-FEMO-0027	CARBON	45	64	\N	t	730.00	0.00	1270.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3594	HEGA-FEMO-0028	STEEL	45	64	\N	t	1090.00	0.00	1900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3595	HEGA-FEMO-0029	STEEL	45	64	\N	t	1110.00	0.00	1900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3596	HEGA-FEMO-0030	STEEL	45	64	\N	t	1100.00	0.00	1900.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3597	HEGA-FEMO-0031	STEEL	45	64	\N	t	1050.00	0.00	1800.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3598	HEGA-FEMO-0032	STEEL	45	64	\N	t	1440.00	0.00	2460.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3599	HEGA-FEMO-0033	CARBON	45	64	\N	t	670.00	0.00	1150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3600	HEGA-FEMO-0034	STEEL	45	64	\N	t	950.00	0.00	1650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3601	HEGA-FEMO-0035	NON-ASB	45	64	\N	t	400.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3602	HEGA-FEMO-0036	CARBON	45	64	\N	t	730.00	0.00	1300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3603	HEGA-FEMO-0037	CARBON	45	64	\N	t	700.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3604	HEGA-FEMO-0038	\N	45	64	\N	t	350.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3605	HEGA-FEMO-0039	STEEL	45	64	\N	t	1100.00	0.00	1950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3606	HEGA-FEMO-0040	STEEL	45	64	\N	t	750.00	0.00	1250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3607	HEGA-FEMO-0041	STEEL 1.40MM	45	64	\N	t	1550.00	0.00	2700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3608	HEGA-FEMO-0042	STEEL	45	64	\N	t	960.00	0.00	1650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3609	HEGA-FEMO-0043	STEEL	45	64	\N	t	970.00	0.00	1700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3610	HEGA-FEMO-0044	NON-ASB	45	64	\N	t	970.00	0.00	1650.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3611	HEGA-FEMO-0045	CARBON	45	64	\N	t	670.00	0.00	1200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3612	HEGA-FEMO-0046	\N	45	64	\N	t	210.00	0.00	400.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3613	HEGA-FEMO-0047	\N	45	64	\N	t	310.00	0.00	535.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3614	HEGA-FEMO-0048	STEEL	45	64	\N	t	880.00	0.00	1500.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3615	HEGA-FEMO-0049	\N	45	64	\N	t	170.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3616	HEGA-YSMW-0002	\N	58	64	\N	t	700.00	0.00	1190.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3617	HEGA-SPOR-0005	SILICONE SEAL	50	64	\N	t	130.00	0.00	225.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3618	OVGA-SPOR-0002	SILICONE	50	68	\N	t	1450.00	0.00	2300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3619	OISE-MUSA-0054	77*98*1543*23	1	1	\N	t	1200.00	0.00	300.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3620	CVJO-GTXX-0003	4X2	79	183	\N	t	1650.00	0.00	3000.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3621	TIRE-MXWD-0001	Kargador	235	231	\N	t	4108.00	0.00	4800.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3622	TRBU-JCRX-0001	\N	236	130	\N	t	500.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3623	TUBE-NOBR-0003	R15	4	304	\N	t	318.00	0.00	480.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3624	TUBE-NOBR-0004	R13	4	304	\N	t	218.00	0.00	320.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3625	TUBE-NOBR-0001	R12	4	304	\N	t	198.00	0.00	1850.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3626	TUBE-NOBR-0005	R13	4	304	\N	t	258.00	0.00	440.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3627	ENOI-ENOC-0001	Protect, Gal	237	82	\N	t	937.00	0.00	1400.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3628	RUCU-SEIK-0006	\N	14	12	\N	t	21.00	0.00	35.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3629	RUCU-SEIK-0069	\N	14	12	\N	t	39.00	0.00	55.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3630	RUCU-SEIK-0070	\N	14	12	\N	t	42.00	0.00	55.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3631	RUCU-SEIK-0073	\N	14	12	\N	t	42.00	0.00	70.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3632	RUCU-SEIK-0082	\N	14	12	\N	t	25.50	0.00	45.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3633	WHBE-GTXX-0001	\N	79	97	\N	t	650.00	0.00	1350.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3634	FUFI-GTXX-0001	\N	79	19	\N	t	620.00	0.00	1350.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3635	RIBE-BAND-0031	\N	46	23	\N	t	921.00	0.00	1600.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3636	RIBE-BAND-0032	\N	46	23	\N	t	858.00	0.00	1500.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3637	TCHG-ORIO-0001	\N	24	344	\N	t	1080.00	0.00	2000.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3638	VVLV-GTXX-0001	\N	79	345	\N	t	250.00	0.00	450.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3639	GREA-AUTO-0002	MP3	194	13	\N	t	2000.00	0.00	3600.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3641	FLRE-ARMT-0001	\N	68	80	\N	t	125.00	0.00	250.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3642	WHCY-ARMT-0001	\N	68	34	\N	t	1200.00	0.00	2500.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3643	GLPL-CIRC-0002	\N	26	37	\N	t	63.00	0.00	150.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3644	RACA-HWO-0001	\N	239	221	\N	t	72.00	0.00	180.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3645	RACA-HWO-0002	\N	239	221	\N	t	76.50	0.00	250.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3646	OIFI-UNAS-0010	\N	7	38	\N	t	588.00	0.00	700.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3647	FUFI-UNAS-0002	\N	7	19	\N	t	390.00	0.00	600.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3648	HABU-ASAH-0002	H4, 24V, 100/90W, P43T	29	299	\N	t	110.00	0.00	250.00	\N	\N	1	t	1	pcs	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3649	HABU-ASAH-0003	H3, 24V, 100W	29	299	\N	t	50.00	0.00	90.00	\N	\N	1	t	1	pcs	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3650	HABU-ASAH-0004	H1, 24V, 100W	29	299	\N	t	50.00	0.00	90.00	\N	\N	1	t	1	pcs	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3651	HABU-ASAH-0005	H11, 24V, 70W	29	299	\N	t	165.00	0.00	300.00	\N	\N	1	t	0	pcs	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3652	TEBE-NSKX-0002	\N	31	66	\N	t	385.00	0.00	749.99	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3653	TEBE-NSKX-0003	\N	31	66	\N	t	385.00	0.00	750.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3654	OIFI-VICX-0046	\N	94	38	\N	t	401.00	0.00	850.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3655	FTCA-HWO-0001	CIRCUIT	239	312	\N	t	180.00	0.00	380.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3656	ALPU-OEMX-0001	\N	105	264	\N	t	785.00	0.00	1599.99	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3657	GLPL-CIRC-0003	\N	26	37	\N	t	90.00	0.00	180.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3658	GLPL-CIRC-0004	\N	26	37	\N	t	63.00	0.00	180.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3659	IDPU-MITS-0001	\N	116	328	\N	t	425.00	0.00	1490.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3660	BRBO-MOHA-0005	\N	13	100	\N	t	1200.00	0.00	3200.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3661	CLCO-AISI-0012	\N	62	28	\N	t	7500.00	0.00	13800.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3662	TIRE-WNDA-0001	\N	240	231	\N	t	0.00	0.00	3000.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3663	MLCN-NOBR-0005	FITTING L-TYPE,3/8, CHINA	4	347	\N	t	0.00	0.00	0.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3664	MLCN-NOBR-0006	FITTING L-TYPE, 1/4, CHINA	4	347	\N	t	0.00	0.00	0.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3665	BLSC-NOBR-0002	6*3.5, NF, CHINA	4	116	\N	t	9.75	0.00	25.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3666	MLCN-NOBR-0001	FITTING L-TYPE, 1/4, CHINA	4	347	\N	t	69.75	0.00	180.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3667	MLCN-NOBR-0002	FITTING L-TYPE,1/2, CHINA	4	347	\N	t	142.50	0.00	350.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3668	MLCN-NOBR-0003	FITTING L-TYPE,3/8, CHINA	4	347	\N	t	120.00	0.00	280.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3669	MLCN-NOBR-0004	FITTING STRAIGHT, 1/2, CHINA	4	347	\N	t	45.00	0.00	100.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3670	BLSC-NOBR-0003	7x3.5, NC, CHINA	4	116	\N	t	9.75	0.00	25.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3671	BLSC-NOBR-0004	NC, CHINA	4	116	\N	t	22.50	0.00	55.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3672	BLSC-NOBR-0005	NC, CHINA	4	116	\N	t	31.50	0.00	80.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3673	ALBR-OCCX-0003	\N	186	305	\N	t	22.50	0.00	55.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3674	ALBR-OCCX-0004	\N	186	305	\N	t	22.50	0.00	0.00	\N	\N	0	f	0	SET/S	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3675	ALBR-OCCX-0005	\N	186	305	\N	t	22.50	0.00	0.00	\N	\N	0	f	0	SET/S	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3676	ALBR-OCCX-0006	\N	186	305	\N	t	25.50	0.00	0.00	\N	\N	0	f	0	SET/S	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3677	ALBR-OCCX-0007	\N	186	305	\N	t	22.50	0.00	0.00	\N	\N	0	f	0	SET/S	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3678	MLCN-NOBR-0007	FITTING STRAIGHT, 1/4, CHINA	4	347	\N	t	41.25	0.00	0.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3679	AERO-ADVI-0001		145	164		t	51.00	0.00	61.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 12:12:23.122409+00	1	\N	\N	\N
3680	ACCA-3MXX-0001		61	18		t	0.00	0.00	0.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 12:46:47.083685+00	\N	\N	\N	\N
3681	ACCA-3MXX-0002	test	61	18		t	0.00	0.00	0.00	\N	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-06 22:57:13.991794+00	\N	\N	\N	\N
1819	BLSC-NOBR-0001	\N	4	116	\N	t	0.00	0.00	45.00	2025-09-07 02:08:42.839041+00	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2	OISE-MUSA-0002	104*137*13	1	1		f	547.00	0.00	1000.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	2025-09-07 14:05:54.869138+00	1	\N
2066	OIFI-VICX-0011		94	38		t	201.00	0.00	370.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	2025-09-07 15:51:46.788374+00	1	\N
654	RIBE-BAND-0002	PLAIN	46	23	\N	t	0.00	0.00	370.00	2025-09-14 22:32:47.316817+00	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
841	ENOI-CAST-0001	GAL	57	82	\N	t	0.00	0.00	1200.00	2025-09-15 05:26:10.328939+00	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3683	ABPI-3MXX-0001		61	226		t	0.00	0.00	0.00	\N	\N	1	t	1	pcs	\N	t	t	t	f	2025-09-07 16:36:22.840374+00	1	\N	\N	\N
3684	AICL-ADVI-0001		145	110		t	0.00	0.00	0.00	\N	\N	1	t	1	pcs	\N	t	t	t	f	2025-09-07 16:50:12.464828+00	1	\N	\N	\N
480	BEAR-KORE-0002	\N	16	9	\N	t	235.00	235.00	430.00	2025-09-09 00:38:49.728702+00	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3682	ACCA-3MXX-0003		61	18		t	0.00	0.00	0.00	2025-09-09 00:38:49.728702+00	\N	0	f	0	pcs	\N	f	t	t	f	2025-09-07 14:48:11.701818+00	1	\N	\N	\N
3685	ABPI-5WOR-0001		128	226		t	0.00	0.00	0.00	2025-09-09 00:38:49.728702+00	\N	1	t	1	pcs	\N	t	t	t	f	2025-09-07 17:25:11.746372+00	1	\N	\N	\N
3686	AERO-555X-0001		166	164		t	0.00	0.00	0.00	2025-09-09 00:38:49.728702+00	\N	1	t	1	pcs	\N	t	t	t	f	2025-09-07 22:07:41.266131+00	1	\N	\N	\N
712	BEAR-KOYO-0007	\N	11	9	\N	t	218.00	218.00	930.00	2025-09-09 00:38:49.728702+00	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
710	BEAR-KOYO-0005	\N	11	9	\N	t	324.00	324.00	1200.00	2025-09-09 00:38:49.728702+00	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3688	AMGA-ARMT-0001		68	232		t	0.00	0.00	0.00	\N	\N	1	t	1	pcs	\N	t	t	t	f	2025-09-09 02:45:22.837503+00	1	\N	\N	\N
1476	SPPL-BOSC-0004	SUPPRESSED	93	172	\N	t	535.00	535.00	550.00	2025-09-10 00:55:55.533907+00	2025-09-10 00:55:55.533907+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
258	CATI-NOBR-0001	\N	4	2	\N	t	0.00	0.00	\N	2025-09-09 03:35:17.028206+00	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
595	ENMO-JAGX-0001	\N	38	45	\N	t	0.00	0.00	1230.00	2025-09-09 03:40:10.500798+00	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
390	BEAR-KOYO-0001	\N	11	9	\N	t	0.00	0.00	150.00	2025-09-09 03:40:41.620319+00	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
364	AIFI-UNAS-0001	ELEMENT	7	6	\N	t	270.00	270.00	350.00	2025-09-14 03:50:09.349506+00	2025-09-10 00:55:55.533907+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3025	ENOI-PETR-0002	REV-X	156	82	\N	t	0.00	0.00	\N	2025-09-09 03:51:07.956089+00	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2103	SHAB-TOKI-0009	\N	32	41	\N	t	0.00	0.00	2600.00	2025-09-09 04:06:40.233761+00	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
901	VAGU-YSMW-0001	\N	58	89	\N	t	0.00	0.00	1100.00	2025-09-09 04:08:31.668998+00	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
978	RETA-YSMW-0001	FORTUNER/INNOVA	58	104	\N	t	780.00	780.00	1380.00	2025-09-10 00:55:55.533907+00	2025-09-10 00:55:55.533907+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
766	HAOU-TAIW-0002	\N	22	74	\N	t	0.00	0.00	800.00	2025-09-14 22:24:05.921351+00	2025-09-10 00:55:55.533907+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3689	AERO-3MXX-0001		61	164		t	0.00	0.00	0.00	\N	\N	1	t	1	pcs	\N	t	t	t	f	2025-09-09 23:41:52.395755+00	1	\N	\N	\N
3690	ABPI-555X-0001		166	226		t	123.00	0.00	456.00	\N	\N	1	t	1	pcs	\N	t	t	t	f	2025-09-10 00:06:28.968538+00	1	\N	\N	\N
1042	BRPA-NBKX-0003	\N	20	11	\N	t	480.00	480.00	900.00	2025-09-10 00:47:38.110312+00	2025-09-10 00:47:38.110312+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
490	BUHO-ZAPP-0001	12V	18	26	\N	t	160.00	160.00	350.00	2025-09-10 00:47:38.110312+00	2025-09-10 00:47:38.110312+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1036	BRPA-NBKX-0002	\N	20	11	\N	t	390.00	390.00	800.00	2025-09-10 00:55:55.533907+00	2025-09-10 00:55:55.533907+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1127	CLDI-AISI-0002	6 3/4"X18T	62	27	\N	t	685.00	685.00	1250.00	2025-09-10 00:55:55.533907+00	2025-09-10 00:55:55.533907+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
652	HEGA-FEMO-0001	SURP CRBN.TYPE COMP. TYP	45	64	\N	t	500.00	500.00	850.00	2025-09-10 00:55:55.533907+00	2025-09-10 00:55:55.533907+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
765	HAOU-TAIW-0001	\N	22	74	\N	t	460.00	460.00	800.00	2025-09-10 00:55:55.533907+00	2025-09-10 00:55:55.533907+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
857	ROAR-YSMW-0001	\N	58	87	\N	t	480.00	480.00	850.00	2025-09-10 00:55:55.533907+00	2025-09-10 00:55:55.533907+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
858	ROAR-YSMW-0002	\N	58	87	\N	t	220.00	220.00	400.00	2025-09-10 00:55:55.533907+00	2025-09-10 00:55:55.533907+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1043	BRPA-NBKX-0004	\N	20	11	\N	t	460.00	460.00	800.00	2025-09-10 00:55:55.533907+00	2025-09-10 00:55:55.533907+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
613	TLSO-NUPR-0001	BRAZILLA S.C CERAMIC	40	49	\N	t	18.00	18.00	50.00	2025-09-10 00:55:55.533907+00	2025-09-10 00:55:55.533907+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
697	COLA-NUPR-0002	YELLOW	40	62	\N	t	240.00	240.00	450.00	2025-09-10 00:55:55.533907+00	2025-09-10 00:55:55.533907+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
621	DOLO-TAIW-0001	\N	22	52	\N	t	480.00	480.00	850.00	2025-09-10 00:55:55.533907+00	2025-09-10 00:55:55.533907+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1158	SPBU-KICH-0007	V-10	73	138	\N	t	122.00	122.00	250.00	2025-09-10 00:55:55.533907+00	2025-09-10 00:55:55.533907+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2781	FLNU-NOBR-0002	10*4	4	307	\N	t	21.00	21.00	40.00	2025-09-10 00:55:55.533907+00	2025-09-10 00:55:55.533907+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1220	MIRR-SGMX-0032	TRUCK MIRROR HEAD	56	81	\N	t	370.00	370.00	650.00	2025-09-10 00:55:55.533907+00	2025-09-10 00:55:55.533907+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1790	CYHE-ERIS-0001	\N	123	101	\N	t	4300.00	4300.00	0.00	2025-09-10 00:55:55.533907+00	2025-09-10 00:55:55.533907+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2408	DOLO-NOBR-0001	\N	4	52	\N	t	440.00	440.00	800.00	2025-09-10 00:55:55.533907+00	2025-09-10 00:55:55.533907+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
846	CPSE-YSMW-0002	\N	58	83	\N	t	1500.00	1500.00	2600.00	2025-09-10 00:55:55.533907+00	2025-09-10 00:55:55.533907+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1052	RAHO-NIHO-0009	S TYPE 3' SHORT UPPER	69	123	\N	t	714.00	714.00	1200.00	2025-09-10 00:55:55.533907+00	2025-09-10 00:55:55.533907+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
816	FUFI-NOBR-0001	METAL HIGH QUALITY	4	19	\N	t	240.00	240.00	420.00	2025-09-10 00:55:55.533907+00	2025-09-10 00:55:55.533907+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
1950	FUGA-BLIT-0001	\N	86	234	\N	t	530.00	530.00	800.00	2025-09-10 00:55:55.533907+00	2025-09-10 00:55:55.533907+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
4	OISE-MUSA-0004	117*174*15.5*28 nanana	242	1		t	6.00	52.55	7.00	2025-09-10 02:52:57.018058+00	2025-09-10 02:52:57.018058+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	2025-09-09 23:39:48.372474+00	1	\N
3687	AERO-555X-0002		166	164		t	5.00	5.00	6.00	2025-09-10 02:57:37.465656+00	2025-09-10 02:57:37.465656+00	1	t	1	pcs	\N	t	t	t	f	2025-09-09 00:41:19.677349+00	1	2025-09-09 03:46:23.130611+00	1	\N
386	FRHO-MAPO-0001	3/8"	9	7	\N	t	1400.00	1400.00	55.00	2025-09-10 00:55:55.533907+00	2025-09-10 00:55:55.533907+00	1	t	2	FT	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
2262	WHCY-ORIO-0001	3/4 ALUMINUM 35MM W/O BLEEDER RR	24	34	\N	t	765.00	765.00	1400.00	2025-09-10 00:55:55.533907+00	2025-09-10 00:55:55.533907+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
476	UJOI-KORE-0001	\N	16	20	\N	t	535.00	535.00	1000.00	2025-09-10 00:55:55.533907+00	2025-09-10 00:55:55.533907+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
717	UJOI-KOYO-0001	\N	11	20	\N	t	539.00	539.00	1800.00	2025-09-10 00:55:55.533907+00	2025-09-10 00:55:55.533907+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
6	OISE-MUSA-0006	120*153*15; RETAINER TYPE	1	1	\N	t	511.00	511.00	870.00	2025-09-10 00:55:55.533907+00	2025-09-10 00:55:55.533907+00	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
3691	ACCA-3MXX-0004		61	18		t	0.00	0.00	0.00	\N	\N	1	t	1	pcs	\N	t	t	t	f	2025-09-12 09:14:23.890917+00	1	\N	\N	\N
3692	ACCA-3MXX-0005		61	18		t	0.00	0.00	0.00	\N	\N	1	t	1	pcs	\N	t	t	t	f	2025-09-12 09:14:34.081045+00	1	\N	\N	\N
3226	OISE-MUSA-0075-merged-52	75*121*13	1	1	\N	f	102.00	0.00	200.00	\N	\N	1	t	2	\N	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	2025-09-12 14:27:20.600459+00	\N	52
1571	VSCA-ORIO-0001-merged-1589	\N	24	180	\N	f	22.00	0.00	450.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	2025-09-12 15:39:18.84678+00	\N	1589
1643	BRSH-NBKX-0001-merged-2257	\N	20	55	\N	f	2500.00	0.00	4400.00	\N	\N	1	t	2	SET/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	2025-09-12 15:44:15.187981+00	\N	2257
1475	FUFI-VICX-0005-merged-1469	\N	94	19	\N	f	369.00	0.00	950.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	2025-09-12 23:38:44.609505+00	\N	1469
1417	MIRR-SGMX-0040-merged-840	RH/LH	56	81	\N	f	125.00	0.00	250.00	\N	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	2025-09-13 00:17:09.09415+00	\N	840
3693	ACCA-555X-0001	SHANG	166	18		t	0.00	0.00	0.00	\N	\N	1	t	1	pcs	\N	t	t	t	f	2025-09-13 00:17:58.134054+00	2	\N	\N	\N
3694	ACCA-555X-0002	SHANG	166	18		t	0.00	0.00	0.00	\N	\N	1	t	1	pcs	\N	t	t	t	f	2025-09-13 00:18:58.995454+00	2	\N	\N	\N
3640	GACE-VTEC-0001	59ML VITAL SHELLAC	238	346	\N	t	0.00	0.00	120.00	2025-09-15 05:25:59.712399+00	\N	1	t	2	PC/S	\N	t	t	t	f	2025-09-06 11:53:27.753094+00	\N	\N	\N	\N
\.


--
-- Data for Name: part_aliases; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.part_aliases (id, part_id, alias_value, alias_type, source_part_id, created_at) FROM stdin;
7	2746	BAJO-GMBX-0005	sku	2770	2025-09-12 14:10:45.468791+00
8	2746	BAJO-GMBX-0005	display_name	2770	2025-09-12 14:10:45.468791+00
9	2746	0104-0546	part_number	2770	2025-09-12 14:10:45.468791+00
10	560	CMKI-TOKI-0003	sku	1490	2025-09-12 14:21:57.903416+00
11	560	CMKI-TOKI-0003	display_name	1490	2025-09-12 14:21:57.903416+00
12	560	04311-27020	part_number	1490	2025-09-12 14:21:57.903416+00
13	52	OISE-MUSA-0075	sku	3226	2025-09-12 14:27:20.600459+00
14	52	OISE-MUSA-0075	display_name	3226	2025-09-12 14:27:20.600459+00
15	52	0600-26-154	part_number	3226	2025-09-12 14:27:20.600459+00
16	52	M4154	part_number	3226	2025-09-12 14:27:20.600459+00
17	1642	BRPA-GENU-0002	sku	2259	2025-09-12 15:36:06.889229+00
18	1642	BRPA-GENU-0002	display_name	2259	2025-09-12 15:36:06.889229+00
19	1642	04465-0K360	part_number	2259	2025-09-12 15:36:06.889229+00
20	1589	VSCA-ORIO-0001	sku	1571	2025-09-12 15:39:18.84678+00
21	1589	VSCA-ORIO-0001	display_name	1571	2025-09-12 15:39:18.84678+00
22	1589	09289-09252	part_number	1571	2025-09-12 15:39:18.84678+00
23	2257	BRSH-NBKX-0001	sku	1643	2025-09-12 15:44:15.187981+00
24	2257	BRSH-NBKX-0001	display_name	1643	2025-09-12 15:44:15.187981+00
25	2257	04495-OK120	part_number	1643	2025-09-12 15:44:15.187981+00
26	1572	VSCA-NOKX-0002	sku	2090	2025-09-12 15:47:40.171709+00
27	1572	VSCA-NOKX-0002	display_name	2090	2025-09-12 15:47:40.171709+00
28	1572	09289-06012	part_number	2090	2025-09-12 15:47:40.171709+00
29	1467	OIFI-VICX-0002	sku	1472	2025-09-12 23:38:44.347898+00
30	1467	OIFI-VICX-0002	display_name	1472	2025-09-12 23:38:44.347898+00
31	1467	0986AF1023	part_number	1472	2025-09-12 23:38:44.347898+00
32	1467	C-806	part_number	1472	2025-09-12 23:38:44.347898+00
33	1468	FUFI-VICX-0004	sku	1474	2025-09-12 23:38:44.517573+00
34	1468	FUFI-VICX-0004	display_name	1474	2025-09-12 23:38:44.517573+00
35	1468	0986AF6009	part_number	1474	2025-09-12 23:38:44.517573+00
36	1468	FC-235	part_number	1474	2025-09-12 23:38:44.517573+00
37	1469	FUFI-VICX-0005	sku	1475	2025-09-12 23:38:44.609505+00
38	1469	FUFI-VICX-0005	display_name	1475	2025-09-12 23:38:44.609505+00
39	1469	0986AF6008	part_number	1475	2025-09-12 23:38:44.609505+00
40	1469	FC-607	part_number	1475	2025-09-12 23:38:44.609505+00
41	1201	SILA-SGMX-0004	sku	1202	2025-09-13 00:06:50.247424+00
42	1201	SILA-SGMX-0004	display_name	1202	2025-09-13 00:06:50.247424+00
43	1201	12V GREEN	part_number	1202	2025-09-13 00:06:50.247424+00
44	1201	SAL1223L	part_number	1202	2025-09-13 00:06:50.247424+00
45	1199	SILA-SGMX-0002	sku	1200	2025-09-13 00:06:50.413982+00
46	1199	SILA-SGMX-0002	display_name	1200	2025-09-13 00:06:50.413982+00
47	1199	24V GREEN	part_number	1200	2025-09-13 00:06:50.413982+00
48	1199	SAL1215L	part_number	1200	2025-09-13 00:06:50.413982+00
49	840	MIRR-SGMX-0040	sku	1417	2025-09-13 00:17:09.09415+00
50	840	MIRR-SGMX-0040	display_name	1417	2025-09-13 00:17:09.09415+00
51	840	SM-2833	part_number	1417	2025-09-13 00:17:09.09415+00
\.


--
-- Data for Name: part_application; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.part_application (part_app_id, part_id, application_id, year_start, year_end) FROM stdin;
2	2	2	\N	\N
3	841	3	\N	\N
\.


--
-- Data for Name: part_merge_log; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.part_merge_log (id, merged_at, actor_employee_id, keep_part_id, merged_part_id, field_overrides, merge_rules, updated_counts, warnings, created_at) FROM stdin;
1	2025-09-12 14:10:45.468791+00	2	2746	2770	{}	{}	{"invoice_line": 0, "credit_note_line": 0, "goods_receipt_line": 0, "purchase_order_line": 0, "inventory_transaction": 0, "inventory_consolidated": 0}	[]	2025-09-12 14:10:45.468791+00
2	2025-09-12 14:21:57.903416+00	2	560	1490	{}	{}	{"invoice_line": 0, "credit_note_line": 0, "goods_receipt_line": 0, "purchase_order_line": 0, "inventory_transaction": 0, "inventory_consolidated": 0}	[]	2025-09-12 14:21:57.903416+00
3	2025-09-12 14:27:20.600459+00	2	52	3226	{}	{}	{"invoice_line": 0, "credit_note_line": 0, "goods_receipt_line": 0, "purchase_order_line": 0, "inventory_transaction": 0, "inventory_consolidated": 0}	[]	2025-09-12 14:27:20.600459+00
4	2025-09-12 15:36:06.889229+00	2	1642	2259	{}	{"fieldOverrides": {}, "preserveHistory": true, "mergePartNumbers": true, "mergeApplications": true}	{"invoice_line": 0, "part_numbers": 0, "credit_note_line": 0, "part_applications": 0, "goods_receipt_line": 0, "purchase_order_line": 0, "inventory_transaction": 0, "inventory_consolidated": 0}	[]	2025-09-12 15:36:06.889229+00
5	2025-09-12 15:39:18.84678+00	2	1589	1571	{}	{"fieldOverrides": {}, "preserveHistory": true, "mergePartNumbers": true, "mergeApplications": true}	{"invoice_line": 0, "part_numbers": 0, "credit_note_line": 0, "part_applications": 0, "goods_receipt_line": 0, "purchase_order_line": 0, "inventory_transaction": 0, "inventory_consolidated": 0}	[]	2025-09-12 15:39:18.84678+00
6	2025-09-12 15:44:15.187981+00	2	2257	1643	{}	{"fieldOverrides": {}, "preserveHistory": true, "mergePartNumbers": true, "mergeApplications": true}	{"invoice_line": 0, "part_numbers": 0, "credit_note_line": 0, "part_applications": 0, "goods_receipt_line": 0, "purchase_order_line": 0, "inventory_transaction": 0, "inventory_consolidated": 0}	[]	2025-09-12 15:44:15.187981+00
7	2025-09-12 15:47:40.171709+00	2	1572	2090	{}	{"mergeTags": true, "fieldOverrides": {}, "preserveHistory": true, "mergePartNumbers": true, "mergeApplications": true}	{"invoice_line": 0, "part_numbers": 0, "credit_note_line": 0, "part_applications": 0, "goods_receipt_line": 0, "purchase_order_line": 0, "inventory_transaction": 0, "inventory_consolidated": 0}	[]	2025-09-12 15:47:40.171709+00
8	2025-09-12 23:38:44.347898+00	2	1467	1472	{}	{"mergeTags": true, "fieldOverrides": {}, "preserveHistory": true, "mergePartNumbers": true, "mergeApplications": true}	{"invoice_line": 0, "part_numbers": 0, "credit_note_line": 0, "part_applications": 0, "goods_receipt_line": 0, "purchase_order_line": 0, "inventory_transaction": 0, "inventory_consolidated": 0}	[]	2025-09-12 23:38:44.347898+00
9	2025-09-12 23:38:44.517573+00	2	1468	1474	{}	{"mergeTags": true, "fieldOverrides": {}, "preserveHistory": true, "mergePartNumbers": true, "mergeApplications": true}	{"invoice_line": 0, "part_numbers": 0, "credit_note_line": 0, "part_applications": 0, "goods_receipt_line": 0, "purchase_order_line": 0, "inventory_transaction": 0, "inventory_consolidated": 0}	[]	2025-09-12 23:38:44.517573+00
10	2025-09-12 23:38:44.609505+00	2	1469	1475	{}	{"mergeTags": true, "fieldOverrides": {}, "preserveHistory": true, "mergePartNumbers": true, "mergeApplications": true}	{"invoice_line": 0, "part_numbers": 0, "credit_note_line": 0, "part_applications": 0, "goods_receipt_line": 0, "purchase_order_line": 0, "inventory_transaction": 0, "inventory_consolidated": 0}	[]	2025-09-12 23:38:44.609505+00
11	2025-09-13 00:06:50.247424+00	2	1201	1202	{}	{"mergeTags": true, "fieldOverrides": {}, "preserveHistory": true, "mergePartNumbers": true, "mergeApplications": true}	{"invoice_line": 0, "part_numbers": 1, "credit_note_line": 0, "part_applications": 0, "goods_receipt_line": 0, "purchase_order_line": 0, "inventory_transaction": 0, "inventory_consolidated": 0}	[]	2025-09-13 00:06:50.247424+00
12	2025-09-13 00:06:50.413982+00	2	1199	1200	{}	{"mergeTags": true, "fieldOverrides": {}, "preserveHistory": true, "mergePartNumbers": true, "mergeApplications": true}	{"invoice_line": 0, "part_numbers": 1, "credit_note_line": 0, "part_applications": 0, "goods_receipt_line": 0, "purchase_order_line": 0, "inventory_transaction": 0, "inventory_consolidated": 0}	[]	2025-09-13 00:06:50.413982+00
13	2025-09-13 00:17:09.09415+00	2	840	1417	{}	{"mergeTags": true, "fieldOverrides": {}, "preserveHistory": true, "mergePartNumbers": true, "mergeApplications": true}	{"invoice_line": 0, "part_numbers": 0, "credit_note_line": 0, "part_applications": 0, "goods_receipt_line": 0, "purchase_order_line": 0, "inventory_transaction": 0, "inventory_consolidated": 0}	[]	2025-09-13 00:17:09.09415+00
\.


--
-- Data for Name: part_number; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.part_number (part_number_id, part_id, part_number, number_type, display_order, deleted_at, deleted_by) FROM stdin;
4133	3680	TEST987	\N	1	\N	\N
4134	3681	TEST987	\N	1	\N	\N
4135	3682	test	\N	1	\N	\N
4140	3687	att123	\N	\N	\N	\N
4142	3689	OEM412	\N	\N	\N	\N
4144	3691	test123	\N	\N	\N	\N
1698	1472	0986AF1023	\N	1	2025-09-12 23:38:44.347898+00	\N
1699	1472	C-806	\N	2	2025-09-12 23:38:44.347898+00	\N
1703	1474	FC-235	\N	2	2025-09-12 23:38:44.517573+00	\N
4136	3683	test	\N	1	\N	\N
4141	3688	tea456	\N	\N	\N	\N
4143	3690	INV64	\N	\N	\N	\N
4145	3692	test123	\N	\N	\N	\N
1250	1201	12V GREEN	\N	1	\N	\N
1251	1202	SAL1223L	\N	2	2025-09-13 00:06:50.247424+00	\N
1247	1200	SAL1215L	\N	2	2025-09-13 00:06:50.413982+00	\N
4137	3684	OEM431	\N	1	\N	\N
4146	3693	NEW6479	\N	\N	\N	\N
4138	3685	dfd	\N	1	\N	\N
4147	3694	NEW6479	\N	\N	\N	\N
4139	3686	test	\N	1	\N	\N
1836	1571	09289-09252	\N	1	2025-09-12 15:39:18.84678+00	\N
1921	1643	04495-OK120	\N	1	2025-09-12 15:44:15.187981+00	\N
2431	2090	09289-06012	\N	1	2025-09-12 15:47:40.171709+00	\N
3426	3043	672	\N	1	\N	\N
3	2	8-976025-378	\N	1	\N	\N
4	2	I3708	\N	2	\N	\N
5	3	8-97329-780-0	\N	1	\N	\N
6	3	I3692	\N	2	\N	\N
7	4	1-09625-350	\N	1	\N	\N
8	4	I3600	\N	2	\N	\N
9	5	1-09625-200-0	\N	1	\N	\N
10	5	I3620	\N	2	\N	\N
11	6	1-09625-506	\N	1	\N	\N
12	6	I3666	\N	2	\N	\N
13	7	13558	\N	1	\N	\N
14	7	9-09924-393	\N	2	\N	\N
15	8	F4175	\N	1	\N	\N
16	8	MHO34175	\N	2	\N	\N
17	9	F4025	\N	1	\N	\N
18	9	MH034092	\N	2	\N	\N
19	10	03434-14500	\N	1	\N	\N
20	10	F4060	\N	2	\N	\N
21	11	F4134	\N	1	\N	\N
22	11	MC807438	\N	2	\N	\N
23	12	1-51389-005	\N	1	\N	\N
24	12	13621	\N	2	\N	\N
25	13	03434-15520	\N	1	\N	\N
26	13	F4063	\N	2	\N	\N
27	14	12857-16700	\N	1	\N	\N
28	14	F4200	\N	2	\N	\N
29	15	90311-17092	\N	1	\N	\N
30	15	T1017	\N	2	\N	\N
31	16	48029-W0501	\N	1	\N	\N
32	16	N2233	\N	2	\N	\N
33	17	90311-18021	\N	1	\N	\N
34	17	T1018	\N	2	\N	\N
35	18	90311-19001	\N	1	\N	\N
36	18	T1019	\N	2	\N	\N
37	19	9958-62-2358	\N	1	\N	\N
38	19	M4598	\N	2	\N	\N
39	20	1-44259-036	\N	1	\N	\N
40	20	13700	\N	2	\N	\N
41	21	49321-Y0100	\N	1	\N	\N
42	21	N2173	\N	2	\N	\N
43	22	1391-26-157	\N	1	\N	\N
44	22	M4520	\N	2	\N	\N
45	23	90310-30035	\N	1	\N	\N
46	23	T1140	\N	2	\N	\N
47	24	B630-10-602	\N	1	\N	\N
48	24	M4619	\N	2	\N	\N
49	25	F4129	\N	1	\N	\N
50	25	MH034067	\N	2	\N	\N
51	26	09283-32038	\N	1	\N	\N
52	26	26125	\N	2	\N	\N
53	27	0604-26-184	\N	1	\N	\N
54	27	M4552	\N	2	\N	\N
55	28	F4104	\N	1	\N	\N
56	28	MD050606	\N	2	\N	\N
57	29	F4224	\N	1	\N	\N
58	29	MD343563	\N	2	\N	\N
59	30	F4151	\N	1	\N	\N
60	30	MB308933	\N	2	\N	\N
61	31	F4152	\N	1	\N	\N
62	31	MB308934	\N	2	\N	\N
63	32	31311-06101	\N	1	\N	\N
64	32	F4084	\N	2	\N	\N
65	33	9-09924-511-0	\N	1	\N	\N
66	33	I3540	\N	2	\N	\N
67	34	F4147	\N	1	\N	\N
68	34	MB092437	\N	2	\N	\N
69	35	90313-54001	\N	1	\N	\N
70	35	T1337	\N	2	\N	\N
71	36	9958-55-5782	\N	1	\N	\N
72	36	M4526	\N	2	\N	\N
73	37	F4201	\N	1	\N	\N
74	37	ME013384	\N	2	\N	\N
75	38	F4220	\N	1	\N	\N
76	38	MB308966	\N	2	\N	\N
77	39	1-09625-044	\N	1	\N	\N
78	39	I3594	\N	2	\N	\N
79	40	F4176	\N	1	\N	\N
80	40	MH034193	\N	2	\N	\N
81	41	13510-43G00	\N	1	\N	\N
82	41	N2255	\N	2	\N	\N
83	42	03431-06000	\N	1	\N	\N
84	42	F4043	\N	2	\N	\N
85	43	F4044	\N	1	\N	\N
86	43	MH034134	\N	2	\N	\N
87	44	8-94373-765	\N	1	\N	\N
88	44	I3545	\N	2	\N	\N
89	45	F4019	\N	1	\N	\N
90	45	MH034006	\N	2	\N	\N
91	46	F4045	\N	1	\N	\N
92	46	MH034135	\N	2	\N	\N
93	47	F4028	\N	1	\N	\N
94	47	MB161152	\N	2	\N	\N
95	48	9-09924-374-0	\N	1	\N	\N
96	48	I3555	\N	2	\N	\N
97	49	F4101	\N	1	\N	\N
98	49	MB161139	\N	2	\N	\N
99	50	1-09625-379	\N	1	\N	\N
100	50	I3595	\N	2	\N	\N
101	51	F4260	\N	1	\N	\N
102	51	ME074755	\N	2	\N	\N
103	52	0600-26-154	\N	1	\N	\N
104	52	M4514	\N	2	\N	\N
105	53	F4194	\N	1	\N	\N
106	53	ME071269	\N	2	\N	\N
107	54	9-09924-392	\N	1	\N	\N
108	54	I3557	\N	2	\N	\N
109	55	1-09625-444	\N	1	\N	\N
110	55	I3591	\N	2	\N	\N
111	56	8-97122-937	\N	1	\N	\N
112	56	I3675	\N	2	\N	\N
113	57	F4127	\N	1	\N	\N
114	57	ME061853	\N	2	\N	\N
115	58	F4198	\N	1	\N	\N
116	58	ME060124	\N	2	\N	\N
117	59	1-09625-043	\N	1	\N	\N
118	59	I3575	\N	2	\N	\N
119	60	9958-55-5729	\N	1	\N	\N
120	60	M4565	\N	2	\N	\N
121	61	0603-26-154	\N	1	\N	\N
122	61	M4549	\N	2	\N	\N
123	62	90311-38025	\N	1	\N	\N
124	62	T1210	\N	2	\N	\N
125	63	F4102	\N	1	\N	\N
126	63	MB161153	\N	2	\N	\N
127	64	F4108	\N	1	\N	\N
128	64	MB092712	\N	2	\N	\N
129	65	F4061	\N	1	\N	\N
130	65	MH034082	\N	2	\N	\N
131	66	F4196	\N	1	\N	\N
132	66	MH034065	\N	2	\N	\N
133	67	M4628	\N	1	\N	\N
134	67	UB40-26-154	\N	2	\N	\N
135	68	F4193	\N	1	\N	\N
136	68	MB664588	\N	2	\N	\N
137	258	0	\N	1	\N	\N
138	302	45200-86026	\N	1	\N	\N
139	303	48810-85020	\N	1	\N	\N
140	303	48820-85020	\N	2	\N	\N
141	304	48900-85000	\N	1	\N	\N
142	305	FAS-8301	\N	1	\N	\N
143	306	FAS-8303	\N	1	\N	\N
144	307	FAS-8319	\N	1	\N	\N
145	308	FAS-8321	\N	1	\N	\N
146	309	FAS-8332	\N	1	\N	\N
147	310	FAS-8337	\N	1	\N	\N
148	311	FAS-8345	\N	1	\N	\N
149	312	FAS-8346	\N	1	\N	\N
150	313	FAS-8348	\N	1	\N	\N
151	314	FAS-8355	\N	1	\N	\N
152	315	FAS-8356	\N	1	\N	\N
153	316	FAS-8406	\N	1	\N	\N
154	317	FAS-8423	\N	1	\N	\N
155	318	FAS-8427	\N	1	\N	\N
156	319	FAS-8428	\N	1	\N	\N
157	320	FAS-8465	\N	1	\N	\N
158	321	FAS-8469	\N	1	\N	\N
159	322	FAS-8475	\N	1	\N	\N
160	323	FAS-8478	\N	1	\N	\N
161	324	FAS-8479	\N	1	\N	\N
162	325	FAS-8500	\N	1	\N	\N
163	326	FAS-8500	\N	1	\N	\N
164	327	FAS-8503	\N	1	\N	\N
165	328	FAS-8506	\N	1	\N	\N
166	329	FAS-8513	\N	1	\N	\N
167	330	FAS-8521	\N	1	\N	\N
168	331	FAS-8527	\N	1	\N	\N
169	332	FAS-8540	\N	1	\N	\N
170	333	FAS-8555	\N	1	\N	\N
171	334	FAS-8578	\N	1	\N	\N
172	335	FAS-8632	\N	1	\N	\N
173	336	FAS-8640	\N	1	\N	\N
174	337	FAS-8811	\N	1	\N	\N
175	338	FAS-8833	\N	1	\N	\N
176	339	FAS-8837	\N	1	\N	\N
177	340	FAS-8862	\N	1	\N	\N
178	341	FAS-8868	\N	1	\N	\N
179	342	FAS-8906	\N	1	\N	\N
180	343	FAS-8907	\N	1	\N	\N
181	344	FAS-8924	\N	1	\N	\N
182	345	FAS-8927	\N	1	\N	\N
183	346	FAS-8928	\N	1	\N	\N
184	347	FAS-8930	\N	1	\N	\N
185	348	FAS-8944	\N	1	\N	\N
186	349	FAS-8951	\N	1	\N	\N
187	350	FAS-8968	\N	1	\N	\N
188	351	FAS-8970	\N	1	\N	\N
189	352	FAS-8977	\N	1	\N	\N
190	353	FCS-9051	\N	1	\N	\N
191	354	FCS-9067	\N	1	\N	\N
192	355	FCS-9315	\N	1	\N	\N
193	356	FCS-9356	\N	1	\N	\N
194	357	FCS-9477	\N	1	\N	\N
195	358	FCS-9479	\N	1	\N	\N
196	359	FCS-9641	\N	1	\N	\N
197	360	FCS-9858	\N	1	\N	\N
198	361	FCS-9925	\N	1	\N	\N
199	362	FCS-9928	\N	1	\N	\N
200	363	FCS-9951	\N	1	\N	\N
201	364	GA-140	\N	1	\N	\N
202	365	GA-143	\N	1	\N	\N
203	366	GA-3002	\N	1	\N	\N
204	367	GA-3003	\N	1	\N	\N
205	368	GA-327	\N	1	\N	\N
206	369	GA-306	\N	1	\N	\N
207	369	GA-333	\N	2	\N	\N
208	370	GA-334S	\N	1	\N	\N
209	371	GA-343	\N	1	\N	\N
210	372	GA-400	\N	1	\N	\N
211	372	GA-442	\N	2	\N	\N
212	373	GA-501	\N	1	\N	\N
213	374	GA-503	\N	1	\N	\N
214	375	GA-504	\N	1	\N	\N
215	376	GA-509	\N	1	\N	\N
216	377	GA-519	\N	1	\N	\N
217	378	GA-522	\N	1	\N	\N
218	379	GPUA-416	\N	1	\N	\N
219	380	GPUA-418	\N	1	\N	\N
220	381	GPUA-419	\N	1	\N	\N
221	382	GPUA-524	\N	1	\N	\N
222	383	GPUA-525	\N	1	\N	\N
223	384	KA-34713	\N	1	\N	\N
224	384	OK71E-23-603	\N	2	\N	\N
225	385	45200-86027	\N	1	\N	\N
226	386	H511095	\N	1	\N	\N
227	387	H511079	\N	1	\N	\N
228	388	H511063	\N	1	\N	\N
229	389	HOSE ONLY	\N	1	\N	\N
230	390	C06	\N	1	\N	\N
231	391	046964-0010	\N	1	\N	\N
232	392	VA-305	\N	1	\N	\N
233	393	121	\N	1	\N	\N
234	394	90033R	\N	1	\N	\N
235	395	4158	\N	1	\N	\N
236	396	4524	\N	1	\N	\N
237	397	4516R	\N	1	\N	\N
238	398	47624R	\N	1	\N	\N
239	399	90023R	\N	1	\N	\N
240	400	7535R	\N	1	\N	\N
241	401	60093R	\N	1	\N	\N
242	402	80263	\N	1	\N	\N
243	403	47546R	\N	1	\N	\N
244	404	47567R	\N	1	\N	\N
245	405	80318R	\N	1	\N	\N
246	406	47589R	\N	1	\N	\N
247	407	120A	\N	1	\N	\N
248	408	4514R	\N	1	\N	\N
249	409	20193R	\N	1	\N	\N
250	410	20073R	\N	1	\N	\N
251	411	7064R	\N	1	\N	\N
252	412	4522R	\N	1	\N	\N
253	413	47565R	\N	1	\N	\N
254	414	90043R	\N	1	\N	\N
255	415	3536R	\N	1	\N	\N
256	416	3534	\N	1	\N	\N
257	417	1499R	\N	1	\N	\N
258	418	80623R	\N	1	\N	\N
259	419	80633R	\N	1	\N	\N
260	420	2101A	\N	1	\N	\N
261	421	20201	\N	1	\N	\N
262	422	31473R	\N	1	\N	\N
263	423	40133R	\N	1	\N	\N
264	424	81383R	\N	1	\N	\N
265	425	81393R	\N	1	\N	\N
266	426	31437R	\N	1	\N	\N
267	427	31439R	\N	1	\N	\N
268	428	7514	\N	1	\N	\N
269	429	1616R	\N	1	\N	\N
270	430	1617R	\N	1	\N	\N
271	431	80183R	\N	1	\N	\N
272	432	20393R	\N	1	\N	\N
273	433	80273	\N	1	\N	\N
274	434	1613R	\N	1	\N	\N
275	435	31439R	\N	1	\N	\N
276	436	31480R	\N	1	\N	\N
277	437	20463R	\N	1	\N	\N
278	438	20473R	\N	1	\N	\N
279	439	30083R	\N	1	\N	\N
280	440	30093R	\N	1	\N	\N
281	441	50253R	\N	1	\N	\N
282	442	50263R	\N	1	\N	\N
283	443	2106	\N	1	\N	\N
284	444	2109	\N	1	\N	\N
285	445	80643R	\N	1	\N	\N
286	446	80653R	\N	1	\N	\N
287	447	80353R	\N	1	\N	\N
288	448	30023	\N	1	\N	\N
289	449	H1001	\N	1	\N	\N
290	450	H1002	\N	1	\N	\N
291	451	H2002	\N	1	\N	\N
292	452	7006R	\N	1	\N	\N
293	453	80493R	\N	1	\N	\N
294	454	80923R	\N	1	\N	\N
295	455	51033R	\N	1	\N	\N
296	456	30183R	\N	1	\N	\N
297	457	7638R	\N	1	\N	\N
298	458	80133R	\N	1	\N	\N
299	459	80204R	\N	1	\N	\N
300	460	80207R	\N	1	\N	\N
301	461	80208R	\N	1	\N	\N
302	462	7631R	\N	1	\N	\N
303	463	80873R	\N	1	\N	\N
304	464	81193R	\N	1	\N	\N
305	465	1310-0110	\N	1	\N	\N
306	466	1310-0109	\N	1	\N	\N
307	467	LITHIUM COMPLEX	\N	1	\N	\N
308	468	163	\N	1	\N	\N
309	469	B-44.3	\N	1	\N	\N
310	470	B-3	\N	1	\N	\N
311	471	OK60C-46-500	\N	1	\N	\N
312	472	OK60A-41-660	\N	1	\N	\N
313	473	31922-26910	\N	1	\N	\N
314	474	31922-2E000	\N	1	\N	\N
315	475	OK88R-12-205	\N	1	\N	\N
316	476	GUMZ-3	\N	1	\N	\N
317	476	GUMZ-4	\N	2	\N	\N
318	477	OK6B0-23-603	\N	1	\N	\N
319	478	32011	\N	1	\N	\N
320	479	FCR54-46-2	\N	1	\N	\N
321	479	FCR54-46-2E	\N	2	\N	\N
322	480	6209	\N	1	\N	\N
323	481	OK88R-15-983	\N	1	\N	\N
324	482	4PK-800	\N	1	\N	\N
325	483	RPF 2285	\N	1	\N	\N
326	483	V10-735	\N	2	\N	\N
327	484	RPF-2305	\N	1	\N	\N
328	484	V10-785	\N	2	\N	\N
329	485	RPF-3400	\N	1	\N	\N
330	485	V13-1025	\N	2	\N	\N
331	486	RPF-3420	\N	1	\N	\N
332	486	V13-1075	\N	2	\N	\N
333	487	RPF-3500	\N	1	\N	\N
334	487	V13-1285	\N	2	\N	\N
335	488	RPF-3270	\N	1	\N	\N
336	488	V13-695	\N	2	\N	\N
337	489	RPF-5570	\N	1	\N	\N
338	489	V15-1460	\N	2	\N	\N
339	490	DL-312	\N	1	\N	\N
340	491	DL-324	\N	1	\N	\N
341	492	ISD-111U	\N	1	\N	\N
342	492	ISD-113U	\N	2	\N	\N
343	493	MFD-013U	\N	1	\N	\N
344	494	MFD-066Y	\N	1	\N	\N
345	495	TYD-042	\N	1	\N	\N
346	496	ISC-572	\N	1	\N	\N
347	497	ISC-530	\N	1	\N	\N
348	498	VA-305K	\N	1	\N	\N
349	499	T595A.50	\N	1	\N	\N
350	500	KT-850	\N	1	\N	\N
351	502	47500-407-0	\N	1	\N	\N
352	505	5-12569-004-0	\N	1	\N	\N
353	506	1-47600-497-1	\N	1	\N	\N
354	507	1-47600-470-0	\N	1	\N	\N
355	508	1-47600-473-1	\N	1	\N	\N
356	509	1-47600-686-0	\N	1	\N	\N
357	510	15910-85215	\N	1	\N	\N
358	511	MB-006605	\N	1	\N	\N
359	512	UB39-39-040	\N	1	\N	\N
360	513	758	\N	1	\N	\N
361	513	759	\N	2	\N	\N
362	514	8-97039-190-3	\N	1	\N	\N
363	515	8-97039-189-3	\N	1	\N	\N
364	516	ME-062600	\N	1	\N	\N
365	518	CPI-49	\N	1	\N	\N
366	519	90915-03002	\N	1	\N	\N
367	520	ME-011807	\N	1	\N	\N
368	521	ME-052272	\N	1	\N	\N
369	522	GA-365	\N	1	\N	\N
370	523	CV-24	\N	1	\N	\N
371	524	16100-85000	\N	1	\N	\N
372	525	OK65A-10-155	\N	1	\N	\N
373	526	09283-60003	\N	1	\N	\N
374	527	GU-1640	\N	1	\N	\N
375	528	09283-78F00	\N	1	\N	\N
376	529	32009J	\N	1	\N	\N
377	530	32009J	\N	1	\N	\N
378	531	3169	\N	1	\N	\N
379	532	3243	\N	1	\N	\N
380	533	3260	\N	1	\N	\N
381	534	2891R	\N	1	\N	\N
382	535	11590	\N	1	\N	\N
383	536	LM11710	\N	1	\N	\N
384	536	LM11749R	\N	2	\N	\N
385	537	4T-M12649	\N	1	\N	\N
386	538	LM12710	\N	1	\N	\N
387	538	LM12749	\N	2	\N	\N
388	539	1220	\N	1	\N	\N
389	539	1280	\N	2	\N	\N
390	540	30205JR	\N	1	\N	\N
391	541	44610	\N	1	\N	\N
392	541	44649	\N	2	\N	\N
393	543	S0-503	\N	1	\N	\N
394	544	S0-356	\N	1	\N	\N
395	544	S0-359	\N	2	\N	\N
396	545	6804 ZZ	\N	1	\N	\N
397	546	6005 ZZ	\N	1	\N	\N
398	547	25250-90004	\N	1	\N	\N
399	548	83420-16010	\N	1	\N	\N
400	549	MC-810258	\N	1	\N	\N
401	549	MC-810259	\N	2	\N	\N
402	550	1-47600-014-0	\N	1	\N	\N
403	551	1-47600-519-0	\N	1	\N	\N
404	552	1-47600-551-0	\N	1	\N	\N
405	553	1-47600-470-0	\N	1	\N	\N
406	554	1-47600-686-0	\N	1	\N	\N
407	555	03243-02001	\N	1	\N	\N
408	556	03243-03000	\N	1	\N	\N
409	557	OK011-41-920	\N	1	\N	\N
410	558	ME-601106	\N	1	\N	\N
411	559	MD-601290	\N	1	\N	\N
412	559	MD-610628	\N	2	\N	\N
413	560	04311-27020	\N	1	\N	\N
414	561	GUIS-62	\N	1	\N	\N
415	562	ME-602333	\N	1	\N	\N
416	563	ME-602994	\N	1	\N	\N
417	564	9344-0329	\N	1	\N	\N
418	565	9344-0330	\N	1	\N	\N
419	566	41660-4AA00	\N	1	\N	\N
420	567	1-87830-370-0	\N	1	\N	\N
421	568	5-87830-403-0	\N	1	\N	\N
422	569	5-87831-597-0	\N	1	\N	\N
423	570	5-87830-825-0	\N	1	\N	\N
424	571	5-87830-617-0	\N	1	\N	\N
425	572	5-87830-942-0	\N	1	\N	\N
426	573	8-94447-209-0	\N	1	\N	\N
427	574	MB-012161	\N	1	\N	\N
428	575	MB-043537	\N	1	\N	\N
429	576	MB-334439	\N	1	\N	\N
430	577	MC-113059	\N	1	\N	\N
431	578	ME-622988	\N	1	\N	\N
432	579	ME-624999	\N	1	\N	\N
433	580	ME-709142	\N	1	\N	\N
434	581	04311-14010	\N	1	\N	\N
435	582	6307 ZNR	\N	1	\N	\N
436	583	32012J	\N	1	\N	\N
437	584	LM102910	\N	1	\N	\N
438	584	LM102949	\N	2	\N	\N
439	595	8-97234-977-2	\N	1	\N	\N
440	596	8-97079-118	\N	1	\N	\N
441	597	8-97079-119	\N	1	\N	\N
442	598	8-94111-903-0	\N	1	\N	\N
443	599	OK60-39-340	\N	1	\N	\N
444	599	OK60A-39-340	\N	2	\N	\N
445	600	OK60-39-040	\N	1	\N	\N
446	600	OK60A-39-040	\N	2	\N	\N
447	601	UB39-39-040	\N	1	\N	\N
448	602	11320-VK300	\N	1	\N	\N
449	603	21811-4A000	\N	1	\N	\N
450	604	21813-4A001	\N	1	\N	\N
451	605	ME-201952	\N	1	\N	\N
452	606	MB-581845	\N	1	\N	\N
453	607	MR-992670	\N	1	\N	\N
454	608	12361-30090	\N	1	\N	\N
455	609	R609K	\N	1	\N	\N
456	610	R6317K	\N	1	\N	\N
457	611	KP-512	\N	1	\N	\N
458	612	M6314K	\N	1	\N	\N
459	612	MP6305K	\N	2	\N	\N
460	613	SQ-215A	\N	1	\N	\N
461	614	SQ-216A	\N	1	\N	\N
462	615	EL-350	\N	1	\N	\N
463	616	SC-40083R	\N	1	\N	\N
464	617	8-97205-136-1	\N	1	\N	\N
465	617	CL-7412C	\N	2	\N	\N
466	618	8-97138-509-0	\N	1	\N	\N
467	618	CL-7412	\N	2	\N	\N
468	619	CL-7162	\N	1	\N	\N
469	619	MR-312030	\N	2	\N	\N
470	620	CL-7150	\N	1	\N	\N
471	620	LT-MB2002	\N	2	\N	\N
472	621	HGIS-4005	\N	1	\N	\N
473	621	HU-IZ7026-LH	\N	2	\N	\N
474	622	HS-5100	\N	1	\N	\N
475	622	HU-MB-7128-LH	\N	2	\N	\N
476	623	HU-MB7111-LH	\N	1	\N	\N
477	624	HGMB-4017	\N	1	\N	\N
478	624	HU-MB7068-LH	\N	2	\N	\N
479	624	MC-905943	\N	3	\N	\N
480	625	HGMB-4002	\N	1	\N	\N
481	625	HU-MB7124-LH	\N	2	\N	\N
482	626	CL-8425	\N	1	\N	\N
483	627	CL-8401	\N	1	\N	\N
484	628	CL-8390	\N	1	\N	\N
485	629	CL-508M-24	\N	1	\N	\N
486	629	WW-00508-C4X	\N	2	\N	\N
487	630	VK-350	\N	1	\N	\N
488	631	VA-8184K	\N	1	\N	\N
489	632	88440-OK020	\N	1	\N	\N
490	633	1145A031	\N	1	\N	\N
491	634	13540-67020	\N	1	\N	\N
492	635	HU-MB3239M-RL1	\N	1	\N	\N
493	635	MR313579-M	\N	2	\N	\N
494	636	HU-MB3239M-RR1	\N	1	\N	\N
495	637	CL-9091	\N	1	\N	\N
496	637	CL-9094	\N	2	\N	\N
497	637	WL-9091	\N	3	\N	\N
498	638	HGTY-2001	\N	1	\N	\N
499	638	HU-TY2501A-LH	\N	2	\N	\N
500	639	HGTY-2001	\N	1	\N	\N
501	639	HU-TY2501A-RH	\N	2	\N	\N
502	640	HGMZ-1017	\N	1	\N	\N
503	640	HU-MZ3187M-TG	\N	2	\N	\N
504	641	33310-70B50	\N	1	\N	\N
505	642	HGTY-1045	\N	1	\N	\N
506	642	HU-TY3180A-FL	\N	2	\N	\N
507	643	HGTY-1045	\N	1	\N	\N
508	643	HU-TY3180A-RER	\N	2	\N	\N
509	644	214-1508-2	\N	1	\N	\N
510	645	214-1508-2	\N	1	\N	\N
511	646	214-2005-C	\N	1	\N	\N
512	647	214-2005-C	\N	1	\N	\N
513	648	GC-503	\N	1	\N	\N
514	649	GC-304	\N	1	\N	\N
515	650	GC-415	\N	1	\N	\N
516	651	GFC-317	\N	1	\N	\N
517	652	RHG-84284	\N	1	\N	\N
518	653	B-52	\N	1	\N	\N
519	654	B-53	\N	1	\N	\N
520	655	B-41	\N	1	\N	\N
521	656	B-43	\N	1	\N	\N
522	657	3PK-800	\N	1	\N	\N
523	658	48655-0K040	\N	1	\N	\N
524	659	UR56-34-470B	\N	1	\N	\N
525	660	8-94408-840	\N	1	\N	\N
526	661	48655-0K080	\N	1	\N	\N
527	662	48654-0K080	\N	1	\N	\N
528	663	0K016	\N	1	\N	\N
529	664	DB-3075	\N	1	\N	\N
530	665	SHG-F6A-2.0-C	\N	1	\N	\N
531	666	SHG-F6A-1.8-C	\N	1	\N	\N
532	667	11400-82860	\N	1	\N	\N
533	668	4PK-870	\N	1	\N	\N
534	669	4PK-875	\N	1	\N	\N
535	670	4PK-1070	\N	1	\N	\N
536	671	4PK-775	\N	1	\N	\N
537	672	4PK-1120	\N	1	\N	\N
538	673	5PK-940	\N	1	\N	\N
539	674	5PK-1820	\N	1	\N	\N
540	675	5PK-1592	\N	1	\N	\N
541	676	6PK-1155	\N	1	\N	\N
542	677	6PK-2100	\N	1	\N	\N
543	678	7PK-1125	\N	1	\N	\N
544	679	7PK-1515	\N	1	\N	\N
545	680	4PK-1730	\N	1	\N	\N
546	681	7PK-1155	\N	1	\N	\N
547	682	RPF-2305	\N	1	\N	\N
548	683	RPF-2250	\N	1	\N	\N
549	684	RPF-2255	\N	1	\N	\N
550	685	RPF-2265	\N	1	\N	\N
551	686	RPF-2300	\N	1	\N	\N
552	687	RPF-2375	\N	1	\N	\N
553	688	A34	\N	1	\N	\N
554	688	RPF-3350	\N	2	\N	\N
555	689	A40	\N	1	\N	\N
556	689	RPF-3410	\N	2	\N	\N
557	690	A42	\N	1	\N	\N
558	690	RPF-3430	\N	2	\N	\N
559	691	A43	\N	1	\N	\N
560	691	RPF-3440	\N	2	\N	\N
561	692	A45	\N	1	\N	\N
562	692	RPF-3460	\N	2	\N	\N
563	693	A51	\N	1	\N	\N
564	693	RPF-3520	\N	2	\N	\N
565	694	A52	\N	1	\N	\N
566	694	RPF-3530	\N	2	\N	\N
567	695	UC-V69	\N	1	\N	\N
568	696	218-1510-C	\N	1	\N	\N
569	697	218-1510-Y	\N	1	\N	\N
570	698	DB-3075	\N	1	\N	\N
571	699	DB-3075	\N	1	\N	\N
572	700	DB-3075	\N	1	\N	\N
573	701	DB-3062	\N	1	\N	\N
574	702	DB-3074	\N	1	\N	\N
575	703	VA-727K	\N	1	\N	\N
576	704	VA-305K	\N	1	\N	\N
577	705	1-13660-012-0	\N	1	\N	\N
578	706	MB-052272	\N	1	\N	\N
579	707	ME-062358	\N	1	\N	\N
580	708	ME-062600	\N	1	\N	\N
581	709	010-90023	\N	1	\N	\N
582	709	SC90023	\N	2	\N	\N
583	710	32216JR	\N	1	\N	\N
584	711	32211JRYA	\N	1	\N	\N
585	712	32212JRYA	\N	1	\N	\N
586	713	32213JRYA	\N	1	\N	\N
587	714	32215JRYA	\N	1	\N	\N
588	715	32219JRYA	\N	1	\N	\N
589	716	CR1364	\N	1	\N	\N
590	717	GUH-73	\N	1	\N	\N
591	718	GUH-71	\N	1	\N	\N
592	719	GUH-64	\N	1	\N	\N
593	720	G5-281X	\N	1	\N	\N
594	721	GUIS-55	\N	1	\N	\N
595	722	GUIS-60	\N	1	\N	\N
596	723	GUIS-68	\N	1	\N	\N
597	724	GUIS-65	\N	1	\N	\N
598	725	GUM-98	\N	1	\N	\N
599	726	G5-8200X	\N	1	\N	\N
600	727	30313D	\N	1	\N	\N
601	728	30315D	\N	1	\N	\N
602	729	NUP311	\N	1	\N	\N
603	730	NUP312	\N	1	\N	\N
604	731	NUP313	\N	1	\N	\N
605	732	NUP314	\N	1	\N	\N
606	733	NUP315	\N	1	\N	\N
607	734	GUM-96	\N	1	\N	\N
608	735	GUH-68	\N	1	\N	\N
609	736	GUIS-72	\N	1	\N	\N
610	737	GUIS-55	\N	1	\N	\N
611	738	GUIS-68	\N	1	\N	\N
612	739	GUM-71	\N	1	\N	\N
613	740	GUM-72	\N	1	\N	\N
614	741	G5-280X	\N	1	\N	\N
615	742	GUM-94	\N	1	\N	\N
616	743	GUM-97	\N	1	\N	\N
617	744	GUH-67	\N	1	\N	\N
618	745	GUIS-59	\N	1	\N	\N
619	746	GUIS-62	\N	1	\N	\N
620	747	GUIS-64	\N	1	\N	\N
621	748	GUIS-57	\N	1	\N	\N
622	749	GUIS-60	\N	1	\N	\N
623	750	GUIS-70	\N	1	\N	\N
624	751	GU-5000	\N	1	\N	\N
625	752	GUM-90	\N	1	\N	\N
626	753	HLK-BONGO 99	\N	1	\N	\N
627	754	M1447 RH	\N	1	\N	\N
628	755	M1447 LH	\N	1	\N	\N
629	756	M1470 RH	\N	1	\N	\N
630	757	M1470 LH	\N	1	\N	\N
631	758	L214-1143 RH	\N	1	\N	\N
632	759	L214-1143 LH	\N	1	\N	\N
633	760	HLI-GIGA RH	\N	1	\N	\N
634	761	HLI-GIGA LH	\N	1	\N	\N
635	762	M1395 RH	\N	1	\N	\N
636	763	M1395 LH	\N	1	\N	\N
637	764	SG401	\N	1	\N	\N
638	764	SG402	\N	2	\N	\N
639	765	MBI020FRT RH	\N	1	\N	\N
640	766	MBI020FRT LH	\N	1	\N	\N
641	767	MBI020RR RH	\N	1	\N	\N
642	768	MBI020RR LH	\N	1	\N	\N
643	769	MB2023 RH	\N	1	\N	\N
644	770	MB2023 LH	\N	1	\N	\N
645	771	HY2012 RH	\N	1	\N	\N
646	772	HY2012 LH	\N	1	\N	\N
647	773	HY2013 RH	\N	1	\N	\N
648	774	K11002FRT RH	\N	1	\N	\N
649	774	KIA3950	\N	2	\N	\N
650	775	KE1002FRT LH	\N	1	\N	\N
651	776	IS1002 RH	\N	1	\N	\N
652	777	IS1002 LH	\N	1	\N	\N
653	778	MB1015	\N	1	\N	\N
654	779	TY1013 FRT RH	\N	1	\N	\N
655	780	TY1013FRT LH	\N	1	\N	\N
656	781	SK1009A RH	\N	1	\N	\N
657	782	SK1009A LH	\N	1	\N	\N
658	783	SKDH004 RH	\N	1	\N	\N
659	784	SKDH004 LH	\N	1	\N	\N
660	785	SK2012A RH	\N	1	\N	\N
661	786	SK2012A LH	\N	1	\N	\N
662	787	HLS-SCRUM RH	\N	1	\N	\N
663	788	HLS-SCRUM LH	\N	1	\N	\N
664	789	KTB-18250	\N	1	\N	\N
665	790	KTB-18280	\N	1	\N	\N
666	791	KTB-18330	\N	1	\N	\N
667	792	T100-T21271	\N	1	\N	\N
668	793	19145-26060	\N	1	\N	\N
669	794	080304 LH	\N	1	\N	\N
670	795	080304 RH	\N	1	\N	\N
671	796	1-53225-187-0	\N	1	\N	\N
672	796	CTS-5187	\N	2	\N	\N
673	797	CSI-308	\N	1	\N	\N
674	797	KA-1630A	\N	2	\N	\N
675	798	CSI-309	\N	1	\N	\N
676	798	KA-1015	\N	2	\N	\N
677	799	444217	\N	1	\N	\N
678	799	CSM-275	\N	2	\N	\N
679	799	KA-2656	\N	3	\N	\N
680	800	444184	\N	1	\N	\N
681	800	CSM-276	\N	2	\N	\N
682	800	KA-2185	\N	3	\N	\N
683	801	444060	\N	1	\N	\N
684	801	CSM-277	\N	2	\N	\N
685	801	KA-2611	\N	3	\N	\N
686	802	444109	\N	1	\N	\N
687	802	CSM-278	\N	2	\N	\N
688	802	KA-2021	\N	3	\N	\N
689	803	444213	\N	1	\N	\N
690	803	CSI-305	\N	2	\N	\N
691	803	KA-2648	\N	3	\N	\N
692	804	444180	\N	1	\N	\N
693	804	CSI-306	\N	2	\N	\N
694	804	KA-2038	\N	3	\N	\N
695	805	340034	\N	1	\N	\N
696	805	CSM-271G	\N	2	\N	\N
697	806	349090	\N	1	\N	\N
698	806	CSM-272G	\N	2	\N	\N
699	807	3PK-630	\N	1	\N	\N
700	808	3PK-635	\N	1	\N	\N
701	809	3PK-650	\N	1	\N	\N
702	810	3PK-735	\N	1	\N	\N
703	811	3PK-765	\N	1	\N	\N
704	812	3PK-830	\N	1	\N	\N
705	813	3PK-840	\N	1	\N	\N
706	814	3PK-780	\N	1	\N	\N
707	815	42450-52060	\N	1	\N	\N
708	815	MWH-060	\N	2	\N	\N
709	816	FC-321	\N	1	\N	\N
710	816	MB-220900	\N	2	\N	\N
711	817	STL-179L	\N	1	\N	\N
712	818	MC-843790	\N	1	\N	\N
713	819	SFL-399L	\N	1	\N	\N
714	820	SFL-399L	\N	1	\N	\N
715	821	SFL-499L	\N	1	\N	\N
716	822	SFL-499L	\N	1	\N	\N
717	823	SM-2864	\N	1	\N	\N
718	824	SM-2877	\N	1	\N	\N
719	825	SM-2878	\N	1	\N	\N
720	826	SM-2879	\N	1	\N	\N
721	827	SM-2880	\N	1	\N	\N
722	828	SM-2881	\N	1	\N	\N
723	829	SM-2884	\N	1	\N	\N
724	830	SM-9070	\N	1	\N	\N
725	831	SM-108	\N	1	\N	\N
726	832	SM-109	\N	1	\N	\N
727	833	SM-125B	\N	1	\N	\N
728	834	SM-125C	\N	1	\N	\N
729	835	SM-129	\N	1	\N	\N
730	836	SM-236B	\N	1	\N	\N
731	837	SM-236G	\N	1	\N	\N
732	838	SM-1176	\N	1	\N	\N
733	839	SM-1176-1	\N	1	\N	\N
734	840	SM-2833	\N	1	\N	\N
735	841	CRB TURBOMAX 15W40	\N	1	\N	\N
736	842	CRB TURBOMAX 15W40	\N	1	\N	\N
737	843	MAGNATEC DIESEL 15W40	\N	1	\N	\N
738	844	MAGNATEC DIESEL 15W40	\N	1	\N	\N
739	845	YCRPS-IS-04	\N	1	\N	\N
740	846	YCRPS-MZ-01	\N	1	\N	\N
741	847	YCRPS-MT-15	\N	1	\N	\N
742	848	YCRPS-MT-19	\N	1	\N	\N
743	849	YCRPS-TY-15	\N	1	\N	\N
744	850	YA-19013110-P	\N	1	\N	\N
745	851	YA-11252-P	\N	1	\N	\N
746	852	YVC-1KD	\N	1	\N	\N
747	852	YVC-2KD	\N	2	\N	\N
748	853	YVC-4D56-16V-2	\N	1	\N	\N
749	854	YSPIS-4D56-16V-2S	\N	1	\N	\N
750	855	YSPIS-4D56-16V1B	\N	1	\N	\N
751	856	YSPIS-23681-0L010	\N	1	\N	\N
752	857	R-ARM-OS-MT-02	\N	1	\N	\N
753	858	R-ARM-OS-MT-03	\N	1	\N	\N
754	859	R-ARM-OS-MT-04	\N	1	\N	\N
755	860	R-ARM-OS-MZ-01	\N	1	\N	\N
756	861	SA-OS-NS-35	\N	1	\N	\N
757	862	SA-OS-NS-36	\N	1	\N	\N
758	863	SA-OS-MT-05	\N	1	\N	\N
759	864	SA-OS-TY-07	\N	1	\N	\N
760	865	SA-OS-TY-08	\N	1	\N	\N
761	866	VSR-4JA1_STD_IN	\N	1	\N	\N
762	867	VSR-4JA1_STD_EX	\N	1	\N	\N
763	868	VSR-4JG2_STD_IN	\N	1	\N	\N
764	869	VSR-4JG2_STD_EX	\N	1	\N	\N
765	870	VSR-10PA1_IN	\N	1	\N	\N
766	871	VSR-10PA1_EX	\N	1	\N	\N
767	872	VSR-10PB1	\N	1	\N	\N
768	872	VSR-10PC1_STD_IN	\N	2	\N	\N
769	873	VSR-10PB1	\N	1	\N	\N
770	873	VSR-10PC1_STD_EX	\N	2	\N	\N
771	874	VSR-2C_STD_IN	\N	1	\N	\N
772	875	VSR-2C_STD_EX	\N	1	\N	\N
773	876	VSR-PREGIJT_IN	\N	1	\N	\N
774	876	VSR-PREGIO 3.0	\N	2	\N	\N
775	877	VSR-PREGIJT_EX	\N	1	\N	\N
776	877	VSR-PREGIO 3.0	\N	2	\N	\N
777	878	VSR-R2_STD_EX	\N	1	\N	\N
778	879	VSR-R2_STD _IN	\N	1	\N	\N
779	880	VSR-R2_0.25_EX	\N	1	\N	\N
780	881	VSR-R2_0.25_IN	\N	1	\N	\N
781	882	VSR-TD27_STD_IN	\N	1	\N	\N
782	883	VSR-TD27_STD_EX	\N	1	\N	\N
783	884	VSR-SD23_STD_IN	\N	1	\N	\N
784	885	VSR-SD23_STD_EX	\N	1	\N	\N
785	886	VSR-4DR5_STD_IN	\N	1	\N	\N
786	887	VSR-4DR5_STD_EX	\N	1	\N	\N
787	888	VSR-4D55	\N	1	\N	\N
788	888	VSR-56_STD_IN	\N	2	\N	\N
789	889	VSR-4D56	\N	1	\N	\N
790	889	VSR-56_STD_EX	\N	2	\N	\N
791	890	VSR- 4D55	\N	1	\N	\N
792	890	VSR- 56_0.25_EX	\N	2	\N	\N
793	891	VSR-4D55	\N	1	\N	\N
794	891	VSR-56_0.25_IN	\N	2	\N	\N
795	892	32_STD_IN	\N	1	\N	\N
796	892	YVSR-4D30	\N	2	\N	\N
797	893	32_STD_EX	\N	1	\N	\N
798	893	YVSR-4D30	\N	2	\N	\N
799	894	VSR-36_STD_IN	\N	1	\N	\N
800	894	VSR-4D33	\N	2	\N	\N
801	895	VSR-6D15_STD_IN	\N	1	\N	\N
802	896	VSR-6D15_STD_EX	\N	1	\N	\N
803	897	VSR-8DC9_STD_IN	\N	1	\N	\N
804	898	VSR-8DC9_STD_EX	\N	1	\N	\N
805	899	VSR-4M40_STD_IN	\N	1	\N	\N
806	900	VSR-4M40_STD_EX	\N	1	\N	\N
807	901	HVG-2NZ	\N	1	\N	\N
808	902	HVG-1C	\N	1	\N	\N
809	902	HVG-2C	\N	2	\N	\N
810	903	HVG-2L	\N	1	\N	\N
811	903	HVG-L	\N	2	\N	\N
812	904	HVG-1RZ	\N	1	\N	\N
813	905	HVG-4D30	\N	1	\N	\N
814	905	HVG-4D31	\N	2	\N	\N
815	905	HVG-4D32	\N	3	\N	\N
816	906	HVG-4D55	\N	1	\N	\N
817	906	HVG-4D56	\N	2	\N	\N
818	907	HVG-2E	\N	1	\N	\N
819	908	HVG-4D56	\N	1	\N	\N
820	909	HVG-4M40 OLD	\N	1	\N	\N
821	910	HVG-4M40 NEW	\N	1	\N	\N
822	911	HVG-4M51	\N	1	\N	\N
823	912	HVG-6D15	\N	1	\N	\N
824	913	HVG-6D20	\N	1	\N	\N
825	913	HVG-6D22	\N	2	\N	\N
826	914	HVG-PREGIO J2	\N	1	\N	\N
827	914	HVG-PREGIO JT	\N	2	\N	\N
828	915	HVG-SENTRA 1.3	\N	1	\N	\N
829	915	HVG-SENTRA 1.5	\N	2	\N	\N
830	916	HVG-SD23	\N	1	\N	\N
831	916	HVG-SD25	\N	2	\N	\N
832	917	HVG-QD32	\N	1	\N	\N
833	917	HVGTD27T	\N	2	\N	\N
834	918	HVG-NAVARA	\N	1	\N	\N
835	918	HVG-NV350	\N	2	\N	\N
836	919	5-11721-001	\N	1	\N	\N
837	919	HVG-4BA1	\N	2	\N	\N
838	919	HVG-4BC1	\N	3	\N	\N
839	919	HVG-4BC2	\N	4	\N	\N
840	920	5-11721-016-0	\N	1	\N	\N
841	920	HVG-4JA1	\N	2	\N	\N
842	920	HVG-4JB1	\N	3	\N	\N
843	920	HVG-4JG2	\N	4	\N	\N
844	920	HVG-C190	\N	5	\N	\N
845	920	HVG-C223	\N	6	\N	\N
846	921	HALTERRA	\N	1	\N	\N
847	921	HVG-4EC1	\N	2	\N	\N
848	921	HVG-4JJ1	\N	3	\N	\N
849	922	HVG-F6A	\N	1	\N	\N
850	923	HVG-B2500	\N	1	\N	\N
851	923	HVG-B25WL	\N	2	\N	\N
852	924	YCHB-TY-K3	\N	1	\N	\N
853	924	YCHB-TY1SZ	\N	2	\N	\N
854	925	YCHB-TY-2C	\N	1	\N	\N
855	926	YCHB-TY-1KD-2KDL	\N	1	\N	\N
856	927	CHB-TY-1KD	\N	1	\N	\N
857	927	CHB-TY-2KDS	\N	2	\N	\N
858	928	YCHB-TY-1NZ	\N	1	\N	\N
859	928	YCHB-TY-2NZ	\N	2	\N	\N
860	929	YCHB-MT-L300	\N	1	\N	\N
861	930	YCHB-MT-4M40	\N	1	\N	\N
862	931	YCHB-MZ-RF	\N	1	\N	\N
863	932	YCHB-MZ-WL-T-S	\N	1	\N	\N
864	933	YCHB-MZ-WL-T-L	\N	1	\N	\N
865	934	510-0092-10	\N	1	\N	\N
866	935	510-0108-10	\N	1	\N	\N
867	936	510-0232-10	\N	1	\N	\N
868	937	YCF-MT-02	\N	1	\N	\N
869	938	YCF-MT-04	\N	1	\N	\N
870	939	YCF-TY-02	\N	1	\N	\N
871	940	YCF-TY-03	\N	1	\N	\N
872	941	YCF-IZ-01	\N	1	\N	\N
873	942	YCF-IZ-08	\N	1	\N	\N
874	943	VS-MT-06	\N	1	\N	\N
875	944	VS-MZ-01	\N	1	\N	\N
876	945	VT-TY-01	\N	1	\N	\N
877	946	VT-MT-01	\N	1	\N	\N
878	947	VT-MT-02	\N	1	\N	\N
879	948	VT-MT-03	\N	1	\N	\N
880	949	VT-IZ-02	\N	1	\N	\N
881	950	PC-NS-01	\N	1	\N	\N
882	951	PC-NS-03	\N	1	\N	\N
883	952	PC-NS-04	\N	1	\N	\N
884	953	PC-TY-02	\N	1	\N	\N
885	954	PC-MT-02	\N	1	\N	\N
886	955	YHB-SZ-01	\N	1	\N	\N
887	956	MC-987654	\N	1	\N	\N
888	957	MC-153301	\N	1	\N	\N
889	958	MB-001878	\N	1	\N	\N
890	959	MC-987654-2	\N	1	\N	\N
891	960	MC-987654-3	\N	1	\N	\N
892	961	YHG-D16Y5-G	\N	1	\N	\N
893	962	YHG-4JJ1-OLDS	\N	1	\N	\N
894	963	YOP-2E	\N	1	\N	\N
895	964	YOP-7K	\N	1	\N	\N
896	965	YOP-D15B6	\N	1	\N	\N
897	966	YOP-4D55	\N	1	\N	\N
898	966	YOP-4D56	\N	2	\N	\N
899	967	YOP-4M40	\N	1	\N	\N
900	968	YOP-4D31	\N	1	\N	\N
901	968	YOP-4D32	\N	2	\N	\N
902	969	YOP-4D34	\N	1	\N	\N
903	970	YOP-R2	\N	1	\N	\N
904	971	YOP-BD25	\N	1	\N	\N
905	971	YOP-TD25	\N	2	\N	\N
906	971	YOP-TD27	\N	3	\N	\N
907	972	YOP-4JA1	\N	1	\N	\N
908	972	YOP-4JB1	\N	2	\N	\N
909	972	YOP-4JG2	\N	3	\N	\N
910	973	YOP-4BE1-S	\N	1	\N	\N
911	974	YOP-4BE1-L	\N	1	\N	\N
912	975	YOP-K65	\N	1	\N	\N
913	975	YOP-K66	\N	2	\N	\N
914	976	WM-OS-MT-01	\N	1	\N	\N
915	977	WM-OS-TY-01	\N	1	\N	\N
916	978	RT-TYT-01	\N	1	\N	\N
917	979	YIGNC-TY-14	\N	1	\N	\N
918	980	YHG-AVANZA 2.0MM-G	\N	1	\N	\N
919	980	YHG-K3VE	\N	2	\N	\N
920	981	YHG-4G92-G	\N	1	\N	\N
921	982	YVC-1KD	\N	1	\N	\N
922	982	YVC-2KD	\N	2	\N	\N
923	983	YVC-1SZ	\N	1	\N	\N
924	983	YVC-K3VE	\N	2	\N	\N
925	984	YVC-D17A2	\N	1	\N	\N
926	985	YVC-WE	\N	1	\N	\N
927	986	YSPIS-23681-03001	\N	1	\N	\N
928	986	YSPIS-23681-0L010	\N	2	\N	\N
929	987	YSPIS-4D56-16V1B	\N	1	\N	\N
930	988	YSPIS-4D56-16V-2S	\N	1	\N	\N
931	989	VS-4D56T-16V	\N	1	\N	\N
932	990	WB-01056	\N	1	\N	\N
933	991	WB-01125	\N	1	\N	\N
934	992	WB-01104	\N	1	\N	\N
935	993	WB-01090	\N	1	\N	\N
936	994	WC-21401	\N	1	\N	\N
937	995	WB-01136	\N	1	\N	\N
938	996	WC-35020	\N	1	\N	\N
939	997	WC-0691	\N	1	\N	\N
940	998	SMALL	\N	1	\N	\N
941	999	BIG	\N	1	\N	\N
942	1000	RED AH-101B BIG	\N	1	\N	\N
943	1001	1000	\N	1	\N	\N
944	1002	ISD-102	\N	1	\N	\N
945	1003	ISD-135	\N	1	\N	\N
946	1004	ISD-101 49	\N	1	\N	\N
947	1005	ISD-109 10	\N	1	\N	\N
948	1006	ISD-134	\N	1	\N	\N
949	1007	MFO-015	\N	1	\N	\N
950	1008	MFO-042	\N	1	\N	\N
951	1008	SA-155	\N	2	\N	\N
952	1009	DT-123	\N	1	\N	\N
953	1010	H-10-107	\N	1	\N	\N
954	1011	ISC-519	\N	1	\N	\N
955	1012	ISC-543 9	\N	1	\N	\N
956	1013	MFC-540	\N	1	\N	\N
957	1014	15910-82513	\N	1	\N	\N
958	1015	16410-88701	\N	1	\N	\N
959	1016	F6A	\N	1	\N	\N
960	1017	NA-932  SMALL F6A	\N	1	\N	\N
961	1018	NA-943 F6A BIG	\N	1	\N	\N
962	1019	C-110	\N	1	\N	\N
963	1020	F6A FINISH	\N	1	\N	\N
964	1021	30205	\N	1	\N	\N
965	1022	10PC1	\N	1	\N	\N
966	1022	10V10	\N	2	\N	\N
967	1023	KP-519	\N	1	\N	\N
968	1024	KP-231	\N	1	\N	\N
969	1025	SINGLE	\N	1	\N	\N
970	1026	RO6B13DX1	\N	1	\N	\N
971	1027	AH-101B	\N	1	\N	\N
972	1028	600ML	\N	1	\N	\N
973	1029	GUM-71	\N	1	\N	\N
974	1030	52440-79900	\N	1	\N	\N
975	1031	VA-8290K	\N	1	\N	\N
976	1032	VA-8291K	\N	1	\N	\N
977	1033	AH-101B	\N	1	\N	\N
978	1034	ISD-008S	\N	1	\N	\N
979	1035	CT-014	\N	1	\N	\N
980	1035	TYC-550	\N	2	\N	\N
981	1036	A-133	\N	1	\N	\N
982	1037	ME-014779	\N	1	\N	\N
983	1038	24	\N	1	\N	\N
984	1039	TGV-S03	\N	1	\N	\N
985	1040	GWS-19	\N	1	\N	\N
986	1041	PINK	\N	1	\N	\N
987	1042	A-8184	\N	1	\N	\N
988	1043	A-8123	\N	1	\N	\N
989	1044	NF-958-1	\N	1	\N	\N
990	1044	RH-CB-FUS-03	\N	2	\N	\N
991	1045	NF-111	\N	1	\N	\N
992	1045	RH-CB-FUS-05	\N	2	\N	\N
993	1046	NF-112	\N	1	\N	\N
994	1046	RH-CB-FUS-06	\N	2	\N	\N
995	1047	NF-117	\N	1	\N	\N
996	1047	RH-CB-FUS-11	\N	2	\N	\N
997	1048	NF-117-1	\N	1	\N	\N
998	1048	RH-FUS-12	\N	2	\N	\N
999	1049	NF-118	\N	1	\N	\N
1000	1049	RH-FUS-13	\N	2	\N	\N
1001	1050	NF-151	\N	1	\N	\N
1002	1050	RH-FUS-38	\N	2	\N	\N
1003	1051	NF-151-2	\N	1	\N	\N
1004	1051	RH-FUS-39	\N	2	\N	\N
1005	1052	NF-151-3	\N	1	\N	\N
1006	1052	RH-FUS-40	\N	2	\N	\N
1007	1053	NF-152-1	\N	1	\N	\N
1008	1053	RH-FUS-42	\N	2	\N	\N
1009	1054	NF-152-2	\N	1	\N	\N
1010	1054	RH-FUS-43	\N	2	\N	\N
1011	1055	NF-155	\N	1	\N	\N
1012	1055	RH-CB-FUS-44	\N	2	\N	\N
1013	1056	NF-155-1	\N	1	\N	\N
1014	1056	RH-CB-FUS-45	\N	2	\N	\N
1015	1057	NF-168	\N	1	\N	\N
1016	1057	RH-CB-FUS-53	\N	2	\N	\N
1017	1058	NF-168-1	\N	1	\N	\N
1018	1058	RH-CB-FUS-54	\N	2	\N	\N
1019	1059	8DC11 UPPER	\N	1	\N	\N
1020	1059	RH-FUS-58	\N	2	\N	\N
1021	1060	8DC11 LOWER	\N	1	\N	\N
1022	1060	RH-FUS-59	\N	2	\N	\N
1023	1061	6D16 UPPER	\N	1	\N	\N
1024	1061	RH-FUS-60	\N	2	\N	\N
1025	1062	6D16 LOWER	\N	1	\N	\N
1026	1062	RH-FUS-61	\N	2	\N	\N
1027	1063	EF750 UPPER	\N	1	\N	\N
1028	1063	RH-FUS-64	\N	2	\N	\N
1029	1064	NI-873	\N	1	\N	\N
1030	1064	RH-CB-ISU-23	\N	2	\N	\N
1031	1065	NI-874	\N	1	\N	\N
1032	1065	RH-CB-ISU-24	\N	2	\N	\N
1033	1066	NI-927	\N	1	\N	\N
1034	1066	RH-CB-ISU-25	\N	2	\N	\N
1035	1067	NI-960	\N	1	\N	\N
1036	1067	RH-ISU-28	\N	2	\N	\N
1037	1068	NI-966	\N	1	\N	\N
1038	1068	RH-ISU-32	\N	2	\N	\N
1039	1069	NI-967	\N	1	\N	\N
1040	1069	RH-ISU-33	\N	2	\N	\N
1041	1070	RH-ISU-36	\N	1	\N	\N
1042	1071	NI-212	\N	1	\N	\N
1043	1071	RH-CB-ISU-38	\N	2	\N	\N
1044	1072	NI-213	\N	1	\N	\N
1045	1072	RH-CB-ISU-41	\N	2	\N	\N
1046	1073	NI-213-1	\N	1	\N	\N
1047	1073	RH-CB-ISU-42	\N	2	\N	\N
1048	1074	NF-155-1	\N	1	\N	\N
1049	1074	RH-CB-FUS-45	\N	2	\N	\N
1050	1075	NI-214-3	\N	1	\N	\N
1051	1075	RH-CB-ISU-44	\N	2	\N	\N
1052	1076	NI-215	\N	1	\N	\N
1053	1076	RH-CB-ISU-45	\N	2	\N	\N
1054	1077	NI-253	\N	1	\N	\N
1055	1077	RH-CB-ISU-71	\N	2	\N	\N
1056	1078	NI-254	\N	1	\N	\N
1057	1078	RH-CB-ISU-72	\N	2	\N	\N
1058	1079	NI-255	\N	1	\N	\N
1059	1079	RH-CB-ISU-73	\N	2	\N	\N
1060	1080	NI-256	\N	1	\N	\N
1061	1080	RH-CB-ISU-74	\N	2	\N	\N
1062	1081	NI-257	\N	1	\N	\N
1063	1081	RH-CB-ISU-75	\N	2	\N	\N
1064	1082	NI-256-1	\N	1	\N	\N
1065	1082	RH-CB-ISU-77	\N	2	\N	\N
1066	1083	NI-287	\N	1	\N	\N
1067	1083	RH-CB-ISU-98	\N	2	\N	\N
1068	1084	RH-ISU-105	\N	1	\N	\N
1069	1085	RH-ISU-106	\N	1	\N	\N
1070	1086	RH-ISU-112	\N	1	\N	\N
1071	1087	RH-ISU-113	\N	1	\N	\N
1072	1088	RH-MT-63	\N	1	\N	\N
1073	1089	RH-CB-MIT-64	\N	1	\N	\N
1074	1090	RH-MIT-65	\N	1	\N	\N
1075	1091	RH-MIT-66	\N	1	\N	\N
1076	1092	N0-678-2	\N	1	\N	\N
1077	1092	RH-CB-SUZ-10	\N	2	\N	\N
1078	1093	BPH-CB-FUS-01	\N	1	\N	\N
1079	1093	NF-156-2	\N	2	\N	\N
1080	1094	BPH-CB-FUS-05	\N	1	\N	\N
1081	1094	NF-109-2	\N	2	\N	\N
1082	1095	BPH-CB-ISU-01	\N	1	\N	\N
1083	1095	NI-218	\N	2	\N	\N
1084	1096	BPH-CB-ISU-04	\N	1	\N	\N
1085	1096	NI-258-3	\N	2	\N	\N
1086	1097	BPH-CB-ISU-07	\N	1	\N	\N
1087	1097	NI-290	\N	2	\N	\N
1088	1098	BPH-CB-ISU-09	\N	1	\N	\N
1089	1098	NI-292	\N	2	\N	\N
1090	1099	BPH-CB-MIT-03	\N	1	\N	\N
1091	1099	NM-353-3	\N	2	\N	\N
1092	1100	BPH-CB-MIT-04	\N	1	\N	\N
1093	1100	NM-355-2	\N	2	\N	\N
1094	1101	BPH-CB-MIT-05	\N	1	\N	\N
1095	1101	NM-357-1	\N	2	\N	\N
1096	1102	ALT-CB-FUS-02	\N	1	\N	\N
1097	1102	NF-155-2	\N	2	\N	\N
1098	1103	ALT-CB-FUS-03	\N	1	\N	\N
1099	1103	NF-109-1	\N	2	\N	\N
1100	1104	ALT-CB-FUS-04	\N	1	\N	\N
1101	1104	NF-163	\N	2	\N	\N
1102	1105	ALT-CB-ISU-01	\N	1	\N	\N
1103	1105	NI-218-1	\N	2	\N	\N
1104	1106	ALT-CB-ISU-02	\N	1	\N	\N
1105	1106	NI-218-2	\N	2	\N	\N
1106	1107	ALT-CB-MIT-01	\N	1	\N	\N
1107	1107	NM-355-1	\N	2	\N	\N
1108	1108	ALT-CB-MIT-02	\N	1	\N	\N
1109	1108	NM-355-2	\N	2	\N	\N
1110	1109	ALT-CB-STA-01	\N	1	\N	\N
1111	1109	NH-860-1	\N	2	\N	\N
1112	1110	ACH-5X18	\N	1	\N	\N
1113	1111	ACH-5X16	\N	1	\N	\N
1114	1112	ACH-5X6X18	\N	1	\N	\N
1115	1113	ACH-5X14	\N	1	\N	\N
1116	1114	N70L MF	\N	1	\N	\N
1117	1115	N70R MF	\N	1	\N	\N
1118	1116	NS40L MF	\N	1	\N	\N
1119	1117	PP2	\N	1	\N	\N
1120	1119	KP-519	\N	1	\N	\N
1121	1120	GM-273	\N	1	\N	\N
1122	1121	MFD-067U	\N	1	\N	\N
1123	1122	MFD-037U	\N	1	\N	\N
1124	1123	45200-86024	\N	1	\N	\N
1125	1124	AH-001	\N	1	\N	\N
1126	1124	SAH-001	\N	2	\N	\N
1127	1125	26300-42040	\N	1	\N	\N
1128	1126	CS-013	\N	1	\N	\N
1129	1127	DS-014	\N	1	\N	\N
1130	1128	DG-305	\N	1	\N	\N
1131	1129	DG-009U	\N	1	\N	\N
1132	1130	16HOLES REAR	\N	1	\N	\N
1133	1131	09250-13003	\N	1	\N	\N
1134	1131	12MM	\N	2	\N	\N
1135	1132	MP277A 25MM	\N	1	\N	\N
1136	1133	MP277A STD	\N	1	\N	\N
1137	1134	1-53225-354-0	\N	1	\N	\N
1138	1135	ART-414	\N	1	\N	\N
1139	1136	25V14625	\N	1	\N	\N
1140	1137	30309D	\N	1	\N	\N
1141	1138	OK75A-10-311	\N	1	\N	\N
1142	1139	8-94159-048	\N	1	\N	\N
1143	1140	BK-094-3	\N	1	\N	\N
1144	1141	KGG-400	\N	1	\N	\N
1145	1142	KGG-500	\N	1	\N	\N
1146	1143	SHV-2529	\N	1	\N	\N
1147	1144	SHV-2528	\N	1	\N	\N
1148	1145	0545-18712	\N	1	\N	\N
1149	1146	MUM-99	\N	1	\N	\N
1150	1147	MUMZ-6	\N	1	\N	\N
1151	1148	34910-75700	\N	1	\N	\N
1152	1148	MSCS-5700	\N	2	\N	\N
1153	1149	34910-75702	\N	1	\N	\N
1154	1149	MSCS-5702	\N	2	\N	\N
1155	1150	MB-286218	\N	1	\N	\N
1156	1150	MSCM-6218	\N	2	\N	\N
1157	1151	28380-88001	\N	1	\N	\N
1158	1151	MSCS-8053	\N	2	\N	\N
1159	1152	KPB-499	\N	1	\N	\N
1160	1152	MB030499	\N	2	\N	\N
1161	1153	12054-00801	\N	1	\N	\N
1162	1153	KPB-801	\N	2	\N	\N
1163	1154	9-51351-020	\N	1	\N	\N
1164	1154	KPB-020	\N	2	\N	\N
1165	1155	51351-025	\N	1	\N	\N
1166	1155	KPB--025	\N	2	\N	\N
1167	1156	9-51351-034	\N	1	\N	\N
1168	1156	KPB-034	\N	2	\N	\N
1169	1157	9-51351-036	\N	1	\N	\N
1170	1157	KPB-036	\N	2	\N	\N
1171	1158	12054-00301	\N	1	\N	\N
1172	1158	KPB-301	\N	2	\N	\N
1173	1159	11054-00800	\N	1	\N	\N
1174	1159	KPB-800	\N	2	\N	\N
1175	1160	41332-79056	\N	1	\N	\N
1176	1160	KPB-056	\N	2	\N	\N
1177	1161	41332-79046	\N	1	\N	\N
1178	1161	KPB-046	\N	2	\N	\N
1179	1162	41332-79035	\N	1	\N	\N
1180	1162	KPB-035	\N	2	\N	\N
1181	1163	09319-10030	\N	1	\N	\N
1182	1163	09319-10031	\N	2	\N	\N
1183	1163	MBA-0030	\N	3	\N	\N
1184	1164	MB-484734	\N	1	\N	\N
1185	1164	MSCM-4734	\N	2	\N	\N
1186	1165	28370-85503	\N	1	\N	\N
1187	1165	MSCS-7038	\N	2	\N	\N
1188	1166	28380-85503	\N	1	\N	\N
1189	1166	MSCS-8038	\N	2	\N	\N
1190	1167	28370-85003	\N	1	\N	\N
1191	1167	MSCS-7043	\N	2	\N	\N
1192	1168	MSCS-8043	\N	1	\N	\N
1193	1169	28370-85001	\N	1	\N	\N
1194	1169	MSCS-7051	\N	2	\N	\N
1195	1170	28380-85001	\N	1	\N	\N
1196	1170	MSCS-8051	\N	2	\N	\N
1197	1171	28370-85001	\N	1	\N	\N
1198	1171	MSCS-7053	\N	2	\N	\N
1199	1172	55440-87500	\N	1	\N	\N
1200	1172	MBCS-7500	\N	2	\N	\N
1201	1173	MMD-016	\N	1	\N	\N
1202	1174	MTD-057	\N	1	\N	\N
1203	1175	MMD-067U	\N	1	\N	\N
1204	1176	55009-095-0	\N	1	\N	\N
1205	1176	MSCI-095	\N	2	\N	\N
1206	1177	55009-106-0	\N	1	\N	\N
1207	1177	MSCI-106	\N	2	\N	\N
1208	1178	8-94144-178-0	\N	1	\N	\N
1209	1178	MBCI-1780	\N	2	\N	\N
1210	1179	MBCI-1120	\N	1	\N	\N
1211	1180	1-46151-391-0	\N	1	\N	\N
1212	1180	MBCI-2615	\N	2	\N	\N
1213	1180	MBCI-3910	\N	3	\N	\N
1214	1181	MBCI-1950	\N	1	\N	\N
1215	1181	MBCI-2616	\N	2	\N	\N
1216	1182	MBCI-2617	\N	1	\N	\N
1217	1183	MB-256011	\N	1	\N	\N
1218	1183	MBCM-6011	\N	2	\N	\N
1219	1184	MB256042	\N	1	\N	\N
1220	1184	MBCM-6042	\N	2	\N	\N
1221	1185	APC-65	\N	1	\N	\N
1222	1186	APC-194	\N	1	\N	\N
1223	1186	MB802962-1	\N	2	\N	\N
1224	1186	MC860259-1	\N	3	\N	\N
1225	1187	28011-64130	\N	1	\N	\N
1226	1188	28011-64150	\N	1	\N	\N
1227	1189	48750-85000	\N	1	\N	\N
1228	1189	MBP-5000	\N	2	\N	\N
1229	1190	384 UNIVERSAL	\N	1	\N	\N
1230	1191	90385-23037-1	\N	1	\N	\N
1231	1191	MBC-0371	\N	2	\N	\N
1232	1192	90385-23037	\N	1	\N	\N
1233	1192	MBE-3037	\N	2	\N	\N
1234	1193	48635-27010	\N	1	\N	\N
1235	1193	MBE-7010	\N	2	\N	\N
1236	1194	48635-28010	\N	1	\N	\N
1237	1194	MBE-8010	\N	2	\N	\N
1238	1195	48635-18046	\N	1	\N	\N
1239	1195	MBE-8046	\N	2	\N	\N
1240	1196	SB-68D	\N	1	\N	\N
1241	1196	SSB-1680	\N	2	\N	\N
1242	1197	260206	\N	1	\N	\N
1243	1198	SMF-603 BLACK	\N	1	\N	\N
1244	1199	12V BLUE	\N	1	\N	\N
1245	1199	SAL1215L	\N	2	\N	\N
1248	1201	24V BLUE	\N	1	\N	\N
1249	1201	SAL1223L	\N	2	\N	\N
1252	1203	CSM-203	\N	1	\N	\N
1253	1203	KA-1012	\N	2	\N	\N
1254	1204	CSM-212G	\N	1	\N	\N
1246	1199	24V GREEN	\N	1	\N	\N
1255	1204	KG-4034	\N	2	\N	\N
1256	1205	KMW-32150C	\N	1	\N	\N
1257	1205	M12X1.5MM	\N	2	\N	\N
1258	1206	SM-173	\N	1	\N	\N
1259	1206	SM-176	\N	2	\N	\N
1260	1207	SM-237	\N	1	\N	\N
1261	1208	SM-240	\N	1	\N	\N
1262	1209	SM-300	\N	1	\N	\N
1263	1210	SM-534	\N	1	\N	\N
1264	1211	E-552	\N	1	\N	\N
1265	1211	SM-600	\N	2	\N	\N
1266	1212	E-383	\N	1	\N	\N
1267	1212	SM-2863	\N	2	\N	\N
1268	1213	334019	\N	1	\N	\N
1269	1213	CSM-239G	\N	2	\N	\N
1270	1214	E-547	\N	1	\N	\N
1271	1214	SM-2862	\N	2	\N	\N
1272	1215	E-361	\N	1	\N	\N
1273	1215	SM-2878	\N	2	\N	\N
1274	1216	E-362	\N	1	\N	\N
1275	1216	SM-2879	\N	2	\N	\N
1276	1217	E-363	\N	1	\N	\N
1277	1217	SM-2880	\N	2	\N	\N
1278	1218	E-550	\N	1	\N	\N
1279	1218	SM-2881	\N	2	\N	\N
1280	1219	E-394	\N	1	\N	\N
1281	1219	SM-2885	\N	2	\N	\N
1282	1220	E-384	\N	1	\N	\N
1283	1220	SM-2886	\N	2	\N	\N
1284	1221	SM-3106	\N	1	\N	\N
1285	1222	SM-5032	\N	1	\N	\N
1286	1223	E-366	\N	1	\N	\N
1287	1223	SM-9070	\N	2	\N	\N
1288	1224	E-3660	\N	1	\N	\N
1289	1224	SM-9070-1	\N	2	\N	\N
1290	1225	260404	\N	1	\N	\N
1291	1226	270202D	\N	1	\N	\N
1292	1227	2T MALE	\N	1	\N	\N
1293	1228	3T MALE	\N	1	\N	\N
1294	1229	2T FEMALE	\N	1	\N	\N
1295	1230	3T FEMALE	\N	1	\N	\N
1296	1231	BBH-82003	\N	1	\N	\N
1297	1232	BBH-82004	\N	1	\N	\N
1298	1233	BBH-82006	\N	1	\N	\N
1299	1234	9-47601-603	\N	1	\N	\N
1300	1234	MWI-603	\N	2	\N	\N
1301	1235	9-47601-604	\N	1	\N	\N
1302	1235	MWI-604	\N	2	\N	\N
1303	1236	8-94128-162-0	\N	1	\N	\N
1304	1236	MWI-162	\N	2	\N	\N
1305	1237	8-94128-163-0	\N	1	\N	\N
1306	1237	MWI-163	\N	2	\N	\N
1307	1238	MWI-7379	\N	1	\N	\N
1308	1239	MB-060570	\N	1	\N	\N
1309	1239	MWM-570	\N	2	\N	\N
1310	1240	31470-35070	\N	1	\N	\N
1311	1240	31470-35071	\N	2	\N	\N
1312	1240	MST-35070	\N	3	\N	\N
1313	1241	30620-10G00	\N	1	\N	\N
1314	1241	MSN-10G00	\N	2	\N	\N
1315	1242	31470-28040	\N	1	\N	\N
1316	1242	MST-28040	\N	2	\N	\N
1317	1243	MWK-56266	\N	1	\N	\N
1318	1243	OK56B-26-610	\N	2	\N	\N
1319	1244	MWK-56267	\N	1	\N	\N
1320	1244	OK56B-26-710	\N	2	\N	\N
1321	1245	223-01705M	\N	1	\N	\N
1322	1245	MBI-262	\N	2	\N	\N
1323	1246	814-05103	\N	1	\N	\N
1324	1246	MBI-263	\N	2	\N	\N
1325	1247	223-00512	\N	1	\N	\N
1326	1247	MBM-282	\N	2	\N	\N
1327	1248	224-00210	\N	1	\N	\N
1328	1248	MBM-283	\N	2	\N	\N
1329	1249	HEP-01	\N	1	\N	\N
1330	1249	KBP-601	\N	2	\N	\N
1331	1250	HEP-02	\N	1	\N	\N
1332	1250	KBP-602	\N	2	\N	\N
1333	1251	834-05203	\N	1	\N	\N
1334	1251	MBI-201	\N	2	\N	\N
1335	1252	814-05101	\N	1	\N	\N
1336	1252	MBI-203	\N	2	\N	\N
1337	1253	MBA-305K	\N	1	\N	\N
1338	1254	809-03002	\N	1	\N	\N
1339	1254	MBM-183	\N	2	\N	\N
1340	1255	ME601106	\N	1	\N	\N
1341	1255	ME601290	\N	2	\N	\N
1342	1255	MSM-01160	\N	3	\N	\N
1343	1256	ME600007	\N	1	\N	\N
1344	1256	ME602333	\N	2	\N	\N
1345	1256	MSM-02333	\N	3	\N	\N
1346	1257	MD712383	\N	1	\N	\N
1347	1257	MSM-12383	\N	2	\N	\N
1348	1258	51110-79020	\N	1	\N	\N
1349	1258	51110-85850	\N	2	\N	\N
1350	1258	MBS-85850	\N	3	\N	\N
1351	1259	MB555391	\N	1	\N	\N
1352	1259	MCM-55391	\N	2	\N	\N
1353	1260	MCM-51616	\N	1	\N	\N
1354	1260	MR151616	\N	2	\N	\N
1355	1261	MSF-58419	\N	1	\N	\N
1356	1261	UR58-41-920	\N	2	\N	\N
1357	1262	41710-43150	\N	1	\N	\N
1358	1262	MSHY-43150	\N	2	\N	\N
1359	1263	8-97039-704-0	\N	1	\N	\N
1360	1263	MSI-39704	\N	2	\N	\N
1361	1264	41700-4B000	\N	1	\N	\N
1362	1264	MSHY-4B000	\N	2	\N	\N
1363	1265	8-97032-847-1	\N	1	\N	\N
1364	1265	MSI-32847	\N	2	\N	\N
1365	1266	17801-54100	\N	1	\N	\N
1366	1266	KA-3170	\N	2	\N	\N
1367	1267	16405-02N10	\N	1	\N	\N
1368	1267	KP-2234	\N	2	\N	\N
1369	1268	KF-2321	\N	1	\N	\N
1370	1268	MB220900	\N	2	\N	\N
1371	1269	K-3266	\N	1	\N	\N
1372	1269	MB433425	\N	2	\N	\N
1373	1270	0222-13-470B	\N	1	\N	\N
1374	1270	KF-4470B	\N	2	\N	\N
1375	1271	52676	\N	1	\N	\N
1376	1271	KF-4504	\N	2	\N	\N
1377	1271	MA160504	\N	3	\N	\N
1378	1272	15410-63401	\N	1	\N	\N
1379	1272	15410-79100	\N	2	\N	\N
1380	1272	KF-4401	\N	3	\N	\N
1381	1273	0222-13-470A	\N	1	\N	\N
1382	1273	KF-4470A	\N	2	\N	\N
1383	1274	E-058-13-470	\N	1	\N	\N
1384	1274	KF-4774	\N	2	\N	\N
1385	1275	23300-25020	\N	1	\N	\N
1386	1275	KF-4520	\N	2	\N	\N
1387	1276	23300-26060	\N	1	\N	\N
1388	1276	KF-4060	\N	2	\N	\N
1389	1277	221-02105	\N	1	\N	\N
1390	1277	MBI-161	\N	2	\N	\N
1391	1278	8-97014-566-1	\N	1	\N	\N
1392	1278	810-05003	\N	2	\N	\N
1393	1278	MBI-162	\N	3	\N	\N
1394	1279	8-97048-928-2	\N	1	\N	\N
1395	1279	810-05005	\N	2	\N	\N
1396	1279	MBI-163	\N	3	\N	\N
1397	1280	809-03004	\N	1	\N	\N
1398	1280	MBM-181	\N	2	\N	\N
1399	1281	801-03001	\N	1	\N	\N
1400	1281	MBM-182	\N	2	\N	\N
1401	1282	47210-C5Y01	\N	1	\N	\N
1402	1282	MBN-292	\N	2	\N	\N
1403	1283	44610-27330	\N	1	\N	\N
1404	1283	MBT-295	\N	2	\N	\N
1405	1284	12750	\N	1	\N	\N
1406	1284	44610-02030	\N	2	\N	\N
1407	1284	MBT-297	\N	3	\N	\N
1408	1285	44610-0B021	\N	1	\N	\N
1409	1285	MBT-299	\N	2	\N	\N
1410	1286	854-01702	\N	1	\N	\N
1411	1286	MBN-241	\N	2	\N	\N
1412	1287	31440-4600	\N	1	\N	\N
1413	1287	MBI-169	\N	2	\N	\N
1414	1288	44610-22460	\N	1	\N	\N
1415	1288	MBT-314	\N	2	\N	\N
1416	1289	17801-10030	\N	1	\N	\N
1417	1289	KA-3157A	\N	2	\N	\N
1418	1290	17801-21030	\N	1	\N	\N
1419	1290	KA-3197	\N	2	\N	\N
1420	1291	KA-3343	\N	1	\N	\N
1421	1291	MD620039	\N	2	\N	\N
1422	1292	KA-3346	\N	1	\N	\N
1423	1292	MD620472	\N	2	\N	\N
1424	1293	13780-70410	\N	1	\N	\N
1425	1293	KA-3939	\N	2	\N	\N
1426	1294	13780-79210	\N	1	\N	\N
1427	1294	KA-3943	\N	2	\N	\N
1428	1295	17801-28010	\N	1	\N	\N
1429	1295	KA-31001	\N	2	\N	\N
1430	1296	17801-21050	\N	1	\N	\N
1431	1296	KA-31013	\N	2	\N	\N
1432	1297	17801-BZ050	\N	1	\N	\N
1433	1297	KA-31050	\N	2	\N	\N
1434	1298	16546-73C10	\N	1	\N	\N
1435	1298	KA-32003V	\N	2	\N	\N
1436	1299	28130-44000	\N	1	\N	\N
1437	1299	KA-33280	\N	2	\N	\N
1438	1300	K011-13-Z40	\N	1	\N	\N
1439	1300	KA-34040	\N	2	\N	\N
1440	1301	KA-34150	\N	1	\N	\N
1441	1301	KK150-13-200	\N	2	\N	\N
1442	1302	17220-REA-200	\N	1	\N	\N
1443	1302	KA-38000	\N	2	\N	\N
1444	1303	17801-13010	\N	1	\N	\N
1445	1303	KA-3135	\N	2	\N	\N
1446	1304	BSA-83228	\N	1	\N	\N
1447	1304	MC80850	\N	2	\N	\N
1448	1304	MC80880	\N	3	\N	\N
1449	1305	BSA-83229	\N	1	\N	\N
1450	1305	MC80840	\N	2	\N	\N
1451	1306	BSA-85225	\N	1	\N	\N
1452	1306	MC80139	\N	2	\N	\N
1453	1307	BSA-85221	\N	1	\N	\N
1454	1307	MC84369	\N	2	\N	\N
1455	1308	BSA-85226	\N	1	\N	\N
1456	1308	MC86909	\N	2	\N	\N
1457	1309	MDCI-5500YY	\N	1	\N	\N
1458	1310	MDCI-5800YY	\N	1	\N	\N
1459	1311	MDCI-6000YY	\N	1	\N	\N
1460	1312	MDCI-5500YB	\N	1	\N	\N
1461	1313	MDCI-5800YB	\N	1	\N	\N
1462	1314	MDCI-6000YB	\N	1	\N	\N
1463	1315	90915-03001	\N	1	\N	\N
1464	1315	KO-1110	\N	2	\N	\N
1465	1316	8-94360-427-0	\N	1	\N	\N
1466	1316	KO-1412	\N	2	\N	\N
1467	1317	KO-1503	\N	1	\N	\N
1468	1317	ME01-4833	\N	2	\N	\N
1469	1318	8173-23-802-0	\N	1	\N	\N
1470	1318	KO-1406	\N	2	\N	\N
1471	1319	ISC-531	\N	1	\N	\N
1472	1319	ISC-588	\N	2	\N	\N
1473	1319	MIC-531	\N	3	\N	\N
1474	1320	ISC-565	\N	1	\N	\N
1475	1320	MIC-565	\N	2	\N	\N
1476	1321	MNC-519	\N	1	\N	\N
1477	1321	NSC-536	\N	2	\N	\N
1478	1321	NSC-545	\N	3	\N	\N
1479	1322	CT-014	\N	1	\N	\N
1480	1322	MTC-550	\N	2	\N	\N
1481	1323	KY02-16-460	\N	1	\N	\N
1482	1323	MMZD-023U	\N	2	\N	\N
1483	1324	MFD-033	\N	1	\N	\N
1484	1324	MMD-066Y	\N	2	\N	\N
1485	1325	DT-036	\N	1	\N	\N
1486	1325	MTD-042	\N	2	\N	\N
1487	1326	C-190	\N	1	\N	\N
1488	1326	MIC-512	\N	2	\N	\N
1489	1327	ISC-546	\N	1	\N	\N
1490	1327	MIC-546	\N	2	\N	\N
1491	1328	HYD-106U	\N	1	\N	\N
1492	1328	MHYD-106U	\N	2	\N	\N
1493	1329	ISD-128U	\N	1	\N	\N
1494	1329	MID-128U	\N	2	\N	\N
1495	1330	MMZD-007US	\N	1	\N	\N
1496	1331	MND-043U	\N	1	\N	\N
1497	1332	MID-141U	\N	1	\N	\N
1498	1333	MB378373	\N	1	\N	\N
1499	1333	SSC-8373	\N	2	\N	\N
1500	1334	8-94128-208-3	\N	1	\N	\N
1501	1334	SSC-2083	\N	2	\N	\N
1502	1335	8-94128-208-2	\N	1	\N	\N
1503	1335	SSC-2082	\N	2	\N	\N
1504	1336	9-33655-006-0	\N	1	\N	\N
1505	1336	SSC-0060	\N	2	\N	\N
1506	1337	1-44135-209-0	\N	1	\N	\N
1507	1337	SSC-2090	\N	2	\N	\N
1508	1338	45230-38031	\N	1	\N	\N
1509	1338	SSC-8031	\N	2	\N	\N
1510	1339	343343	\N	1	\N	\N
1511	1339	CSN-506G	\N	2	\N	\N
1512	1340	41700-85320	\N	1	\N	\N
1513	1340	CSS-608	\N	2	\N	\N
1514	1341	343320	\N	1	\N	\N
1515	1341	CSK-714G	\N	2	\N	\N
1516	1342	554094	\N	1	\N	\N
1517	1342	CSK-724G	\N	2	\N	\N
1518	1343	339398	\N	1	\N	\N
1519	1343	CSHY-814G	\N	2	\N	\N
1520	1344	339399	\N	1	\N	\N
1521	1344	CSHY-815G	\N	2	\N	\N
1522	1345	349166	\N	1	\N	\N
1523	1345	CSHY-816G	\N	2	\N	\N
1524	1346	344296	\N	1	\N	\N
1525	1346	CSK-732G	\N	2	\N	\N
1526	1347	37482-4250	\N	1	\N	\N
1527	1348	5-09364-048	\N	1	\N	\N
1528	1349	BH-0130	\N	1	\N	\N
1529	1350	BH-0129	\N	1	\N	\N
1530	1351	MR-1279799C	\N	1	\N	\N
1531	1352	MB-587743	\N	1	\N	\N
1532	1353	F68553	\N	1	\N	\N
1533	1354	MNC-517	\N	1	\N	\N
1534	1354	NSC-525	\N	2	\N	\N
1535	1355	22100-85061	\N	1	\N	\N
1536	1355	MSC-537	\N	2	\N	\N
1537	1356	CT-003	\N	1	\N	\N
1538	1356	MTC-508	\N	2	\N	\N
1539	1357	CT-045	\N	1	\N	\N
1540	1357	MTC-517	\N	2	\N	\N
1541	1358	MB-060580	\N	1	\N	\N
1542	1358	MWM-580	\N	2	\N	\N
1543	1359	MB-060581	\N	1	\N	\N
1544	1359	MWM-581	\N	2	\N	\N
1545	1360	MMZC-619	\N	1	\N	\N
1546	1361	MMC-560	\N	1	\N	\N
1547	1362	52401-85520	\N	1	\N	\N
1548	1362	MWS-1520	\N	2	\N	\N
1549	1363	51402-85520	\N	1	\N	\N
1550	1363	MWS-2520	\N	2	\N	\N
1551	1364	52403-85520	\N	1	\N	\N
1552	1364	MWS-3520	\N	2	\N	\N
1553	1365	52404-85520	\N	1	\N	\N
1554	1365	MWS-4520	\N	2	\N	\N
1555	1366	44100-08W12	\N	1	\N	\N
1556	1366	MWN-08W12	\N	2	\N	\N
1557	1367	CSI-307	\N	1	\N	\N
1558	1367	KA-1609	\N	2	\N	\N
1559	1368	CSI-309	\N	1	\N	\N
1560	1368	KA-1015	\N	2	\N	\N
1561	1369	343342	\N	1	\N	\N
1562	1369	CSN-505G	\N	2	\N	\N
1563	1370	553116	\N	1	\N	\N
1564	1370	CSM-244G	\N	2	\N	\N
1565	1371	553255	\N	1	\N	\N
1566	1371	CSM-245G	\N	2	\N	\N
1567	1371	KG-4018	\N	3	\N	\N
1568	1372	444109	\N	1	\N	\N
1569	1372	CSM-278	\N	2	\N	\N
1570	1372	KA-2021	\N	3	\N	\N
1571	1373	444213	\N	1	\N	\N
1572	1373	CSI-305	\N	2	\N	\N
1573	1373	KA-2648	\N	3	\N	\N
1574	1374	444180	\N	1	\N	\N
1575	1374	CSI-306	\N	2	\N	\N
1576	1374	KA-2038	\N	3	\N	\N
1577	1375	343175	\N	1	\N	\N
1578	1375	CST-461G	\N	2	\N	\N
1579	1376	553116	\N	1	\N	\N
1580	1376	CST-464G	\N	2	\N	\N
1581	1377	90940-02214	\N	1	\N	\N
1582	1378	90940-02214-1	\N	1	\N	\N
1583	1379	4-Jan	\N	1	\N	\N
1584	1380	2-Jan	\N	1	\N	\N
1585	1381	MB-058593	\N	1	\N	\N
1586	1382	MB-587743	\N	1	\N	\N
1587	1383	MC-820450	\N	1	\N	\N
1588	1384	MC-820451	\N	1	\N	\N
1589	1385	46210-58Y10	\N	1	\N	\N
1590	1386	46210-58Y10C	\N	1	\N	\N
1591	1387	51560-85752	\N	1	\N	\N
1592	1388	51550-84150	\N	1	\N	\N
1593	1389	RT-144M	\N	1	\N	\N
1594	1389	SA-144	\N	2	\N	\N
1595	1390	SA-808	\N	1	\N	\N
1596	1391	8-97033-173-3	\N	1	\N	\N
1597	1391	MOPI-173	\N	2	\N	\N
1598	1392	MD181583	\N	1	\N	\N
1599	1392	MOPM-583	\N	2	\N	\N
1600	1393	15010-43G04	\N	1	\N	\N
1601	1393	MOPN-404	\N	2	\N	\N
1602	1394	15100-64041	\N	1	\N	\N
1603	1394	MOPT-041	\N	2	\N	\N
1604	1395	MEP-2125	\N	1	\N	\N
1605	1396	MEP-400S	\N	1	\N	\N
1606	1397	MEP-0312	\N	1	\N	\N
1607	1398	MEP-0312SI	\N	1	\N	\N
1608	1399	120	\N	1	\N	\N
1609	1400	144	\N	1	\N	\N
1610	1401	72	\N	1	\N	\N
1611	1402	APC-112	\N	1	\N	\N
1612	1403	APC-114	\N	1	\N	\N
1613	1404	APC-108	\N	1	\N	\N
1614	1405	APC154	\N	1	\N	\N
1615	1406	STL-178	\N	1	\N	\N
1616	1407	STL-248	\N	1	\N	\N
1617	1408	STL-258	\N	1	\N	\N
1618	1409	E-548	\N	1	\N	\N
1619	1409	SM-100	\N	2	\N	\N
1620	1410	SM-125C	\N	1	\N	\N
1621	1411	SM-172	\N	1	\N	\N
1622	1412	STL-186LA	\N	1	\N	\N
1623	1413	STL-1017L	\N	1	\N	\N
1624	1414	82870-60C10	\N	1	\N	\N
1625	1415	82870-60C10	\N	1	\N	\N
1626	1416	SM-1176	\N	1	\N	\N
1628	1418	SM-1176-1	\N	1	\N	\N
1629	1419	809-03002	\N	1	\N	\N
1630	1420	HS-OS-03L	\N	1	\N	\N
1631	1421	HS-PI-49	\N	1	\N	\N
1632	1422	CFD100C-24V	\N	1	\N	\N
1633	1422	CTH-924	\N	2	\N	\N
1634	1423	854-03706	\N	1	\N	\N
1635	1424	UG71-43-800A	\N	1	\N	\N
1636	1425	NM-260V-3	\N	1	\N	\N
1637	1426	221-02105	\N	1	\N	\N
1638	1427	809-03004	\N	1	\N	\N
1639	1428	HS-7114N	\N	1	\N	\N
1640	1429	HS-7116N	\N	1	\N	\N
1641	1430	HS-212-151	\N	1	\N	\N
1642	1431	HS-511-045	\N	1	\N	\N
1643	1432	HS-7532	\N	1	\N	\N
1644	1433	HS-7510	\N	1	\N	\N
1645	1434	ALF-197-F30	\N	1	\N	\N
1646	1435	ALF-197-F40	\N	1	\N	\N
1647	1436	ALF-197-SF40	\N	1	\N	\N
1648	1437	214-02903	\N	1	\N	\N
1649	1437	MC-838211	\N	2	\N	\N
1650	1438	204-02904	\N	1	\N	\N
1651	1438	59300-83401	\N	2	\N	\N
1652	1439	MC-808718	\N	1	\N	\N
1653	1440	5-13620-050-1	\N	1	\N	\N
1654	1441	8-97115-730-0	\N	1	\N	\N
1655	1442	5-13620-130-1	\N	1	\N	\N
1656	1443	23210-100-0	\N	1	\N	\N
1657	1444	78210-295-0	\N	1	\N	\N
1658	1445	5-13620-006-1	\N	1	\N	\N
1659	1446	14 AWG	\N	1	\N	\N
1660	1447	16 AWG	\N	1	\N	\N
1661	1448	18 AWG	\N	1	\N	\N
1662	1449	MD-000508	\N	1	\N	\N
1663	1450	MD-184303	\N	1	\N	\N
1664	1451	ME-091814	\N	1	\N	\N
1665	1452	0986AF6014	\N	1	\N	\N
1666	1452	FC-208A	\N	2	\N	\N
1667	1453	3397015004	\N	1	\N	\N
1668	1453	BA20	\N	2	\N	\N
1669	1454	3397015002	\N	1	\N	\N
1670	1454	BA18	\N	2	\N	\N
1671	1455	242230599	\N	1	\N	\N
1672	1455	WR8DPP30W	\N	2	\N	\N
1673	1456	242230557	\N	1	\N	\N
1674	1456	FR8DPP30X	\N	2	\N	\N
1675	1457	ALT-CB-MT-01	\N	1	\N	\N
1676	1457	NM-354-3	\N	2	\N	\N
1677	1458	ALT-CB-MT-01	\N	1	\N	\N
1678	1458	NM-354-3	\N	2	\N	\N
1679	1459	87500	\N	1	\N	\N
1680	1460	53402-79020	\N	1	\N	\N
1681	1461	53401-79020	\N	1	\N	\N
1682	1462	GUM-91	\N	1	\N	\N
1683	1463	GUK-18	\N	1	\N	\N
1684	1464	GUIS-63	\N	1	\N	\N
1685	1465	GUT-13	\N	1	\N	\N
1686	1466	9864508514	\N	1	\N	\N
1687	1466	FC-321	\N	2	\N	\N
1688	1467	0986AF1023	\N	1	\N	\N
1689	1467	C-806	\N	2	\N	\N
1690	1468	0986AF6009	\N	1	\N	\N
1691	1468	FC-235	\N	2	\N	\N
1692	1469	0986AF6008	\N	1	\N	\N
1693	1469	FC-607	\N	2	\N	\N
1694	1470	242135509	\N	1	\N	\N
1695	1470	YR7MPP33	\N	2	\N	\N
1696	1471	9864508514	\N	1	\N	\N
1697	1471	FC-321	\N	2	\N	\N
1700	1473	0986AF4047	\N	1	\N	\N
1701	1473	CA-1114	\N	2	\N	\N
1706	1476	242135509	\N	1	\N	\N
1707	1476	YR7MPP33	\N	2	\N	\N
1708	1477	MR-407903	\N	1	\N	\N
1709	1478	MR-527979	\N	1	\N	\N
1710	1479	8-94338-022-0	\N	1	\N	\N
1711	1480	8-94461-250-0	\N	1	\N	\N
1712	1481	41120-VK101	\N	1	\N	\N
1713	1482	K011-33-24Z	\N	1	\N	\N
1714	1483	58102-4AA00	\N	1	\N	\N
1715	1484	55100-78450	\N	1	\N	\N
1716	1485	UHY2-49-240	\N	1	\N	\N
1717	1486	KS-6425	\N	1	\N	\N
1718	1486	MB-166425	\N	2	\N	\N
1719	1487	8-97127-431-0	\N	1	\N	\N
1702	1474	0986AF6009	\N	1	2025-09-12 23:38:44.517573+00	\N
1704	1475	0986AF6008	\N	1	2025-09-12 23:38:44.609505+00	\N
1705	1475	FC-607	\N	2	2025-09-12 23:38:44.609505+00	\N
1627	1417	SM-2833	\N	1	2025-09-13 00:17:09.09415+00	\N
1720	1487	IS-4310	\N	2	\N	\N
1721	1487	KS-4310	\N	3	\N	\N
1722	1488	1-87830-455-0	\N	1	\N	\N
1723	1489	1-87830-077-2	\N	1	\N	\N
1724	1490	04311-27020	\N	1	\N	\N
1725	1491	8-94233-501-3	\N	1	\N	\N
1726	1491	NW05-103-20	\N	2	\N	\N
1727	1492	8-94233-500-3	\N	1	\N	\N
1728	1492	NW05-103-10	\N	2	\N	\N
1729	1493	NS04-121	\N	1	\N	\N
1730	1494	8-97230-425-0	\N	1	\N	\N
1731	1494	NW05-114-10	\N	2	\N	\N
1732	1495	8-97230-426-0	\N	1	\N	\N
1733	1495	NW05-114-20	\N	2	\N	\N
1734	1496	MB-295340	\N	1	\N	\N
1735	1496	NT04-109-	\N	2	\N	\N
1736	1497	8-94258-526-0	\N	1	\N	\N
1737	1497	NC05-112-	\N	2	\N	\N
1738	1498	8-97136-406-0	\N	1	\N	\N
1739	1498	NC05-126	\N	2	\N	\N
1740	1499	VA-8290K	\N	1	\N	\N
1741	1500	VA-8291K	\N	1	\N	\N
1742	1501	VA-621K	\N	1	\N	\N
1743	1502	VA-428K	\N	1	\N	\N
1744	1503	VA-4054K	\N	1	\N	\N
1745	1504	GC-406	\N	1	\N	\N
1746	1504	GC-805	\N	2	\N	\N
1747	1505	GC-506	\N	1	\N	\N
1748	1506	GC-412	\N	1	\N	\N
1749	1507	GFC-319	\N	1	\N	\N
1750	1508	DB-1116	\N	1	\N	\N
1751	1509	DB-1774	\N	1	\N	\N
1752	1510	DB-2245	\N	1	\N	\N
1753	1511	DB-1390	\N	1	\N	\N
1754	1512	DB-2374	\N	1	\N	\N
1755	1513	DB-1769	\N	1	\N	\N
1756	1514	PRD-29426K	\N	1	\N	\N
1757	1515	PRD-35078	\N	1	\N	\N
1758	1516	PRD-47582CT	\N	1	\N	\N
1759	1517	PRD-47365CT	\N	1	\N	\N
1760	1518	PRD-36065	\N	1	\N	\N
1761	1518	RB-74	\N	2	\N	\N
1762	1519	DB-1769	\N	1	\N	\N
1763	1519	PRD-36224	\N	2	\N	\N
1764	1520	PBS-356602	\N	1	\N	\N
1765	1521	PBS-459919	\N	1	\N	\N
1766	1521	ST-103	\N	2	\N	\N
1767	1522	PBS-264462	\N	1	\N	\N
1768	1523	BS-5238	\N	1	\N	\N
1769	1524	MB-857837	\N	1	\N	\N
1770	1525	MR-527545	\N	1	\N	\N
1771	1526	8-94438-689-0	\N	1	\N	\N
1772	1527	55100-78812	\N	1	\N	\N
1773	1527	55800-78812	\N	2	\N	\N
1774	1528	S083-33-651	\N	1	\N	\N
1775	1529	MB-082335	\N	1	\N	\N
1776	1530	47731-28020	\N	1	\N	\N
1777	1531	58112-44010	\N	1	\N	\N
1778	1532	MC-092551	\N	1	\N	\N
1779	1533	8-97035-261-0	\N	1	\N	\N
1780	1534	04479-12091	\N	1	\N	\N
1781	1535	04479-28010	\N	1	\N	\N
1782	1536	MB-193530	\N	1	\N	\N
1783	1537	MB-261593	\N	1	\N	\N
1784	1538	MB-534396	\N	1	\N	\N
1785	1539	MR-307786	\N	1	\N	\N
1786	1540	FAS-8044	\N	1	\N	\N
1787	1541	FAS-8072	\N	1	\N	\N
1788	1542	FAS-8950	\N	1	\N	\N
1789	1543	FAS-8971	\N	1	\N	\N
1790	1544	A42	\N	1	\N	\N
1791	1544	RPF-3430	\N	2	\N	\N
1792	1545	A43	\N	1	\N	\N
1793	1545	RPF-3440	\N	2	\N	\N
1794	1546	A60	\N	1	\N	\N
1795	1546	RPF-3610	\N	2	\N	\N
1796	1547	A62	\N	1	\N	\N
1797	1547	RPF-3630	\N	2	\N	\N
1798	1548	A65	\N	1	\N	\N
1799	1548	RPF-3660	\N	2	\N	\N
1800	1549	A64	\N	1	\N	\N
1801	1549	RPF-3650	\N	2	\N	\N
1802	1550	A48	\N	1	\N	\N
1803	1550	RPF-3490	\N	2	\N	\N
1804	1551	A49	\N	1	\N	\N
1805	1551	RPF-3500	\N	2	\N	\N
1806	1552	A39	\N	1	\N	\N
1807	1552	RPF-3400	\N	2	\N	\N
1808	1553	B41	\N	1	\N	\N
1809	1553	RPF-5430	\N	2	\N	\N
1810	1554	B64	\N	1	\N	\N
1811	1554	RPF-5660	\N	2	\N	\N
1812	1555	B63	\N	1	\N	\N
1813	1555	RPF-5650	\N	2	\N	\N
1814	1556	B61	\N	1	\N	\N
1815	1556	RPF-5630	\N	2	\N	\N
1816	1557	B62	\N	1	\N	\N
1817	1557	RPF-5640	\N	2	\N	\N
1818	1558	B53	\N	1	\N	\N
1819	1558	RPF-5550	\N	2	\N	\N
1820	1559	B54	\N	1	\N	\N
1821	1559	RPF-5560	\N	2	\N	\N
1822	1560	B55	\N	1	\N	\N
1823	1560	RPF-5570	\N	2	\N	\N
1824	1562	MP4040K	\N	1	\N	\N
1825	1563	RP4040K	\N	1	\N	\N
1826	1564	MP4038K	\N	1	\N	\N
1827	1565	MP4038K	\N	1	\N	\N
1828	1566	RP4038K	\N	1	\N	\N
1829	1567	RP4038K	\N	1	\N	\N
1830	1568	218-1903	\N	1	\N	\N
1831	1568	ST-100	\N	2	\N	\N
1832	1569	218-1903	\N	1	\N	\N
1833	1569	ST-90	\N	2	\N	\N
1834	1570	ST-100	\N	1	\N	\N
1835	1570	VK-9919	\N	2	\N	\N
1837	1572	09289-06012	\N	1	\N	\N
1838	1573	RVC-12007	\N	1	\N	\N
1839	1574	RVC-52503	\N	1	\N	\N
1840	1575	113TR-25MM	\N	1	\N	\N
1841	1576	IIS-0209 IN	\N	1	\N	\N
1842	1577	EIS-5209 EX	\N	1	\N	\N
1843	1578	SAE 68	\N	1	\N	\N
1844	1579	31100-86080	\N	1	\N	\N
1845	1580	44115-86458	\N	1	\N	\N
1846	1581	44115-86775	\N	1	\N	\N
1847	1582	44115-86785	\N	1	\N	\N
1848	1583	CKK-3302	\N	1	\N	\N
1849	1583	CKMZ-3312	\N	2	\N	\N
1850	1584	5083-33-651	\N	1	\N	\N
1851	1584	CPK-3655	\N	2	\N	\N
1852	1585	ST-1640	\N	1	\N	\N
1853	1586	GU-1540	\N	1	\N	\N
1854	1586	ST-1540	\N	2	\N	\N
1855	1587	GUT-24	\N	1	\N	\N
1856	1588	GUM-88	\N	1	\N	\N
1857	1589	09289-09252	\N	1	\N	\N
1858	1590	58TKA3703	\N	1	\N	\N
1859	1591	DL-312	\N	1	\N	\N
1860	1592	DL-324	\N	1	\N	\N
1861	1593	13592P STD	\N	1	\N	\N
1862	1594	13592P-020 0.50	\N	1	\N	\N
1863	1595	DB-1460GCT	\N	1	\N	\N
1864	1596	DB-1772GCT	\N	1	\N	\N
1865	1597	DB-2525GCT	\N	1	\N	\N
1866	1598	DB-1741GCT	\N	1	\N	\N
1867	1599	DB-2396GCT	\N	1	\N	\N
1868	1600	DB-1482GCT	\N	1	\N	\N
1869	1601	DB-1200GCT	\N	1	\N	\N
1870	1602	DB-1841GCT	\N	1	\N	\N
1871	1603	DB-1681GCT	\N	1	\N	\N
1872	1604	DB-1515GCT	\N	1	\N	\N
1873	1605	DB-1817GCT	\N	1	\N	\N
1874	1606	DB-388GCT	\N	1	\N	\N
1875	1607	DB-1774GCT	\N	1	\N	\N
1876	1608	DB-1916GCT	\N	1	\N	\N
1877	1609	DS-4452	\N	1	\N	\N
1878	1610	DS-4495	\N	1	\N	\N
1879	1611	BS-5303	\N	1	\N	\N
1880	1612	BR-2715	\N	1	\N	\N
1881	1613	BR-033	\N	1	\N	\N
1882	1614	BR-2840	\N	1	\N	\N
1883	1615	BR-9251	\N	1	\N	\N
1884	1616	BR-2208	\N	1	\N	\N
1885	1617	BR-234	\N	1	\N	\N
1886	1618	BR-9447	\N	1	\N	\N
1887	1619	BR-2332	\N	1	\N	\N
1888	1620	BR-9508	\N	1	\N	\N
1889	1621	BR-9463	\N	1	\N	\N
1890	1622	BR-2732	\N	1	\N	\N
1891	1623	GA-369	\N	1	\N	\N
1892	1624	R590A STD	\N	1	\N	\N
1893	1625	R590 0.25	\N	1	\N	\N
1894	1626	R590 0.50	\N	1	\N	\N
1895	1627	R658 STD	\N	1	\N	\N
1896	1628	R658 0.25	\N	1	\N	\N
1897	1629	R658 0.50	\N	1	\N	\N
1898	1630	R593 STD	\N	1	\N	\N
1899	1631	R660 STD	\N	1	\N	\N
1900	1632	R660 0.25	\N	1	\N	\N
1901	1633	B-49.3	\N	1	\N	\N
1902	1633	JT	\N	2	\N	\N
1903	1634	HM:42.6	\N	1	\N	\N
1904	1634	P-2	\N	2	\N	\N
1905	1635	4PK-1065	\N	1	\N	\N
1906	1635	P-2	\N	2	\N	\N
1907	1636	3	\N	1	\N	\N
1908	1636	JT	\N	2	\N	\N
1909	1637	B-49.3	\N	1	\N	\N
1910	1637	JT	\N	2	\N	\N
1911	1638	HM:42.6	\N	1	\N	\N
1912	1638	P-2	\N	2	\N	\N
1913	1639	4PK-1065	\N	1	\N	\N
1914	1639	P-2	\N	2	\N	\N
1915	1640	3	\N	1	\N	\N
1916	1640	JT	\N	2	\N	\N
1917	1641	103T	\N	1	\N	\N
1918	1641	WE01	\N	2	\N	\N
1919	1642	04465-0K280	\N	1	\N	\N
1920	1642	04465-0K360	\N	2	\N	\N
1922	1644	90916-T2033	\N	1	\N	\N
1923	1645	90369-T0003	\N	1	\N	\N
1924	1646	2342A019	\N	1	\N	\N
1925	1647	27301-2B010	\N	1	\N	\N
1926	1648	S083-26-610	\N	1	\N	\N
1927	1649	6203 2RS	\N	1	\N	\N
1928	1650	UV30-6A	\N	1	\N	\N
1929	1651	UV30-8A	\N	1	\N	\N
1930	1652	6303 2RS	\N	1	\N	\N
1931	1653	LM48510	\N	1	\N	\N
1932	1653	LM48548	\N	2	\N	\N
1933	1654	JL69310	\N	1	\N	\N
1934	1654	JL69349	\N	2	\N	\N
1935	1655	78TKC5401	\N	1	\N	\N
1936	1656	78TKL4001	\N	1	\N	\N
1937	1657	JPU60-129	\N	1	\N	\N
1938	1658	JPU58-010A-1	\N	1	\N	\N
1939	1659	#5042	\N	1	\N	\N
1940	1660	#SD2585	\N	1	\N	\N
1941	1661	#2891R	\N	1	\N	\N
1942	1662	#2894R	\N	1	\N	\N
1943	1663	1145A019	\N	1	\N	\N
1944	1664	MD-152622	\N	1	\N	\N
1945	1665	MD-310484	\N	1	\N	\N
1946	1666	R201-12-205	\N	1	\N	\N
1947	1667	ME-121234	\N	1	\N	\N
1948	1668	ME-092855	\N	1	\N	\N
1949	1669	ME-091538	\N	1	\N	\N
1950	1670	FC-510	\N	1	\N	\N
1951	1670	SF-M500	\N	2	\N	\N
1952	1671	8-94394-079-1	\N	1	\N	\N
1953	1671	FC-507	\N	2	\N	\N
1954	1671	SF-M505	\N	3	\N	\N
1955	1672	FC-1008	\N	1	\N	\N
1956	1672	FC-331	\N	2	\N	\N
1957	1672	SF-M5036	\N	3	\N	\N
1958	1673	FC-335	\N	1	\N	\N
1959	1673	ME-131824	\N	2	\N	\N
1960	1674	16 AWG	\N	1	\N	\N
1961	1675	12111-86050	\N	1	\N	\N
1962	1676	RF 01-23-200	\N	1	\N	\N
1963	1677	8-94438-969-1	\N	1	\N	\N
1964	1678	8-97107-321-0	\N	1	\N	\N
1965	1678	CL-321	\N	2	\N	\N
1966	1679	8-94389-210-1	\N	1	\N	\N
1967	1679	SC-5285	\N	2	\N	\N
1968	1680	CP-362R	\N	1	\N	\N
1969	1681	CP-383L	\N	1	\N	\N
1970	1682	TRE-C3460	\N	1	\N	\N
1971	1683	TRE-C3191	\N	1	\N	\N
1972	1684	CE-0682	\N	1	\N	\N
1973	1685	CE-0683	\N	1	\N	\N
1974	1686	DIN74MF	\N	1	\N	\N
1975	1687	B-2	\N	1	\N	\N
1976	1688	B3	\N	1	\N	\N
1977	1689	B6	\N	1	\N	\N
1978	1690	B7	\N	1	\N	\N
1979	1691	B8	\N	1	\N	\N
1980	1692	1.5	\N	1	\N	\N
1981	1693	1.75	\N	1	\N	\N
1982	1694	2	\N	1	\N	\N
1983	1695	3.5	\N	1	\N	\N
1984	1696	4	\N	1	\N	\N
1985	1697	15449-009	\N	1	\N	\N
1986	1698	8-91438945-1	\N	1	\N	\N
1987	1699	28380-85301	\N	1	\N	\N
1988	1700	42311-86033	\N	1	\N	\N
1989	1701	41411-80201	\N	1	\N	\N
1990	1702	CAN-250ML	\N	1	\N	\N
1991	1703	500ML	\N	1	\N	\N
1992	1704	MCX10	\N	1	\N	\N
1993	1705	1.25 WITH ALLEN KEY	\N	1	\N	\N
1994	1706	21HEX1.5-L	\N	1	\N	\N
1995	1707	17HEX1.5	\N	1	\N	\N
1996	1708	19HEX1.5	\N	1	\N	\N
1997	1709	21HEX1.5	\N	1	\N	\N
1998	1710	21HEX1.5-S	\N	1	\N	\N
1999	1711	A31	\N	1	\N	\N
2000	1711	RPF-3320	\N	2	\N	\N
2001	1712	A32	\N	1	\N	\N
2002	1712	RPF-3330	\N	2	\N	\N
2003	1713	A35	\N	1	\N	\N
2004	1713	RPF-3360	\N	2	\N	\N
2005	1714	A40	\N	1	\N	\N
2006	1714	RPF-3410	\N	2	\N	\N
2007	1715	A41	\N	1	\N	\N
2008	1715	RPF-3420	\N	2	\N	\N
2009	1716	A44	\N	1	\N	\N
2010	1716	RPF-3450	\N	2	\N	\N
2011	1717	A60	\N	1	\N	\N
2012	1717	RPF-3610	\N	2	\N	\N
2013	1718	RPF-2245	\N	1	\N	\N
2014	1719	RPF-2250	\N	1	\N	\N
2015	1720	RPF-2365	\N	1	\N	\N
2016	1721	RPF-2355	\N	1	\N	\N
2017	1722	RPF-2425	\N	1	\N	\N
2018	1723	4PK-895	\N	1	\N	\N
2019	1724	4PK-900	\N	1	\N	\N
2020	1725	4PK-675	\N	1	\N	\N
2021	1726	GC-518	\N	1	\N	\N
2022	1726	GC-526	\N	2	\N	\N
2023	1727	32639 STD	\N	1	\N	\N
2024	1728	32639 0.25	\N	1	\N	\N
2025	1729	6206ZZ	\N	1	\N	\N
2026	1730	43KWD07ACA	\N	1	\N	\N
2027	1731	RCT8371SA2	\N	1	\N	\N
2028	1732	67TB0806	\N	1	\N	\N
2029	1733	CT70B	\N	1	\N	\N
2030	1734	RCTS338SA2	\N	1	\N	\N
2031	1735	JPU58-010	\N	1	\N	\N
2032	1736	JPU58-012	\N	1	\N	\N
2033	1737	T5082RS	\N	1	\N	\N
2034	1738	JL69310	\N	1	\N	\N
2035	1738	JL69349	\N	2	\N	\N
2036	1739	LM102910	\N	1	\N	\N
2037	1739	LM102949	\N	2	\N	\N
2038	1740	303026	\N	1	\N	\N
2039	1741	32009XA	\N	1	\N	\N
2040	1742	69042RS	\N	1	\N	\N
2041	1743	6004	\N	1	\N	\N
2042	1744	28BWDD3	\N	1	\N	\N
2043	1745	3579125	\N	1	\N	\N
2044	1746	DG4D94W12	\N	1	\N	\N
2045	1747	45KWD09(45KWD05	\N	1	\N	\N
2046	1748	2DJAD50	\N	1	\N	\N
2047	1749	47KWD01	\N	1	\N	\N
2048	1750	58TK23701	\N	1	\N	\N
2049	1751	30204JR	\N	1	\N	\N
2050	1752	DB-3074	\N	1	\N	\N
2051	1753	RHG-97251	\N	1	\N	\N
2052	1754	GA-364	\N	1	\N	\N
2053	1755	GPUA-371	\N	1	\N	\N
2054	1756	OK75A-10-100	\N	1	\N	\N
2055	1757	R2-A	\N	1	\N	\N
2056	1758	MD-069782	\N	1	\N	\N
2057	1759	50	\N	1	\N	\N
2058	1760	26300-42040	\N	1	\N	\N
2059	1761	51110-85850	\N	1	\N	\N
2060	1762	51110-85860	\N	1	\N	\N
2061	1763	25500-02500	\N	1	\N	\N
2062	1764	12V	\N	1	\N	\N
2063	1764	FC2	\N	2	\N	\N
2064	1765	45200-86026	\N	1	\N	\N
2065	1766	45200-86027	\N	1	\N	\N
2066	1767	45201-68H02	\N	1	\N	\N
2067	1768	45201-68H03	\N	1	\N	\N
2068	1769	M4631K STD	\N	1	\N	\N
2069	1770	M4547K 0.25	\N	1	\N	\N
2070	1771	P240	\N	1	\N	\N
2071	1772	P400	\N	1	\N	\N
2072	1773	MB-390950	\N	1	\N	\N
2073	1774	MB-390955	\N	1	\N	\N
2074	1775	MC-124106	\N	1	\N	\N
2075	1776	EF-1333	\N	1	\N	\N
2076	1777	SP019	\N	1	\N	\N
2077	1778	GREEN	\N	1	\N	\N
2078	1779	PINK	\N	1	\N	\N
2079	1780	8-97033-368-3	\N	1	\N	\N
2080	1781	ME-660596	\N	1	\N	\N
2081	1782	ME-656514	\N	1	\N	\N
2082	1783	ME-053885	\N	1	\N	\N
2083	1784	MC-817018	\N	1	\N	\N
2084	1785	MC-808504	\N	1	\N	\N
2085	1786	MC-817017	\N	1	\N	\N
2086	1787	FF-6333P	\N	1	\N	\N
2087	1788	FF-6336P	\N	1	\N	\N
2088	1789	FO-4584P	\N	1	\N	\N
2089	1790	EG-2291	\N	1	\N	\N
2090	1791	VI-175	\N	1	\N	\N
2091	1792	VI-237	\N	1	\N	\N
2092	1793	VI-231	\N	1	\N	\N
2093	1794	VI-180P	\N	1	\N	\N
2094	1795	M46	\N	1	\N	\N
2095	1795	SAM049	\N	2	\N	\N
2096	1796	M36	\N	1	\N	\N
2097	1796	SAM082	\N	2	\N	\N
2098	1797	M45	\N	1	\N	\N
2099	1797	SAM041	\N	2	\N	\N
2100	1798	M42	\N	1	\N	\N
2101	1798	SAM050	\N	2	\N	\N
2102	1799	M38	\N	1	\N	\N
2103	1799	SAM042	\N	2	\N	\N
2104	1800	98111-7300	\N	1	\N	\N
2105	1801	MC-820241	\N	1	\N	\N
2106	1802	8-94121-810-0	\N	1	\N	\N
2107	1803	MB-302838	\N	1	\N	\N
2108	1804	N70L	\N	1	\N	\N
2109	1805	DIN74	\N	1	\N	\N
2110	1806	GUT-12	\N	1	\N	\N
2111	1807	214-1911	\N	1	\N	\N
2112	1808	5HX12	\N	1	\N	\N
2113	1809	K-442	\N	1	\N	\N
2114	1810	K-434	\N	1	\N	\N
2115	1811	K-653	\N	1	\N	\N
2116	1812	K-627	\N	1	\N	\N
2117	1813	TANZO	\N	1	\N	\N
2118	1814	31320-51A10	\N	1	\N	\N
2119	1815	12V	\N	1	\N	\N
2120	1816	24V	\N	1	\N	\N
2121	1817	FI-305	\N	1	\N	\N
2122	1818	51110-85840	\N	1	\N	\N
2123	1819	10MM	\N	1	\N	\N
2124	1820	1-37516-005-0	\N	1	\N	\N
2125	1821	33410-85120	\N	1	\N	\N
2126	1822	102T	\N	1	\N	\N
2127	1822	WL01-12-205	\N	2	\N	\N
2128	1823	162T	\N	1	\N	\N
2129	1824	164T	\N	1	\N	\N
2130	1826	HEP-01	\N	1	\N	\N
2131	1827	HEP-02	\N	1	\N	\N
2132	1828	ISC-519	\N	1	\N	\N
2133	1829	MZC-619	\N	1	\N	\N
2134	1830	MFC-528	\N	1	\N	\N
2135	1831	2	\N	1	\N	\N
2136	1834	3	\N	1	\N	\N
2137	1835	45200-86027	\N	1	\N	\N
2138	1835	MSA-86027	\N	2	\N	\N
2139	1836	MB-349475	\N	1	\N	\N
2140	1837	FC2	\N	1	\N	\N
2141	1838	K71E-16-460A	\N	1	\N	\N
2142	1839	DS-022	\N	1	\N	\N
2143	1840	DS-032	\N	1	\N	\N
2144	1841	K67213850	\N	1	\N	\N
2145	1842	B38	\N	1	\N	\N
2146	1842	RPF-5400	\N	2	\N	\N
2147	1843	B40	\N	1	\N	\N
2148	1843	RPF-5420	\N	2	\N	\N
2149	1844	B41	\N	1	\N	\N
2150	1844	RPF-5430	\N	2	\N	\N
2151	1845	B42	\N	1	\N	\N
2152	1845	RPF-5440	\N	2	\N	\N
2153	1846	B43	\N	1	\N	\N
2154	1846	RPF-5450	\N	2	\N	\N
2155	1847	B51	\N	1	\N	\N
2156	1847	RPF-5530	\N	2	\N	\N
2157	1848	B52	\N	1	\N	\N
2158	1848	RPF-5540	\N	2	\N	\N
2159	1854	FCS-9620	\N	1	\N	\N
2160	1855	FCS-9530	\N	1	\N	\N
2161	1856	FAS-8946	\N	1	\N	\N
2162	1857	FAS-8620	\N	1	\N	\N
2163	1858	RWC-1615	\N	1	\N	\N
2164	1859	RWC-1715	\N	1	\N	\N
2165	1860	RWC-19M	\N	1	\N	\N
2166	1861	RWC-20M	\N	1	\N	\N
2167	1862	RHUB-11T	\N	1	\N	\N
2168	1863	RDL-95	\N	1	\N	\N
2169	1864	RDL-9B	\N	1	\N	\N
2170	1865	RDL-107	\N	1	\N	\N
2171	1866	FAS-8530	\N	1	\N	\N
2172	1867	FFS-1929	\N	1	\N	\N
2173	1868	FFS-1530	\N	1	\N	\N
2174	1869	FFS-1308	\N	1	\N	\N
2175	1870	RHG-84602	\N	1	\N	\N
2176	1871	RHG-81526	\N	1	\N	\N
2177	1872	8-97032-847-0	\N	1	\N	\N
2178	1872	NS05-126	\N	2	\N	\N
2179	1873	NC13-109	\N	1	\N	\N
2180	1873	S089-41-990	\N	2	\N	\N
2181	1874	CTS-SC	\N	1	\N	\N
2182	1874	SQ-215A	\N	2	\N	\N
2183	1875	CTS-DC	\N	1	\N	\N
2184	1875	SQ-216A	\N	2	\N	\N
2185	1876	8-94234-319-0	\N	1	\N	\N
2186	1877	3874-28-330	\N	1	\N	\N
2187	1878	90385-18046	\N	1	\N	\N
2188	1879	8-97074-826-0	\N	1	\N	\N
2189	1880	9-51351-029	\N	1	\N	\N
2190	1881	8-94433-672-0	\N	1	\N	\N
2191	1882	MB-005833	\N	1	\N	\N
2192	1883	MB-430158	\N	1	\N	\N
2193	1884	54630-4A000	\N	1	\N	\N
2194	1885	48674-26021	\N	1	\N	\N
2195	1886	48674-26040	\N	1	\N	\N
2196	1887	54476-01G00	\N	1	\N	\N
2197	1888	5083-34-136	\N	1	\N	\N
2198	1889	54630-4F000	\N	1	\N	\N
2199	1890	ACS-0305	\N	1	\N	\N
2200	1891	63/32ZNR	\N	1	\N	\N
2201	1892	LM603011	\N	1	\N	\N
2202	1892	LM603049	\N	2	\N	\N
2203	1893	32209JR	\N	1	\N	\N
2204	1894	30205JR	\N	1	\N	\N
2205	1895	022510-4170	\N	1	\N	\N
2206	1896	022510-4140	\N	1	\N	\N
2207	1897	VA-9001K	\N	1	\N	\N
2208	1898	VA-6100WK	\N	1	\N	\N
2209	1899	VK-9952	\N	1	\N	\N
2210	1900	VK-9951WA	\N	1	\N	\N
2211	1901	LN-0450	\N	1	\N	\N
2212	1902	LN-0290	\N	1	\N	\N
2213	1903	8-97107-348	\N	1	\N	\N
2214	1903	8-97107-349	\N	2	\N	\N
2215	1903	CE-5321R	\N	3	\N	\N
2216	1903	CE-L	\N	4	\N	\N
2217	1905	RHG-91446	\N	1	\N	\N
2218	1906	54011	\N	1	\N	\N
2219	1906	RHG-60250H	\N	2	\N	\N
2220	1907	A356YU100	\N	1	\N	\N
2221	1908	15777P STD	\N	1	\N	\N
2222	1910	5-12569-001-0	\N	1	\N	\N
2223	1911	ENOC PROTECT PREMIUM	\N	1	\N	\N
2224	1912	234-11521	\N	1	\N	\N
2225	1913	234-11527	\N	1	\N	\N
2226	1914	234-22802	\N	1	\N	\N
2227	1915	642-11324	\N	1	\N	\N
2228	1916	642-11341	\N	1	\N	\N
2229	1917	241-13305	\N	1	\N	\N
2230	1918	241-13306	\N	1	\N	\N
2231	1919	241-13315	\N	1	\N	\N
2232	1920	241-13345	\N	1	\N	\N
2233	1921	241-13387	\N	1	\N	\N
2234	1922	MB-4D35P	\N	1	\N	\N
2235	1923	ACP-001	\N	1	\N	\N
2236	1924	ACP-002	\N	1	\N	\N
2237	1925	11HOLES 6M16	\N	1	\N	\N
2238	1926	11HOLES	\N	1	\N	\N
2239	1927	YSPIS-23682-30020	\N	1	\N	\N
2240	1928	YHG-J3	\N	1	\N	\N
2241	1929	YHG-WE-S	\N	1	\N	\N
2242	1930	YVC-K6A-1	\N	1	\N	\N
2243	1931	63D4-2RS	\N	1	\N	\N
2244	1932	30205JR	\N	1	\N	\N
2245	1933	6202-2RS	\N	1	\N	\N
2246	1934	30211X	\N	1	\N	\N
2247	1935	30308D	\N	1	\N	\N
2248	1936	LM603011	\N	1	\N	\N
2249	1936	LM603049	\N	2	\N	\N
2250	1937	155R12C	\N	1	\N	\N
2251	1937	8PR	\N	2	\N	\N
2252	1938	L68110	\N	1	\N	\N
2253	1938	L68149	\N	2	\N	\N
2254	1939	63/28	\N	1	\N	\N
2255	1940	303056	\N	1	\N	\N
2256	1941	6302-2RS	\N	1	\N	\N
2257	1942	LM300811	\N	1	\N	\N
2258	1942	LM300849	\N	2	\N	\N
2259	1943	BSA-85223	\N	1	\N	\N
2260	1943	MC84309	\N	2	\N	\N
2261	1944	BSA-85229	\N	1	\N	\N
2262	1945	9-13314-803-11	\N	1	\N	\N
2263	1945	MHA-803	\N	2	\N	\N
2264	1946	8-94159-048-8	\N	1	\N	\N
2265	1946	MHA-048	\N	2	\N	\N
2266	1947	9-13314-804-11	\N	1	\N	\N
2267	1947	MHA-804	\N	2	\N	\N
2268	1948	BAG-60	\N	1	\N	\N
2269	1949	BOG-10	\N	1	\N	\N
2270	1950	BFG-100	\N	1	\N	\N
2271	1951	0545-18-712	\N	1	\N	\N
2272	1951	MHA-712	\N	2	\N	\N
2273	1952	MD-050196	\N	1	\N	\N
2274	1952	MHA-196	\N	2	\N	\N
2275	1953	MD-050201	\N	1	\N	\N
2276	1953	MHA-201	\N	2	\N	\N
2277	1954	37482-4250	\N	1	\N	\N
2278	1954	MHA-250	\N	2	\N	\N
2279	1955	KIB-820	\N	1	\N	\N
2280	1956	48900-85000	\N	1	\N	\N
2281	1956	MBP-5085	\N	2	\N	\N
2282	1957	CAH-3004	\N	1	\N	\N
2283	1958	CAH-3005	\N	1	\N	\N
2284	1959	KP-512	\N	1	\N	\N
2285	1960	TYD-112	\N	1	\N	\N
2286	1961	HEP-01	\N	1	\N	\N
2287	1962	HEP-02	\N	1	\N	\N
2288	1963	500CC	\N	1	\N	\N
2289	1964	DOT3	\N	1	\N	\N
2290	1965	12-168-00	\N	1	\N	\N
2291	1966	30-324-55	\N	1	\N	\N
2292	1967	30-321-55	\N	1	\N	\N
2293	1968	12028-575	\N	1	\N	\N
2294	1969	12022-475A	\N	1	\N	\N
2295	1970	10-107-21	\N	1	\N	\N
2296	1971	10-108-21	\N	1	\N	\N
2297	1972	C-7157	\N	1	\N	\N
2298	1973	T-7319	\N	1	\N	\N
2299	1974	32207 JR	\N	1	\N	\N
2300	1975	32208 JR	\N	1	\N	\N
2301	1976	DOT3	\N	1	\N	\N
2302	1977	NLGI-3	\N	1	\N	\N
2303	1978	NLGI-3	\N	1	\N	\N
2304	1979	NLGI-3	\N	1	\N	\N
2305	1980	HTA9Y	\N	1	\N	\N
2306	1981	MF-D009	\N	1	\N	\N
2307	1982	ASSTD	\N	1	\N	\N
2308	1982	SINGLE	\N	2	\N	\N
2309	1983	FD-6086	\N	1	\N	\N
2310	1984	31172-79010	\N	1	\N	\N
2311	1985	1-37516-006-1	\N	1	\N	\N
2312	1986	8-94213-515-1	\N	1	\N	\N
2313	1989	15110-63B00	\N	1	\N	\N
2314	1990	GUM-83	\N	1	\N	\N
2315	1991	GUT-27	\N	1	\N	\N
2316	1992	4PK-765	\N	1	\N	\N
2317	1993	GF-507	\N	1	\N	\N
2318	1994	MD-050545	\N	1	\N	\N
2319	1995	MR-519398	\N	1	\N	\N
2320	1996	48655-OK040	\N	1	\N	\N
2321	1997	OP-341397	\N	1	\N	\N
2322	1998	48654-OK040	\N	1	\N	\N
2323	1999	12305-0D130	\N	1	\N	\N
2324	2000	RSB-1412	\N	1	\N	\N
2325	2000	S083-99-356	\N	2	\N	\N
2326	2001	RSB-1411	\N	1	\N	\N
2327	2001	S083-99-354	\N	2	\N	\N
2328	2002	MB-176309	\N	1	\N	\N
2329	2002	RSB-7153	\N	2	\N	\N
2330	2003	MB-241818	\N	1	\N	\N
2331	2003	RSB-7154	\N	2	\N	\N
2332	2004	MR-162699	\N	1	\N	\N
2333	2004	RSB-7762	\N	2	\N	\N
2334	2005	MB-162132	\N	1	\N	\N
2335	2005	RWC-52M	\N	2	\N	\N
2336	2006	MB-162133	\N	1	\N	\N
2337	2006	RWC-53M	\N	2	\N	\N
2338	2007	7761	\N	1	\N	\N
2339	2007	MR-241623	\N	2	\N	\N
2340	2007	RSB-7311	\N	3	\N	\N
2341	2008	CL-7162	\N	1	\N	\N
2342	2008	MR-312030	\N	2	\N	\N
2343	2009	S083-34-830	\N	1	\N	\N
2344	2010	S083-34-840	\N	1	\N	\N
2345	2011	UH71-34-47	\N	1	\N	\N
2346	2012	MR-519398	\N	1	\N	\N
2347	2013	8-97220-043-0	\N	1	\N	\N
2348	2014	8-94223-366-0	\N	1	\N	\N
2349	2015	48654-0K040	\N	1	\N	\N
2350	2016	MR-992256	\N	1	\N	\N
2351	2017	MC-025198	\N	1	\N	\N
2352	2018	MC-025199	\N	1	\N	\N
2353	2019	MC-025195	\N	1	\N	\N
2354	2020	13560-85020	\N	1	\N	\N
2355	2021	CM-014U	\N	1	\N	\N
2356	2022	CTX-115A	\N	1	\N	\N
2357	2023	OTX-160A	\N	1	\N	\N
2358	2024	DTX-162A	\N	1	\N	\N
2359	2025	DTX-172	\N	1	\N	\N
2360	2026	CMT-142A	\N	1	\N	\N
2361	2027	GH-10	\N	1	\N	\N
2362	2028	GL-59	\N	1	\N	\N
2363	2029	GK-135	\N	1	\N	\N
2364	2030	GTA-305KS	\N	1	\N	\N
2365	2031	GTA-433K	\N	1	\N	\N
2366	2032	TSM-6	\N	1	\N	\N
2367	2033	12V	\N	1	\N	\N
2368	2033	237	\N	2	\N	\N
2369	2033	FR	\N	3	\N	\N
2370	2034	25813-4A001	\N	1	\N	\N
2371	2035	CTX-16A	\N	1	\N	\N
2372	2036	GWS-19A	\N	1	\N	\N
2373	2037	MC-85584	\N	1	\N	\N
2374	2037	MC-887166	\N	2	\N	\N
2375	2040	4PK-765	\N	1	\N	\N
2376	2041	MT-020	\N	1	\N	\N
2377	2042	DTX-232A	\N	1	\N	\N
2378	2043	CMTS-003A	\N	1	\N	\N
2379	2044	CMZ-603A	\N	1	\N	\N
2380	2045	GWK-15A	\N	1	\N	\N
2381	2046	GWS-11A	\N	1	\N	\N
2382	2047	DOT3	\N	1	\N	\N
2383	2048	EB3G-6F073-CF	\N	1	\N	\N
2384	2048	YTH-FRD-01	\N	2	\N	\N
2385	2049	14463-3XN813	\N	1	\N	\N
2386	2049	YTH-NS-06	\N	2	\N	\N
2387	2050	14463-3XN0A	\N	1	\N	\N
2388	2050	YTH-NH-07	\N	2	\N	\N
2389	2051	1505A850 YSMW	\N	1	\N	\N
2390	2051	YTH-MT-0	\N	2	\N	\N
2391	2052	YCRB-SZ-01	\N	1	\N	\N
2392	2053	1-363-10-271	\N	1	\N	\N
2393	2053	YHG-HA	\N	2	\N	\N
2394	2054	11044-AX000	\N	1	\N	\N
2395	2054	YHG-CG13-CG10	\N	2	\N	\N
2396	2055	MC-987854-3	\N	1	\N	\N
2397	2056	MC-987854-2	\N	1	\N	\N
2398	2057	627-3044-09	\N	1	\N	\N
2399	2058	F-193	\N	1	\N	\N
2400	2059	FC-326	\N	1	\N	\N
2401	2060	FC-607	\N	1	\N	\N
2402	2061	FC-317	\N	1	\N	\N
2403	2062	FC-319	\N	1	\N	\N
2404	2063	FC-234	\N	1	\N	\N
2405	2064	FC-208A	\N	1	\N	\N
2406	2065	C-326	\N	1	\N	\N
2407	2066	C-206	\N	1	\N	\N
2408	2067	C-204	\N	1	\N	\N
2409	2068	C-034	\N	1	\N	\N
2410	2069	C-318	\N	1	\N	\N
2411	2070	0114-0196	\N	1	\N	\N
2412	2071	C-503	\N	1	\N	\N
2413	2072	C-306	\N	1	\N	\N
2414	2073	C-415	\N	1	\N	\N
2415	2074	C-307	\N	1	\N	\N
2416	2075	C-304	\N	1	\N	\N
2417	2076	C-207	\N	1	\N	\N
2418	2077	C-206	\N	1	\N	\N
2419	2078	C-806	\N	1	\N	\N
2420	2079	C-809	\N	1	\N	\N
2421	2080	C-112	\N	1	\N	\N
2422	2081	C-525	\N	1	\N	\N
2423	2082	C-111	\N	1	\N	\N
2424	2083	C-110	\N	1	\N	\N
2425	2084	C-305	\N	1	\N	\N
2426	2085	C-223	\N	1	\N	\N
2427	2086	C-209	\N	1	\N	\N
2428	2087	N100L	\N	1	\N	\N
2429	2088	W44DC-82	\N	1	\N	\N
2430	2089	RHG-88709	\N	1	\N	\N
2432	2092	GUMZ-3	\N	1	\N	\N
2433	2092	GUMZ-4	\N	2	\N	\N
2434	2093	48810-80000	\N	1	\N	\N
2435	2093	OE-7481R	\N	2	\N	\N
2436	2094	48820-80000	\N	1	\N	\N
2437	2094	OE-7481L	\N	2	\N	\N
2438	2095	OK66A-12-111	\N	1	\N	\N
2439	2095	OK66A-12-121	\N	2	\N	\N
2440	2096	F-193	\N	1	\N	\N
2441	2097	F-321	\N	1	\N	\N
2442	2098	DF7REC2	\N	1	\N	\N
2443	2098	F01A127B02	\N	2	\N	\N
2444	2099	WGR8DQ1	\N	1	\N	\N
2445	2100	17220-55A-Z01	\N	1	\N	\N
2446	2101	R205-23-603	\N	1	\N	\N
2447	2102	23390-01070	\N	1	\N	\N
2448	2103	SD2585	\N	1	\N	\N
2449	2104	PZ-33	\N	1	\N	\N
2450	2105	90916-03093	\N	1	\N	\N
2451	2106	8-98319-898-0	\N	1	\N	\N
2452	2107	FP-13850	\N	1	\N	\N
2453	2108	5-13220-220-0	\N	1	\N	\N
2454	2109	FP-25570	\N	1	\N	\N
2455	2110	FP-20900	\N	1	\N	\N
2456	2111	NFM-74200C	\N	1	\N	\N
2457	2112	R201-23-311	\N	1	\N	\N
2458	2113	FS-20900	\N	1	\N	\N
2459	2114	NFM-T6717	\N	1	\N	\N
2460	2115	M100R1	\N	1	\N	\N
2461	2115	ME-656514	\N	2	\N	\N
2462	2116	DN-3340	\N	1	\N	\N
2463	2117	DN-3330	\N	1	\N	\N
2464	2118	12V	\N	1	\N	\N
2465	2119	12MM	\N	1	\N	\N
2466	2119	ME-056515	\N	2	\N	\N
2467	2120	ME-053766	\N	1	\N	\N
2468	2120	ME-053767	\N	2	\N	\N
2469	2121	52168	\N	1	\N	\N
2470	2121	52393	\N	2	\N	\N
2471	2122	672	\N	1	\N	\N
2472	2122	687	\N	2	\N	\N
2473	2123	R40-15A	\N	1	\N	\N
2474	2123	TR080803	\N	2	\N	\N
2475	2141	24XAH-1015	\N	1	\N	\N
2476	2142	SAE 15W-40	\N	1	\N	\N
2477	2143	AW68	\N	1	\N	\N
2478	2144	MP3	\N	1	\N	\N
2479	2145	SAE 20	\N	1	\N	\N
2480	2146	SAE 140	\N	1	\N	\N
2481	2147	SAE 90	\N	1	\N	\N
2482	2148	WL01-11-210	\N	1	\N	\N
2483	2149	ME-052272	\N	1	\N	\N
2484	2150	ME-052576	\N	1	\N	\N
2485	2151	8-94399-605-0	\N	1	\N	\N
2486	2152	SUPERGREAT LOWER	\N	1	\N	\N
2487	2153	SUPERGREAT UPPER	\N	1	\N	\N
2488	2154	1-09449-067	\N	1	\N	\N
2489	2155	1-09449-061	\N	1	\N	\N
2490	2156	1-09449-062	\N	1	\N	\N
2491	2158	SINGLE TIRE	\N	1	\N	\N
2492	2159	DOUBLE TIRE	\N	1	\N	\N
2493	2160	9-09843-062-1	\N	1	\N	\N
2494	2161	1-22440-033-2	\N	1	\N	\N
2495	2162	V10 GIGA	\N	1	\N	\N
2496	2163	H585807A000	\N	1	\N	\N
2497	2164	SYBDPJ-TY-D	\N	1	\N	\N
2498	2165	ME-040426	\N	1	\N	\N
2499	2166	E-134	\N	1	\N	\N
2500	2166	SL-1766	\N	2	\N	\N
2501	2167	E-362	\N	1	\N	\N
2502	2167	SL-1620	\N	2	\N	\N
2503	2168	E-363	\N	1	\N	\N
2504	2168	SL-1662	\N	2	\N	\N
2505	2169	E-548-9	\N	1	\N	\N
2506	2169	SL-759 9	\N	2	\N	\N
2507	2170	E-394 8	\N	1	\N	\N
2508	2170	SL-1771	\N	2	\N	\N
2509	2171	15W-40	\N	1	\N	\N
2510	2172	15W-40	\N	1	\N	\N
2511	2173	15W-40	\N	1	\N	\N
2512	2174	15W-40	\N	1	\N	\N
2513	2175	MP3	\N	1	\N	\N
2514	2176	NS60L	\N	1	\N	\N
2515	2177	12305-37070	\N	1	\N	\N
2516	2178	DB-1482GCT	\N	1	\N	\N
2517	2179	RHG-81184	\N	1	\N	\N
2518	2180	4PK-830	\N	1	\N	\N
2519	2181	9.5X650	\N	1	\N	\N
2520	2181	RPF-2255	\N	2	\N	\N
2521	2182	ME-400090	\N	1	\N	\N
2522	2183	MD-165631	\N	1	\N	\N
2523	2184	8-97140-854-0	\N	1	\N	\N
2524	2187	P800	\N	1	\N	\N
2525	2188	P1000	\N	1	\N	\N
2526	2189	P120	\N	1	\N	\N
2527	2190	MBI-167	\N	1	\N	\N
2528	2191	MB1-165	\N	1	\N	\N
2529	2192	GWK-15A	\N	1	\N	\N
2530	2193	JIN-296	\N	1	\N	\N
2531	2194	ISC-509	\N	1	\N	\N
2532	2195	ISC-513	\N	1	\N	\N
2533	2196	MZC-538	\N	1	\N	\N
2534	2197	MZC-544	\N	1	\N	\N
2535	2198	MFC-507	\N	1	\N	\N
2536	2198	MFC-542	\N	2	\N	\N
2537	2199	MFC-519	\N	1	\N	\N
2538	2200	MFC-561	\N	1	\N	\N
2539	2201	S089-41-990	\N	1	\N	\N
2540	2202	ME-165130	\N	1	\N	\N
2541	2203	ME-334520	\N	1	\N	\N
2542	2204	ME-607345	\N	1	\N	\N
2543	2205	ME-621635	\N	1	\N	\N
2544	2208	PINK	\N	1	\N	\N
2545	2209	GREEN	\N	1	\N	\N
2546	2210	SAE 140	\N	1	\N	\N
2547	2211	SAE 90	\N	1	\N	\N
2548	2212	MP3	\N	1	\N	\N
2549	2213	15W40	\N	1	\N	\N
2550	2214	12363-0M011	\N	1	\N	\N
2551	2215	MK-332290	\N	1	\N	\N
2552	2216	ME-018782	\N	1	\N	\N
2553	2217	8-94434-208-1	\N	1	\N	\N
2554	2218	8-94368-598-0	\N	1	\N	\N
2555	2219	8-94368-599-0	\N	1	\N	\N
2556	2220	8-97106-759-1	\N	1	\N	\N
2557	2221	8-97106-758-1	\N	1	\N	\N
2558	2222	MB-327653	\N	1	\N	\N
2559	2223	11925-1	\N	1	\N	\N
2560	2223	11925-VC80A	\N	2	\N	\N
2561	2224	DB-1191GCT	\N	1	\N	\N
2562	2225	DB-2261GCT	\N	1	\N	\N
2563	2226	DB-1460GCT	\N	1	\N	\N
2564	2227	DB-1741GCT	\N	1	\N	\N
2565	2228	DB-1774GCT	\N	1	\N	\N
2566	2229	DB-1912GCT	\N	1	\N	\N
2567	2230	DB-2396GCT	\N	1	\N	\N
2568	2231	DB-1916GCT	\N	1	\N	\N
2569	2232	DB-2034GCT	\N	1	\N	\N
2570	2233	DB-2035GCT	\N	1	\N	\N
2571	2234	DB-2249GCT	\N	1	\N	\N
2572	2235	BR-2714	\N	1	\N	\N
2573	2236	29257	\N	1	\N	\N
2574	2236	BR-9251	\N	2	\N	\N
2575	2237	RHG-97532	\N	1	\N	\N
2576	2238	MD-050471	\N	1	\N	\N
2577	2239	MD-165631	\N	1	\N	\N
2578	2240	ME-015750	\N	1	\N	\N
2579	2241	8-97140-854-0	\N	1	\N	\N
2580	2242	90080-91206	\N	1	\N	\N
2581	2243	23151	\N	1	\N	\N
2582	2244	90369-T0003	\N	1	\N	\N
2583	2245	90366-T0060	\N	1	\N	\N
2584	2245	90366-T0061	\N	2	\N	\N
2585	2246	04465-OK340	\N	1	\N	\N
2586	2247	LOW	\N	1	\N	\N
2587	2247	UC2R-34-550	\N	2	\N	\N
2588	2248	UC2T-34-540	\N	1	\N	\N
2589	2248	UPPER	\N	2	\N	\N
2590	2249	90916-T2033	\N	1	\N	\N
2591	2250	WE01-12-700	\N	1	\N	\N
2592	2251	2301A117	\N	1	\N	\N
2593	2252	2304A041	\N	1	\N	\N
2594	2253	13565-39016	\N	1	\N	\N
2595	2254	2317A007	\N	1	\N	\N
2596	2255	31230-60221	\N	1	\N	\N
2597	2256	90919-02240	\N	1	\N	\N
2598	2257	04495-OK120	\N	1	\N	\N
2599	2258	27415-01050	\N	1	\N	\N
2600	2259	04465-0K360	\N	1	\N	\N
2601	2260	AB39-7A543AD	\N	1	\N	\N
2602	2261	44118-84330	\N	1	\N	\N
2603	2262	53401-63B00	\N	1	\N	\N
2604	2263	13840-78100	\N	1	\N	\N
2605	2264	41101-77A00	\N	1	\N	\N
2606	2265	51100-85850	\N	1	\N	\N
2607	2266	45302-68H02	\N	1	\N	\N
2608	2267	20-77A00	\N	1	\N	\N
2609	2267	48810	\N	2	\N	\N
2610	2268	31172-79010	\N	1	\N	\N
2611	2269	31152-79010	\N	1	\N	\N
2612	2270	31152-79020	\N	1	\N	\N
2613	2271	12761-73G01	\N	1	\N	\N
2614	2272	FRT-1T	\N	1	\N	\N
2615	2273	FRT-2T	\N	1	\N	\N
2616	2274	195130-7820	\N	1	\N	\N
2617	2277	MC-828264	\N	1	\N	\N
2618	2278	33700-79700	\N	1	\N	\N
2619	2279	33700-83700	\N	1	\N	\N
2620	2280	DN-0102	\N	1	\N	\N
2621	2281	ME-060129	\N	1	\N	\N
2622	2282	6006NXC3	\N	1	\N	\N
2623	2283	DN-0304	\N	1	\N	\N
2624	2284	20-79000	\N	1	\N	\N
2625	2284	48810	\N	2	\N	\N
2626	2285	C-506	\N	1	\N	\N
2627	2286	C-313	\N	1	\N	\N
2628	2287	C-406	\N	1	\N	\N
2629	2288	C-519	\N	1	\N	\N
2630	2289	FC-321	\N	1	\N	\N
2631	2290	FC-208A	\N	1	\N	\N
2632	2291	FC-017	\N	1	\N	\N
2633	2292	FC-322	\N	1	\N	\N
2634	2293	YSPIS-488-B	\N	1	\N	\N
2635	2293	YSPIS-4JJ-1	\N	2	\N	\N
2636	2294	YSPIS-4JJ-2	\N	1	\N	\N
2637	2295	R-ARM-0S-MZ-01	\N	1	\N	\N
2638	2296	YHG-D16Y5-G	\N	1	\N	\N
2639	2297	RVC-16006	\N	1	\N	\N
2640	2298	0SE46-34-20	\N	1	\N	\N
2641	2299	48510	\N	1	\N	\N
2642	2299	48548	\N	2	\N	\N
2643	2300	UB39-39-340	\N	1	\N	\N
2644	2301	6003ZZCM	\N	1	\N	\N
2645	2302	6201ZZCM	\N	1	\N	\N
2646	2303	6202ZZCM	\N	1	\N	\N
2647	2304	14138A	\N	1	\N	\N
2648	2304	276	\N	2	\N	\N
2649	2305	43310-09015	\N	1	\N	\N
2650	2305	SB-3881	\N	2	\N	\N
2651	2306	43330-09295	\N	1	\N	\N
2652	2306	SB-3882	\N	2	\N	\N
2653	2307	8-94452-102-1	\N	1	\N	\N
2654	2307	SB-5302	\N	2	\N	\N
2655	2308	8-97142-452-1	\N	1	\N	\N
2656	2308	SB-5392	\N	2	\N	\N
2657	2309	8-97107-328-0	\N	1	\N	\N
2658	2309	SB-5321	\N	2	\N	\N
2659	2310	8AS1-32-240A	\N	1	\N	\N
2660	2310	SE-1461	\N	2	\N	\N
2661	2311	MB-527650	\N	1	\N	\N
2662	2311	SE-7311	\N	2	\N	\N
2663	2312	63042RSCM	\N	1	\N	\N
2664	2313	MB-025153	\N	1	\N	\N
2665	2314	5-51351-007-0	\N	1	\N	\N
2666	2315	55046-01G00	\N	1	\N	\N
2667	2316	8-94118-588-1	\N	1	\N	\N
2668	2317	48564-0K080	\N	1	\N	\N
2669	2318	0646964-0010	\N	1	\N	\N
2670	2319	KYJGGDJ08E	\N	1	\N	\N
2671	2320	KYJGGDJ08E	\N	1	\N	\N
2672	2321	KYJGGD-J08E	\N	1	\N	\N
2673	2322	KYJGGD-J08E	\N	1	\N	\N
2674	2323	KYJGGD-J08E	\N	1	\N	\N
2675	2324	R4650A 0.25	\N	1	\N	\N
2676	2325	R4650A STD	\N	1	\N	\N
2677	2326	R6032K 0.25	\N	1	\N	\N
2678	2327	R6032K STD	\N	1	\N	\N
2679	2328	R6036K STD	\N	1	\N	\N
2680	2329	GC-31010R	\N	1	\N	\N
2681	2330	GWIS-35A	\N	1	\N	\N
2682	2331	GWIS-42A	\N	1	\N	\N
2683	2332	GWM-52A	\N	1	\N	\N
2684	2333	KT-F030	\N	1	\N	\N
2685	2334	GUIS-52	\N	1	\N	\N
2686	2335	GUM-88	\N	1	\N	\N
2687	2336	GUMZ-12	\N	1	\N	\N
2688	2337	GUK-31	\N	1	\N	\N
2689	2337	GUL-18	\N	2	\N	\N
2690	2337	GUMZ-3	\N	3	\N	\N
2691	2338	GUMZ-6	\N	1	\N	\N
2692	2339	GUMZ-9	\N	1	\N	\N
2693	2340	GUN-27	\N	1	\N	\N
2694	2341	GUN-30	\N	1	\N	\N
2695	2342	C434L2 STD	\N	1	\N	\N
2696	2342	C434WI	\N	2	\N	\N
2697	2343	C528L2	\N	1	\N	\N
2698	2343	C528W1 STD	\N	2	\N	\N
2699	2344	R4036K 0.25	\N	1	\N	\N
2700	2345	R4036K STD	\N	1	\N	\N
2701	2346	M4029K 0.25	\N	1	\N	\N
2702	2347	M4029K STD	\N	1	\N	\N
2703	2348	M4027K STD	\N	1	\N	\N
2704	2349	M4631K STD	\N	1	\N	\N
2705	2350	M4651A 0.25	\N	1	\N	\N
2706	2351	M6320K STD	\N	1	\N	\N
2707	2352	GWIS-25A	\N	1	\N	\N
2708	2353	GWIS-43A	\N	1	\N	\N
2709	2354	GWK-18A	\N	1	\N	\N
2710	2355	GWS-26A	\N	1	\N	\N
2711	2356	GWT-101A	\N	1	\N	\N
2712	2357	GWT-116A	\N	1	\N	\N
2713	2358	GWT-150A	\N	1	\N	\N
2714	2359	GWT-93A	\N	1	\N	\N
2715	2360	32607 0.25	\N	1	\N	\N
2716	2361	32607 STD	\N	1	\N	\N
2717	2362	33760 0.25	\N	1	\N	\N
2718	2363	33760 STD	\N	1	\N	\N
2719	2364	33861 0.25	\N	1	\N	\N
2720	2365	33861 STD	\N	1	\N	\N
2721	2366	33862 0.25	\N	1	\N	\N
2722	2367	33862 STD	\N	1	\N	\N
2723	2368	43010 0.25	\N	1	\N	\N
2724	2369	43010 STD	\N	1	\N	\N
2725	2370	43014 STD	\N	1	\N	\N
2726	2371	R4545K 0.25	\N	1	\N	\N
2727	2372	R6036K 0.25	\N	1	\N	\N
2728	2373	R6321K 0.50	\N	1	\N	\N
2729	2374	R7800K 0.25	\N	1	\N	\N
2730	2375	R7800K STD	\N	1	\N	\N
2731	2376	90919-02240	\N	1	\N	\N
2732	2376	JPC-1036	\N	2	\N	\N
2733	2377	GUIS-75	\N	1	\N	\N
2734	2378	GUN-50	\N	1	\N	\N
2735	2379	GC-31010R	\N	1	\N	\N
2736	2380	C6032W	\N	1	\N	\N
2737	2381	C6315L STD	\N	1	\N	\N
2738	2382	M4027K 0.25	\N	1	\N	\N
2739	2383	M4631K 0.25	\N	1	\N	\N
2740	2384	M6035K 0.25	\N	1	\N	\N
2741	2385	M6035K STD	\N	1	\N	\N
2742	2386	M6320K 0.25	\N	1	\N	\N
2743	2387	M7278A 0.25	\N	1	\N	\N
2744	2388	M7800K 0.25	\N	1	\N	\N
2745	2389	M7800K STD	\N	1	\N	\N
2746	2390	A-8184K	\N	1	\N	\N
2747	2391	A-312K	\N	1	\N	\N
2748	2392	A-6008K	\N	1	\N	\N
2749	2393	A-665K	\N	1	\N	\N
2750	2394	A-1328K	\N	1	\N	\N
2751	2395	A-8123K	\N	1	\N	\N
2752	2396	A-212K	\N	1	\N	\N
2753	2397	MC-815402	\N	1	\N	\N
2754	2398	9323-3633	\N	1	\N	\N
2755	2399	9323-35L1	\N	1	\N	\N
2756	2400	L221-1517 RH	\N	1	\N	\N
2757	2401	L221-1517 LH	\N	1	\N	\N
2758	2402	CLK-BONGO98 RH	\N	1	\N	\N
2759	2403	REVOLVMDA	\N	1	\N	\N
2760	2404	DJ0199W-24V	\N	1	\N	\N
2761	2405	NV17328	\N	1	\N	\N
2762	2406	NV17340	\N	1	\N	\N
2763	2407	8181-12V	\N	1	\N	\N
2764	2408	YT-IS-3001RH	\N	1	\N	\N
2765	2409	M0364	\N	1	\N	\N
2766	2410	HLK-BONGO98 LH	\N	1	\N	\N
2767	2411	L221-1943 RH	\N	1	\N	\N
2768	2412	L221-1943 LH	\N	1	\N	\N
2769	2413	A2-4538	\N	1	\N	\N
2770	2413	M3037 RH	\N	2	\N	\N
2771	2414	A2-4538	\N	1	\N	\N
2772	2414	M3037LH	\N	2	\N	\N
2773	2415	M2094 RH	\N	1	\N	\N
2774	2416	M2094 LH	\N	1	\N	\N
2775	2417	GL-01-001	\N	1	\N	\N
2776	2417	M2091 RH	\N	2	\N	\N
2777	2418	GL-01-001	\N	1	\N	\N
2778	2418	M2091LH	\N	2	\N	\N
2779	2419	TLK-KC2700 RH	\N	1	\N	\N
2780	2420	TLK-KC2700 LH	\N	1	\N	\N
2781	2421	NV-TL-218-1903LH	\N	1	\N	\N
2782	2422	NV-TL-218-1903RH	\N	1	\N	\N
2783	2423	218-1509-Y LH	\N	1	\N	\N
2784	2424	218-1509-Y RH	\N	1	\N	\N
2785	2492	6MM	\N	1	\N	\N
2786	2493	8MM	\N	1	\N	\N
2787	2494	10MM	\N	1	\N	\N
2788	2495	12MM	\N	1	\N	\N
2789	2496	14MM	\N	1	\N	\N
2790	2497	16MM	\N	1	\N	\N
2791	2498	18MM	\N	1	\N	\N
2792	2499	1	\N	1	\N	\N
2793	2500	8MM	\N	1	\N	\N
2794	2501	10MM	\N	1	\N	\N
2795	2502	12MM	\N	1	\N	\N
2796	2503	14MM	\N	1	\N	\N
2797	2504	16MM	\N	1	\N	\N
2798	2505	18MM	\N	1	\N	\N
2799	2506	6MM	\N	1	\N	\N
2800	2507	8MM	\N	1	\N	\N
2801	2508	10MM	\N	1	\N	\N
2802	2509	12MM	\N	1	\N	\N
2803	2510	14MM	\N	1	\N	\N
2804	2511	16MM	\N	1	\N	\N
2805	2523	KP-222	\N	1	\N	\N
2806	2524	KP-522	\N	1	\N	\N
2807	2525	KP-524	\N	1	\N	\N
2808	2526	KP-530	\N	1	\N	\N
2809	2527	KP-529	\N	1	\N	\N
2810	2528	MK309711	\N	1	\N	\N
2811	2528	MK309712	\N	2	\N	\N
2812	2528	TR285	\N	3	\N	\N
2813	2529	TR286	\N	1	\N	\N
2814	2530	8-98017027-1	\N	1	\N	\N
2815	2531	13568-69085	\N	1	\N	\N
2816	2532	12761-86000	\N	1	\N	\N
2817	2550	TR191604	\N	1	\N	\N
2818	2551	45200-86025	\N	1	\N	\N
2819	2552	CS-015	\N	1	\N	\N
2820	2553	092130-0050	\N	1	\N	\N
2821	2554	24V	\N	1	\N	\N
2822	2554	AV-8000	\N	2	\N	\N
2823	2554	RED	\N	3	\N	\N
2824	2555	24V	\N	1	\N	\N
2825	2555	AV-8001	\N	2	\N	\N
2826	2555	GREEN	\N	3	\N	\N
2827	2556	24V	\N	1	\N	\N
2828	2556	AV-8001	\N	2	\N	\N
2829	2556	BLUE	\N	3	\N	\N
2830	2557	45200-86024	\N	1	\N	\N
2831	2557	RH	\N	2	\N	\N
2832	2558	VA-133K	\N	1	\N	\N
2833	2559	VA-8289K	\N	1	\N	\N
2834	2560	A33	\N	1	\N	\N
2835	2560	RPF-3340	\N	2	\N	\N
2836	2561	A52	\N	1	\N	\N
2837	2561	RPF-3530	\N	2	\N	\N
2838	2562	B38	\N	1	\N	\N
2839	2562	RPF-5400	\N	2	\N	\N
2840	2563	B-39	\N	1	\N	\N
2841	2563	RPF-5410	\N	2	\N	\N
2842	2564	B-42	\N	1	\N	\N
2843	2564	RPF-5440	\N	2	\N	\N
2844	2565	RTG-22	\N	1	\N	\N
2845	2566	8-97039-704-0	\N	1	\N	\N
2846	2566	RCO-101S	\N	2	\N	\N
2847	2567	8-97100-075-1	\N	1	\N	\N
2848	2567	REM-141S	\N	2	\N	\N
2849	2568	8-94447-208-0	\N	1	\N	\N
2850	2568	RCM-21S	\N	2	\N	\N
2851	2569	8-97078-616-0	\N	1	\N	\N
2852	2569	RWC-361S	\N	2	\N	\N
2853	2570	RWC-24M	\N	1	\N	\N
2854	2571	RWC-25M	\N	1	\N	\N
2855	2572	RWC-26M	\N	1	\N	\N
2856	2573	1-47600-957-0	\N	1	\N	\N
2857	2574	1-47600-959-0	\N	1	\N	\N
2858	2575	9365-0042	\N	1	\N	\N
2859	2576	RPF-2435	\N	1	\N	\N
2860	2577	RPF-2430	\N	1	\N	\N
2861	2578	RPF-2470	\N	1	\N	\N
2862	2579	RPF-2460	\N	1	\N	\N
2863	2580	4PK-835	\N	1	\N	\N
2864	2581	4PK-920	\N	1	\N	\N
2865	2582	4PK-1060	\N	1	\N	\N
2866	2583	4PK-820	\N	1	\N	\N
2867	2584	5PK-935	\N	1	\N	\N
2868	2585	5PK-1210	\N	1	\N	\N
2869	2586	6PK-2285	\N	1	\N	\N
2870	2587	6PK-1495	\N	1	\N	\N
2871	2588	7PK-1700	\N	1	\N	\N
2872	2589	7PK-1070	\N	1	\N	\N
2873	2590	9-53215-611-2 RH	\N	1	\N	\N
2874	2591	9-53125-612-2 LH	\N	1	\N	\N
2875	2592	MN-122542	\N	1	\N	\N
2876	2593	DB-1916GCT	\N	1	\N	\N
2877	2593	PRD-33508	\N	2	\N	\N
2878	2594	MB-238495	\N	1	\N	\N
2879	2594	PRD-35052	\N	2	\N	\N
2880	2595	BS-5138	\N	1	\N	\N
2881	2596	DB-2316GCT	\N	1	\N	\N
2882	2597	DB-1161GCT	\N	1	\N	\N
2883	2598	DB-2334GCT	\N	1	\N	\N
2884	2599	DB-2532GCT	\N	1	\N	\N
2885	2600	DB-2589GCT	\N	1	\N	\N
2886	2601	DB-2503GCT	\N	1	\N	\N
2887	2602	VK-349	\N	1	\N	\N
2888	2603	VA-124K	\N	1	\N	\N
2889	2604	VA-248K	\N	1	\N	\N
2890	2605	VAX-127K	\N	1	\N	\N
2891	2606	VAX-8331K	\N	1	\N	\N
2892	2607	B60	\N	1	\N	\N
2893	2607	RPF-5620	\N	2	\N	\N
2894	2608	B65	\N	1	\N	\N
2895	2608	RPF-5670	\N	2	\N	\N
2896	2609	C53	\N	1	\N	\N
2897	2609	RPF-7550	\N	2	\N	\N
2898	2610	C54	\N	1	\N	\N
2899	2610	RPF-7560	\N	2	\N	\N
2900	2611	C61	\N	1	\N	\N
2901	2611	RPF-7630	\N	2	\N	\N
2902	2612	C62	\N	1	\N	\N
2903	2612	RPF-7640	\N	2	\N	\N
2904	2613	C63	\N	1	\N	\N
2905	2613	RPF-7650	\N	2	\N	\N
2906	2614	RPF-2300	\N	1	\N	\N
2907	2615	UC3C-34-470A	\N	1	\N	\N
2908	2616	56261-7S010	\N	1	\N	\N
2909	2616	NV350	\N	2	\N	\N
2910	2617	56261-7S000	\N	1	\N	\N
2911	2617	NV350	\N	2	\N	\N
2912	2618	MB-267876	\N	1	\N	\N
2913	2619	MB-267877	\N	1	\N	\N
2914	2620	MR-992310	\N	1	\N	\N
2915	2621	MR-992309	\N	1	\N	\N
2916	2622	UC7C-34-150	\N	1	\N	\N
2917	2623	UC7C-34-170	\N	1	\N	\N
2918	2624	8-97235-786-0	\N	1	\N	\N
2919	2625	8-97235-787-0	\N	1	\N	\N
2920	2626	42420-77M00	\N	1	\N	\N
2921	2627	54830-48A00	\N	1	\N	\N
2922	2628	48820-0K030	\N	1	\N	\N
2923	2629	48810-0K010	\N	1	\N	\N
2924	2630	11710-54100	\N	1	\N	\N
2925	2631	PRD-35104	\N	1	\N	\N
2926	2632	PRD-26162	\N	1	\N	\N
2927	2633	PRD-26161	\N	1	\N	\N
2928	2634	PRD-26051	\N	1	\N	\N
2929	2635	PRD-26154	\N	1	\N	\N
2930	2636	0544522-4B000	\N	1	\N	\N
2931	2637	OA-2060	\N	1	\N	\N
2932	2638	OA-2063	\N	1	\N	\N
2933	2639	MB-100	\N	1	\N	\N
2934	2639	OA-2185	\N	2	\N	\N
2935	2640	OA-2427	\N	1	\N	\N
2936	2641	OK75A-10-271	\N	1	\N	\N
2937	2641	SHG-JT-C	\N	2	\N	\N
2938	2642	RF01-23-907	\N	1	\N	\N
2939	2643	8-94374-424-0	\N	1	\N	\N
2940	2643	SB-5311	\N	2	\N	\N
2941	2644	8-94459-453-2	\N	1	\N	\N
2942	2644	SB-5141	\N	2	\N	\N
2943	2644	SB-5143	\N	3	\N	\N
2944	2645	MR-496799	\N	1	\N	\N
2945	2645	SB-7842	\N	2	\N	\N
2946	2646	MR-467992	\N	1	\N	\N
2947	2646	SB-7841	\N	2	\N	\N
2948	2647	MB-831038	\N	1	\N	\N
2949	2647	SB-7722R	\N	2	\N	\N
2950	2648	MB-831037	\N	1	\N	\N
2951	2648	SB-7722L	\N	2	\N	\N
2952	2649	40160-01G50	\N	1	\N	\N
2953	2649	SB-4672	\N	2	\N	\N
2954	2650	8AU3-34-510	\N	1	\N	\N
2955	2650	SB-1542	\N	2	\N	\N
2956	2651	8AU1-34-540	\N	1	\N	\N
2957	2651	SB-1521	\N	2	\N	\N
2958	2652	FAS-8631	\N	1	\N	\N
2959	2652	R205	\N	2	\N	\N
2960	2653	OK95A-66-830	\N	1	\N	\N
2961	2654	HN-0310	\N	1	\N	\N
2962	2655	BX-25	\N	1	\N	\N
2963	2655	PP5	\N	2	\N	\N
2964	2656	RCT3504	\N	1	\N	\N
2965	2657	33009JR	\N	1	\N	\N
2966	2658	RCT3504	\N	1	\N	\N
2967	2659	33009JR	\N	1	\N	\N
2968	2660	VS-B2500	\N	1	\N	\N
2969	2660	VS-B25WL	\N	2	\N	\N
2970	2661	VS-R2	\N	1	\N	\N
2971	2662	5-47610-074	\N	1	\N	\N
2972	2662	RWC-601S	\N	2	\N	\N
2973	2663	5-47610-075	\N	1	\N	\N
2974	2663	RWC-611S	\N	2	\N	\N
2975	2664	5-47610-076	\N	1	\N	\N
2976	2664	RWC-621S	\N	2	\N	\N
2977	2665	5-47610-078	\N	1	\N	\N
2978	2665	RWC-641S	\N	2	\N	\N
2979	2666	5-47610-079	\N	1	\N	\N
2980	2666	RWC-651S	\N	2	\N	\N
2981	2667	1-47600-33	\N	1	\N	\N
2982	2667	RWC-781S	\N	2	\N	\N
2983	2668	1-47600-337-01	\N	1	\N	\N
2984	2668	RWC-791S	\N	2	\N	\N
2985	2669	8-97078-613-01	\N	1	\N	\N
2986	2669	RWC-331S	\N	2	\N	\N
2987	2670	8-97078-614-01	\N	1	\N	\N
2988	2670	RWC-341S	\N	2	\N	\N
2989	2671	8-97078-615-01	\N	1	\N	\N
2990	2671	RWC-351S	\N	2	\N	\N
2991	2672	30620-2T021	\N	1	\N	\N
2992	2672	RCO-14N	\N	2	\N	\N
2993	2673	30620-V6321	\N	1	\N	\N
2994	2673	30620-V6370	\N	2	\N	\N
2995	2673	RCO-2N	\N	3	\N	\N
2996	2674	OK72C-11-401A	\N	1	\N	\N
2997	2674	RCP-2K	\N	2	\N	\N
2998	2675	47220-26280	\N	1	\N	\N
2999	2675	RBM-39T	\N	2	\N	\N
3000	2676	MB-555115	\N	1	\N	\N
3001	2676	RCM-8M	\N	2	\N	\N
3002	2677	58102-4AA00	\N	1	\N	\N
3003	2677	RCK-2HY	\N	2	\N	\N
3004	2678	RCK-1K	\N	1	\N	\N
3005	2678	S083-49-240	\N	2	\N	\N
3006	2679	MB-193530	\N	1	\N	\N
3007	2679	RCK-3M	\N	2	\N	\N
3008	2681	BH-0564	\N	1	\N	\N
3009	2682	BH-3425	\N	1	\N	\N
3010	2683	BH-6924	\N	1	\N	\N
3011	2684	BH-6926	\N	1	\N	\N
3012	2685	BH-7036-E	\N	1	\N	\N
3013	2686	MD-324966	\N	1	\N	\N
3014	2687	MD-324967	\N	1	\N	\N
3015	2688	T2200	\N	1	\N	\N
3016	2689	T5123	\N	1	\N	\N
3017	2690	T7319	\N	1	\N	\N
3018	2691	0-6740	\N	1	\N	\N
3019	2692	MTW-1645	\N	1	\N	\N
3020	2693	MC020573	\N	1	\N	\N
3021	2694	H3-12V	\N	1	\N	\N
3022	2695	H7-12V	\N	1	\N	\N
3023	2696	H7-24V	\N	1	\N	\N
3024	2697	EP-264	\N	1	\N	\N
3025	2698	EP-2331	\N	1	\N	\N
3026	2699	EP-839A	\N	1	\N	\N
3027	2700	EP-261	\N	1	\N	\N
3028	2701	ABI-5326	\N	1	\N	\N
3029	2702	SB-5282	\N	1	\N	\N
3030	2703	SB-5281	\N	1	\N	\N
3031	2704	48655-0K010	\N	1	\N	\N
3032	2705	KM-29W	\N	1	\N	\N
3033	2706	ME-996936	\N	1	\N	\N
3034	2707	ME-993681	\N	1	\N	\N
3035	2708	ME-092269	\N	1	\N	\N
3036	2709	32310	\N	1	\N	\N
3037	2710	8-98032-599-0	\N	1	\N	\N
3038	2711	8-97100-075-2	\N	1	\N	\N
3039	2712	8-98032-603-0	\N	1	\N	\N
3040	2713	8-97254-771-0	\N	1	\N	\N
3041	2714	ST30-48-400	\N	1	\N	\N
3042	2715	8-94336-888-1	\N	1	\N	\N
3043	2716	8-94389-195-0	\N	1	\N	\N
3044	2717	UB39-41-920	\N	1	\N	\N
3045	2718	FF-6336P	\N	1	\N	\N
3046	2719	F0-4556P	\N	1	\N	\N
3047	2720	FO-4569P	\N	1	\N	\N
3048	2721	FO-4561P	\N	1	\N	\N
3049	2722	FO-4581P	\N	1	\N	\N
3050	2723	MC889050	\N	1	\N	\N
3051	2724	MC826782	\N	1	\N	\N
3052	2725	KDX50-34-350A	\N	1	\N	\N
3053	2726	51720-4N000	\N	1	\N	\N
3054	2727	SLB-1018	\N	1	\N	\N
3055	2728	ME-011832	\N	1	\N	\N
3056	2729	S083-34-136	\N	1	\N	\N
3057	2730	8-97235-784-0	\N	1	\N	\N
3058	2731	OK60A-15-250C	\N	1	\N	\N
3059	2732	25429-4A000	\N	1	\N	\N
3060	2733	119T	\N	1	\N	\N
3061	2733	A446H32MM	\N	2	\N	\N
3062	2734	100T	\N	1	\N	\N
3063	2734	A315Y075	\N	2	\N	\N
3064	2735	164T	\N	1	\N	\N
3065	2735	A516YS25MM	\N	2	\N	\N
3066	2736	152T	\N	1	\N	\N
3067	2736	HX570RU30	\N	2	\N	\N
3068	2739	MD-000508	\N	1	\N	\N
3069	2740	MD-184303	\N	1	\N	\N
3070	2741	60082RS	\N	1	\N	\N
3071	2742	62062RS	\N	1	\N	\N
3072	2743	85213	\N	1	\N	\N
3073	2744	11.00-20	\N	1	\N	\N
3074	2745	0104-0541	\N	1	\N	\N
3075	2746	0104-0546	\N	1	\N	\N
3076	2747	0104-0547	\N	1	\N	\N
3077	2748	0111-0021	\N	1	\N	\N
3078	2749	GUH-63	\N	1	\N	\N
3079	2750	GUIS-74	\N	1	\N	\N
3080	2751	GUK-18	\N	1	\N	\N
3081	2751	GUK-31	\N	2	\N	\N
3082	2751	GUMZ-3	\N	3	\N	\N
3083	2752	GUN-52	\N	1	\N	\N
3084	2753	AH-22A	\N	1	\N	\N
3085	2754	AM-32A	\N	1	\N	\N
3086	2755	GI-59	\N	1	\N	\N
3087	2756	GZ-33	\N	1	\N	\N
3088	2757	SH-29	\N	1	\N	\N
3089	2758	SH-31N	\N	1	\N	\N
3090	2759	SM-44	\N	1	\N	\N
3091	2760	SM-48	\N	1	\N	\N
3092	2761	SM-53	\N	1	\N	\N
3093	2762	2-Jan	\N	1	\N	\N
3094	2763	2	\N	1	\N	\N
3095	2764	1	\N	1	\N	\N
3096	2765	4-Mar	\N	1	\N	\N
3097	2766	8-Jul	\N	1	\N	\N
3098	2767	1	\N	1	\N	\N
3099	2767	2	\N	2	\N	\N
3100	2767	2002 0:00	\N	3	\N	\N
3101	2768	8-May	\N	1	\N	\N
3102	2769	12X45 RH	\N	1	\N	\N
3103	2769	B12	\N	2	\N	\N
3104	2770	0104-0546	\N	1	\N	\N
3105	2771	GUS-1	\N	1	\N	\N
3106	2772	32310J	\N	1	\N	\N
3107	2773	32311J	\N	1	\N	\N
3108	2774	NUP311NR	\N	1	\N	\N
3109	2775	32642 STD	\N	1	\N	\N
3110	2776	33915 STD	\N	1	\N	\N
3111	2777	33457 STD	\N	1	\N	\N
3112	2778	15910-88701	\N	1	\N	\N
3113	2779	FC-5380	\N	1	\N	\N
3114	2780	FN-1110X3	\N	1	\N	\N
3115	2781	FN-1110X4	\N	1	\N	\N
3116	2782	FN-1110X6	\N	1	\N	\N
3117	2783	FN-1110X8	\N	1	\N	\N
3118	2784	SAL-1215L	\N	1	\N	\N
3119	2785	SAL-1223L	\N	1	\N	\N
3120	2786	ISD-017	\N	1	\N	\N
3121	2787	MZD-0050	\N	1	\N	\N
3122	2788	24TK308B2U8	\N	1	\N	\N
3123	2792	MB181389	\N	1	\N	\N
3124	2793	6014	\N	1	\N	\N
3125	2794	ISD-058	\N	1	\N	\N
3126	2794	MCD-110B	\N	2	\N	\N
3127	2795	ISD-032	\N	1	\N	\N
3128	2795	MCD-116B	\N	2	\N	\N
3129	2796	MCD-NIB	\N	1	\N	\N
3130	2796	MFD-019U	\N	2	\N	\N
3131	2797	MCD-202	\N	1	\N	\N
3132	2797	MFD-015U	\N	2	\N	\N
3133	2798	MCD-203	\N	1	\N	\N
3134	2798	MFD-005	\N	2	\N	\N
3135	2799	MCD-205	\N	1	\N	\N
3136	2799	MFD-037U	\N	2	\N	\N
3137	2800	MCD-207A	\N	1	\N	\N
3138	2800	MFD-061	\N	2	\N	\N
3139	2801	MCD-207B	\N	1	\N	\N
3140	2801	MFD-062	\N	2	\N	\N
3141	2802	ISC-592	\N	1	\N	\N
3142	2802	MCC-110	\N	2	\N	\N
3143	2803	MCC-212	\N	1	\N	\N
3144	2803	MFC-532	\N	2	\N	\N
3145	2804	MCC-207	\N	1	\N	\N
3146	2804	MFC-536	\N	2	\N	\N
3147	2805	MCC-203	\N	1	\N	\N
3148	2805	MFC-507	\N	2	\N	\N
3149	2806	22403000	\N	1	\N	\N
3150	2807	856-03701 NEW	\N	1	\N	\N
3151	2808	ISD-141U	\N	1	\N	\N
3152	2808	MCD-1A	\N	2	\N	\N
3153	2809	ISD-014	\N	1	\N	\N
3154	2809	MCD-106	\N	2	\N	\N
3155	2810	ISD-114	\N	1	\N	\N
3156	2810	MCD-107	\N	2	\N	\N
3157	2811	ISD-086	\N	1	\N	\N
3158	2811	MCD-107N	\N	2	\N	\N
3159	2812	ISD-015	\N	1	\N	\N
3160	2812	MCD-108	\N	2	\N	\N
3161	2813	ISD-055U	\N	1	\N	\N
3162	2813	MCD-109	\N	2	\N	\N
3163	2814	9324-0104	\N	1	\N	\N
3164	2815	9324-0151	\N	1	\N	\N
3165	2816	9324-0159	\N	1	\N	\N
3166	2817	9324-0168	\N	1	\N	\N
3167	2818	9324-2046	\N	1	\N	\N
3168	2819	9324-2059	\N	1	\N	\N
3169	2820	9364-0452	\N	1	\N	\N
3170	2821	9364-0605	\N	1	\N	\N
3171	2822	9364-0603	\N	1	\N	\N
3172	2823	9364-0613	\N	1	\N	\N
3173	2824	9364-0614	\N	1	\N	\N
3174	2825	6307ZNR	\N	1	\N	\N
3175	2826	30306D	\N	1	\N	\N
3176	2827	33113	\N	1	\N	\N
3177	2828	55KW02	\N	1	\N	\N
3178	2828	TR11104	\N	2	\N	\N
3179	2829	913849	\N	1	\N	\N
3180	2830	303120	\N	1	\N	\N
3181	2836	ISD-185U	\N	1	\N	\N
3182	2837	MF	\N	1	\N	\N
3183	2837	N70L	\N	2	\N	\N
3184	2838	LM	\N	1	\N	\N
3185	2838	N50L	\N	2	\N	\N
3186	2839	LM	\N	1	\N	\N
3187	2839	N150L	\N	2	\N	\N
3188	2840	45201-68H02	\N	1	\N	\N
3189	2841	45201-68H03	\N	1	\N	\N
3190	2842	NLGI-3	\N	1	\N	\N
3191	2843	RB-108	\N	1	\N	\N
3192	2844	20W50	\N	1	\N	\N
3193	2845	1-11141262-0 NEW	\N	1	\N	\N
3194	2846	SC-80209	\N	1	\N	\N
3195	2847	SC-80206	\N	1	\N	\N
3196	2850	F6A	\N	1	\N	\N
3197	2851	GT-20120 R2	\N	1	\N	\N
3198	2852	CFTC-100	\N	1	\N	\N
3199	2853	C-516	\N	1	\N	\N
3200	2853	C-525	\N	2	\N	\N
3201	2854	100W	\N	1	\N	\N
3202	2854	8GH 002 090-453	\N	2	\N	\N
3203	2854	H3 24V	\N	3	\N	\N
3204	2855	C-563	\N	1	\N	\N
3205	2856	RHG-60576	\N	1	\N	\N
3206	2857	1-53215-061	\N	1	\N	\N
3207	2859	4D32	\N	1	\N	\N
3208	2859	MC830615	\N	2	\N	\N
3209	2860	6D14	\N	1	\N	\N
3210	2860	6D15	\N	2	\N	\N
3211	2860	ME-031964	\N	3	\N	\N
3212	2861	OK65A-10-155	\N	1	\N	\N
3213	2862	41602-70D10	\N	1	\N	\N
3214	2863	41601-70D10	\N	1	\N	\N
3215	2864	DAC3562W	\N	1	\N	\N
3216	2865	GWM-43AN	\N	1	\N	\N
3217	2866	RCT3200SA1	\N	1	\N	\N
3218	2867	GUIS-69	\N	1	\N	\N
3219	2868	A-365	\N	1	\N	\N
3220	2869	F-193	\N	1	\N	\N
3221	2870	R6029K STD	\N	1	\N	\N
3222	2871	R6029K 0.25	\N	1	\N	\N
3223	2872	R6029K 0.50	\N	1	\N	\N
3224	2873	R9375A STD	\N	1	\N	\N
3225	2874	M3915A 0.25	\N	1	\N	\N
3226	2875	M9575A STD	\N	1	\N	\N
3227	2876	M9375A 0.25	\N	1	\N	\N
3228	2877	M9375A 0.50	\N	1	\N	\N
3229	2878	M658A STD	\N	1	\N	\N
3230	2879	M658A 0.25	\N	1	\N	\N
3231	2880	M658A 0.50	\N	1	\N	\N
3232	2881	M658A 0.75	\N	1	\N	\N
3233	2882	M6029K STD	\N	1	\N	\N
3234	2883	M6029K 0.25	\N	1	\N	\N
3235	2884	M6029K 0.50	\N	1	\N	\N
3236	2885	R658A STD	\N	1	\N	\N
3237	2886	R658A 0.25	\N	1	\N	\N
3238	2887	YOP-R2	\N	1	\N	\N
3239	2888	YVC-J2-2	\N	1	\N	\N
3240	2889	YCRB-MT-01	\N	1	\N	\N
3241	2890	D-407	\N	1	\N	\N
3242	2891	C-231	\N	1	\N	\N
3243	2892	C-529	\N	1	\N	\N
3244	2893	F-193	\N	1	\N	\N
3245	2894	63INCHES	\N	1	\N	\N
3246	2894	FRT-1T	\N	2	\N	\N
3247	2895	FRT-1T	\N	1	\N	\N
3248	2896	FRT-2T	\N	1	\N	\N
3249	2897	RR-1T	\N	1	\N	\N
3250	2898	RR-2T	\N	1	\N	\N
3251	2899	RR-3T	\N	1	\N	\N
3252	2900	MFD-037Y	\N	1	\N	\N
3253	2901	80G	\N	1	\N	\N
3254	2901	PRIME GREY LIQUID	\N	2	\N	\N
3255	2902	25G	\N	1	\N	\N
3256	2902	PRIME GREY LIQUID	\N	2	\N	\N
3257	2903	CDX-019A	\N	1	\N	\N
3258	2904	CTX-064A	\N	1	\N	\N
3259	2905	CTX-161A	\N	1	\N	\N
3260	2906	G5-213X	\N	1	\N	\N
3261	2907	GU-1640	\N	1	\N	\N
3262	2908	GUIS-60	\N	1	\N	\N
3263	2909	FC-208	\N	1	\N	\N
3264	2910	8-Jul	\N	1	\N	\N
3265	2910	ME-602994	\N	2	\N	\N
3266	2910	RC0-5M	\N	3	\N	\N
3267	2911	242135525	\N	1	\N	\N
3268	2911	YR7D130	\N	2	\N	\N
3269	2912	0986AH0712	\N	1	\N	\N
3270	2913	OK60A-41-660D	\N	1	\N	\N
3271	2914	40110-EA000	\N	1	\N	\N
3272	2914	SB-4981	\N	2	\N	\N
3273	2915	8-94459-464-2	\N	1	\N	\N
3274	2915	SB-5282	\N	2	\N	\N
3275	2916	40160-EB70A	\N	1	\N	\N
3276	2916	SB-N252	\N	2	\N	\N
3277	2917	8-94366-606-0	\N	1	\N	\N
3278	2917	SR-5290	\N	2	\N	\N
3279	2918	8-97304-851-0	\N	1	\N	\N
3280	2918	SR-5360	\N	2	\N	\N
3281	2919	8-98056-550-0	\N	1	\N	\N
3282	2919	SR-5380	\N	2	\N	\N
3283	2920	54560-EB70A	\N	1	\N	\N
3284	2921	48655-BZ060	\N	1	\N	\N
3285	2922	40160-VW000	\N	1	\N	\N
3286	2922	SB-4972	\N	2	\N	\N
3287	2923	S47S-32-250	\N	1	\N	\N
3288	2923	SR-1670R	\N	2	\N	\N
3289	2924	S47S-32-240	\N	1	\N	\N
3290	2924	SR-1670L	\N	2	\N	\N
3291	2925	D8521-EB70A	\N	1	\N	\N
3292	2925	SR-N250	\N	2	\N	\N
3293	2926	D8520-EB70A	\N	1	\N	\N
3294	2926	D8640-EB70A	\N	2	\N	\N
3295	2926	SE-L	\N	3	\N	\N
3296	2926	SE-N251R	\N	4	\N	\N
3297	2927	SE-A121	\N	1	\N	\N
3298	2928	56261-7S000	\N	1	\N	\N
3299	2928	SL-N130L	\N	2	\N	\N
3300	2929	56261-7S010	\N	1	\N	\N
3301	2929	SL-N130R	\N	2	\N	\N
3302	2930	8-97944-569-0	\N	1	\N	\N
3303	2930	SL-5400L	\N	2	\N	\N
3304	2931	8-9744-568-0	\N	1	\N	\N
3305	2931	SL-5400R	\N	2	\N	\N
3306	2932	45046-09281	\N	1	\N	\N
3307	2932	SE-3891	\N	2	\N	\N
3308	2933	8-94459-480	\N	1	\N	\N
3309	2933	8-94459-481	\N	2	\N	\N
3310	2933	SI-5281R	\N	3	\N	\N
3311	2933	SI-L	\N	4	\N	\N
3312	2934	MC-081152	\N	1	\N	\N
3313	2934	SR-7920	\N	2	\N	\N
3314	2935	VAX-8157K	\N	1	\N	\N
3315	2936	VAX-8184K	\N	1	\N	\N
3316	2937	VAX-8634	\N	1	\N	\N
3317	2938	VAX-8845K	\N	1	\N	\N
3318	2939	VAX-8290K	\N	1	\N	\N
3319	2940	VAX-4054K	\N	1	\N	\N
3320	2941	VK-3388K	\N	1	\N	\N
3321	2942	VK-9919	\N	1	\N	\N
3322	2943	12221-88706	\N	1	\N	\N
3323	2944	220900	\N	1	\N	\N
3324	2944	MB-552233	\N	2	\N	\N
3325	2945	ML-6001	\N	1	\N	\N
3326	2945	RH N-1001	\N	2	\N	\N
3327	2946	ML-1001	\N	1	\N	\N
3328	2946	RH TO-1001	\N	2	\N	\N
3329	2947	23-710-8523388	\N	1	\N	\N
3330	2948	IGB-29449	\N	1	\N	\N
3331	2949	RHG-88708	\N	1	\N	\N
3332	2950	20W-40 1 L	\N	1	\N	\N
3333	2951	DOT3	\N	1	\N	\N
3334	2952	MARHAK	\N	1	\N	\N
3335	2953	MARHAK	\N	1	\N	\N
3336	2954	2KL	\N	1	\N	\N
3337	2955	20W-40 HAVOLINE	\N	1	\N	\N
3338	2956	C-407	\N	1	\N	\N
3339	2957	C-015	\N	1	\N	\N
3340	2958	SAE 140	\N	1	\N	\N
3341	2959	SAE 90	\N	1	\N	\N
3342	2960	OA-2185	\N	1	\N	\N
3343	2961	MFD-009	\N	1	\N	\N
3344	2962	MFD-037Y	\N	1	\N	\N
3345	2963	ISD-017	\N	1	\N	\N
3346	2964	MBD-004	\N	1	\N	\N
3347	2964	MBD-022UD	\N	2	\N	\N
3348	2965	BR-2714	\N	1	\N	\N
3349	2966	BR-2732	\N	1	\N	\N
3350	2967	BR-033	\N	1	\N	\N
3351	2968	BR-2700	\N	1	\N	\N
3352	2969	MFC-519	\N	1	\N	\N
3353	2970	ISC-509	\N	1	\N	\N
3354	2971	MC-889050	\N	1	\N	\N
3355	2972	ISC-592	\N	1	\N	\N
3356	2973	MFC-532	\N	1	\N	\N
3357	2974	MFC-507	\N	1	\N	\N
3358	2975	ISC-572	\N	1	\N	\N
3359	2976	CTX-161A	\N	1	\N	\N
3360	2977	220900P	\N	1	\N	\N
3361	2978	MBI-165	\N	1	\N	\N
3362	2979	26300-42040	\N	1	\N	\N
3363	2980	S093-41-9203	\N	1	\N	\N
3364	2981	OK60A-43-400	\N	1	\N	\N
3365	2982	OK60A-43-400	\N	1	\N	\N
3366	2983	PRD-33508	\N	1	\N	\N
3367	2984	PRD-35078	\N	1	\N	\N
3368	2985	PRD-26161	\N	1	\N	\N
3369	2986	PRD-26051	\N	1	\N	\N
3370	2987	PRD-26154	\N	1	\N	\N
3371	2988	PRD-35104	\N	1	\N	\N
3372	2989	PRD-29426K	\N	1	\N	\N
3373	2990	PRD-26162	\N	1	\N	\N
3374	2991	PRD-36224CT	\N	1	\N	\N
3375	2992	PRD-36065	\N	1	\N	\N
3376	2993	RB-1018	\N	1	\N	\N
3377	2994	MFD-005	\N	1	\N	\N
3378	2995	MFD-037U	\N	1	\N	\N
3379	2996	ISD-032	\N	1	\N	\N
3380	2997	MFD-061	\N	1	\N	\N
3381	2998	ISD-028	\N	1	\N	\N
3382	2999	48067-29225	\N	1	\N	\N
3383	3000	OSE46-34-250	\N	1	\N	\N
3384	3001	48066-29225	\N	1	\N	\N
3385	3002	ME-052272	\N	1	\N	\N
3386	3003	ME013333	\N	1	\N	\N
3387	3004	ME013366	\N	1	\N	\N
3388	3005	ME012900	\N	1	\N	\N
3389	3006	ME200685	\N	1	\N	\N
3390	3007	MD050430	\N	1	\N	\N
3391	3008	5-11261-012-0	\N	1	\N	\N
3392	3009	5-1126-188-1	\N	1	\N	\N
3393	3010	GTK-348	\N	1	\N	\N
3394	3011	K-326	\N	1	\N	\N
3395	3012	K-327	\N	1	\N	\N
3396	3013	DS-1189	\N	1	\N	\N
3397	3014	VK-349	\N	1	\N	\N
3398	3015	VK-327	\N	1	\N	\N
3399	3016	VK-942	\N	1	\N	\N
3400	3017	MEVS1333300	\N	1	\N	\N
3401	3018	MC815305	\N	1	\N	\N
3402	3020	GASKET ALL 40G	\N	1	\N	\N
3403	3021	15W-40 5LTR	\N	1	\N	\N
3404	3022	500ML	\N	1	\N	\N
3405	3023	300ML	\N	1	\N	\N
3406	3024	900ML	\N	1	\N	\N
3407	3025	HD-40 1LTR	\N	1	\N	\N
3408	3026	1LTR	\N	1	\N	\N
3409	3027	1LTR	\N	1	\N	\N
3410	3028	1LTR	\N	1	\N	\N
3411	3029	ME-052272	\N	1	\N	\N
3412	3030	5LTR	\N	1	\N	\N
3413	3031	1LTR	\N	1	\N	\N
3414	3032	OK60A-23-603	\N	1	\N	\N
3415	3033	OK6B0-23-603	\N	1	\N	\N
3416	3034	FAS-8423	\N	1	\N	\N
3417	3035	EA-578	\N	1	\N	\N
3418	3036	EA-579	\N	1	\N	\N
3419	3037	FAS-8970	\N	1	\N	\N
3420	3038	213-1118	\N	1	\N	\N
3421	3039	213-1118	\N	1	\N	\N
3422	3040	CR1373	\N	1	\N	\N
3423	3041	30313D	\N	1	\N	\N
3424	3042	39520	\N	1	\N	\N
3425	3042	39590	\N	2	\N	\N
3427	3043	687	\N	2	\N	\N
3428	3044	5OKW06	\N	1	\N	\N
3429	3045	NUP314	\N	1	\N	\N
3430	3046	414245	\N	1	\N	\N
3431	3047	30-324-55	\N	1	\N	\N
3432	3048	10-107-21	\N	1	\N	\N
3433	3049	32606	\N	1	\N	\N
3434	3050	33439	\N	1	\N	\N
3435	3051	33867	\N	1	\N	\N
3436	3052	33893	\N	1	\N	\N
3437	3053	33916	\N	1	\N	\N
3438	3054	33942	\N	1	\N	\N
3439	3055	33950	\N	1	\N	\N
3440	3056	33976	\N	1	\N	\N
3441	3057	32597	\N	1	\N	\N
3442	3058	32602	\N	1	\N	\N
3443	3059	33959	\N	1	\N	\N
3444	3060	33923	\N	1	\N	\N
3445	3061	NI-287	\N	1	\N	\N
3446	3062	NF-119	\N	1	\N	\N
3447	3063	NF-151	\N	1	\N	\N
3448	3064	NI-960	\N	1	\N	\N
3449	3065	NI-967	\N	1	\N	\N
3450	3066	NF-151-2	\N	1	\N	\N
3451	3067	NF-151-3	\N	1	\N	\N
3452	3068	NI-214-3	\N	1	\N	\N
3453	3069	NI-873	\N	1	\N	\N
3454	3070	NF-111	\N	1	\N	\N
3455	3071	214-2017	\N	1	\N	\N
3456	3072	214-2017	\N	1	\N	\N
3457	3073	213-1918-CR	\N	1	\N	\N
3458	3074	213-1918-CR	\N	1	\N	\N
3459	3075	213-1518	\N	1	\N	\N
3460	3076	213-1518	\N	1	\N	\N
3461	3077	214-1618	\N	1	\N	\N
3462	3078	214-1906-X	\N	1	\N	\N
3463	3079	214-1638-Y	\N	1	\N	\N
3464	3080	214-1637-Y	\N	1	\N	\N
3465	3081	214-1637-Y	\N	1	\N	\N
3466	3082	214-2008-C	\N	1	\N	\N
3467	3083	214-1637-Y	\N	1	\N	\N
3468	3084	214-1638-Y	\N	1	\N	\N
3469	3085	214-1903	\N	1	\N	\N
3470	3086	214-1903	\N	1	\N	\N
3471	3087	214-2008-Y	\N	1	\N	\N
3472	3088	214-2008-Y	\N	1	\N	\N
3473	3089	214-2008-C	\N	1	\N	\N
3474	3090	214-2005-C	\N	1	\N	\N
3475	3091	214-2005-C	\N	1	\N	\N
3476	3092	214-1543	\N	1	\N	\N
3477	3093	214-1543	\N	1	\N	\N
3478	3094	214-1508-2	\N	1	\N	\N
3479	3095	214-1508-2	\N	1	\N	\N
3480	3096	214-1423	\N	1	\N	\N
3481	3097	214-1423	\N	1	\N	\N
3482	3098	221-1517	\N	1	\N	\N
3483	3099	221-1517	\N	1	\N	\N
3484	3100	213-1530	\N	1	\N	\N
3485	3101	213-1530	\N	1	\N	\N
3486	3102	214-2006-Y	\N	1	\N	\N
3487	3103	214-1407	\N	1	\N	\N
3488	3104	213-1616-Y	\N	1	\N	\N
3489	3105	213-1616-Y	\N	1	\N	\N
3490	3106	213-1616-CY	\N	1	\N	\N
3491	3107	213-1616-CY	\N	1	\N	\N
3492	3108	213-1907	\N	1	\N	\N
3493	3109	213-2003-Y	\N	1	\N	\N
3494	3110	213-2003-Y	\N	1	\N	\N
3495	3111	213-2003-Y	\N	1	\N	\N
3496	3112	213-1514	\N	1	\N	\N
3497	3113	213-1514	\N	1	\N	\N
3498	3114	213-1617	\N	1	\N	\N
3499	3115	213-1617	\N	1	\N	\N
3500	3116	213-1405	\N	1	\N	\N
3501	3117	218-1509-Y	\N	1	\N	\N
3502	3118	218-1509-Y	\N	1	\N	\N
3503	3119	218-1510-Y	\N	1	\N	\N
3504	3120	218-1510-Y	\N	1	\N	\N
3505	3121	21811-4A000	\N	1	\N	\N
3506	3122	8-97079-119	\N	1	\N	\N
3507	3123	8-97079-118	\N	1	\N	\N
3508	3124	UF9S-39-05X	\N	1	\N	\N
3509	3125	UF9S-39-040	\N	1	\N	\N
3510	3126	11320-VK300	\N	1	\N	\N
3511	3127	9-53215-612-2	\N	1	\N	\N
3512	3128	9-53215-611-2	\N	1	\N	\N
3513	3129	8-94368-599-0	\N	1	\N	\N
3514	3130	MB-581845	\N	1	\N	\N
3515	3131	MR-992670	\N	1	\N	\N
3516	3132	12363-0M011	\N	1	\N	\N
3517	3133	12372-0D190	\N	1	\N	\N
3518	3134	8-97106-759-1	\N	1	\N	\N
3519	3135	8-97106-758-1	\N	1	\N	\N
3520	3136	MK-332290	\N	1	\N	\N
3521	3137	MC-860215	\N	1	\N	\N
3522	3138	1-37516-005-1	\N	1	\N	\N
3523	3139	1-37516-006-1	\N	1	\N	\N
3524	3140	5-37516-007-1	\N	1	\N	\N
3525	3141	8-94328-800-1	\N	1	\N	\N
3526	3142	MB-154080	\N	1	\N	\N
3527	3143	MC-830702	\N	1	\N	\N
3528	3144	MC-824410	\N	1	\N	\N
3529	3145	MB-503024	\N	1	\N	\N
3530	3146	OK60A-43-400	\N	1	\N	\N
3531	3147	20-85020	\N	1	\N	\N
3532	3147	48810	\N	2	\N	\N
3533	3148	20-77A00	\N	1	\N	\N
3534	3148	48810	\N	2	\N	\N
3535	3149	OE-7481	\N	1	\N	\N
3536	3150	56820-4E040	\N	1	\N	\N
3537	3151	OK710-32-240	\N	1	\N	\N
3538	3152	20-79000	\N	1	\N	\N
3539	3152	48810	\N	2	\N	\N
3540	3153	GWS-19AR	\N	1	\N	\N
3541	3154	GWAS-14AR	\N	1	\N	\N
3542	3155	GWIS-43AR	\N	1	\N	\N
3543	3156	GWT-101AR	\N	1	\N	\N
3544	3157	GWK-18AR	\N	1	\N	\N
3545	3158	GWS-11AR	\N	1	\N	\N
3546	3159	GWIS-25AR	\N	1	\N	\N
3547	3160	GWT-116AR	\N	1	\N	\N
3548	3161	GWIS-49A	\N	1	\N	\N
3549	3162	MWM-43AN	\N	1	\N	\N
3550	3163	GWM-52AR	\N	1	\N	\N
3551	3164	GWK-24AR	\N	1	\N	\N
3552	3165	GWMZ-30A	\N	1	\N	\N
3553	3166	GWM-33A	\N	1	\N	\N
3554	3167	GWS-37A	\N	1	\N	\N
3555	3168	GWS-42A	\N	1	\N	\N
3556	3169	GWIS-25A	\N	1	\N	\N
3557	3170	GWM-33A	\N	1	\N	\N
3558	3171	GWHO-40A	\N	1	\N	\N
3559	3172	GWMZ-49A	\N	1	\N	\N
3560	3173	MWM-39A	\N	1	\N	\N
3561	3174	ME-031962	\N	1	\N	\N
3562	3175	HY-901-A48	\N	1	\N	\N
3563	3176	MI-92	\N	1	\N	\N
3564	3177	MJMZ-08	\N	1	\N	\N
3565	3178	218-1510-C	\N	1	\N	\N
3566	3179	218-1510-C	\N	1	\N	\N
3567	3180	218-1903	\N	1	\N	\N
3568	3181	218-1903	\N	1	\N	\N
3569	3182	12361-0L030	\N	1	\N	\N
3570	3183	12361-0C010	\N	1	\N	\N
3571	3184	OK60A-39-340	\N	1	\N	\N
3572	3185	OK60A-39-340	\N	1	\N	\N
3573	3186	UB39-39-040	\N	1	\N	\N
3574	3187	UB39-39-040	\N	1	\N	\N
3575	3188	MR-223199	\N	1	\N	\N
3576	3189	37230-OK021	\N	1	\N	\N
3577	3190	37230-OK010	\N	1	\N	\N
3578	3191	MC-824410	\N	1	\N	\N
3579	3192	37230-26020	\N	1	\N	\N
3580	3193	SA12-25-300	\N	1	\N	\N
3581	3194	37230-BZ010	\N	1	\N	\N
3582	3195	8-94928-799-0	\N	1	\N	\N
3583	3196	8-97942-876-0	\N	1	\N	\N
3584	3197	8-97942-877-0	\N	1	\N	\N
3585	3198	MC-870394	\N	1	\N	\N
3586	3199	5-37510-006-0	\N	1	\N	\N
3587	3200	1-37510-105-0	\N	1	\N	\N
3588	3201	ME-011832	\N	1	\N	\N
3589	3202	12305-OD130	\N	1	\N	\N
3590	3203	MC-830615	\N	1	\N	\N
3591	3204	ME-031964	\N	1	\N	\N
3592	3205	ME-01180-7	\N	1	\N	\N
3593	3206	SFL-499L	\N	1	\N	\N
3594	3207	DB-3062	\N	1	\N	\N
3595	3208	SAL1215L	\N	1	\N	\N
3596	3209	SAL1215L	\N	1	\N	\N
3597	3210	SAL1215L	\N	1	\N	\N
3598	3211	SAL1215L	\N	1	\N	\N
3599	3212	SAL1215L	\N	1	\N	\N
3600	3213	AV-8001	\N	1	\N	\N
3601	3214	AV-8001	\N	1	\N	\N
3602	3215	AV-8001	\N	1	\N	\N
3603	3216	SP-819	\N	1	\N	\N
3604	3217	SAL-004	\N	1	\N	\N
3605	3218	51328-48A00	\N	1	\N	\N
3606	3219	8-97039-189-3	\N	1	\N	\N
3607	3220	8-97039-190-3	\N	1	\N	\N
3608	3221	GWN-47AF	\N	1	\N	\N
3609	3222	90310-25005	\N	1	\N	\N
3610	3222	T1023	\N	2	\N	\N
3611	3223	90311-50030	\N	1	\N	\N
3612	3223	T1085	\N	2	\N	\N
3613	3224	F4017	\N	1	\N	\N
3614	3224	ME620713	\N	2	\N	\N
3615	3225	1-09625-331-2	\N	1	\N	\N
3616	3225	I3594	\N	2	\N	\N
3617	3226	0600-26-154	\N	1	\N	\N
3618	3226	M4154	\N	2	\N	\N
3619	3228	27371-53-F00	\N	1	\N	\N
3620	3228	Z6133	\N	2	\N	\N
3621	3231	213-1621-Y	\N	1	\N	\N
3622	3232	FAS-8067	\N	1	\N	\N
3623	3233	214-1906	\N	1	\N	\N
3624	3234	GA-334	\N	1	\N	\N
3625	3235	54611-07000	\N	1	\N	\N
3626	3236	221-1943	\N	1	\N	\N
3627	3237	48609-0K040	\N	1	\N	\N
3628	3238	68960-OK010	\N	1	\N	\N
3629	3239	GA-573	\N	1	\N	\N
3630	3240	SHL-611L	\N	1	\N	\N
3631	3241	65470-VW000	\N	1	\N	\N
3632	3242	48609-0D060	\N	1	\N	\N
3633	3243	GWM-39A	\N	1	\N	\N
3634	3244	GWM-43A	\N	1	\N	\N
3635	3244	MWM-43A	\N	2	\N	\N
3636	3245	STL-186	\N	1	\N	\N
3637	3246	213-1136	\N	1	\N	\N
3638	3247	MOPN-404	\N	1	\N	\N
3639	3248	MOPT-041	\N	1	\N	\N
3640	3249	BSM5203	\N	1	\N	\N
3641	3250	ME993681	\N	1	\N	\N
3642	3251	ME092269	\N	1	\N	\N
3643	3253	KOS-039	\N	1	\N	\N
3644	3254	M-1472	\N	1	\N	\N
3645	3255	54613-EB71A	\N	1	\N	\N
3646	3256	MOPM	\N	1	\N	\N
3647	3268	48609-OK010	\N	1	\N	\N
3648	3270	BSM5203	\N	1	\N	\N
3649	3282	48635-28010	\N	1	\N	\N
3650	3283	48655-BZ080	\N	1	\N	\N
3651	3284	48061-27010	\N	1	\N	\N
3652	3285	S083-34-156	\N	1	\N	\N
3653	3286	12305-0C011	\N	1	\N	\N
3654	3287	44610-3D091	\N	1	\N	\N
3655	3288	MBS351	\N	1	\N	\N
3656	3289	MBS294	\N	1	\N	\N
3657	3290	MBT314	\N	1	\N	\N
3658	3291	MBI203	\N	1	\N	\N
3659	3292	MBM186	\N	1	\N	\N
3660	3293	MBT295	\N	1	\N	\N
3661	3294	44610-52660	\N	1	\N	\N
3662	3295	ME507172	\N	1	\N	\N
3663	3296	MR449474	\N	1	\N	\N
3664	3297	30620-2T021	\N	1	\N	\N
3665	3298	8-97039-704-0	\N	1	\N	\N
3666	3299	41700-43150	\N	1	\N	\N
3667	3300	MC113050	\N	1	\N	\N
3668	3301	CRA-601A	\N	1	\N	\N
3669	3302	MR111585	\N	1	\N	\N
3670	3303	ME670290	\N	1	\N	\N
3671	3304	23820-65D00	\N	1	\N	\N
3672	3305	46930-SAA-013	\N	1	\N	\N
3673	3306	MB-937019	\N	1	\N	\N
3674	3307	ME602333	\N	1	\N	\N
3675	3308	30620-10G00	\N	1	\N	\N
3676	3309	ME601106	\N	1	\N	\N
3677	3310	MB601290	\N	1	\N	\N
3678	3311	UB39-41-920A	\N	1	\N	\N
3679	3312	0K011-41-920	\N	1	\N	\N
3680	3313	MD050125	\N	1	\N	\N
3681	3314	88440-0K060	\N	1	\N	\N
3682	3315	30620-10G00	\N	1	\N	\N
3683	3316	GT20120	\N	1	\N	\N
3684	3317	GT90630	\N	1	\N	\N
3685	3318	GT20120C	\N	1	\N	\N
3686	3319	58TKA3703B	\N	1	\N	\N
3687	3320	58TKA3703B	\N	1	\N	\N
3688	3321	62TB0520B01	\N	1	\N	\N
3689	3322	72TB0103	\N	1	\N	\N
3690	3323	MD740318	\N	1	\N	\N
3691	3324	41412-23010	\N	1	\N	\N
3692	3325	ZA-50TKZ3301FR	\N	1	\N	\N
3693	3326	ZA-78TKL4001AR	\N	1	\N	\N
3694	3327	ZA-58TKZ3701A	\N	1	\N	\N
3695	3328	ZA-60TKZ3201R	\N	1	\N	\N
3696	3329	41412-49600	\N	1	\N	\N
3697	3330	0K88R-15-983	\N	1	\N	\N
3698	3331	88440-0K020	\N	1	\N	\N
3699	3332	0K71E-17-240	\N	1	\N	\N
3700	3333	11925-VC80A	\N	1	\N	\N
3701	3334	BK3Q6C344AC	\N	1	\N	\N
3702	3335	13505-11010	\N	1	\N	\N
3703	3336	24TK308B2U3	\N	1	\N	\N
3704	3337	GT90610	\N	1	\N	\N
3705	3338	9-480095-030-1	\N	1	\N	\N
3706	3339	B32-8C	\N	1	\N	\N
3707	3340	0K88R-12-700	\N	1	\N	\N
3708	3341	WE01-12-730	\N	1	\N	\N
3709	3342	24370-4A030	\N	1	\N	\N
3710	3343	12810-30010	\N	1	\N	\N
3711	3344	09269-38001	\N	1	\N	\N
3712	3345	RCTS371SA2	\N	1	\N	\N
3713	3346	RCT432SA1	\N	1	\N	\N
3714	3347	PU245339ARR1DV	\N	1	\N	\N
3715	3348	13505-67042	\N	1	\N	\N
3716	3349	27411-31200	\N	1	\N	\N
3717	3350	37321-4A000	\N	1	\N	\N
3718	3351	GC31010R	\N	1	\N	\N
3719	3352	24180-4A001	\N	1	\N	\N
3720	3353	FCR55-17-11	\N	1	\N	\N
3721	3354	31230-71030	\N	1	\N	\N
3722	3355	0K552-15-P13	\N	1	\N	\N
3723	3356	13505-11010	\N	1	\N	\N
3724	3357	11750-2W202	\N	1	\N	\N
3725	3358	09269-3006	\N	1	\N	\N
3726	3359	30502-69F10	\N	1	\N	\N
3727	3360	24170-A4001	\N	1	\N	\N
3728	3361	27415-30010	\N	1	\N	\N
3729	3362	2DUF050N-7	\N	1	\N	\N
3730	3363	5-15660-300-0	\N	1	\N	\N
3731	3364	16361-54040	\N	1	\N	\N
3732	3365	CT55BL1	\N	1	\N	\N
3733	3366	M658A	\N	1	\N	\N
3734	3367	RCT3504SA	\N	1	\N	\N
3735	3368	M658A	\N	1	\N	\N
3736	3369	8-97024-295-0	\N	1	\N	\N
3737	3370	M658A	\N	1	\N	\N
3738	3371	27415-0L050	\N	1	\N	\N
3739	3372	M658A	\N	1	\N	\N
3740	3373	R658A	\N	1	\N	\N
3741	3374	R658A	\N	1	\N	\N
3742	3375	JPU58-012A-3G1	\N	1	\N	\N
3743	3376	R658A	\N	1	\N	\N
3744	3377	R658A	\N	1	\N	\N
3745	3378	23151-5X21B	\N	1	\N	\N
3746	3379	R660A	\N	1	\N	\N
3747	3380	MD050135	\N	1	\N	\N
3748	3381	R593A	\N	1	\N	\N
3749	3382	R590A	\N	1	\N	\N
3750	3383	R590A	\N	1	\N	\N
3751	3384	WE0112730	\N	1	\N	\N
3752	3385	OK66A-12-121	\N	1	\N	\N
3753	3386	GC31010R	\N	1	\N	\N
3754	3387	OK66A-12-111	\N	1	\N	\N
3755	3388	0155-0090	\N	1	\N	\N
3756	3389	MD-327653	\N	1	\N	\N
3757	3390	MP6305K	\N	1	\N	\N
3758	3391	HAT205S-2G1	\N	1	\N	\N
3759	3392	R593A	\N	1	\N	\N
3760	3393	OK65B-12-121	\N	1	\N	\N
3761	3394	13212-43G01	\N	1	\N	\N
3762	3395	9K88R-15-983	\N	1	\N	\N
3763	3396	31301-10601	\N	1	\N	\N
3764	3397	PU245339ARR1DV	\N	1	\N	\N
3765	3398	MD-050523	\N	1	\N	\N
3766	3398	MD-050527	\N	2	\N	\N
3767	3399	782KC5401	\N	1	\N	\N
3768	3400	OK711-34-580	\N	1	\N	\N
3769	3401	NO PART NO.	\N	1	\N	\N
3770	3402	5-11721-016-0	\N	1	\N	\N
3771	3403	5-11721-016-0	\N	1	\N	\N
3772	3404	5-11721-016-0	\N	1	\N	\N
3773	3405	NUP312NR	\N	1	\N	\N
3774	3406	G5-280X	\N	1	\N	\N
3775	3407	G5-281X	\N	1	\N	\N
3776	3408	17222-84000	\N	1	\N	\N
3777	3409	GUM-90	\N	1	\N	\N
3778	3410	21060-03J00	\N	1	\N	\N
3779	3411	GUH-64	\N	1	\N	\N
3780	3412	ME075229	\N	1	\N	\N
3781	3413	GUM-98	\N	1	\N	\N
3782	3414	0K60A-44-150G	\N	1	\N	\N
3783	3415	GUH-64	\N	1	\N	\N
3784	3416	GUH-68	\N	1	\N	\N
3785	3417	M660A	\N	1	\N	\N
3786	3418	GUIS-65	\N	1	\N	\N
3787	3419	M660A	\N	1	\N	\N
3788	3420	GUM-97	\N	1	\N	\N
3789	3421	GUIS-64	\N	1	\N	\N
3790	3422	GUIS-72	\N	1	\N	\N
3791	3423	GUM-94	\N	1	\N	\N
3792	3424	GUM-72	\N	1	\N	\N
3793	3425	GUIS-70	\N	1	\N	\N
3794	3426	MP6305K	\N	1	\N	\N
3795	3427	M6314K	\N	1	\N	\N
3796	3428	M3003A	\N	1	\N	\N
3797	3429	M6029K	\N	1	\N	\N
3798	3430	M6029K	\N	1	\N	\N
3799	3431	M6029K	\N	1	\N	\N
3800	3432	M4631K	\N	1	\N	\N
3801	3433	M7277A	\N	1	\N	\N
3802	3434	0155-0302	\N	1	\N	\N
3803	3435	M7800K	\N	1	\N	\N
3804	3436	0155-0336	\N	1	\N	\N
3805	3437	M7800K	\N	1	\N	\N
3806	3438	R6029K	\N	1	\N	\N
3807	3439	0155-0091	\N	1	\N	\N
3808	3440	R6029K	\N	1	\N	\N
3809	3441	0147-0254	\N	1	\N	\N
3810	3442	R6029K	\N	1	\N	\N
3811	3443	0147-0426	\N	1	\N	\N
3812	3444	R9375A	\N	1	\N	\N
3813	3445	0147-0247	\N	1	\N	\N
3814	3446	M5910A	\N	1	\N	\N
3815	3447	0155-0128	\N	1	\N	\N
3816	3448	M9375A	\N	1	\N	\N
3817	3449	0155-0238	\N	1	\N	\N
3818	3450	M9375A	\N	1	\N	\N
3819	3451	R8111A	\N	1	\N	\N
3820	3452	R8111A	\N	1	\N	\N
3821	3453	T658A	\N	1	\N	\N
3822	3454	R4545K	\N	1	\N	\N
3823	3455	21C18	\N	1	\N	\N
3824	3456	M7278A	\N	1	\N	\N
3825	3457	0114-0548	\N	1	\N	\N
3826	3458	R6036K	\N	1	\N	\N
3827	3459	0114-0583	\N	1	\N	\N
3828	3460	R7800K	\N	1	\N	\N
3829	3461	0127-0078	\N	1	\N	\N
3830	3462	R7800K	\N	1	\N	\N
3831	3463	0127-0062	\N	1	\N	\N
3832	3464	M8418A	\N	1	\N	\N
3833	3465	R3003A	\N	1	\N	\N
3834	3466	0114-0081	\N	1	\N	\N
3835	3467	OK6Z1-11-SE0	\N	1	\N	\N
3836	3468	R6321K 0.25	\N	1	\N	\N
3837	3469	MA-23-0	\N	1	\N	\N
3838	3470	P8419L	\N	1	\N	\N
3839	3471	MA-23-0	\N	1	\N	\N
3840	3472	P777L	\N	1	\N	\N
3841	3473	1010A109	\N	1	\N	\N
3842	3474	DS-002	\N	1	\N	\N
3843	3475	ME-0201501	\N	1	\N	\N
3844	3475	ME-0201504	\N	2	\N	\N
3845	3476	DS-602U	\N	1	\N	\N
3846	3477	ME-031886	\N	1	\N	\N
3847	3477	ME-031888	\N	2	\N	\N
3848	3478	DTX-164A	\N	1	\N	\N
3849	3479	MD-050523	\N	1	\N	\N
3850	3479	MD-050527	\N	2	\N	\N
3851	3480	DM-035U	\N	1	\N	\N
3852	3481	ME-051120	\N	1	\N	\N
3853	3481	ME-051122	\N	2	\N	\N
3854	3482	DT-611U	\N	1	\N	\N
3855	3483	ME-240748	\N	1	\N	\N
3856	3483	ME-240749	\N	2	\N	\N
3857	3484	DTX-174	\N	1	\N	\N
3858	3485	CS-103	\N	1	\N	\N
3859	3486	11122-10012	\N	1	\N	\N
3860	3486	11122-10040	\N	2	\N	\N
3861	3487	K71E-16-460A	\N	1	\N	\N
3862	3488	MFD-004	\N	1	\N	\N
3863	3489	13212	\N	1	\N	\N
3864	3489	3-AD260	\N	2	\N	\N
3865	3490	DT-123	\N	1	\N	\N
3866	3491	ISC-519	\N	1	\N	\N
3867	3492	ME20007	\N	1	\N	\N
3868	3492	ME20009	\N	2	\N	\N
3869	3493	TYC-550	\N	1	\N	\N
3870	3494	ME-201504	\N	1	\N	\N
3871	3495	PRD-26051	\N	1	\N	\N
3872	3496	30210-3XN0A	\N	1	\N	\N
3873	3497	5-11721-123-	\N	1	\N	\N
3874	3498	30100-3XN0A	\N	1	\N	\N
3875	3499	11122-64010	\N	1	\N	\N
3876	3500	GA-306	\N	1	\N	\N
3877	3501	11115	\N	1	\N	\N
3878	3501	6-83512	\N	2	\N	\N
3879	3502	FAS-8425	\N	1	\N	\N
3880	3503	11122-75010-20	\N	1	\N	\N
3881	3504	MFC-561	\N	1	\N	\N
3882	3505	WLY1-10-280	\N	1	\N	\N
3883	3506	MZC-544	\N	1	\N	\N
3884	3507	13211-V1700	\N	1	\N	\N
3885	3508	MZC-619	\N	1	\N	\N
3886	3509	13212	\N	1	\N	\N
3887	3509	3-15M01	\N	2	\N	\N
3888	3510	ISC-528	\N	1	\N	\N
3889	3511	ME-0201501	\N	1	\N	\N
3890	3511	ME-0201504	\N	2	\N	\N
3891	3512	1-11141262-0 NEW	\N	1	\N	\N
3892	3513	8-97066196-0	\N	1	\N	\N
3893	3514	11112	\N	1	\N	\N
3894	3514	11122	\N	2	\N	\N
3895	3514	26-64010	\N	3	\N	\N
3896	3515	8-94418921-0	\N	1	\N	\N
3897	3516	11122-75010	\N	1	\N	\N
3898	3516	11122-75020	\N	2	\N	\N
3899	3517	1-11141189-0	\N	1	\N	\N
3900	3518	ME-240708	\N	1	\N	\N
3901	3519	5-11721-113-0	\N	1	\N	\N
3902	3520	ME-011110	\N	1	\N	\N
3903	3521	11122-54010	\N	1	\N	\N
3904	3521	11122-54011	\N	2	\N	\N
3905	3522	ME-013330	\N	1	\N	\N
3906	3523	22311-4A700	\N	1	\N	\N
3907	3524	5-11721-001-0	\N	1	\N	\N
3908	3525	GU-1540	\N	1	\N	\N
3909	3526	ME-240748	\N	1	\N	\N
3910	3526	ME-240749	\N	2	\N	\N
3911	3527	GUM-86	\N	1	\N	\N
3912	3528	11115	\N	1	\N	\N
3913	3528	6-77A00	\N	2	\N	\N
3914	3529	GUIS-70	\N	1	\N	\N
3915	3530	30312DJR	\N	1	\N	\N
3916	3531	M777A	\N	1	\N	\N
3917	3532	1-11715-078-0	\N	1	\N	\N
3918	3533	1-11711-024-0	\N	1	\N	\N
3919	3534	M9375A	\N	1	\N	\N
3920	3535	M5985A1	\N	1	\N	\N
3921	3536	M5985A1	\N	1	\N	\N
3922	3537	MUS-2	\N	1	\N	\N
3923	3538	GUIS-66	\N	1	\N	\N
3924	3539	GU-7280	\N	1	\N	\N
3925	3540	11400-78825	\N	1	\N	\N
3926	3541	GUT-23	\N	1	\N	\N
3927	3542	GUT-21R	\N	1	\N	\N
3928	3543	GUM-91	\N	1	\N	\N
3929	3544	GUS-2	\N	1	\N	\N
3930	3545	GUS-1	\N	1	\N	\N
3931	3546	GUT-12	\N	1	\N	\N
3932	3547	EA-8373	\N	1	\N	\N
3933	3547	ME-401884	\N	2	\N	\N
3934	3548	17801-68020	\N	1	\N	\N
3935	3548	EA-8147	\N	2	\N	\N
3936	3549	17801-54100	\N	1	\N	\N
3937	3549	FAS-8025	\N	2	\N	\N
3938	3550	5-13240-025-0	\N	1	\N	\N
3939	3550	FO-4561P	\N	2	\N	\N
3940	3551	1-13240198-0	\N	1	\N	\N
3941	3551	GO-580	\N	2	\N	\N
3942	3552	KA-3343	\N	1	\N	\N
3943	3552	MD-620039	\N	2	\N	\N
3944	3553	1-13240-205-0	\N	1	\N	\N
3945	3553	FO-4581P	\N	2	\N	\N
3946	3554	GO-358	\N	1	\N	\N
3947	3554	ME-034611	\N	2	\N	\N
3948	3555	ME-996356	\N	1	\N	\N
3949	3555	RFS-98597S	\N	2	\N	\N
3950	3556	5-87812-988-3	\N	1	\N	\N
3951	3556	RFS-98554S	\N	2	\N	\N
3952	3557	ME-997274	\N	1	\N	\N
3953	3557	RFS-98538S	\N	2	\N	\N
3954	3558	OK72A-99-100X	\N	1	\N	\N
3955	3558	RFS-98532S	\N	2	\N	\N
3956	3559	ME-999279	\N	1	\N	\N
3957	3559	RFS-98518S	\N	2	\N	\N
3958	3560	ME-997273	\N	1	\N	\N
3959	3560	RFS-98491S	\N	2	\N	\N
3960	3561	04111-64210	\N	1	\N	\N
3961	3561	RFS-98410S	\N	2	\N	\N
3962	3562	04111-54092	\N	1	\N	\N
3963	3562	RFS-98372S	\N	2	\N	\N
3964	3563	04111-BZ990	\N	1	\N	\N
3965	3563	RFS-85033S	\N	2	\N	\N
3966	3564	ME-997274	\N	1	\N	\N
3967	3564	RFS-84538S	\N	2	\N	\N
3968	3565	ME-996360	\N	1	\N	\N
3969	3565	RFS-85045S	\N	2	\N	\N
3970	3566	ME-997273	\N	1	\N	\N
3971	3566	RFS-84491S	\N	2	\N	\N
3972	3567	ME-997276	\N	1	\N	\N
3973	3567	RFS-98570S	\N	2	\N	\N
3974	3568	04111-06010	\N	1	\N	\N
3975	3568	RFS-84504S	\N	2	\N	\N
3976	3569	10101-43G27	\N	1	\N	\N
3977	3569	RFS-60774S	\N	2	\N	\N
3978	3570	5-87810-457-2	\N	1	\N	\N
3979	3570	RFS-60755S	\N	2	\N	\N
3980	3571	ME-999284	\N	1	\N	\N
3981	3571	RFS-60740S	\N	2	\N	\N
3982	3572	5-87810-208-6	\N	1	\N	\N
3983	3572	RFS-60737S	\N	2	\N	\N
3984	3573	5-87810-212-2	\N	1	\N	\N
3985	3573	RFS-60727S	\N	2	\N	\N
3986	3574	01111-13024	\N	1	\N	\N
3987	3574	RFS-60208S	\N	2	\N	\N
3988	3575	31694-33370	\N	1	\N	\N
3989	3575	RFS-60027S	\N	2	\N	\N
3990	3576	5-87810-214-2	\N	1	\N	\N
3991	3576	RFS-60014S	\N	2	\N	\N
3992	3577	11044-1W400	\N	1	\N	\N
3993	3577	RHG-98605	\N	2	\N	\N
3994	3578	R202-10-271	\N	1	\N	\N
3995	3578	RHG-98527	\N	2	\N	\N
3996	3579	8-94332-326-0	\N	1	\N	\N
3997	3579	RHG-98509	\N	2	\N	\N
3998	3580	0K65A-10-271A	\N	1	\N	\N
3999	3580	RHG-98505	\N	2	\N	\N
4000	3581	ME-013334	\N	1	\N	\N
4001	3581	RHG-98496	\N	2	\N	\N
4002	3582	ME-013330	\N	1	\N	\N
4003	3582	RHG-98495	\N	2	\N	\N
4004	3583	11044-57Y00	\N	1	\N	\N
4005	3583	RHG-98435	\N	2	\N	\N
4006	3584	11115-64080	\N	1	\N	\N
4007	3584	RHG-98370	\N	2	\N	\N
4008	3585	8-94418-919-1	\N	1	\N	\N
4009	3585	RHG-98338	\N	2	\N	\N
4010	3586	22311-02760	\N	1	\N	\N
4011	3586	RHG-98232	\N	2	\N	\N
4012	3587	11115-21050	\N	1	\N	\N
4013	3587	RHG-98157	\N	2	\N	\N
4014	3588	11115BZ050	\N	1	\N	\N
4015	3588	RHG-96300	\N	2	\N	\N
4016	3589	8-97328-66-1	\N	1	\N	\N
4017	3589	RHG-95181	\N	2	\N	\N
4018	3590	8-97259-601-0	\N	1	\N	\N
4019	3590	RHG-95177	\N	2	\N	\N
4020	3591	8-94418-921-0	\N	1	\N	\N
4021	3591	RHG-88438	\N	2	\N	\N
4022	3592	RHG-84608	\N	1	\N	\N
4023	3592	VS01-0-271E	\N	2	\N	\N
4024	3593	11044-43G01	\N	1	\N	\N
4025	3593	RHG-84577H	\N	2	\N	\N
4026	3594	8-97066-196-0	\N	1	\N	\N
4027	3594	RHG-84532H	\N	2	\N	\N
4028	3595	ME-013334	\N	1	\N	\N
4029	3595	RHG-84496	\N	2	\N	\N
4030	3596	ME-001345	\N	1	\N	\N
4031	3596	RHG-84494	\N	2	\N	\N
4032	3597	8-97100-545-0	\N	1	\N	\N
4033	3597	RHG-84457	\N	2	\N	\N
4034	3598	1-11141-196-0	\N	1	\N	\N
4035	3598	RHG-84445	\N	2	\N	\N
4036	3599	5-11141-083-0	\N	1	\N	\N
4037	3599	RHG-84440	\N	2	\N	\N
4038	3600	ME-013300	\N	1	\N	\N
4039	3600	RHG-84354	\N	2	\N	\N
4040	3601	11044-50Y00	\N	1	\N	\N
4041	3601	RHG-84372H	\N	2	\N	\N
4042	3602	11044-W4002	\N	1	\N	\N
4043	3602	RHG-84336	\N	2	\N	\N
4044	3603	11044-09W01	\N	1	\N	\N
4045	3603	RHG-84190	\N	2	\N	\N
4046	3604	5-11141-017-2	\N	1	\N	\N
4047	3604	RHG-84093	\N	2	\N	\N
4048	3605	11115-BZ050	\N	1	\N	\N
4049	3605	RHG-81300	\N	2	\N	\N
4050	3606	22311-02760	\N	1	\N	\N
4051	3606	RHG-81232	\N	2	\N	\N
4052	3607	MD-333379	\N	1	\N	\N
4053	3607	RHG-81207	\N	2	\N	\N
4054	3608	11115-B1030	\N	1	\N	\N
4055	3608	RHG-81192	\N	2	\N	\N
4056	3609	11115-21050	\N	1	\N	\N
4057	3609	RHG-81157	\N	2	\N	\N
4058	3610	ME-011110B	\N	1	\N	\N
4059	3610	RHG-81106	\N	2	\N	\N
4060	3611	11115-16082	\N	1	\N	\N
4061	3611	RHG-60576	\N	2	\N	\N
4062	3612	KY03-10-271	\N	1	\N	\N
4063	3612	RHG-60573	\N	2	\N	\N
4064	3613	5-11141-073-1	\N	1	\N	\N
4065	3613	RHG-60558	\N	2	\N	\N
4066	3614	5-11141-083-0	\N	1	\N	\N
4067	3614	RHG-60440	\N	2	\N	\N
4068	3615	11115-13031	\N	1	\N	\N
4069	3615	RHG-60043	\N	2	\N	\N
4070	3616	11141-78F00	\N	1	\N	\N
4071	3616	YHG-K6A	\N	2	\N	\N
4072	3617	11141-79100	\N	1	\N	\N
4073	3617	SHG-F5A	\N	2	\N	\N
4074	3618	MD-997249	\N	1	\N	\N
4075	3618	SFS-4D56T	\N	2	\N	\N
4076	3619	8-94336-316-0	\N	1	\N	\N
4077	3620	KI-902	\N	1	\N	\N
4078	3621	6.50-14	\N	1	\N	\N
4079	3622	1-52519-041B	\N	1	\N	\N
4080	3623	R15	\N	1	\N	\N
4081	3624	F13	\N	1	\N	\N
4082	3625	12.00-20	\N	1	\N	\N
4083	3626	G14	\N	1	\N	\N
4084	3627	20w50	\N	1	\N	\N
4085	3628	47575R	\N	1	\N	\N
4086	3629	80205R	\N	1	\N	\N
4087	3630	80206R	\N	1	\N	\N
4088	3631	80209R	\N	1	\N	\N
4089	3632	80463R	\N	1	\N	\N
4090	3633	GT-51720-4N000	\N	1	\N	\N
4091	3634	31390-H1970	\N	1	\N	\N
4092	3635	6PK-1380	\N	1	\N	\N
4093	3636	5PK-1565	\N	1	\N	\N
4094	3637	ME-190013	\N	1	\N	\N
4095	3638	8-97119-887-0	\N	1	\N	\N
4096	3639	BROWN PAIL	\N	1	\N	\N
4097	3640	VT-183	\N	1	\N	\N
4098	3641	ARY-17	\N	1	\N	\N
4099	3642	8-9751722-0	\N	1	\N	\N
4100	3643	CPI-59	\N	1	\N	\N
4101	3644	RC-9S	\N	1	\N	\N
4102	3645	RC-9B	\N	1	\N	\N
4103	3646	31420-53015	\N	1	\N	\N
4104	3646	GO-356	\N	2	\N	\N
4105	3646	GO-359	\N	3	\N	\N
4106	3647	GFC-321	\N	1	\N	\N
4107	3648	8441	\N	1	\N	\N
4108	3649	8341	\N	1	\N	\N
4109	3650	8141	\N	1	\N	\N
4110	3651	81131	\N	1	\N	\N
4111	3652	31500-73G01	\N	1	\N	\N
4112	3653	31500-74G01	\N	1	\N	\N
4113	3654	0-584	\N	1	\N	\N
4114	3655	SFTC-39MM	\N	1	\N	\N
4115	3656	27475-30020	\N	1	\N	\N
4116	3657	CPM-165	\N	1	\N	\N
4117	3658	CPZ-30	\N	1	\N	\N
4118	3659	1145A078	\N	1	\N	\N
4119	3660	58610-43031	\N	1	\N	\N
4120	3660	MBHY-331	\N	2	\N	\N
4121	3661	ISC-518|1-31220-081-0	\N	1	\N	\N
4122	3662	205/55-R17	\N	1	\N	\N
4123	3665	BS-005	\N	1	\N	\N
4124	3670	BS-006	\N	1	\N	\N
4125	3671	BS-009	\N	1	\N	\N
4126	3672	BS-010	\N	1	\N	\N
4127	3673	AH-18	\N	1	\N	\N
4128	3674	AH-22A	\N	1	\N	\N
4129	3675	AM-22A	\N	1	\N	\N
4130	3676	AM-32A	\N	1	\N	\N
4131	3677	AN-11A	\N	1	\N	\N
4132	3679	OEM123	\N	1	\N	\N
\.


--
-- Data for Name: part_tag; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.part_tag (part_id, tag_id) FROM stdin;
2	1
3687	2
3	2
3689	3
3690	3
\.


--
-- Data for Name: payment_methods; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.payment_methods (method_id, code, name, type, enabled, sort_order, config, created_at, created_by, updated_at, updated_by, settlement_type) FROM stdin;
10	cheque	Cheque	bank	t	9	{"change_allowed": false, "max_split_count": null, "reference_label": "Cheque Number", "settlement_type": "delayed", "requires_reference": true, "requires_receipt_no": true}	2025-09-13 01:31:53.022663+00	\N	2025-09-15 03:59:24.125281+00	1	delayed
4	bank_transfer	Bank Transfer	bank	t	8	{"change_allowed": false, "max_split_count": null, "reference_label": "Reference Number", "settlement_type": "delayed", "requires_reference": true, "requires_receipt_no": false, "settlement_description": "Funds settle later (bank transfer, cheque)"}	2025-09-13 01:12:02.61256+00	\N	2025-09-15 03:59:29.543807+00	1	delayed
17	on_account	On Account	other	t	2	{"change_allowed": false, "max_split_count": null, "reference_label": "", "settlement_type": "on_account", "requires_reference": false, "requires_receipt_no": true}	2025-09-13 09:33:06.112377+00	\N	2025-09-15 04:45:33.809129+00	1	on_account
2	credit_card	Credit Card	card	t	6	{"change_allowed": false, "max_split_count": null, "reference_label": "Auth Code", "settlement_type": "instant", "requires_reference": true, "requires_receipt_no": true}	2025-09-13 01:12:02.61256+00	\N	2025-09-14 22:11:41.020442+00	1	instant
3	debit_card	Debit Card	card	t	7	{"change_allowed": false, "max_split_count": null, "reference_label": "Auth Code", "settlement_type": "instant", "requires_reference": true, "requires_receipt_no": true}	2025-09-13 01:12:02.61256+00	\N	2025-09-14 22:13:49.577528+00	1	instant
5	gcash	GCash	mobile	t	3	{"change_allowed": false, "max_split_count": null, "reference_label": "Reference No.", "settlement_type": "instant", "requires_reference": true, "requires_receipt_no": false}	2025-09-13 01:12:02.61256+00	\N	2025-09-14 22:14:05.316947+00	1	instant
1	cash	Cash	cash	t	1	{"change_allowed": true, "max_split_count": null, "reference_label": "", "settlement_type": "instant", "requires_reference": false, "requires_receipt_no": false}	2025-09-13 01:12:02.61256+00	\N	2025-09-14 02:31:15.261492+00	1	instant
12	paymaya	PayMaya	mobile	t	4	{"change_allowed": false, "max_split_count": null, "reference_label": "Transaction ID", "settlement_type": "instant", "requires_reference": true, "requires_receipt_no": false}	2025-09-13 01:31:53.022663+00	\N	2025-09-14 02:31:15.261492+00	1	instant
18	charge	charge	other	f	0	{"change_allowed": false, "max_split_count": null, "reference_label": "", "settlement_type": "instant", "requires_reference": false, "requires_receipt_no": false}	2025-09-13 15:05:04.865836+00	1	2025-09-14 02:31:29.670065+00	1	instant
\.


--
-- Data for Name: payment_term; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.payment_term (payment_term_id, term_name, days_to_due) FROM stdin;
1	Due on receipt	0
2	7 days	7
3	15 days	15
4	30 days	30
\.


--
-- Data for Name: permission; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.permission (permission_id, permission_key, description, category) FROM stdin;
1	dashboard:view	View Dashboard	General
2	pos:use	Use Point of Sale	General
3	invoicing:create	Create Invoices	Sales & A/R
4	ar:view	View Accounts Receivable	Sales & A/R
5	ar:receive_payment	Receive Customer Payments	Sales & A/R
6	inventory:view	View Inventory	Inventory & Purchasing
7	inventory:adjust	Adjust Stock Levels	Inventory & Purchasing
8	goods_receipt:create	Create Goods Receipts	Inventory & Purchasing
9	purchase_orders:view	View Purchase Orders	Inventory & Purchasing
10	purchase_orders:edit	Create/Edit Purchase Orders	Inventory & Purchasing
11	parts:view	View Parts	Data Management
12	parts:create	Create Parts	Data Management
13	parts:edit	Edit Parts	Data Management
14	parts:delete	Delete Parts	Data Management
15	suppliers:view	View Suppliers	Data Management
16	suppliers:edit	Create/Edit Suppliers	Data Management
17	customers:view	View Customers	Data Management
18	customers:edit	Create/Edit Customers	Data Management
19	applications:view	View Vehicle Applications	Data Management
20	applications:edit	Create/Edit Vehicle Applications	Data Management
21	documents:view	View documents	Data Management
22	documents:download	Download documents	Data Management
23	documents:share	Share documents	Data Management
24	employees:view	View Employees	Administration
25	employees:edit	Create/Edit Employees	Administration
26	settings:view	View Settings	Administration
27	settings:edit	Edit Settings	Administration
28	reports:view	View Reports	Administration
29	data-utils:export	Export Data (CSV)	System Utilities
30	data-utils:import	Import Data (CSV)	System Utilities
31	backups:view	View & Download Backups	System Utilities
32	backups:create	Create On-Demand Backups	System Utilities
33	backups:restore	Restore from Backup	System Utilities
34	backups:delete	Delete Backups	System Utilities
53	goods_receipt:edit	Edit Goods Receipts	Inventory & Purchasing
55	parts:merge	Merge duplicate parts into a single canonical part	\N
\.


--
-- Data for Name: permission_level; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.permission_level (permission_level_id, level_name) FROM stdin;
1	Inventory Clerk
2	Parts Man
3	Purchaser
4	Cashier
5	Secretary
7	Manager
10	Admin
\.


--
-- Data for Name: purchase_order; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.purchase_order (po_id, po_number, supplier_id, employee_id, order_date, expected_date, total_amount, status, notes) FROM stdin;
1	PO-202509-0001	2	1	2025-09-06 13:28:55.901282+00	\N	630.00	Pending	Lorem Ipsum is simply dummy text of the printing and typesetting industry.
2	PO-202509-0002	2	1	2025-09-06 22:26:00.951528+00	\N	630.00	Pending	Lorem Ipsum is simply dummy text of the printing and typesetting industry.
3	PO-202509-0003	2	1	2025-09-07 14:48:24.592892+00	\N	0.00	Pending	
4	PO-202509-0004	2	1	2025-09-08 03:43:12.511254+00	\N	930.00	Pending	
5	PO-202509-0005	2	1	2025-09-08 03:44:38.578097+00	\N	100.00	Pending	Note
6	PO-202509-0006	2	1	2025-09-09 00:39:10.019697+00	\N	0.00	Pending	
\.


--
-- Data for Name: purchase_order_line; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.purchase_order_line (po_line_id, po_id, part_id, quantity, cost_price, quantity_received) FROM stdin;
3	1	478	1.0000	630.00	0.0000
4	1	3680	1.0000	0.00	0.0000
5	2	478	1.0000	630.00	0.0000
6	2	3680	1.0000	0.00	0.0000
7	3	3680	1.0000	0.00	0.0000
8	4	478	1.0000	630.00	0.0000
9	4	529	1.0000	300.00	0.0000
10	5	535	1.0000	100.00	0.0000
11	6	654	1.0000	0.00	0.0000
\.


--
-- Data for Name: role_permission; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.role_permission (permission_level_id, permission_id) FROM stdin;
1	6
1	7
1	11
1	12
1	13
1	14
1	15
1	16
1	18
1	19
1	20
2	2
2	6
3	1
3	2
3	4
3	5
3	6
3	7
3	8
3	9
3	10
3	11
3	12
3	13
3	14
3	15
3	16
3	17
3	18
3	19
3	20
3	28
7	1
7	2
7	3
7	4
7	5
7	6
7	7
7	8
7	9
7	10
7	11
7	12
7	13
7	14
7	15
7	16
7	17
7	18
7	19
7	20
7	24
7	25
7	28
7	30
7	31
5	1
5	2
5	3
5	4
5	5
5	6
5	7
5	8
5	9
5	10
5	11
5	12
5	13
5	14
5	15
5	16
5	17
5	18
5	19
5	20
5	24
5	25
5	28
5	29
5	30
5	32
4	1
4	2
4	3
4	4
4	5
4	6
4	7
4	8
4	9
4	10
4	11
4	12
4	13
4	14
4	15
4	16
4	17
4	18
4	19
4	20
4	24
4	25
4	28
4	29
4	30
7	21
7	22
7	23
3	53
4	53
5	53
7	53
10	1
10	2
10	3
10	4
10	5
10	6
10	7
10	8
10	9
10	10
10	11
10	12
10	13
10	14
10	15
10	16
10	17
10	18
10	19
10	20
10	21
10	22
10	23
10	24
10	25
10	26
10	27
10	28
10	29
10	30
10	31
10	32
10	33
10	34
10	53
10	55
\.


--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.schema_migrations (filename, checksum, applied_at, duration_ms) FROM stdin;
20250820_add_payment_terms_days_and_due_date.sql	7259ee7f3ff153236158577699842e7b931d5b7f6c3231e91e817755fa29e597	2025-09-09 22:42:35.465017+00	6
20250820_create_payment_term_table.sql	40a43dba96d3e92b6a37d0d58e08fd3f9a17810695def0b883ae9bb8f32beb32	2025-09-09 22:42:35.476651+00	6
20250821_add_documents_permissions.sql	f4a4d134104ce43bed0a63dd69a4fbd5d142b1590fa790f38170215996ad3991	2025-09-09 22:42:35.492298+00	11
20250910_update_wac_trigger_for_sale_price.sql	b62ba18e5d632f9653766de6f9df054deee0a6bd0c106d7b779bbec2c80485a8	2025-09-09 22:42:56.309881+00	17
document_metadata_v2.sql	5689718c91af378cfe15eadee7a0d91c3021bae849c56c52138892efa5fc96c9	2025-09-09 22:42:56.335601+00	3
20250912_add_parts_merge_columns.sql	d282e9cccdef959555bca2b26c1a1f1ce30667afe49165b5b962d3065978515d	2025-09-12 08:32:46.92874+00	38
20250912_add_parts_merge_permission.sql	4062bff6c2ff6e651b19b660b8503e002c2ffb7daadbaacc18d063a7e14f4904	2025-09-12 08:33:17.449732+00	13
20250912_create_part_aliases.sql	3b67182276317a49da0a8d0b898659c01487e6c48b9dae6441c8968180aea1be	2025-09-12 08:33:17.468573+00	40
20250912_create_part_merge_log.sql	30c64f25f1dc73db51bbaa098603c2fd7616a209bbad98b5d58b0c13d38cda5a	2025-09-12 08:33:17.512764+00	34
20250913_create_payment_methods_table.sql	f5b589dbaf12cdb531bdb09fb1ecf64fc97f5be680296d7b9a07353424014bf6	2025-09-13 01:31:53.022663+00	10
20250913_extend_payments_for_split_support.sql	b2e0e80d6cbfa78afa2ad79dba939965392a7bdef6e210c56de0e8e98ddb6659	2025-09-13 01:31:53.038097+00	26
\.


--
-- Data for Name: settings; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.settings (setting_key, setting_value, description) FROM stdin;
COMPANY_WEBSITE		\N
DEFAULT_CURRENCY_SYMBOL	₱	\N
DEFAULT_PAYMENT_TERMS	Due upon receipt	\N
INVOICE_FOOTER_MESSAGE	Thank you for your business!	\N
PAYMENT_METHODS	Cash,Credit Card,Bank Transfer,On Account	\N
DEFAULT_IS_TAX_INCLUSIVE	true	\N
PAYMENT_METHODS_HELP_TEXT	Configure available payment methods and their validation rules	Help text shown in Payment Methods settings
ENABLE_SPLIT_PAYMENTS	true	Enable split payment functionality and payment methods management
COMPANY_NAME	Forson Auto Parts Supply	\N
COMPANY_ADDRESS	Purok 3, Sayre Highway, Poblacion, Valencia City, Bukidnon	\N
COMPANY_PHONE	09679678012	\N
COMPANY_EMAIL	forsonautoparts@gmail.com	\N
\.


--
-- Data for Name: supplier; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.supplier (supplier_id, supplier_name, contact_person, phone, email, address, is_active, date_created, created_by, date_modified, modified_by) FROM stdin;
2	N/A					t	2025-09-06 13:27:44.834474+00	\N	\N	\N
3	MJS					t	2025-09-10 00:47:31.09819+00	\N	\N	\N
\.


--
-- Data for Name: tag; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.tag (tag_id, tag_name) FROM stdin;
1	test
2	nanana
3	old_new
\.


--
-- Data for Name: tax_rate; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.tax_rate (tax_rate_id, rate_name, rate_percentage, is_default) FROM stdin;
\.


--
-- Data for Name: vehicle_engine; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vehicle_engine (engine_id, model_id, engine_name) FROM stdin;
1	4	V8
\.


--
-- Data for Name: vehicle_make; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vehicle_make (make_id, make_name) FROM stdin;
6	Honda
7	Ford
2	Mitsubishi
1	Toyota
\.


--
-- Data for Name: vehicle_model; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vehicle_model (model_id, make_id, model_name) FROM stdin;
1	1	Tamaraw
2	2	Adventure
3	6	Civic
4	7	F-150
\.


--
-- Name: application_application_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.application_application_id_seq', 6, true);


--
-- Name: brand_brand_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.brand_brand_id_seq', 242, true);


--
-- Name: credit_note_cn_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.credit_note_cn_id_seq', 24, true);


--
-- Name: credit_note_line_cn_line_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.credit_note_line_cn_line_id_seq', 25, true);


--
-- Name: customer_customer_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.customer_customer_id_seq', 4, true);


--
-- Name: customer_payment_payment_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.customer_payment_payment_id_seq', 65, true);


--
-- Name: draft_transaction_draft_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.draft_transaction_draft_id_seq', 211, true);


--
-- Name: employee_employee_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.employee_employee_id_seq', 2, true);


--
-- Name: goods_receipt_grn_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.goods_receipt_grn_id_seq', 7, true);


--
-- Name: goods_receipt_line_grn_line_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.goods_receipt_line_grn_line_id_seq', 50, true);


--
-- Name: group_group_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.group_group_id_seq', 350, true);


--
-- Name: inventory_transaction_inv_trans_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.inventory_transaction_inv_trans_id_seq', 290, true);


--
-- Name: invoice_invoice_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.invoice_invoice_id_seq', 167, true);


--
-- Name: invoice_line_invoice_line_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.invoice_line_invoice_line_id_seq', 189, true);


--
-- Name: invoice_payment_allocation_allocation_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.invoice_payment_allocation_allocation_id_seq', 83, true);


--
-- Name: invoice_payments_payment_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.invoice_payments_payment_id_seq', 91, true);


--
-- Name: part_aliases_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.part_aliases_id_seq', 51, true);


--
-- Name: part_application_part_app_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.part_application_part_app_id_seq', 3, true);


--
-- Name: part_merge_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.part_merge_log_id_seq', 13, true);


--
-- Name: part_number_part_number_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.part_number_part_number_id_seq', 4147, true);


--
-- Name: part_part_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.part_part_id_seq', 3694, true);


--
-- Name: payment_methods_method_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.payment_methods_method_id_seq', 18, true);


--
-- Name: payment_term_payment_term_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.payment_term_payment_term_id_seq', 28, true);


--
-- Name: permission_level_permission_level_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.permission_level_permission_level_id_seq', 1, false);


--
-- Name: permission_permission_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.permission_permission_id_seq', 55, true);


--
-- Name: purchase_order_line_po_line_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.purchase_order_line_po_line_id_seq', 11, true);


--
-- Name: purchase_order_po_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.purchase_order_po_id_seq', 6, true);


--
-- Name: supplier_supplier_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.supplier_supplier_id_seq', 3, true);


--
-- Name: tag_tag_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.tag_tag_id_seq', 3, true);


--
-- Name: tax_rate_tax_rate_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.tax_rate_tax_rate_id_seq', 1, false);


--
-- Name: vehicle_engine_engine_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.vehicle_engine_engine_id_seq', 2, true);


--
-- Name: vehicle_make_make_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.vehicle_make_make_id_seq', 13, true);


--
-- Name: vehicle_model_model_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.vehicle_model_model_id_seq', 6, true);


--
-- Name: application application_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.application
    ADD CONSTRAINT application_pkey PRIMARY KEY (application_id);


--
-- Name: brand brand_brand_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.brand
    ADD CONSTRAINT brand_brand_code_key UNIQUE (brand_code);


--
-- Name: brand brand_brand_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.brand
    ADD CONSTRAINT brand_brand_name_key UNIQUE (brand_name);


--
-- Name: brand brand_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.brand
    ADD CONSTRAINT brand_pkey PRIMARY KEY (brand_id);


--
-- Name: credit_note credit_note_cn_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.credit_note
    ADD CONSTRAINT credit_note_cn_number_key UNIQUE (cn_number);


--
-- Name: credit_note_line credit_note_line_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.credit_note_line
    ADD CONSTRAINT credit_note_line_pkey PRIMARY KEY (cn_line_id);


--
-- Name: credit_note credit_note_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.credit_note
    ADD CONSTRAINT credit_note_pkey PRIMARY KEY (cn_id);


--
-- Name: customer customer_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer
    ADD CONSTRAINT customer_email_key UNIQUE (email);


--
-- Name: customer_payment customer_payment_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_payment
    ADD CONSTRAINT customer_payment_pkey PRIMARY KEY (payment_id);


--
-- Name: customer customer_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer
    ADD CONSTRAINT customer_pkey PRIMARY KEY (customer_id);


--
-- Name: customer_tag customer_tag_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_tag
    ADD CONSTRAINT customer_tag_pkey PRIMARY KEY (customer_id, tag_id);


--
-- Name: document_sequence document_sequence_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.document_sequence
    ADD CONSTRAINT document_sequence_pkey PRIMARY KEY (prefix, period);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: draft_transaction draft_transaction_employee_id_transaction_type_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.draft_transaction
    ADD CONSTRAINT draft_transaction_employee_id_transaction_type_key UNIQUE (employee_id, transaction_type);


--
-- Name: draft_transaction draft_transaction_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.draft_transaction
    ADD CONSTRAINT draft_transaction_pkey PRIMARY KEY (draft_id);


--
-- Name: employee employee_employee_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee
    ADD CONSTRAINT employee_employee_code_key UNIQUE (employee_code);


--
-- Name: employee employee_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee
    ADD CONSTRAINT employee_pkey PRIMARY KEY (employee_id);


--
-- Name: employee employee_username_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee
    ADD CONSTRAINT employee_username_key UNIQUE (username);


--
-- Name: goods_receipt goods_receipt_grn_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goods_receipt
    ADD CONSTRAINT goods_receipt_grn_number_key UNIQUE (grn_number);


--
-- Name: goods_receipt_line goods_receipt_line_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goods_receipt_line
    ADD CONSTRAINT goods_receipt_line_pkey PRIMARY KEY (grn_line_id);


--
-- Name: goods_receipt goods_receipt_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goods_receipt
    ADD CONSTRAINT goods_receipt_pkey PRIMARY KEY (grn_id);


--
-- Name: group group_group_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."group"
    ADD CONSTRAINT group_group_code_key UNIQUE (group_code);


--
-- Name: group group_group_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."group"
    ADD CONSTRAINT group_group_name_key UNIQUE (group_name);


--
-- Name: group group_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."group"
    ADD CONSTRAINT group_pkey PRIMARY KEY (group_id);


--
-- Name: inventory_transaction inventory_transaction_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_transaction
    ADD CONSTRAINT inventory_transaction_pkey PRIMARY KEY (inv_trans_id);


--
-- Name: invoice invoice_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice
    ADD CONSTRAINT invoice_invoice_number_key UNIQUE (invoice_number);


--
-- Name: invoice_line invoice_line_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_line
    ADD CONSTRAINT invoice_line_pkey PRIMARY KEY (invoice_line_id);


--
-- Name: invoice_payment_allocation invoice_payment_allocation_invoice_id_payment_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_payment_allocation
    ADD CONSTRAINT invoice_payment_allocation_invoice_id_payment_id_key UNIQUE (invoice_id, payment_id);


--
-- Name: invoice_payment_allocation invoice_payment_allocation_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_payment_allocation
    ADD CONSTRAINT invoice_payment_allocation_pkey PRIMARY KEY (allocation_id);


--
-- Name: invoice_payments invoice_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_payments
    ADD CONSTRAINT invoice_payments_pkey PRIMARY KEY (payment_id);


--
-- Name: invoice invoice_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice
    ADD CONSTRAINT invoice_pkey PRIMARY KEY (invoice_id);


--
-- Name: part_aliases part_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_aliases
    ADD CONSTRAINT part_aliases_pkey PRIMARY KEY (id);


--
-- Name: part_application part_application_part_id_application_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_application
    ADD CONSTRAINT part_application_part_id_application_id_key UNIQUE (part_id, application_id);


--
-- Name: part_application part_application_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_application
    ADD CONSTRAINT part_application_pkey PRIMARY KEY (part_app_id);


--
-- Name: part_merge_log part_merge_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_merge_log
    ADD CONSTRAINT part_merge_log_pkey PRIMARY KEY (id);


--
-- Name: part_number part_number_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_number
    ADD CONSTRAINT part_number_pkey PRIMARY KEY (part_number_id);


--
-- Name: part part_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part
    ADD CONSTRAINT part_pkey PRIMARY KEY (part_id);


--
-- Name: part_tag part_tag_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_tag
    ADD CONSTRAINT part_tag_pkey PRIMARY KEY (part_id, tag_id);


--
-- Name: payment_methods payment_methods_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_methods
    ADD CONSTRAINT payment_methods_code_key UNIQUE (code);


--
-- Name: payment_methods payment_methods_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_methods
    ADD CONSTRAINT payment_methods_pkey PRIMARY KEY (method_id);


--
-- Name: payment_term payment_term_days_to_due_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_term
    ADD CONSTRAINT payment_term_days_to_due_key UNIQUE (days_to_due);


--
-- Name: payment_term payment_term_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_term
    ADD CONSTRAINT payment_term_pkey PRIMARY KEY (payment_term_id);


--
-- Name: permission_level permission_level_level_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permission_level
    ADD CONSTRAINT permission_level_level_name_key UNIQUE (level_name);


--
-- Name: permission_level permission_level_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permission_level
    ADD CONSTRAINT permission_level_pkey PRIMARY KEY (permission_level_id);


--
-- Name: permission permission_permission_key_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permission
    ADD CONSTRAINT permission_permission_key_key UNIQUE (permission_key);


--
-- Name: permission permission_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permission
    ADD CONSTRAINT permission_pkey PRIMARY KEY (permission_id);


--
-- Name: purchase_order_line purchase_order_line_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_order_line
    ADD CONSTRAINT purchase_order_line_pkey PRIMARY KEY (po_line_id);


--
-- Name: purchase_order purchase_order_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_order
    ADD CONSTRAINT purchase_order_pkey PRIMARY KEY (po_id);


--
-- Name: purchase_order purchase_order_po_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_order
    ADD CONSTRAINT purchase_order_po_number_key UNIQUE (po_number);


--
-- Name: role_permission role_permission_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_permission
    ADD CONSTRAINT role_permission_pkey PRIMARY KEY (permission_level_id, permission_id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (filename);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (setting_key);


--
-- Name: supplier supplier_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.supplier
    ADD CONSTRAINT supplier_pkey PRIMARY KEY (supplier_id);


--
-- Name: supplier supplier_supplier_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.supplier
    ADD CONSTRAINT supplier_supplier_name_key UNIQUE (supplier_name);


--
-- Name: tag tag_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tag
    ADD CONSTRAINT tag_pkey PRIMARY KEY (tag_id);


--
-- Name: tag tag_tag_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tag
    ADD CONSTRAINT tag_tag_name_key UNIQUE (tag_name);


--
-- Name: tax_rate tax_rate_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tax_rate
    ADD CONSTRAINT tax_rate_pkey PRIMARY KEY (tax_rate_id);


--
-- Name: application unique_application_make_model_engine; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.application
    ADD CONSTRAINT unique_application_make_model_engine UNIQUE (make_id, model_id, engine_id);


--
-- Name: vehicle_engine vehicle_engine_engine_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_engine
    ADD CONSTRAINT vehicle_engine_engine_name_key UNIQUE (engine_name);


--
-- Name: vehicle_engine vehicle_engine_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_engine
    ADD CONSTRAINT vehicle_engine_pkey PRIMARY KEY (engine_id);


--
-- Name: vehicle_make vehicle_make_make_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_make
    ADD CONSTRAINT vehicle_make_make_name_key UNIQUE (make_name);


--
-- Name: vehicle_make vehicle_make_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_make
    ADD CONSTRAINT vehicle_make_pkey PRIMARY KEY (make_id);


--
-- Name: vehicle_model vehicle_model_make_id_model_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_model
    ADD CONSTRAINT vehicle_model_make_id_model_name_key UNIQUE (make_id, model_name);


--
-- Name: vehicle_model vehicle_model_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_model
    ADD CONSTRAINT vehicle_model_pkey PRIMARY KEY (model_id);


--
-- Name: idx_customer_payment_method_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_customer_payment_method_id ON public.customer_payment USING btree (method_id);


--
-- Name: idx_documents_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_documents_created_at ON public.documents USING btree (created_at);


--
-- Name: idx_documents_doc_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_documents_doc_type ON public.documents USING btree (document_type);


--
-- Name: idx_documents_metadata; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_documents_metadata ON public.documents USING gin (metadata jsonb_path_ops);


--
-- Name: idx_documents_reference_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_documents_reference_id ON public.documents USING btree (reference_id);


--
-- Name: idx_grn_line_grn_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_grn_line_grn_id ON public.goods_receipt_line USING btree (grn_id);


--
-- Name: idx_grn_line_part_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_grn_line_part_id ON public.goods_receipt_line USING btree (part_id);


--
-- Name: idx_inv_alloc_invoice_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inv_alloc_invoice_id ON public.invoice_payment_allocation USING btree (invoice_id);


--
-- Name: idx_inv_alloc_payment_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inv_alloc_payment_id ON public.invoice_payment_allocation USING btree (payment_id);


--
-- Name: idx_inv_tx_part_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inv_tx_part_date ON public.inventory_transaction USING btree (part_id, transaction_date);


--
-- Name: idx_inv_tx_part_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inv_tx_part_id ON public.inventory_transaction USING btree (part_id);


--
-- Name: idx_invoice_customer_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_invoice_customer_id ON public.invoice USING btree (customer_id);


--
-- Name: idx_invoice_employee_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_invoice_employee_id ON public.invoice USING btree (employee_id);


--
-- Name: idx_invoice_line_invoice_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_invoice_line_invoice_id ON public.invoice_line USING btree (invoice_id);


--
-- Name: idx_invoice_line_part_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_invoice_line_part_id ON public.invoice_line USING btree (part_id);


--
-- Name: idx_invoice_payments_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_invoice_payments_created_at ON public.invoice_payments USING btree (created_at);


--
-- Name: idx_invoice_payments_invoice_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_invoice_payments_invoice_id ON public.invoice_payments USING btree (invoice_id);


--
-- Name: idx_invoice_payments_method_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_invoice_payments_method_id ON public.invoice_payments USING btree (method_id);


--
-- Name: idx_invoice_payments_settled_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_invoice_payments_settled_at ON public.invoice_payments USING btree (settled_at);


--
-- Name: idx_invoice_payments_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_invoice_payments_status ON public.invoice_payments USING btree (payment_status);


--
-- Name: idx_invoice_physical_receipt_no_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_invoice_physical_receipt_no_unique ON public.invoice USING btree (lower((physical_receipt_no)::text)) WHERE ((physical_receipt_no IS NOT NULL) AND (length(TRIM(BOTH FROM physical_receipt_no)) > 0));


--
-- Name: idx_part_aliases_part_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_part_aliases_part_id ON public.part_aliases USING btree (part_id);


--
-- Name: idx_part_aliases_source_part; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_part_aliases_source_part ON public.part_aliases USING btree (source_part_id);


--
-- Name: idx_part_aliases_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_part_aliases_unique ON public.part_aliases USING btree (alias_value, alias_type);


--
-- Name: idx_part_aliases_value_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_part_aliases_value_type ON public.part_aliases USING btree (alias_value, alias_type);


--
-- Name: idx_part_application_application_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_part_application_application_id ON public.part_application USING btree (application_id);


--
-- Name: idx_part_application_part_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_part_application_part_id ON public.part_application USING btree (part_id);


--
-- Name: idx_part_brand_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_part_brand_id ON public.part USING btree (brand_id);


--
-- Name: idx_part_group_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_part_group_id ON public.part USING btree (group_id);


--
-- Name: idx_part_merge_log_actor; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_part_merge_log_actor ON public.part_merge_log USING btree (actor_employee_id);


--
-- Name: idx_part_merge_log_keep_part; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_part_merge_log_keep_part ON public.part_merge_log USING btree (keep_part_id);


--
-- Name: idx_part_merge_log_merged_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_part_merge_log_merged_at ON public.part_merge_log USING btree (merged_at);


--
-- Name: idx_part_merge_log_merged_part; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_part_merge_log_merged_part ON public.part_merge_log USING btree (merged_part_id);


--
-- Name: idx_part_merged_into; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_part_merged_into ON public.part USING btree (merged_into_part_id);


--
-- Name: idx_part_number_number; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_part_number_number ON public.part_number USING btree (part_number);


--
-- Name: idx_part_tax_rate_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_part_tax_rate_id ON public.part USING btree (tax_rate_id);


--
-- Name: idx_payment_methods_enabled_sort; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_payment_methods_enabled_sort ON public.payment_methods USING btree (enabled, sort_order);


--
-- Name: idx_payment_methods_settlement_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_payment_methods_settlement_type ON public.payment_methods USING btree (settlement_type);


--
-- Name: idx_payment_methods_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_payment_methods_type ON public.payment_methods USING btree (type);


--
-- Name: idx_po_employee_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_po_employee_id ON public.purchase_order USING btree (employee_id);


--
-- Name: idx_po_line_part_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_po_line_part_id ON public.purchase_order_line USING btree (part_id);


--
-- Name: idx_po_line_po_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_po_line_po_id ON public.purchase_order_line USING btree (po_id);


--
-- Name: idx_po_supplier_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_po_supplier_id ON public.purchase_order USING btree (supplier_id);


--
-- Name: idx_vehicle_engine_model_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicle_engine_model_id ON public.vehicle_engine USING btree (model_id);


--
-- Name: idx_vehicle_model_make_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicle_model_make_id ON public.vehicle_model USING btree (make_id);


--
-- Name: part_internal_sku_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX part_internal_sku_unique ON public.part USING btree (internal_sku) WHERE (merged_into_part_id IS NULL);


--
-- Name: ux_part_number_active_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ux_part_number_active_unique ON public.part_number USING btree (part_id, part_number) WHERE (deleted_at IS NULL);


--
-- Name: INDEX ux_part_number_active_unique; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON INDEX public.ux_part_number_active_unique IS 'Ensures active (non-deleted) aliases remain unique per part';


--
-- Name: application application_meili_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER application_meili_notify AFTER INSERT OR DELETE OR UPDATE ON public.application FOR EACH ROW EXECUTE FUNCTION public.trg_application_notify();


--
-- Name: brand brand_meili_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER brand_meili_notify AFTER UPDATE OF brand_name ON public.brand FOR EACH ROW EXECUTE FUNCTION public.trg_brand_notify();


--
-- Name: credit_note credit_note_update_invoice_status_delete; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER credit_note_update_invoice_status_delete AFTER DELETE ON public.credit_note FOR EACH ROW EXECUTE FUNCTION public.update_invoice_balance_after_payment();


--
-- Name: credit_note credit_note_update_invoice_status_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER credit_note_update_invoice_status_insert AFTER INSERT ON public.credit_note FOR EACH ROW EXECUTE FUNCTION public.update_invoice_balance_after_payment();


--
-- Name: credit_note credit_note_update_invoice_status_update; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER credit_note_update_invoice_status_update AFTER UPDATE ON public.credit_note FOR EACH ROW EXECUTE FUNCTION public.update_invoice_balance_after_payment();


--
-- Name: customer_payment customer_payment_deprecation_warning; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER customer_payment_deprecation_warning BEFORE INSERT ON public.customer_payment FOR EACH ROW EXECUTE FUNCTION public.prevent_customer_payment_direct_insert();


--
-- Name: group group_meili_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER group_meili_notify AFTER UPDATE OF group_name ON public."group" FOR EACH ROW EXECUTE FUNCTION public.trg_group_notify();


--
-- Name: invoice_payments invoice_payments_update_balance_delete; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER invoice_payments_update_balance_delete AFTER DELETE ON public.invoice_payments FOR EACH ROW EXECUTE FUNCTION public.update_invoice_balance_after_payment();


--
-- Name: invoice_payments invoice_payments_update_balance_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER invoice_payments_update_balance_insert AFTER INSERT ON public.invoice_payments FOR EACH ROW EXECUTE FUNCTION public.update_invoice_balance_after_payment();


--
-- Name: invoice_payments invoice_payments_update_balance_update; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER invoice_payments_update_balance_update AFTER UPDATE ON public.invoice_payments FOR EACH ROW EXECUTE FUNCTION public.update_invoice_balance_after_payment();


--
-- Name: invoice_payments invoice_payments_validate; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER invoice_payments_validate BEFORE INSERT OR UPDATE ON public.invoice_payments FOR EACH ROW EXECUTE FUNCTION public.validate_invoice_payment_trigger();


--
-- Name: part_application part_application_meili_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER part_application_meili_notify AFTER INSERT OR DELETE OR UPDATE ON public.part_application FOR EACH ROW EXECUTE FUNCTION public.trg_part_application_notify();


--
-- Name: part part_meili_sync_trigger; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER part_meili_sync_trigger AFTER INSERT OR DELETE OR UPDATE ON public.part FOR EACH ROW EXECUTE FUNCTION public.notify_meili_sync();


--
-- Name: part_number part_number_meili_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER part_number_meili_notify AFTER INSERT OR DELETE OR UPDATE ON public.part_number FOR EACH ROW EXECUTE FUNCTION public.trg_part_number_notify();


--
-- Name: part_tag part_tag_meili_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER part_tag_meili_notify AFTER INSERT OR DELETE ON public.part_tag FOR EACH ROW EXECUTE FUNCTION public.trg_part_tag_notify();


--
-- Name: tag tag_meili_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER tag_meili_notify AFTER UPDATE OF tag_name ON public.tag FOR EACH ROW EXECUTE FUNCTION public.trg_tag_notify();


--
-- Name: inventory_transaction trg_update_wac; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_update_wac AFTER INSERT ON public.inventory_transaction FOR EACH ROW WHEN (((new.trans_type)::text = 'StockIn'::text)) EXECUTE FUNCTION public.update_wac_on_inventory_transaction();


--
-- Name: application application_engine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.application
    ADD CONSTRAINT application_engine_id_fkey FOREIGN KEY (engine_id) REFERENCES public.vehicle_engine(engine_id) ON DELETE SET NULL;


--
-- Name: application application_make_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.application
    ADD CONSTRAINT application_make_id_fkey FOREIGN KEY (make_id) REFERENCES public.vehicle_make(make_id) ON DELETE SET NULL;


--
-- Name: application application_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.application
    ADD CONSTRAINT application_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.vehicle_model(model_id) ON DELETE SET NULL;


--
-- Name: credit_note credit_note_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.credit_note
    ADD CONSTRAINT credit_note_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employee(employee_id) ON DELETE RESTRICT;


--
-- Name: credit_note credit_note_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.credit_note
    ADD CONSTRAINT credit_note_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoice(invoice_id) ON DELETE RESTRICT;


--
-- Name: credit_note_line credit_note_line_cn_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.credit_note_line
    ADD CONSTRAINT credit_note_line_cn_id_fkey FOREIGN KEY (cn_id) REFERENCES public.credit_note(cn_id) ON DELETE CASCADE;


--
-- Name: credit_note_line credit_note_line_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.credit_note_line
    ADD CONSTRAINT credit_note_line_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.part(part_id) ON DELETE RESTRICT;


--
-- Name: customer_payment customer_payment_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_payment
    ADD CONSTRAINT customer_payment_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customer(customer_id) ON DELETE RESTRICT;


--
-- Name: customer_payment customer_payment_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_payment
    ADD CONSTRAINT customer_payment_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employee(employee_id) ON DELETE RESTRICT;


--
-- Name: customer_payment customer_payment_method_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_payment
    ADD CONSTRAINT customer_payment_method_id_fkey FOREIGN KEY (method_id) REFERENCES public.payment_methods(method_id) ON DELETE SET NULL;


--
-- Name: customer_tag customer_tag_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_tag
    ADD CONSTRAINT customer_tag_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customer(customer_id) ON DELETE CASCADE;


--
-- Name: customer_tag customer_tag_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_tag
    ADD CONSTRAINT customer_tag_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tag(tag_id) ON DELETE CASCADE;


--
-- Name: draft_transaction draft_transaction_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.draft_transaction
    ADD CONSTRAINT draft_transaction_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employee(employee_id) ON DELETE CASCADE;


--
-- Name: employee employee_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee
    ADD CONSTRAINT employee_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.employee(employee_id) ON DELETE SET NULL;


--
-- Name: employee employee_permission_level_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee
    ADD CONSTRAINT employee_permission_level_id_fkey FOREIGN KEY (permission_level_id) REFERENCES public.permission_level(permission_level_id) ON DELETE RESTRICT;


--
-- Name: goods_receipt_line goods_receipt_line_grn_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goods_receipt_line
    ADD CONSTRAINT goods_receipt_line_grn_id_fkey FOREIGN KEY (grn_id) REFERENCES public.goods_receipt(grn_id) ON DELETE CASCADE;


--
-- Name: goods_receipt_line goods_receipt_line_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goods_receipt_line
    ADD CONSTRAINT goods_receipt_line_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.part(part_id) ON DELETE RESTRICT;


--
-- Name: goods_receipt goods_receipt_received_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goods_receipt
    ADD CONSTRAINT goods_receipt_received_by_fkey FOREIGN KEY (received_by) REFERENCES public.employee(employee_id) ON DELETE RESTRICT;


--
-- Name: goods_receipt goods_receipt_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goods_receipt
    ADD CONSTRAINT goods_receipt_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.supplier(supplier_id) ON DELETE RESTRICT;


--
-- Name: inventory_transaction inventory_transaction_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_transaction
    ADD CONSTRAINT inventory_transaction_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employee(employee_id) ON DELETE SET NULL;


--
-- Name: inventory_transaction inventory_transaction_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_transaction
    ADD CONSTRAINT inventory_transaction_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.part(part_id) ON DELETE RESTRICT;


--
-- Name: invoice invoice_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice
    ADD CONSTRAINT invoice_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customer(customer_id) ON DELETE RESTRICT;


--
-- Name: invoice invoice_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice
    ADD CONSTRAINT invoice_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employee(employee_id) ON DELETE RESTRICT;


--
-- Name: invoice_line invoice_line_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_line
    ADD CONSTRAINT invoice_line_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoice(invoice_id) ON DELETE CASCADE;


--
-- Name: invoice_line invoice_line_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_line
    ADD CONSTRAINT invoice_line_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.part(part_id) ON DELETE RESTRICT;


--
-- Name: invoice_payment_allocation invoice_payment_allocation_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_payment_allocation
    ADD CONSTRAINT invoice_payment_allocation_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoice(invoice_id) ON DELETE CASCADE;


--
-- Name: invoice_payment_allocation invoice_payment_allocation_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_payment_allocation
    ADD CONSTRAINT invoice_payment_allocation_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.customer_payment(payment_id) ON DELETE CASCADE;


--
-- Name: invoice_payments invoice_payments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_payments
    ADD CONSTRAINT invoice_payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.employee(employee_id) ON DELETE SET NULL;


--
-- Name: invoice_payments invoice_payments_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_payments
    ADD CONSTRAINT invoice_payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoice(invoice_id) ON DELETE CASCADE;


--
-- Name: invoice_payments invoice_payments_method_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_payments
    ADD CONSTRAINT invoice_payments_method_id_fkey FOREIGN KEY (method_id) REFERENCES public.payment_methods(method_id) ON DELETE RESTRICT;


--
-- Name: part_aliases part_aliases_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_aliases
    ADD CONSTRAINT part_aliases_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.part(part_id) ON DELETE CASCADE;


--
-- Name: part_aliases part_aliases_source_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_aliases
    ADD CONSTRAINT part_aliases_source_part_id_fkey FOREIGN KEY (source_part_id) REFERENCES public.part(part_id);


--
-- Name: part_application part_application_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_application
    ADD CONSTRAINT part_application_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.application(application_id) ON DELETE CASCADE;


--
-- Name: part_application part_application_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_application
    ADD CONSTRAINT part_application_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.part(part_id) ON DELETE CASCADE;


--
-- Name: part part_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part
    ADD CONSTRAINT part_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brand(brand_id) ON DELETE RESTRICT;


--
-- Name: part part_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part
    ADD CONSTRAINT part_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.employee(employee_id) ON DELETE SET NULL;


--
-- Name: part part_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part
    ADD CONSTRAINT part_group_id_fkey FOREIGN KEY (group_id) REFERENCES public."group"(group_id) ON DELETE RESTRICT;


--
-- Name: part_merge_log part_merge_log_actor_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_merge_log
    ADD CONSTRAINT part_merge_log_actor_employee_id_fkey FOREIGN KEY (actor_employee_id) REFERENCES public.employee(employee_id);


--
-- Name: part_merge_log part_merge_log_keep_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_merge_log
    ADD CONSTRAINT part_merge_log_keep_part_id_fkey FOREIGN KEY (keep_part_id) REFERENCES public.part(part_id);


--
-- Name: part_merge_log part_merge_log_merged_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_merge_log
    ADD CONSTRAINT part_merge_log_merged_part_id_fkey FOREIGN KEY (merged_part_id) REFERENCES public.part(part_id);


--
-- Name: part part_merged_into_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part
    ADD CONSTRAINT part_merged_into_part_id_fkey FOREIGN KEY (merged_into_part_id) REFERENCES public.part(part_id);


--
-- Name: part part_modified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part
    ADD CONSTRAINT part_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES public.employee(employee_id) ON DELETE SET NULL;


--
-- Name: part_number part_number_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_number
    ADD CONSTRAINT part_number_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.employee(employee_id) ON DELETE SET NULL;


--
-- Name: part_number part_number_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_number
    ADD CONSTRAINT part_number_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.part(part_id) ON DELETE CASCADE;


--
-- Name: part_tag part_tag_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_tag
    ADD CONSTRAINT part_tag_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.part(part_id) ON DELETE CASCADE;


--
-- Name: part_tag part_tag_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_tag
    ADD CONSTRAINT part_tag_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tag(tag_id) ON DELETE CASCADE;


--
-- Name: part part_tax_rate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part
    ADD CONSTRAINT part_tax_rate_id_fkey FOREIGN KEY (tax_rate_id) REFERENCES public.tax_rate(tax_rate_id) ON DELETE SET NULL;


--
-- Name: payment_methods payment_methods_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_methods
    ADD CONSTRAINT payment_methods_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.employee(employee_id) ON DELETE SET NULL;


--
-- Name: payment_methods payment_methods_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_methods
    ADD CONSTRAINT payment_methods_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.employee(employee_id) ON DELETE SET NULL;


--
-- Name: purchase_order purchase_order_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_order
    ADD CONSTRAINT purchase_order_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employee(employee_id) ON DELETE RESTRICT;


--
-- Name: purchase_order_line purchase_order_line_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_order_line
    ADD CONSTRAINT purchase_order_line_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.part(part_id) ON DELETE RESTRICT;


--
-- Name: purchase_order_line purchase_order_line_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_order_line
    ADD CONSTRAINT purchase_order_line_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_order(po_id) ON DELETE CASCADE;


--
-- Name: purchase_order purchase_order_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_order
    ADD CONSTRAINT purchase_order_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.supplier(supplier_id) ON DELETE RESTRICT;


--
-- Name: role_permission role_permission_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_permission
    ADD CONSTRAINT role_permission_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permission(permission_id) ON DELETE CASCADE;


--
-- Name: role_permission role_permission_permission_level_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_permission
    ADD CONSTRAINT role_permission_permission_level_id_fkey FOREIGN KEY (permission_level_id) REFERENCES public.permission_level(permission_level_id) ON DELETE CASCADE;


--
-- Name: supplier supplier_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.supplier
    ADD CONSTRAINT supplier_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.employee(employee_id) ON DELETE SET NULL;


--
-- Name: supplier supplier_modified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.supplier
    ADD CONSTRAINT supplier_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES public.employee(employee_id) ON DELETE SET NULL;


--
-- Name: vehicle_engine vehicle_engine_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_engine
    ADD CONSTRAINT vehicle_engine_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.vehicle_model(model_id) ON DELETE CASCADE;


--
-- Name: vehicle_model vehicle_model_make_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_model
    ADD CONSTRAINT vehicle_model_make_id_fkey FOREIGN KEY (make_id) REFERENCES public.vehicle_make(make_id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

