-- Migration: durable change log for the mobile offline catalog delta sync.
-- Date: 2026-08-17 (Asia/Manila)
--
-- Why a new log rather than reusing meili_sync_outbox:
-- that table is written by application code (enqueuePartUpsert), and only from
-- partRoutes and partApplicationRoutes. Edits to part_number, part_barcode,
-- part_tag, and brand/group/tag renames reach Meilisearch over the ephemeral
-- pg_notify('meili_sync') channel instead, which leaves no durable record a
-- phone can catch up from after being offline. A sync keyed on the outbox
-- would silently miss exactly those edits.
--
-- This log is trigger-fed, so it cannot be bypassed by a route that forgets to
-- call a helper, and it is deliberately independent of the Meilisearch
-- pipeline: nothing here changes how that pipeline behaves.

CREATE TABLE IF NOT EXISTS catalog_change_log (
  change_id BIGSERIAL PRIMARY KEY,
  part_id INTEGER NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('upsert', 'delete')),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The only access pattern: "everything after cursor X, in order".
CREATE INDEX IF NOT EXISTS idx_catalog_change_log_cursor
  ON catalog_change_log (change_id);

-- Lets the groomer at the bottom of this file prune by age cheaply.
CREATE INDEX IF NOT EXISTS idx_catalog_change_log_changed_at
  ON catalog_change_log (changed_at);

CREATE OR REPLACE FUNCTION log_catalog_change(p_part_id INTEGER, p_change_type TEXT)
RETURNS void AS $$
BEGIN
  IF p_part_id IS NOT NULL THEN
    INSERT INTO catalog_change_log (part_id, change_type) VALUES (p_part_id, p_change_type);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- part itself: an actual DELETE is a delete; everything else is an upsert.
-- Deactivation (is_active = false) and merges arrive here as upserts because
-- the row still exists and must stay findable on the phone.
CREATE OR REPLACE FUNCTION trg_catalog_part_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM log_catalog_change(OLD.part_id, 'delete');
    RETURN OLD;
  END IF;
  PERFORM log_catalog_change(NEW.part_id, 'upsert');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS part_catalog_change ON part;
CREATE TRIGGER part_catalog_change
AFTER INSERT OR UPDATE OR DELETE ON part
FOR EACH ROW EXECUTE PROCEDURE trg_catalog_part_change();

-- Child tables: any change re-publishes the parent part, since the synced row
-- is a flattened join over all of them.
CREATE OR REPLACE FUNCTION trg_catalog_child_change() RETURNS trigger AS $$
BEGIN
  PERFORM log_catalog_change(COALESCE(NEW.part_id, OLD.part_id), 'upsert');
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS part_number_catalog_change ON part_number;
CREATE TRIGGER part_number_catalog_change
AFTER INSERT OR UPDATE OR DELETE ON part_number
FOR EACH ROW EXECUTE PROCEDURE trg_catalog_child_change();

DROP TRIGGER IF EXISTS part_barcode_catalog_change ON part_barcode;
CREATE TRIGGER part_barcode_catalog_change
AFTER INSERT OR UPDATE OR DELETE ON part_barcode
FOR EACH ROW EXECUTE PROCEDURE trg_catalog_child_change();

DROP TRIGGER IF EXISTS part_tag_catalog_change ON part_tag;
CREATE TRIGGER part_tag_catalog_change
AFTER INSERT OR UPDATE OR DELETE ON part_tag
FOR EACH ROW EXECUTE PROCEDURE trg_catalog_child_change();

DROP TRIGGER IF EXISTS part_application_catalog_change ON part_application;
CREATE TRIGGER part_application_catalog_change
AFTER INSERT OR UPDATE OR DELETE ON part_application
FOR EACH ROW EXECUTE PROCEDURE trg_catalog_child_change();

-- Renames cascade: brand_name and group_name are baked into the synced
-- display_name, so renaming one changes every part that carries it.
-- Guarded by a name comparison because these fire on any UPDATE, and a brand
-- row touched for an unrelated column should not republish its whole catalog.
CREATE OR REPLACE FUNCTION trg_catalog_brand_rename() RETURNS trigger AS $$
BEGIN
  IF NEW.brand_name IS DISTINCT FROM OLD.brand_name THEN
    INSERT INTO catalog_change_log (part_id, change_type)
    SELECT part_id, 'upsert' FROM part WHERE brand_id = NEW.brand_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS brand_catalog_change ON brand;
CREATE TRIGGER brand_catalog_change
AFTER UPDATE ON brand
FOR EACH ROW EXECUTE PROCEDURE trg_catalog_brand_rename();

CREATE OR REPLACE FUNCTION trg_catalog_group_rename() RETURNS trigger AS $$
BEGIN
  IF NEW.group_name IS DISTINCT FROM OLD.group_name THEN
    INSERT INTO catalog_change_log (part_id, change_type)
    SELECT part_id, 'upsert' FROM part WHERE group_id = NEW.group_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS group_catalog_change ON "group";
CREATE TRIGGER group_catalog_change
AFTER UPDATE ON "group"
FOR EACH ROW EXECUTE PROCEDURE trg_catalog_group_rename();

-- Vehicle applications are searchable text on the phone, so renaming a make,
-- model, or engine changes every part fitted to it.
CREATE OR REPLACE FUNCTION trg_catalog_application_change() RETURNS trigger AS $$
BEGIN
  INSERT INTO catalog_change_log (part_id, change_type)
  SELECT pa.part_id, 'upsert'
    FROM part_application pa
   WHERE pa.application_id = COALESCE(NEW.application_id, OLD.application_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS application_catalog_change ON application;
CREATE TRIGGER application_catalog_change
AFTER UPDATE ON application
FOR EACH ROW EXECUTE PROCEDURE trg_catalog_application_change();

-- Keeps the log from growing without bound. Anything older than 30 days is
-- past the point where an incremental catch-up makes sense: a phone that stale
-- re-bootstraps from scratch instead, which is cheaper than replaying months
-- of history.
CREATE OR REPLACE FUNCTION prune_catalog_change_log(p_keep_days INTEGER DEFAULT 30)
RETURNS bigint AS $$
DECLARE
  removed bigint;
BEGIN
  DELETE FROM catalog_change_log
   WHERE changed_at < NOW() - (p_keep_days || ' days')::interval;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$ LANGUAGE plpgsql;
