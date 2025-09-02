# Database

This folder contains the PostgreSQL schema, migrations, and maintenance scripts.


Recommended initialization sequence
1) psql -f database/initial_schema.sql
2) Apply all files in database/migrations/ in order
3) Optional maintenance: database/scripts/recompute_wac.sql, then reindex parts in Meilisearch

# Database setup and migrations guide

This document explains how our PostgreSQL schema is organized and how to add database changes safely (without destroying data). It also includes conventions, templates, and exact steps for applying migrations in dev and production.

## Folder layout
- initial_schema.sql — Idempotent baseline schema and core seeds for a fresh install.
- migrations/ — One-off, idempotent upgrade scripts. Apply in chronological order.
- scripts/ — Ad‑hoc maintenance helpers (e.g., recomputing WAC).
- seeds/ — Optional seed helpers for special cases.

## Baseline vs. migrations
- initial_schema.sql is for bootstrapping a brand‑new database. It’s written to be idempotent, but don’t rely on it to “upgrade” existing installations in production; use migrations instead.
- migrations/*.sql are append‑only upgrade scripts. Each new schema change should have its own migration file and must be idempotent so it can be applied multiple times safely.

## What’s in the baseline (high level)
- Core tables for parts, invoices, applications (vehicle_make/model/engine), purchasing, tags, permissions/roles, documents, and inventory transactions.
- Extensions: pgcrypto (for gen_random_uuid) and pg_trgm (optional search indexes).
- Pragmatic indexes for common joins and filters.
- Seeds for permission levels and standard permissions (including documents). Note: the baseline also standardizes role_permission mappings; avoid re‑running this on existing prod DBs unless that reset is desired.

## Authoring migrations (conventions)
- File naming: YYYYMMDD_short_description.sql (e.g., 20250901_create_documents_table.sql)
- One concern per file: create table, add column, add index, seed, etc.
- Idempotency is required. Use these patterns:
	- CREATE TABLE IF NOT EXISTS ...
	- ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...
	- CREATE INDEX IF NOT EXISTS ...
	- DO $$ BEGIN IF NOT EXISTS (...) THEN ... END IF; END$$;
	- INSERT ... ON CONFLICT DO NOTHING / DO UPDATE
- Transactions: Wrap changes in BEGIN; ... COMMIT; so they apply atomically.
- Avoid destructive operations (DROP/DELETE) in general migrations. If unavoidable, split into:
	1) additive change (create new column/table)
	2) backfill
	3) code switch (deploy app version using new object)
	4) removal in a later, separately reviewed migration

### Common templates
- Add a column safely
	ALTER TABLE public.some_table ADD COLUMN IF NOT EXISTS new_col text;

- Add a unique constraint conditionally
	DO $$
	BEGIN
		IF NOT EXISTS (
			SELECT 1 FROM pg_constraint
			WHERE conname = 'unique_some_table_cols'
				AND conrelid = 'public.some_table'::regclass
		) THEN
			ALTER TABLE public.some_table
			ADD CONSTRAINT unique_some_table_cols UNIQUE (col1, col2);
		END IF;
	END$$;

- Create an index
	CREATE INDEX IF NOT EXISTS idx_some_table_col ON public.some_table (col);

- Seed/update rows safely
	INSERT INTO public.settings (setting_key, setting_value)
	VALUES ('MY_KEY', 'value')
	ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value;

### Examples in this repo
- 20250901_create_documents_table.sql — creates documents table if missing; ensures indexes.
- document_metadata_v2.sql — ensures metadata column and GIN index.
- 20250820_create_payment_term_table.sql — creates lookup with unique(days_to_due) and seeds.
- 20250820_add_payment_terms_days_and_due_date.sql — column adds on invoice (no‑op if present).
- 20250821_add_documents_permissions.sql — inserts permissions and grants to Admin/Manager idempotently.

## Applying schema: dev and prod (non‑destructive)

Initial install (fresh DB):
1) Run initial_schema.sql once on the target DB/container.
2) Apply all migration files in chronological order.

Applying migrations on an existing DB (safe):
- Always back up first in production.
- Apply all new files from migrations/ in order. Scripts are idempotent; running again is safe.

PowerShell (Windows) example with Docker:
1) Baseline on a fresh server
	 docker cp .\database\initial_schema.sql forson_db:/initial_schema.sql
	 docker exec -u postgres forson_db psql -d forson_business_suite -f /initial_schema.sql
2) Apply migrations (recommended on all installs)
	 Get-ChildItem .\database\migrations\*.sql | Sort-Object Name | ForEach-Object {
		 docker cp $_.FullName forson_db:/m.sql
		 docker exec -u postgres forson_db psql -d forson_business_suite -f /m.sql
	 }

Linux/macOS (bash) example:
	for f in database/migrations/*.sql; do
		docker cp "$f" forson_db:/m.sql
		docker exec -u postgres forson_db psql -d forson_business_suite -f /m.sql
	done

## Backup and rollback
- Backups: The compose stack includes a backup service. Validate backups before applying migrations.
- Rollback: Since migrations are additive/idempotent, “rollback” usually means deploying the previous app version; avoid destructive migrations. If a destructive change is planned, design a reversible path and split steps as described above.

## PR checklist for DB changes
- [ ] New migration file added under database/migrations with correct date prefix
- [ ] Idempotent patterns used (IF NOT EXISTS, ON CONFLICT, conditional DO blocks)
- [ ] Wrapped in a transaction (BEGIN/COMMIT)
- [ ] No destructive statements, or they’re split into a staged plan with backfill
- [ ] Indexes added for expected query patterns
- [ ] Code updated to use new objects (API queries/routes)
- [ ] README/commands updated if operator runbooks change

## FAQ
Q: What if a migration runs twice?
A: It’s designed to be idempotent; IF NOT EXISTS/ON CONFLICT make it a no‑op.

Q: Can I edit initial_schema.sql for a feature after we shipped?
A: Add a migration instead. Only update baseline to help new installs; existing installs must use migrations.

Q: Where are maintenance scripts?
A: See database/scripts/*.sql (e.g., recompute_wac.sql). Root files with the same names are placeholders pointing to scripts/.

Q: How do I add a new table?
A: Create a migration file: CREATE TABLE IF NOT EXISTS ..., add indexes, and ensure the API queries are updated. If you also want it in the baseline for new installs, mirror the same statements in initial_schema.sql in a separate PR.

---

For questions about schema patterns or performance, ping the reviewers in your PR and include expected query shapes so we can add appropriate indexes.