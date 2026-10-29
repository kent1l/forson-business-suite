-- Migration: 20261029_02_fitment_claim_rules.sql
-- Purpose: Add part_application_rule (with explicit scope modes and qualifiers), fitment_claim, fitment_audit, and non-destructive backfill of legacy part_application rows.

BEGIN;

-- 1. Create fitment_claim
CREATE TABLE IF NOT EXISTS fitment_claim (
    claim_id SERIAL PRIMARY KEY,
    part_id INTEGER NOT NULL REFERENCES part(part_id) ON DELETE CASCADE,
    application_id INTEGER REFERENCES application(application_id) ON DELETE SET NULL,
    source_type TEXT NOT NULL DEFAULT 'legacy_migration'
        CHECK (source_type IN ('manual_ui', 'text_import', 'ai_parse', 'po_receive', 'part_form', 'web_research', 'catalog_sync', 'legacy_migration')),
    raw_text TEXT,
    normalized_text TEXT,
    clause_text TEXT,
    clause_span JSONB,
    parser_mode TEXT NOT NULL DEFAULT 'legacy'
        CHECK (parser_mode IN ('deterministic', 'ai_fallback', 'hybrid', 'manual', 'legacy')),
    claim_effect TEXT NOT NULL DEFAULT 'include'
        CHECK (claim_effect IN ('include', 'exclude')),
    approval_status TEXT NOT NULL DEFAULT 'legacy_unverified'
        CHECK (approval_status IN ('draft', 'needs_review', 'approved', 'rejected', 'superseded', 'legacy_unverified')),
    evidence_status TEXT NOT NULL DEFAULT 'legacy_unverified'
        CHECK (evidence_status IN ('sourced_verified', 'sourced_suggestion', 'user_declared', 'unverified_ai', 'legacy_unverified', 'conflicted', 'rejected')),
    confidence_label TEXT
        CHECK (confidence_label IS NULL OR confidence_label IN ('exact', 'high', 'medium', 'low', 'unresolved')),
    field_provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
    unresolved_Dimensions JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by INTEGER REFERENCES employee(employee_id) ON DELETE SET NULL,
    reviewed_by INTEGER REFERENCES employee(employee_id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    review_reason TEXT,
    row_version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fitment_claim_part_id ON fitment_claim(part_id);
CREATE INDEX IF NOT EXISTS idx_fitment_claim_application_id ON fitment_claim(application_id);
CREATE INDEX IF NOT EXISTS idx_fitment_claim_statuses ON fitment_claim(approval_status, evidence_status);

-- 2. Create part_application_rule
CREATE TABLE IF NOT EXISTS part_application_rule (
    rule_id SERIAL PRIMARY KEY,
    part_id INTEGER NOT NULL REFERENCES part(part_id) ON DELETE CASCADE,
    application_id INTEGER NOT NULL REFERENCES application(application_id) ON DELETE CASCADE,
    claim_id INTEGER REFERENCES fitment_claim(claim_id) ON DELETE SET NULL,
    effect TEXT NOT NULL DEFAULT 'include'
        CHECK (effect IN ('include', 'exclude')),

    -- Canonical identity scope modes
    make_mode TEXT NOT NULL DEFAULT 'specified'
        CHECK (make_mode IN ('specified', 'unrestricted', 'not_supplied', 'unknown', 'not_applicable')),
    model_mode TEXT NOT NULL DEFAULT 'not_supplied'
        CHECK (model_mode IN ('specified', 'unrestricted', 'not_supplied', 'unknown', 'not_applicable')),
    chassis_mode TEXT NOT NULL DEFAULT 'not_supplied'
        CHECK (chassis_mode IN ('specified', 'unrestricted', 'not_supplied', 'unknown', 'not_applicable')),
    engine_mode TEXT NOT NULL DEFAULT 'not_supplied'
        CHECK (engine_mode IN ('specified', 'unrestricted', 'not_supplied', 'unknown', 'not_applicable')),

    -- Typed qualifiers & their scope modes
    year_start SMALLINT CHECK (year_start IS NULL OR (year_start >= 1900 AND year_start <= 2100)),
    year_end SMALLINT CHECK (year_end IS NULL OR (year_end >= 1900 AND year_end <= 2100)),
    year_mode TEXT NOT NULL DEFAULT 'not_supplied'
        CHECK (year_mode IN ('specified', 'unrestricted', 'not_supplied', 'unknown', 'not_applicable')),

    market TEXT,
    market_mode TEXT NOT NULL DEFAULT 'not_supplied'
        CHECK (market_mode IN ('specified', 'unrestricted', 'not_supplied', 'unknown', 'not_applicable')),

    variant_descriptor TEXT,
    variant_mode TEXT NOT NULL DEFAULT 'not_supplied'
        CHECK (variant_mode IN ('specified', 'unrestricted', 'not_supplied', 'unknown', 'not_applicable')),

    position TEXT,
    position_mode TEXT NOT NULL DEFAULT 'not_supplied'
        CHECK (position_mode IN ('specified', 'unrestricted', 'not_supplied', 'unknown', 'not_applicable')),

    drivetrain TEXT,
    drivetrain_mode TEXT NOT NULL DEFAULT 'not_supplied'
        CHECK (drivetrain_mode IN ('specified', 'unrestricted', 'not_supplied', 'unknown', 'not_applicable')),

    transmission TEXT,
    transmission_mode TEXT NOT NULL DEFAULT 'not_supplied'
        CHECK (transmission_mode IN ('specified', 'unrestricted', 'not_supplied', 'unknown', 'not_applicable')),

    fuel_type_qualifier TEXT
        CHECK (fuel_type_qualifier IS NULL OR fuel_type_qualifier IN ('diesel', 'gasoline', 'hybrid', 'electric', 'lpg', 'other')),
    fuel_mode TEXT NOT NULL DEFAULT 'not_supplied'
        CHECK (fuel_mode IN ('specified', 'unrestricted', 'not_supplied', 'unknown', 'not_applicable')),

    displacement_liters_qualifier NUMERIC(3,1)
        CHECK (displacement_liters_qualifier IS NULL OR (displacement_liters_qualifier > 0 AND displacement_liters_qualifier < 20)),
    displacement_mode TEXT NOT NULL DEFAULT 'not_supplied'
        CHECK (displacement_mode IN ('specified', 'unrestricted', 'not_supplied', 'unknown', 'not_applicable')),

    generation TEXT,
    generation_mode TEXT NOT NULL DEFAULT 'not_supplied'
        CHECK (generation_mode IN ('specified', 'unrestricted', 'not_supplied', 'unknown', 'not_applicable')),

    condition_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    notes TEXT,

    approval_status TEXT NOT NULL DEFAULT 'legacy_unverified'
        CHECK (approval_status IN ('draft', 'needs_review', 'approved', 'rejected', 'superseded', 'legacy_unverified')),
    evidence_status TEXT NOT NULL DEFAULT 'legacy_unverified'
        CHECK (evidence_status IN ('sourced_verified', 'sourced_suggestion', 'user_declared', 'unverified_ai', 'legacy_unverified', 'conflicted', 'rejected')),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    row_version INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER REFERENCES employee(employee_id) ON DELETE SET NULL,
    updated_by INTEGER REFERENCES employee(employee_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Mode vs value consistency constraints
    CONSTRAINT par_year_range_chk CHECK (year_start IS NULL OR year_end IS NULL OR year_start <= year_end),
    CONSTRAINT par_year_mode_chk CHECK (
        (year_mode = 'specified' AND (year_start IS NOT NULL OR year_end IS NOT NULL))
        OR (year_mode <> 'specified' AND year_start IS NULL AND year_end IS NULL)
    ),
    CONSTRAINT par_market_mode_chk CHECK (
        (market_mode = 'specified' AND market IS NOT NULL AND btrim(market) <> '')
        OR (market_mode <> 'specified' AND market IS NULL)
    ),
    CONSTRAINT par_variant_mode_chk CHECK (
        (variant_mode = 'specified' AND variant_descriptor IS NOT NULL AND btrim(variant_descriptor) <> '')
        OR (variant_mode <> 'specified' AND variant_descriptor IS NULL)
    ),
    CONSTRAINT par_position_mode_chk CHECK (
        (position_mode = 'specified' AND position IS NOT NULL AND btrim(position) <> '')
        OR (position_mode <> 'specified' AND position IS NULL)
    ),
    CONSTRAINT par_drivetrain_mode_chk CHECK (
        (drivetrain_mode = 'specified' AND drivetrain IS NOT NULL AND btrim(drivetrain) <> '')
        OR (drivetrain_mode <> 'specified' AND drivetrain IS NULL)
    ),
    CONSTRAINT par_transmission_mode_chk CHECK (
        (transmission_mode = 'specified' AND transmission IS NOT NULL AND btrim(transmission) <> '')
        OR (transmission_mode <> 'specified' AND transmission IS NULL)
    ),
    CONSTRAINT par_fuel_mode_chk CHECK (
        (fuel_mode = 'specified' AND fuel_type_qualifier IS NOT NULL)
        OR (fuel_mode <> 'specified' AND fuel_type_qualifier IS NULL)
    ),
    CONSTRAINT par_displacement_mode_chk CHECK (
        (displacement_mode = 'specified' AND displacement_liters_qualifier IS NOT NULL)
        OR (displacement_mode <> 'specified' AND displacement_liters_qualifier IS NULL)
    ),
    CONSTRAINT par_generation_mode_chk CHECK (
        (generation_mode = 'specified' AND generation IS NOT NULL AND btrim(generation) <> '')
        OR (generation_mode <> 'specified' AND generation IS NULL)
    )
);

-- Trigger to enforce agreement between application(make_id, model_id, chassis_id, engine_id) and rule modes, and auto-increment row_version
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

    -- Unrestricted scope mode requires approved evidence
    IF (NEW.make_mode = 'unrestricted' OR NEW.model_mode = 'unrestricted' OR NEW.chassis_mode = 'unrestricted' OR NEW.engine_mode = 'unrestricted' OR NEW.year_mode = 'unrestricted')
       AND (NEW.approval_status <> 'approved' OR NEW.evidence_status <> 'sourced_verified') THEN
        RAISE EXCEPTION 'unrestricted scope mode requires approval_status = approved and evidence_status = sourced_verified' USING ERRCODE = '23514';
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

DROP TRIGGER IF EXISTS trg_part_application_rule_validate ON part_application_rule;
CREATE TRIGGER trg_part_application_rule_validate
BEFORE INSERT OR UPDATE ON part_application_rule
FOR EACH ROW EXECUTE FUNCTION trg_fn_part_application_rule_validate();

-- Semantic uniqueness index across all identity modes and qualifiers on active rules
CREATE UNIQUE INDEX IF NOT EXISTS uq_part_application_rule_semantic
    ON part_application_rule (
        part_id,
        application_id,
        effect,
        make_mode,
        model_mode,
        chassis_mode,
        engine_mode,
        year_mode,
        year_start,
        year_end,
        market_mode,
        market,
        variant_mode,
        variant_descriptor,
        position_mode,
        position,
        drivetrain_mode,
        drivetrain,
        transmission_mode,
        transmission,
        fuel_mode,
        fuel_type_qualifier,
        displacement_mode,
        displacement_liters_qualifier,
        generation_mode,
        generation
    ) NULLS NOT DISTINCT
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_part_application_rule_part_id ON part_application_rule(part_id);
CREATE INDEX IF NOT EXISTS idx_part_application_rule_application_id ON part_application_rule(application_id);
CREATE INDEX IF NOT EXISTS idx_part_application_rule_statuses ON part_application_rule(approval_status, evidence_status);

-- 3. Create fitment_audit table
CREATE TABLE IF NOT EXISTS fitment_audit (
    audit_id BIGSERIAL PRIMARY KEY,
    entity_type TEXT NOT NULL
        CHECK (entity_type IN ('application', 'part_application', 'part_application_rule', 'fitment_claim', 'fitment_evidence', 'fitment_alias', 'fitment_correction', 'fitment_review', 'taxonomy')),
    entity_id BIGINT NOT NULL,
    action TEXT NOT NULL,
    actor_id INTEGER REFERENCES employee(employee_id) ON DELETE SET NULL,
    reason TEXT,
    before_state JSONB,
    after_state JSONB,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fitment_audit_entity ON fitment_audit(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_fitment_audit_created_at ON fitment_audit(created_at DESC);

-- 4. Extend part_application with legacy_claim_id, legacy_rule_id, row_version
ALTER TABLE part_application
    ADD COLUMN IF NOT EXISTS legacy_claim_id INTEGER REFERENCES fitment_claim(claim_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS legacy_rule_id INTEGER REFERENCES part_application_rule(rule_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION trg_fn_part_application_row_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND ROW(NEW.part_id, NEW.application_id, NEW.year_start, NEW.year_end, NEW.legacy_claim_id, NEW.legacy_rule_id) IS DISTINCT FROM ROW(OLD.part_id, OLD.application_id, OLD.year_start, OLD.year_end, OLD.legacy_claim_id, OLD.legacy_rule_id) THEN
        NEW.row_version := COALESCE(OLD.row_version, 1) + 1;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_part_application_row_version ON part_application;
CREATE TRIGGER trg_part_application_row_version
BEFORE UPDATE ON part_application
FOR EACH ROW EXECUTE FUNCTION trg_fn_part_application_row_version();

-- 5. Backfill existing part_application rows into fitment_claim and part_application_rule as legacy_unverified
DO $$
DECLARE
    r RECORD;
    v_claim_id INTEGER;
    v_rule_id INTEGER;
BEGIN
    FOR r IN
        SELECT
            pa.part_app_id,
            pa.part_id,
            pa.application_id,
            pa.year_start,
            pa.year_end,
            a.make_id,
            a.model_id,
            a.chassis_id,
            a.engine_id
        FROM part_application pa
        JOIN application a ON a.application_id = pa.application_id
        WHERE pa.legacy_rule_id IS NULL
    LOOP
        INSERT INTO fitment_claim (
            part_id,
            application_id,
            source_type,
            parser_mode,
            claim_effect,
            approval_status,
            evidence_status,
            confidence_label,
            field_provenance
        ) VALUES (
            r.part_id,
            r.application_id,
            'legacy_migration',
            'legacy',
            'include',
            'legacy_unverified',
            'legacy_unverified',
            NULL,
            jsonb_build_object('migrated_from_part_app_id', r.part_app_id)
        )
        RETURNING claim_id INTO v_claim_id;

        INSERT INTO part_application_rule (
            part_id,
            application_id,
            claim_id,
            effect,
            make_mode,
            model_mode,
            chassis_mode,
            engine_mode,
            year_start,
            year_end,
            year_mode,
            approval_status,
            evidence_status
        ) VALUES (
            r.part_id,
            r.application_id,
            v_claim_id,
            'include',
            CASE WHEN r.make_id IS NOT NULL THEN 'specified' ELSE 'not_supplied' END,
            CASE WHEN r.model_id IS NOT NULL THEN 'specified' ELSE 'not_supplied' END,
            CASE WHEN r.chassis_id IS NOT NULL THEN 'specified' ELSE 'not_supplied' END,
            CASE WHEN r.engine_id IS NOT NULL THEN 'specified' ELSE 'not_supplied' END,
            r.year_start,
            r.year_end,
            CASE WHEN r.year_start IS NOT NULL OR r.year_end IS NOT NULL THEN 'specified' ELSE 'not_supplied' END,
            'legacy_unverified',
            'legacy_unverified'
        )
        ON CONFLICT DO NOTHING
        RETURNING rule_id INTO v_rule_id;

        IF v_rule_id IS NULL THEN
            SELECT rule_id INTO v_rule_id
            FROM part_application_rule
            WHERE part_id = r.part_id
              AND application_id = r.application_id
              AND effect = 'include'
              AND is_active = TRUE
            ORDER BY rule_id ASC
            LIMIT 1;
        END IF;

        UPDATE part_application
        SET legacy_claim_id = v_claim_id,
            legacy_rule_id = v_rule_id
        WHERE part_app_id = r.part_app_id;
    END LOOP;
END $$;

COMMIT;
