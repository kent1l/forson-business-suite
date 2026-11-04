-- Vehicle combinations and direct part links. Existing evidence/history is archived in place.
BEGIN;
ALTER TABLE application
    ADD COLUMN IF NOT EXISTS year_start INTEGER,
    ADD COLUMN IF NOT EXISTS year_end INTEGER,
    ADD COLUMN IF NOT EXISTS market TEXT,
    ADD COLUMN IF NOT EXISTS variant_descriptor TEXT,
    ADD COLUMN IF NOT EXISTS drivetrain TEXT,
    ADD COLUMN IF NOT EXISTS transmission TEXT,
    ADD COLUMN IF NOT EXISTS generation TEXT,
    ADD COLUMN IF NOT EXISTS fuel_type_qualifier TEXT,
    ADD COLUMN IF NOT EXISTS displacement_liters_qualifier NUMERIC(3,1);

-- Replace the older four-dimension uniqueness indexes with the complete classification.
-- Restrict this operation to the known indexes, preserving unrelated/custom indexes.
DROP INDEX IF EXISTS uq_application_make_model_engine_nn;
DROP INDEX IF EXISTS uq_application_make_model_no_engine;
DROP INDEX IF EXISTS uq_application_make_only;
DROP INDEX IF EXISTS uq_application_engine_only;
DROP INDEX IF EXISTS uq_application_identity_tuple;
DROP INDEX IF EXISTS application_engine_only_unique_idx;
DROP INDEX IF EXISTS application_full_unique_idx;
DROP INDEX IF EXISTS application_make_engine_unique_idx;
DROP INDEX IF EXISTS application_make_model_unique_idx;
DROP INDEX IF EXISTS application_make_only_unique_idx;
DROP INDEX IF EXISTS application_model_engine_unique_idx;
DROP INDEX IF EXISTS application_model_only_unique_idx;
ALTER TABLE application DROP CONSTRAINT IF EXISTS unique_application_make_model_engine;
CREATE UNIQUE INDEX IF NOT EXISTS uq_application_combination ON application (
    make_id,model_id,chassis_id,engine_id,year_start,year_end,
    (lower(btrim(market))),(lower(btrim(variant_descriptor))),
    (lower(btrim(drivetrain))),(lower(btrim(transmission))),(lower(btrim(generation))),
    fuel_type_qualifier,displacement_liters_qualifier
) NULLS NOT DISTINCT;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='application_combination_years_chk') THEN
        ALTER TABLE application ADD CONSTRAINT application_combination_years_chk CHECK (
            (year_start IS NULL OR year_start BETWEEN 1900 AND 2100)
            AND (year_end IS NULL OR year_end BETWEEN 1900 AND 2100)
            AND (year_start IS NULL OR year_end IS NULL OR year_start<=year_end));
        ALTER TABLE application ADD CONSTRAINT application_combination_fuel_chk CHECK (
            fuel_type_qualifier IS NULL OR fuel_type_qualifier IN ('diesel','gasoline','hybrid','electric','lpg','other'));
        ALTER TABLE application ADD CONSTRAINT application_combination_displacement_chk CHECK (
            displacement_liters_qualifier IS NULL OR displacement_liters_qualifier>0 AND displacement_liters_qualifier<20);
    END IF;
END $$;

-- Keep relational validation/versioning; remove approval gates and new approval state.
DROP TRIGGER IF EXISTS trg_fitment_unrestricted_guard ON part_application_rule;
DROP TRIGGER IF EXISTS trg_fitment_application_history_guard ON application;
ALTER TABLE part_application_rule
    ALTER COLUMN approval_status DROP NOT NULL,
    ALTER COLUMN approval_status DROP DEFAULT,
    ALTER COLUMN evidence_status DROP NOT NULL,
    ALTER COLUMN evidence_status DROP DEFAULT;
