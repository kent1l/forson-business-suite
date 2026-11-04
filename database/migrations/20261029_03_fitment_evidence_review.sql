-- Migration: 20261029_03_fitment_evidence_review.sql
-- Purpose: Create fitment_evidence, fitment_claim_evidence, fitment_research_job, fitment_review, fitment_review_candidate, and fitment_idempotency tables.

BEGIN;

-- 1. Create fitment_research_job
CREATE TABLE IF NOT EXISTS fitment_research_job (
    job_id SERIAL PRIMARY KEY,
    part_id INTEGER REFERENCES part(part_id) ON DELETE SET NULL,
    query_text TEXT NOT NULL,
    search_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    provider TEXT NOT NULL DEFAULT 'evidence_capture',
    allowed_domains JSONB NOT NULL DEFAULT '[]'::jsonb,
    result_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT,
    requested_by INTEGER REFERENCES employee(employee_id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fitment_research_job_part_id ON fitment_research_job(part_id);
CREATE INDEX IF NOT EXISTS idx_fitment_research_job_status ON fitment_research_job(status);

-- 2. Create fitment_evidence
CREATE TABLE IF NOT EXISTS fitment_evidence (
    evidence_id SERIAL PRIMARY KEY,
    research_job_id INTEGER REFERENCES fitment_research_job(job_id) ON DELETE SET NULL,
    part_id INTEGER REFERENCES part(part_id) ON DELETE SET NULL,
    source_type TEXT NOT NULL DEFAULT 'web_catalog'
        CHECK (source_type IN ('oem_catalog', 'aftermarket_catalog', 'supplier_sheet', 'invoice_po', 'packaging_photo', 'web_catalog', 'manual_note')),
    source_url TEXT,
    source_domain TEXT,
    source_title TEXT,
    quoted_span TEXT NOT NULL,
    retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    trust_tier TEXT NOT NULL DEFAULT 'tier_3_unverified_web'
        CHECK (trust_tier IN ('tier_1_oem', 'tier_2_reputable_catalog', 'tier_3_unverified_web', 'tier_4_internal_doc')),
    approval_status TEXT NOT NULL DEFAULT 'needs_review'
        CHECK (approval_status IN ('needs_review', 'approved', 'rejected')),
    evidence_status TEXT NOT NULL DEFAULT 'sourced_suggestion'
        CHECK (evidence_status IN ('sourced_verified', 'sourced_suggestion', 'rejected')),
    extracted_claim JSONB NOT NULL DEFAULT '{}'::jsonb,
    reviewer_id INTEGER REFERENCES employee(employee_id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    review_reason TEXT,
    row_version INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER REFERENCES employee(employee_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fitment_evidence_job_id ON fitment_evidence(research_job_id);
CREATE INDEX IF NOT EXISTS idx_fitment_evidence_part_id ON fitment_evidence(part_id);
CREATE INDEX IF NOT EXISTS idx_fitment_evidence_approval_status ON fitment_evidence(approval_status);

-- 3. Create fitment_claim_evidence join table
CREATE TABLE IF NOT EXISTS fitment_claim_evidence (
    claim_id INTEGER NOT NULL REFERENCES fitment_claim(claim_id) ON DELETE CASCADE,
    evidence_id INTEGER NOT NULL REFERENCES fitment_evidence(evidence_id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL DEFAULT 'supports'
        CHECK (relation_type IN ('supports', 'contradicts', 'context')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (claim_id, evidence_id)
);

-- 4. Create fitment_review session table
CREATE TABLE IF NOT EXISTS fitment_review (
    review_id SERIAL PRIMARY KEY,
    part_id INTEGER REFERENCES part(part_id) ON DELETE CASCADE,
    raw_text TEXT NOT NULL,
    normalized_text TEXT NOT NULL,
    text_hash TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'text_import',
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'applied', 'abandoned')),
    taxonomy_version BIGINT NOT NULL DEFAULT 1,
    parser_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    row_version INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER REFERENCES employee(employee_id) ON DELETE SET NULL,
    updated_by INTEGER REFERENCES employee(employee_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fitment_review_lookup
    ON fitment_review (part_id, text_hash, status);

-- 5. Create fitment_review_candidate table
CREATE TABLE IF NOT EXISTS fitment_review_candidate (
    candidate_id SERIAL PRIMARY KEY,
    review_id INTEGER NOT NULL REFERENCES fitment_review(review_id) ON DELETE CASCADE,
    interpretation_key TEXT NOT NULL,
    alternative_group_id TEXT,
    clause_index INTEGER NOT NULL DEFAULT 0,
    clause_text TEXT,
    clause_span JSONB,
    source_origin TEXT NOT NULL DEFAULT 'local'
        CHECK (source_origin IN ('local', 'ai', 'merged', 'evidence', 'manual_edit')),
    effect TEXT NOT NULL DEFAULT 'include'
        CHECK (effect IN ('include', 'exclude')),
    candidate_payload JSONB NOT NULL,
    identity_modes JSONB NOT NULL DEFAULT '{}'::jsonb,
    qualifiers JSONB NOT NULL DEFAULT '{}'::jsonb,
    field_provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
    unresolved_dimensions JSONB NOT NULL DEFAULT '[]'::jsonb,
    collision_candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
    confidence_label TEXT NOT NULL DEFAULT 'low'
        CHECK (confidence_label IN ('exact', 'high', 'medium', 'low', 'unresolved')),
    ui_badge TEXT NOT NULL DEFAULT 'Needs review'
        CHECK (ui_badge IN ('Sourced suggestion', 'Needs review', 'Unresolved', 'Already linked')),
    disposition TEXT NOT NULL DEFAULT 'pending'
        CHECK (disposition IN ('pending', 'selected', 'dismissed', 'edited', 'applied', 'already_linked')),
    preselected BOOLEAN NOT NULL DEFAULT FALSE,
    already_linked BOOLEAN NOT NULL DEFAULT FALSE,
    existing_rule_id INTEGER REFERENCES part_application_rule(rule_id) ON DELETE SET NULL,
    existing_part_app_id INTEGER REFERENCES part_application(part_app_id) ON DELETE SET NULL,
    dismissed_reason TEXT,
    edited_payload JSONB,
    row_version INTEGER NOT NULL DEFAULT 1,
    updated_by INTEGER REFERENCES employee(employee_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (review_id, interpretation_key)
);

CREATE INDEX IF NOT EXISTS idx_fitment_review_candidate_review_id ON fitment_review_candidate(review_id);
CREATE INDEX IF NOT EXISTS idx_fitment_review_candidate_group ON fitment_review_candidate(review_id, alternative_group_id);

-- 6. Create fitment_idempotency ledger
CREATE TABLE IF NOT EXISTS fitment_idempotency (
    idempotency_id BIGSERIAL PRIMARY KEY,
    actor_scope TEXT NOT NULL,
    endpoint_scope TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response_status INTEGER NOT NULL,
    response_body JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
    UNIQUE (actor_scope, endpoint_scope, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_fitment_idempotency_expires_at ON fitment_idempotency(expires_at);

COMMIT;
