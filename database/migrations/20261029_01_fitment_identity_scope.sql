-- Migration: 20261029_01_fitment_identity_scope.sql
-- Purpose: Add canonical identity status/keys, vehicle_chassis table, application chassis scope & hierarchy trigger, and fitment_taxonomy_meta version counter.
-- Additive & idempotent. Preserves existing duplicate rows as legacy_unverified without deleting or merging live data.

BEGIN;

-- 1. Normalization helper functions in SQL
CREATE OR REPLACE FUNCTION fitment_normalize_name_key(val TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT regexp_replace(lower(btrim(COALESCE(val, ''))), '[^a-z0-9]+', '', 'g');
$$;

CREATE OR REPLACE FUNCTION fitment_normalize_code_key(val TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT regexp_replace(upper(btrim(COALESCE(val, ''))), '[^A-Z0-9]+', '', 'g');
$$;

-- 2. Extend vehicle_make
ALTER TABLE vehicle_make
    ADD COLUMN IF NOT EXISTS identity_status TEXT NOT NULL DEFAULT 'legacy_unverified',
    ADD COLUMN IF NOT EXISTS identity_key TEXT,
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_make_identity_status_chk'
    ) THEN
        ALTER TABLE vehicle_make
            ADD CONSTRAINT vehicle_make_identity_status_chk
            CHECK (identity_status IN ('verified', 'legacy_unverified', 'needs_review', 'rejected', 'superseded'));
    END IF;
END $$;

UPDATE vehicle_make
SET identity_key = fitment_normalize_name_key(make_name)
WHERE identity_key IS NULL OR identity_key = '';

ALTER TABLE vehicle_make
    ALTER COLUMN identity_key SET NOT NULL;

CREATE OR REPLACE FUNCTION trg_fn_vehicle_make_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.identity_key IS NULL OR btrim(NEW.identity_key) = '' THEN
        NEW.identity_key := fitment_normalize_name_key(NEW.make_name);
    END IF;
    IF TG_OP = 'UPDATE' AND ROW(NEW.make_name, NEW.identity_status, NEW.identity_key) IS DISTINCT FROM ROW(OLD.make_name, OLD.identity_status, OLD.identity_key) THEN
        NEW.row_version := COALESCE(OLD.row_version, 1) + 1;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vehicle_make_identity ON vehicle_make;
CREATE TRIGGER trg_vehicle_make_identity
BEFORE INSERT OR UPDATE ON vehicle_make
FOR EACH ROW EXECUTE FUNCTION trg_fn_vehicle_make_identity();

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_make_verified_identity_key
    ON vehicle_make (identity_key)
    WHERE identity_status = 'verified';

-- 3. Extend vehicle_model
ALTER TABLE vehicle_model
    ADD COLUMN IF NOT EXISTS identity_status TEXT NOT NULL DEFAULT 'legacy_unverified',
    ADD COLUMN IF NOT EXISTS identity_key TEXT,
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_model_identity_status_chk'
    ) THEN
        ALTER TABLE vehicle_model
            ADD CONSTRAINT vehicle_model_identity_status_chk
            CHECK (identity_status IN ('verified', 'legacy_unverified', 'needs_review', 'rejected', 'superseded'));
    END IF;
END $$;

UPDATE vehicle_model
SET identity_key = fitment_normalize_name_key(model_name)
WHERE identity_key IS NULL OR identity_key = '';

ALTER TABLE vehicle_model
    ALTER COLUMN identity_key SET NOT NULL;

CREATE OR REPLACE FUNCTION trg_fn_vehicle_model_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.identity_key IS NULL OR btrim(NEW.identity_key) = '' THEN
        NEW.identity_key := fitment_normalize_name_key(NEW.model_name);
    END IF;
    IF TG_OP = 'UPDATE' AND ROW(NEW.make_id, NEW.model_name, NEW.identity_status, NEW.identity_key) IS DISTINCT FROM ROW(OLD.make_id, OLD.model_name, OLD.identity_status, OLD.identity_key) THEN
        NEW.row_version := COALESCE(OLD.row_version, 1) + 1;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vehicle_model_identity ON vehicle_model;
