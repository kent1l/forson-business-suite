const express = require('express');
const db = require('../db');
const { protect, hasPermission, userHasPermission } = require('../middleware/authMiddleware');
const { createChequePdf } = require('../helpers/pdf/chequePdf');
const apPdcService = require('../services/apPdcService');
const chequePrintService = require('../services/chequePrintService');

const router = express.Router();
const ALLOWED_FEED_TYPES = ['native', 'letter_center', 'letter_left', 'letter_right'];

function isValidDateByFormat(value, format) {
    const input = String(value || '').trim();
    if (!input) return false;

    if (format === 'MM/dd/yyyy' || format === 'dd/MM/yyyy' || format === 'MM-dd-yyyy') {
        const separator = format.includes('-') ? '-' : '/';
        const pattern = separator === '-' ? /^(\d{2})-(\d{2})-(\d{4})$/ : /^(\d{2})\/(\d{2})\/(\d{4})$/;
        const match = input.match(pattern);
        if (!match) return false;
        const left = Number(match[1]);
        const right = Number(match[2]);
        const year = Number(match[3]);
        const month = format === 'dd/MM/yyyy' ? right : left;
        const day = format === 'dd/MM/yyyy' ? left : right;
        const date = new Date(year, month - 1, day);
        return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
    }

    if (format === 'MMM dd, yyyy') {
        const date = new Date(input);
        return !Number.isNaN(date.getTime());
    }

    // Fallback parser for custom formats
    const date = new Date(input);
    return !Number.isNaN(date.getTime());
}

function toFileSafeSegment(value, fallback = 'cheques') {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return normalized || fallback;
}

function toSafeHeaderValue(value) {
    return String(value || '').replace(/[^\x20-\x7E]+/g, ' ').trim();
}

const DEFAULT_TEMPLATE = {
    date: { x: 426, y: 178, alignment: 'left', fontSize: 11, mode: 'boxed', charSpacing: 14 },
    payee: { x: 72, y: 136, alignment: 'left', fontSize: 12, maxWidth: 380, minFontSize: 8 },
    amountNumeric: { x: 534, y: 136, alignment: 'right', fontSize: 12 },
    amountWords: { x: 72, y: 104, alignment: 'left', fontSize: 11, maxWidth: 420 },
    memo: { x: 72, y: 84, alignment: 'left', fontSize: 10, maxWidth: 220 },
    currency: { x: 474, y: 136, alignment: 'left', fontSize: 11 }
};

const DEFAULT_PAPER_SETTINGS = { widthIn: 8, heightIn: 3, unit: 'in' };
const DEFAULT_AMOUNT_WORDS_SETTINGS = { suffix: 'pesos' };
const DEFAULT_TEXT_SETTINGS = {
    payeeFillerEnabled: false,
    payeeFiller: '***',
    amountWordsFillerEnabled: false,
    amountWordsFiller: '***'
};

