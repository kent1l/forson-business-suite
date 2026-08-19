# A/R & Sales History Restore Runbook

**Status:** ready to execute · **Audience:** operator + Claude Code session running *on the production host*

This runbook repairs a production database whose sales/A/R history was destroyed by
`docs/temp/once_ar_cleanup.sql`. It merges the lost history back in **without disturbing records
created after the wipe**, and leaves primary keys and ledger running balances in true
chronological order.

It is self-contained. You do not need the conversation that produced it.

---

## 1. The incident

Event sequence on production:

| # | Event |
|---|---|
| 1 | Production running **v2.5.1** |
| 2 | **DBeaver backup taken** — captures the v2.5.1 schema plus full sales/A/R history |
| 3 | Production updated to **v2.6.1.2** — 54 migrations ran **over the full historical data** |
| 4 | **The wipe** — `once_ar_cleanup.sql` executed |
| 5 | New records recorded under the v2.6.1.2 schema |

Step 3 happened *before* step 4. The migrations legitimately saw the complete history, so the
restored rows must pass through those same migrations — including their backfills — before being
merged. Otherwise they end up structurally inconsistent with the rows sitting next to them
(missing `ar_ledger.entry_date`, missing `PAYMENT_SETTLED` entries, missing
`customer_payment.physical_receipt_no`, and so on).

**Phase 2 handles this by restoring the backup into a scratch database and running the real
migration runner against it.** Nothing in this runbook runs migrations against production.

### Strategy: append old into current

Two directions were considered. Appending the old cluster into the live database is correct, and
the asymmetry is large:

- The cleanup emptied **one dependency tree**: `invoice`, `invoice_line`, `invoice_payments`,
  `invoice_payment_allocation`, `invoice_tax_breakdown`, `customer_payment`, `credit_note`,
  `credit_note_line`, `credit_note_tax_breakdown`, `due_date_log`, `ar_ledger`,
  `customer_wallet`, `customer_wallet_transaction`.
- **Everything outside that tree kept accumulating** after the wipe. On a dev-server copy of this
  same incident that meant an entire HR/payroll module (`daily_time_record` +981, `pay_period`
  +72, `employee` +53), the A/P ledger, `bank_account`, `cheque_records`, cycle counts (+362
  rows), 118 new customers, plus settings and permissions seeded by migrations.

Restoring the old dump wholesale and re-appending the new data would mean re-appending all of
that, across ~40 tables guarded by payroll state machines, statutory-version guards, and ledger
immutability triggers. Appending the old cluster touches only what the cleanup actually emptied.

### Reference numbers (dev-server copy — do not trust for production)

The same incident occurred on a dev-server copy, which gives a verified worked example:
4,834 invoices / 9,293 lines / 4,676 payments / 5,209 ledger rows lost; only 14 genuine invoices
recorded post-wipe (59 of 73 were `INV-TEST-*` fixtures); zero `invoice_number` collisions; all 92
`customer_id`s intact; `inventory_transaction`, `part` and `document_sequence` untouched.

**Production numbers will differ. Phase 1 re-derives every one of these facts.**

---

## 2. Conventions used below

```bash
# Adjust once, then reuse. Run from the repo checkout on the production host.
export PGHOST=localhost PGPORT=5432 PGUSER=postgres
export PGPASSWORD='...'           # from .env  (DB_PASSWORD)
export LIVE_DB=forson_business_suite
export SCRATCH_DB=forson_restore
export WORK=/var/tmp/ar-restore   # scratch space, NOT inside the repo
mkdir -p "$WORK"
```

`psql -d "$LIVE_DB"` targets production. `psql -d "$SCRATCH_DB"` targets the scratch copy.
Read-only queries against production are safe at any point; **every write is explicitly marked.**

Each phase ends with a **Gate**. Do not proceed past a failed gate.

---

## Phase 0 — Freeze and safety net

> **Writes:** stops a container, creates dump files. No data modification.

### 0.1 Stop the backend

```bash
docker compose -f docker-compose.prod.yml stop backend
```

This prevents new invoices, payments and ledger entries from landing mid-merge. It also stops the
hourly `ledgerReconciliationService` (`packages/api/services/ledgerReconciliationService.js`,
started from `packages/api/index.js`), which would otherwise fire drift alerts throughout.

### 0.2 Take the rollback dump — before touching anything

```bash
pg_dump -d "$LIVE_DB" --clean --if-exists --no-owner --no-acl \
  | gzip > "$WORK/ROLLBACK-live-pre-restore-$(date +%Y%m%dT%H%M%S).sql.gz"
```

Copy it **off the host**. This is the single rollback point for the entire operation.

### 0.3 Look for a better source than the DBeaver backup — do this first

Production runs the same backup sidecar as the rest of the fleet (`backup/backup.sh`): a nightly
`pg_dump --clean --if-exists --no-owner --no-acl | gzip`, kept locally for
`BACKUP_RETENTION_DAYS` (default 7) and, when `BACKUP_GDRIVE_ENABLED` is true, on Google Drive for
`BACKUP_REMOTE_RETENTION_DAYS` (default 30).

```sql
-- read-only
SELECT setting_key, setting_value FROM settings WHERE setting_key LIKE 'BACKUP%' ORDER BY 1;
```

```bash
docker exec forson_backup ls -la /backups
docker exec forson_backup rclone lsl gdrive:forson-backups --config /scripts/rclone.conf | sort -k2
```

**A nightly dump taken between the DBeaver backup and the wipe is strictly better than the
DBeaver backup**: it is a native `pg_dump`, already at the v2.6.1.2 schema, which lets you skip
the migration replay in Phase 2 entirely and closes any data gap that Phase 1.3 would otherwise
report as permanently lost.

