# Changelog

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
