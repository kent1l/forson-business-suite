-- A source transaction must not commit while its retry claim is unfinished.
CREATE OR REPLACE FUNCTION cash_request_complete_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE saved_status integer;
BEGIN
  SELECT status_code INTO saved_status FROM cash_request WHERE request_id = NEW.request_id;
  IF saved_status = 202 THEN
    RAISE EXCEPTION 'Cash source request % was not completed', NEW.request_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER cash_request_complete_on_commit
AFTER INSERT ON cash_request
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cash_request_complete_guard();
