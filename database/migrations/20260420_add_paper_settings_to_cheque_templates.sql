ALTER TABLE cheque_templates
ADD COLUMN IF NOT EXISTS paper_settings JSONB NOT NULL DEFAULT '{"widthIn": 8, "heightIn": 3, "unit": "in"}'::jsonb;

UPDATE cheque_templates
SET
    date_format = 'MM-dd-yyyy',
    paper_settings = COALESCE(paper_settings, '{"widthIn": 8, "heightIn": 3, "unit": "in"}'::jsonb),
    currency_settings = CASE
        WHEN currency_settings ? 'label'
            THEN jsonb_set(currency_settings, '{label}', '"₱"', true)
        ELSE currency_settings || '{"label":"₱"}'::jsonb
    END,
    field_positions = jsonb_set(
        jsonb_set(
            jsonb_set(
                jsonb_set(
                    jsonb_set(
                        jsonb_set(
                            COALESCE(field_positions, '{}'::jsonb),
                            '{date}',
                            '{"x":426,"y":178,"alignment":"left","fontSize":11,"mode":"boxed","charSpacing":14,"blockSpacing":24}'::jsonb,
                            true
                        ),
                        '{payee}',
                        '{"x":72,"y":136,"alignment":"left","fontSize":12,"maxWidth":380,"minFontSize":8}'::jsonb,
                        true
                    ),
                    '{amountNumeric}',
                    '{"x":534,"y":136,"alignment":"right","fontSize":12}'::jsonb,
                    true
                ),
                '{amountWords}',
                '{"x":72,"y":104,"alignment":"left","fontSize":11,"maxWidth":420}'::jsonb,
                true
            ),
            '{memo}',
            '{"x":72,"y":84,"alignment":"left","fontSize":10,"maxWidth":220}'::jsonb,
            true
        ),
        '{currency}',
        '{"x":474,"y":136,"alignment":"left","fontSize":11}'::jsonb,
        true
    )
WHERE is_deleted = FALSE;
