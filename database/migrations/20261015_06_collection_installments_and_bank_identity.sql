BEGIN;
ALTER TABLE payroll_payout ADD COLUMN IF NOT EXISTS bank_account_id integer REFERENCES bank_account(bank_account_id) ON DELETE RESTRICT;
ALTER TABLE payroll_payout ADD COLUMN IF NOT EXISTS instruction_reference text;
CREATE UNIQUE INDEX IF NOT EXISTS payroll_payout_instruction_identity ON payroll_payout(bank_account_id,instruction_reference) WHERE instruction_reference IS NOT NULL;
CREATE TABLE IF NOT EXISTS employee_collection_installment (
 installment_id bigserial PRIMARY KEY,payment_id bigint NOT NULL UNIQUE REFERENCES employee_loan_payment(payment_id) ON DELETE RESTRICT,
 loan_id bigint NOT NULL REFERENCES employee_loan(loan_id) ON DELETE RESTRICT,
 schedule_id bigint NOT NULL REFERENCES employee_loan_schedule(schedule_id) ON DELETE RESTRICT,
 recovery_month date NOT NULL CHECK(extract(day FROM recovery_month)=1),cutoff_seq smallint NOT NULL CHECK(cutoff_seq IN (1,2)),
 amount numeric(12,2) NOT NULL CHECK(amount>0),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employee_collection_installment_slot ON employee_collection_installment(loan_id,recovery_month,cutoff_seq);
DROP TRIGGER IF EXISTS collection_installment_immutable ON employee_collection_installment;
CREATE TRIGGER collection_installment_immutable BEFORE UPDATE OR DELETE ON employee_collection_installment FOR EACH ROW EXECUTE FUNCTION employee_finance_immutable();
CREATE OR REPLACE VIEW employee_installment_consumed AS
 SELECT loan_id,recovery_month,cutoff_seq,approved_amount amount FROM payroll_deduction_allocation WHERE status IN ('RESERVED','RECOVERED')
 UNION ALL SELECT i.loan_id,i.recovery_month,i.cutoff_seq,i.amount FROM employee_collection_installment i WHERE NOT EXISTS(SELECT 1 FROM employee_loan_payment p WHERE p.reversal_of=i.payment_id);
CREATE OR REPLACE FUNCTION employee_collection_slot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE terms employee_loan_schedule%ROWTYPE; used numeric; entitlement numeric;
BEGIN
 PERFORM 1 FROM employee_loan WHERE loan_id=NEW.loan_id FOR UPDATE;
 SELECT * INTO terms FROM employee_loan_schedule WHERE schedule_id=NEW.schedule_id AND loan_id=NEW.loan_id AND effective_from<=NEW.recovery_month AND (effective_to IS NULL OR effective_to>NEW.recovery_month);
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM employee_loan_payment p JOIN employee_collection c USING(collection_id) WHERE p.payment_id=NEW.payment_id AND p.loan_id=NEW.loan_id AND p.amount=NEW.amount AND c.allocation_policy='INSTALLMENT_ARREARS') THEN RAISE EXCEPTION 'Direct installment allocation identity mismatch' USING ERRCODE='23514'; END IF;
 entitlement:=CASE terms.schedule WHEN 'FIRST_CUTOFF' THEN CASE NEW.cutoff_seq WHEN 1 THEN terms.monthly_installment ELSE 0 END WHEN 'SECOND_CUTOFF' THEN CASE NEW.cutoff_seq WHEN 2 THEN terms.monthly_installment ELSE 0 END ELSE CASE NEW.cutoff_seq WHEN 1 THEN round(terms.monthly_installment/2,2) ELSE terms.monthly_installment-round(terms.monthly_installment/2,2) END END;
 SELECT COALESCE(SUM(amount),0) INTO used FROM employee_installment_consumed WHERE loan_id=NEW.loan_id AND recovery_month=NEW.recovery_month AND cutoff_seq=NEW.cutoff_seq;
 IF used+NEW.amount>entitlement THEN RAISE EXCEPTION 'Direct installment collection exceeds the unpaid cutoff share' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS collection_slot_guard ON employee_collection_installment;
