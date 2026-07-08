# Changelog

## v2.3.1 - 2026-07-08

### Fixed
- **SSE Event Buffering**: Added `X-Accel-Buffering: no` header to the duplicate parts finder stream to prevent Nginx response buffering and ensure real-time delivery of progress events.

## v2.3.0 - 2026-07-08

### Added
- **AI-Verified Duplicate Parts Assessment**: Implemented LLM-based duplicate verification, algorithmic similarity scoring, and manual part exclusion persistence with `source` and `reason` fields.
- **Real-Time Progress Tracking (SSE)**: Added Server-Sent Events (SSE) support for streaming live progress updates during duplicate detection workflows.
- **Smart Auto-Selection & Union-Find Optimization**: Integrated a transitive union-find optimization, a smart auto-selection algorithm, and bulk high-confidence selection options.
- **Advanced Model Fallbacks**: Configured OpenRouter service retries and fallback models (via `OPENROUTER_FALLBACK_MODEL` environment variable), and allowed customization of the Gemini model.
- **Visual Analytics & Status UI**: Added AI verification statistics, tag rendering (obvious vs. transitive matches), model information tracking, and a compact view toggle to the Parts Cleanup dashboard.

### Fixed
- **Numeric Token Validation**: Prevented AI match skipping during token mismatch detection in the duplicate finder pipeline.
- **Resilient AI Verification**: Allowed explicit skipping of AI verification when API keys are missing.

### Refactored / Optimized
- **Duplicate Detection v2**: Standardized duplicate detection on the optimized v2 algorithm, including Dice similarity improvements and heuristic threshold adjustments.
- **Batch Processing**: Implemented batch processing for LLM verification to optimize performance and token usage.
- **Configuration Pathing**: Updated dotenv initialization to search parent paths for `.env` files.

## v2.2.0 - 2026-07-07

### Added
- **OTA Update Controls and Download Portal**: Introduced custom admin settings for managing mobile OTA update metadata, release notes, and version status. Built a dedicated warehouse client update/download portal supporting local update checks and direct APK downloads.
- **Cycle Count Started-At tracking**: Added `started_at` tracking to cycle counts to enable precise snapshots of system stock level relative to transaction history.
- **Mobile Device Provisioning**: Implemented QR-based mobile device provisioning and simplified APK deployment handling.
- **Barcode Viewfinder Visuals & Controls**: Added toggleable torch control, animated laser viewfinder, and spatial filtering to mobile barcode scanners.
- **Auto-Sync and Foreground Checks**: Integrated a background `sync-mobile-version` script to development/production workflows, and added a mobile AppState listener to automatically re-check OTA updates when the app returns to the foreground.

### Fixed
- **Camera Torch Defaults**: Set default camera torch state to off across all mobile scanner views.
- **Tapped Item Start Index**: Configured cycle counts to begin at the tapped item's line index rather than resetting to the top.
- **Barcode Frame Orientation**: Adjusted barcode coordinates calculation to correctly account for camera frame orientation.

### Refactored / Optimized
- **Reusable Scanning Pipeline**: Extracted scanner logic into a unified, high-performance scanning pipeline with ROI coordinate alignment, frame throttling, and EAN checksum/consensus validation.
- **Standardized Branding**: Updated splash screens, Android adaptive icons, and header labels to standardize branding under the "FORSON" identity.

## v2.1.3 - 2026-07-05

### Fixed
- **Permission Access in AuthContext**: Resolved an issue with nested permission mapping inside `AuthContext`, enabling fallback checking for `user?.permissions` and fixing permission setting on login.
- **HMR Local Host Routing**: Removed the hardcoded local HMR host constraint in Vite configuration to ensure correct socket communication across Docker container ports.

## v2.1.2 - 2026-07-05

