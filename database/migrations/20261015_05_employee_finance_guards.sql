BEGIN;
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
  IF NEW.status='CONFIRMED' AND NOT EXISTS(SELECT 1 FROM employee_finance_funding f JOIN payroll_payout p ON p.payout_id=NEW.payout_id WHERE f.funding_id=NEW.funding_id AND f.amount=p.amount AND f.direction='OUT' AND f.method=p.method) THEN
   RAISE EXCEPTION 'Payout funding mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT p.run_id,p.employee_id INTO run_key,employee_key FROM payroll_payslip p WHERE p.payslip_id=NEW.payslip_id;
 SELECT status INTO run_state FROM payroll_run WHERE run_id=run_key FOR UPDATE;
 IF run_state NOT IN ('Approved','Paid','Posted') OR run_state IS NULL THEN RAISE EXCEPTION 'Only approved wage entitlement may settle' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='employee_settlement' THEN
  IF employee_key<>NEW.employee_id THEN RAISE EXCEPTION 'Settlement employee mismatch' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='payroll_payout_allocation' THEN
  IF EXISTS(SELECT 1 FROM payroll_payout_current WHERE payout_id=NEW.payout_id AND status NOT IN ('PENDING','UNKNOWN')) THEN RAISE EXCEPTION 'Payout allocations are frozen after final outcome' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM employee_settlement WHERE payslip_id=NEW.payslip_id) THEN RAISE EXCEPTION 'Execute noncash settlement before payout' USING ERRCODE='23514'; END IF;
  IF NEW.amount+COALESCE((SELECT SUM(amount) FROM payroll_payout_allocation WHERE payout_id=NEW.payout_id),0)>(SELECT amount FROM payroll_payout WHERE payout_id=NEW.payout_id) THEN RAISE EXCEPTION 'Allocations exceed payout total' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM payroll_payout WHERE payout_id=NEW.payout_id AND employee_id=employee_key) THEN RAISE EXCEPTION 'Payout employee mismatch' USING ERRCODE='23514'; END IF;
  SELECT net_pay+correction_amount+rounding_amount-legacy_asserted_paid,actual_paid,pending_amount INTO entitlement,already,pending FROM payroll_employee_payable WHERE payslip_id=NEW.payslip_id;
  IF already+pending+NEW.amount>entitlement THEN RAISE EXCEPTION 'Payout allocation exceeds unpaid wages' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION employee_recovery_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l employee_loan%ROWTYPE; original employee_loan_payment%ROWTYPE;
BEGIN
 SELECT * INTO l FROM employee_loan WHERE loan_id=NEW.loan_id FOR UPDATE;
 IF NEW.reversal_of IS NOT NULL THEN
  SELECT * INTO original FROM employee_loan_payment WHERE payment_id=NEW.reversal_of;
  IF original.payment_id IS NULL OR original.loan_id<>NEW.loan_id OR original.amount<>NEW.amount OR original.reversal_of IS NOT NULL OR NEW.reason IS NULL THEN
   RAISE EXCEPTION 'Invalid linked loan reversal' USING ERRCODE='23514';
  END IF;
  IF original.payslip_id IS NOT NULL AND EXISTS(SELECT 1 FROM loan_remittance_allocation a WHERE a.payment_id=original.payment_id AND a.amount>COALESCE((SELECT SUM(amount) FROM loan_remittance_correction c WHERE c.remittance_allocation_id=a.remittance_allocation_id),0)) THEN RAISE EXCEPTION 'Correct remittance before reversing recovery' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.payslip_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payroll_deduction_allocation a JOIN payroll_payslip p USING(payslip_id) JOIN payroll_run r USING(run_id) WHERE a.allocation_id=NEW.allocation_id AND a.loan_id=NEW.loan_id AND a.payslip_id=NEW.payslip_id AND a.status='RESERVED' AND a.approved_amount=NEW.amount AND r.status='Approved') THEN RAISE EXCEPTION 'Payroll recovery must match its exact approved allocation' USING ERRCODE='23514'; END IF;
  IF NEW.amount>l.principal_amount-l.amount_paid THEN RAISE EXCEPTION 'Recovery exceeds outstanding debt' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.payslip_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payroll_payslip WHERE payslip_id=NEW.payslip_id AND employee_id=l.employee_id) THEN
  RAISE EXCEPTION 'Loan and payslip belong to different employees' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

