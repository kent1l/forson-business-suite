CREATE TABLE IF NOT EXISTS ai_verification_queue (
    part_id_1 INTEGER NOT NULL REFERENCES part(part_id) ON DELETE CASCADE,
    part_id_2 INTEGER NOT NULL REFERENCES part(part_id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (part_id_1, part_id_2),
    CHECK (part_id_1 < part_id_2)
);
