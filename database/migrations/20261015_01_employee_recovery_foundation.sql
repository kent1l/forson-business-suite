BEGIN;
ALTER TABLE payroll_run ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS employee_finance_request (
 request_id uuid PRIMARY KEY, actor_id integer NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
 operation text NOT NULL, payload_hash text NOT NULL, result jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payroll_deduction_allocation (
 allocation_id bigserial PRIMARY KEY,
 loan_id bigint NOT NULL REFERENCES employee_loan(loan_id) ON DELETE RESTRICT,
 employee_id integer NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
 payslip_id bigint NOT NULL REFERENCES payroll_payslip(payslip_id) ON DELETE RESTRICT,
 pay_period_id bigint NOT NULL REFERENCES pay_period(pay_period_id) ON DELETE RESTRICT,
 recovery_month date NOT NULL CHECK (extract(day FROM recovery_month)=1),
 cutoff_seq smallint NOT NULL CHECK (cutoff_seq IN (1,2)),
 scheduled_amount numeric(12,2) NOT NULL CHECK (scheduled_amount>0),
 approved_amount numeric(12,2) NOT NULL CHECK (approved_amount>=0 AND approved_amount<=scheduled_amount),
 status text NOT NULL DEFAULT 'PROPOSED' CHECK(status IN ('PROPOSED','RESERVED','RECOVERED','RELEASED')),
 review_reason text, reviewed_by integer REFERENCES employee(employee_id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(payslip_id,loan_id)
);
CREATE INDEX IF NOT EXISTS payroll_allocation_slot ON payroll_deduction_allocation(loan_id,recovery_month,cutoff_seq,status);
CREATE INDEX IF NOT EXISTS payroll_allocation_employee ON payroll_deduction_allocation(employee_id,status);
ALTER TABLE employee_loan_payment ADD COLUMN IF NOT EXISTS allocation_id bigint UNIQUE REFERENCES payroll_deduction_allocation(allocation_id) ON DELETE RESTRICT;
ALTER TABLE employee_loan_payment ADD COLUMN IF NOT EXISTS actor_id integer REFERENCES employee(employee_id) ON DELETE RESTRICT;
ALTER TABLE employee_loan_payment ADD COLUMN IF NOT EXISTS occurred_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE employee_loan_payment ADD COLUMN IF NOT EXISTS reversal_of bigint UNIQUE REFERENCES employee_loan_payment(payment_id) ON DELETE RESTRICT;
ALTER TABLE employee_loan_payment ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE employee_loan_payment ADD COLUMN IF NOT EXISTS source_key text UNIQUE;
-- History must survive employee/run deletion as well as ordinary void.
ALTER TABLE employee_loan_payment DROP CONSTRAINT IF EXISTS employee_loan_payment_payslip_id_fkey;
ALTER TABLE employee_loan_payment ADD CONSTRAINT employee_loan_payment_payslip_id_fkey FOREIGN KEY(payslip_id) REFERENCES payroll_payslip(payslip_id) ON DELETE RESTRICT;
ALTER TABLE employee_loan_payment DROP CONSTRAINT IF EXISTS employee_loan_payment_loan_id_fkey;
ALTER TABLE employee_loan_payment ADD CONSTRAINT employee_loan_payment_loan_id_fkey FOREIGN KEY(loan_id) REFERENCES employee_loan(loan_id) ON DELETE RESTRICT;
ALTER TABLE employee_loan DROP CONSTRAINT IF EXISTS employee_loan_employee_id_fkey;
ALTER TABLE employee_loan ADD CONSTRAINT employee_loan_employee_id_fkey FOREIGN KEY(employee_id) REFERENCES employee(employee_id) ON DELETE RESTRICT;
CREATE OR REPLACE FUNCTION employee_finance_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Financial events are append-only; use an authorized linked correction' USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS loan_payment_immutable ON employee_loan_payment;
CREATE TRIGGER loan_payment_immutable BEFORE UPDATE OR DELETE ON employee_loan_payment FOR EACH ROW EXECUTE FUNCTION employee_finance_immutable();
CREATE OR REPLACE FUNCTION employee_recovery_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l employee_loan%ROWTYPE; original employee_loan_payment%ROWTYPE;
BEGIN
 SELECT * INTO l FROM employee_loan WHERE loan_id=NEW.loan_id FOR UPDATE;
 IF NEW.reversal_of IS NOT NULL THEN
  SELECT * INTO original FROM employee_loan_payment WHERE payment_id=NEW.reversal_of;
  IF original.loan_id<>NEW.loan_id OR original.amount<>NEW.amount OR original.reversal_of IS NOT NULL OR NEW.reason IS NULL THEN
   RAISE EXCEPTION 'Invalid linked loan reversal' USING ERRCODE='23514';
  END IF;
 ELSE
  IF NEW.amount>l.principal_amount-l.amount_paid THEN RAISE EXCEPTION 'Recovery exceeds outstanding debt' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.payslip_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payroll_payslip WHERE payslip_id=NEW.payslip_id AND employee_id=l.employee_id) THEN
  RAISE EXCEPTION 'Loan and payslip belong to different employees' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS loan_recovery_guard ON employee_loan_payment;
CREATE TRIGGER loan_recovery_guard BEFORE INSERT ON employee_loan_payment FOR EACH ROW EXECUTE FUNCTION employee_recovery_guard();
CREATE OR REPLACE FUNCTION recalc_loan_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE paid numeric(12,2);
BEGIN
 SELECT COALESCE(SUM(CASE WHEN reversal_of IS NULL THEN amount ELSE -amount END),0) INTO paid FROM employee_loan_payment WHERE loan_id=NEW.loan_id;
 UPDATE employee_loan SET amount_paid=paid,
 status=CASE WHEN status='Active' AND paid>=principal_amount THEN 'Completed' WHEN status='Completed' AND paid<principal_amount THEN 'Active' ELSE status END,
 updated_at=now() WHERE loan_id=NEW.loan_id;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION employee_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l employee_loan%ROWTYPE; run_state text; reserved numeric;
BEGIN
 SELECT * INTO l FROM employee_loan WHERE loan_id=NEW.loan_id FOR UPDATE;
 SELECT r.status INTO run_state FROM payroll_payslip p JOIN payroll_run r USING(run_id)
 WHERE p.payslip_id=NEW.payslip_id AND p.employee_id=NEW.employee_id AND r.pay_period_id=NEW.pay_period_id;
 IF run_state IS NULL OR l.employee_id<>NEW.employee_id THEN RAISE EXCEPTION 'Allocation ownership mismatch' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (OLD.loan_id,OLD.employee_id,OLD.payslip_id,OLD.pay_period_id,OLD.recovery_month,OLD.cutoff_seq) IS DISTINCT FROM
 (NEW.loan_id,NEW.employee_id,NEW.payslip_id,NEW.pay_period_id,NEW.recovery_month,NEW.cutoff_seq) THEN
 RAISE EXCEPTION 'Allocation identity is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.status IN ('RECOVERED','RELEASED') THEN RAISE EXCEPTION 'Allocation is frozen' USING ERRCODE='23514'; END IF;
 IF NEW.status='RESERVED' THEN
  SELECT COALESCE(SUM(approved_amount),0) INTO reserved FROM payroll_deduction_allocation WHERE loan_id=NEW.loan_id AND status='RESERVED' AND allocation_id<>NEW.allocation_id;
  IF reserved+NEW.approved_amount>l.principal_amount-l.amount_paid THEN RAISE EXCEPTION 'Competing payroll reservations exceed debt' USING ERRCODE='23514'; END IF;
 END IF;
 NEW.updated_at=now(); RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS payroll_allocation_guard ON payroll_deduction_allocation;
CREATE TRIGGER payroll_allocation_guard BEFORE INSERT OR UPDATE ON payroll_deduction_allocation FOR EACH ROW EXECUTE FUNCTION employee_allocation_guard();
-- Draft replacement can remove proposals only; approved history remains RESTRICTed.
CREATE OR REPLACE FUNCTION payroll_run_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed text[];
BEGIN
 IF NEW.status=OLD.status THEN RETURN NEW; END IF;
 allowed:=CASE OLD.status WHEN 'Draft' THEN ARRAY['Computed','Voided'] WHEN 'Computed' THEN ARRAY['Draft','Approved','Voided'] WHEN 'Approved' THEN ARRAY['Paid','Voided'] WHEN 'Paid' THEN ARRAY['Posted'] ELSE ARRAY[]::text[] END;
 IF NOT NEW.status=ANY(allowed) THEN RAISE EXCEPTION 'Payroll cannot move from % to %',OLD.status,NEW.status USING ERRCODE='23514'; END IF;
 IF NEW.status='Voided' AND EXISTS(SELECT 1 FROM employee_loan_payment ep JOIN payroll_payslip p USING(payslip_id) WHERE p.run_id=OLD.run_id) THEN
 RAISE EXCEPTION 'Recovery history blocks ordinary void' USING ERRCODE='23514'; END IF;
 IF NEW.status='Approved' AND EXISTS(SELECT 1 FROM payroll_payslip WHERE run_id=OLD.run_id AND net_pay<0) THEN
 RAISE EXCEPTION 'Resolve insufficient pay before approval' USING ERRCODE='23514'; END IF;
 NEW.version:=OLD.version+1; RETURN NEW;
END $$;
COMMIT;