**Finding the wipe date:** a sharp drop in dump file size marks it. On the dev copy the nightly
sequence fell from 1,143,524 bytes to 591,182 bytes across a single night, which pinned the
incident to a 16-minute window. Look for the same cliff in the listing above.

If you find such a dump, use it as the Phase 2 source and note that Phase 2.3 (migration replay)
becomes a no-op — verify with `migrate.js status` rather than skipping the check.

**Gate 0:** rollback dump exists off-host; backend stopped; the best available source identified
and its path recorded.

---

## Phase 1 — Forensics (read-only)

Produce a written report before changing anything. Every number here comes from production, not
from the reference figures in §1.

Load the chosen backup into a working file:

```bash
gunzip -c "$WORK/<source>.sql.gz" > "$WORK/old.sql"   # or use the DBeaver export directly
```

### 1.1 Which damage profile?

`docs/temp/once_ar_cleanup.sql` exists in two materially different forms in git history, and the
repair differs between them:

| | Profile A (`13b4ae5` and earlier) | Profile B (`1474932`, current HEAD) |
|---|---|---|
| `invoice`, `invoice_line` | **Truncated**, `RESTART IDENTITY CASCADE` | **Survive** with original IDs |
| Payments / allocations / credit notes / ledger / wallets | Truncated, identity restarted | Truncated, identity restarted |
| `invoice.amount_paid` / `status` | Gone with the rows | **Every row** forced to `0` / `'Unpaid'` — including rows previously `Paid`, `Cancelled`, `Fully Refunded` |
| Post-wipe invoice IDs | Reuse historical IDs — collision | No collision |
| Phase 3 needed? | Yes | **No** |

Detect it:

```sql
-- read-only, against LIVE
SELECT count(*) AS invoices, min(invoice_id), max(invoice_id),
       min(invoice_date), max(invoice_date)
FROM invoice;

SELECT count(*) FILTER (WHERE status = 'Unpaid' AND amount_paid = 0) AS zeroed,
       count(*) AS total
FROM invoice;
```

If live `invoice` holds roughly the same row count as the backup and IDs run into the thousands,
it is **Profile B**. If live `invoice` holds only a handful of rows with IDs restarting near 1, it
is **Profile A**.

Also check `git log --oneline -- docs/temp/once_ar_cleanup.sql` and ask the operator which
revision was actually executed. Record the answer in the report.

> Note: Profile B's `TRUNCATE ... CASCADE` from `customer_payment` / `invoice_payments` also
> reaches `cheque_clearance_log`, so **A/P cheque bounce history is collateral damage**. Count it:
> `SELECT count(*) FROM cheque_clearance_log;` against the backup's count.

### 1.2 Schema delta between the backup and live

```bash
# Column sets, per table — compares each COPY header in the dump against live
for t in invoice invoice_line invoice_payments invoice_payment_allocation \
         customer_payment ar_ledger credit_note credit_note_line \
         credit_note_tax_breakdown invoice_tax_breakdown due_date_log \
         customer_wallet customer_wallet_transaction customer document_sequence; do
  old=$(grep -m1 "^COPY public\.$t (" "$WORK/old.sql" \
        | sed 's/^COPY [^(]*(//; s/) FROM stdin;//' | tr -d ' ')
  cur=$(psql -d "$LIVE_DB" -tAc "SELECT string_agg(column_name, ',' ORDER BY ordinal_position)
        FROM information_schema.columns
        WHERE table_schema='public' AND table_name='$t'")
  if [ "$old" = "$cur" ]; then
    echo "== $t : IDENTICAL"
  else
    echo "== $t : CHANGED"
    echo "   new-only: $(comm -13 <(echo "$old" | tr ',' '\n' | LC_ALL=C sort) \
                                  <(echo "$cur" | tr ',' '\n' | LC_ALL=C sort) | tr '\n' ' ')"
    echo "   old-only: $(comm -23 <(echo "$old" | tr ',' '\n' | LC_ALL=C sort) \
                                  <(echo "$cur" | tr ',' '\n' | LC_ALL=C sort) | tr '\n' ' ')"
  fi
done
```

```bash
# Migration ledger delta
awk '/^COPY public\.schema_migrations \(/{i=1;next} i&&/^\\\.$/{exit} i{print $1}' "$WORK/old.sql" \
  | LC_ALL=C sort > "$WORK/old_migrations.txt"
psql -d "$LIVE_DB" -tAc "SELECT filename FROM schema_migrations" | LC_ALL=C sort > "$WORK/live_migrations.txt"
echo "pending on backup: $(comm -13 "$WORK/old_migrations.txt" "$WORK/live_migrations.txt" | wc -l)"
comm -13 "$WORK/old_migrations.txt" "$WORK/live_migrations.txt"
```

On the dev copy this surfaced exactly three drifted tables: `customer_payment`
(+`physical_receipt_no`), `ar_ledger` (+`entry_date`), and `inventory_transaction`
(+`client_ref`, +`captured_at`). Phase 2 resolves all of them by replaying the migrations.

### 1.3 The permanent-loss window — escalate this

`document_sequence` is **not** in the cleanup's truncate list, so it survived. Its `last_number`
for each prefix records the highest document number *ever issued*, which lets you detect sales
that exist in no backup at all.

```sql
-- read-only, against LIVE
SELECT prefix, period, last_number
FROM document_sequence
WHERE prefix IN ('INV','CN')
ORDER BY prefix, period;

-- lowest invoice number among post-wipe rows
SELECT min(invoice_number), max(invoice_number)
FROM invoice
WHERE invoice_number ~ '^INV-[0-9]{6}-[0-9]{4}$';
```

