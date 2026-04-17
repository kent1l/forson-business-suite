# Search Sync Runbook (Meilisearch + Durable Outbox)

## Purpose
This runbook covers emergency and routine operations for the `meili_sync_outbox` worker and async search repair jobs.

## Alert triggers
The system raises/logs alerts for:
- **Dead queue growth** (`MEILI_OUTBOX_ALERT_DEAD_GROWTH`, default `10` in 10 minutes)
- **Pending backlog age breach** (`MEILI_OUTBOX_ALERT_BACKLOG_AGE_SECONDS`, default `120`)
- **Worker idle while backlog exists** (`MEILI_OUTBOX_ALERT_WORKER_IDLE_SECONDS`, default `300`)

Read API snapshots:
- `GET /api/dashboard/search-sync-health`
- `GET /api/dashboard/search-sync-alerts`

## Playbook: Meili degraded
1. Confirm Meilisearch health:
   - `GET /api/health/meilisearch`
   - `curl http://<meili-host>:7700/health`
2. Check API logs for `[MeiliOutbox]` and `[SearchRepair]` errors.
3. If Meili is down, keep API serving and let outbox queue buffer writes.
4. Recover Meili service, then verify backlog drains (`pending` trending down, `done` trending up).
5. If backlog is very large or drift is suspected, enqueue full async repair (`POST /api/data/repair-search-index?mode=full`).

## Playbook: Dead queue replay
1. Inspect dead rows:
   - `SELECT outbox_id, entity_id, event_type, attempts, last_error, updated_at FROM meili_sync_outbox WHERE status = 'dead' ORDER BY updated_at DESC LIMIT 200;`
2. Fix root cause (Meili connectivity, bad payload, schema mismatch).
3. Replay dead rows:
   - `UPDATE meili_sync_outbox SET status = 'pending', available_at = NOW(), lease_until = NULL, last_error = NULL WHERE status = 'dead';`
4. Watch `/api/dashboard/search-sync-health` until dead count stabilizes and pending drains.

## Playbook: Full repair async job (emergency)
1. Create job: `POST /api/data/repair-search-index?mode=full`
2. Track progress: `GET /api/data/repair-search-index/:job_id`
3. Cancel if needed: `POST /api/data/repair-search-index/:job_id/cancel`
4. After completion, compare DB and Meili counts.

## Rollback toggles / env flags
- `DISABLE_MEILI_OUTBOX_WORKER=true` → disable outbox worker
- `DISABLE_SEARCH_REPAIR_WORKER=true` → disable repair worker
- `ENABLE_LEGACY_MEILI_PART_LISTENER=true` → opt-in legacy listener (only for rollback testing)
- `MEILI_OUTBOX_BATCH_SIZE`, `MEILI_OUTBOX_POLL_MS`, `MEILI_OUTBOX_MAX_ATTEMPTS`, `MEILI_OUTBOX_LEASE_SECONDS`
- `MEILI_OUTBOX_ALERT_DEAD_GROWTH`, `MEILI_OUTBOX_ALERT_BACKLOG_AGE_SECONDS`, `MEILI_OUTBOX_ALERT_WORKER_IDLE_SECONDS`

## Notes on idempotency / versioning
Outbox payloads include `version_ts`. Worker skips stale events when DB row version is newer than event version.
