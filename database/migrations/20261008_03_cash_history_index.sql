CREATE INDEX cash_session_history_page ON cash_drawer_session(drawer_id,opened_at DESC,session_id DESC);
CREATE INDEX cash_session_history_custodian ON cash_drawer_session(drawer_id,custodian_id,business_date DESC);
CREATE INDEX cash_audit_session_order ON cash_audit_event(session_id,audit_id);