CREATE TRIGGER trg_vehicle_model_identity
BEFORE INSERT OR UPDATE ON vehicle_model
FOR EACH ROW EXECUTE FUNCTION trg_fn_vehicle_model_identity();

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_model_verified_identity_key
    ON vehicle_model (make_id, identity_key)
    WHERE identity_status = 'verified';

-- 4. Extend engine
ALTER TABLE engine
    ADD COLUMN IF NOT EXISTS namespace_key TEXT NOT NULL DEFAULT 'global',
    ADD COLUMN IF NOT EXISTS identity_status TEXT NOT NULL DEFAULT 'legacy_unverified',
    ADD COLUMN IF NOT EXISTS identity_key TEXT,
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'engine_identity_status_chk'
    ) THEN
        ALTER TABLE engine
            ADD CONSTRAINT engine_identity_status_chk
            CHECK (identity_status IN ('verified', 'legacy_unverified', 'needs_review', 'rejected', 'superseded'));
    END IF;
END $$;

UPDATE engine
SET identity_key = fitment_normalize_code_key(engine_code)
WHERE identity_key IS NULL OR identity_key = '';

ALTER TABLE engine
    ALTER COLUMN identity_key SET NOT NULL;

CREATE OR REPLACE FUNCTION trg_fn_engine_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.namespace_key IS NULL OR btrim(NEW.namespace_key) = '' THEN
        NEW.namespace_key := 'global';
    END IF;
    IF NEW.identity_key IS NULL OR btrim(NEW.identity_key) = '' THEN
        NEW.identity_key := fitment_normalize_code_key(NEW.engine_code);
    END IF;
    IF TG_OP = 'UPDATE' AND ROW(NEW.engine_code, NEW.namespace_key, NEW.identity_status, NEW.identity_key, NEW.displacement_liters, NEW.fuel_type) IS DISTINCT FROM ROW(OLD.engine_code, OLD.namespace_key, OLD.identity_status, OLD.identity_key, OLD.displacement_liters, OLD.fuel_type) THEN
        NEW.row_version := COALESCE(OLD.row_version, 1) + 1;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_engine_identity ON engine;
CREATE TRIGGER trg_engine_identity
BEFORE INSERT OR UPDATE ON engine
FOR EACH ROW EXECUTE FUNCTION trg_fn_engine_identity();

CREATE UNIQUE INDEX IF NOT EXISTS uq_engine_verified_identity_key
    ON engine (namespace_key, identity_key)
    WHERE identity_status = 'verified';

-- 5. Create vehicle_chassis table
-- Note: model_id is required when identity_status = 'verified', and may be NULL when identity_status IN ('legacy_unverified', 'needs_review') so chassis-only unverified claims do not fabricate a model.
CREATE TABLE IF NOT EXISTS vehicle_chassis (
    chassis_id SERIAL PRIMARY KEY,
    model_id INTEGER REFERENCES vehicle_model(model_id) ON DELETE RESTRICT,
    chassis_code VARCHAR(100) NOT NULL,
    identity_key TEXT NOT NULL,
    generation VARCHAR(100),
    year_start INTEGER,
    year_end INTEGER,
    market VARCHAR(50),
    identity_status TEXT NOT NULL DEFAULT 'legacy_unverified'
        CHECK (identity_status IN ('verified', 'legacy_unverified', 'needs_review', 'rejected', 'superseded')),
    row_version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT vehicle_chassis_years_chk CHECK (year_start IS NULL OR year_end IS NULL OR year_start <= year_end),
    CONSTRAINT vehicle_chassis_verified_model_chk CHECK (identity_status <> 'verified' OR model_id IS NOT NULL)
);

