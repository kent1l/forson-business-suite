# Changelog

## v1.5.1 - 2026-06-09

- Fixed the `update-prod.sh` script to intelligently determine whether to run `git pull` based on the Git HEAD state (branch vs. detached tag).
- Fix: Restricted the cheque printing routes and sidebar link to only users with appropriate role permissions (`cheques:view`, `cheques:create`, `cheques:manage_settings`).
- Added cycle count features, including batch generation with priority scoring, staff execution dashboard and mobile counter, manager review desk with automatic adjustment tolerances, and a performance analytics dashboard.

## v1.4.4 - 2026-05-14

### Docs
- Replaced all references to the deprecated `migrate-prod.sh` bash script with the new Node.js migration runner (`packages/api/scripts/migrate.js`) across `COMMANDS.md`, `README.md`, and `database/README.md`.
- Updated production migration commands to use `docker compose exec -T backend node scripts/migrate.js up` with correct `backend` service name.
- Standardized local dev migration commands to `npm --prefix packages/api run migrate -- --host localhost`.
- Updated Release Best Practices Checklist in `APPLICATION_VERSIONING_AND_RELEASE_GUIDE.md` to reference `migrate:status` and `migrate:verify` for pre-deploy drift detection.
- Highlighted new runner capabilities (idempotent execution, checksum tracking in `schema_migrations`, drift detection) in all relevant documentation.

### Fixed
- Fixed incorrect Docker service name (`api` → `backend`) in the deprecation warning of `scripts/migrate-prod.sh`.

## v1.4.3 - 2026-05-14

### Fixed
- Parts page now works
- Fixed missing tables and implemented permanent and future fix
- Self-healing migration
- Cheque print page fix
- Cheque print history fixed. Now saves history regardless of actions after generating.

### Optimization
- Setup Graphify
- Optimized the migration command in order to avoid getting the storage bloated.
- Created a migration script for safer and healthier migration

### CI/CD
- Updated deploy.yml to run chmod for scripts
- Added database migration script
- Created a production update/upgrade script
- Created the migrate.js instead for better update and migration pipeline



## [1.4.2] - 2026-05-10
### Fixed
- Resolved a production 500 Internal Server Error on the Parts page caused by missing vehicle application tables.
- Added recovery migration `20260510_ensure_vehicle_application_schema.sql` to synchronize production database schema with the development environment.

### Changed
- Improved error handling in `packages/api/routes/partRoutes.js` to log detailed stack traces privately to the server console while returning sanitized JSON responses to the client.

### Docs
- Updated `COMMANDS.md` with strict Developer Rules enforcing a "Migration-First" workflow and logging checks for production troubleshooting.

## v1.4.1
- **Dependencies update**
- **Cheque Printer updates:**
	- Added save preset logic and button
	- Added export and import of presets and profiles feature
	- Fixed initial usage of Cheque Printer error
- **Parts Cleanup updates:**
	- Cascade duplicate finding logic
	- Improved duplicate detection algorithm. Now cascades testing logic from specific to less; part_number>brand>group>part_detail>fuzzy, semantic
	- Duplicate connection graph to find similarities between found pairs
	- Connected-component clustering
	- Added manual selection cleanup
- **Meilisearch optimization:**
	- Implemented "Strict Relevance with Exact-Match Priority" strategy.
	- Reordered the ranking rules cascade to prioritize exact string matches and strict attributes over typo-tolerance, adding an alphabetical sort fallback.
	- Restructured the searchable attributes hierarchy to ensure strict identifiers (SKUs, Part Numbers) take absolute priority over item descriptions.
	- Disabled typo tolerance on strict identifier fields to prevent the surfacing of incompatible parts.
	- Enforced the 'all' matching strategy to strictly filter out irrelevant results, natively resolving middle-dimension search accuracy (e.g., "*50").
	- Optimized the API search payload limit to improve database query performance and prevent bottlenecking during rapid typing.