```bash
# highest invoice number in the backup
awk '/^COPY public\.invoice \(/{i=1;next} i&&/^\\\.$/{exit} i{print $2}' "$WORK/old.sql" \
  | LC_ALL=C sort | tail -3
```

Any numbers between *the backup's maximum* and *the lowest post-wipe number* are sales made
between the DBeaver backup and the wipe. **They exist in no backup and cannot be recovered from
this material.** Because the backup was taken at v2.5.1 and the wipe came after the v2.6.1.2
upgrade, this gap could span days.

> On the dev copy this check came out clean — the backup ended at `INV-202608-0005` and the first
> post-wipe invoice was `INV-202608-0006`, so nothing fell in the gap. **Do not assume production
> is as lucky.**

Repeat for `CN` (credit notes) and for `physical_receipt_no` continuity.

**Report the gap to the operator and get an explicit decision before continuing.** If the gap is
non-empty, a nightly dump from Phase 0.3 may close it; paper records may be the only other source.

### 1.4 Collision surface

```bash
# invoice_number overlap — expect 0
awk '/^COPY public\.invoice \(/{i=1;next} i&&/^\\\.$/{exit} i{print $2}' "$WORK/old.sql" \
  | LC_ALL=C sort > "$WORK/old_inv_no.txt"
psql -d "$LIVE_DB" -tAc "SELECT invoice_number FROM invoice" | LC_ALL=C sort > "$WORK/live_inv_no.txt"
echo "invoice_number collisions: $(comm -12 "$WORK/old_inv_no.txt" "$WORK/live_inv_no.txt" | wc -l)"
comm -12 "$WORK/old_inv_no.txt" "$WORK/live_inv_no.txt"
```

Because `document_sequence` survived, numbering should have continued cleanly and this should be
**zero**. A non-zero result means the counter was reset too — stop and reassess, since document
numbers would then need reissuing.

Repeat for `credit_note.cn_number` and for `physical_receipt_no` (checking both `invoice` and
`customer_payment`; the unique index `idx_customer_payment_physical_receipt_no_unique` covers
`customer_payment` only, so a cross-table duplicate will insert but confuse users).

Referential integrity — `invoice.customer_id` and `invoice.employee_id` are `ON DELETE RESTRICT`,
so a missing parent blocks the insert outright:

```bash
awk '/^COPY public\.invoice \(/{i=1;next} i&&/^\\\.$/{exit} i{print $3}' "$WORK/old.sql" \
  | LC_ALL=C sort -u > "$WORK/old_customer_refs.txt"
psql -d "$LIVE_DB" -tAc "SELECT customer_id FROM customer" | LC_ALL=C sort -u > "$WORK/live_customer_ids.txt"
echo "missing customers: $(comm -23 "$WORK/old_customer_refs.txt" "$WORK/live_customer_ids.txt" | wc -l)"
```

Do the same for `employee_id` (in `invoice`, `customer_payment`, `credit_note`) and `part_id`
(in `invoice_line`, `credit_note_line`).

### 1.5 Junk audit

Identify non-genuine post-wipe rows before renumbering — you do not want to renumber test data
into the middle of restored history.

```sql
-- read-only
SELECT count(*) FILTER (WHERE invoice_number ~ '^INV-[0-9]{6}-[0-9]{4}$') AS genuine,
       count(*) FILTER (WHERE invoice_number !~ '^INV-[0-9]{6}-[0-9]{4}$') AS suspect
FROM invoice;

SELECT invoice_id, invoice_number, invoice_date, total_amount
FROM invoice
WHERE invoice_number !~ '^INV-[0-9]{6}-[0-9]{4}$'
ORDER BY invoice_id;
```

On the dev copy, 59 of 73 post-wipe invoices were `INV-TEST-*` / `INV-TXNDATE-*` fixtures left by
test runs. **Report the split and let the operator decide. Do not delete anything unilaterally.**
If they choose deletion, archive the affected rows first. `pg_dump --table=` has no row filter, so
export with `COPY` instead:

```bash
psql -d "$LIVE_DB" -c "\copy (
  SELECT * FROM invoice WHERE invoice_number !~ '^INV-[0-9]{6}-[0-9]{4}\$'
) TO '$WORK/ARCHIVE-suspect-invoices.csv' CSV HEADER"

psql -d "$LIVE_DB" -c "\copy (
  SELECT l.* FROM invoice_line l JOIN invoice i USING (invoice_id)
  WHERE i.invoice_number !~ '^INV-[0-9]{6}-[0-9]{4}\$'
) TO '$WORK/ARCHIVE-suspect-lines.csv' CSV HEADER"
```

Repeat for `invoice_payments`, `invoice_tax_breakdown` and `ar_ledger`. Deleting the `invoice`
rows cascades to `invoice_line`, `invoice_payments` and `invoice_tax_breakdown`, but `ar_ledger`
rows must be removed explicitly with `trg_ar_ledger_immutable` disabled.

### 1.6 Constraint compatibility

```sql
-- read-only, against LIVE
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'check_invoice_status';
```

```bash
awk '/^COPY public\.invoice \(/{i=1;next} i&&/^\\\.$/{exit} i{print}' "$WORK/old.sql" \
  | cut -f8 | LC_ALL=C sort | uniq -c
```

Every status value in the backup must satisfy the live constraint.

> **Watch for `'Written Off'`.** The sibling script `docs/temp/once_ar_cleanup_preserve_sales.sql`
> drops and re-adds `check_invoice_status` with a seventh value, `'Written Off'` — **inline, in no
> migration file**. If that variant ever ran on production, live carries a constraint that no
> migration reproduces, and any later schema rebuild silently reverts it. Note it in the report.

