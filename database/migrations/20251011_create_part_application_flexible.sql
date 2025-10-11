BEGIN;

-- Create flexible part application table
CREATE TABLE IF NOT EXISTS public.part_application_flexible (
    part_app_flex_id SERIAL PRIMARY KEY,
    part_id INTEGER NOT NULL REFERENCES public.part(part_id) ON DELETE CASCADE,
    make_name VARCHAR(100),
    model_name VARCHAR(100),
    engine_name VARCHAR(100),
    year_start INTEGER,
    year_end INTEGER,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Ensure index coverage for lookups
CREATE INDEX IF NOT EXISTS idx_part_app_flex_part_id ON public.part_application_flexible (part_id);
CREATE INDEX IF NOT EXISTS idx_part_app_flex_make ON public.part_application_flexible (make_name);
CREATE INDEX IF NOT EXISTS idx_part_app_flex_model ON public.part_application_flexible (model_name);
CREATE INDEX IF NOT EXISTS idx_part_app_flex_engine ON public.part_application_flexible (engine_name);

-- Prevent duplicate flexible applications per part
CREATE UNIQUE INDEX IF NOT EXISTS ux_part_app_flex_composite
    ON public.part_application_flexible (
        part_id,
        COALESCE(make_name, ''),
        COALESCE(model_name, ''),
        COALESCE(engine_name, ''),
        COALESCE(year_start, -1),
        COALESCE(year_end, -1)
    );

-- Helper function to maintain updated_at
CREATE OR REPLACE FUNCTION public.touch_part_application_flexible()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

-- Attach trigger for updates
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_touch_part_application_flexible'
    ) THEN
        CREATE TRIGGER trg_touch_part_application_flexible
        BEFORE UPDATE ON public.part_application_flexible
        FOR EACH ROW EXECUTE FUNCTION public.touch_part_application_flexible();
    END IF;
END$$;

-- Backfill from existing normalized structure
INSERT INTO public.part_application_flexible (
    part_id,
    make_name,
    model_name,
    engine_name,
    year_start,
    year_end
)
SELECT DISTINCT
    pa.part_id,
    vmk.make_name,
    vmd.model_name,
    veng.engine_name,
    pa.year_start,
    pa.year_end
FROM public.part_application pa
JOIN public.application a ON a.application_id = pa.application_id
LEFT JOIN public.vehicle_make vmk ON vmk.make_id = a.make_id
LEFT JOIN public.vehicle_model vmd ON vmd.model_id = a.model_id
LEFT JOIN public.vehicle_engine veng ON veng.engine_id = a.engine_id
ON CONFLICT DO NOTHING;

COMMIT;
