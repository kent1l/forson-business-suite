-- Index to speed up Phase 1 of Cascade Record Linkage for part deduplication
CREATE INDEX IF NOT EXISTS idx_part_number_part_number
ON public.part_number(part_number)
WHERE deleted_at IS NULL;
