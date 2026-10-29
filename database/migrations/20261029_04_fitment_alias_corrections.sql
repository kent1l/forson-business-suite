-- Migration: 20261029_04_fitment_alias_corrections.sql
-- Purpose: Extend alias tables with scope/status/governance columns, attach taxonomy_version triggers, create fitment_correction and fitment_identity_mapping (non-destructive dry-run mapping), and seed applications:approve permission.

BEGIN;

-- 1. Extend vehicle_make_alias
ALTER TABLE vehicle_make_alias
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved',
    ADD COLUMN IF NOT EXISTS alias_kind TEXT NOT NULL DEFAULT 'canonical_synonym',
    ADD COLUMN IF NOT EXISTS reviewer_id INTEGER REFERENCES employee(employee_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reason TEXT,
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_make_alias_status_chk') THEN
        ALTER TABLE vehicle_make_alias
            ADD CONSTRAINT vehicle_make_alias_status_chk
            CHECK (status IN ('pending_review', 'approved', 'rejected', 'disabled'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_make_alias_kind_chk') THEN
        ALTER TABLE vehicle_make_alias
            ADD CONSTRAINT vehicle_make_alias_kind_chk
            CHECK (alias_kind IN ('canonical_synonym', 'orthographic_variant', 'local_market_name', 'abbreviation'));
    END IF;
END $$;

-- 2. Extend vehicle_model_alias with make_id scope and governance columns
ALTER TABLE vehicle_model_alias
    ADD COLUMN IF NOT EXISTS make_id INTEGER REFERENCES vehicle_make(make_id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved',
    ADD COLUMN IF NOT EXISTS alias_kind TEXT NOT NULL DEFAULT 'canonical_synonym',
    ADD COLUMN IF NOT EXISTS reviewer_id INTEGER REFERENCES employee(employee_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reason TEXT,
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;

UPDATE vehicle_model_alias vma
SET make_id = vm.make_id
FROM vehicle_model vm
WHERE vma.model_id = vm.model_id
  AND vma.make_id IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_model_alias_status_chk') THEN
        ALTER TABLE vehicle_model_alias
            ADD CONSTRAINT vehicle_model_alias_status_chk
            CHECK (status IN ('pending_review', 'approved', 'rejected', 'disabled'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_model_alias_kind_chk') THEN
        ALTER TABLE vehicle_model_alias
            ADD CONSTRAINT vehicle_model_alias_kind_chk
            CHECK (alias_kind IN ('canonical_synonym', 'orthographic_variant', 'local_market_name', 'abbreviation', 'chassis_synonym'));
    END IF;
END $$;

-- 3. Extend engine_alias with namespace_key and governance columns
ALTER TABLE engine_alias
    ADD COLUMN IF NOT EXISTS namespace_key TEXT NOT NULL DEFAULT 'global',
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved',
    ADD COLUMN IF NOT EXISTS alias_kind TEXT NOT NULL DEFAULT 'canonical_synonym',
    ADD COLUMN IF NOT EXISTS reviewer_id INTEGER REFERENCES employee(employee_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reason TEXT,
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engine_alias_status_chk') THEN
        ALTER TABLE engine_alias
            ADD CONSTRAINT engine_alias_status_chk
            CHECK (status IN ('pending_review', 'approved', 'rejected', 'disabled'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engine_alias_kind_chk') THEN
        ALTER TABLE engine_alias
            ADD CONSTRAINT engine_alias_kind_chk
            CHECK (alias_kind IN ('canonical_synonym', 'orthographic_variant', 'family_variant', 'abbreviation'));
    END IF;
END $$;

-- Attach taxonomy_version triggers to alias tables
DROP TRIGGER IF EXISTS trg_bump_taxonomy_vehicle_make_alias ON vehicle_make_alias;
CREATE TRIGGER trg_bump_taxonomy_vehicle_make_alias
AFTER INSERT OR UPDATE OR DELETE ON vehicle_make_alias
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_bump_fitment_taxonomy_version();

DROP TRIGGER IF EXISTS trg_bump_taxonomy_vehicle_model_alias ON vehicle_model_alias;
CREATE TRIGGER trg_bump_taxonomy_vehicle_model_alias
AFTER INSERT OR UPDATE OR DELETE ON vehicle_model_alias
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_bump_fitment_taxonomy_version();

DROP TRIGGER IF EXISTS trg_bump_taxonomy_engine_alias ON engine_alias;
CREATE TRIGGER trg_bump_taxonomy_engine_alias
AFTER INSERT OR UPDATE OR DELETE ON engine_alias
FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_bump_fitment_taxonomy_version();

-- 4. Create fitment_correction (extraction corrections stored separately from global aliases)
CREATE TABLE IF NOT EXISTS fitment_correction (
    correction_id SERIAL PRIMARY KEY,
    part_id INTEGER REFERENCES part(part_id) ON DELETE SET NULL,
    review_id INTEGER REFERENCES fitment_review(review_id) ON DELETE SET NULL,
    candidate_id INTEGER REFERENCES fitment_review_candidate(candidate_id) ON DELETE SET NULL,
    raw_clause_text TEXT NOT NULL,
    original_extraction JSONB NOT NULL DEFAULT '{}'::jsonb,
    corrected_extraction JSONB NOT NULL DEFAULT '{}'::jsonb,
    correction_type TEXT NOT NULL DEFAULT 'parser_extraction_fix'
        CHECK (correction_type IN ('parser_extraction_fix', 'scope_adjustment', 'qualifier_fix', 'disambiguation_choice', 'alias_candidate')),
    promote_to_alias BOOLEAN NOT NULL DEFAULT FALSE,
    promoted_alias_type TEXT
        CHECK (promoted_alias_type IS NULL OR promoted_alias_type IN ('make', 'model', 'engine', 'chassis')),
    promoted_alias_id INTEGER,
    status TEXT NOT NULL DEFAULT 'recorded'
        CHECK (status IN ('recorded', 'pending_alias_review', 'promoted', 'rejected')),
    reason TEXT,
    created_by INTEGER REFERENCES employee(employee_id) ON DELETE SET NULL,
    reviewed_by INTEGER REFERENCES employee(employee_id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fitment_correction_part_id ON fitment_correction(part_id);
CREATE INDEX IF NOT EXISTS idx_fitment_correction_review_id ON fitment_correction(review_id);

-- 5. Create fitment_identity_mapping (non-destructive dry-run mapping table for duplicate taxonomy groups)
CREATE TABLE IF NOT EXISTS fitment_identity_mapping (
    mapping_id SERIAL PRIMARY KEY,
    dimension TEXT NOT NULL
        CHECK (dimension IN ('make', 'model', 'engine', 'chassis')),
    scope_key TEXT NOT NULL DEFAULT 'global',
    identity_key TEXT NOT NULL,
    source_id INTEGER NOT NULL,
    source_label TEXT NOT NULL,
    canonical_id INTEGER,
    disposition TEXT NOT NULL DEFAULT 'preserve'
        CHECK (disposition IN ('preserve', 'unresolved_duplicate', 'proposed_merge', 'approved_merge')),
    reference_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
    notes TEXT,
    reviewed_by INTEGER REFERENCES employee(employee_id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (dimension, scope_key, source_id)
);

CREATE INDEX IF NOT EXISTS idx_fitment_identity_mapping_lookup
    ON fitment_identity_mapping (dimension, scope_key, identity_key);

-- Populate fitment_identity_mapping non-destructively (dry-run inventory of normalized identity collisions)
INSERT INTO fitment_identity_mapping (dimension, scope_key, identity_key, source_id, source_label, canonical_id, disposition, reference_counts, notes)
SELECT
    'make',
    'global',
    vm.identity_key,
    vm.make_id,
    vm.make_name,
    CASE WHEN cnt.group_size = 1 THEN vm.make_id ELSE NULL END,
    CASE WHEN cnt.group_size = 1 THEN 'preserve' ELSE 'unresolved_duplicate' END,
    jsonb_build_object(
        'models', (SELECT COUNT(*) FROM vehicle_model m WHERE m.make_id = vm.make_id),
        'applications', (SELECT COUNT(*) FROM application a WHERE a.make_id = vm.make_id)
    ),
    CASE WHEN cnt.group_size > 1 THEN 'Normalized make_name collision detected; requires human disambiguation before any merge' ELSE NULL END
FROM vehicle_make vm
JOIN (
    SELECT identity_key, COUNT(*) AS group_size
    FROM vehicle_make
    GROUP BY identity_key
) cnt ON cnt.identity_key = vm.identity_key
ON CONFLICT (dimension, scope_key, source_id) DO UPDATE SET
    identity_key = EXCLUDED.identity_key,
    source_label = EXCLUDED.source_label,
    disposition = EXCLUDED.disposition,
    reference_counts = EXCLUDED.reference_counts,
    notes = EXCLUDED.notes,
    updated_at = NOW();

INSERT INTO fitment_identity_mapping (dimension, scope_key, identity_key, source_id, source_label, canonical_id, disposition, reference_counts, notes)
SELECT
    'model',
    'make:' || vm.make_id::text,
    vm.identity_key,
    vm.model_id,
    vm.model_name,
    CASE WHEN cnt.group_size = 1 THEN vm.model_id ELSE NULL END,
    CASE WHEN cnt.group_size = 1 THEN 'preserve' ELSE 'unresolved_duplicate' END,
    jsonb_build_object(
        'applications', (SELECT COUNT(*) FROM application a WHERE a.model_id = vm.model_id),
        'engine_fitments', (SELECT COUNT(*) FROM vehicle_engine_fitment vef WHERE vef.model_id = vm.model_id)
    ),
    CASE WHEN cnt.group_size > 1 THEN 'Normalized model_name collision within same make; requires human disambiguation' ELSE NULL END
FROM vehicle_model vm
JOIN (
    SELECT make_id, identity_key, COUNT(*) AS group_size
    FROM vehicle_model
    GROUP BY make_id, identity_key
) cnt ON cnt.make_id = vm.make_id AND cnt.identity_key = vm.identity_key
ON CONFLICT (dimension, scope_key, source_id) DO UPDATE SET
    identity_key = EXCLUDED.identity_key,
    source_label = EXCLUDED.source_label,
    disposition = EXCLUDED.disposition,
    reference_counts = EXCLUDED.reference_counts,
    notes = EXCLUDED.notes,
    updated_at = NOW();

INSERT INTO fitment_identity_mapping (dimension, scope_key, identity_key, source_id, source_label, canonical_id, disposition, reference_counts, notes)
SELECT
    'engine',
    eng.namespace_key,
    eng.identity_key,
    eng.engine_id,
    eng.engine_code,
    CASE WHEN cnt.group_size = 1 THEN eng.engine_id ELSE NULL END,
    CASE WHEN cnt.group_size = 1 THEN 'preserve' ELSE 'unresolved_duplicate' END,
    jsonb_build_object(
        'applications', (SELECT COUNT(*) FROM application a WHERE a.engine_id = eng.engine_id),
        'engine_fitments', (SELECT COUNT(*) FROM vehicle_engine_fitment vef WHERE vef.engine_id = eng.engine_id)
    ),
    CASE WHEN cnt.group_size > 1 THEN 'Normalized engine_code collision; requires human disambiguation' ELSE NULL END
FROM engine eng
JOIN (
    SELECT namespace_key, identity_key, COUNT(*) AS group_size
    FROM engine
    GROUP BY namespace_key, identity_key
) cnt ON cnt.namespace_key = eng.namespace_key AND cnt.identity_key = eng.identity_key
ON CONFLICT (dimension, scope_key, source_id) DO UPDATE SET
    identity_key = EXCLUDED.identity_key,
    source_label = EXCLUDED.source_label,
    disposition = EXCLUDED.disposition,
    reference_counts = EXCLUDED.reference_counts,
    notes = EXCLUDED.notes,
    updated_at = NOW();

-- 6. Seed applications:approve permission
INSERT INTO permission (permission_key, description)
VALUES ('applications:approve', 'Approve vehicle fitment claims, aliases, and sourced evidence')
ON CONFLICT (permission_key) DO NOTHING;

-- Grant applications:approve to Admin role (permission_level_id 10 is Admin)
INSERT INTO role_permission (permission_level_id, permission_id)
SELECT 10, permission_id
FROM permission
WHERE permission_key = 'applications:approve'
ON CONFLICT (permission_level_id, permission_id) DO NOTHING;

COMMIT;
