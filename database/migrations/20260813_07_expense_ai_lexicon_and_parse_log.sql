-- Migration: 20260813_07_expense_ai_lexicon_and_parse_log.sql
-- Description: Foundation for self-learning AI expense entry.
--
--   1. expense_ai_parse_log  — records EVERY natural-language parse together with
--      the text the user actually typed and the values they ultimately saved.
--      The previous design only stored diffs when the AI was wrong, so successful
--      parses (the strongest learning signal) were discarded.
--
--   2. expense_term_alias    — an auditable lexicon mapping local terms/shorthand
--      (Cebuano, vendor nicknames) to canonical categories/payees/payment methods.
--      Aliases are proposed automatically but stay 'pending' until an admin
--      approves them, so a repeated mistake can never silently cement itself.
--
--   3. embedding_model columns — vectors from different embedding models are not
--      comparable. The embedding pool has a 4-model fallback chain, so retrieval
--      must be able to filter to vectors produced by the same model.

BEGIN;

-- 1. Full parse log (learn from confirmations, not just corrections)
CREATE TABLE IF NOT EXISTS expense_ai_parse_log (
    parse_id            BIGSERIAL PRIMARY KEY,
    raw_input           TEXT NOT NULL,
    parsed_json         JSONB,
    final_json          JSONB,
    expense_id          BIGINT REFERENCES expense(expense_id) ON DELETE SET NULL,
    was_accepted        BOOLEAN,
    changed_fields      TEXT[] NOT NULL DEFAULT '{}',
    provider            VARCHAR(100),
    overall_confidence  NUMERIC(4,3),
    embedding           vector(768),
    embedding_model     VARCHAR(100),
    created_by          INTEGER REFERENCES employee(employee_id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expense_parse_log_created
    ON expense_ai_parse_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expense_parse_log_accepted
    ON expense_ai_parse_log (was_accepted);
CREATE INDEX IF NOT EXISTS idx_expense_parse_log_model
    ON expense_ai_parse_log (embedding_model);
CREATE INDEX IF NOT EXISTS idx_expense_parse_log_vector
    ON expense_ai_parse_log USING hnsw (embedding vector_cosine_ops);

-- 2. Learned term lexicon (admin-approved before it takes effect)
CREATE TABLE IF NOT EXISTS expense_term_alias (
    alias_id            BIGSERIAL PRIMARY KEY,
    term                VARCHAR(100) NOT NULL,
    -- Lowercased/trimmed form used for matching; kept as a real column so it can
    -- carry a uniqueness constraint.
    term_normalized     VARCHAR(100) NOT NULL,
    target_type         VARCHAR(20) NOT NULL
                        CHECK (target_type IN ('category', 'payee', 'payment_method')),
    category_id         INTEGER REFERENCES expense_category(category_id),
    payee               VARCHAR(200),
    payment_method_id   INTEGER REFERENCES payment_methods(method_id),
    status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected')),
    confirm_count       INTEGER NOT NULL DEFAULT 1,
    language_hint       VARCHAR(20),
    example_input       TEXT,
    created_by          INTEGER REFERENCES employee(employee_id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_by         INTEGER REFERENCES employee(employee_id),
    reviewed_at         TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- A term must actually resolve to something of its declared type.
    CONSTRAINT chk_alias_target CHECK (
        (target_type = 'category'       AND category_id IS NOT NULL)
     OR (target_type = 'payee'          AND payee IS NOT NULL)
     OR (target_type = 'payment_method' AND payment_method_id IS NOT NULL)
    )
);

-- One mapping per term per target type; re-observations bump confirm_count instead.
CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_term_alias_term_type
    ON expense_term_alias (term_normalized, target_type);
CREATE INDEX IF NOT EXISTS idx_expense_term_alias_status
    ON expense_term_alias (status, confirm_count DESC);

-- 3. Embedding provenance on the existing corrections table
ALTER TABLE expense_ai_correction
    ADD COLUMN IF NOT EXISTS embedding_model VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_expense_correction_model
    ON expense_ai_correction (embedding_model);

-- 4. Permission for managing the learned lexicon
INSERT INTO permission (permission_key, description, category)
VALUES
  ('expenses:manage_lexicon', 'Review and approve AI-learned expense terms and aliases', 'Finance')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM permission_level pl
CROSS JOIN permission p
WHERE pl.level_name IN ('Admin', 'Manager', 'Super Admin')
  AND p.permission_key = 'expenses:manage_lexicon'
ON CONFLICT DO NOTHING;

COMMIT;
