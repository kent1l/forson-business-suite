-- Additive completion of evidence-aware review. Never certify or merge legacy data.
BEGIN;

ALTER TABLE vehicle_model ADD COLUMN IF NOT EXISTS display_shorthand BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS fitment_rule_source (
    rule_id INTEGER NOT NULL REFERENCES part_application_rule(rule_id) ON DELETE RESTRICT,
    claim_id INTEGER NOT NULL REFERENCES fitment_claim(claim_id) ON DELETE RESTRICT,
    PRIMARY KEY (rule_id, claim_id)
);
INSERT INTO fitment_rule_source(rule_id,claim_id)
SELECT rule_id,claim_id FROM part_application_rule WHERE claim_id IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE fitment_evidence
    ADD COLUMN IF NOT EXISTS claim_type TEXT NOT NULL DEFAULT 'unclassified'
        CHECK (claim_type IN ('unclassified','part_compatibility','vehicle_engine_association','identity')),
    ADD COLUMN IF NOT EXISTS rights_policy TEXT NOT NULL DEFAULT 'metadata_only'
        CHECK (rights_policy IN ('metadata_only','permitted_excerpt')),
    ADD COLUMN IF NOT EXISTS assessment TEXT NOT NULL DEFAULT 'insufficient'
        CHECK (assessment IN ('supported','contradicted','insufficient')),
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Apply the evidence guard to every unrestricted qualifier, including the
-- dimensions omitted from the original trigger. This does not approve anything.
CREATE OR REPLACE FUNCTION trg_fn_fitment_unrestricted_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF 'unrestricted' IN (NEW.make_mode,NEW.model_mode,NEW.chassis_mode,NEW.engine_mode,
        NEW.year_mode,NEW.market_mode,NEW.variant_mode,NEW.position_mode,NEW.drivetrain_mode,
        NEW.transmission_mode,NEW.fuel_mode,NEW.displacement_mode,NEW.generation_mode)
        AND (NEW.approval_status <> 'approved' OR NEW.evidence_status <> 'sourced_verified') THEN
        RAISE EXCEPTION 'Unrestricted scope requires approved sourced evidence' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_fitment_unrestricted_guard ON part_application_rule;
CREATE TRIGGER trg_fitment_unrestricted_guard BEFORE INSERT OR UPDATE ON part_application_rule
FOR EACH ROW EXECUTE FUNCTION trg_fn_fitment_unrestricted_guard();

-- Repointing a shared identity would reinterpret every existing claim and its
-- evidence. Preserve history; reviewed replacement claims use a new identity.
CREATE OR REPLACE FUNCTION trg_fn_fitment_application_history_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='UPDATE' AND ROW(NEW.make_id,NEW.model_id,NEW.chassis_id,NEW.engine_id)
        IS NOT DISTINCT FROM ROW(OLD.make_id,OLD.model_id,OLD.chassis_id,OLD.engine_id) THEN
        RETURN NEW;
    END IF;
    IF EXISTS(SELECT 1 FROM fitment_claim WHERE application_id=OLD.application_id)
        OR EXISTS(SELECT 1 FROM part_application_rule WHERE application_id=OLD.application_id) THEN
        RAISE EXCEPTION 'Application has fitment history; create and review a replacement identity' USING ERRCODE='55000';
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_fitment_application_history_guard ON application;
CREATE TRIGGER trg_fitment_application_history_guard BEFORE UPDATE OR DELETE ON application
FOR EACH ROW EXECUTE FUNCTION trg_fn_fitment_application_history_guard();

COMMIT;
