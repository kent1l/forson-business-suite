# Rule of Immutability: Database Migrations

**Historical database migrations MUST NEVER be edited.**

To fix a database issue, alter a table, or resolve a bug from a previous migration, you must ALWAYS create a brand-new, correctly timestamped forward-migration file. Modifying existing migration files destroys schema history and is strictly prohibited.

Do not:
- Add `IF NOT EXISTS` or `IF EXISTS` to past migrations to "fix" crashes.
- Modify column definitions in older migrations.
- Change indices or views in historical files.

Any file in `database/migrations` that is already committed to the main branch is entirely immutable.
