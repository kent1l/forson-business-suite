BEGIN;
CREATE TABLE IF NOT EXISTS employee_settlement (
 settlement_id bigserial PRIMARY KEY, payslip_id bigint NOT NULL UNIQUE REFERENCES payroll_payslip(payslip_id) ON DELETE RESTRICT,
 employee_id integer NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
 actor_id integer NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
 reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payroll_legacy_settlement (
 payslip_id bigint PRIMARY KEY REFERENCES payroll_payslip(payslip_id) ON DELETE RESTRICT,
 asserted_net numeric(12,2) NOT NULL, provenance text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO payroll_legacy_settlement(payslip_id,asserted_net,provenance)
 SELECT p.payslip_id,p.net_pay,'Legacy Paid/Posted status assertion. Actual funding, payout date and bank evidence unknown; no cash movement created.' FROM payroll_payslip p JOIN payroll_run r USING(run_id) WHERE r.status IN ('Paid','Posted') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS payroll_payout (
 payout_id bigserial PRIMARY KEY, employee_id integer NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
 amount numeric(12,2) NOT NULL CHECK(amount>0), request_id uuid NOT NULL UNIQUE REFERENCES employee_finance_request(request_id) ON DELETE RESTRICT,
 method text NOT NULL CHECK(method IN ('CASH','BANK')), evidence text NOT NULL,
 actor_id integer NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payroll_payout_event (
 event_id bigserial PRIMARY KEY, payout_id bigint NOT NULL REFERENCES payroll_payout(payout_id) ON DELETE RESTRICT,
 status text NOT NULL CHECK(status IN ('PENDING','UNKNOWN','CONFIRMED','FAILED','CANCELLED','REVERSED')),
 funding_id bigint UNIQUE REFERENCES employee_finance_funding(funding_id) ON DELETE RESTRICT,
 evidence text NOT NULL, reason text NOT NULL, actor_id integer NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(), CHECK((status='CONFIRMED')=(funding_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS payroll_payout_event_current ON payroll_payout_event(payout_id,event_id DESC);
CREATE TABLE IF NOT EXISTS payroll_payout_allocation (
 payout_allocation_id bigserial PRIMARY KEY,payout_id bigint NOT NULL REFERENCES payroll_payout(payout_id) ON DELETE RESTRICT,
 payslip_id bigint NOT NULL REFERENCES payroll_payslip(payslip_id) ON DELETE RESTRICT,
 amount numeric(12,2) NOT NULL CHECK(amount>0), UNIQUE(payout_id,payslip_id)
);
CREATE INDEX IF NOT EXISTS payroll_payout_allocation_slip ON payroll_payout_allocation(payslip_id);
CREATE TABLE IF NOT EXISTS payroll_rounding_adjustment (
 adjustment_id bigserial PRIMARY KEY,payslip_id bigint NOT NULL REFERENCES payroll_payslip(payslip_id) ON DELETE RESTRICT,
 amount numeric(12,2) NOT NULL CHECK(amount>0 AND amount<1), policy_version text NOT NULL,
 reason text NOT NULL,evidence text NOT NULL,actor_id integer NOT NULL REFERENCES employee(employee_id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(payslip_id)
);
CREATE OR REPLACE VIEW payroll_payout_current AS
 SELECT p.*,e.event_id,e.status,e.funding_id FROM payroll_payout p JOIN LATERAL(SELECT event_id,status,funding_id FROM payroll_payout_event WHERE payout_id=p.payout_id ORDER BY event_id DESC LIMIT 1)e ON true;
CREATE OR REPLACE VIEW payroll_employee_payable AS
 SELECT p.payslip_id,p.employee_id,p.run_id,p.net_pay,
 COALESCE((SELECT SUM(amount) FROM payroll_rounding_adjustment WHERE payslip_id=p.payslip_id),0)::numeric(12,2) rounding_amount,
 COALESCE((SELECT SUM(a.amount) FROM payroll_payout_allocation a JOIN payroll_payout_current pc USING(payout_id) WHERE a.payslip_id=p.payslip_id AND pc.status='CONFIRMED'),0)::numeric(12,2) actual_paid,
 COALESCE((SELECT SUM(a.amount) FROM payroll_payout_allocation a JOIN payroll_payout_current pc USING(payout_id) WHERE a.payslip_id=p.payslip_id AND pc.status IN ('PENDING','UNKNOWN')),0)::numeric(12,2) pending_amount,
 COALESCE(l.asserted_net,0)::numeric(12,2) legacy_asserted_paid,
 l.provenance legacy_provenance, s.settlement_id
 FROM payroll_payslip p JOIN payroll_run r USING(run_id)
 LEFT JOIN payroll_legacy_settlement l USING(payslip_id) LEFT JOIN employee_settlement s USING(payslip_id)
 WHERE r.status IN ('Approved','Paid','Posted');
CREATE OR REPLACE FUNCTION payroll_financial_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run_key bigint; run_state text; employee_key integer; entitlement numeric; already numeric; pending numeric; previous text;
BEGIN
 IF TG_TABLE_NAME='payroll_payout_event' THEN
  PERFORM 1 FROM payroll_run WHERE run_id IN(SELECT p.run_id FROM payroll_payslip p JOIN payroll_payout_allocation a USING(payslip_id) WHERE a.payout_id=NEW.payout_id) ORDER BY run_id FOR UPDATE;
  PERFORM 1 FROM payroll_payout WHERE payout_id=NEW.payout_id FOR UPDATE;
  SELECT status INTO previous FROM payroll_payout_event WHERE payout_id=NEW.payout_id ORDER BY event_id DESC LIMIT 1;
  IF previous IN ('CONFIRMED','FAILED','CANCELLED','REVERSED') THEN RAISE EXCEPTION 'Payout outcome is final; use a source-specific correction' USING ERRCODE='23514'; END IF;
  IF NEW.status='REVERSED' THEN RAISE EXCEPTION 'A payout reversal requires independently verified returned funds' USING ERRCODE='23514'; END IF;
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
  IF NOT EXISTS(SELECT 1 FROM payroll_payout WHERE payout_id=NEW.payout_id AND employee_id=employee_key) THEN RAISE EXCEPTION 'Payout employee mismatch' USING ERRCODE='23514'; END IF;
  SELECT net_pay+rounding_amount-legacy_asserted_paid,actual_paid,pending_amount INTO entitlement,already,pending FROM payroll_employee_payable WHERE payslip_id=NEW.payslip_id;
  IF already+pending+NEW.amount>entitlement THEN RAISE EXCEPTION 'Payout allocation exceeds unpaid wages' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payroll_settlement_guard BEFORE INSERT ON employee_settlement FOR EACH ROW EXECUTE FUNCTION payroll_financial_insert_guard();
CREATE TRIGGER payroll_payout_allocation_guard BEFORE INSERT ON payroll_payout_allocation FOR EACH ROW EXECUTE FUNCTION payroll_financial_insert_guard();
CREATE TRIGGER payroll_payout_event_guard BEFORE INSERT ON payroll_payout_event FOR EACH ROW EXECUTE FUNCTION payroll_financial_insert_guard();
CREATE TRIGGER payroll_settlement_immutable BEFORE UPDATE OR DELETE ON employee_settlement FOR EACH ROW EXECUTE FUNCTION employee_finance_immutable();
CREATE TRIGGER payroll_payout_immutable BEFORE UPDATE OR DELETE ON payroll_payout FOR EACH ROW EXECUTE FUNCTION employee_finance_immutable();
CREATE TRIGGER payroll_payout_allocation_immutable BEFORE UPDATE OR DELETE ON payroll_payout_allocation FOR EACH ROW EXECUTE FUNCTION employee_finance_immutable();
CREATE TRIGGER payroll_payout_event_immutable BEFORE UPDATE OR DELETE ON payroll_payout_event FOR EACH ROW EXECUTE FUNCTION employee_finance_immutable();
CREATE TRIGGER payroll_rounding_immutable BEFORE UPDATE OR DELETE ON payroll_rounding_adjustment FOR EACH ROW EXECUTE FUNCTION employee_finance_immutable();
CREATE TRIGGER payroll_legacy_immutable BEFORE UPDATE OR DELETE ON payroll_legacy_settlement FOR EACH ROW EXECUTE FUNCTION employee_finance_immutable();
-- This trigger shares the run lock with the write protocol and checks actual documents, independently of stale run status.
CREATE OR REPLACE FUNCTION payroll_settlement_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='Voided' AND (EXISTS(SELECT 1 FROM employee_settlement s JOIN payroll_payslip p USING(payslip_id) WHERE p.run_id=OLD.run_id) OR
 EXISTS(SELECT 1 FROM payroll_payout_allocation a JOIN payroll_payslip p USING(payslip_id) JOIN payroll_payout_current pc USING(payout_id) WHERE p.run_id=OLD.run_id AND pc.status IN ('PENDING','UNKNOWN','CONFIRMED'))) THEN
 RAISE EXCEPTION 'Actual/pending settlement blocks ordinary void' USING ERRCODE='23514'; END IF;
 IF NEW.status='Paid' AND OLD.status<>'Paid' AND EXISTS(SELECT 1 FROM payroll_employee_payable WHERE run_id=OLD.run_id AND
 (settlement_id IS NULL OR net_pay+rounding_amount-legacy_asserted_paid-actual_paid<>0 OR pending_amount<>0)) THEN
 RAISE EXCEPTION 'Complete employee recovery settlement and actual payouts first' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payroll_settlement_transition BEFORE UPDATE OF status ON payroll_run FOR EACH ROW EXECUTE FUNCTION payroll_settlement_transition_guard();
COMMIT;
