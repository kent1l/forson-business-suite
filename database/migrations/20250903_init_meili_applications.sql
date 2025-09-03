-- Emit NOTIFY for all existing applications to prime the Meilisearch applications index (idempotent)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT application_id FROM application LOOP
    PERFORM pg_notify('meili_app_sync', json_build_object('action','upsert','application_id', r.application_id)::text);
  END LOOP;
END$$;
