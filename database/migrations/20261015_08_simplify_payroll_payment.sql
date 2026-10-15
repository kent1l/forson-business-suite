BEGIN;
-- NULL method means the payroll operator asserted exact payment; no bank/cash
-- movement is inferred. Existing funded payouts retain their validation.
ALTER TABLE expense ALTER COLUMN payment_method_text DROP NOT NULL;
ALTER TABLE expense DROP CONSTRAINT IF EXISTS expense_payment_method_required;
ALTER TABLE expense ADD CONSTRAINT expense_payment_method_required
 CHECK(payment_method_text IS NOT NULL OR payroll_run_id IS NOT NULL);
ALTER TABLE payroll_payout ALTER COLUMN method DROP NOT NULL;
ALTER TABLE payroll_payout_event DROP CONSTRAINT IF EXISTS payroll_payout_event_check;
ALTER TABLE payroll_payout_event DROP CONSTRAINT IF EXISTS payroll_payout_event_funding_status;
ALTER TABLE payroll_payout_event ADD CONSTRAINT payroll_payout_event_funding_status
 CHECK(status='CONFIRMED' OR funding_id IS NULL);
CREATE OR REPLACE FUNCTION payroll_financial_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run_key bigint; run_state text; employee_key integer; entitlement numeric; already numeric; pending numeric; previous text;
BEGIN
 IF TG_TABLE_NAME='payroll_payout_event' THEN
  PERFORM 1 FROM payroll_run WHERE run_id IN(SELECT p.run_id FROM payroll_payslip p JOIN payroll_payout_allocation a USING(payslip_id) WHERE a.payout_id=NEW.payout_id) ORDER BY run_id FOR UPDATE;
  PERFORM 1 FROM payroll_payout WHERE payout_id=NEW.payout_id FOR UPDATE;
  SELECT status INTO previous FROM payroll_payout_event WHERE payout_id=NEW.payout_id ORDER BY event_id DESC LIMIT 1;
  IF previous IN ('CONFIRMED','FAILED','CANCELLED','REVERSED') THEN RAISE EXCEPTION 'Payout outcome is final; use a source-specific correction' USING ERRCODE='23514'; END IF;
  IF NEW.status='REVERSED' THEN RAISE EXCEPTION 'A payout reversal requires independently verified returned funds' USING ERRCODE='23514'; END IF;
  IF NEW.status='CONFIRMED' AND (SELECT COALESCE(SUM(amount),0) FROM payroll_payout_allocation WHERE payout_id=NEW.payout_id)<>(SELECT amount FROM payroll_payout WHERE payout_id=NEW.payout_id) THEN RAISE EXCEPTION 'Payout allocation total mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.status='CONFIRMED' AND (SELECT method FROM payroll_payout WHERE payout_id=NEW.payout_id) IS NOT NULL AND NOT EXISTS(SELECT 1 FROM employee_finance_funding f JOIN payroll_payout p ON p.payout_id=NEW.payout_id WHERE f.funding_id=NEW.funding_id AND f.amount=p.amount AND f.direction='OUT' AND f.method=p.method) THEN
   RAISE EXCEPTION 'Payout funding mismatch' USING ERRCODE='23514'; END IF;
  IF (SELECT method FROM payroll_payout WHERE payout_id=NEW.payout_id) IS NULL AND (NEW.status<>'CONFIRMED' OR NEW.funding_id IS NOT NULL) THEN
   RAISE EXCEPTION 'Untracked payroll payments must confirm the exact amount without funding' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT p.run_id,p.employee_id INTO run_key,employee_key FROM payroll_payslip p WHERE p.payslip_id=NEW.payslip_id;
 SELECT status INTO run_state FROM payroll_run WHERE run_id=run_key FOR UPDATE;
 IF run_state NOT IN ('Approved','Paid','Posted') OR run_state IS NULL THEN RAISE EXCEPTION 'Only approved wage entitlement may settle' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='employee_settlement' THEN
  IF employee_key<>NEW.employee_id THEN RAISE EXCEPTION 'Settlement employee mismatch' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='payroll_payout_allocation' THEN
  IF EXISTS(SELECT 1 FROM payroll_payout_current WHERE payout_id=NEW.payout_id AND status NOT IN ('PENDING','UNKNOWN')) THEN RAISE EXCEPTION 'Payout allocations are frozen after final outcome' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM employee_settlement WHERE payslip_id=NEW.payslip_id) AND NOT EXISTS(SELECT 1 FROM payroll_legacy_settlement WHERE payslip_id=NEW.payslip_id) THEN RAISE EXCEPTION 'Execute noncash settlement before payout' USING ERRCODE='23514'; END IF;
  IF NEW.amount+COALESCE((SELECT SUM(amount) FROM payroll_payout_allocation WHERE payout_id=NEW.payout_id),0)>(SELECT amount FROM payroll_payout WHERE payout_id=NEW.payout_id) THEN RAISE EXCEPTION 'Allocations exceed payout total' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM payroll_payout WHERE payout_id=NEW.payout_id AND employee_id=employee_key) THEN RAISE EXCEPTION 'Payout employee mismatch' USING ERRCODE='23514'; END IF;
  SELECT net_pay+correction_amount+rounding_amount-legacy_asserted_paid,actual_paid,pending_amount INTO entitlement,already,pending FROM payroll_employee_payable WHERE payslip_id=NEW.payslip_id;
  IF already+pending+NEW.amount>entitlement THEN RAISE EXCEPTION 'Payout allocation exceeds unpaid wages' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
COMMIT;
