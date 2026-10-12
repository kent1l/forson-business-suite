BEGIN;

-- Preserve ordinary edits to sources that have no cash custody link.
CREATE OR REPLACE FUNCTION cash_linked_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source_id bigint;
  linked boolean;
BEGIN
  IF TG_TABLE_NAME = 'expense' THEN source_id := OLD.expense_id;
  ELSE source_id := OLD.payment_id;
  END IF;
  IF TG_TABLE_NAME = 'expense' THEN
    SELECT EXISTS(SELECT 1 FROM cash_drawer_movement WHERE expense_id=source_id)
        OR EXISTS(SELECT 1 FROM cash_advance_event WHERE expense_id=source_id) INTO linked;
  ELSIF TG_TABLE_NAME = 'ap_payment' THEN
    SELECT EXISTS(SELECT 1 FROM cash_drawer_movement WHERE ap_payment_id=source_id)
        OR EXISTS(SELECT 1 FROM cash_advance_event WHERE ap_payment_id=source_id) INTO linked;
  ELSIF TG_TABLE_NAME = 'invoice_payments' THEN
    SELECT EXISTS(SELECT 1 FROM cash_drawer_movement WHERE invoice_payment_id=source_id)
        OR EXISTS(SELECT 1 FROM cash_source_link WHERE invoice_payment_id=source_id) INTO linked;
  ELSIF TG_TABLE_NAME = 'customer_payment' THEN
    SELECT EXISTS(SELECT 1 FROM cash_drawer_movement WHERE customer_payment_id=source_id)
        OR EXISTS(SELECT 1 FROM cash_source_link WHERE customer_payment_id=source_id) INTO linked;
  END IF;
  IF linked THEN RAISE EXCEPTION 'Cash-linked source is immutable; use an audited correction' USING ERRCODE='23514'; END IF;
  IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
  RETURN OLD;
END;
$$;

COMMIT;
