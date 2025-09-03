-- Fix application trigger to fire on INSERT/UPDATE/DELETE
DROP TRIGGER IF EXISTS application_meili_notify ON public.application;

CREATE TRIGGER application_meili_notify
AFTER INSERT OR UPDATE OR DELETE ON application
FOR EACH ROW EXECUTE PROCEDURE trg_application_notify();
