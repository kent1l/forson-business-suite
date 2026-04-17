CREATE TABLE IF NOT EXISTS search_repair_jobs (
  job_id BIGSERIAL PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'cancelling')),
  mode TEXT NOT NULL DEFAULT 'full' CHECK (mode IN ('dry', 'full', 'reconcile')),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  total INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  success INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_search_repair_jobs_poll
  ON search_repair_jobs (status, created_at);
