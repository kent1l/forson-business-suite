BEGIN;
ALTER TABLE employee_loan ADD COLUMN IF NOT EXISTS creditor text NOT NULL DEFAULT 'COMPANY' CHECK(creditor IN ('COMPANY','SSS','PAGIBIG'));
ALTER TABLE employee_loan ADD COLUMN IF NOT EXISTS activation_state text NOT NULL DEFAULT 'LEGACY_ACTIVE' CHECK(activation_state IN ('DRAFT','ACTIVE','LEGACY_ACTIVE'));
ALTER TABLE employee_loan ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE employee_loan ADD COLUMN IF NOT EXISTS original_principal numeric(12,2) CHECK(original_principal>0);
ALTER TABLE employee_loan ADD COLUMN IF NOT EXISTS purpose text;
ALTER TABLE employee_loan ADD COLUMN IF NOT EXISTS deduction_authority text;
ALTER TABLE employee_loan ADD COLUMN IF NOT EXISTS evidence text;
ALTER TABLE employee_loan ADD COLUMN IF NOT EXISTS collectible_opening numeric(12,2);
ALTER TABLE employee_loan ADD COLUMN IF NOT EXISTS interest_fees numeric(12,2) CHECK(interest_fees>=0);
ALTER TABLE employee_loan ADD COLUMN IF NOT EXISTS migration_review text;
ALTER TABLE employee_loan ADD COLUMN IF NOT EXISTS activated_by integer REFERENCES employee(employee_id) ON DELETE RESTRICT;
ALTER TABLE employee_loan ADD COLUMN IF NOT EXISTS activated_at timestamptz;
UPDATE employee_loan SET creditor=CASE WHEN loan_type LIKE 'SSS_%' THEN 'SSS' WHEN loan_type LIKE 'HDMF_%' THEN 'PAGIBIG' ELSE 'COMPANY' END,
 collectible_opening=principal_amount, migration_review='Imported principal retained as collectible opening. Original principal/interest and release evidence require review; no interest inferred.' WHERE collectible_opening IS NULL;
CREATE TABLE IF NOT EXISTS employee_loan_schedule (
 schedule_id bigserial PRIMARY KEY, loan_id bigint NOT NULL REFERENCES employee_loan(loan_id) ON DELETE RESTRICT,
 schedule text NOT NULL CHECK(schedule IN ('FIRST_CUTOFF','SECOND_CUTOFF','SPLIT_HALF')),
 monthly_installment numeric(12,2) NOT NULL CHECK(monthly_installment>0),
 effective_from date NOT NULL CHECK(extract(day FROM effective_from)=1), effective_to date CHECK(extract(day FROM effective_to)=1 AND effective_to>effective_from),
 version integer NOT NULL CHECK(version>0), deduction_authority text NOT NULL, reason text NOT NULL,
 created_by integer REFERENCES employee(employee_id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(loan_id,version)
);
INSERT INTO employee_loan_schedule(loan_id,schedule,monthly_installment,effective_from,version,deduction_authority,reason,created_by)
 SELECT loan_id,CASE deduct_on_cutoff WHEN 1 THEN 'FIRST_CUTOFF' ELSE 'SECOND_CUTOFF' END,amortization_amount,date_trunc('month',start_date)::date,1,'Legacy imported terms; evidence requires review','Legacy amount retained without splitting',created_by
 FROM employee_loan l WHERE NOT EXISTS(SELECT 1 FROM employee_loan_schedule s WHERE s.loan_id=l.loan_id);
ALTER TABLE payroll_deduction_allocation ADD COLUMN IF NOT EXISTS schedule_id bigint REFERENCES employee_loan_schedule(schedule_id) ON DELETE RESTRICT;
ALTER TABLE payroll_deduction_allocation ADD COLUMN IF NOT EXISTS schedule_version integer;
ALTER TABLE payroll_deduction_allocation ADD COLUMN IF NOT EXISTS supplemental_authorization text;
CREATE OR REPLACE FUNCTION employee_schedule_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM employee_loan WHERE loan_id=NEW.loan_id FOR UPDATE;
 IF TG_OP='UPDATE' AND (NEW.loan_id,NEW.schedule,NEW.monthly_installment,NEW.effective_from,NEW.version,NEW.deduction_authority,NEW.reason,NEW.created_by) IS DISTINCT FROM
 (OLD.loan_id,OLD.schedule,OLD.monthly_installment,OLD.effective_from,OLD.version,OLD.deduction_authority,OLD.reason,OLD.created_by) THEN
 RAISE EXCEPTION 'Schedule history is immutable; add a future version' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM employee_loan_schedule WHERE loan_id=NEW.loan_id AND schedule_id<>NEW.schedule_id AND daterange(effective_from,effective_to,'[)') && daterange(NEW.effective_from,NEW.effective_to,'[)')) THEN
 RAISE EXCEPTION 'Overlapping loan schedule versions' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS employee_schedule_guard_trigger ON employee_loan_schedule;
