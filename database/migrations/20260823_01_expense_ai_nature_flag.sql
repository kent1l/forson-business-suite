-- Migration: 20260823_01_expense_ai_nature_flag.sql
-- Description: records the AI parser's judgement about whether a natural-language
--              entry is really an operating expense at all.
--
-- WHY THIS LIVES ON THE PARSE LOG, NOT ON `expense`:
--   The signal describes a parse, not a saved record. An expense that was saved
--   after the user dismissed the warning is still an ordinary expense row; what
--   is worth keeping is that the AI raised the question and the user answered it.
--   Keeping it here also means the RAG few-shot retrieval already reading this
--   table can learn from the outcome without touching the expense schema.
--
-- `nature_user_override` is the audit-relevant column: it marks entries a human
-- was warned about and saved anyway, which is exactly the population worth
-- re-reviewing when the books are reconciled.

BEGIN;

ALTER TABLE expense_ai_parse_log
    ADD COLUMN IF NOT EXISTS likely_non_opex      BOOLEAN,
    ADD COLUMN IF NOT EXISTS non_opex_type        VARCHAR(30),
    ADD COLUMN IF NOT EXISTS non_opex_confidence  NUMERIC(4,3),
    ADD COLUMN IF NOT EXISTS clarifying_question  TEXT,
    ADD COLUMN IF NOT EXISTS clarifying_answer    TEXT,
    ADD COLUMN IF NOT EXISTS nature_user_override BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_parse_log_non_opex_type') THEN
        ALTER TABLE expense_ai_parse_log ADD CONSTRAINT chk_parse_log_non_opex_type
            CHECK (non_opex_type IS NULL OR non_opex_type IN
                ('inventory_purchase', 'fixed_asset', 'liability_payment', 'owner_drawing'));
    END IF;
END$$;

-- Only the flagged minority is ever queried, so a partial index keeps this cheap.
CREATE INDEX IF NOT EXISTS idx_expense_parse_log_non_opex
    ON expense_ai_parse_log (likely_non_opex)
    WHERE likely_non_opex = true;

COMMIT;
