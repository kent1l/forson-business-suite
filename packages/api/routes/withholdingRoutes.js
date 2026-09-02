const express = require('express');
const multer = require('multer');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const withholdingTax = require('../services/withholdingTaxService');
const { calculateInvoiceTax } = require('../services/taxCalculationService');
const { normalizeTin, normalizeText } = require('../helpers/normalizeEntity');

const router = express.Router();

/**
 * Tax withheld at source: previewing it, and managing the BIR certificates that
 * eventually prove it.
 *
 * The certificate is a separate object from the withholding itself, and arrives much
 * later. A customer deducts the tax at payment and issues the Form 2307 covering it
 * weeks or months afterwards, usually at quarter end, usually as one certificate
 * covering every invoice in the period. Until it arrives the company holds a claim it
 * cannot yet substantiate -- which is what /outstanding exists to chase.
 *
 * See packages/api/services/withholdingTaxService.js for the arithmetic.
 */

const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024; // mirrors chk_wt_cert_attachment_size
const ALLOWED_ATTACHMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'];

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_ATTACHMENT_SIZE },
});

const round2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;

// RFC 4180: a field containing a quote, comma, or newline is quoted, and quotes
// inside it are doubled. Registered names routinely contain commas ("XYZ Corp., Inc.")
// which would otherwise shift every following column.
const csvCell = (value) => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};
const csvRow = (cells) => cells.map(csvCell).join(',');

// ─────────────────────────────────────────────────────────────────────────────
// Preview
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/withholding/preview
 *
 * What a customer is expected to deduct from a sale that hasn't been invoiced yet,
 * so POS and Invoicing can show it before the sale is committed.
 *
 * Tax is recomputed here from the same service the invoice route uses rather than
 * trusting a base sent by the client: the withheld amount reduces a receivable, so
 * its base must come from somewhere the browser cannot influence.
 */
router.post('/withholding/preview', protect, hasPermission(['pos:use', 'invoicing:create']), async (req, res) => {
    const { customer_id, lines, tax_rate_id } = req.body;

    if (!customer_id || !Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ message: 'customer_id and at least one line are required.' });
    }

    try {
        const { rows: customerRows } = await db.query(
            'SELECT customer_id, is_withholding_agent, customer_type, tin, registered_name FROM customer WHERE customer_id = $1',
            [customer_id]
        );
        if (customerRows.length === 0) {
            return res.status(404).json({ message: 'Customer not found.' });
        }
        const customer = customerRows[0];

        if (!customer.is_withholding_agent) {
            return res.json({ applicable: false, components: [], total_withheld: 0, customer });
        }

        const { rows: parts } = await db.query(
            'SELECT part_id, tax_rate_id, is_tax_inclusive_price, is_service FROM part WHERE part_id = ANY($1)',
            [lines.map(l => l.part_id)]
        );
        const taxCalculation = await calculateInvoiceTax(lines, parts, tax_rate_id);
        const result = await withholdingTax.computeWithholdingForInvoice({
            lines: taxCalculation.lines,
            parts,
            customer,
        });

        res.json({
            ...result,
            customer,
            invoice_total: taxCalculation.total_amount,
            ceiling: withholdingTax.computeWithholdingCeiling(result, taxCalculation.total_amount),
            net_due: round2(taxCalculation.total_amount - result.total_withheld),
        });
    } catch (err) {
        console.error('Withholding preview error:', err.message);
        res.status(500).json({ message: 'Server error computing withholding preview.', error: err.message });
    }
});

/**
 * GET /api/withholding/invoices/:invoiceId/preview
 *
 * The same figure for an invoice that already exists, for the AR desk collecting on
 * it later. Reports what has already been withheld so a second collection against the
 * same invoice doesn't double-deduct.
 */
