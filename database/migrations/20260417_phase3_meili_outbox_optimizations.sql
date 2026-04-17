-- Phase 3 search-sync hardening: batching/coalescing and alert-friendly indexes.

CREATE INDEX IF NOT EXISTS idx_meili_sync_outbox_entity_latest
  ON meili_sync_outbox (entity_id, created_at DESC, outbox_id DESC)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_meili_sync_outbox_processed_at
  ON meili_sync_outbox (processed_at DESC)
  WHERE processed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_meili_sync_outbox_dead_recent
  ON meili_sync_outbox (updated_at DESC)
  WHERE status = 'dead';
