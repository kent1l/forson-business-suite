BEGIN;

CREATE TABLE IF NOT EXISTS cash_approval_use (
  approval_id bigint PRIMARY KEY REFERENCES cash_approval(approval_id) ON DELETE RESTRICT,
  movement_id bigint NOT NULL UNIQUE REFERENCES cash_drawer_movement(movement_id) ON DELETE RESTRICT,
  used_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS cash_immutable ON cash_approval_use;
CREATE TRIGGER cash_immutable BEFORE UPDATE OR DELETE ON cash_approval_use
  FOR EACH ROW EXECUTE FUNCTION cash_reject_change();

CREATE OR REPLACE FUNCTION cash_count_line_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE state text;
BEGIN
  SELECT status INTO state FROM cash_count WHERE count_id=NEW.count_id FOR UPDATE;
  IF state <> 'DRAFT' THEN RAISE EXCEPTION 'Submitted cash count lines are immutable'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cash_count_line_insert_guard_trigger ON cash_count_line;
CREATE TRIGGER cash_count_line_insert_guard_trigger BEFORE INSERT ON cash_count_line
  FOR EACH ROW EXECUTE FUNCTION cash_count_line_insert_guard();

CREATE OR REPLACE FUNCTION cash_movement_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  s cash_drawer_session%ROWTYPE;
  prior_balance numeric(14,2);
  expected_balance numeric(14,2);
BEGIN
  SELECT * INTO s FROM cash_drawer_session WHERE session_id=NEW.session_id FOR UPDATE;
  IF NOT FOUND OR (s.status <> 'OPEN' AND NOT (s.status='CLOSING' AND NEW.category='FINAL_HANDOVER')) THEN
    RAISE EXCEPTION 'Cash drawer session is not open for posting';
  END IF;
  IF s.count_window_expires_at > now() THEN RAISE EXCEPTION 'Cash drawer count is in progress'; END IF;
  IF NEW.sequence <> s.last_sequence+1 THEN RAISE EXCEPTION 'Cash movement sequence is stale'; END IF;
  SELECT balance_after INTO prior_balance FROM cash_drawer_movement WHERE session_id=NEW.session_id ORDER BY sequence DESC LIMIT 1;
  prior_balance := COALESCE(prior_balance,s.opening_amount);
  IF NEW.direction='IN' THEN expected_balance := prior_balance+NEW.amount;
  ELSE expected_balance := prior_balance-NEW.amount; END IF;
  IF NEW.balance_after <> expected_balance THEN
    RAISE EXCEPTION 'Cash movement running balance is invalid';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cash_movement_insert_guard_trigger ON cash_drawer_movement;
CREATE TRIGGER cash_movement_insert_guard_trigger BEFORE INSERT ON cash_drawer_movement
  FOR EACH ROW EXECUTE FUNCTION cash_movement_insert_guard();

COMMIT;