CREATE TRIGGER employee_schedule_guard_trigger BEFORE INSERT OR UPDATE ON employee_loan_schedule FOR EACH ROW EXECUTE FUNCTION employee_schedule_guard();
CREATE OR REPLACE FUNCTION employee_loan_terms_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.principal_amount,NEW.employee_id,NEW.loan_type,NEW.creditor,NEW.component_code) IS DISTINCT FROM (OLD.principal_amount,OLD.employee_id,OLD.loan_type,OLD.creditor,OLD.component_code) THEN
 RAISE EXCEPTION 'Activated loan identity and collectible amount are immutable' USING ERRCODE='23514'; END IF;
 IF (NEW.amortization_amount,NEW.deduct_on_cutoff) IS DISTINCT FROM (OLD.amortization_amount,OLD.deduct_on_cutoff) AND current_setting('app.loan_schedule_sync',true) IS DISTINCT FROM 'on' THEN
 RAISE EXCEPTION 'Use effective-dated schedule changes' USING ERRCODE='23514'; END IF;
 IF NEW.status IN ('Completed','Cancelled') AND NEW.amount_paid<NEW.principal_amount THEN RAISE EXCEPTION 'Outstanding debt cannot be erased by status' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS employee_loan_terms_guard_trigger ON employee_loan;