router.get('/cheques/templates', protect, hasPermission('cheques:view'), async (_req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT id, bank_name, field_positions, date_format, amount_format, currency_settings, paper_settings, amount_words_settings, text_settings, created_at, updated_at
             FROM cheque_templates
             WHERE is_deleted = FALSE
             ORDER BY bank_name ASC`
        );
        res.json(rows);
    } catch (error) {
        console.error('Failed to fetch cheque templates', error);
        res.status(500).json({ message: 'Unable to fetch cheque templates' });
    }
});

router.post('/cheques/templates', protect, hasPermission('cheques:manage_settings'), async (req, res) => {
    const {
        bank_name,
        field_positions = DEFAULT_TEMPLATE,
        date_format = 'MM-dd-yyyy',
        amount_format = 'title_case',
        currency_settings = { enabled: true, label: 'PHP' },
        paper_settings = DEFAULT_PAPER_SETTINGS,
        amount_words_settings = DEFAULT_AMOUNT_WORDS_SETTINGS,
        text_settings = DEFAULT_TEXT_SETTINGS
    } = req.body;

    if (!bank_name || !String(bank_name).trim()) {
        return res.status(400).json({ message: 'bank_name is required' });
    }

    try {
        const { rows } = await db.query(
            `INSERT INTO cheque_templates (bank_name, field_positions, date_format, amount_format, currency_settings, paper_settings, amount_words_settings, text_settings)
             VALUES ($1, $2::jsonb, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb)
             RETURNING id, bank_name, field_positions, date_format, amount_format, currency_settings, paper_settings, amount_words_settings, text_settings, created_at, updated_at`,
            [bank_name.trim(), JSON.stringify(field_positions), date_format, amount_format, JSON.stringify(currency_settings), JSON.stringify(paper_settings), JSON.stringify(amount_words_settings), JSON.stringify(text_settings)]
        );
        res.status(201).json(rows[0]);
    } catch (error) {
        console.error('Failed to create cheque template', error);
        res.status(500).json({ message: 'Unable to create cheque template' });
    }
});

router.put('/cheques/templates/:id', protect, hasPermission('cheques:manage_settings'), async (req, res) => {
    const { id } = req.params;
    const { field_positions, date_format, amount_format, currency_settings, bank_name, paper_settings, amount_words_settings, text_settings } = req.body;

    try {
        const { rows } = await db.query(
            `UPDATE cheque_templates
             SET bank_name = COALESCE($1, bank_name),
                 field_positions = COALESCE($2::jsonb, field_positions),
                 date_format = COALESCE($3, date_format),
                 amount_format = COALESCE($4, amount_format),
                 currency_settings = COALESCE($5::jsonb, currency_settings),
                 paper_settings = COALESCE($6::jsonb, paper_settings),
                 amount_words_settings = COALESCE($7::jsonb, amount_words_settings),
                 text_settings = COALESCE($8::jsonb, text_settings),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $9 AND is_deleted = FALSE
             RETURNING id, bank_name, field_positions, date_format, amount_format, currency_settings, paper_settings, amount_words_settings, text_settings, created_at, updated_at`,
            [
                bank_name ?? null,
                field_positions ? JSON.stringify(field_positions) : null,
                date_format ?? null,
                amount_format ?? null,
                currency_settings ? JSON.stringify(currency_settings) : null,
                paper_settings ? JSON.stringify(paper_settings) : null,
                amount_words_settings ? JSON.stringify(amount_words_settings) : null,
                text_settings ? JSON.stringify(text_settings) : null,
                id
            ]
        );

        if (!rows.length) {
            return res.status(404).json({ message: 'Template not found' });
        }

        res.json(rows[0]);
    } catch (error) {
        console.error('Failed to update cheque template', error);
        res.status(500).json({ message: 'Unable to update cheque template' });
    }
});

router.delete('/cheques/templates/:id', protect, hasPermission('cheques:manage_settings'), async (req, res) => {
    const { id } = req.params;
    try {
        const { rows } = await db.query(
            `UPDATE cheque_templates
             SET is_deleted = TRUE, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND is_deleted = FALSE
             RETURNING id`,
            [id]
        );
        if (!rows.length) return res.status(404).json({ message: 'Template not found' });
        res.json({ success: true });
    } catch (error) {
        console.error('Failed to delete cheque template', error);
        res.status(500).json({ message: 'Unable to delete cheque template' });
    }
});

router.get('/cheques/print-queue', protect, hasPermission('cheques:view'), async (req, res) => {
    try {
        const { template_id, unassigned, limit, cursor } = req.query;
        const result = await chequePrintService.getPrintQueue(db, {
            template_id,
            unassigned,
            limit,
            cursor
        });
        res.json(result);
    } catch (error) {
        if (error.status) {
            return res.status(error.status).json({
                message: error.message,
                code: error.code,
                details: error.details
            });
        }
        console.error('Failed to fetch cheque print queue', error);
        res.status(500).json({ message: 'Unable to fetch cheque print queue' });
    }
});

router.get('/cheques/history', protect, hasPermission('cheques:view'), async (req, res) => {
    try {
        const includeDeleted = req.query.include_deleted === 'true' || req.query.include_deleted === '1';
        const includeHiddenLegacy = req.query.include_hidden_legacy !== 'false' && req.query.include_hidden_legacy !== '0';
        const search = req.query.search ? String(req.query.search).trim() : '';

        const conditions = [];
        const params = [];

        if (!includeDeleted) {
            conditions.push(`cr.status <> 'DELETED'`);
            if (!includeHiddenLegacy) {
                conditions.push(`COALESCE(cr.is_deleted, FALSE) = FALSE`);
            } else {
                conditions.push(`(COALESCE(cr.is_deleted, FALSE) = FALSE OR cr.ap_payment_id IS NOT NULL OR cr.expense_id IS NOT NULL OR cr.cheque_number IS NOT NULL)`);
            }
        }

        if (search) {
            params.push(`%${search}%`);
            const idx = params.length;
            conditions.push(`(cr.payee ILIKE $${idx} OR COALESCE(cr.cheque_number, '') ILIKE $${idx} OR COALESCE(cr.memo, '') ILIKE $${idx} OR COALESCE(prev_cr.cheque_number, '') ILIKE $${idx} OR COALESCE(next_cr.cheque_number, '') ILIKE $${idx})`);
        }

        const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const { rows } = await db.query(
            `SELECT cr.id, cr.payee, cr.amount, TO_CHAR(cr.cheque_date, 'YYYY-MM-DD') AS cheque_date, cr.memo, cr.created_at, cr.template_id,
                    cr.status, cr.cheque_number, cr.ap_payment_id, cr.expense_id, cr.bank_account_id,
                    cr.replaces_cheque_id, cr.replaced_by_cheque_id,
                    prev_cr.cheque_number AS replaces_cheque_number,
                    next_cr.cheque_number AS replaced_by_cheque_number,
                    cr.void_reason, cr.voided_at,
                    cr.is_deleted, cr.deleted_at, cr.deleted_reason,
                    ct.bank_name AS bank_preset,
                    ba.account_name AS bank_account_name,
                    CASE
                        WHEN cr.ap_payment_id IS NOT NULL THEN 'SUPPLIER'
                        WHEN cr.expense_id IS NOT NULL THEN 'EXPENSE'
                        ELSE 'STANDALONE'
                    END AS purpose_type,
                    EXISTS (
                        SELECT 1 FROM cheque_clearance_log ccl
                        WHERE ccl.cheque_record_id = cr.id AND ccl.action IN ('PRINTED', 'PDF_GENERATED')
                    ) AS is_printed,
                    EXISTS (
                        SELECT 1 FROM cheque_clearance_log ccl
                        WHERE ccl.cheque_record_id = cr.id AND ccl.action = 'TEST_PDF_GENERATED'
                    ) AS has_test_pdf
             FROM cheque_records cr
             LEFT JOIN cheque_templates ct ON ct.id = cr.template_id
             LEFT JOIN bank_account ba ON ba.bank_account_id = cr.bank_account_id
             LEFT JOIN cheque_records prev_cr ON prev_cr.id = cr.replaces_cheque_id
             LEFT JOIN cheque_records next_cr ON next_cr.id = cr.replaced_by_cheque_id
             ${whereClause}
             ORDER BY cr.created_at DESC, cr.id DESC
             LIMIT 300`,
            params
        );
        res.json(rows);
    } catch (error) {
        console.error('Failed to fetch cheque history', error);
        res.status(500).json({ message: 'Unable to fetch cheque history' });
    }
});

router.get('/cheques/printer-profiles', protect, hasPermission('cheques:view'), async (_req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT id, profile_name, feed_type, offset_x, offset_y, is_default, created_at, updated_at
             FROM printer_profiles
             ORDER BY is_default DESC, profile_name ASC`
        );
        res.json(rows);
    } catch (error) {
        console.error('Failed to fetch printer profiles', error);
        res.status(500).json({ message: 'Unable to fetch printer profiles' });
    }
});

