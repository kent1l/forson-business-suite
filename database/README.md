# Database

This folder contains the PostgreSQL schema, migrations, and maintenance scripts.

- initial_schema.sql — Idempotent baseline schema and core seeds. Run on a fresh database.
- migrations/ — One-off, idempotent upgrades. Apply in chronological order after the baseline.
- scripts/ — Ad-hoc maintenance helpers (e.g., WAC recompute). Use with psql: database/scripts/<file>.sql
- seeds/ — Optional seed helpers for specific scenarios.

Recommended initialization sequence
1) psql -f database/initial_schema.sql
2) Apply all files in database/migrations/ in order
3) Optional maintenance: database/scripts/recompute_wac.sql, then reindex parts in Meilisearch