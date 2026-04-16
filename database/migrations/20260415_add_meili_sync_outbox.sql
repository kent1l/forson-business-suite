-- Durable outbox for Meilisearch synchronization events.
CREATE TABLE IF NOT EXISTS meili_sync_outbox (
  outbox_id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('upsert_part', 'delete_part')),
  entity_type TEXT NOT NULL DEFAULT 'part',
  entity_id BIGINT NOT NULL,
  payload JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_until TIMESTAMPTZ,
  last_error TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meili_sync_outbox_poll
  ON meili_sync_outbox (status, available_at, created_at);

CREATE INDEX IF NOT EXISTS idx_meili_sync_outbox_lease
  ON meili_sync_outbox (lease_until)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_meili_sync_outbox_dead
  ON meili_sync_outbox (status, updated_at)
  WHERE status = 'dead';
