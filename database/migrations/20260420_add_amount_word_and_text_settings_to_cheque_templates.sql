ALTER TABLE cheque_templates
ADD COLUMN IF NOT EXISTS amount_words_settings JSONB NOT NULL DEFAULT '{"suffix":"pesos"}'::jsonb,
ADD COLUMN IF NOT EXISTS text_settings JSONB NOT NULL DEFAULT '{"payeeFillerEnabled":false,"payeeFiller":"***","amountWordsFillerEnabled":false,"amountWordsFiller":"***"}'::jsonb;

UPDATE cheque_templates
SET amount_words_settings = COALESCE(amount_words_settings, '{"suffix":"pesos"}'::jsonb),
    text_settings = COALESCE(text_settings, '{"payeeFillerEnabled":false,"payeeFiller":"***","amountWordsFillerEnabled":false,"amountWordsFiller":"***"}'::jsonb)
WHERE amount_words_settings IS NULL OR text_settings IS NULL;
