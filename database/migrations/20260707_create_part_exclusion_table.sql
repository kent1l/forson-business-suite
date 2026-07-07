CREATE TABLE IF NOT EXISTS public.part_exclusion (
    part_id_1 INT NOT NULL REFERENCES public.part(part_id) ON DELETE CASCADE,
    part_id_2 INT NOT NULL REFERENCES public.part(part_id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (part_id_1, part_id_2),
    CONSTRAINT chk_order CHECK (part_id_1 < part_id_2)
);

CREATE INDEX IF NOT EXISTS idx_part_exclusion_lookup ON public.part_exclusion(part_id_1, part_id_2);