**Gate 1:** a written forensics report covering the damage profile, schema delta, permanent-loss
window, collision counts, junk split, and constraint check — reviewed and approved by the
operator. The permanent-loss window in particular must be explicitly acknowledged.

---

## Phase 2 — Scratch database as migration simulator

> **Writes:** to `$SCRATCH_DB` only. Production is untouched throughout this phase.

This is the phase that reproduces "the old data was there, *then* the migrations ran".

### 2.1 Create the scratch database

```sql
CREATE DATABASE forson_restore;
```

### 2.2 Restore the backup into it

**If the source is a nightly `pg_dump`** (schema + data, self-contained):

```bash
gunzip -c "$WORK/<source>.sql.gz" | psql -d "$SCRATCH_DB"
```

**If the source is a DBeaver export**, check whether it carries DDL. DBeaver's default "Export
data" produces `INSERT`/`COPY` statements *only* — no `CREATE TABLE`. In that case build the
schema first, at the v2.5.1 point, then load the data:

```bash
psql -d "$SCRATCH_DB" -f database/initial_schema.sql
git -C . stash list >/dev/null   # ensure a clean checkout
cd packages/api && node scripts/migrate.js up --db "$SCRATCH_DB" \
  --to <last migration present in the backup's schema_migrations>
cd ../.. && psql -d "$SCRATCH_DB" -f "$WORK/dbeaver-export.sql"
```

`--to` is inclusive and takes a filename — use the last entry from `$WORK/old_migrations.txt`
(Phase 1.2). This reconstructs the exact schema the backup's data expects, so the Phase 2.3 replay
then covers precisely the same 54 migrations production ran.

Either way, confirm where you landed:

```bash
psql -d "$SCRATCH_DB" -tAc "SELECT count(*) FROM schema_migrations;"
```

The count should match `$WORK/old_migrations.txt` from Phase 1.2 and be **lower** than live's.

### 2.3 Replay the migrations over the full history

```bash
cd packages/api
node scripts/migrate.js status --db "$SCRATCH_DB"     # review the pending list first
node scripts/migrate.js up --db "$SCRATCH_DB" --dry-run
node scripts/migrate.js up --db "$SCRATCH_DB"
```

`migrate.js` reads its migrations directory from `MIGRATIONS_DIR`, falling back to
`<repoRoot>/database/migrations`. Confirm it resolves to the checkout matching the version
production is running (**v2.6.1.2**) — `git describe --tags` before running.

This replays exactly the migrations production ran at step 3 of the timeline, over the complete
history. That is the point: it is the authentic transformation rather than a hand-written
approximation, and it generates the derived data the old rows are entitled to —

- `20260810_01/02` — adds `customer_payment.physical_receipt_no` and its unique index
- `20260811_02_backfill_ar_ledger_settle_gaps.sql` — creates missing `PAYMENT_SETTLED` entries
- `20260812_10_ar_ledger_production_hardening.sql` — creates `uq_ar_ledger_payment_settled` and
  rewrites `append_ar_ledger_entry()` / `update_invoice_balance_after_payment()`
- `20260816_01_add_entry_date_to_ledgers.sql` — backfills `ar_ledger.entry_date = created_at`
- `20260816_03_recompute_wac_for_part.sql` — installs `recompute_wac_for_part()` / `recompute_all_wac()`

### 2.4 Two expected failure modes — resolve them here, where it is safe

**Checksum drift.** `up` refuses to run when a stored checksum differs from the file on disk. If a
previously applied migration file was edited since the backup was taken:

```bash
node scripts/migrate.js verify --db "$SCRATCH_DB"
node scripts/migrate.js repair --db "$SCRATCH_DB"   # scratch ONLY — never against production
```

**Renamed migrations.** Seven files were renamed in commit `85ae9dd`. If the backup's
`schema_migrations` holds the old names, the runner treats the new names as pending:

| old name in `schema_migrations` | current filename |
|---|---|
| `20260802_fix_ar_trigger_status.sql` | `20260802_01_fix_ar_trigger_status.sql` |
| `20260802_reconcile_ar_balances.sql` | `20260802_02_reconcile_ar_balances.sql` |
| `20260804_01_create_ar_ledger.sql` | `20260802_03_create_ar_ledger.sql` |
| `20260804_02_backfill_ar_ledger.sql` | `20260802_04_backfill_ar_ledger.sql` |
| `20260804_03_seed_ar_manage_permission.sql` | `20260802_05_seed_ar_manage_permission.sql` |
| `20260806_create_customer_wallet.sql` | `20260802_06_create_customer_wallet.sql` |
| `20260805_pdc_lifecycle_and_credit_hold.sql` | `20260802_07_pdc_lifecycle_and_credit_hold.sql` |

Re-running them is safe — they are idempotent, and `20260802_04_backfill_ar_ledger.sql` self-skips
when `ar_ledger` is already non-empty. **Verify that rather than assuming it**: check
`SELECT count(*) FROM ar_ledger` in scratch before and after. (On the dev copy the dump already
carried the new names, so this did not arise.)

### 2.5 Confirm scratch now matches live's schema

```bash
diff <(psql -d "$SCRATCH_DB" -tAc "SELECT table_name||'.'||column_name||':'||data_type
        FROM information_schema.columns WHERE table_schema='public' ORDER BY 1") \
     <(psql -d "$LIVE_DB"    -tAc "SELECT table_name||'.'||column_name||':'||data_type
        FROM information_schema.columns WHERE table_schema='public' ORDER BY 1")

diff <(psql -d "$SCRATCH_DB" -tAc "SELECT filename FROM schema_migrations ORDER BY 1") \
     <(psql -d "$LIVE_DB"    -tAc "SELECT filename FROM schema_migrations ORDER BY 1")
```

