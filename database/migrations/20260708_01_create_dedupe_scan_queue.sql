CREATE TABLE IF NOT EXISTS public.dedupe_scan_queue (
    part_id INTEGER PRIMARY KEY REFERENCES public.part(part_id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dedupe_scan_queue_status ON public.dedupe_scan_queue(status, updated_at);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION public.update_dedupe_scan_queue_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_dedupe_scan_queue_updated_at ON public.dedupe_scan_queue;
CREATE TRIGGER update_dedupe_scan_queue_updated_at
BEFORE UPDATE ON public.dedupe_scan_queue
FOR EACH ROW
EXECUTE FUNCTION public.update_dedupe_scan_queue_updated_at();

-- Trigger on parts table to insert or update the scan queue when a part changes
CREATE OR REPLACE FUNCTION public.enqueue_part_for_dedupe()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.dedupe_scan_queue (part_id, status)
    VALUES (NEW.part_id, 'pending')
    ON CONFLICT (part_id) DO UPDATE SET 
        status = 'pending',
        updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- We want to enqueue on INSERT and UPDATE
DROP TRIGGER IF EXISTS trigger_enqueue_part_for_dedupe ON public.part;
CREATE TRIGGER trigger_enqueue_part_for_dedupe
AFTER INSERT OR UPDATE OF brand_id, group_id, detail 
ON public.part
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_part_for_dedupe();
