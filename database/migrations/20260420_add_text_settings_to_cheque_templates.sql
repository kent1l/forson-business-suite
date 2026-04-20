ALTER TABLE cheque_templates
ADD COLUMN IF NOT EXISTS text_settings JSONB NOT NULL DEFAULT '{"amountSuffix": "pesos", "payeeFiller": "", "amountWordsFiller": ""}'::jsonb;

UPDATE cheque_templates
SET text_settings = COALESCE(text_settings, '{"amountSuffix": "pesos", "payeeFiller": "", "amountWordsFiller": ""}'::jsonb)
WHERE is_deleted = FALSE;