**Gate 2:** both diffs are empty. Scratch now holds the pre-wipe production state at the current
schema. Record the maxima you will need in Phase 3:

```sql
-- against SCRATCH
SELECT 'invoice',        max(invoice_id)        FROM invoice
UNION ALL SELECT 'invoice_line',    max(invoice_line_id)   FROM invoice_line
UNION ALL SELECT 'invoice_payments', max(payment_id)       FROM invoice_payments
UNION ALL SELECT 'customer_payment', max(payment_id)       FROM customer_payment
UNION ALL SELECT 'allocation',      max(allocation_id)     FROM invoice_payment_allocation
UNION ALL SELECT 'credit_note',     max(cn_id)             FROM credit_note
UNION ALL SELECT 'credit_note_line', max(cn_line_id)       FROM credit_note_line
UNION ALL SELECT 'ar_ledger',       max(ledger_id)         FROM ar_ledger;
```

---

## Phase 3 — Renumber the live post-wipe rows

> **Profile A only.** Skip entirely under Profile B — invoice IDs never moved there.
> **Writes to production.**

**Goal:** the old history keeps its original IDs; the small set of genuine post-wipe rows moves
above the old maximum. IDs then run in chronological order.

**Why this matters concretely:** `ar_ledger.balance_after` is a *stored* running balance computed
in **`ledger_id` order**, not date order (`append_ar_ledger_entry()` reads the highest `ledger_id`
for the customer and adds to it). Restoring the old rows *above* the new ones would corrupt the
running-balance column for the entire history and every Statement of Account that renders it.
Renumbering the newer, much smaller set is both cheaper and correct.

Pick an offset comfortably above **every** scratch maximum from Gate 2 — one offset reused for all
tables, so cross-table FK references stay consistent. If the largest scratch ID is 14,544, then
100,000 is a safe round choice. Record it; §3.2 and §5.1 both depend on it.

### 3.1 Disable the triggers that would fight you

```sql
BEGIN;

-- ar_ledger is append-only: trg_ar_ledger_immutable raises on UPDATE and DELETE.
-- Same pattern used by database/migrations/20260808_01_add_payment_source_to_ar_ledger.sql
ALTER TABLE ar_ledger DISABLE TRIGGER trg_ar_ledger_immutable;

-- update_invoice_balance_after_payment() fires on these and would recompute
-- invoice.amount_paid / status mid-merge. Phase 5 recomputes deliberately instead.
ALTER TABLE invoice_payments DISABLE TRIGGER USER;
ALTER TABLE credit_note      DISABLE TRIGGER USER;
```

### 3.2 Renumber, parent before child

For each table: copy to a temp table applying the offset to the PK *and* to every FK pointing at a
renumbered parent, delete the live rows, re-insert. Deferring is not an option — these FKs are not
declared `DEFERRABLE`.

PostgreSQL has no `SELECT * EXCEPT`, so the column list must be spelled out. Rather than typing it
by hand for thirteen tables (and risking a silently dropped column), generate the statements from
the catalog — pass the table, its PK, and the FK columns that need the same offset:

Save this to a file and run it with `psql -f` — piping it through a shell heredoc mangles the
dollar-quoting.

```sql
-- Generates the three statements for one table. Review the output, then run it.
CREATE OR REPLACE FUNCTION pg_temp.gen_renumber(
  p_table text, p_offset bigint, p_shift_cols text[]
) RETURNS text LANGUAGE sql AS $fn$
  SELECT format(
    E'CREATE TEMP TABLE t_%1$s ON COMMIT DROP AS SELECT %2$s FROM public.%1$I;\n'
    'DELETE FROM public.%1$I;\n'
    'INSERT INTO public.%1$I SELECT * FROM t_%1$s;',
    p_table,
    string_agg(
      CASE WHEN column_name = ANY(p_shift_cols)
           THEN format('%I + %s AS %I', column_name, p_offset, column_name)
           ELSE quote_ident(column_name) END,
      ', ' ORDER BY ordinal_position)
  )
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = p_table;
$fn$;

-- Example: invoice (PK only), then invoice_line (PK + parent FK)
SELECT pg_temp.gen_renumber('invoice',      100000, ARRAY['invoice_id']);
SELECT pg_temp.gen_renumber('invoice_line', 100000, ARRAY['invoice_line_id','invoice_id']);
```

The `NULL`-safe `+` means nullable FK columns (`ar_ledger.invoice_id`, `.payment_id`, `.cn_id`)
stay `NULL` rather than being corrupted — verify that in the generated SQL before running it.

Process in this order, offsetting the PK and every FK to an already-offset parent:

1. `invoice` (`invoice_id`)
2. `invoice_line` (`invoice_line_id`, `invoice_id`)
3. `invoice_tax_breakdown` (`invoice_id`)
4. `tax_backfill_log` (`invoice_id`)
5. `due_date_log` (`invoice_id`)
6. `invoice_payments` (`payment_id`, `invoice_id`)
7. `customer_payment` (`payment_id`)
8. `invoice_payment_allocation` (`allocation_id`, `invoice_id`, `payment_id` → `customer_payment`)
9. `credit_note` (`cn_id`, `invoice_id`)
10. `credit_note_line` (`cn_line_id`, `cn_id`)
11. `credit_note_tax_breakdown` (`cn_id`)
12. `ar_ledger` (`ledger_id`, `invoice_id`, `payment_id` → `invoice_payments`, `cn_id`)
13. `customer_wallet` (`wallet_id`), `customer_wallet_transaction` (`transaction_id`, `wallet_id`)

