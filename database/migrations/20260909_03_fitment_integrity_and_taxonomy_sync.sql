-- Migration: Vehicle fitment data integrity + taxonomy rename sync (Phase 2)
-- 1. Enforces year_start <= year_end on part_application and indexes the year
--    columns (needed by the upcoming vehicle-based search).
-- 2. Closes a sync gap: renaming a vehicle_make/vehicle_model/engine row did not
--    fire the Meilisearch/mobile catalog-sync notifications that already exist
--    for application/part_application changes, so a rename could silently go
--    stale in search results and the mobile offline catalog.
-- 2026-09-09

BEGIN;

-- 1. year_start <= year_end, enforced going forward.
DO $$
BEGIN
    UPDATE public.part_application
    SET year_end = year_start
    WHERE year_start IS NOT NULL AND year_end IS NOT NULL AND year_start > year_end;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'part_application_year_range_chk'
    ) THEN
        ALTER TABLE public.part_application
            ADD CONSTRAINT part_application_year_range_chk
            CHECK (year_start IS NULL OR year_end IS NULL OR year_start <= year_end);
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_part_application_years
    ON public.part_application (year_start, year_end);

-- 2. Shared helper: re-notify search/catalog sync for everything hanging off one
--    application row (mirrors the per-part logic already used by
--    trg_application_notify / trg_catalog_application_change).
CREATE OR REPLACE FUNCTION public.notify_application_change(p_application_id integer)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE r RECORD;
BEGIN
    IF p_application_id IS NULL THEN
        RETURN;
    END IF;
    FOR r IN SELECT part_id FROM part_application WHERE application_id = p_application_id LOOP
        PERFORM notify_meili_upsert_for_part(r.part_id);
        PERFORM log_catalog_change(r.part_id, 'upsert');
    END LOOP;
    PERFORM pg_notify('meili_app_sync', json_build_object('action', 'upsert', 'application_id', p_application_id)::text);
END;
$$;

-- vehicle_make rename -> resync every application under that make.
CREATE OR REPLACE FUNCTION public.trg_vehicle_make_rename_notify()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE r RECORD;
BEGIN
    IF NEW.make_name IS DISTINCT FROM OLD.make_name THEN
        FOR r IN SELECT application_id FROM application WHERE make_id = NEW.make_id LOOP
            PERFORM notify_application_change(r.application_id);
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vehicle_make_rename_notify ON public.vehicle_make;
CREATE TRIGGER vehicle_make_rename_notify
    AFTER UPDATE ON public.vehicle_make
    FOR EACH ROW EXECUTE FUNCTION public.trg_vehicle_make_rename_notify();

-- vehicle_model rename -> resync every application under that model.
CREATE OR REPLACE FUNCTION public.trg_vehicle_model_rename_notify()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE r RECORD;
BEGIN
    IF NEW.model_name IS DISTINCT FROM OLD.model_name THEN
        FOR r IN SELECT application_id FROM application WHERE model_id = NEW.model_id LOOP
            PERFORM notify_application_change(r.application_id);
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vehicle_model_rename_notify ON public.vehicle_model;
CREATE TRIGGER vehicle_model_rename_notify
    AFTER UPDATE ON public.vehicle_model
    FOR EACH ROW EXECUTE FUNCTION public.trg_vehicle_model_rename_notify();

-- engine rename -> resync every application referencing that engine (this is
-- now the highest-impact case, since one engine row is shared across many
-- makes/models after the Phase 0 redesign).
CREATE OR REPLACE FUNCTION public.trg_engine_rename_notify()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE r RECORD;
BEGIN
    IF NEW.engine_code IS DISTINCT FROM OLD.engine_code THEN
        FOR r IN SELECT application_id FROM application WHERE engine_id = NEW.engine_id LOOP
            PERFORM notify_application_change(r.application_id);
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS engine_rename_notify ON public.engine;
CREATE TRIGGER engine_rename_notify
    AFTER UPDATE ON public.engine
    FOR EACH ROW EXECUTE FUNCTION public.trg_engine_rename_notify();

COMMIT;
