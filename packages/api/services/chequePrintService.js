'use strict';

const db = require('../db');
const apPdcService = require('./apPdcService');

const ALLOWED_QUEUE_STATUSES = ['ISSUED', 'HELD_FOR_RELEASE'];
const RETIRED_OR_TERMINAL_STATUSES = ['VOID', 'REPLACED', 'DELETED'];
const DEFAULT_QUEUE_LIMIT = 100;
const MAX_QUEUE_LIMIT = 500;

function serviceError(status, code, message, extra = {}) {
    const err = new Error(message);
    err.status = status;
    err.code = code;
    Object.assign(err, extra);
    return err;
}

function encodeCursor({ createdAt, id }) {
    if (!createdAt || !id) return null;
    const str = createdAt instanceof Date
        ? createdAt.toISOString()
        : String(createdAt);
    return Buffer.from(JSON.stringify({ created_at: str, id: Number(id) })).toString('base64url');
}

function decodeCursor(cursorStr) {
    if (!cursorStr || typeof cursorStr !== 'string') return null;
    try {
        const raw = Buffer.from(cursorStr, 'base64url').toString('utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.created_at || !parsed.id) return null;
        return {
            createdAt: String(parsed.created_at),
            id: Number(parsed.id)
        };
    } catch {
        return null;
    }
}

function isFirstPrintEligibleStatus(status) {
    return ALLOWED_QUEUE_STATUSES.includes(status);
}

function isReprintEligibleStatus(status) {
    return !RETIRED_OR_TERMINAL_STATUSES.includes(status);
}

function formatChequeDate(dateInput, formatStr = 'MM-dd-yyyy') {
    if (!dateInput) return '';
    let year, month, day;
    if (typeof dateInput === 'string') {
        const match = dateInput.trim().slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (match) {
            year = Number(match[1]);
            month = Number(match[2]);
            day = Number(match[3]);
        }
    }
    if (!year) {
        const d = new Date(dateInput);
        if (Number.isNaN(d.getTime())) return '';
        year = d.getFullYear();
        month = d.getMonth() + 1;
        day = d.getDate();
    }
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const yyyy = String(year);
    const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const mmm = monthsShort[month - 1] || mm;

    if (formatStr === 'MM/dd/yyyy') return `${mm}/${dd}/${yyyy}`;
    if (formatStr === 'dd/MM/yyyy') return `${dd}/${mm}/${yyyy}`;
    if (formatStr === 'MM-dd-yyyy') return `${mm}-${dd}-${yyyy}`;
    if (formatStr === 'dd-MM-yyyy') return `${dd}-${mm}-${yyyy}`;
    if (formatStr === 'MMM dd, yyyy') return `${mmm} ${dd}, ${yyyy}`;
    if (formatStr === 'MMddyyyy') return `${mm}${dd}${yyyy}`;
    return `${mm}-${dd}-${yyyy}`;
}

/**
 * Resolves the effective template for a cheque record.
 * 1. If cr.template_id exists: requires exact active template; if missing/deleted -> TEMPLATE_UNAVAILABLE.
 * 2. Otherwise resolves bank_account.default_cheque_template_id: requires active template;
 *    if missing/deleted -> TEMPLATE_UNAVAILABLE; if no default -> TEMPLATE_REQUIRED.
 */
async function resolveEffectiveTemplate(runner, chequeRecordId) {
    const { rows } = await runner.query(
        `SELECT
            cr.id, cr.template_id, cr.bank_account_id, cr.status, cr.is_deleted,
            cr.replaced_by_cheque_id, cr.replaces_cheque_id, cr.cheque_number,
            cr.payee, cr.amount, TO_CHAR(cr.cheque_date, 'YYYY-MM-DD') AS cheque_date, cr.memo,
            cr.ap_payment_id, cr.expense_id, cr.created_at,
            ba.bank_name AS bank_name,
            ba.account_name AS bank_account_name,
            ba.default_cheque_template_id,
            tpl_rec.id AS rec_tpl_id,
            tpl_rec.bank_name AS rec_tpl_bank_name,
            tpl_rec.is_deleted AS rec_tpl_is_deleted,
            tpl_rec.field_positions AS rec_tpl_field_positions,
            tpl_rec.date_format AS rec_tpl_date_format,
            tpl_rec.amount_format AS rec_tpl_amount_format,
            tpl_rec.currency_settings AS rec_tpl_currency_settings,
            tpl_rec.paper_settings AS rec_tpl_paper_settings,
            tpl_rec.amount_words_settings AS rec_tpl_amount_words_settings,
            tpl_rec.text_settings AS rec_tpl_text_settings,
            tpl_def.id AS def_tpl_id,
            tpl_def.bank_name AS def_tpl_bank_name,
            tpl_def.is_deleted AS def_tpl_is_deleted,
            tpl_def.field_positions AS def_tpl_field_positions,
            tpl_def.date_format AS def_tpl_date_format,
            tpl_def.amount_format AS def_tpl_amount_format,
            tpl_def.currency_settings AS def_tpl_currency_settings,
            tpl_def.paper_settings AS def_tpl_paper_settings,
            tpl_def.amount_words_settings AS def_tpl_amount_words_settings,
            tpl_def.text_settings AS def_tpl_text_settings
         FROM cheque_records cr
         LEFT JOIN bank_account ba ON ba.bank_account_id = cr.bank_account_id
         LEFT JOIN cheque_templates tpl_rec ON tpl_rec.id = cr.template_id
         LEFT JOIN cheque_templates tpl_def ON tpl_def.id = ba.default_cheque_template_id
         WHERE cr.id = $1`,
        [chequeRecordId]
    );

    if (!rows.length) {
        throw serviceError(404, 'CHEQUE_NOT_FOUND', `Cheque record ${chequeRecordId} not found.`);
    }

    const row = rows[0];
    let effectiveTemplate = null;
    let templateSource = null;
    let setupRequiredReason = null;
    let details = {
        cheque_id: row.id,
        bank_account_id: row.bank_account_id,
        bank_account_name: row.bank_account_name,
        bank_name: row.bank_name
    };

    if (row.template_id != null) {
        templateSource = 'record';
        if (row.rec_tpl_id != null && row.rec_tpl_is_deleted === false) {
            effectiveTemplate = {
                id: row.rec_tpl_id,
                bank_name: row.rec_tpl_bank_name,
                field_positions: row.rec_tpl_field_positions,
                date_format: row.rec_tpl_date_format,
                amount_format: row.rec_tpl_amount_format,
                currency_settings: row.rec_tpl_currency_settings,
                paper_settings: row.rec_tpl_paper_settings,
                amount_words_settings: row.rec_tpl_amount_words_settings,
                text_settings: row.rec_tpl_text_settings
            };
        } else {
            setupRequiredReason = 'TEMPLATE_UNAVAILABLE';
            details.requested_template_id = row.template_id;
        }
    } else {
        if (row.default_cheque_template_id != null) {
            templateSource = 'bank_default';
            if (row.def_tpl_id != null && row.def_tpl_is_deleted === false) {
                effectiveTemplate = {
                    id: row.def_tpl_id,
                    bank_name: row.def_tpl_bank_name,
                    field_positions: row.def_tpl_field_positions,
                    date_format: row.def_tpl_date_format,
                    amount_format: row.def_tpl_amount_format,
                    currency_settings: row.def_tpl_currency_settings,
                    paper_settings: row.def_tpl_paper_settings,
                    amount_words_settings: row.def_tpl_amount_words_settings,
                    text_settings: row.def_tpl_text_settings
                };
            } else {
                setupRequiredReason = 'TEMPLATE_UNAVAILABLE';
                details.default_cheque_template_id = row.default_cheque_template_id;
            }
        } else {
            templateSource = null;
            setupRequiredReason = 'TEMPLATE_REQUIRED';
        }
    }

    return {
        effectiveTemplate,
        templateSource,
        setupRequiredReason,
        details,
        chequeRecord: {
            id: row.id,
            status: row.status,
            is_deleted: row.is_deleted,
            cheque_number: row.cheque_number,
            payee: row.payee,
            amount: row.amount,
            cheque_date: row.cheque_date,
            memo: row.memo,
            ap_payment_id: row.ap_payment_id,
            expense_id: row.expense_id,
            bank_account_id: row.bank_account_id,
            template_id: row.template_id,
            replaces_cheque_id: row.replaces_cheque_id,
            replaced_by_cheque_id: row.replaced_by_cheque_id,
            created_at: row.created_at
        }
    };
}

/**
 * Common SQL snippet for eligible print queue instruments.
 * Ensures:
 * - Linked to ap_payment or expense
 * - Visible: is_deleted = false
 * - Not replaced: replaced_by_cheque_id IS NULL
 * - Status allowlisted: 'ISSUED' or 'HELD_FOR_RELEASE'
 * - No normal generation event: NOT EXISTS (PDF_GENERATED or PRINTED in clearance log)
 */
const ELIGIBLE_QUEUE_CTE = `
WITH eligible AS (
    SELECT
        cr.id,
        cr.payee,
        cr.amount,
        TO_CHAR(cr.cheque_date, 'YYYY-MM-DD') AS cheque_date,
        cr.memo,
        cr.cheque_number,
        cr.status,
        CASE
            WHEN cr.ap_payment_id IS NOT NULL THEN 'SUPPLIER'
            WHEN cr.expense_id IS NOT NULL THEN 'EXPENSE'
            ELSE 'STANDALONE'
        END AS purpose_type,
        cr.ap_payment_id,
        cr.expense_id,
        cr.bank_account_id,
        cr.template_id,
        cr.created_at,
        TO_CHAR(cr.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') AS created_at_cursor,
        ba.account_name AS bank_account_name,
        ba.bank_name AS bank_name,
        CASE
            WHEN cr.template_id IS NOT NULL THEN
                CASE WHEN tpl_record.id IS NOT NULL AND tpl_record.is_deleted = FALSE THEN tpl_record.id ELSE NULL END
            WHEN ba.default_cheque_template_id IS NOT NULL THEN
                CASE WHEN tpl_default.id IS NOT NULL AND tpl_default.is_deleted = FALSE THEN tpl_default.id ELSE NULL END
            ELSE NULL
        END AS effective_template_id,
        CASE
            WHEN cr.template_id IS NOT NULL THEN
                CASE WHEN tpl_record.id IS NOT NULL AND tpl_record.is_deleted = FALSE THEN tpl_record.bank_name ELSE NULL END
            WHEN ba.default_cheque_template_id IS NOT NULL THEN
                CASE WHEN tpl_default.id IS NOT NULL AND tpl_default.is_deleted = FALSE THEN tpl_default.bank_name ELSE NULL END
            ELSE NULL
        END AS effective_bank_name,
        CASE
            WHEN cr.template_id IS NOT NULL THEN 'record'
            WHEN ba.default_cheque_template_id IS NOT NULL THEN 'bank_default'
            ELSE NULL
        END AS template_source,
        CASE
            WHEN cr.template_id IS NOT NULL AND (tpl_record.id IS NULL OR tpl_record.is_deleted = TRUE) THEN 'TEMPLATE_UNAVAILABLE'
            WHEN cr.template_id IS NULL AND ba.default_cheque_template_id IS NOT NULL AND (tpl_default.id IS NULL OR tpl_default.is_deleted = TRUE) THEN 'TEMPLATE_UNAVAILABLE'
            WHEN cr.template_id IS NULL AND ba.default_cheque_template_id IS NULL THEN 'TEMPLATE_REQUIRED'
            ELSE NULL
        END AS setup_required_reason
    FROM cheque_records cr
    LEFT JOIN bank_account ba ON ba.bank_account_id = cr.bank_account_id
    LEFT JOIN cheque_templates tpl_record ON tpl_record.id = cr.template_id
    LEFT JOIN cheque_templates tpl_default ON tpl_default.id = ba.default_cheque_template_id
    WHERE cr.status IN ('ISSUED', 'HELD_FOR_RELEASE')
      AND COALESCE(cr.is_deleted, FALSE) = FALSE
      AND cr.replaced_by_cheque_id IS NULL
      AND (cr.ap_payment_id IS NOT NULL OR cr.expense_id IS NOT NULL)
      AND NOT EXISTS (
          SELECT 1 FROM cheque_clearance_log ccl
          WHERE ccl.cheque_record_id = cr.id AND ccl.action IN ('PRINTED', 'PDF_GENERATED')
      )
)
`;

/**
 * Returns the print queue with cursor pagination and a consistent global summary.
 */
async function getPrintQueue(runnerOrDb, options = {}) {
    const {
        template_id = null,
        unassigned = false,
        limit = DEFAULT_QUEUE_LIMIT,
        cursor = null
    } = options;

    const unassignedBool = unassigned === true || unassigned === 'true' || unassigned === '1';
    const parsedTemplateId = template_id !== null && template_id !== undefined && template_id !== ''
        ? Number(template_id)
        : null;

    if (parsedTemplateId !== null && Number.isNaN(parsedTemplateId)) {
        throw serviceError(400, 'INVALID_TEMPLATE_ID', 'template_id must be a numeric ID');
    }

    if (parsedTemplateId !== null && unassignedBool) {
        throw serviceError(400, 'INVALID_FILTER', 'template_id and unassigned are mutually exclusive filters');
    }

    let decodedCursor = null;
    if (cursor) {
        decodedCursor = decodeCursor(cursor);
        if (!decodedCursor) {
            throw serviceError(400, 'INVALID_CURSOR', 'Invalid pagination cursor');
        }
    }

    const parsedLimit = Math.max(1, Math.min(MAX_QUEUE_LIMIT, Number(limit) || DEFAULT_QUEUE_LIMIT));

    const ownClient = !runnerOrDb.query && !runnerOrDb.release ? await db.getClient() : null;
    const client = ownClient || (runnerOrDb.query ? runnerOrDb : db);

    try {
        if (ownClient) {
            await ownClient.query('BEGIN TRANSACTION READ ONLY');
        }

        // 1. Overall counts and breakdown by template
        const summaryRes = await client.query(`
            ${ELIGIBLE_QUEUE_CTE}
            SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE effective_template_id IS NULL)::int AS unassigned_count
            FROM eligible
        `);

        const byTemplateRes = await client.query(`
            ${ELIGIBLE_QUEUE_CTE}
            SELECT
                effective_template_id AS template_id,
                effective_bank_name AS bank_name,
                COUNT(*)::int AS count
            FROM eligible
            WHERE effective_template_id IS NOT NULL
            GROUP BY effective_template_id, effective_bank_name
            ORDER BY effective_bank_name ASC
        `);

        const totalEligible = summaryRes.rows[0]?.total || 0;
        const unassignedCount = summaryRes.rows[0]?.unassigned_count || 0;
        const byTemplate = byTemplateRes.rows.map((row) => ({
            template_id: row.template_id,
            bank_name: row.bank_name,
            count: row.count
        }));

        // 2. Paginated rows query
        const conditions = [];
        const params = [];

        if (parsedTemplateId !== null) {
            params.push(parsedTemplateId);
            conditions.push(`effective_template_id = $${params.length}`);
        } else if (unassignedBool) {
            conditions.push(`effective_template_id IS NULL`);
        }

        if (decodedCursor) {
            params.push(decodedCursor.createdAt, decodedCursor.id);
            const cIdx = params.length - 1;
            const idIdx = params.length;
            conditions.push(`(created_at > $${cIdx}::timestamp OR (created_at = $${cIdx}::timestamp AND id > $${idIdx}))`);
        }

        const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        params.push(parsedLimit + 1);
        const limitIdx = params.length;

        const rowsRes = await client.query(`
            ${ELIGIBLE_QUEUE_CTE}
            SELECT
                id, payee, amount, cheque_date, memo, cheque_number, status, purpose_type,
                ap_payment_id, expense_id, bank_account_id, bank_account_name, bank_name,
                template_id, effective_template_id, effective_bank_name, template_source,
                setup_required_reason, created_at, created_at_cursor
            FROM eligible
            ${whereSql}
            ORDER BY created_at ASC, id ASC
            LIMIT $${limitIdx}
        `, params);

        const hasMore = rowsRes.rows.length > parsedLimit;
        const records = hasMore ? rowsRes.rows.slice(0, parsedLimit) : rowsRes.rows;

        let nextCursor = null;
        if (hasMore && records.length) {
            const lastRow = records[records.length - 1];
            nextCursor = encodeCursor({
                createdAt: lastRow.created_at_cursor || lastRow.created_at,
                id: lastRow.id
            });
        }

        if (ownClient) {
            await ownClient.query('COMMIT');
        }

        return {
            records,
            next_cursor: nextCursor,
            total_eligible: totalEligible,
            summary: {
                total: totalEligible,
                unassigned_count: unassignedCount,
                by_template: byTemplate
            }
        };
    } catch (err) {
        if (ownClient) {
            await ownClient.query('ROLLBACK').catch(() => {});
        }
        throw err;
    } finally {
        if (ownClient) {
            ownClient.release();
        }
    }
}

/**
 * Validates a batch of cheque rows and resolves canonical values for linked records.
 */
async function validateAndPreparePdfBatch(runner, { templateId, printerProfileId = null, records = [] }) {
    if (!templateId) {
        throw serviceError(400, 'TEMPLATE_ID_REQUIRED', 'template_id is required');
    }
    const templateIdNum = Number(templateId);
    if (Number.isNaN(templateIdNum)) {
        throw serviceError(400, 'INVALID_TEMPLATE_ID', 'template_id must be a numeric ID');
    }

    if (!Array.isArray(records) || records.length === 0) {
        throw serviceError(400, 'RECORDS_REQUIRED', 'At least one cheque record is required');
    }

    const { rows: tplRows } = await runner.query(
        `SELECT id, bank_name, field_positions, date_format, amount_format, currency_settings,
                paper_settings, amount_words_settings, text_settings
         FROM cheque_templates
         WHERE id = $1 AND is_deleted = FALSE`,
        [templateIdNum]
    );

    if (!tplRows.length) {
        throw serviceError(404, 'TEMPLATE_NOT_FOUND', 'Template not found or has been deleted');
    }
    const template = tplRows[0];

    let printerProfile = { feed_type: 'native', offset_x: 0, offset_y: 0 };
    if (printerProfileId) {
        const { rows: profRows } = await runner.query(
            `SELECT id, profile_name, feed_type, offset_x, offset_y, is_default
             FROM printer_profiles
             WHERE id = $1`,
            [printerProfileId]
        );
        if (profRows.length) {
            printerProfile = profRows[0];
        }
    }

    // Check duplicate linked IDs
    const linkedIds = [];
    const seenLinked = new Set();
    for (const rec of records) {
        if (rec.cheque_record_id) {
            const numId = Number(rec.cheque_record_id);
            if (seenLinked.has(numId)) {
                throw serviceError(400, 'DUPLICATE_LINKED_CHEQUE', `Duplicate cheque record ID in batch: ${numId}`);
            }
            seenLinked.add(numId);
            linkedIds.push(numId);
        }
    }

    let linkedRecordsById = new Map();
    if (linkedIds.length) {
        const { rows: linkedRows } = await runner.query(
            `SELECT cr.id, cr.status, cr.is_deleted, cr.ap_payment_id, cr.expense_id, cr.bank_account_id,
                    cr.payee, cr.amount, TO_CHAR(cr.cheque_date, 'YYYY-MM-DD') AS cheque_date,
                    cr.memo, cr.template_id, cr.replaced_by_cheque_id,
                    ba.default_cheque_template_id,
                    tpl_rec.id AS rec_tpl_id, tpl_rec.is_deleted AS rec_tpl_is_deleted,
                    tpl_def.id AS def_tpl_id, tpl_def.is_deleted AS def_tpl_is_deleted
             FROM cheque_records cr
             LEFT JOIN bank_account ba ON ba.bank_account_id = cr.bank_account_id
             LEFT JOIN cheque_templates tpl_rec ON tpl_rec.id = cr.template_id
             LEFT JOIN cheque_templates tpl_def ON tpl_def.id = ba.default_cheque_template_id
             WHERE cr.id = ANY($1::int[])`,
            [linkedIds]
        );

        linkedRecordsById = new Map(linkedRows.map((row) => [row.id, row]));

        const missing = linkedIds.filter((id) => !linkedRecordsById.has(id));
        if (missing.length) {
            throw serviceError(404, 'CHEQUE_NOT_FOUND', `Linked cheque record(s) not found: ${missing.join(', ')}`);
        }

        // Retired or hidden check
        const blocked = linkedRows.filter((r) =>
            r.is_deleted || RETIRED_OR_TERMINAL_STATUSES.includes(r.status) || r.replaced_by_cheque_id
        );
        if (blocked.length) {
            throw serviceError(409, 'CHEQUE_PRINT_BLOCKED',
                `Cannot print cheque(s) with status ${blocked.map((r) => r.is_deleted && !RETIRED_OR_TERMINAL_STATUSES.includes(r.status) ? 'HIDDEN' : r.status).join(', ')} (record id ${blocked.map((r) => r.id).join(', ')})`
            );
        }

        // Effective template check for each linked record
        for (const row of linkedRows) {
            let effectiveId = null;
            if (row.template_id != null) {
                if (row.rec_tpl_id != null && row.rec_tpl_is_deleted === false) {
                    effectiveId = row.rec_tpl_id;
                } else {
                    throw serviceError(409, 'TEMPLATE_UNAVAILABLE', `Cheque #${row.id} references a deleted or missing template.`);
                }
            } else if (row.default_cheque_template_id != null) {
                if (row.def_tpl_id != null && row.def_tpl_is_deleted === false) {
                    effectiveId = row.def_tpl_id;
                } else {
                    throw serviceError(409, 'TEMPLATE_UNAVAILABLE', `Cheque #${row.id}'s bank account default template is deleted or missing.`);
                }
            } else {
                throw serviceError(409, 'TEMPLATE_REQUIRED', `Cheque #${row.id} has no assigned template and its bank account has no default template.`);
            }

            if (effectiveId !== templateIdNum) {
                throw serviceError(409, 'CHEQUE_TEMPLATE_MISMATCH',
                    `Cheque record ${row.id} belongs to template ID ${effectiveId}, which does not match requested template ID ${templateIdNum}.`
                );
            }
        }
    }

    return {
        template,
        printerProfile,
        linkedRecordsById,
        linkedIds
    };
}

/**
 * Commits PDF generation event for linked records and pins default template if needed.
 * Executed inside a caller-managed transaction under row locks.
 */
async function commitPdfGeneration(client, { linkedIds, templateId, printerProfileId, testPrint, userId }) {
    if (!linkedIds || !linkedIds.length) return [];

    // Lock records in ascending ID order to prevent deadlocks
    const { rows: liveRows } = await client.query(
        `SELECT cr.id, cr.status, cr.is_deleted, cr.ap_payment_id, cr.expense_id, cr.bank_account_id,
                cr.template_id, cr.replaced_by_cheque_id, ba.default_cheque_template_id,
                tpl_def.id AS def_tpl_id, tpl_def.is_deleted AS def_tpl_is_deleted
         FROM cheque_records cr
         LEFT JOIN bank_account ba ON ba.bank_account_id = cr.bank_account_id
         LEFT JOIN cheque_templates tpl_def ON tpl_def.id = ba.default_cheque_template_id
         WHERE cr.id = ANY($1::int[])
         ORDER BY cr.id ASC
         FOR UPDATE OF cr`,
        [linkedIds]
    );

    const liveBlocked = liveRows.filter((r) =>
        r.is_deleted || RETIRED_OR_TERMINAL_STATUSES.includes(r.status) || r.replaced_by_cheque_id
    );
    if (liveBlocked.length) {
        throw serviceError(409, 'CHEQUE_PRINT_BLOCKED',
            `Cannot print cheque(s) with status ${liveBlocked.map((r) => r.status).join(', ')} (record id ${liveBlocked.map((r) => r.id).join(', ')})`
        );
    }

    // Revalidate effective template under lock
    const templateIdNum = Number(templateId);
    for (const row of liveRows) {
        if (row.template_id != null) {
            if (row.template_id !== templateIdNum) {
                throw serviceError(409, 'CHEQUE_TEMPLATE_MISMATCH',
                    `Cheque ${row.id} template was concurrently changed.`
                );
            }
        } else {
            // bank default
            if (row.default_cheque_template_id !== templateIdNum || row.def_tpl_is_deleted === true) {
                throw serviceError(409, 'CHEQUE_TEMPLATE_MISMATCH',
                    `Bank account default template for cheque ${row.id} changed concurrently. Please refresh.`
                );
            }
        }
    }

    // Pin template if not test print
    if (!testPrint) {
        await client.query(
            `UPDATE cheque_records
             SET template_id = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = ANY($2::int[]) AND template_id IS NULL`,
            [templateIdNum, linkedIds]
        );
    }

    // Audit logs
    const actionName = testPrint ? 'TEST_PDF_GENERATED' : 'PDF_GENERATED';
    for (const record of liveRows) {
        await apPdcService.logOutboundClearanceEvent(client, {
            apPaymentId: record.ap_payment_id,
            expenseId: record.expense_id,
            chequeRecordId: record.id,
            bankAccountId: record.bank_account_id,
            action: actionName,
            notes: testPrint ? 'Test alignment PDF generated' : 'Cheque PDF generated from Print Cheques queue',
            metadata: {
                template_id: templateIdNum,
                printer_profile_id: printerProfileId ? Number(printerProfileId) : null,
                test_print: Boolean(testPrint)
            },
            userId
        });
    }

    return liveRows;
}

/**
 * Acknowledges that a pending cheque was printed externally (outside the app).
 * Retry-safe: if already PRINTED or PDF_GENERATED, returns without duplicate log.
 */
async function recordExternalPrint(client, { chequeRecordId, notes, userId }) {
    if (!chequeRecordId) {
        throw serviceError(400, 'CHEQUE_ID_REQUIRED', 'Cheque record ID is required');
    }
    const cleanNotes = typeof notes === 'string' ? notes.trim() : '';
    if (!cleanNotes) {
        throw serviceError(400, 'NOTES_REQUIRED', 'A note explaining why the cheque was printed externally is required.');
    }

    const { rows: [record] } = await client.query(
        `SELECT cr.id, cr.status, cr.is_deleted, cr.replaced_by_cheque_id,
                cr.bank_account_id, cr.ap_payment_id, cr.expense_id, cr.cheque_number
         FROM cheque_records cr
         WHERE cr.id = $1
         FOR UPDATE`,
        [chequeRecordId]
    );

    if (!record) {
        throw serviceError(404, 'CHEQUE_NOT_FOUND', 'Cheque record not found.');
    }

    if (record.is_deleted || RETIRED_OR_TERMINAL_STATUSES.includes(record.status) || record.replaced_by_cheque_id) {
        throw serviceError(409, 'CHEQUE_PRINT_BLOCKED',
            `Cannot acknowledge external printing for ${record.is_deleted ? 'hidden' : record.status} cheque.`
        );
    }

    if (!ALLOWED_QUEUE_STATUSES.includes(record.status)) {
        throw serviceError(409, 'CHEQUE_PRINT_BLOCKED',
            `Cannot acknowledge external printing for cheque with status ${record.status}. Only ISSUED or HELD_FOR_RELEASE cheques are eligible.`
        );
    }

    // Retry safety: check if PRINTED or PDF_GENERATED already logged
    const { rows: existingLog } = await client.query(
        `SELECT log_id, action, created_at
         FROM cheque_clearance_log
         WHERE cheque_record_id = $1 AND action IN ('PRINTED', 'PDF_GENERATED')
         LIMIT 1`,
        [chequeRecordId]
    );

    if (existingLog.length) {
        return {
            already_recorded: true,
            action: existingLog[0].action,
            recorded_at: existingLog[0].created_at,
            record
        };
    }

    // Log PRINTED event with external acknowledgement metadata
    await apPdcService.logOutboundClearanceEvent(client, {
        apPaymentId: record.ap_payment_id,
        expenseId: record.expense_id,
        chequeRecordId: record.id,
        bankAccountId: record.bank_account_id,
        action: 'PRINTED',
        notes: cleanNotes,
        metadata: {
            source: 'external_acknowledgement'
        },
        userId
    });

    return {
        already_recorded: false,
        action: 'PRINTED',
        record
    };
}

module.exports = {
    ALLOWED_QUEUE_STATUSES,
    RETIRED_OR_TERMINAL_STATUSES,
    encodeCursor,
    decodeCursor,
    isFirstPrintEligibleStatus,
    isReprintEligibleStatus,
    formatChequeDate,
    resolveEffectiveTemplate,
    getPrintQueue,
    validateAndPreparePdfBatch,
    commitPdfGeneration,
    recordExternalPrint
};