Then sweep for stragglers referencing renumbered IDs:

- `cheque_clearance_log.payment_id`, `.customer_payment_id`
- `transaction_date_change_log` (stores entity IDs)
- `staged_sale` (any invoice linkage)

```sql
-- Find anything else pointing at the renumbered tables
SELECT conrelid::regclass AS child, conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE contype = 'f'
  AND confrelid::regclass::text IN
      ('invoice','invoice_payments','customer_payment','credit_note','ar_ledger','customer_wallet')
ORDER BY 1;
```

**Do not touch `inventory_transaction`.** Its `reference_no` stores the invoice *number*, not the
ID, so stock movements survive renumbering untouched — which is exactly why stock and WAC need no
repair.

```sql
COMMIT;   -- triggers are re-enabled in Phase 5.6
```

**Gate 3:** every genuine post-wipe row now has an ID above the scratch maximum; the FK sweep
returns no dangling references; row counts are unchanged.

---

## Phase 4 — Merge the historical cluster

> **Writes to production.**

### 4.1 Export the cluster from scratch

```bash
pg_dump -d "$SCRATCH_DB" --data-only --no-owner --no-acl \
  --table=invoice --table=invoice_line --table=invoice_tax_breakdown \
  --table=tax_backfill_log --table=due_date_log \
  --table=invoice_payments --table=customer_payment \
  --table=invoice_payment_allocation \
  --table=credit_note --table=credit_note_line --table=credit_note_tax_breakdown \
  --table=ar_ledger --table=customer_wallet --table=customer_wallet_transaction \
  > "$WORK/history-cluster.sql"
```

Under **Profile B**, drop `--table=invoice`, `--table=invoice_line` and
`--table=invoice_tax_breakdown` — those rows survived on production and the live copies are
authoritative.

**Never export** `inventory_transaction`, `part`, `document_sequence`, `customer`, `employee`,
`goods_receipt`, or anything else the cleanup did not touch. The live copies are newer.

### 4.2 Load into production

One transaction, triggers off on the target tables, inserting parents before children in the order
above (this is the order `pg_dump` emits and it already respects the `RESTRICT`/`CASCADE` FKs):

```sql
BEGIN;
ALTER TABLE invoice                    DISABLE TRIGGER USER;
ALTER TABLE invoice_payments           DISABLE TRIGGER USER;
ALTER TABLE customer_payment           DISABLE TRIGGER USER;
ALTER TABLE credit_note                DISABLE TRIGGER USER;
ALTER TABLE credit_note_line           DISABLE TRIGGER USER;
ALTER TABLE invoice_payment_allocation DISABLE TRIGGER USER;
ALTER TABLE ar_ledger                  DISABLE TRIGGER trg_ar_ledger_immutable;
ALTER TABLE customer_wallet            DISABLE TRIGGER USER;
ALTER TABLE customer_wallet_transaction DISABLE TRIGGER USER;

\i /var/tmp/ar-restore/history-cluster.sql

COMMIT;
```

`\i` takes a literal path — it does not expand `$WORK` or any other shell variable. Adjust the
path if you changed `$WORK` in §2.

If the load aborts, the whole transaction rolls back — re-diagnose rather than retrying blindly.

### 4.3 Repair the two side-effects outside the truncated set

The cleanup also modified tables it did not truncate:

```sql
-- (a) credit-hold state was wiped:  UPDATE customer SET credit_hold = false, credit_hold_reason = NULL
--     Restore from the backup for customers that existed then.
--     Load the backup's customer rows into a staging table first, then:
UPDATE customer c
SET credit_hold        = s.credit_hold,
    credit_hold_reason = s.credit_hold_reason
FROM staging_old_customer s
WHERE c.customer_id = s.customer_id;
```

```sql
-- (b) Profile B only: UPDATE invoice SET amount_paid = 0, status = 'Unpaid' hit EVERY row,
--     including previously Paid / Cancelled / Fully Refunded ones.
UPDATE invoice i
SET amount_paid = s.amount_paid,
    status      = s.status
FROM staging_old_invoice s
WHERE i.invoice_id = s.invoice_id;
```

Phase 5.4 then recomputes these from the underlying payments as a cross-check.

**Gate 4:** row counts per table equal *backup + live-delta* (with the Phase 1.5 junk decision
applied); no FK violations on `COMMIT`.

---

## Phase 5 — Reseed sequences and recompute derived state

> **Writes to production.** Nothing here is optional; each item is a known trap.

### 5.1 Sequences

Every table in the cluster uses `serial`/`bigserial`, and `RESTART IDENTITY` reset them all. Left
unfixed, the next insert collides with restored history.

```sql
SELECT setval('invoice_invoice_id_seq',                        (SELECT max(invoice_id)     FROM invoice));
SELECT setval('invoice_line_invoice_line_id_seq',              (SELECT max(invoice_line_id) FROM invoice_line));
SELECT setval('invoice_payments_payment_id_seq',               (SELECT max(payment_id)     FROM invoice_payments));
SELECT setval('customer_payment_payment_id_seq',               (SELECT max(payment_id)     FROM customer_payment));
SELECT setval('invoice_payment_allocation_allocation_id_seq',  (SELECT max(allocation_id)  FROM invoice_payment_allocation));
SELECT setval('credit_note_cn_id_seq',                         (SELECT max(cn_id)          FROM credit_note));
SELECT setval('credit_note_line_cn_line_id_seq',               (SELECT max(cn_line_id)     FROM credit_note_line));
SELECT setval('ar_ledger_ledger_id_seq',                       (SELECT max(ledger_id)      FROM ar_ledger));
SELECT setval('customer_wallet_wallet_id_seq',                 (SELECT max(wallet_id)      FROM customer_wallet));
SELECT setval('customer_wallet_transaction_transaction_id_seq',(SELECT max(transaction_id) FROM customer_wallet_transaction));
```

