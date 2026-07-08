-- Create the unified AI cache table to store both true positives and false positives
CREATE TABLE IF NOT EXISTS ai_match_cache (
    part_id_1 INTEGER NOT NULL REFERENCES part(part_id) ON DELETE CASCADE,
    part_id_2 INTEGER NOT NULL REFERENCES part(part_id) ON DELETE CASCADE,
    is_duplicate BOOLEAN NOT NULL,
    reason TEXT,
    source VARCHAR(50) DEFAULT 'AI',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (part_id_1, part_id_2),
    CHECK (part_id_1 < part_id_2)
);

-- Migrate existing exclusions from the old part_exclusion table
INSERT INTO ai_match_cache (part_id_1, part_id_2, is_duplicate, reason, source, created_at)
SELECT part_id_1, part_id_2, false, reason, source, created_at
FROM part_exclusion
ON CONFLICT (part_id_1, part_id_2) DO NOTHING;

-- Optionally, you can drop the old table later once fully deprecated:
-- DROP TABLE IF EXISTS part_exclusion;
