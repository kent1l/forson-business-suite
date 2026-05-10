DO $$
BEGIN
    -- Check if cheque_templates exists but is missing the 'id' column
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_name = 'cheque_templates' AND table_schema = 'public'
    ) AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'cheque_templates' AND column_name = 'id' AND table_schema = 'public'
    ) THEN
        -- Drop the malformed tables. cascade will drop dependent views/tables if any.
        DROP TABLE IF EXISTS cheque_records CASCADE;
        DROP TABLE IF EXISTS printer_profiles CASCADE;
        DROP TABLE IF EXISTS cheque_templates CASCADE;
    END IF;
END $$;

-- 1. Recreate base schema from 20260419
CREATE TABLE IF NOT EXISTS cheque_templates (
    id SERIAL PRIMARY KEY,
    bank_name VARCHAR(120) NOT NULL,
    field_positions JSONB NOT NULL DEFAULT '{}'::jsonb,
    date_format VARCHAR(40) NOT NULL DEFAULT 'MM/dd/yyyy',
    amount_format VARCHAR(40) NOT NULL DEFAULT 'title_case',
    currency_settings JSONB NOT NULL DEFAULT '{"enabled": true, "label": "USD"}'::jsonb,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS printer_profiles (
    id SERIAL PRIMARY KEY,
    profile_name VARCHAR(120) NOT NULL,
    offset_x NUMERIC(8,2) NOT NULL DEFAULT 0,
    offset_y NUMERIC(8,2) NOT NULL DEFAULT 0,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cheque_records (
    id SERIAL PRIMARY KEY,
    template_id INTEGER REFERENCES cheque_templates(id),
    payee VARCHAR(255) NOT NULL,
    amount NUMERIC(14,2) NOT NULL,
    cheque_date DATE,
    memo VARCHAR(255),
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cheque_records_created_at ON cheque_records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cheque_records_is_deleted ON cheque_records(is_deleted);

-- 2. Apply modifications from 20260420_add_amount_word_and_text_settings_to_cheque_templates.sql
ALTER TABLE cheque_templates
ADD COLUMN IF NOT EXISTS amount_words_settings JSONB NOT NULL DEFAULT '{"suffix":"pesos"}'::jsonb,
ADD COLUMN IF NOT EXISTS text_settings JSONB NOT NULL DEFAULT '{"payeeFillerEnabled":false,"payeeFiller":"***","amountWordsFillerEnabled":false,"amountWordsFiller":"***"}'::jsonb;

-- 3. Apply modifications from 20260420_add_paper_settings_to_cheque_templates.sql
ALTER TABLE cheque_templates
ADD COLUMN IF NOT EXISTS paper_settings JSONB NOT NULL DEFAULT '{"widthIn": 8, "heightIn": 3, "unit": "in"}'::jsonb;

-- 4. Apply modifications from 20260421_add_feed_type_to_printer_profiles.sql
ALTER TABLE printer_profiles
ADD COLUMN IF NOT EXISTS feed_type VARCHAR(50) NOT NULL DEFAULT 'native';

-- 5. Seed initial template with the updated settings
INSERT INTO cheque_templates (bank_name, field_positions, date_format, amount_format, currency_settings, paper_settings, amount_words_settings, text_settings)
SELECT 'Default Bank Template',
       '{"date":{"x":426,"y":178,"alignment":"left","fontSize":11,"mode":"boxed","charSpacing":14,"blockSpacing":24},"payee":{"x":72,"y":136,"alignment":"left","fontSize":12,"maxWidth":380,"minFontSize":8},"amountNumeric":{"x":534,"y":136,"alignment":"right","fontSize":12},"amountWords":{"x":72,"y":104,"alignment":"left","fontSize":11,"maxWidth":420},"memo":{"x":72,"y":84,"alignment":"left","fontSize":10,"maxWidth":220},"currency":{"x":474,"y":136,"alignment":"left","fontSize":11}}'::jsonb,
       'MM-dd-yyyy',
       'title_case',
       '{"enabled":true,"label":"₱"}'::jsonb,
       '{"widthIn": 8, "heightIn": 3, "unit": "in"}'::jsonb,
       '{"suffix":"pesos"}'::jsonb,
       '{"payeeFillerEnabled":false,"payeeFiller":"***","amountWordsFillerEnabled":false,"amountWordsFiller":"***"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM cheque_templates);
