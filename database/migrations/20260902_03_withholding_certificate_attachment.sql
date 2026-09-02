-- Migration: 20260902_03_withholding_certificate_attachment.sql
-- Description: Store the scanned BIR certificate in the database rather than on disk.
--
--   withholding_tax_certificate.attachment_path assumed a filesystem somewhere. There
--   isn't one: the backend container mounts no volume for uploads (docker-compose.yml
--   gives it none), so anything written beside the code is destroyed the next time the
--   image is redeployed.
--
--   That is an unacceptable failure mode for this particular document. A Form 2307 is
--   the sole evidence supporting a creditable tax claim; if BIR questions the claim
--   years later and the certificate cannot be produced, the credit is disallowed and
--   becomes a cash assessment. Records like these must be retained for ten years.
--
--   The database is the only store in this deployment that is both persisted (the
--   postgres_data volume) and backed up (the backup service). So the scan goes here.
--   These are small documents -- a phone photo or a one-page PDF -- and there is one
--   per customer per quarter, so the volume is negligible compared to the transaction
--   tables.
--
--   attachment_path is kept, unused, for a future move to object storage: it gives
--   that migration somewhere to write without another schema change.

BEGIN;

ALTER TABLE public.withholding_tax_certificate
    ADD COLUMN IF NOT EXISTS attachment_data     BYTEA,
    ADD COLUMN IF NOT EXISTS attachment_mime     VARCHAR(100),
    ADD COLUMN IF NOT EXISTS attachment_filename VARCHAR(255),
    ADD COLUMN IF NOT EXISTS attachment_size     INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.withholding_tax_certificate'::regclass
          AND conname = 'chk_wt_cert_attachment_size'
    ) THEN
        -- Mirrors the 5 MB cap the upload route enforces, so a direct database write
        -- cannot smuggle in something the application would have rejected.
        ALTER TABLE public.withholding_tax_certificate
            ADD CONSTRAINT chk_wt_cert_attachment_size
            CHECK (attachment_size IS NULL OR (attachment_size > 0 AND attachment_size <= 5242880));
    END IF;
END $$;

COMMENT ON COLUMN public.withholding_tax_certificate.attachment_data IS
    'The scanned certificate itself. Held in the database because it is the only persisted, backed-up store in this deployment.';
COMMENT ON COLUMN public.withholding_tax_certificate.attachment_path IS
    'Unused. Reserved for a future move to object storage.';

COMMIT;
