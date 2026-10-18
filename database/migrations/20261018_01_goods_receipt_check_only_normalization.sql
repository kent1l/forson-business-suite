-- Preserve the printed reference in goods_receipt. Normalize only comparison keys.
-- This function mirrors helpers/paperlessMatching.normalizeReceiptIdentifier.
CREATE OR REPLACE FUNCTION public.goods_receipt_match_key(value text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
    SELECT CASE WHEN btrim(value) ~* '^(N/?A|NONE|NULL)$' THEN '' ELSE
        regexp_replace(
            regexp_replace(upper(normalize(value, NFKD)), '[^A-Z0-9]', '', 'g'),
            '(^|[^0-9])0+([0-9])', '\1\2', 'g'
        )
    END
$$;

-- Keep the original raw-value guard and add a race-safe normalized comparison.
-- Never rewrite historical references or silently merge colliding records.
CREATE UNIQUE INDEX IF NOT EXISTS uq_goods_receipt_supplier_physical_receipt_normalized
    ON public.goods_receipt (supplier_id, public.goods_receipt_match_key(physical_receipt_no))
    WHERE physical_receipt_no IS NOT NULL
      AND LENGTH(TRIM(physical_receipt_no)) > 0
      AND status <> 'Voided';

COMMENT ON COLUMN public.goods_receipt.physical_receipt_no IS
    'Supplier document reference as entered. Normalization is used only for comparison and uniqueness checks.';
