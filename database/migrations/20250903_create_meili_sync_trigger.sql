-- Migration: create trigger to notify Meilisearch listener on parts changes
-- Creates a trigger function and trigger on the `parts` table that
-- NOTIFYs on the `meili_sync` channel with a JSON payload describing
-- the action and part_id.

CREATE OR REPLACE FUNCTION notify_meili_sync() RETURNS trigger AS $$
DECLARE
  payload json;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    payload = json_build_object('action', 'delete', 'part_id', OLD.part_id);
    PERFORM pg_notify('meili_sync', payload::text);
    RETURN OLD;
  ELSE
    -- INSERT or UPDATE
    payload = json_build_object('action', 'upsert', 'part_id', NEW.part_id);
    PERFORM pg_notify('meili_sync', payload::text);
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Add the trigger if it doesn't exist already
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON t.tgrelid = c.oid
    WHERE t.tgname = 'part_meili_sync_trigger' AND c.relname = 'part'
  ) THEN
    CREATE TRIGGER part_meili_sync_trigger
    AFTER INSERT OR UPDATE OR DELETE ON part
    FOR EACH ROW EXECUTE PROCEDURE notify_meili_sync();
  END IF;
END$$;