ALTER TABLE payroll_deduction_allocation DROP CONSTRAINT IF EXISTS payroll_deduction_allocation_scheduled_amount_check;
ALTER TABLE payroll_deduction_allocation ADD CONSTRAINT payroll_deduction_allocation_scheduled_amount_check CHECK(scheduled_amount>=0);
ALTER TABLE payroll_deduction_allocation ADD COLUMN IF NOT EXISTS base_scheduled_amount numeric(12,2) CHECK(base_scheduled_amount>=0);
ALTER TABLE payroll_deduction_allocation DISABLE TRIGGER payroll_allocation_guard;
UPDATE payroll_deduction_allocation SET base_scheduled_amount=scheduled_amount WHERE base_scheduled_amount IS NULL;
ALTER TABLE payroll_deduction_allocation ENABLE TRIGGER payroll_allocation_guard;
CREATE OR REPLACE FUNCTION employee_allocation_freeze_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run_state text;
BEGIN
 SELECT r.status INTO run_state FROM payroll_payslip p JOIN payroll_run r USING(run_id) WHERE p.payslip_id=COALESCE(NEW.payslip_id,OLD.payslip_id) FOR UPDATE OF r;
 IF TG_OP='DELETE' THEN
  IF OLD.status<>'PROPOSED' OR run_state NOT IN ('Draft','Computed') THEN RAISE EXCEPTION 'Allocation history cannot be deleted' USING ERRCODE='23514'; END IF; RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND OLD.status='RESERVED' AND (NEW.status NOT IN ('RECOVERED','RELEASED') OR (NEW.approved_amount,NEW.scheduled_amount,NEW.schedule_id,NEW.schedule_version,NEW.line_id,NEW.supplemental_authorization) IS DISTINCT FROM (OLD.approved_amount,OLD.scheduled_amount,OLD.schedule_id,OLD.schedule_version,OLD.line_id,OLD.supplemental_authorization)) THEN RAISE EXCEPTION 'Approved recovery terms are frozen' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND run_state NOT IN ('Draft','Computed') THEN RAISE EXCEPTION 'Approved allocations cannot be inserted' USING ERRCODE='23514'; END IF;
 IF NEW.status='RESERVED' AND NOT EXISTS(SELECT 1 FROM employee_loan WHERE loan_id=NEW.loan_id AND status='Active' AND activation_state<>'DRAFT') THEN RAISE EXCEPTION 'Held/draft obligations require recompute before approval' USING ERRCODE='23514'; END IF;
 IF NEW.line_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payroll_payslip_line WHERE line_id=NEW.line_id AND payslip_id=NEW.payslip_id) THEN RAISE EXCEPTION 'Allocation line ownership mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS employee_allocation_freeze_trigger ON payroll_deduction_allocation;
CREATE TRIGGER employee_allocation_freeze_trigger BEFORE INSERT OR UPDATE OR DELETE ON payroll_deduction_allocation FOR EACH ROW EXECUTE FUNCTION employee_allocation_freeze_guard();
CREATE OR REPLACE FUNCTION employee_payslip_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE state text;
BEGIN
 SELECT r.status INTO state FROM payroll_run r JOIN payroll_payslip p USING(run_id) WHERE p.payslip_id=COALESCE(NEW.payslip_id,OLD.payslip_id) FOR UPDATE OF r;
 IF state IS NOT NULL AND state NOT IN ('Draft','Computed') THEN RAISE EXCEPTION 'Approved payslip lines are immutable' USING ERRCODE='23514'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS employee_payslip_line_guard_trigger ON payroll_payslip_line;
CREATE TRIGGER employee_payslip_line_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON payroll_payslip_line FOR EACH ROW EXECUTE FUNCTION employee_payslip_line_guard();
CREATE OR REPLACE FUNCTION employee_run_financial_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='Approved' AND EXISTS(SELECT 1 FROM payroll_payslip p WHERE p.run_id=NEW.run_id AND p.loans_total<>(SELECT COALESCE(SUM(a.approved_amount),0) FROM payroll_deduction_allocation a WHERE a.payslip_id=p.payslip_id AND a.status='RESERVED')) THEN
 RAISE EXCEPTION 'Reserve the exact payroll loan allocations before approval' USING ERRCODE='23514'; END IF;
 IF NEW.status='Paid' AND EXISTS(SELECT 1 FROM payroll_employee_payable WHERE run_id=NEW.run_id AND (settlement_id IS NULL OR net_pay+correction_amount+rounding_amount-actual_paid-legacy_asserted_paid<>0 OR pending_amount<>0)) THEN
 RAISE EXCEPTION 'Employee settlements remain incomplete' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS employee_run_financial_guard_trigger ON payroll_run;
CREATE TRIGGER employee_run_financial_guard_trigger BEFORE UPDATE OF status ON payroll_run FOR EACH ROW EXECUTE FUNCTION employee_run_financial_guard();
CREATE OR REPLACE FUNCTION employee_payslip_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE state text;
BEGIN
 SELECT status INTO state FROM payroll_run WHERE run_id=NEW.run_id FOR UPDATE;
 IF state NOT IN ('Draft','Computed') THEN RAISE EXCEPTION 'Approved payslip set is frozen' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS employee_payslip_insert_guard_trigger ON payroll_payslip;
CREATE TRIGGER employee_payslip_insert_guard_trigger BEFORE INSERT ON payroll_payslip FOR EACH ROW EXECUTE FUNCTION employee_payslip_insert_guard();
DROP TRIGGER IF EXISTS payroll_history_delete_guard ON payroll_run;
CREATE TRIGGER payroll_history_delete_guard BEFORE DELETE ON payroll_run FOR EACH ROW EXECUTE FUNCTION employee_finance_immutable();
COMMIT;
