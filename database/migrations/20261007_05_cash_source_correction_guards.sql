BEGIN;

-- Once a source has funded or explained physical cash, its original payment
-- details remain evidence. Corrections belong in the linked cash workflow.
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
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS cash_linked_source_guard ON expense;
CREATE TRIGGER cash_linked_source_guard BEFORE UPDATE OR DELETE ON expense
  FOR EACH ROW EXECUTE FUNCTION cash_linked_source_guard();
DROP TRIGGER IF EXISTS cash_linked_source_guard ON ap_payment;
CREATE TRIGGER cash_linked_source_guard BEFORE UPDATE OR DELETE ON ap_payment
  FOR EACH ROW EXECUTE FUNCTION cash_linked_source_guard();
DROP TRIGGER IF EXISTS cash_linked_source_guard ON invoice_payments;
CREATE TRIGGER cash_linked_source_guard BEFORE UPDATE OR DELETE ON invoice_payments
  FOR EACH ROW EXECUTE FUNCTION cash_linked_source_guard();
DROP TRIGGER IF EXISTS cash_linked_source_guard ON customer_payment;
CREATE TRIGGER cash_linked_source_guard BEFORE UPDATE OR DELETE ON customer_payment
  FOR EACH ROW EXECUTE FUNCTION cash_linked_source_guard();

COMMIT;
