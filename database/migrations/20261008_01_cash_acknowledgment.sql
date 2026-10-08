-- One-use recipient authentication, separate from the immutable close request.
CREATE TABLE cash_handover_ack (
  ack_id bigserial PRIMARY KEY,
  token_hash char(64) NOT NULL UNIQUE,
  session_id bigint NOT NULL REFERENCES cash_drawer_session(session_id) ON DELETE RESTRICT,
  recipient_id integer NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  actor_id integer NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  count_id bigint NOT NULL REFERENCES cash_count(count_id) ON DELETE RESTRICT,
  bound_version bigint NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  destination varchar(200) NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cash_handover_ack_session ON cash_handover_ack(session_id,expires_at);
