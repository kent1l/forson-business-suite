-- Explicit-ID imports/restores can leave the legacy fitment-link sequence behind
-- existing links. ON CONFLICT (part_id, application_id) cannot handle an ID clash.
-- Block inserts while comparing/advancing the sequence; never rewind allocated IDs.
DO $$
DECLARE
    link_sequence regclass;
    highest_id bigint;
    allocated_id bigint;
BEGIN
    LOCK TABLE public.part_application IN SHARE ROW EXCLUSIVE MODE;
    link_sequence := pg_get_serial_sequence('public.part_application', 'part_app_id')::regclass;
    IF link_sequence IS NULL THEN
        RAISE EXCEPTION 'part_application.part_app_id has no owned sequence';
    END IF;
    SELECT max(part_app_id) INTO highest_id FROM public.part_application;
    EXECUTE format('SELECT last_value FROM %s', link_sequence) INTO allocated_id;
    IF highest_id IS NOT NULL THEN
        PERFORM setval(link_sequence, GREATEST(highest_id, allocated_id), true);
    END IF;
END $$;
