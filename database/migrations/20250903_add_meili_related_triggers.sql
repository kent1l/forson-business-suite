-- Migration: Add NOTIFY triggers for Meilisearch sync on related table changes
-- Ensures parts are re-indexed when fitments, part numbers, or tags change

-- Helper function to notify upsert for a given part_id
CREATE OR REPLACE FUNCTION notify_meili_upsert_for_part(p_part_id int) RETURNS void AS $$
BEGIN
  IF p_part_id IS NOT NULL THEN
    PERFORM pg_notify('meili_sync', json_build_object('action','upsert','part_id',p_part_id)::text);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- part_application changes -> notify the affected part
CREATE OR REPLACE FUNCTION trg_part_application_notify() RETURNS trigger AS $$
BEGIN
  PERFORM notify_meili_upsert_for_part(COALESCE(NEW.part_id, OLD.part_id));
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON t.tgrelid = c.oid
    WHERE t.tgname = 'part_application_meili_notify' AND c.relname = 'part_application'
  ) THEN
    CREATE TRIGGER part_application_meili_notify
    AFTER INSERT OR UPDATE OR DELETE ON part_application
    FOR EACH ROW EXECUTE PROCEDURE trg_part_application_notify();
  END IF;
END$$;

-- application updates -> notify all parts referencing the application
CREATE OR REPLACE FUNCTION trg_application_notify() RETURNS trigger AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT part_id FROM part_application WHERE application_id = COALESCE(NEW.application_id, OLD.application_id) LOOP
    PERFORM notify_meili_upsert_for_part(r.part_id);
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON t.tgrelid = c.oid
    WHERE t.tgname = 'application_meili_notify' AND c.relname = 'application'
  ) THEN
    CREATE TRIGGER application_meili_notify
    AFTER UPDATE ON application
    FOR EACH ROW EXECUTE PROCEDURE trg_application_notify();
  END IF;
END$$;

-- part_number changes -> notify the affected part
CREATE OR REPLACE FUNCTION trg_part_number_notify() RETURNS trigger AS $$
BEGIN
  PERFORM notify_meili_upsert_for_part(COALESCE(NEW.part_id, OLD.part_id));
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON t.tgrelid = c.oid
    WHERE t.tgname = 'part_number_meili_notify' AND c.relname = 'part_number'
  ) THEN
    CREATE TRIGGER part_number_meili_notify
    AFTER INSERT OR UPDATE OR DELETE ON part_number
    FOR EACH ROW EXECUTE PROCEDURE trg_part_number_notify();
  END IF;
END$$;

-- part_tag changes -> notify the affected part
CREATE OR REPLACE FUNCTION trg_part_tag_notify() RETURNS trigger AS $$
BEGIN
  PERFORM notify_meili_upsert_for_part(COALESCE(NEW.part_id, OLD.part_id));
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON t.tgrelid = c.oid
    WHERE t.tgname = 'part_tag_meili_notify' AND c.relname = 'part_tag'
  ) THEN
    CREATE TRIGGER part_tag_meili_notify
    AFTER INSERT OR DELETE ON part_tag
    FOR EACH ROW EXECUTE PROCEDURE trg_part_tag_notify();
  END IF;
END$$;

-- tag name updates -> notify all parts using that tag
CREATE OR REPLACE FUNCTION trg_tag_notify() RETURNS trigger AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT part_id FROM part_tag WHERE tag_id = COALESCE(NEW.tag_id, OLD.tag_id) LOOP
    PERFORM notify_meili_upsert_for_part(r.part_id);
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON t.tgrelid = c.oid
    WHERE t.tgname = 'tag_meili_notify' AND c.relname = 'tag'
  ) THEN
    CREATE TRIGGER tag_meili_notify
    AFTER UPDATE OF tag_name ON tag
    FOR EACH ROW EXECUTE PROCEDURE trg_tag_notify();
  END IF;
END$$;

-- brand name updates -> notify all parts for that brand
CREATE OR REPLACE FUNCTION trg_brand_notify() RETURNS trigger AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT part_id FROM part WHERE brand_id = COALESCE(NEW.brand_id, OLD.brand_id) LOOP
    PERFORM notify_meili_upsert_for_part(r.part_id);
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON t.tgrelid = c.oid
    WHERE t.tgname = 'brand_meili_notify' AND c.relname = 'brand'
  ) THEN
    CREATE TRIGGER brand_meili_notify
    AFTER UPDATE OF brand_name ON brand
    FOR EACH ROW EXECUTE PROCEDURE trg_brand_notify();
  END IF;
END$$;

-- group name updates -> notify all parts for that group
CREATE OR REPLACE FUNCTION trg_group_notify() RETURNS trigger AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT part_id FROM part WHERE group_id = COALESCE(NEW.group_id, OLD.group_id) LOOP
    PERFORM notify_meili_upsert_for_part(r.part_id);
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON t.tgrelid = c.oid
    WHERE t.tgname = 'group_meili_notify' AND c.relname = 'group'
  ) THEN
    CREATE TRIGGER group_meili_notify
    AFTER UPDATE OF group_name ON "group"
    FOR EACH ROW EXECUTE PROCEDURE trg_group_notify();
  END IF;
END$$;
