-- Migration: 20260812_08_create_brand_assets.sql
-- Description: Store the admin-uploaded brand logo images (full wordmark +
--              compact icon) used by the new Brand Identity / Theme feature.
--              One row per variant, replaced in place on re-upload.

BEGIN;

CREATE TABLE IF NOT EXISTS public.brand_asset (
    variant       character varying(10) PRIMARY KEY CHECK (variant IN ('full', 'icon')),
    mime_type     character varying(50) NOT NULL,
    file_bytes    bytea NOT NULL,
    file_size     integer NOT NULL,
    width_px      integer,
    height_px     integer,
    updated_at    timestamp with time zone NOT NULL DEFAULT now(),
    updated_by    integer REFERENCES public.employee(employee_id) ON DELETE SET NULL
);

COMMENT ON TABLE public.brand_asset IS 'Admin-uploaded brand logo images (full wordmark + compact icon). Single global row per variant, no version history.';

COMMIT;