router.post('/cheques/printer-profiles', protect, hasPermission('cheques:manage_settings'), async (req, res) => {
    const { profile_name, feed_type = 'native', offset_x = 0, offset_y = 0, is_default = false } = req.body;
    if (!profile_name || !String(profile_name).trim()) {
        return res.status(400).json({ message: 'profile_name is required' });
    }
    if (!ALLOWED_FEED_TYPES.includes(String(feed_type))) {
        return res.status(400).json({ message: `feed_type must be one of: ${ALLOWED_FEED_TYPES.join(', ')}` });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        if (is_default) {
            await client.query('UPDATE printer_profiles SET is_default = FALSE WHERE is_default = TRUE');
        }
        const { rows } = await client.query(
            `INSERT INTO printer_profiles (profile_name, feed_type, offset_x, offset_y, is_default)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, profile_name, feed_type, offset_x, offset_y, is_default, created_at, updated_at`,
            [String(profile_name).trim(), String(feed_type), Number(offset_x) || 0, Number(offset_y) || 0, Boolean(is_default)]
        );
        await client.query('COMMIT');
        res.status(201).json(rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Failed to create printer profile', error);
        res.status(500).json({ message: 'Unable to create printer profile' });
    } finally {
        client.release();
    }
});

router.put('/cheques/printer-profiles/:id', protect, hasPermission('cheques:manage_settings'), async (req, res) => {
    const { id } = req.params;
    const { profile_name, feed_type, offset_x, offset_y, is_default } = req.body;
    if (feed_type !== undefined && !ALLOWED_FEED_TYPES.includes(String(feed_type))) {
        return res.status(400).json({ message: `feed_type must be one of: ${ALLOWED_FEED_TYPES.join(', ')}` });
    }
    const client = await db.getClient();

    try {
        await client.query('BEGIN');
        if (is_default === true) {
            await client.query('UPDATE printer_profiles SET is_default = FALSE WHERE is_default = TRUE');
        }
        const { rows } = await client.query(
            `UPDATE printer_profiles
             SET profile_name = COALESCE($1, profile_name),
                 feed_type = COALESCE($2, feed_type),
                 offset_x = COALESCE($3, offset_x),
                 offset_y = COALESCE($4, offset_y),
                 is_default = COALESCE($5, is_default),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $6
             RETURNING id, profile_name, feed_type, offset_x, offset_y, is_default, created_at, updated_at`,
            [
                profile_name ? String(profile_name).trim() : null,
                feed_type !== undefined ? String(feed_type) : null,
                offset_x !== undefined ? Number(offset_x) || 0 : null,
                offset_y !== undefined ? Number(offset_y) || 0 : null,
                is_default !== undefined ? Boolean(is_default) : null,
                id
            ]
        );
        if (!rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Printer profile not found' });
        }
        await client.query('COMMIT');
        res.json(rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Failed to update printer profile', error);
        res.status(500).json({ message: 'Unable to update printer profile' });
    } finally {
        client.release();
    }
});

router.delete('/cheques/printer-profiles/:id', protect, hasPermission('cheques:manage_settings'), async (req, res) => {
    const { id } = req.params;
    try {
        const { rows } = await db.query(
            `DELETE FROM printer_profiles
             WHERE id = $1
             RETURNING id`,
            [id]
        );
        if (!rows.length) return res.status(404).json({ message: 'Printer profile not found' });
        res.json({ success: true });
    } catch (error) {
        console.error('Failed to delete printer profile', error);
        res.status(500).json({ message: 'Unable to delete printer profile' });
    }
});




router.get('/cheques/settings-export', protect, hasPermission('cheques:manage_settings'), async (_req, res) => {
    try {
        const [templatesRes, profilesRes] = await Promise.all([
            db.query(`SELECT id, bank_name, field_positions, date_format, amount_format, currency_settings, paper_settings, amount_words_settings, text_settings, created_at, updated_at FROM cheque_templates WHERE is_deleted = FALSE ORDER BY bank_name ASC`),
            db.query(`SELECT id, profile_name, feed_type, offset_x, offset_y, is_default, created_at, updated_at FROM printer_profiles ORDER BY is_default DESC, profile_name ASC`)
        ]);

        const payload = {
            schema_version: 1,
            exported_at: new Date().toISOString(),
            templates: templatesRes.rows,
            printer_profiles: profilesRes.rows
        };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="cheque-settings-${new Date().toISOString().slice(0,10)}.json"`);
        res.status(200).send(JSON.stringify(payload, null, 2));
    } catch (error) {
        console.error('Failed to export cheque settings', error);
        res.status(500).json({ message: 'Unable to export cheque settings' });
    }
});

router.post('/cheques/settings-import', protect, hasPermission('cheques:manage_settings'), async (req, res) => {
    const { templates = [], printer_profiles = [], overwrite = false } = req.body || {};
    if (!Array.isArray(templates) || !Array.isArray(printer_profiles)) {
        return res.status(400).json({ message: 'templates and printer_profiles must be arrays' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        let importedTemplates = 0;
        for (const tpl of templates) {
            if (!tpl?.bank_name || !String(tpl.bank_name).trim()) continue;
            const bankName = String(tpl.bank_name).trim();
            if (overwrite) {
                await client.query('UPDATE cheque_templates SET is_deleted = TRUE WHERE bank_name = $1 AND is_deleted = FALSE', [bankName]);
            }
            await client.query(`INSERT INTO cheque_templates (bank_name, field_positions, date_format, amount_format, currency_settings, paper_settings, amount_words_settings, text_settings) VALUES ($1, $2::jsonb, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb)`, [
                bankName,
                JSON.stringify(tpl.field_positions || DEFAULT_TEMPLATE),
                tpl.date_format || 'MM-dd-yyyy',
                tpl.amount_format || 'title_case',
                JSON.stringify(tpl.currency_settings || { enabled: true, label: 'PHP' }),
                JSON.stringify(tpl.paper_settings || DEFAULT_PAPER_SETTINGS),
                JSON.stringify(tpl.amount_words_settings || DEFAULT_AMOUNT_WORDS_SETTINGS),
                JSON.stringify(tpl.text_settings || DEFAULT_TEXT_SETTINGS)
            ]);
            importedTemplates += 1;
        }

        let importedProfiles = 0;
        if (overwrite && printer_profiles.some((p) => p?.is_default)) {
            await client.query('UPDATE printer_profiles SET is_default = FALSE WHERE is_default = TRUE');
        }
        for (const profile of printer_profiles) {
            if (!profile?.profile_name || !String(profile.profile_name).trim()) continue;
            const name = String(profile.profile_name).trim();
            if (overwrite) {
                await client.query('DELETE FROM printer_profiles WHERE profile_name = $1', [name]);
            }
            await client.query(`INSERT INTO printer_profiles (profile_name, feed_type, offset_x, offset_y, is_default) VALUES ($1, $2, $3, $4, $5)`, [
                name,
                ALLOWED_FEED_TYPES.includes(String(profile.feed_type)) ? String(profile.feed_type) : 'native',
                Number(profile.offset_x) || 0,
                Number(profile.offset_y) || 0,
                Boolean(profile.is_default)
            ]);
            importedProfiles += 1;
        }

        await client.query('COMMIT');
        res.json({ imported_templates: importedTemplates, imported_printer_profiles: importedProfiles });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Failed to import cheque settings', error);
        res.status(500).json({ message: 'Unable to import cheque settings' });
    } finally {
        client.release();
    }
});

router.post('/cheques/generate-pdf', protect, hasPermission('cheques:create'), async (req, res) => {
    const { template_id, records = [], printer_profile_id = null, test_print = false } = req.body;

    try {
        const {
            template,
            printerProfile,
            linkedRecordsById,
            linkedIds
        } = await chequePrintService.validateAndPreparePdfBatch(db, {
            templateId: template_id,
            printerProfileId: printer_profile_id,
            records
        });

        const fmt = template.date_format || 'MM-dd-yyyy';
        const normalizedRows = records.map((record) => {
            if (record.cheque_record_id) {
                const linked = linkedRecordsById.get(Number(record.cheque_record_id));
                const effectiveAmount = Number(linked.amount);
                const amount = Math.round(effectiveAmount * 100) / 100;
                const canonicalDate = chequePrintService.formatChequeDate(linked.cheque_date, fmt);
                return {
                    date: canonicalDate,
                    payee: String(linked.payee).trim(),
                    amount: amount.toFixed(2),
                    memo: linked.memo || record.memo || '',
                    cheque_record_id: linked.id
                };
            }

            // Standalone row
            const payee = String(record.payee || '').trim();
            if (!payee) throw new Error('Payee is required for every cheque');
            const parsedAmount = Number(record.amount);
            if (Number.isNaN(parsedAmount)) throw new Error('Amount must be numeric');
            const amount = Math.round(parsedAmount * 100) / 100;
            const dateValue = String(record.date || '').trim();
            if (!isValidDateByFormat(dateValue, fmt)) {
                throw new Error(`Date must follow ${fmt}`);
            }
            return {
                date: dateValue,
                payee,
                amount: amount.toFixed(2),
                memo: record.memo || '',
                cheque_record_id: null
            };
        });

        const pdfResult = await createChequePdf({
            rows: normalizedRows,
            template,
            printerProfile,
            testPrint: Boolean(test_print)
        });

        const bankSegment = toFileSafeSegment(template?.bank_name, 'bank');
        const dateSegment = new Date().toISOString().slice(0, 10);
        const countSegment = `${normalizedRows.length}-cheque${normalizedRows.length > 1 ? 's' : ''}`;
        const pdfFilename = `${bankSegment}-${countSegment}-${dateSegment}.pdf`;

        if (linkedIds.length) {
            const client = await db.getClient();
            try {
                await client.query('BEGIN');
                await chequePrintService.commitPdfGeneration(client, {
                    linkedIds,
                    templateId: template_id,
                    printerProfileId: printer_profile_id,
                    testPrint: Boolean(test_print),
                    userId: req.user?.employee_id
                });
                await client.query('COMMIT');
            } catch (txErr) {
                await client.query('ROLLBACK');
                throw txErr;
            } finally {
                client.release();
            }
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${pdfFilename}"`);
        res.setHeader('X-Cheque-Pdf-Renderer', pdfResult.renderer || 'unknown');
        if (pdfResult.warning) {
            const warningHeader = toSafeHeaderValue(pdfResult.warning);
            if (warningHeader) {
                res.setHeader('X-Cheque-Pdf-Warning', warningHeader);
            }
        }
        return res.send(pdfResult.buffer);
    } catch (error) {
        if (error.status) {
            return res.status(error.status).json({
                message: error.message,
                code: error.code,
                details: error.details
            });
        }
        console.error('Failed to generate cheque PDF', error);
        const status = /required|numeric|follow/i.test(error.message) ? 400 : 500;
        return res.status(status).json({ message: error.message || 'Unable to generate cheque PDF' });
    }
});
router.post('/cheques/records', protect, hasPermission('cheques:create'), async (req, res) => {
    const { records = [], template_id } = req.body;

    if (!Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ message: 'At least one cheque record is required' });
    }

    const client = await db.getClient();

    try {
        await client.query('BEGIN');

        const inserted = [];
        for (const record of records) {
            const { payee, amount, date, memo } = record;
            if (!payee || String(payee).trim().length === 0) {
                throw new Error('Each cheque requires a payee');
            }

            const parsedAmount = Number(amount);
            if (Number.isNaN(parsedAmount)) {
                throw new Error('Invalid amount detected');
            }

            const roundedAmount = Math.round(parsedAmount * 100) / 100;

            const { rows } = await client.query(
                `INSERT INTO cheque_records (template_id, payee, amount, cheque_date, memo)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING id, template_id, payee, amount, cheque_date, memo, created_at`,
                [template_id, String(payee).trim(), roundedAmount, date || null, memo || null]
            );
            inserted.push(rows[0]);
        }

        await client.query('COMMIT');
        res.status(201).json({ records: inserted });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Failed to save cheque records', error);
        const status = error.message.includes('payee') || error.message.includes('amount') ? 400 : 500;
        res.status(status).json({ message: error.message || 'Unable to save cheque records' });
    } finally {
        client.release();
    }
});

