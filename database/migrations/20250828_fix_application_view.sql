DROP VIEW IF EXISTS public.application_view;

-- Recreate the view using only the normalized tables
CREATE OR REPLACE VIEW public.application_view AS
SELECT 
    a.application_id,
    a.make_id,
    a.model_id,
    a.engine_id,
    vmk.make_name AS make,
    vmd.model_name AS model,
    veng.engine_name AS engine
FROM application a
LEFT JOIN vehicle_make vmk ON a.make_id = vmk.make_id
LEFT JOIN vehicle_model vmd ON a.model_id = vmd.model_id
LEFT JOIN vehicle_engine veng ON a.engine_id = veng.engine_id;
