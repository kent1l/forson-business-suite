# Rule of Immutability: Database Migrations

**Historical database migrations MUST NEVER be edited.**

To fix a database issue, alter a table, or resolve a bug from a previous migration, you must ALWAYS create a brand-new, correctly timestamped forward-migration file. Modifying existing migration files destroys schema history and is strictly prohibited.

Do not:
- Add `IF NOT EXISTS` or `IF EXISTS` to past migrations to "fix" crashes.
- Modify column definitions in older migrations.
- Change indices or views in historical files.

Any file in `database/migrations` that is already committed to the main branch is entirely immutable.

### Migration Naming & Sequencing Rules

- **Sequence Indices**: When multiple migration files share the same date stamp, or when execution order is critical, you **MUST** include a two-digit sequential numeric index prefix (e.g., `_01_`, `_02_`) immediately following the date timestamp.
  - **Correct**: `20260701_01_create_part_barcode_table.sql` and `20260701_02_add_barcodes_to_parts_view.sql`
  - **Incorrect**: `20260701_create_part_barcode_table.sql` and `20260701_02_add_barcodes_to_parts_view.sql` (results in alphabetical sorting bugs as `0` sorts before `c`).
- **Alphabetical Safety**: Always verify that the ASCII sort order of the file names matches the dependency chain of the migrations.

If a renaming is required before code is committed/released to resolve a sorting conflict, perform the rename rather than modifying the content of applied migrations.
