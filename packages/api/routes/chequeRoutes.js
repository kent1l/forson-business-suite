const express = require('express');
const db = require('../db');
const { protect } = require('../middleware/authMiddleware');
const { createChequePdf } = require('../helpers/pdf/chequePdf');
const { parse, isValid } = require('date-fns');

const router = express.Router();

const DEFAULT_TEMPLATE = {
    date: { x: 430, y: 700, alignment: 'left', fontSize: 11 },
    payee: { x: 90, y: 655, alignment: 'left', fontSize: 12, maxWidth: 380, minFontSize: 8 },
    amountNumeric: { x: 490, y: 655, alignment: 'right', fontSize: 12 },
    amountWords: { x: 90, y: 625, alignment: 'left', fontSize: 11, maxWidth: 420 },
    memo: { x: 90, y: 585, alignment: 'left', fontSize: 10, maxWidth: 220 },
    currency: { x: 515, y: 655, alignment: 'left', fontSize: 11 }
};

router.get('/cheques/templates', protect, async (_req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT id, bank_name, field_positions, date_format, amount_format, currency_settings, created_at, updated_at
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

router.post('/cheques/templates', protect, async (req, res) => {
    const {
        bank_name,
        field_positions = DEFAULT_TEMPLATE,
        date_format = 'MM/dd/yyyy',
        amount_format = 'title_case',
        currency_settings = { enabled: true, label: 'USD' }
    } = req.body;

    if (!bank_name || !String(bank_name).trim()) {
        return res.status(400).json({ message: 'bank_name is required' });
    }

    try {
        const { rows } = await db.query(
            `INSERT INTO cheque_templates (bank_name, field_positions, date_format, amount_format, currency_settings)
             VALUES ($1, $2::jsonb, $3, $4, $5::jsonb)
             RETURNING id, bank_name, field_positions, date_format, amount_format, currency_settings, created_at, updated_at`,
            [bank_name.trim(), JSON.stringify(field_positions), date_format, amount_format, JSON.stringify(currency_settings)]
        );
        res.status(201).json(rows[0]);
    } catch (error) {
        console.error('Failed to create cheque template', error);
        res.status(500).json({ message: 'Unable to create cheque template' });
    }
});

router.put('/cheques/templates/:id', protect, async (req, res) => {
    const { id } = req.params;
    const { field_positions, date_format, amount_format, currency_settings, bank_name } = req.body;

    try {
        const { rows } = await db.query(
            `UPDATE cheque_templates
             SET bank_name = COALESCE($1, bank_name),
                 field_positions = COALESCE($2::jsonb, field_positions),
                 date_format = COALESCE($3, date_format),
                 amount_format = COALESCE($4, amount_format),
                 currency_settings = COALESCE($5::jsonb, currency_settings),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $6 AND is_deleted = FALSE
             RETURNING id, bank_name, field_positions, date_format, amount_format, currency_settings, created_at, updated_at`,
            [
                bank_name ?? null,
                field_positions ? JSON.stringify(field_positions) : null,
                date_format ?? null,
                amount_format ?? null,
                currency_settings ? JSON.stringify(currency_settings) : null,
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

router.get('/cheques/history', protect, async (_req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT cr.id, cr.payee, cr.amount, cr.cheque_date, cr.memo, cr.created_at, cr.template_id,
                    ct.bank_name AS bank_preset
             FROM cheque_records cr
             LEFT JOIN cheque_templates ct ON ct.id = cr.template_id
             WHERE cr.is_deleted = FALSE
             ORDER BY cr.created_at DESC
             LIMIT 300`
        );
        res.json(rows);
    } catch (error) {
        console.error('Failed to fetch cheque history', error);
        res.status(500).json({ message: 'Unable to fetch cheque history' });
    }
});

router.get('/cheques/printer-profiles', protect, async (_req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT id, profile_name, offset_x, offset_y, is_default, created_at, updated_at
             FROM printer_profiles
             ORDER BY is_default DESC, profile_name ASC`
        );
        res.json(rows);
    } catch (error) {
        console.error('Failed to fetch printer profiles', error);
        res.status(500).json({ message: 'Unable to fetch printer profiles' });
    }
});

router.post('/cheques/printer-profiles', protect, async (req, res) => {
    const { profile_name, offset_x = 0, offset_y = 0, is_default = false } = req.body;
    if (!profile_name || !String(profile_name).trim()) {
        return res.status(400).json({ message: 'profile_name is required' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        if (is_default) {
            await client.query('UPDATE printer_profiles SET is_default = FALSE WHERE is_default = TRUE');
        }
        const { rows } = await client.query(
            `INSERT INTO printer_profiles (profile_name, offset_x, offset_y, is_default)
             VALUES ($1, $2, $3, $4)
             RETURNING id, profile_name, offset_x, offset_y, is_default, created_at, updated_at`,
            [String(profile_name).trim(), Number(offset_x) || 0, Number(offset_y) || 0, Boolean(is_default)]
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

router.put('/cheques/printer-profiles/:id', protect, async (req, res) => {
    const { id } = req.params;
    const { profile_name, offset_x, offset_y, is_default } = req.body;
    const client = await db.getClient();

    try {
        await client.query('BEGIN');
        if (is_default === true) {
            await client.query('UPDATE printer_profiles SET is_default = FALSE WHERE is_default = TRUE');
        }
        const { rows } = await client.query(
            `UPDATE printer_profiles
             SET profile_name = COALESCE($1, profile_name),
                 offset_x = COALESCE($2, offset_x),
                 offset_y = COALESCE($3, offset_y),
                 is_default = COALESCE($4, is_default),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $5
             RETURNING id, profile_name, offset_x, offset_y, is_default, created_at, updated_at`,
            [
                profile_name ? String(profile_name).trim() : null,
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



router.post('/cheques/generate-pdf', protect, async (req, res) => {
    const { template_id, records = [], printer_profile_id = null, test_print = false } = req.body;

    if (!template_id) {
        return res.status(400).json({ message: 'template_id is required' });
    }
    if (!Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ message: 'At least one cheque record is required' });
    }

    try {
        const templateRes = await db.query(
            `SELECT id, bank_name, field_positions, date_format, amount_format, currency_settings
             FROM cheque_templates
             WHERE id = $1 AND is_deleted = FALSE`,
            [template_id]
        );

        if (!templateRes.rows.length) {
            return res.status(404).json({ message: 'Template not found' });
        }

        let profile = { offset_x: 0, offset_y: 0 };
        if (printer_profile_id) {
            const profileRes = await db.query(
                `SELECT id, offset_x, offset_y
                 FROM printer_profiles
                 WHERE id = $1`,
                [printer_profile_id]
            );
            if (profileRes.rows.length) {
                profile = profileRes.rows[0];
            }
        }

        const normalizedRows = records.map((record) => {
            const amount = Math.round(Number(record.amount || 0) * 100) / 100;
            if (!record.payee || !String(record.payee).trim()) {
                throw new Error('Payee is required for every cheque');
            }
            if (Number.isNaN(amount)) {
                throw new Error('Amount must be numeric');
            }
            const dateValue = String(record.date || '');
            const fmt = templateRes.rows[0].date_format || 'MM/dd/yyyy';
            if (!isValid(parse(dateValue, fmt, new Date()))) {
                throw new Error(`Date must follow ${fmt}`);
            }
            return {
                date: dateValue,
                payee: String(record.payee).trim(),
                amount: amount.toFixed(2),
                memo: record.memo || ''
            };
        });

        const pdfBuffer = await createChequePdf({
            rows: normalizedRows,
            template: templateRes.rows[0],
            printerProfile: profile,
            testPrint: Boolean(test_print)
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="cheques.pdf"');
        return res.send(pdfBuffer);
    } catch (error) {
        console.error('Failed to generate cheque PDF', error);
        const status = /required|numeric/i.test(error.message) ? 400 : 500;
        return res.status(status).json({ message: error.message || 'Unable to generate cheque PDF' });
    }
});
router.post('/cheques/records', protect, async (req, res) => {
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

router.post('/cheques/reprint/:id', protect, async (req, res) => {
    const { id } = req.params;
    const { template_id } = req.body;

    try {
        const { rows } = await db.query(
            `SELECT cr.id, cr.payee, cr.amount, cr.cheque_date, cr.memo, cr.template_id,
                    COALESCE($2::integer, cr.template_id) AS selected_template_id
             FROM cheque_records cr
             WHERE cr.id = $1 AND cr.is_deleted = FALSE`,
            [id, template_id || null]
        );

        if (!rows.length) {
            return res.status(404).json({ message: 'Cheque record not found' });
        }

        res.json({ record: rows[0] });
    } catch (error) {
        console.error('Failed to prepare cheque reprint', error);
        res.status(500).json({ message: 'Unable to prepare cheque reprint' });
    }
});

router.delete('/cheques/history/:id', protect, async (req, res) => {
    const { id } = req.params;

    try {
        const { rowCount } = await db.query(
            `UPDATE cheque_records
             SET is_deleted = TRUE,
                 deleted_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND is_deleted = FALSE`,
            [id]
        );

        if (!rowCount) {
            return res.status(404).json({ message: 'Cheque record not found' });
        }

        res.json({ message: 'Cheque record deleted successfully' });
    } catch (error) {
        console.error('Failed to delete cheque record', error);
        res.status(500).json({ message: 'Unable to delete cheque record' });
    }
});

module.exports = router;