Catch anything missed:

```sql
SELECT s.sequencename, s.last_value
FROM pg_sequences s
WHERE s.schemaname = 'public'
ORDER BY 1;
```

### 5.2 `document_sequence`

Ensure `last_number >= MAX(document number)` for every `(prefix, period)` touched, so the next
document does not reuse a restored number. Pattern precedent:
`database/migrations/20260808_02_standardize_entity_codes.sql`, which seeds to
`GREATEST(existing, MAX(id))`.

```sql
WITH used AS (
  SELECT split_part(invoice_number, '-', 2)               AS period,
         max(split_part(invoice_number, '-', 3)::int)     AS hi
  FROM invoice
  WHERE invoice_number ~ '^INV-[0-9]{6}-[0-9]{4}$'
  GROUP BY 1
)
UPDATE document_sequence d
SET last_number = GREATEST(d.last_number, u.hi)
FROM used u
WHERE d.prefix = 'INV' AND d.period = u.period;
```

Repeat for `CN` against `credit_note.cn_number`.

### 5.3 `ar_ledger.balance_after`

Recompute the stored running balance per customer in `(entry_date, ledger_id)` order. Run it over
**all** rows rather than patching only the new tail — it is deterministic and self-correcting.

```sql
ALTER TABLE ar_ledger DISABLE TRIGGER trg_ar_ledger_immutable;

WITH running AS (
  SELECT ledger_id,
         sum(amount) OVER (PARTITION BY customer_id
                           ORDER BY entry_date, ledger_id
                           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS bal
  FROM ar_ledger
)
UPDATE ar_ledger l
SET balance_after = r.bal
FROM running r
WHERE l.ledger_id = r.ledger_id
  AND l.balance_after IS DISTINCT FROM r.bal;

ALTER TABLE ar_ledger ENABLE TRIGGER trg_ar_ledger_immutable;
```

Sanity check — the order-agnostic view must agree with the last stored balance per customer:

```sql
SELECT v.customer_id, v.ledger_balance, l.balance_after
FROM vw_customer_ar_balance v
JOIN LATERAL (
  SELECT balance_after FROM ar_ledger
  WHERE customer_id = v.customer_id
  ORDER BY entry_date DESC, ledger_id DESC LIMIT 1
) l ON true
WHERE v.ledger_balance IS DISTINCT FROM l.balance_after;
```

Zero rows expected.

### 5.4 `invoice.amount_paid` and `status`

Recompute from settled payments minus applied credit notes, mirroring
`update_invoice_balance_after_payment()` as defined in
`database/migrations/20260812_10_ar_ledger_production_hardening.sql`. Read that function and
match its exact logic rather than reimplementing from memory — the status ladder distinguishes
`Partially Refunded` and `Fully Refunded` from `Paid`.

The cheap alternative, once triggers are back on, is a no-op touch that makes the real trigger
recompute every invoice:

```sql
UPDATE invoice_payments SET payment_status = payment_status;
```

### 5.5 WAC

`inventory_transaction` was never touched by any version of the cleanup, so weighted-average cost
should be intact. Confirm cheaply:

```sql
SELECT public.recompute_all_wac();
```

(from `database/migrations/20260816_03_recompute_wac_for_part.sql` — it replays every `StockIn`
in `transaction_date, inv_trans_id` order.)

### 5.6 Re-enable every trigger

```sql
ALTER TABLE invoice                     ENABLE TRIGGER USER;
ALTER TABLE invoice_payments            ENABLE TRIGGER USER;
ALTER TABLE customer_payment            ENABLE TRIGGER USER;
ALTER TABLE credit_note                 ENABLE TRIGGER USER;
ALTER TABLE credit_note_line            ENABLE TRIGGER USER;
ALTER TABLE invoice_payment_allocation  ENABLE TRIGGER USER;
ALTER TABLE ar_ledger                   ENABLE TRIGGER trg_ar_ledger_immutable;
ALTER TABLE customer_wallet             ENABLE TRIGGER USER;
ALTER TABLE customer_wallet_transaction ENABLE TRIGGER USER;
```

**Then verify nothing was left off — a disabled trigger is the quietest way for this merge to
cause a second incident:**

```sql
SELECT tgrelid::regclass AS table_name, tgname
FROM pg_trigger
WHERE tgenabled = 'D' AND NOT tgisinternal;
```

**Gate 5:** the query above returns **zero rows**; the 5.3 balance check returns zero rows; every
sequence exceeds its table's maximum ID.

---

## Phase 6 — Verification

### 6.1 The purpose-built reconciler

```bash
cd packages/api && npm run reconcile:ar
```

`packages/api/scripts/reconcileArBalances.js` is read-only and exists precisely for this: it
compares the three competing A/R balance sources — `invoice.amount_paid`/`status` (the trigger
cache), `invoice_with_balance.balance_due` (the view), and `vw_customer_ar_balance.ledger_balance`
(authoritative) — and reports drift. **Expect zero drift.**

### 6.2 Totals and integrity