CREATE OR REPLACE FUNCTION trg_fn_part_application_rule_validate()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_app RECORD;
BEGIN
    SELECT make_id, model_id, chassis_id, engine_id
    INTO v_app
    FROM application
    WHERE application_id = NEW.application_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid application_id % on part_application_rule', NEW.application_id USING ERRCODE = '23503';
    END IF;

    -- Synchronize or validate identity modes against application foreign keys
    IF v_app.make_id IS NOT NULL THEN
        NEW.make_mode := 'specified';
    ELSIF NEW.make_mode = 'specified' THEN
        RAISE EXCEPTION 'make_mode cannot be specified when application.make_id IS NULL' USING ERRCODE = '23514';
    END IF;

    IF v_app.model_id IS NOT NULL THEN
        NEW.model_mode := 'specified';
    ELSIF NEW.model_mode = 'specified' THEN
        RAISE EXCEPTION 'model_mode cannot be specified when application.model_id IS NULL' USING ERRCODE = '23514';
    END IF;

    IF v_app.chassis_id IS NOT NULL THEN
        NEW.chassis_mode := 'specified';
    ELSIF NEW.chassis_mode = 'specified' THEN
        RAISE EXCEPTION 'chassis_mode cannot be specified when application.chassis_id IS NULL' USING ERRCODE = '23514';
    END IF;

    IF v_app.engine_id IS NOT NULL THEN
        NEW.engine_mode := 'specified';
    ELSIF NEW.engine_mode = 'specified' THEN
        RAISE EXCEPTION 'engine_mode cannot be specified when application.engine_id IS NULL' USING ERRCODE = '23514';
    END IF;

    -- Auto-normalize qualifier modes when values are set or cleared
    IF NEW.year_start IS NOT NULL OR NEW.year_end IS NOT NULL THEN
        NEW.year_mode := 'specified';
    ELSIF NEW.year_mode = 'specified' THEN
        NEW.year_mode := 'not_supplied';
    END IF;

    IF NEW.market IS NOT NULL AND btrim(NEW.market) <> '' THEN
        NEW.market := btrim(NEW.market);
        NEW.market_mode := 'specified';
    ELSE
        NEW.market := NULL;
        IF NEW.market_mode = 'specified' THEN NEW.market_mode := 'not_supplied'; END IF;
    END IF;

    IF NEW.variant_descriptor IS NOT NULL AND btrim(NEW.variant_descriptor) <> '' THEN
        NEW.variant_descriptor := btrim(NEW.variant_descriptor);
        NEW.variant_mode := 'specified';
    ELSE
        NEW.variant_descriptor := NULL;
        IF NEW.variant_mode = 'specified' THEN NEW.variant_mode := 'not_supplied'; END IF;
    END IF;

    IF NEW.position IS NOT NULL AND btrim(NEW.position) <> '' THEN
        NEW.position := btrim(NEW.position);
        NEW.position_mode := 'specified';
    ELSE
        NEW.position := NULL;
        IF NEW.position_mode = 'specified' THEN NEW.position_mode := 'not_supplied'; END IF;
    END IF;

    IF NEW.drivetrain IS NOT NULL AND btrim(NEW.drivetrain) <> '' THEN
        NEW.drivetrain := btrim(NEW.drivetrain);
        NEW.drivetrain_mode := 'specified';
    ELSE
        NEW.drivetrain := NULL;
        IF NEW.drivetrain_mode = 'specified' THEN NEW.drivetrain_mode := 'not_supplied'; END IF;
    END IF;

    IF NEW.transmission IS NOT NULL AND btrim(NEW.transmission) <> '' THEN
        NEW.transmission := btrim(NEW.transmission);
        NEW.transmission_mode := 'specified';
    ELSE
        NEW.transmission := NULL;
        IF NEW.transmission_mode = 'specified' THEN NEW.transmission_mode := 'not_supplied'; END IF;
    END IF;

    IF NEW.fuel_type_qualifier IS NOT NULL THEN
        NEW.fuel_mode := 'specified';
    ELSIF NEW.fuel_mode = 'specified' THEN
        NEW.fuel_mode := 'not_supplied';
    END IF;

    IF NEW.displacement_liters_qualifier IS NOT NULL THEN
        NEW.displacement_mode := 'specified';
    ELSIF NEW.displacement_mode = 'specified' THEN
        NEW.displacement_mode := 'not_supplied';
    END IF;

    IF NEW.generation IS NOT NULL AND btrim(NEW.generation) <> '' THEN
        NEW.generation := btrim(NEW.generation);
        NEW.generation_mode := 'specified';
    ELSE
        NEW.generation := NULL;
        IF NEW.generation_mode = 'specified' THEN NEW.generation_mode := 'not_supplied'; END IF;
    END IF;

    NEW.updated_at := NOW();
    IF TG_OP = 'UPDATE' THEN
        NEW.row_version := COALESCE(OLD.row_version, 1) + 1;
    END IF;

    RETURN NEW;
END;
$$;


CREATE OR REPLACE FUNCTION trg_fn_vehicle_combination_version() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.row_version := OLD.row_version+1;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_vehicle_combination_version ON application;
CREATE TRIGGER trg_vehicle_combination_version BEFORE UPDATE ON application
FOR EACH ROW EXECUTE FUNCTION trg_fn_vehicle_combination_version();

CREATE OR REPLACE VIEW application_view AS
SELECT a.application_id,a.make_id,a.model_id,a.engine_id,
    mk.make_name AS make,mo.model_name AS model,e.engine_code AS engine,
    COALESCE(a.displacement_liters_qualifier,e.displacement_liters)::numeric(4,2) AS displacement_liters,
    COALESCE(a.fuel_type_qualifier,e.fuel_type) AS fuel_type,
    a.chassis_id,ch.chassis_code AS chassis,a.identity_status,
    CASE WHEN a.identity_status='verified' THEN 'approved' WHEN a.identity_status='rejected' THEN 'rejected' ELSE 'needs_review' END AS approval_status,
    a.row_version,a.year_start,a.year_end,a.market,a.variant_descriptor,a.drivetrain,a.transmission,a.generation,
    a.fuel_type_qualifier,a.displacement_liters_qualifier
FROM application a
LEFT JOIN vehicle_make mk USING(make_id)
LEFT JOIN vehicle_model mo USING(model_id)
LEFT JOIN engine e USING(engine_id)
LEFT JOIN vehicle_chassis ch USING(chassis_id);

CREATE OR REPLACE FUNCTION trg_fn_vehicle_combination_delete_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS(SELECT 1 FROM part_application WHERE application_id=OLD.application_id)
       OR EXISTS(SELECT 1 FROM part_application_rule WHERE application_id=OLD.application_id AND is_active) THEN
        RAISE EXCEPTION 'Unlink the vehicle combination from its parts before deleting it' USING ERRCODE='55000';
    END IF;
    RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_vehicle_combination_delete_guard ON application;
CREATE TRIGGER trg_vehicle_combination_delete_guard BEFORE DELETE ON application
FOR EACH ROW EXECUTE FUNCTION trg_fn_vehicle_combination_delete_guard();
COMMIT;