CREATE OR REPLACE FUNCTION trg_fn_vehicle_chassis_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.identity_key IS NULL OR btrim(NEW.identity_key) = '' THEN
        NEW.identity_key := fitment_normalize_code_key(NEW.chassis_code);
    END IF;
    NEW.updated_at := NOW();
    IF TG_OP = 'UPDATE' AND ROW(NEW.model_id, NEW.chassis_code, NEW.identity_key, NEW.generation, NEW.year_start, NEW.year_end, NEW.market, NEW.identity_status) IS DISTINCT FROM ROW(OLD.model_id, OLD.chassis_code, OLD.identity_key, OLD.generation, OLD.year_start, OLD.year_end, OLD.market, OLD.identity_status) THEN
        NEW.row_version := COALESCE(OLD.row_version, 1) + 1;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vehicle_chassis_identity ON vehicle_chassis;
CREATE TRIGGER trg_vehicle_chassis_identity
BEFORE INSERT OR UPDATE ON vehicle_chassis
FOR EACH ROW EXECUTE FUNCTION trg_fn_vehicle_chassis_identity();

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_chassis_model_code
    ON vehicle_chassis (model_id, lower(btrim(chassis_code)))
    WHERE model_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_chassis_unscoped_code
    ON vehicle_chassis (lower(btrim(chassis_code)))
    WHERE model_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_chassis_verified_identity_key
    ON vehicle_chassis (model_id, identity_key)
    WHERE identity_status = 'verified' AND model_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vehicle_chassis_model_id ON vehicle_chassis(model_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_chassis_identity_key ON vehicle_chassis(identity_key);

-- 6. Extend application table with chassis_id, identity_status, row_version
ALTER TABLE application
    ADD COLUMN IF NOT EXISTS chassis_id INTEGER REFERENCES vehicle_chassis(chassis_id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS identity_status TEXT NOT NULL DEFAULT 'legacy_unverified',
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'application_identity_status_chk'
    ) THEN
        ALTER TABLE application
            ADD CONSTRAINT application_identity_status_chk
            CHECK (identity_status IN ('verified', 'legacy_unverified', 'needs_review', 'rejected', 'superseded'));
    END IF;
END $$;

ALTER TABLE application DROP CONSTRAINT IF EXISTS application_at_least_one_dimension_chk;
ALTER TABLE application ADD CONSTRAINT application_at_least_one_dimension_chk
    CHECK (make_id IS NOT NULL OR model_id IS NOT NULL OR engine_id IS NOT NULL OR chassis_id IS NOT NULL);

-- Scope legacy partial unique indexes with AND chassis_id IS NULL
DROP INDEX IF EXISTS uq_application_make_model_engine_nn;
CREATE UNIQUE INDEX IF NOT EXISTS uq_application_make_model_engine_nn
    ON application (make_id, model_id, engine_id)
    WHERE make_id IS NOT NULL AND model_id IS NOT NULL AND engine_id IS NOT NULL AND chassis_id IS NULL;

DROP INDEX IF EXISTS uq_application_make_model_no_engine;
CREATE UNIQUE INDEX IF NOT EXISTS uq_application_make_model_no_engine
    ON application (make_id, model_id)
    WHERE make_id IS NOT NULL AND model_id IS NOT NULL AND engine_id IS NULL AND chassis_id IS NULL;

DROP INDEX IF EXISTS uq_application_make_only;
CREATE UNIQUE INDEX IF NOT EXISTS uq_application_make_only
    ON application (make_id)
    WHERE make_id IS NOT NULL AND model_id IS NULL AND engine_id IS NULL AND chassis_id IS NULL;

DROP INDEX IF EXISTS uq_application_engine_only;
CREATE UNIQUE INDEX IF NOT EXISTS uq_application_engine_only
    ON application (engine_id)
    WHERE make_id IS NULL AND model_id IS NULL AND engine_id IS NOT NULL AND chassis_id IS NULL;

-- Deduplicate any existing application rows where make_id was NULL but model_id was set if a matching (make_id, model_id, engine_id, chassis_id) row exists, before creating NULLS NOT DISTINCT index
DO $$
DECLARE
    r RECORD;
    canonical_id INTEGER;
BEGIN
    FOR r IN
        SELECT a.application_id, a.model_id, a.engine_id, a.chassis_id, vm.make_id AS derived_make_id
        FROM application a
        JOIN vehicle_model vm ON vm.model_id = a.model_id
        WHERE a.make_id IS NULL
    LOOP
        SELECT application_id INTO canonical_id
        FROM application
        WHERE make_id = r.derived_make_id
          AND model_id = r.model_id
          AND engine_id IS NOT DISTINCT FROM r.engine_id
          AND chassis_id IS NOT DISTINCT FROM r.chassis_id
          AND application_id <> r.application_id
        ORDER BY application_id ASC
        LIMIT 1;

        IF canonical_id IS NOT NULL THEN
            UPDATE part_application
            SET application_id = canonical_id
            WHERE application_id = r.application_id
              AND NOT EXISTS (
                  SELECT 1 FROM part_application pa2
                  WHERE pa2.part_id = part_application.part_id
                    AND pa2.application_id = canonical_id
              );
            DELETE FROM part_application WHERE application_id = r.application_id;
            DELETE FROM application WHERE application_id = r.application_id;
        ELSE
            UPDATE application SET make_id = r.derived_make_id WHERE application_id = r.application_id;
        END IF;
    END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_application_identity_tuple
    ON application (make_id, model_id, chassis_id, engine_id) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_application_chassis_id ON application(chassis_id);

-- Hierarchy validation & parent derivation trigger on application
CREATE OR REPLACE FUNCTION trg_fn_application_validate_hierarchy()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_chassis_model_id INTEGER;
    v_model_make_id INTEGER;
BEGIN
    IF NEW.chassis_id IS NOT NULL THEN
        SELECT model_id INTO v_chassis_model_id
        FROM vehicle_chassis
        WHERE chassis_id = NEW.chassis_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Invalid chassis_id %', NEW.chassis_id USING ERRCODE = '23503';
        END IF;

        IF v_chassis_model_id IS NOT NULL THEN
            IF NEW.model_id IS NULL THEN
                NEW.model_id := v_chassis_model_id;
            ELSIF NEW.model_id <> v_chassis_model_id THEN
                RAISE EXCEPTION 'Application model_id (%) does not match vehicle_chassis.model_id (%) for chassis_id %',
                    NEW.model_id, v_chassis_model_id, NEW.chassis_id
                    USING ERRCODE = '23514';
            END IF;
        END IF;
    END IF;

    IF NEW.model_id IS NOT NULL THEN
        SELECT make_id INTO v_model_make_id
        FROM vehicle_model
        WHERE model_id = NEW.model_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Invalid model_id %', NEW.model_id USING ERRCODE = '23503';
        END IF;

        IF NEW.make_id IS NULL THEN
            NEW.make_id := v_model_make_id;
        ELSIF NEW.make_id <> v_model_make_id THEN
            RAISE EXCEPTION 'Application make_id (%) does not match vehicle_model.make_id (%) for model_id %',
                NEW.make_id, v_model_make_id, NEW.model_id
                USING ERRCODE = '23514';
        END IF;
    END IF;

    -- Make-only or chassis-only without model cannot be marked verified without explicit approval
    IF NEW.make_id IS NOT NULL AND NEW.model_id IS NULL AND NEW.engine_id IS NULL AND NEW.chassis_id IS NULL THEN
        IF TG_OP = 'INSERT' AND NEW.identity_status = 'legacy_unverified' THEN
            NEW.identity_status := 'needs_review';
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' AND ROW(NEW.make_id, NEW.model_id, NEW.chassis_id, NEW.engine_id, NEW.identity_status) IS DISTINCT FROM ROW(OLD.make_id, OLD.model_id, OLD.chassis_id, OLD.engine_id, OLD.identity_status) THEN
        NEW.row_version := COALESCE(OLD.row_version, 1) + 1;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_application_validate_hierarchy ON application;
CREATE TRIGGER trg_application_validate_hierarchy
BEFORE INSERT OR UPDATE ON application
FOR EACH ROW EXECUTE FUNCTION trg_fn_application_validate_hierarchy();

-- 7. Create fitment_taxonomy_meta for DB-backed cache invalidation
CREATE TABLE IF NOT EXISTS fitment_taxonomy_meta (
    singleton_id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton_id = TRUE),
    taxonomy_version BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO fitment_taxonomy_meta (singleton_id, taxonomy_version, updated_at)
VALUES (TRUE, 1, NOW())
ON CONFLICT (singleton_id) DO NOTHING;

CREATE OR REPLACE FUNCTION trg_fn_bump_fitment_taxonomy_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO fitment_taxonomy_meta (singleton_id, taxonomy_version, updated_at)
    VALUES (TRUE, 2, NOW())
    ON CONFLICT (singleton_id)
    DO UPDATE SET
        taxonomy_version = fitment_taxonomy_meta.taxonomy_version + 1,
        updated_at = NOW();
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_taxonomy_vehicle_make ON vehicle_make;
CREATE TRIGGER trg_bump_taxonomy_vehicle_make
AFTER INSERT OR UPDATE OR DELETE ON vehicle_make
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_bump_fitment_taxonomy_version();

DROP TRIGGER IF EXISTS trg_bump_taxonomy_vehicle_model ON vehicle_model;
CREATE TRIGGER trg_bump_taxonomy_vehicle_model
AFTER INSERT OR UPDATE OR DELETE ON vehicle_model
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_bump_fitment_taxonomy_version();

DROP TRIGGER IF EXISTS trg_bump_taxonomy_engine ON engine;
CREATE TRIGGER trg_bump_taxonomy_engine
AFTER INSERT OR UPDATE OR DELETE ON engine
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_bump_fitment_taxonomy_version();

DROP TRIGGER IF EXISTS trg_bump_taxonomy_vehicle_chassis ON vehicle_chassis;
CREATE TRIGGER trg_bump_taxonomy_vehicle_chassis
AFTER INSERT OR UPDATE OR DELETE ON vehicle_chassis
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_bump_fitment_taxonomy_version();

DROP TRIGGER IF EXISTS trg_bump_taxonomy_vehicle_engine_fitment ON vehicle_engine_fitment;
CREATE TRIGGER trg_bump_taxonomy_vehicle_engine_fitment
AFTER INSERT OR UPDATE OR DELETE ON vehicle_engine_fitment
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_bump_fitment_taxonomy_version();

-- 8. Update application_view while preserving existing column order and appending new columns
CREATE OR REPLACE VIEW application_view AS
SELECT
    a.application_id,
    a.make_id,
    a.model_id,
    a.engine_id,
    vmk.make_name AS make,
    vmd.model_name AS model,
    eng.engine_code AS engine,
    eng.displacement_liters,
    eng.fuel_type,
    a.chassis_id,
    vch.chassis_code AS chassis,
    a.identity_status,
    CASE
        WHEN a.identity_status = 'verified' THEN 'approved'
        WHEN a.identity_status = 'rejected' THEN 'rejected'
        ELSE 'needs_review'
    END AS approval_status,
    a.row_version
FROM application a
LEFT JOIN vehicle_make vmk ON a.make_id = vmk.make_id
LEFT JOIN vehicle_model vmd ON a.model_id = vmd.model_id
LEFT JOIN engine eng ON a.engine_id = eng.engine_id
LEFT JOIN vehicle_chassis vch ON a.chassis_id = vch.chassis_id;

COMMIT;
