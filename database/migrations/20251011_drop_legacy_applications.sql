BEGIN;

-- Ensure any remaining legacy links are migrated into the flexible table before dropping legacy structures
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

-- Drop legacy views and tables now that data has been migrated
DROP VIEW IF EXISTS public.application_view;
DROP TABLE IF EXISTS public.part_application;
DROP TABLE IF EXISTS public.application;
DROP TABLE IF EXISTS public.vehicle_engine;
DROP TABLE IF EXISTS public.vehicle_model;
DROP TABLE IF EXISTS public.vehicle_make;

COMMIT;
