BEGIN;
CREATE TABLE IF NOT EXISTS employee_agency_payment (
 agency_payment_id bigserial PRIMARY KEY,loan_id bigint NOT NULL REFERENCES employee_loan(loan_id) ON DELETE RESTRICT,
 agency text NOT NULL CHECK(agency IN ('SSS','PAGIBIG')),amount numeric(12,2) NOT NULL CHECK(amount>0),
 official_reference text NOT NULL,evidence text NOT NULL,reason text NOT NULL,occurred_at timestamptz NOT NULL,
 actor_id integer NOT NULL REFERENCES employee(employee_id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(agency,official_reference)
);
CREATE TABLE IF NOT EXISTS loan_remittance (
 remittance_id bigserial PRIMARY KEY,agency text NOT NULL CHECK(agency IN ('SSS','PAGIBIG')),
 recovery_month date NOT NULL CHECK(extract(day FROM recovery_month)=1),amount numeric(12,2) NOT NULL CHECK(amount>0),
 treasury_expense_id bigint UNIQUE REFERENCES expense(expense_id) ON DELETE RESTRICT,
 treasury_ap_payment_id integer UNIQUE REFERENCES ap_payment(payment_id) ON DELETE RESTRICT,
 official_reference text NOT NULL,evidence text NOT NULL,actor_id integer NOT NULL REFERENCES employee(employee_id),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(num_nonnulls(treasury_expense_id,treasury_ap_payment_id)=1),UNIQUE(agency,official_reference)
);
CREATE TABLE IF NOT EXISTS loan_remittance_allocation (
 remittance_allocation_id bigserial PRIMARY KEY,remittance_id bigint NOT NULL REFERENCES loan_remittance(remittance_id) ON DELETE RESTRICT,
 payment_id bigint NOT NULL REFERENCES employee_loan_payment(payment_id) ON DELETE RESTRICT,amount numeric(12,2) NOT NULL CHECK(amount>0),UNIQUE(remittance_id,payment_id)
);
CREATE INDEX IF NOT EXISTS loan_remittance_payment ON loan_remittance_allocation(payment_id);
CREATE TABLE IF NOT EXISTS loan_remittance_event (
 event_id bigserial PRIMARY KEY,remittance_id bigint NOT NULL REFERENCES loan_remittance(remittance_id) ON DELETE RESTRICT,
 state text NOT NULL CHECK(state IN ('PAID','CONFIRMED','RECONCILED','NEEDS_REVIEW')),statement_amount numeric(12,2) CHECK(statement_amount>=0),
 evidence text NOT NULL,reason text NOT NULL,actor_id integer NOT NULL REFERENCES employee(employee_id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS loan_remittance_correction (
 correction_id bigserial PRIMARY KEY,remittance_allocation_id bigint NOT NULL REFERENCES loan_remittance_allocation(remittance_allocation_id) ON DELETE RESTRICT,
 amount numeric(12,2) NOT NULL CHECK(amount>0),return_funding_id bigint NOT NULL UNIQUE REFERENCES employee_finance_funding(funding_id) ON DELETE RESTRICT,
 reason text NOT NULL,evidence text NOT NULL,actor_id integer NOT NULL REFERENCES employee(employee_id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payroll_recovery_correction (
 correction_id bigserial PRIMARY KEY,payment_id bigint NOT NULL UNIQUE REFERENCES employee_loan_payment(payment_id) ON DELETE RESTRICT,
 reversal_payment_id bigint NOT NULL UNIQUE REFERENCES employee_loan_payment(payment_id) ON DELETE RESTRICT,
 payslip_id bigint NOT NULL REFERENCES payroll_payslip(payslip_id) ON DELETE RESTRICT,
 amount numeric(12,2) NOT NULL CHECK(amount>0),reason text NOT NULL,evidence text NOT NULL,
 actor_id integer NOT NULL REFERENCES employee(employee_id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payroll_payout_return (
 return_id bigserial PRIMARY KEY,payout_allocation_id bigint NOT NULL REFERENCES payroll_payout_allocation(payout_allocation_id) ON DELETE RESTRICT,
 amount numeric(12,2) NOT NULL CHECK(amount>0),return_funding_id bigint NOT NULL UNIQUE REFERENCES employee_finance_funding(funding_id) ON DELETE RESTRICT,
 reason text NOT NULL,evidence text NOT NULL,actor_id integer NOT NULL REFERENCES employee(employee_id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS employee_collection_refund (
 refund_id bigserial PRIMARY KEY,payment_id bigint NOT NULL UNIQUE REFERENCES employee_loan_payment(payment_id) ON DELETE RESTRICT,
 reversal_payment_id bigint NOT NULL UNIQUE REFERENCES employee_loan_payment(payment_id) ON DELETE RESTRICT,
 funding_id bigint NOT NULL UNIQUE REFERENCES employee_finance_funding(funding_id) ON DELETE RESTRICT,
 reason text NOT NULL,evidence text NOT NULL,actor_id integer NOT NULL REFERENCES employee(employee_id),created_at timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['employee_agency_payment','loan_remittance','loan_remittance_allocation','loan_remittance_event','loan_remittance_correction','payroll_recovery_correction','payroll_payout_return','employee_collection_refund'] LOOP
 EXECUTE format('DROP TRIGGER IF EXISTS finance_history_immutable ON %I',t);
 EXECUTE format('CREATE TRIGGER finance_history_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION employee_finance_immutable()',t);
 END LOOP;
END $$;
CREATE OR REPLACE VIEW loan_withholding_available AS
 SELECT p.payment_id,p.loan_id,p.payslip_id,l.employee_id,l.creditor,l.reference_no,p.amount,
 COALESCE((SELECT SUM(a.amount) FROM loan_remittance_allocation a WHERE a.payment_id=p.payment_id),0)::numeric(12,2) remitted,
 COALESCE((SELECT SUM(c.amount) FROM loan_remittance_correction c JOIN loan_remittance_allocation a USING(remittance_allocation_id) WHERE a.payment_id=p.payment_id),0)::numeric(12,2) remittance_returned,
 (p.amount-COALESCE((SELECT SUM(a.amount) FROM loan_remittance_allocation a WHERE a.payment_id=p.payment_id),0)+COALESCE((SELECT SUM(c.amount) FROM loan_remittance_correction c JOIN loan_remittance_allocation a USING(remittance_allocation_id) WHERE a.payment_id=p.payment_id),0))::numeric(12,2) unremitted
 FROM employee_loan_payment p JOIN employee_loan l USING(loan_id)
 WHERE l.creditor IN ('SSS','PAGIBIG') AND p.payslip_id IS NOT NULL AND p.reversal_of IS NULL AND NOT EXISTS(SELECT 1 FROM employee_loan_payment r WHERE r.reversal_of=p.payment_id);
CREATE OR REPLACE VIEW payroll_employee_payable AS
 SELECT p.payslip_id,p.employee_id,p.run_id,p.net_pay,
 COALESCE((SELECT SUM(amount) FROM payroll_rounding_adjustment WHERE payslip_id=p.payslip_id),0)::numeric(12,2) rounding_amount,
 COALESCE((SELECT SUM(a.amount-COALESCE((SELECT SUM(pr.amount) FROM payroll_payout_return pr WHERE pr.payout_allocation_id=a.payout_allocation_id),0)) FROM payroll_payout_allocation a JOIN payroll_payout_current pc USING(payout_id) WHERE a.payslip_id=p.payslip_id AND pc.status='CONFIRMED'),0)::numeric(12,2) actual_paid,
 COALESCE((SELECT SUM(a.amount) FROM payroll_payout_allocation a JOIN payroll_payout_current pc USING(payout_id) WHERE a.payslip_id=p.payslip_id AND pc.status IN ('PENDING','UNKNOWN')),0)::numeric(12,2) pending_amount,
 COALESCE(l.asserted_net,0)::numeric(12,2) legacy_asserted_paid,l.provenance legacy_provenance,s.settlement_id,
 COALESCE((SELECT SUM(amount) FROM payroll_recovery_correction WHERE payslip_id=p.payslip_id),0)::numeric(12,2) correction_amount
 FROM payroll_payslip p JOIN payroll_run r USING(run_id) LEFT JOIN payroll_legacy_settlement l USING(payslip_id) LEFT JOIN employee_settlement s USING(payslip_id)
 WHERE r.status IN ('Approved','Paid','Posted');
-- Add database-level budget enforcement for direct SQL paths as well as HTTP services.
CREATE OR REPLACE FUNCTION employee_financial_budget_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original numeric; used numeric; available numeric; owner integer; parent bigint;
BEGIN
 IF TG_TABLE_NAME='loan_remittance_allocation' THEN
  SELECT l.loan_id INTO parent FROM employee_loan_payment p JOIN employee_loan l USING(loan_id) WHERE p.payment_id=NEW.payment_id;
  PERFORM 1 FROM employee_loan WHERE loan_id=parent FOR UPDATE;
  SELECT unremitted INTO available FROM loan_withholding_available WHERE payment_id=NEW.payment_id;
  IF available IS NULL OR NEW.amount>available THEN RAISE EXCEPTION 'Remittance exceeds unremitted withholding' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM loan_remittance r JOIN loan_withholding_available w ON w.payment_id=NEW.payment_id WHERE r.remittance_id=NEW.remittance_id AND r.agency=w.creditor) THEN RAISE EXCEPTION 'Remittance agency mismatch' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='payroll_payout_return' THEN
  PERFORM 1 FROM payroll_run WHERE run_id IN(SELECT p.run_id FROM payroll_payslip p JOIN payroll_payout_allocation a USING(payslip_id) WHERE a.payout_allocation_id=NEW.payout_allocation_id) ORDER BY run_id FOR UPDATE;
  SELECT a.amount INTO original FROM payroll_payout_allocation a JOIN payroll_payout_current p USING(payout_id) WHERE a.payout_allocation_id=NEW.payout_allocation_id AND p.status='CONFIRMED';
  SELECT COALESCE(SUM(amount),0) INTO used FROM payroll_payout_return WHERE payout_allocation_id=NEW.payout_allocation_id;
  IF original IS NULL OR NEW.amount+used>original THEN RAISE EXCEPTION 'Payout return exceeds actual confirmed allocation' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='loan_remittance_correction' THEN
  SELECT payment_id INTO parent FROM loan_remittance_allocation WHERE remittance_allocation_id=NEW.remittance_allocation_id;
  PERFORM 1 FROM employee_loan WHERE loan_id=(SELECT loan_id FROM employee_loan_payment WHERE payment_id=parent) FOR UPDATE;
  SELECT amount INTO original FROM loan_remittance_allocation WHERE remittance_allocation_id=NEW.remittance_allocation_id;
  SELECT COALESCE(SUM(amount),0) INTO used FROM loan_remittance_correction WHERE remittance_allocation_id=NEW.remittance_allocation_id;
  IF NEW.amount+used>original THEN RAISE EXCEPTION 'Correction exceeds remitted amount' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_TABLE_NAME IN ('payroll_payout_return','loan_remittance_correction') THEN
 IF NOT EXISTS(SELECT 1 FROM employee_finance_funding WHERE funding_id=NEW.return_funding_id AND direction='IN' AND amount=NEW.amount) THEN
 RAISE EXCEPTION 'Returned funds evidence does not match correction' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS remittance_allocation_budget ON loan_remittance_allocation;
CREATE TRIGGER remittance_allocation_budget BEFORE INSERT ON loan_remittance_allocation FOR EACH ROW EXECUTE FUNCTION employee_financial_budget_guard();
DROP TRIGGER IF EXISTS remittance_correction_budget ON loan_remittance_correction;
CREATE TRIGGER remittance_correction_budget BEFORE INSERT ON loan_remittance_correction FOR EACH ROW EXECUTE FUNCTION employee_financial_budget_guard();
DROP TRIGGER IF EXISTS payout_return_budget ON payroll_payout_return;
CREATE TRIGGER payout_return_budget BEFORE INSERT ON payroll_payout_return FOR EACH ROW EXECUTE FUNCTION employee_financial_budget_guard();
CREATE OR REPLACE FUNCTION employee_loan_event_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE employee_loan SET version=version+1 WHERE loan_id=NEW.loan_id; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS employee_loan_event_version_trigger ON employee_loan_payment;
CREATE TRIGGER employee_loan_event_version_trigger AFTER INSERT ON employee_loan_payment FOR EACH ROW EXECUTE FUNCTION employee_loan_event_version();
-- Source Treasury documents cannot drift after remittance attribution.
CREATE OR REPLACE FUNCTION employee_remittance_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE linked boolean;
BEGIN
 IF TG_TABLE_NAME='expense' THEN
 SELECT EXISTS(SELECT 1 FROM loan_remittance r WHERE r.treasury_expense_id=OLD.expense_id AND r.amount>COALESCE((SELECT SUM(c.amount) FROM loan_remittance_correction c JOIN loan_remittance_allocation a USING(remittance_allocation_id) WHERE a.remittance_id=r.remittance_id),0)) INTO linked;
 IF TG_OP='UPDATE' AND (NEW.amount,NEW.is_void,NEW.payment_method_id,NEW.payment_method_text,NEW.reference_no) IS NOT DISTINCT FROM (OLD.amount,OLD.is_void,OLD.payment_method_id,OLD.payment_method_text,OLD.reference_no) THEN RETURN NEW; END IF;
 ELSE
 SELECT EXISTS(SELECT 1 FROM loan_remittance r WHERE r.treasury_ap_payment_id=OLD.payment_id AND r.amount>COALESCE((SELECT SUM(c.amount) FROM loan_remittance_correction c JOIN loan_remittance_allocation a USING(remittance_allocation_id) WHERE a.remittance_id=r.remittance_id),0)) INTO linked;
 IF TG_OP='UPDATE' AND (NEW.amount,NEW.pdc_status,NEW.method_id,NEW.reference_number) IS NOT DISTINCT FROM (OLD.amount,OLD.pdc_status,OLD.method_id,OLD.reference_number) THEN RETURN NEW; END IF;
 END IF;
 IF linked THEN RAISE EXCEPTION 'Correct remittance attribution before changing its Treasury source' USING ERRCODE='23514'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS employee_remittance_expense_guard ON expense;
CREATE TRIGGER employee_remittance_expense_guard BEFORE UPDATE OR DELETE ON expense FOR EACH ROW EXECUTE FUNCTION employee_remittance_source_guard();
DROP TRIGGER IF EXISTS employee_remittance_ap_guard ON ap_payment;
CREATE TRIGGER employee_remittance_ap_guard BEFORE UPDATE OR DELETE ON ap_payment FOR EACH ROW EXECUTE FUNCTION employee_remittance_source_guard();
COMMIT;