router.post('/cheques/:id/record-external-print', protect, hasPermission('cheques:create'), async (req, res) => {
    const chequeId = parseInt(req.params.id, 10);
    if (!chequeId) return res.status(400).json({ message: 'Invalid cheque record ID' });

    const { notes } = req.body || {};
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const result = await chequePrintService.recordExternalPrint(client, {
            chequeRecordId: chequeId,
            notes,
            userId: req.user?.employee_id
        });
        await client.query('COMMIT');
        res.json({
            success: true,
            already_recorded: result.already_recorded,
            message: result.already_recorded
                ? 'Cheque was already recorded as printed or generated.'
                : 'Cheque acknowledged as printed externally.',
            record: result.record
        });
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.status) {
            return res.status(error.status).json({
                message: error.message,
                code: error.code,
                details: error.details
            });
        }
        console.error('Failed to record external print', error);
        res.status(500).json({ message: 'Unable to record external print' });
    } finally {
        client.release();
    }
});

router.post('/cheques/reprint/:id', protect, hasPermission('cheques:create'), async (req, res) => {
    const { id } = req.params;
    const { template_id } = req.body || {};

    try {
        const resolved = await chequePrintService.resolveEffectiveTemplate(db, Number(id));
        const record = resolved.chequeRecord;

        if (['VOID', 'REPLACED', 'DELETED'].includes(record.status) || record.is_deleted === true) {
            return res.status(409).json({
                code: 'CHEQUE_REPRINT_BLOCKED',
                message: `Cannot reprint a ${record.is_deleted && !['VOID', 'REPLACED', 'DELETED'].includes(record.status) ? 'hidden' : record.status} cheque.`,
            });
        }

        let selectedTemplateId = null;
        if (template_id) {
            const { rows: reqTpl } = await db.query(
                'SELECT id FROM cheque_templates WHERE id = $1 AND is_deleted = FALSE',
                [Number(template_id)]
            );
            if (!reqTpl.length) {
                return res.status(404).json({ message: 'Requested reprint template not found' });
            }
            selectedTemplateId = reqTpl[0].id;
        } else if (resolved.effectiveTemplate) {
            selectedTemplateId = resolved.effectiveTemplate.id;
        } else {
            return res.status(409).json({
                code: resolved.setupRequiredReason || 'TEMPLATE_REQUIRED',
                message: 'No active cheque template found for this cheque or its bank account. Please configure a default template first.',
                details: resolved.details
            });
        }

        res.json({
            record: {
                ...record,
                selected_template_id: selectedTemplateId
            }
        });
    } catch (error) {
        if (error.status) {
            return res.status(error.status).json({ message: error.message, code: error.code, details: error.details });
        }
        console.error('Failed to prepare cheque reprint', error);
        res.status(500).json({ message: 'Unable to prepare cheque reprint' });
    }
});