```sql
-- Ledger total vs open-invoice total
SELECT (SELECT sum(ledger_balance) FROM vw_customer_ar_balance)                   AS ledger_total,
       (SELECT sum(total_amount - amount_paid) FROM invoice
         WHERE status IN ('Unpaid','Partially Paid'))                             AS open_invoice_total;

-- Orphans — all must be zero
SELECT (SELECT count(*) FROM invoice_line  l LEFT JOIN invoice i USING (invoice_id) WHERE i.invoice_id IS NULL) AS orphan_lines,
       (SELECT count(*) FROM invoice_payments p LEFT JOIN invoice i USING (invoice_id) WHERE i.invoice_id IS NULL) AS orphan_payments,
       (SELECT count(*) FROM ar_ledger a LEFT JOIN invoice i USING (invoice_id)
         WHERE a.invoice_id IS NOT NULL AND i.invoice_id IS NULL)                 AS orphan_ledger,
       (SELECT count(*) FROM credit_note_line cl LEFT JOIN credit_note c USING (cn_id) WHERE c.cn_id IS NULL) AS orphan_cn_lines;

-- Chronology: IDs should track dates
SELECT count(*) AS out_of_order
FROM (SELECT invoice_id, invoice_date,
             lag(invoice_date) OVER (ORDER BY invoice_id) AS prev
      FROM invoice WHERE invoice_number ~ '^INV-[0-9]{6}-[0-9]{4}$') x
WHERE invoice_date < prev;
```

A small number of out-of-order rows is acceptable (back-dated invoices exist legitimately); a
large number means the renumbering offset was wrong.

### 6.3 Spot-check a real customer

Pick a customer with a long history and confirm by eye:

```sql
SELECT ledger_id, entry_date, entry_type, amount, balance_after, reference_no
FROM ar_ledger WHERE customer_id = <id>
ORDER BY entry_date, ledger_id;
```

The running balance must be monotonic in `entry_date` and end at the customer's true outstanding
balance. Then check the Statement of Account and aging buckets in the UI for the same customer.

### 6.4 Bring the app back

```bash
docker compose -f docker-compose.prod.yml start backend
docker compose -f docker-compose.prod.yml logs -f backend
```

Then, in the UI:

- A/R dashboard: aging summary and totals look right
- Generate a Statement of Account for the spot-check customer
- **Create one new invoice** and confirm the number continues from the correct next value with no
  duplicate-key error — this proves Phases 5.1 and 5.2 together
- Record and settle one payment; confirm `invoice.status` updates and a `PAYMENT_SETTLED` ledger
  row appears with a sane `balance_after`

### 6.5 Watch the reconciliation engine's first run

`ledgerReconciliationService` runs hourly (`settings.LEDGER_RECONCILIATION_SCHEDULE`, default
`0 * * * *`). Watch its first post-restore run in the backend logs. It is the system's own opinion
on whether the merge is sound.

**Gate 6:** reconciler reports zero drift; no orphans; UI checks pass; a new invoice and payment
round-trip cleanly.

---

## Phase 7 — Rollback

Any gate failure:

```bash
docker compose -f docker-compose.prod.yml stop backend
gunzip -c "$WORK/ROLLBACK-live-pre-restore-<timestamp>.sql.gz" | psql -d "$LIVE_DB"
```

The dump was taken with `--clean --if-exists`, so it drops and recreates objects — it restores
onto a non-empty database safely.

Phases 3, 4 and 5 each run inside a transaction, so a mid-phase failure rolls itself back. The
Phase 0 dump covers everything else, including a partially completed multi-phase run.

**Do not run** `scripts/reset-dev-db.sh` (it issues `DROP DATABASE`) or `scripts/migrate-prod.sh`
(deprecated; exits 1) at any point during recovery.

---

## Appendix A — Trigger and constraint hazards, at a glance

| Object | Where | Why it matters here |
|---|---|---|
| `trg_ar_ledger_immutable` | `ar_ledger` | Raises on `UPDATE`/`DELETE` (not `INSERT`, not `TRUNCATE`). Must be disabled to renumber or to recompute `balance_after`. Precedent: `20260808_01_add_payment_source_to_ar_ledger.sql` |
| `uq_ar_ledger_payment_settled` | `ar_ledger` | Partial unique index on `(payment_id, payment_source, entry_type)` where `entry_type='PAYMENT_SETTLED'`. Rejects duplicate settled entries — a useful idempotency guard. `NULL` payment_ids are exempt (Postgres treats NULLs as distinct) |
| `update_invoice_balance_after_payment()` | `invoice_payments`, `credit_note` | Recomputes `invoice.amount_paid`/`status`, and since `20260812_10` also appends a ledger entry on settlement — with `entry_date = now()`, **not** the historical date. Keep it disabled during the merge |
| `trg_update_wac` | `inventory_transaction` | Fires on `StockIn` and uses *current* stock, not date order. Harmless here only because `inventory_transaction` is never re-inserted |
| `check_invoice_status` | `invoice` | Six values. The `_preserve_sales` cleanup variant adds `'Written Off'` inline, in no migration file |
| `invoice.customer_id`, `invoice.employee_id`, `credit_note.invoice_id` | FKs | `ON DELETE RESTRICT` — a missing parent blocks the insert |
| `invoice_line`, `invoice_payments`, `invoice_tax_breakdown`, `due_date_log` | FKs | `ON DELETE CASCADE` from `invoice` — which is how the original `TRUNCATE ... CASCADE` reached further than its explicit table list |

## Appendix B — What the cleanup did *not* touch

Confirmed against both cleanup variants — these tables have no FK path from the truncated set and
their live copies are authoritative. **Never restore them from the backup:**

`inventory_transaction` · `part` · `part_number` · `document_sequence` · `customer` (rows survive;
only `credit_hold` / `credit_hold_reason` were reset) · `employee` · `supplier` · `goods_receipt` ·
`goods_receipt_line` · `purchase_order` · all A/P tables · all HR/payroll tables · `settings` ·
`permission` / `role_permission`

Because `inventory_transaction` survived and its `reference_no` holds the invoice *number* rather
than the ID, stock movements and WAC realign with the restored invoices automatically.