CREATE TRIGGER collection_slot_guard BEFORE INSERT ON employee_collection_installment FOR EACH ROW EXECUTE FUNCTION employee_collection_slot_guard();
-- Add direct installment collections to the same monthly/slot budget used by payroll.
CREATE OR REPLACE FUNCTION employee_direct_slot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE monthly numeric; slot_amount numeric; schedule_name text; used_month numeric; used_slot numeric; run_type text;
BEGIN
 IF NEW.status<>'RESERVED' THEN RETURN NEW; END IF;
 PERFORM 1 FROM employee_loan WHERE loan_id=NEW.loan_id FOR UPDATE;
 SELECT s.monthly_installment,s.schedule INTO monthly,schedule_name FROM employee_loan_schedule s WHERE s.schedule_id=NEW.schedule_id;
 SELECT r.run_type INTO run_type FROM payroll_payslip p JOIN payroll_run r USING(run_id) WHERE p.payslip_id=NEW.payslip_id;
 SELECT COALESCE(SUM(amount),0),COALESCE(SUM(amount) FILTER(WHERE cutoff_seq=NEW.cutoff_seq),0) INTO used_month,used_slot FROM employee_installment_consumed WHERE loan_id=NEW.loan_id AND recovery_month=NEW.recovery_month;
 -- Before UPDATE the current reservation, if any, is still represented in the view.
 IF TG_OP='UPDATE' AND OLD.status IN ('RESERVED','RECOVERED') THEN used_month:=used_month-OLD.approved_amount;used_slot:=used_slot-OLD.approved_amount; END IF;
 slot_amount:=CASE schedule_name WHEN 'FIRST_CUTOFF' THEN CASE NEW.cutoff_seq WHEN 1 THEN monthly ELSE 0 END WHEN 'SECOND_CUTOFF' THEN CASE NEW.cutoff_seq WHEN 2 THEN monthly ELSE 0 END ELSE CASE NEW.cutoff_seq WHEN 1 THEN round(monthly/2,2) ELSE monthly-round(monthly/2,2) END END;
 IF run_type<>'FINAL_PAY' AND (used_month+NEW.approved_amount>monthly OR (NEW.supplemental_authorization IS NULL AND used_slot+NEW.approved_amount>slot_amount)) THEN RAISE EXCEPTION 'Payroll and direct collections exceed the installment budget' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS employee_direct_slot_guard_trigger ON payroll_deduction_allocation;
CREATE TRIGGER employee_direct_slot_guard_trigger BEFORE INSERT OR UPDATE ON payroll_deduction_allocation FOR EACH ROW EXECUTE FUNCTION employee_direct_slot_guard();
CREATE OR REPLACE FUNCTION payroll_settlement_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='Voided' AND (EXISTS(SELECT 1 FROM employee_settlement s JOIN payroll_payslip p USING(payslip_id) WHERE p.run_id=OLD.run_id) OR
 EXISTS(SELECT 1 FROM payroll_payout_allocation a JOIN payroll_payslip p USING(payslip_id) JOIN payroll_payout_current pc USING(payout_id) WHERE p.run_id=OLD.run_id AND pc.status IN ('PENDING','UNKNOWN','CONFIRMED'))) THEN
 RAISE EXCEPTION 'Actual/pending settlement blocks ordinary void' USING ERRCODE='23514'; END IF;
 IF NEW.status='Paid' AND OLD.status<>'Paid' AND EXISTS(SELECT 1 FROM payroll_employee_payable WHERE run_id=OLD.run_id AND
 (settlement_id IS NULL OR net_pay+correction_amount+rounding_amount-legacy_asserted_paid-actual_paid<>0 OR pending_amount<>0)) THEN
 RAISE EXCEPTION 'Complete employee recovery settlement and actual payouts first' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION employee_schedule_frozen_month_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.effective_to IS NOT NULL AND EXISTS(SELECT 1 FROM payroll_deduction_allocation WHERE schedule_id=OLD.schedule_id AND status IN ('RESERVED','RECOVERED') AND recovery_month>=NEW.effective_to) THEN RAISE EXCEPTION 'Schedule closure would rewrite a frozen recovery month' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS employee_schedule_frozen_month_trigger ON employee_loan_schedule;
CREATE TRIGGER employee_schedule_frozen_month_trigger BEFORE UPDATE OF effective_to ON employee_loan_schedule FOR EACH ROW EXECUTE FUNCTION employee_schedule_frozen_month_guard();
DROP TRIGGER IF EXISTS employee_schedule_delete_guard ON employee_loan_schedule;
CREATE TRIGGER employee_schedule_delete_guard BEFORE DELETE ON employee_loan_schedule FOR EACH ROW EXECUTE FUNCTION employee_finance_immutable();
COMMIT;