router.delete('/cheques/history/:id', protect, async (req, res) => {
    const chequeId = parseInt(req.params.id, 10);
    if (!chequeId) return res.status(400).json({ message: 'Invalid cheque record ID' });

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const { rows: [record] } = await client.query(
            `SELECT id, status, is_deleted, ap_payment_id, expense_id, cheque_number, bank_account_id
             FROM cheque_records
             WHERE id = $1
             FOR UPDATE`,
            [chequeId]
        );

        if (!record) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Cheque record not found' });
        }

        const isFinancialOrNumbered = Boolean(record.ap_payment_id || record.expense_id || record.cheque_number);
        if (isFinancialOrNumbered) {
            if (!userHasPermission(req, 'ap-pdc:delete') && !userHasPermission(req, 'ap-pdc:manage')) {
                await client.query('ROLLBACK');
                return res.status(403).json({
                    code: 'PERMISSION_DENIED',
                    message: 'Deleting a financial or numbered cheque requires ap-pdc:delete or ap-pdc:manage permission.',
                });
            }
            const { reason, notes, confirm_delete = true, confirm_printed_not_released = false } = req.body || {};
            const data = await apPdcService.deleteErroneousPayment(client, {
                chequeRecordId: chequeId,
                reason: reason || req.query.reason,
                notes: notes || req.query.notes,
                confirmDelete: Boolean(confirm_delete),
                confirmPrintedNotReleased: Boolean(confirm_printed_not_released),
                userId: req.user?.employee_id,
            });
            await client.query('COMMIT');
            return res.json({
                success: true,
                message: 'Erroneous payment deleted and bill allocations released.',
                data,
            });
        }

        if (!userHasPermission(req, 'cheques:manage_settings') && !userHasPermission(req, 'cheques:create')) {
            await client.query('ROLLBACK');
            return res.status(403).json({ message: 'Permission denied' });
        }

        const reasonText = (req.body?.reason || req.query?.reason || 'Removed standalone print entry').trim();
        await client.query(
            `UPDATE cheque_records
             SET status = 'DELETED',
                 is_deleted = TRUE,
                 deleted_at = CURRENT_TIMESTAMP,
                 deleted_by = $2,
                 deleted_reason = $3,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [chequeId, req.user?.employee_id || null, reasonText]
        );
        await apPdcService.logOutboundClearanceEvent(client, {
            chequeRecordId: chequeId,
            bankAccountId: record.bank_account_id,
            action: 'DELETED',
            notes: reasonText,
            userId: req.user?.employee_id,
        });
        await client.query('COMMIT');
        res.json({ success: true, message: 'Standalone print entry removed.' });
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.status) {
            return res.status(error.status).json({ message: error.message, code: error.code, details: error.details });
        }
        console.error('Failed to delete cheque record', error);
        res.status(500).json({ message: 'Unable to delete cheque record' });
    } finally {
        client.release();
    }
});

module.exports = router;
