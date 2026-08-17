-- Migration: 20260817_01_fix_cheque_currency_label_encoding.sql
-- Description: pdf-lib's Helvetica standard font can only encode WinAnsi
--              characters, which does not include the Philippine peso sign
--              (U+20B1). Every cheque_templates row seeded with the historical
--              default currency label "₱" (see 20260420_add_paper_settings_to_
--              cheque_templates.sql and 20260423_fix_malformed_cheque_tables.sql)
--              has therefore been silently printing "?" in place of the
--              currency symbol. Replace it with the ASCII-safe "PHP" label the
--              settings UI already recommends, for any preset that was never
--              manually customized away from the broken default.

BEGIN;

UPDATE cheque_templates
SET currency_settings = jsonb_set(currency_settings, '{label}', '"PHP"', true),
    updated_at = CURRENT_TIMESTAMP
WHERE currency_settings->>'label' = '₱';

COMMIT;