router.get('/withholding/invoices/:invoiceId/preview', protect, hasPermission(['ar:receive_payment', 'ar:view']), async (req, res) => {
    const { invoiceId } = req.params;
    const client = await db.getClient();
    try {
        const context = await withholdingTax.loadInvoiceWithholdingContext(client, invoiceId);
        if (!context) return res.status(404).json({ message: 'Invoice not found.' });

        if (!context.customer.is_withholding_agent) {
            return res.json({ applicable: false, components: [], total_withheld: 0, already_withheld: 0 });
        }

        const result = await withholdingTax.computeWithholdingForInvoice({
            lines: context.lines,
            parts: context.parts,
            customer: context.customer,
        }, client);
        const alreadyWithheld = await withholdingTax.sumWithheldForInvoice(client, invoiceId);
        const ceiling = withholdingTax.computeWithholdingCeiling(result, context.invoice.total_amount);

        res.json({
            ...result,
            invoice_number: context.invoice.invoice_number,
            invoice_total: Number(context.invoice.total_amount),
            already_withheld: alreadyWithheld,
            ceiling,
            remaining_expected: round2(Math.max(result.total_withheld - alreadyWithheld, 0)),
        });
    } catch (err) {
        console.error('Withholding invoice preview error:', err.message);
        res.status(500).json({ message: 'Server error computing withholding.', error: err.message });
    } finally {
        client.release();
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Outstanding certificates (the chase list)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/withholding/outstanding
 *
 * Tax already deducted from us for which no certificate has arrived. Each row is an
 * unsubstantiated claim: real money, already surrendered to BIR, that cannot be
 * credited until the customer hands over the paper.
 *
 * Aged, because the age is the point -- BIR requires the certificate to be issued
 * within 20 days of the close of the quarter, and anything past that needs chasing
 * before the quarter it belongs to is filed.
 */
router.get('/withholding/outstanding', protect, hasPermission(['withholding_tax:manage', 'ar:view']), async (req, res) => {
    const { customer_id } = req.query;

    const conditions = ['wtl.certificate_id IS NULL'];
    const params = [];
    if (customer_id) {
        params.push(customer_id);
        conditions.push(`wtl.customer_id = $${params.length}`);
    }

    try {
        const { rows } = await db.query(`
            SELECT wtl.customer_id,
                   COALESCE(NULLIF(c.registered_name, ''), NULLIF(c.company_name, ''),
                            TRIM(c.first_name || ' ' || COALESCE(c.last_name, ''))) AS customer_name,
                   c.tin,
                   c.customer_type,
                   COUNT(DISTINCT wtl.invoice_id)::int      AS invoice_count,
                   SUM(wtl.actual_withheld)                 AS total_withheld,
                   SUM(wtl.tax_base)                        AS total_base,
                   MIN(wtl.created_at)                      AS oldest_withheld_at,
                   MAX(wtl.created_at)                      AS newest_withheld_at,
                   EXTRACT(DAY FROM (CURRENT_TIMESTAMP - MIN(wtl.created_at)))::int AS oldest_age_days
            FROM withholding_tax_line wtl
            JOIN customer c ON c.customer_id = wtl.customer_id
            WHERE ${conditions.join(' AND ')}
            GROUP BY wtl.customer_id, c.registered_name, c.company_name, c.first_name, c.last_name, c.tin, c.customer_type
            ORDER BY MIN(wtl.created_at) ASC
        `, params);

        res.json(rows);
    } catch (err) {
        console.error('Withholding outstanding error:', err.message);
        res.status(500).json({ message: 'Server error loading outstanding withholding.', error: err.message });
    }
});

/**
 * GET /api/withholding/lines
 *
 * The individual withholding lines, for allocating them to a certificate as it is
 * being received. Defaults to unclaimed lines only.
 */
router.get('/withholding/lines', protect, hasPermission(['withholding_tax:manage', 'ar:view']), async (req, res) => {
    const { customer_id, certificate_id, unclaimed_only = 'true', date_from, date_to } = req.query;

    const conditions = [];
    const params = [];
    if (customer_id) { params.push(customer_id); conditions.push(`wtl.customer_id = $${params.length}`); }
    if (certificate_id) { params.push(certificate_id); conditions.push(`wtl.certificate_id = $${params.length}`); }
    else if (unclaimed_only === 'true') { conditions.push('wtl.certificate_id IS NULL'); }
    if (date_from) { params.push(date_from); conditions.push(`(wtl.created_at AT TIME ZONE 'Asia/Manila')::date >= $${params.length}`); }
    if (date_to) { params.push(date_to); conditions.push(`(wtl.created_at AT TIME ZONE 'Asia/Manila')::date <= $${params.length}`); }

    try {
        const { rows } = await db.query(`
            SELECT wtl.*, i.invoice_number, i.invoice_date,
                   COALESCE(NULLIF(c.registered_name, ''), NULLIF(c.company_name, ''),
                            TRIM(c.first_name || ' ' || COALESCE(c.last_name, ''))) AS customer_name
            FROM withholding_tax_line wtl
            JOIN invoice i ON i.invoice_id = wtl.invoice_id
            JOIN customer c ON c.customer_id = wtl.customer_id
            ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
            ORDER BY wtl.created_at DESC, wtl.wt_line_id DESC
        `, params);
        res.json(rows);
    } catch (err) {
        console.error('Withholding lines error:', err.message);
        res.status(500).json({ message: 'Server error loading withholding lines.', error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Certificates
// ─────────────────────────────────────────────────────────────────────────────

router.get('/withholding/certificates', protect, hasPermission(['withholding_tax:manage', 'ar:view']), async (req, res) => {
    const { customer_id, status, date_from, date_to } = req.query;

    const conditions = [];
    const params = [];
    if (customer_id) { params.push(customer_id); conditions.push(`wtc.customer_id = $${params.length}`); }
    if (status) { params.push(status); conditions.push(`wtc.status = $${params.length}`); }
    if (date_from) { params.push(date_from); conditions.push(`wtc.date_received >= $${params.length}`); }
    if (date_to) { params.push(date_to); conditions.push(`wtc.date_received <= $${params.length}`); }

    try {
        const { rows } = await db.query(`
            SELECT wtc.certificate_id, wtc.customer_id, wtc.certificate_type, wtc.certificate_no,
                   wtc.payor_tin, wtc.payor_registered_name, wtc.period_from, wtc.period_to,
                   wtc.date_received, wtc.tax_base_total, wtc.tax_withheld_total, wtc.status,
                   wtc.notes, wtc.created_at,
                   wtc.attachment_filename, wtc.attachment_mime, wtc.attachment_size,
                   (wtc.attachment_data IS NOT NULL) AS has_attachment,
                   COALESCE(NULLIF(c.registered_name, ''), NULLIF(c.company_name, ''),
                            TRIM(c.first_name || ' ' || COALESCE(c.last_name, ''))) AS customer_name,
                   COUNT(wtl.wt_line_id)::int                    AS line_count,
                   COALESCE(SUM(wtl.actual_withheld), 0)         AS allocated_withheld
            FROM withholding_tax_certificate wtc
            JOIN customer c ON c.customer_id = wtc.customer_id
            LEFT JOIN withholding_tax_line wtl ON wtl.certificate_id = wtc.certificate_id
            ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
            GROUP BY wtc.certificate_id, c.registered_name, c.company_name, c.first_name, c.last_name
            ORDER BY wtc.date_received DESC NULLS LAST, wtc.certificate_id DESC
        `, params);
        res.json(rows);
    } catch (err) {
        console.error('Withholding certificates error:', err.message);
        res.status(500).json({ message: 'Server error loading certificates.', error: err.message });
    }
});

/**
 * POST /api/withholding/certificates
 *
 * Record a certificate that has arrived, and attach the withholding lines it covers.
 *
 * The totals stored on the certificate are the ones printed on the paper, not the sum
 * of the lines allocated to it. They are frequently different -- the customer computed
 * theirs independently -- and the difference is exactly what a reviewer needs to see.
 * Overwriting the customer's figure with ours would erase the discrepancy.
 */
router.post('/withholding/certificates', protect, hasPermission('withholding_tax:manage'), async (req, res) => {
    const {
        customer_id, certificate_type, certificate_no, payor_tin, payor_registered_name,
        period_from, period_to, date_received, tax_base_total, tax_withheld_total,
        notes, line_ids = [],
    } = req.body;

    if (!customer_id || !certificate_type) {
        return res.status(400).json({ message: 'customer_id and certificate_type are required.' });
    }
    if (!['2307', '2306'].includes(String(certificate_type))) {
        return res.status(400).json({ message: 'certificate_type must be 2307 or 2306.' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const { rows: certRows } = await client.query(`
            INSERT INTO withholding_tax_certificate
                (customer_id, certificate_type, certificate_no, payor_tin, payor_registered_name,
                 period_from, period_to, date_received, tax_base_total, tax_withheld_total, notes, created_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8, CURRENT_DATE),$9,$10,$11,$12)
            RETURNING *
        `, [
            customer_id, String(certificate_type), normalizeText(certificate_no),
            normalizeTin(payor_tin), normalizeText(payor_registered_name),
            period_from || null, period_to || null, date_received || null,
            round2(tax_base_total), round2(tax_withheld_total),
            normalizeText(notes), req.user.employee_id || null,
        ]);
        const certificate = certRows[0];

        const allocated = await allocateLinesToCertificate(client, certificate.certificate_id, customer_id, line_ids);

        await client.query('COMMIT');
        res.status(201).json({ ...certificate, allocated_line_count: allocated });
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === '23505') {
            return res.status(409).json({ message: 'A certificate with that number is already recorded for this customer.' });
        }
        console.error('Create withholding certificate error:', err.message);
        res.status(500).json({ message: err.message || 'Server error saving certificate.' });
    } finally {
        client.release();
    }
});

/**
 * Attach withholding lines to a certificate.
 *
 * Only unclaimed lines belonging to the same customer are eligible. Silently
 * reassigning a line already covered by another certificate would let the same
 * withheld peso be claimed twice, so lines already spoken for are rejected outright
 * rather than moved.
 */
async function allocateLinesToCertificate(client, certificateId, customerId, lineIds) {
    if (!Array.isArray(lineIds) || lineIds.length === 0) return 0;

    const { rows: lines } = await client.query(
        `SELECT wt_line_id, customer_id, certificate_id FROM withholding_tax_line WHERE wt_line_id = ANY($1) FOR UPDATE`,
        [lineIds]
    );
    if (lines.length !== lineIds.length) {
        throw new Error('One or more withholding lines no longer exist.');
    }
    const foreign = lines.filter(l => Number(l.customer_id) !== Number(customerId));
    if (foreign.length > 0) {
        throw new Error(`Withholding line(s) ${foreign.map(l => l.wt_line_id).join(', ')} belong to a different customer.`);
    }
    const claimed = lines.filter(l => l.certificate_id !== null && Number(l.certificate_id) !== Number(certificateId));
    if (claimed.length > 0) {
        throw new Error(`Withholding line(s) ${claimed.map(l => l.wt_line_id).join(', ')} are already covered by another certificate.`);
    }

    const { rowCount } = await client.query(
        'UPDATE withholding_tax_line SET certificate_id = $1 WHERE wt_line_id = ANY($2)',
        [certificateId, lineIds]
    );
    return rowCount;
}

router.put('/withholding/certificates/:id', protect, hasPermission('withholding_tax:manage'), async (req, res) => {
    const { id } = req.params;
    const {
        certificate_no, payor_tin, payor_registered_name, period_from, period_to,
        date_received, tax_base_total, tax_withheld_total, status, notes, line_ids,
    } = req.body;

    if (status && !['RECEIVED', 'CLAIMED', 'CANCELLED'].includes(status)) {
        return res.status(400).json({ message: 'status must be RECEIVED, CLAIMED or CANCELLED.' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const { rows: existing } = await client.query(
            'SELECT * FROM withholding_tax_certificate WHERE certificate_id = $1 FOR UPDATE', [id]
        );
        if (existing.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Certificate not found.' });
        }
        const current = existing[0];

        const { rows } = await client.query(`
            UPDATE withholding_tax_certificate SET
                certificate_no        = $1,
                payor_tin             = $2,
                payor_registered_name = $3,
                period_from           = $4,
                period_to             = $5,
                date_received         = $6,
                tax_base_total        = $7,
                tax_withheld_total    = $8,
                status                = $9,
                notes                 = $10
            WHERE certificate_id = $11
            RETURNING *
        `, [
            certificate_no !== undefined ? normalizeText(certificate_no) : current.certificate_no,
            payor_tin !== undefined ? normalizeTin(payor_tin) : current.payor_tin,
            payor_registered_name !== undefined ? normalizeText(payor_registered_name) : current.payor_registered_name,
            period_from !== undefined ? (period_from || null) : current.period_from,
            period_to !== undefined ? (period_to || null) : current.period_to,
            date_received !== undefined ? (date_received || null) : current.date_received,
            tax_base_total !== undefined ? round2(tax_base_total) : current.tax_base_total,
            tax_withheld_total !== undefined ? round2(tax_withheld_total) : current.tax_withheld_total,
            status || current.status,
            notes !== undefined ? normalizeText(notes) : current.notes,
            id,
        ]);

        // Cancelling releases the lines: the withholding still happened, it just has no
        // valid certificate again, so it must reappear on the chase list.
        if (status === 'CANCELLED') {
            await client.query('UPDATE withholding_tax_line SET certificate_id = NULL WHERE certificate_id = $1', [id]);
        } else if (Array.isArray(line_ids)) {
            await client.query('UPDATE withholding_tax_line SET certificate_id = NULL WHERE certificate_id = $1', [id]);
            await allocateLinesToCertificate(client, Number(id), current.customer_id, line_ids);
        }

        await client.query('COMMIT');
        res.json(rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === '23505') {
            return res.status(409).json({ message: 'A certificate with that number is already recorded for this customer.' });
        }
        console.error('Update withholding certificate error:', err.message);
        res.status(500).json({ message: err.message || 'Server error updating certificate.' });
    } finally {
        client.release();
    }
});

router.post('/withholding/certificates/:id/attachment', protect, hasPermission('withholding_tax:manage'),
    upload.single('attachment'), async (req, res) => {
        const { id } = req.params;
        if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
        if (!ALLOWED_ATTACHMENT_TYPES.includes(req.file.mimetype)) {
            return res.status(400).json({ message: `Unsupported file type '${req.file.mimetype}'. Upload a PDF or an image.` });
        }

        try {
            const { rows } = await db.query(`
                UPDATE withholding_tax_certificate
                SET attachment_data = $1, attachment_mime = $2, attachment_filename = $3, attachment_size = $4
                WHERE certificate_id = $5
                RETURNING certificate_id, attachment_filename, attachment_mime, attachment_size
            `, [req.file.buffer, req.file.mimetype, req.file.originalname, req.file.size, id]);

            if (rows.length === 0) return res.status(404).json({ message: 'Certificate not found.' });
            res.json(rows[0]);
        } catch (err) {
            console.error('Withholding attachment upload error:', err.message);
            res.status(500).json({ message: 'Server error saving attachment.', error: err.message });
        }
    });

router.get('/withholding/certificates/:id/attachment', protect, hasPermission(['withholding_tax:manage', 'ar:view']), async (req, res) => {
    const { id } = req.params;
    try {
        const { rows } = await db.query(
            'SELECT attachment_data, attachment_mime, attachment_filename FROM withholding_tax_certificate WHERE certificate_id = $1',
            [id]
        );
        if (rows.length === 0 || !rows[0].attachment_data) {
            return res.status(404).json({ message: 'No attachment on this certificate.' });
        }
        res.setHeader('Content-Type', rows[0].attachment_mime || 'application/octet-stream');
        // inline: the point of opening a certificate scan is to read it against the
        // figures on screen, not to collect files.
        res.setHeader('Content-Disposition', `inline; filename="${(rows[0].attachment_filename || 'certificate').replace(/"/g, '')}"`);
        res.send(rows[0].attachment_data);
    } catch (err) {
        console.error('Withholding attachment fetch error:', err.message);
        res.status(500).json({ message: 'Server error loading attachment.', error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Creditable withholding tax register
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/withholding/register?date_from=&date_to=&format=json|csv
 *
 * The quarterly register a bookkeeper keys into BIR's Alphalist Data Entry tool to
 * produce the SAWT. One row per customer per ATC code, which is the granularity the
 * alphalist itself works at -- a customer buying both goods and services appears
 * twice, under WC158 and WC160, because BIR treats those as separate line items.
 *
 * Deliberately not emitting a .dat file: the alphalist format is exacting, changes
 * with BIR issuances, and a silently malformed file fails at submission with no
 * useful diagnostic. A CSV a person checks and keys in is slower and far safer.
 *
 * Periodised on when the tax was withheld, not on the invoice date. The tax becomes
 * creditable when it is deducted, and a January collection against a December invoice
 * belongs in the first quarter.
 */
router.get('/withholding/register', protect, hasPermission(['withholding_tax:manage', 'ar:view']), async (req, res) => {
    const { date_from, date_to, format = 'json', customer_id } = req.query;

    if (!date_from || !date_to) {
        return res.status(400).json({ message: 'date_from and date_to are required.' });
    }

    const params = [date_from, date_to];
    let customerClause = '';
    if (customer_id) {
        params.push(customer_id);
        customerClause = `AND wtl.customer_id = $${params.length}`;
    }

    try {
        const { rows } = await db.query(`
            SELECT wtl.customer_id,
                   COALESCE(NULLIF(c.registered_name, ''), NULLIF(c.company_name, ''),
                            TRIM(c.first_name || ' ' || COALESCE(c.last_name, ''))) AS payor_name,
                   c.tin                                       AS payor_tin,
                   c.customer_type,
                   wtl.atc_code,
                   wtl.withholding_type,
                   wtl.treatment,
                   MAX(wtl.rate_snapshot)                      AS rate,
                   SUM(wtl.tax_base)                           AS tax_base,
                   SUM(wtl.actual_withheld)                    AS tax_withheld,
                   COUNT(DISTINCT wtl.invoice_id)::int         AS invoice_count,
                   COUNT(*) FILTER (WHERE wtl.certificate_id IS NOT NULL)::int AS substantiated_lines,
                   COUNT(*)::int                               AS total_lines,
                   SUM(wtl.actual_withheld) FILTER (WHERE wtl.certificate_id IS NOT NULL) AS substantiated_withheld,
                   STRING_AGG(DISTINCT wtc.certificate_no, '; ') FILTER (WHERE wtc.certificate_no IS NOT NULL) AS certificate_nos
            FROM withholding_tax_line wtl
            JOIN customer c ON c.customer_id = wtl.customer_id
            LEFT JOIN withholding_tax_certificate wtc
                   ON wtc.certificate_id = wtl.certificate_id AND wtc.status <> 'CANCELLED'
            WHERE (wtl.created_at AT TIME ZONE 'Asia/Manila')::date BETWEEN $1 AND $2
              ${customerClause}
            GROUP BY wtl.customer_id, c.registered_name, c.company_name, c.first_name, c.last_name,
                     c.tin, c.customer_type, wtl.atc_code, wtl.withholding_type, wtl.treatment
            ORDER BY payor_name, wtl.atc_code
        `, params);

        if (format === 'csv') {
            const header = [
                'Payor TIN', 'Payor Name', 'Customer Type', 'ATC Code', 'Withholding Type',
                'Treatment', 'Rate %', 'Tax Base', 'Tax Withheld', 'Invoices',
                'Substantiated Withheld', 'Unsubstantiated Withheld', 'Certificate Nos',
            ];
            const body = rows.map(r => csvRow([
                r.payor_tin || '',
                r.payor_name || '',
                r.customer_type,
                r.atc_code || '',
                r.withholding_type,
                r.treatment,
                (Number(r.rate) * 100).toFixed(2),
                Number(r.tax_base).toFixed(2),
                Number(r.tax_withheld).toFixed(2),
                r.invoice_count,
                Number(r.substantiated_withheld || 0).toFixed(2),
                round2(Number(r.tax_withheld) - Number(r.substantiated_withheld || 0)).toFixed(2),
                r.certificate_nos || '',
            ]));

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="cwt-register-${date_from}-to-${date_to}.csv"`);
            return res.send([csvRow(header), ...body].join('\n'));
        }

        const totals = rows.reduce((acc, r) => ({
            tax_base: round2(acc.tax_base + Number(r.tax_base)),
            tax_withheld: round2(acc.tax_withheld + Number(r.tax_withheld)),
            substantiated_withheld: round2(acc.substantiated_withheld + Number(r.substantiated_withheld || 0)),
        }), { tax_base: 0, tax_withheld: 0, substantiated_withheld: 0 });

        res.json({
            data: rows,
            totals: {
                ...totals,
                unsubstantiated_withheld: round2(totals.tax_withheld - totals.substantiated_withheld),
            },
            filters: { date_from, date_to, customer_id: customer_id || null },
            generated_at: new Date().toISOString(),
        });
    } catch (err) {
        console.error('Withholding register error:', err.message);
        res.status(500).json({ message: 'Server error building the withholding register.', error: err.message });
    }
});

module.exports = router;
