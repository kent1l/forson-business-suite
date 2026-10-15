BEGIN;
CREATE OR REPLACE FUNCTION employee_run_entitlement_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='Voided' AND EXISTS(SELECT 1 FROM expense WHERE payroll_run_id=OLD.run_id AND NOT is_void) THEN RAISE EXCEPTION 'Expense recognition blocks ordinary payroll cancellation' USING ERRCODE='23514'; END IF;
 IF OLD.status IN ('Approved','Paid','Posted','Voided') AND
 (NEW.run_type,NEW.pay_period_id,NEW.period_start,NEW.period_end,NEW.pay_date,NEW.department_id,NEW.employee_count,NEW.total_gross,NEW.total_deductions,NEW.total_net,NEW.total_employer_contrib,NEW.policy_snapshot,NEW.sss_version_id,NEW.philhealth_version_id,NEW.pagibig_version_id,NEW.bir_version_id) IS DISTINCT FROM
 (OLD.run_type,OLD.pay_period_id,OLD.period_start,OLD.period_end,OLD.pay_date,OLD.department_id,OLD.employee_count,OLD.total_gross,OLD.total_deductions,OLD.total_net,OLD.total_employer_contrib,OLD.policy_snapshot,OLD.sss_version_id,OLD.philhealth_version_id,OLD.pagibig_version_id,OLD.bir_version_id) THEN
 RAISE EXCEPTION 'Approved payroll entitlement and policy are frozen; use source-specific adjustments' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS employee_run_entitlement_freeze_trigger ON payroll_run;
CREATE TRIGGER employee_run_entitlement_freeze_trigger BEFORE UPDATE ON payroll_run FOR EACH ROW EXECUTE FUNCTION employee_run_entitlement_freeze();
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
  IF NOT EXISTS(SELECT 1 FROM employee_settlement WHERE payslip_id=NEW.payslip_id) AND NOT EXISTS(SELECT 1 FROM payroll_legacy_settlement WHERE payslip_id=NEW.payslip_id) THEN RAISE EXCEPTION 'Execute noncash settlement before payout' USING ERRCODE='23514'; END IF;
  IF NEW.amount+COALESCE((SELECT SUM(amount) FROM payroll_payout_allocation WHERE payout_id=NEW.payout_id),0)>(SELECT amount FROM payroll_payout WHERE payout_id=NEW.payout_id) THEN RAISE EXCEPTION 'Allocations exceed payout total' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM payroll_payout WHERE payout_id=NEW.payout_id AND employee_id=employee_key) THEN RAISE EXCEPTION 'Payout employee mismatch' USING ERRCODE='23514'; END IF;
  SELECT net_pay+correction_amount+rounding_amount-legacy_asserted_paid,actual_paid,pending_amount INTO entitlement,already,pending FROM payroll_employee_payable WHERE payslip_id=NEW.payslip_id;
  IF already+pending+NEW.amount>entitlement THEN RAISE EXCEPTION 'Payout allocation exceeds unpaid wages' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
COMMIT;