### Added
- **Mobile Settings & User Profile Screens**: Added profile and settings screens in the mobile app, with support in the API employee routes, configured Expo navigation, and resolved React Native modal imports in the main dashboard view.
- **Bulk Removal Support for Cycle Count**: Implemented bulk removal options for cycle count items with item filtering and selection controls on the manager review desk.
- **Graphify Environment Setup Script Enhancements**: Added an interactive AI platform integration setup and local AST extraction fallback to the developer environment setup scripts.

## v2.1.1 - 2026-07-04

### Fixed
- **Database Migration Sequencing**: Renamed the part barcode table migration to enforce correct alphabetical execution order and updated project database migration guidelines to prevent schema sorting issues.
- **Cheque PDF Generator**: Added support for letter feed types in the PDF fallback renderer path, correcting the MediaBox dimensions to match PDF-lib output when pdf-lib is unavailable or fails.

## v2.1.0 - 2026-07-04

### Added
- **Cycle Count Audit History and Controls**: Added audit history log, manager controls, and employee detail drill-down. Implemented Meilisearch part search and pagination to My Progress web tab. Staff progress view and pending count edit is now available on web and mobile.
- **Multiple Barcodes Support**: Implemented multiple barcodes per item with instant barcode lookup via a dedicated DB endpoint, bypassing Meilisearch and debounce. Supported physical barcode scanners by intercepting rapid enter presses.
- **Mobile Application Redesign**: Redesigned the MobileCounter layout with tablet-responsive scaling and dynamic quantity display font sizes based on ROW_HEIGHT. Updated the Android app architecture map with updated header and counter layouts.
- **Mobile Networking Settings**: Enabled cleartext traffic and configured network security for the Android app. Added reset default server IP and auto-prompt configuration on connection failure.

### Fixed
- Masked system quantity for pending review items in progress views.
- Staff now correctly edits `PENDING_MANAGER_REVIEW` lines, not raw `PENDING`.
- Prevented duplicate pending items in workload query by extracting aggregation.
- Redirected to unassigned search after clearing ad-hoc mode in the count screen.
- Bypassed React state batching by reading raw DOM value on Enter for instant scanner lookup.
- Disabled dev client for preview/production EAS builds and removed hardcoded dev IP to fix async store rehydration race.
- Fixed `patch-package` missing in CI workflow by installing root deps first.

## v2.0.0 - 2026-06-25

### Added
- **Mobile Application (Expo & React Native)**: Introduced a brand-new mobile app in `packages/mobile` for inventory cycle counting. Includes core network and state architecture, PIN authentication with custom numeric keypad, TanStack Query integration, configurable API server IP settings with connection testing, and persistent storage.
- **Advanced Mobile Counting & Scan Workflows**: Implemented camera-based barcode scanning using `react-native-vision-camera` and `nitro-image`, featuring auto-focus, haptic feedback, scan validation, and pull-to-refresh functionality.
- **Ad-Hoc Inventory Workflows**: Added support for ad-hoc inventory counting, including an unassigned parts search and counting screen integrated with the mobile store.
- **Android Native Project & Branding**: Configured Android native project structures, adaptive launcher icons, assets, and Expo Router type safety.
- **Barcode Uniqueness Enforcements**: Implemented database migrations, API-level validations, and mobile scanning flow optimizations to guarantee unique part barcodes, verified with a comprehensive test suite.

### Refactored / Optimized
- **Database & Search Refactoring**: Replaced complex application-level display name construction with a native SQL view (`public.parts_view`) for all database queries and Meilisearch synchronizations, significantly improving search and retrieval performance.
- **Mobile Ergonomics**: Refactored the Cycle Count and MobileCounter screens to implement a responsive, single-screen adaptive layout optimized for mobile device ergonomics.

## v1.5.1.1 - 2026-06-09

- Fix: Corrected foreign key constraints referencing the `employee` table in the cycle count migrations, and added appropriate `ON DELETE CASCADE` and `ON DELETE SET NULL` rules.
- Fix: Added a unique index to the materialized performance view to enable concurrent view refreshes without database locking.

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
