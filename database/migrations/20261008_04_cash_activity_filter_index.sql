-- Activity history is commonly filtered by operator and work date on a shared box.
CREATE INDEX IF NOT EXISTS cash_audit_session_actor_recorded
  ON cash_audit_event(session_id,actor_id,recorded_at DESC,audit_id DESC);
CREATE INDEX IF NOT EXISTS cash_audit_session_action_recorded
  ON cash_audit_event(session_id,action,recorded_at DESC,audit_id DESC);
