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

INSERT INTO cheque_templates (bank_name, field_positions, date_format, amount_format, currency_settings)
SELECT 'Default Bank Template',
       '{"date":{"x":430,"y":700,"alignment":"left","fontSize":11},"payee":{"x":90,"y":655,"alignment":"left","fontSize":12,"maxWidth":380,"minFontSize":8},"amountNumeric":{"x":490,"y":655,"alignment":"right","fontSize":12},"amountWords":{"x":90,"y":625,"alignment":"left","fontSize":11,"maxWidth":420},"memo":{"x":90,"y":585,"alignment":"left","fontSize":10,"maxWidth":220},"currency":{"x":515,"y":655,"alignment":"left","fontSize":11}}'::jsonb,
       'MM/dd/yyyy',
       'title_case',
       '{"enabled": true, "label": "USD"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM cheque_templates);
