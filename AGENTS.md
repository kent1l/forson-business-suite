## Architecture

Monorepo with npm workspaces under `packages/*`:
- **`packages/api`** — Node.js/Express backend (entry: `index.js`). Loads `.env` from repo root (`../../.env`). Routes in `routes/`, services in `services/`, helpers in `helpers/`. Timezone hardcoded to `Asia/Manila`.
- **`packages/web`** — React + Vite + Tailwind CSS v4 frontend. Proxies `/api` → `http://forson_backend_dev:3001`. Build defines `__APP_VERSION__`, `__APP_COMMIT_SHA__`, `__APP_BUILD_DATE__`.
- **`packages/mobile`** — Expo app (see its own `AGENTS.md`; always consult latest Expo docs at https://docs.expo.dev/versions/v56.0.0/).

## Commands

| Action | Command |
|---|---|
| Dev up | `./scripts/start-dev.sh` (or `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build`) |
| Dev down | `docker compose down` |
| Reset local DB | `./scripts/reset-dev-db.sh` |
| Test (API) | `npm test` (root) or `npm run -w packages/api test` |
| Test (single) | `npx jest --config jest.config.js test/myFile.test.js` (in `packages/api`) |
| Lint (API) | `npm run lint` (root) or `npm run -w packages/api lint` |
| Lint (web) | `npm run -w packages/web lint` |
| Migrate (local) | `npm run -w packages/api migrate -- --host localhost` |
| Migrate (status) | `npm run -w packages/api migrate:status -- --host localhost` |
| Migrate (verify) | `npm run -w packages/api migrate:verify -- --host localhost` |
| Production up | `sudo docker compose -f docker-compose.prod.yml up -d --pull=always --remove-orphans` |
| Production migrate | `sudo docker compose -f docker-compose.prod.yml exec -T backend node scripts/migrate.js up` |
| Production update | `./scripts/update-prod.sh` |

## Database & Migrations

- Schema baseline: `database/initial_schema.sql` — **never edit without a matching migration** (`database/migrations/`).
- Migrations run idempotent SQL files in filename order, tracked in `schema_migrations` table via SHA-256 checksums.
- Commands: `up` (default), `status`, `verify` (drift detection), `repair`, `baseline`.
- Use `--from FILE --to FILE` to target a window; `--skip FILE` to exclude; `--include-seeds` to run optional seed migrations (excluded by default; also respects `MIGRATE_INCLUDE_SEEDS=true`).
- Configuration follows discrete `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` env vars.

## Testing

- Jest with `supertest`. Tests live in `packages/api/test/` and `packages/api/tests/` — both match `**/test/**/*.test.js` and `**/tests/**/*.test.js`.
- **Tests need a real PostgreSQL connection.** No mocking by default. CI spins up a `postgres:15` service container with `test/test/test` credentials.
- The `payment_terms_db_test.js` file is explicitly excluded from the jest config.

## Background Workers

Controlled by env vars (set in `.env`):
- `DISABLE_MEILI_OUTBOX_WORKER=true` — durable outbox for part sync
- `DISABLE_MEILI_APPLICATIONS_LISTENER=true` — applications index LISTEN/NOTIFY
- `ENABLE_LEGACY_MEILI_PART_LISTENER=true` — legacy parts listener (normally off)
- `DISABLE_SEARCH_REPAIR_WORKER=true` — search repair worker
- `DISABLE_DEDUPE_SCAN_WORKER=true` — deduplication scan worker

## Deployment

- Push to `master` → GitHub Actions builds Docker images (`kentonel/forson-backend`, `kentonel/forson-frontend` → Docker Hub; `ghcr.io` → GHCR).
- Git tag `v*` triggers production deploy over SSH (currently disabled in CI YAML). Secrets: `STAGING_HOST/USER/KEY`, `PROD_HOST/USER/KEY`.
- Staging/prod both run `./scripts/update-prod.sh` on the target server.

## graphify

Project has a knowledge graph at `graphify-out/` with god nodes, community structure, and cross-file relationships.

- For codebase questions, first run `graphify query "<question>"` when `graphify-out/graph.json` exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts.
- Dirty graphify-out/ files are expected after hooks or incremental updates; do not skip graphify because of dirtiness. Only skip if the task is about stale graph output or the user says not to use it.
- If `graphify-out/wiki/index.md` exists, use it for broad navigation instead of raw source browsing.
- Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