CREATE TRIGGER employee_loan_terms_guard_trigger BEFORE UPDATE ON employee_loan FOR EACH ROW EXECUTE FUNCTION employee_loan_terms_guard();
-- Verified bank evidence and physical movement identities are consumed once across all employee-finance workflows.
CREATE TABLE IF NOT EXISTS employee_finance_funding (
 funding_id bigserial PRIMARY KEY, direction text NOT NULL CHECK(direction IN ('IN','OUT')),
 amount numeric(12,2) NOT NULL CHECK(amount>0), method text NOT NULL CHECK(method IN ('CASH','BANK')),
 movement_id bigint UNIQUE REFERENCES cash_drawer_movement(movement_id) ON DELETE RESTRICT,
 bank_account_id integer REFERENCES bank_account(bank_account_id) ON DELETE RESTRICT,
 external_reference text, evidence text NOT NULL, occurred_at timestamptz NOT NULL,
 actor_id integer NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(), owner_key text NOT NULL UNIQUE,
 CHECK((method='CASH' AND movement_id IS NOT NULL AND bank_account_id IS NULL) OR (method='BANK' AND movement_id IS NULL AND bank_account_id IS NOT NULL AND external_reference IS NOT NULL)),
 UNIQUE(bank_account_id,external_reference)
);
ALTER TABLE employee_loan ADD COLUMN IF NOT EXISTS release_funding_id bigint UNIQUE REFERENCES employee_finance_funding(funding_id) ON DELETE RESTRICT;
CREATE TABLE IF NOT EXISTS employee_collection (
 collection_id bigserial PRIMARY KEY, employee_id integer NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
 amount numeric(12,2) NOT NULL CHECK(amount>0), funding_id bigint NOT NULL UNIQUE REFERENCES employee_finance_funding(funding_id) ON DELETE RESTRICT,
 allocation_policy text NOT NULL CHECK(allocation_policy IN ('PRINCIPAL','INSTALLMENT_ARREARS')),
 reason text NOT NULL, actor_id integer NOT NULL REFERENCES employee(employee_id), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE employee_loan_payment ADD COLUMN IF NOT EXISTS collection_id bigint REFERENCES employee_collection(collection_id) ON DELETE RESTRICT;
CREATE TRIGGER employee_collection_immutable BEFORE UPDATE OR DELETE ON employee_collection FOR EACH ROW EXECUTE FUNCTION employee_finance_immutable();
CREATE TRIGGER employee_funding_immutable BEFORE UPDATE OR DELETE ON employee_finance_funding FOR EACH ROW EXECUTE FUNCTION employee_finance_immutable();
CREATE TABLE IF NOT EXISTS employee_loan_activity (
 activity_id bigserial PRIMARY KEY, loan_id bigint NOT NULL REFERENCES employee_loan(loan_id) ON DELETE RESTRICT,
 action text NOT NULL, reason text NOT NULL, actor_id integer NOT NULL REFERENCES employee(employee_id), created_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL
);
CREATE TRIGGER employee_loan_activity_immutable BEFORE UPDATE OR DELETE ON employee_loan_activity FOR EACH ROW EXECUTE FUNCTION employee_finance_immutable();
INSERT INTO permission(permission_key,description,category) VALUES
 ('employee_finance:view','View employee financial statements','Employee Finance'),
 ('employee_finance:manage','Prepare loans and effective schedules','Employee Finance'),
 ('employee_finance:approve','Approve and activate employee obligations','Employee Finance'),
 ('employee_finance:collect','Collect company loan repayments','Employee Finance'),
 ('employee_finance:pay','Record actual wage disbursements','Employee Finance'),
 ('employee_finance:remit','Record agency loan remittances','Employee Finance'),
 ('employee_finance:correct','Authorize source-specific financial corrections','Employee Finance') ON CONFLICT DO NOTHING;
INSERT INTO role_permission(permission_level_id,permission_id)
 SELECT pl.permission_level_id,p.permission_id FROM permission_level pl CROSS JOIN permission p WHERE pl.level_name IN ('Admin','Super Admin') AND p.permission_key LIKE 'employee_finance:%' ON CONFLICT DO NOTHING;
INSERT INTO role_permission(permission_level_id,permission_id)
 SELECT pl.permission_level_id,p.permission_id FROM permission_level pl CROSS JOIN permission p WHERE pl.level_name='Manager' AND p.permission_key IN ('employee_finance:view','employee_finance:manage') ON CONFLICT DO NOTHING;
ALTER TABLE payroll_deduction_allocation ADD COLUMN IF NOT EXISTS line_id bigint REFERENCES payroll_payslip_line(line_id) ON DELETE RESTRICT;
CREATE OR REPLACE FUNCTION employee_slot_budget_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE terms employee_loan_schedule%ROWTYPE; used_month numeric; used_slot numeric; slot_amount numeric; run_type text;
BEGIN
 IF NEW.status<>'RESERVED' THEN RETURN NEW; END IF;
 PERFORM 1 FROM employee_loan WHERE loan_id=NEW.loan_id FOR UPDATE;
 SELECT * INTO terms FROM employee_loan_schedule WHERE schedule_id=NEW.schedule_id AND loan_id=NEW.loan_id AND version=NEW.schedule_version
 AND effective_from<=NEW.recovery_month AND (effective_to IS NULL OR effective_to>NEW.recovery_month);
 IF NOT FOUND THEN RAISE EXCEPTION 'Refresh payroll schedule before approval' USING ERRCODE='23514'; END IF;
 SELECT r.run_type INTO run_type FROM payroll_payslip p JOIN payroll_run r USING(run_id) WHERE p.payslip_id=NEW.payslip_id;
 IF run_type NOT IN ('REGULAR','JOB_ORDER') AND NEW.approved_amount>0 AND NEW.supplemental_authorization IS NULL THEN RAISE EXCEPTION 'Explicit final/supplemental recovery deduction_authority is required' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(SUM(approved_amount),0),COALESCE(SUM(approved_amount) FILTER(WHERE cutoff_seq=NEW.cutoff_seq),0) INTO used_month,used_slot
 FROM payroll_deduction_allocation WHERE loan_id=NEW.loan_id AND recovery_month=NEW.recovery_month AND status IN ('RESERVED','RECOVERED') AND allocation_id<>NEW.allocation_id;
 slot_amount:=CASE terms.schedule WHEN 'FIRST_CUTOFF' THEN CASE NEW.cutoff_seq WHEN 1 THEN terms.monthly_installment ELSE 0 END
 WHEN 'SECOND_CUTOFF' THEN CASE NEW.cutoff_seq WHEN 2 THEN terms.monthly_installment ELSE 0 END
 ELSE CASE NEW.cutoff_seq WHEN 1 THEN round(terms.monthly_installment/2,2) ELSE terms.monthly_installment-round(terms.monthly_installment/2,2) END END;
 IF run_type<>'FINAL_PAY' AND (used_month+NEW.approved_amount>terms.monthly_installment OR
 (NEW.supplemental_authorization IS NULL AND used_slot+NEW.approved_amount>slot_amount)) THEN
 RAISE EXCEPTION 'Monthly or cutoff recovery budget exceeded' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER employee_slot_budget_guard_trigger BEFORE INSERT OR UPDATE ON payroll_deduction_allocation FOR EACH ROW EXECUTE FUNCTION employee_slot_budget_guard();
COMMIT;
