/**
 * One-time backfill: applies the same normalization rules used by the live
 * create/update routes (helpers/normalizeEntity.js) to existing customer,
 * supplier, employee, part, brand, and group rows.
 *
 * Uses the exact same normalizer functions as customerRoutes.js,
 * supplierRoutes.js, employeeRoutes.js, partRoutes.js, brandRoutes.js, and
 * groupRoutes.js, so this backfill and everyday data entry can never drift
 * apart.
 *
 * Defaults to a dry run (reports what would change, writes nothing). Pass
 * --apply to actually write. A unique-constraint collision (two existing rows
 * that normalize to the same value, e.g. "Toyota" and "TOYOTA" both present as
 * separate brand rows) is skipped and reported rather than aborting the run —
 * those need a manual merge decision, which this script does not make.
 *
 * Usage:
 *   node scripts/normalizeExistingData.js                # dry run, all tables
 *   node scripts/normalizeExistingData.js --apply         # write changes
 *   node scripts/normalizeExistingData.js --table=customer,part --apply
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

if (process.env.NODE_ENV !== 'production') {
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
}

const db = require('../db');
const { normalizeText, normalizeName, normalizeEmail, normalizePhone, normalizePartNumber } = require('../helpers/normalizeEntity');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const tableArg = args.find((a) => a.startsWith('--table='));
const onlyTables = tableArg ? new Set(tableArg.split('=')[1].split(',')) : null;

const TABLE_CONFIGS = [
    {
        key: 'customer',
        table: 'customer',
        pk: 'customer_id',
        columns: {
            first_name: normalizeName,
            last_name: normalizeName,
            company_name: normalizeText,
            phone: normalizePhone,
            email: normalizeEmail,
            address: normalizeText,
        },
    },
    {
        key: 'supplier',
        table: 'supplier',
        pk: 'supplier_id',
        columns: {
            supplier_name: normalizeText,
            contact_person: normalizeName,
            phone: normalizePhone,
            email: normalizeEmail,
            address: normalizeText,
        },
    },
    {
        key: 'employee',
        table: 'employee',
        pk: 'employee_id',
        columns: {
            first_name: normalizeName,
            middle_name: normalizeName,
            last_name: normalizeName,
            suffix: normalizeText,
            position_title: normalizeName,
            mobile_no: normalizePhone,
            personal_email: normalizeEmail,
            address_line: normalizeText,
            barangay: normalizeText,
            city: normalizeText,
            province: normalizeText,
            postal_code: normalizeText,
            emergency_contact_name: normalizeName,
            emergency_contact_relation: normalizeName,
            emergency_contact_phone: normalizePhone,
            separation_reason: normalizeText,
        },
    },
    {
        key: 'part',
        table: 'part',
        pk: 'part_id',
        columns: {
            detail: normalizeText,
        },
    },
    {
        key: 'brand',
        table: 'brand',
        pk: 'brand_id',
        columns: {
            brand_name: normalizeText,
        },
    },
    {
        key: 'group',
        table: '"group"',
        label: 'group',
        pk: 'group_id',
        columns: {
            group_name: normalizeText,
        },
    },
    {
        key: 'part_number',
        table: 'part_number',
        pk: 'part_number_id',
        columns: {
            part_number: normalizePartNumber,
        },
        // Excel silently reinterprets short dash-separated tokens like "4-1" as a
        // date ("4-Jan") before the value ever reaches this database. Uppercasing
        // that to "4-JAN" would just re-case already-corrupted data — the original
        // part number is unrecoverable by any normalization rule and needs a human
        // to work out the intended value from the part's brand/application. So
        // these are excluded from --apply and reported separately instead.
        flagForReview: (row) => /^[0-9]{1,2}-[A-Za-z]{3}$/.test(row.part_number || ''),
        reviewReason: 'looks like an Excel auto-date-mangled value (e.g. "4-Jan") — the original part number may be unrecoverable; needs manual review, not normalization',
    },
];

async function processTable(config, flaggedOut) {
    const columnNames = Object.keys(config.columns);
    const { rows } = await db.query(
        `SELECT ${config.pk}, ${columnNames.join(', ')} FROM ${config.table}`
    );

    let changed = 0;
    let updated = 0;
    let skipped = 0;
    let flagged = 0;

    const label = config.label || config.table;

    for (const row of rows) {
        if (config.flagForReview && config.flagForReview(row)) {
            flagged++;
            flaggedOut.push({ table: label, pk: config.pk, id: row[config.pk], row, reason: config.reviewReason });
            continue;
        }

        const diff = {};
        const before = {};
        for (const col of columnNames) {
            const normalized = config.columns[col](row[col]);
            if (normalized !== row[col]) {
                diff[col] = normalized;
                before[col] = row[col];
            }
        }
        if (Object.keys(diff).length === 0) continue;
        changed++;

        if (!apply) {
            console.log(`  [dry-run] ${label} ${config.pk}=${row[config.pk]}:`, before, '->', diff);
            continue;
        }

        const diffCols = Object.keys(diff);
        const setClause = diffCols.map((c, i) => `${c} = $${i + 1}`).join(', ');
        const values = diffCols.map((c) => diff[c]);
        values.push(row[config.pk]);

        try {
            await db.query(
                `UPDATE ${config.table} SET ${setClause} WHERE ${config.pk} = $${values.length}`,
                values
            );
            updated++;
        } catch (err) {
            if (err.code === '23505') {
                console.warn(`  [skip] ${label} ${config.pk}=${row[config.pk]}: normalizes to a value that collides with another row — needs a manual merge. (${err.detail || err.message})`);
                skipped++;
            } else {
                throw err;
            }
        }
    }

    return { table: label, total: rows.length, changed, updated, skipped, flagged };
}

(async function run() {
    console.log(apply ? 'Running in APPLY mode — changes will be written.' : 'Running in DRY-RUN mode — no changes will be written. Pass --apply to write.');

    const configs = onlyTables ? TABLE_CONFIGS.filter((c) => onlyTables.has(c.key)) : TABLE_CONFIGS;
    if (configs.length === 0) {
        console.error(`No matching tables for --table filter. Valid keys: ${TABLE_CONFIGS.map((c) => c.key).join(', ')}`);
        process.exit(1);
    }

    const summary = [];
    const flaggedRows = [];
    for (const config of configs) {
        console.log(`\n${config.label || config.table}:`);
        const result = await processTable(config, flaggedRows);
        summary.push(result);
    }

    console.log('\n--- Summary ---');
    console.table(summary);

    if (flaggedRows.length > 0) {
        console.log(`\n--- Needs manual review (${flaggedRows.length} row(s), excluded from normalization) ---`);
        console.table(flaggedRows.map((f) => ({ table: f.table, [f.pk]: f.id, ...f.row, reason: f.reason })));
    }

    process.exit(0);
})().catch((err) => {
    console.error('normalizeExistingData failed:', err);
    process.exit(1);
});
