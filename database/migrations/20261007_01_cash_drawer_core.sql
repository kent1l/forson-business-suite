-- Physical cash custody. All posted rows are append-only; a source document
-- and its drawer movement must be inserted in the same transaction.
BEGIN;

CREATE TABLE IF NOT EXISTS cash_drawer (
  drawer_id bigserial PRIMARY KEY,
  code varchar(40) NOT NULL UNIQUE,
  name varchar(100) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by integer REFERENCES employee(employee_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  modified_by integer REFERENCES employee(employee_id) ON DELETE RESTRICT,
  modified_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cash_drawer_session (
  session_id bigserial PRIMARY KEY,
  session_code varchar(80) NOT NULL UNIQUE,
  drawer_id bigint NOT NULL REFERENCES cash_drawer(drawer_id) ON DELETE RESTRICT,
  business_date date NOT NULL,
  custodian_id integer NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  status varchar(10) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSING','CLOSED')),
  opening_amount numeric(14,2) NOT NULL CHECK (opening_amount >= 0),
  opening_source jsonb NOT NULL DEFAULT '{}'::jsonb,
  prior_session_id bigint REFERENCES cash_drawer_session(session_id) ON DELETE RESTRICT,
  version bigint NOT NULL DEFAULT 0,
  last_sequence bigint NOT NULL DEFAULT 0,
  count_window_expires_at timestamptz,
  opened_by integer NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closing_by integer REFERENCES employee(employee_id) ON DELETE RESTRICT,
  closing_at timestamptz,
  closed_by integer REFERENCES employee(employee_id) ON DELETE RESTRICT,
  closed_at timestamptz,
  CHECK (prior_session_id IS DISTINCT FROM session_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS cash_drawer_one_active_session ON cash_drawer_session(drawer_id) WHERE status IN ('OPEN','CLOSING');
CREATE INDEX IF NOT EXISTS cash_drawer_session_date ON cash_drawer_session(drawer_id,business_date DESC);

CREATE TABLE IF NOT EXISTS cash_drawer_movement (
  movement_id bigserial PRIMARY KEY,
  session_id bigint NOT NULL REFERENCES cash_drawer_session(session_id) ON DELETE RESTRICT,
  sequence bigint NOT NULL,
  direction varchar(3) NOT NULL CHECK (direction IN ('IN','OUT')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  balance_after numeric(14,2) NOT NULL,
  category varchar(40) NOT NULL,
  description varchar(500) NOT NULL,
  counterparty varchar(200),
  actor_id integer NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  late_reason varchar(500),
  source_event_key varchar(120) UNIQUE,
  request_id uuid UNIQUE,
  reversal_of bigint UNIQUE REFERENCES cash_drawer_movement(movement_id) ON DELETE RESTRICT,
  customer_payment_id integer UNIQUE REFERENCES customer_payment(payment_id) ON DELETE RESTRICT,
  invoice_payment_id integer UNIQUE REFERENCES invoice_payments(payment_id) ON DELETE RESTRICT,
  expense_id integer UNIQUE REFERENCES expense(expense_id) ON DELETE RESTRICT,
  ap_payment_id integer UNIQUE REFERENCES ap_payment(payment_id) ON DELETE RESTRICT,
  credit_note_id integer REFERENCES credit_note(cn_id) ON DELETE RESTRICT,
  method_id integer REFERENCES payment_methods(method_id) ON DELETE RESTRICT,
  UNIQUE(session_id,sequence),
  CHECK (num_nonnulls(customer_payment_id,invoice_payment_id,expense_id,ap_payment_id,credit_note_id) <= 1)
);
CREATE INDEX IF NOT EXISTS cash_drawer_movement_recorded ON cash_drawer_movement(session_id,recorded_at DESC);

CREATE TABLE IF NOT EXISTS cash_count (
  count_id bigserial PRIMARY KEY,
  session_id bigint NOT NULL REFERENCES cash_drawer_session(session_id) ON DELETE RESTRICT,
  kind varchar(8) NOT NULL CHECK (kind IN ('OPENING','MIDDAY','CLOSING')),
  status varchar(11) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','INVALIDATED')),
  cutoff_sequence bigint NOT NULL,
  cutoff_version bigint NOT NULL,
  expected numeric(14,2) NOT NULL,
  counted numeric(14,2),
  variance numeric(14,2),
  counter_id integer NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  notes varchar(1000),
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  invalidated_at timestamptz,
  CHECK (status <> 'SUBMITTED' OR submitted_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS cash_count_session ON cash_count(session_id,count_id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS cash_one_draft_count ON cash_count(session_id) WHERE status='DRAFT';
CREATE TABLE IF NOT EXISTS cash_count_line (
  count_id bigint NOT NULL REFERENCES cash_count(count_id) ON DELETE RESTRICT,
  denomination_code varchar(20) NOT NULL,
  value_snapshot numeric(8,2) NOT NULL CHECK (value_snapshot > 0),
  quantity integer NOT NULL CHECK (quantity >= 0),
  PRIMARY KEY(count_id,denomination_code)
);

CREATE TABLE IF NOT EXISTS cash_approval (
  approval_id bigserial PRIMARY KEY,
  session_id bigint NOT NULL REFERENCES cash_drawer_session(session_id) ON DELETE RESTRICT,
  action varchar(40) NOT NULL,
  target_id bigint,
  count_id bigint REFERENCES cash_count(count_id) ON DELETE RESTRICT,
  bound_version bigint NOT NULL,
  bound_amount numeric(14,2),
  reason varchar(1000) NOT NULL,
  requester_id integer NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  reviewer_id integer REFERENCES employee(employee_id) ON DELETE RESTRICT,
  decision varchar(8) NOT NULL DEFAULT 'PENDING' CHECK (decision IN ('PENDING','APPROVED','REJECTED')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CHECK (reviewer_id IS NULL OR reviewer_id <> requester_id)
);

CREATE TABLE IF NOT EXISTS cash_transfer (
  transfer_id bigserial PRIMARY KEY,
  session_id bigint NOT NULL REFERENCES cash_drawer_session(session_id) ON DELETE RESTRICT,
  release_movement_id bigint NOT NULL UNIQUE REFERENCES cash_drawer_movement(movement_id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  destination varchar(200) NOT NULL,
  recipient_id integer NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cash_transfer_event (
  event_id bigserial PRIMARY KEY,
  transfer_id bigint NOT NULL REFERENCES cash_transfer(transfer_id) ON DELETE RESTRICT,
  stage varchar(12) NOT NULL CHECK (stage IN ('ACKNOWLEDGED','DEPOSITED','RETURNED','NOTE')),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  evidence varchar(500),
  actor_id integer NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  receiving_movement_id bigint UNIQUE REFERENCES cash_drawer_movement(movement_id) ON DELETE RESTRICT,
  request_id uuid NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cash_transfer_event_transfer ON cash_transfer_event(transfer_id);

CREATE TABLE IF NOT EXISTS cash_advance (
  advance_id bigserial PRIMARY KEY,
  session_id bigint NOT NULL REFERENCES cash_drawer_session(session_id) ON DELETE RESTRICT,
  release_movement_id bigint NOT NULL UNIQUE REFERENCES cash_drawer_movement(movement_id) ON DELETE RESTRICT,
  employee_id integer NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  purpose varchar(500) NOT NULL,
  due_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cash_advance_event (
  event_id bigserial PRIMARY KEY,
  advance_id bigint NOT NULL REFERENCES cash_advance(advance_id) ON DELETE RESTRICT,
  kind varchar(14) NOT NULL CHECK (kind IN ('CONSUMPTION','RETURN','REIMBURSEMENT','SETTLEMENT')),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  expense_id integer UNIQUE REFERENCES expense(expense_id) ON DELETE RESTRICT,
  ap_payment_id integer UNIQUE REFERENCES ap_payment(payment_id) ON DELETE RESTRICT,
  movement_id bigint UNIQUE REFERENCES cash_drawer_movement(movement_id) ON DELETE RESTRICT,
  actor_id integer NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  request_id uuid NOT NULL UNIQUE,
  notes varchar(500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cash_advance_event_advance ON cash_advance_event(advance_id);

CREATE TABLE IF NOT EXISTS cash_source_link (
  link_id bigserial PRIMARY KEY,
  canonical_event_key varchar(120) NOT NULL,
  movement_id bigint NOT NULL REFERENCES cash_drawer_movement(movement_id) ON DELETE RESTRICT,
  customer_payment_id integer REFERENCES customer_payment(payment_id) ON DELETE RESTRICT,
  invoice_payment_id integer REFERENCES invoice_payments(payment_id) ON DELETE RESTRICT,
  amount_covered numeric(14,2) NOT NULL CHECK (amount_covered > 0),
  purpose varchar(25) NOT NULL CHECK (purpose IN ('NORMAL','NOTEBOOK_RECONCILIATION')),
  linked_by integer NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(customer_payment_id,invoice_payment_id) = 1),
  UNIQUE(canonical_event_key,customer_payment_id,invoice_payment_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS cash_source_customer_once ON cash_source_link(customer_payment_id) WHERE customer_payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cash_source_invoice_once ON cash_source_link(invoice_payment_id) WHERE invoice_payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS cash_session_close (
  session_id bigint PRIMARY KEY REFERENCES cash_drawer_session(session_id) ON DELETE RESTRICT,
  count_id bigint NOT NULL UNIQUE REFERENCES cash_count(count_id) ON DELETE RESTRICT,
  cutoff_sequence bigint NOT NULL,
  opening numeric(14,2) NOT NULL,
  total_in numeric(14,2) NOT NULL,
  total_out numeric(14,2) NOT NULL,
  expected numeric(14,2) NOT NULL,
  counted numeric(14,2) NOT NULL,
  variance numeric(14,2) NOT NULL,
  handovers numeric(14,2) NOT NULL,
  retained_ledger numeric(14,2) NOT NULL,
  retained_actual numeric(14,2) NOT NULL,
  notes varchar(2000),
  custodian_id integer NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  reviewer_id integer REFERENCES employee(employee_id) ON DELETE RESTRICT,
  report_snapshot jsonb NOT NULL,
  closed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cash_audit_event (
  audit_id bigserial PRIMARY KEY,
  session_id bigint REFERENCES cash_drawer_session(session_id) ON DELETE RESTRICT,
  target_type varchar(40) NOT NULL,
  target_id bigint NOT NULL,
  action varchar(40) NOT NULL,
  actor_id integer NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  request_id uuid,
  reason varchar(1000),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS refund_disbursement (
  disbursement_id bigserial PRIMARY KEY,
  credit_note_id integer NOT NULL REFERENCES credit_note(cn_id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  method_id integer NOT NULL REFERENCES payment_methods(method_id) ON DELETE RESTRICT,
  movement_id bigint UNIQUE REFERENCES cash_drawer_movement(movement_id) ON DELETE RESTRICT,
  paid_at timestamptz NOT NULL DEFAULT now(),
  actor_id integer NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  request_id uuid NOT NULL UNIQUE,
  CHECK (movement_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS refund_disbursement_credit_note ON refund_disbursement(credit_note_id);
CREATE TABLE IF NOT EXISTS cash_request (
  request_id uuid PRIMARY KEY,
  actor_id integer NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  request_hash varchar(64) NOT NULL,
  status_code integer NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION cash_reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Posted cash records are immutable';
END $$;
CREATE OR REPLACE FUNCTION cash_count_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Cash counts cannot be deleted'; END IF;
  IF OLD.status='INVALIDATED' THEN RAISE EXCEPTION 'Invalidated cash counts are immutable'; END IF;
  IF OLD.status='SUBMITTED' AND NOT (
    NEW.status='INVALIDATED' AND NEW.invalidated_at IS NOT NULL AND
    to_jsonb(NEW)-'status'-'invalidated_at'=to_jsonb(OLD)-'status'-'invalidated_at'
  ) THEN RAISE EXCEPTION 'Submitted cash counts are immutable'; END IF;
  IF OLD.status='DRAFT' AND (
    NEW.status NOT IN ('SUBMITTED','INVALIDATED') OR
    NEW.session_id IS DISTINCT FROM OLD.session_id OR NEW.kind IS DISTINCT FROM OLD.kind OR
    NEW.cutoff_sequence IS DISTINCT FROM OLD.cutoff_sequence OR NEW.cutoff_version IS DISTINCT FROM OLD.cutoff_version OR
    NEW.expected IS DISTINCT FROM OLD.expected OR NEW.counter_id IS DISTINCT FROM OLD.counter_id
  ) THEN RAISE EXCEPTION 'Cash count identity and cutoff are immutable'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cash_count_guard_trigger ON cash_count;
CREATE TRIGGER cash_count_guard_trigger BEFORE UPDATE OR DELETE ON cash_count FOR EACH ROW EXECUTE FUNCTION cash_count_guard();
CREATE OR REPLACE FUNCTION cash_session_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.status='CLOSED' THEN RAISE EXCEPTION 'Closed cash sessions are immutable'; END IF;
  IF NEW.opening_amount IS DISTINCT FROM OLD.opening_amount OR NEW.drawer_id IS DISTINCT FROM OLD.drawer_id OR
     NEW.business_date IS DISTINCT FROM OLD.business_date OR NEW.custodian_id IS DISTINCT FROM OLD.custodian_id THEN
    RAISE EXCEPTION 'Opening custody cannot be edited';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cash_session_guard_trigger ON cash_drawer_session;
CREATE TRIGGER cash_session_guard_trigger BEFORE UPDATE OR DELETE ON cash_drawer_session FOR EACH ROW EXECUTE FUNCTION cash_session_guard();
CREATE OR REPLACE FUNCTION cash_approval_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.decision<>'PENDING' THEN RAISE EXCEPTION 'Decided cash approval is immutable'; END IF;
  IF NEW.session_id IS DISTINCT FROM OLD.session_id OR NEW.count_id IS DISTINCT FROM OLD.count_id OR
     NEW.bound_version IS DISTINCT FROM OLD.bound_version OR NEW.bound_amount IS DISTINCT FROM OLD.bound_amount OR
     NEW.requester_id IS DISTINCT FROM OLD.requester_id OR NEW.reason IS DISTINCT FROM OLD.reason OR
     NEW.action IS DISTINCT FROM OLD.action THEN RAISE EXCEPTION 'Cash approval request is immutable'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cash_approval_guard_trigger ON cash_approval;
CREATE TRIGGER cash_approval_guard_trigger BEFORE UPDATE OR DELETE ON cash_approval FOR EACH ROW EXECUTE FUNCTION cash_approval_guard();
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['cash_drawer_movement','cash_count_line','cash_transfer_event','cash_advance_event','cash_source_link','cash_session_close','cash_audit_event','refund_disbursement'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS cash_immutable ON %I',t);
    EXECUTE format('CREATE TRIGGER cash_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION cash_reject_change()',t);
  END LOOP;
END $$;

INSERT INTO permission(permission_key,description,category) VALUES
 ('cash_drawer:view','View cash drawer','Finance & Expenses'),
 ('cash_drawer:open','Open cash drawer sessions','Finance & Expenses'),
 ('cash_drawer:move','Post cash drawer movements','Finance & Expenses'),
 ('cash_drawer:count','Count cash drawer','Finance & Expenses'),
 ('cash_drawer:close','Close cash drawer','Finance & Expenses'),
 ('cash_drawer:review','Review cash discrepancies','Finance & Expenses'),
 ('cash_drawer:transfer','Transfer physical cash custody','Finance & Expenses'),
 ('cash_drawer:settle_advance','Settle employee cash advances','Finance & Expenses'),
 ('cash_drawer:correct','Correct cash drawer records','Finance & Expenses'),
 ('cash_drawer:export','Export cash drawer reports','Finance & Expenses'),
 ('cash_drawer:configure','Configure cash drawers','Finance & Expenses')
ON CONFLICT(permission_key) DO NOTHING;
INSERT INTO role_permission(permission_level_id,permission_id)
SELECT pl.permission_level_id,p.permission_id FROM permission_level pl CROSS JOIN permission p
WHERE pl.level_name='Admin' AND p.permission_key LIKE 'cash_drawer:%'
ON CONFLICT DO NOTHING;
INSERT INTO role_permission(permission_level_id,permission_id)
SELECT pl.permission_level_id,p.permission_id FROM permission_level pl CROSS JOIN permission p
WHERE pl.level_name='Manager' AND p.permission_key IN
('cash_drawer:view','cash_drawer:open','cash_drawer:move','cash_drawer:count','cash_drawer:close','cash_drawer:review','cash_drawer:transfer','cash_drawer:settle_advance','cash_drawer:correct','cash_drawer:export')
ON CONFLICT DO NOTHING;
INSERT INTO role_permission(permission_level_id,permission_id)
SELECT pl.permission_level_id,p.permission_id FROM permission_level pl CROSS JOIN permission p
WHERE pl.level_name='Cashier' AND p.permission_key IN
('cash_drawer:view','cash_drawer:open','cash_drawer:move','cash_drawer:count')
ON CONFLICT DO NOTHING;

INSERT INTO cash_drawer(code,name) VALUES ('MAIN_COUNTER','Main Counter') ON CONFLICT(code) DO NOTHING;
COMMIT;
