-- Drop old view first since it depends on columns we'll remove
DROP VIEW IF EXISTS public.application_view;

-- Remove old string columns from the application table
ALTER TABLE public.application
DROP COLUMN IF EXISTS make,
DROP COLUMN IF EXISTS model,
DROP COLUMN IF EXISTS engine;

-- Recreate the application view to use normalized names
CREATE OR REPLACE VIEW public.application_view AS
SELECT a.application_id,
       vmk.make_name AS make,
       vmd.model_name AS model,
       veng.engine_name AS engine
FROM public.application a
LEFT JOIN public.vehicle_make vmk ON a.make_id = vmk.make_id
LEFT JOIN public.vehicle_model vmd ON a.model_id = vmd.model_id
LEFT JOIN public.vehicle_engine veng ON a.engine_id = veng.engine_id;
