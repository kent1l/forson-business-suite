const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const { amountToWords, renderChequeHtml } = require('../helpers/chequeFormatter');
const { generateChequePdfBuffer, generateChequePdfFile } = require('../helpers/pdf/chequePdf');

const router = express.Router();

const parseNumber = (value, fallback = 0) => {
  if (value === null || value === undefined || value === '') return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const coerceBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (['true', '1', 'yes', 'on'].includes(value.toLowerCase())) return true;
    if (['false', '0', 'no', 'off'].includes(value.toLowerCase())) return false;
  }
  if (typeof value === 'number') return value !== 0;
  return fallback;
};

const ensureAnyPermission = (permissions) => (req, res, next) => {
  if (!req.user) {
    return res.status(403).json({ message: 'Forbidden: user context missing' });
  }
  const isAdmin = Number(req.user.permission_level_id) === 10;
  if (isAdmin) return next();
  const userPermissions = Array.isArray(req.user.permissions) ? req.user.permissions : [];
  if (userPermissions.some((perm) => permissions.includes(perm))) {
    return next();
  }
  return res.status(403).json({ message: 'Forbidden: You do not have the required permission.' });
};

const allowedElementKeys = new Set([
  'payee',
  'payee_name',
  'date',
  'cheque_date',
  'amount',
  'amount_numeric',
  'amount_words',
  'amountInWords',
  'memo',
  'cheque_number',
  'chequeNumber'
]);

const sanitizeElement = (element = {}) => {
  const key = String(element.key || '').trim();
  if (!allowedElementKeys.has(key)) {
    throw new Error(`Unsupported element key: ${key}`);
  }
  return {
    key,
    label: String(element.label || key).trim(),
    x_mm: parseNumber(element.x_mm, 0),
    y_mm: parseNumber(element.y_mm, 0),
    width_mm: parseNumber(element.width_mm, 40),
    height_mm: parseNumber(element.height_mm, 10),
    fontFamily: String(element.fontFamily || 'Arial, sans-serif'),
    fontSizePt: parseNumber(element.fontSizePt, 12),
    fontWeight: element.fontWeight === 'bold' ? 'bold' : 'normal',
    fontStyle: element.fontStyle === 'italic' ? 'italic' : 'normal',
    textTransform: ['uppercase', 'capitalize', 'lowercase'].includes(element.textTransform)
      ? element.textTransform
      : 'none',
    letterSpacing: parseNumber(element.letterSpacing, 0),
    textAlign: ['left', 'right', 'center', 'justify'].includes(element.textAlign)
      ? element.textAlign
      : 'left',
    lineHeight: parseNumber(element.lineHeight, 1.2),
    uppercase: coerceBoolean(element.uppercase, false),
    fallbackText: element.fallbackText ? String(element.fallbackText) : '',
    lockPosition: coerceBoolean(element.lockPosition, false)
  };
};

const sanitizeSettings = (settings = {}) => {
  if (typeof settings !== 'object' || settings === null) return {};
  const safe = {};
  if (settings.currencySymbol) safe.currencySymbol = String(settings.currencySymbol).slice(0, 8);
  if (settings.currencyLabel) safe.currencyLabel = String(settings.currencyLabel).slice(0, 64);
  if (settings.subCurrencyLabel) safe.subCurrencyLabel = String(settings.subCurrencyLabel).slice(0, 64);
  if (settings.amountWordsJoiner) safe.joiner = String(settings.amountWordsJoiner).slice(0, 32);
  if (settings.amountWordsSuffix) safe.suffix = String(settings.amountWordsSuffix).slice(0, 32);
  if (settings.dateFormat) safe.dateFormat = String(settings.dateFormat).slice(0, 64);
  if (settings.decimals !== undefined) safe.decimals = parseInt(settings.decimals, 10);
  if (settings.useThousandsSeparator !== undefined) safe.useThousandsSeparator = coerceBoolean(settings.useThousandsSeparator, true);
  if (settings.showCurrencyAfter !== undefined) safe.showCurrencyAfter = coerceBoolean(settings.showCurrencyAfter, false);
  if (settings.enforceUppercase !== undefined) safe.enforceUppercase = coerceBoolean(settings.enforceUppercase, true);
  if (settings.preserveCase !== undefined) safe.preserveCase = coerceBoolean(settings.preserveCase, false);
  if (settings.printBackground !== undefined) safe.printBackground = coerceBoolean(settings.printBackground, true);
  return safe;
};

const buildTemplatePayload = (body = {}, existing = {}) => {
  const name = String(body.template_name || body.templateName || existing.template_name || '').trim();
  if (!name) {
    throw new Error('Template name is required');
  }
  const paperWidthMm = parseNumber(body.paper_width_mm ?? body.paperWidthMm, existing.paper_width_mm || 203.2);
  const paperHeightMm = parseNumber(body.paper_height_mm ?? body.paperHeightMm, existing.paper_height_mm || 92.08);
  const dpi = parseInt(body.dpi ?? existing.dpi ?? 300, 10);
  if (!Array.isArray(body.elements) && !Array.isArray(existing.elements)) {
    throw new Error('Template elements are required');
  }
  const elementsRaw = Array.isArray(body.elements) ? body.elements : existing.elements;
  const elements = elementsRaw.map(sanitizeElement);
  const settings = sanitizeSettings(body.settings || existing.settings || {});

  return {
    template_name: name,
    description: body.description ? String(body.description) : existing.description || null,
    paper_width_mm: paperWidthMm,
    paper_height_mm: paperHeightMm,
    dpi: Number.isFinite(dpi) && dpi > 0 ? dpi : 300,
    margin_top_mm: parseNumber(body.margin_top_mm ?? body.marginTopMm, existing.margin_top_mm || 0),
    margin_left_mm: parseNumber(body.margin_left_mm ?? body.marginLeftMm, existing.margin_left_mm || 0),
    elements,
    settings,
    is_default: coerceBoolean(body.is_default ?? existing.is_default ?? false),
    is_archived: coerceBoolean(body.is_archived ?? existing.is_archived ?? false)
  };
};

const amountOptionsFromSettings = (settings = {}) => ({
  currencyLabel: settings.currencyLabel || 'Pesos',
  subCurrencyLabel: settings.subCurrencyLabel || 'Centavos',
  joiner: settings.joiner || settings.amountWordsJoiner || 'and',
  suffix: settings.suffix || settings.amountWordsSuffix || 'ONLY',
  enforceUppercase: settings.enforceUppercase !== false,
  preserveCase: settings.preserveCase === true
});

const getEmployeeId = (req) => {
  const id = req.user && req.user.employee_id;
  if (!id) return null;
  const numeric = Number(id);
  return Number.isNaN(numeric) ? null : numeric;
};

router.get('/cheque-templates', protect, ensureAnyPermission(['cheque:print', 'cheque:template_manage']), async (req, res) => {
  try {
    const includeArchived = coerceBoolean(req.query.includeArchived, false);
    const { rows } = await db.query(
      `SELECT template_id, template_name, description, paper_width_mm, paper_height_mm, dpi, margin_top_mm, margin_left_mm,
              settings, elements, is_default, is_archived, version, created_at, created_by, updated_at, updated_by
       FROM cheque_templates
       WHERE ($1::boolean IS TRUE) OR is_archived = FALSE
       ORDER BY is_default DESC, template_name ASC`,
      [includeArchived]
    );
    res.json(rows);
  } catch (error) {
    console.error('[cheque][templates:list] error', error);
    res.status(500).json({ message: 'Failed to fetch cheque templates.' });
  }
});

router.get('/cheque-templates/:id', protect, ensureAnyPermission(['cheque:print', 'cheque:template_manage']), async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await db.query('SELECT * FROM cheque_templates WHERE template_id = $1', [id]);
    if (!rows.length) {
      return res.status(404).json({ message: 'Cheque template not found.' });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error('[cheque][templates:get] error', error);
    res.status(500).json({ message: 'Failed to fetch cheque template.' });
  }
});

router.post('/cheque-templates', protect, hasPermission('cheque:template_manage'), async (req, res) => {
  try {
    const payload = buildTemplatePayload(req.body || {});
    const employeeId = getEmployeeId(req);
    const insertQuery = `
      INSERT INTO cheque_templates (
        template_name, description, paper_width_mm, paper_height_mm, dpi,
        margin_top_mm, margin_left_mm, settings, elements, is_default, is_archived, version,
        created_by, updated_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
      RETURNING *;
    `;
    const params = [
      payload.template_name,
      payload.description,
      payload.paper_width_mm,
      payload.paper_height_mm,
      payload.dpi,
      payload.margin_top_mm,
      payload.margin_left_mm,
      JSON.stringify(payload.settings),
      JSON.stringify(payload.elements),
      payload.is_default,
      payload.is_archived,
      1,
      employeeId
    ];
    const { rows } = await db.query(insertQuery, params);
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('[cheque][templates:create] error', error);
    res.status(400).json({ message: error.message || 'Failed to create cheque template.' });
  }
});

router.put('/cheque-templates/:id', protect, hasPermission('cheque:template_manage'), async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const existing = await client.query('SELECT * FROM cheque_templates WHERE template_id = $1 FOR UPDATE', [id]);
    if (!existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Cheque template not found.' });
    }

    const payload = buildTemplatePayload(req.body || {}, existing.rows[0]);
    const employeeId = getEmployeeId(req);
    const updateQuery = `
      UPDATE cheque_templates
      SET template_name = $1,
          description = $2,
          paper_width_mm = $3,
          paper_height_mm = $4,
          dpi = $5,
          margin_top_mm = $6,
          margin_left_mm = $7,
          settings = $8::jsonb,
          elements = $9::jsonb,
          is_default = $10,
          is_archived = $11,
          version = version + 1,
          updated_at = CURRENT_TIMESTAMP,
          updated_by = $12
      WHERE template_id = $13
      RETURNING *;
    `;
    const params = [
      payload.template_name,
      payload.description,
      payload.paper_width_mm,
      payload.paper_height_mm,
      payload.dpi,
      payload.margin_top_mm,
      payload.margin_left_mm,
      JSON.stringify(payload.settings),
      JSON.stringify(payload.elements),
      payload.is_default,
      payload.is_archived,
      employeeId,
      id
    ];
    const { rows } = await client.query(updateQuery, params);
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('[cheque][templates:update] rollback error', rollbackError);
      }
    console.error('[cheque][templates:update] error', error);
    res.status(400).json({ message: error.message || 'Failed to update cheque template.' });
  } finally {
    client.release();
  }
});

router.delete('/cheque-templates/:id', protect, hasPermission('cheque:template_manage'), async (req, res) => {
  try {
    const { id } = req.params;
    const employeeId = getEmployeeId(req);
    const { rowCount } = await db.query(
      `UPDATE cheque_templates
       SET is_archived = TRUE,
           updated_at = CURRENT_TIMESTAMP,
           updated_by = $2
       WHERE template_id = $1`,
      [id, employeeId]
    );
    if (!rowCount) {
      return res.status(404).json({ message: 'Cheque template not found.' });
    }
    res.json({ message: 'Template archived.' });
  } catch (error) {
    console.error('[cheque][templates:delete] error', error);
    res.status(500).json({ message: 'Failed to archive cheque template.' });
  }
});

router.post('/cheque-templates/:id/preview', protect, ensureAnyPermission(['cheque:print', 'cheque:template_manage']), async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await db.query('SELECT * FROM cheque_templates WHERE template_id = $1', [id]);
    if (!rows.length) {
      return res.status(404).json({ message: 'Cheque template not found.' });
    }
    const template = rows[0];
    const samplePayload = {
      payee_name: 'Sample Payee',
      cheque_date: new Date().toISOString().slice(0, 10),
      amount_numeric: 12345.67,
      amount_in_words: amountToWords(12345.67, amountOptionsFromSettings(template.settings)),
      memo: 'Sample memo',
      cheque_number: '0000001'
    };
    const html = renderChequeHtml(template, samplePayload);
    const buffer = await generateChequePdfBuffer({
      html,
      paperWidthMm: template.paper_width_mm,
      paperHeightMm: template.paper_height_mm
    });
    res.json({
      html,
      pdf: buffer.toString('base64'),
      pdfMimeType: 'application/pdf'
    });
  } catch (error) {
    console.error('[cheque][templates:preview] error', error);
    res.status(500).json({ message: 'Failed to generate template preview.' });
  }
});

router.post('/cheque-prints', protect, hasPermission('cheque:print'), async (req, res) => {
  const client = await db.getClient();
  try {
    const {
      templateId,
      payeeName,
      chequeDate,
      amount,
      memo,
      chequeNumber,
      amountWordsOverride
    } = req.body || {};

    if (!templateId) {
      return res.status(400).json({ message: 'templateId is required' });
    }
    if (!payeeName || !payeeName.trim()) {
      return res.status(400).json({ message: 'payeeName is required' });
    }
    if (!chequeDate) {
      return res.status(400).json({ message: 'chequeDate is required' });
    }
    const amountNumeric = parseNumber(amount, NaN);
    if (!Number.isFinite(amountNumeric)) {
      return res.status(400).json({ message: 'amount must be a valid number' });
    }

    await client.query('BEGIN');
    const templateRes = await client.query('SELECT * FROM cheque_templates WHERE template_id = $1 AND is_archived = FALSE FOR UPDATE', [templateId]);
    if (!templateRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Cheque template not found or archived.' });
    }
    const template = templateRes.rows[0];
    const amountWords = amountWordsOverride && amountWordsOverride.trim().length
      ? amountWordsOverride.trim()
      : amountToWords(amountNumeric, amountOptionsFromSettings(template.settings));

    const payload = {
      payee_name: payeeName.trim(),
      cheque_date: chequeDate,
      amount_numeric: amountNumeric,
      amount_in_words: amountWords,
      memo: memo ? String(memo) : '',
      cheque_number: chequeNumber ? String(chequeNumber) : null
    };

    const html = renderChequeHtml(template, payload);
    let pdfBuffer = null;
    try {
      pdfBuffer = await generateChequePdfBuffer({
        html,
        paperWidthMm: template.paper_width_mm,
        paperHeightMm: template.paper_height_mm
      });
    } catch (pdfError) {
      console.error('[cheque][prints:create] pdf generation failed', pdfError);
      // continue without PDF buffer but inform caller
    }

    const checksum = pdfBuffer
      ? crypto.createHash('sha256').update(pdfBuffer).digest('hex')
      : crypto.createHash('sha256').update(html).digest('hex');

    const employeeId = getEmployeeId(req);
    const insertQuery = `
      INSERT INTO cheque_prints (
        template_id, cheque_number, payee_name, cheque_date,
        amount_numeric, amount_in_words, memo, payload, status,
        pdf_checksum, printed_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)
      RETURNING *;
    `;
    const insertParams = [
      templateId,
      payload.cheque_number,
      payload.payee_name,
      payload.cheque_date,
      payload.amount_numeric,
      payload.amount_in_words,
      payload.memo || null,
      JSON.stringify(payload),
      'printed',
      checksum,
      employeeId
    ];
    const { rows } = await client.query(insertQuery, insertParams);
    const record = rows[0];
    await client.query('COMMIT');

    res.status(201).json({
      chequePrint: record,
      previewHtml: html,
      pdf: pdfBuffer ? pdfBuffer.toString('base64') : null,
      pdfMimeType: pdfBuffer ? 'application/pdf' : null,
      pdfAvailable: Boolean(pdfBuffer)
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[cheque][prints:create] error', error);
    res.status(500).json({ message: 'Failed to create cheque print record.' });
  } finally {
    client.release();
  }
});

router.get('/cheque-prints', protect, hasPermission('cheque:records_view'), async (req, res) => {
  try {
    const { status, search, fromDate, toDate } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10) || 50, 1), 200);
    const params = [];
    const conditions = [];

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`payee_name ILIKE $${params.length}`);
    }
    if (fromDate) {
      params.push(fromDate);
      conditions.push(`cheque_date >= $${params.length}`);
    }
    if (toDate) {
      params.push(toDate);
      conditions.push(`cheque_date <= $${params.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit);

    const query = `
      SELECT cp.*, ct.template_name
      FROM cheque_prints cp
      JOIN cheque_templates ct ON ct.template_id = cp.template_id
      ${whereClause}
      ORDER BY cp.printed_at DESC
      LIMIT $${params.length};
    `;

    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error('[cheque][prints:list] error', error);
    res.status(500).json({ message: 'Failed to fetch cheque prints.' });
  }
});

router.get('/cheque-prints/:id', protect, hasPermission('cheque:records_view'), async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await db.query(
      `SELECT cp.*, ct.template_name, ct.settings, ct.elements, ct.paper_width_mm, ct.paper_height_mm, ct.dpi
       FROM cheque_prints cp
       JOIN cheque_templates ct ON ct.template_id = cp.template_id
       WHERE cp.cheque_print_id = $1`,
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ message: 'Cheque print not found.' });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error('[cheque][prints:get] error', error);
    res.status(500).json({ message: 'Failed to retrieve cheque print.' });
  }
});

router.post('/cheque-prints/:id/void', protect, hasPermission('cheque:records_view'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    const employeeId = getEmployeeId(req);
    const { rows } = await db.query(
      `UPDATE cheque_prints
       SET status = 'voided',
           void_reason = $2,
           voided_at = CURRENT_TIMESTAMP,
           voided_by = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE cheque_print_id = $1
       RETURNING *;`,
      [id, reason ? String(reason) : null, employeeId]
    );
    if (!rows.length) {
      return res.status(404).json({ message: 'Cheque print not found.' });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error('[cheque][prints:void] error', error);
    res.status(500).json({ message: 'Failed to void cheque print.' });
  }
});

router.get('/cheque-prints/:id/preview', protect, ensureAnyPermission(['cheque:print', 'cheque:records_view']), async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await db.query(
      `SELECT cp.*, ct.settings, ct.elements, ct.paper_width_mm, ct.paper_height_mm, ct.dpi, ct.margin_top_mm, ct.margin_left_mm
       FROM cheque_prints cp
       JOIN cheque_templates ct ON ct.template_id = cp.template_id
       WHERE cheque_print_id = $1`,
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ message: 'Cheque print not found.' });
    }
    const record = rows[0];
    const html = renderChequeHtml(record, {
      payee_name: record.payee_name,
      cheque_date: record.cheque_date,
      amount_numeric: record.amount_numeric,
      amount_in_words: record.amount_in_words,
      memo: record.memo,
      cheque_number: record.cheque_number
    });
    res.json({ html });
  } catch (error) {
    console.error('[cheque][prints:preview] error', error);
    res.status(500).json({ message: 'Failed to generate cheque preview.' });
  }
});

router.get('/cheque-prints/:id/pdf', protect, ensureAnyPermission(['cheque:print', 'cheque:records_view']), async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await db.query(
      `SELECT cp.*, ct.settings, ct.elements, ct.paper_width_mm, ct.paper_height_mm, ct.dpi, ct.margin_top_mm, ct.margin_left_mm, ct.template_name
       FROM cheque_prints cp
       JOIN cheque_templates ct ON ct.template_id = cp.template_id
       WHERE cheque_print_id = $1`,
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ message: 'Cheque print not found.' });
    }
    const record = rows[0];
    const html = renderChequeHtml(record, {
      payee_name: record.payee_name,
      cheque_date: record.cheque_date,
      amount_numeric: record.amount_numeric,
      amount_in_words: record.amount_in_words,
      memo: record.memo,
      cheque_number: record.cheque_number
    });

    const { buffer, fullPath } = await generateChequePdfFile({
      html,
      paperWidthMm: record.paper_width_mm,
      paperHeightMm: record.paper_height_mm,
      fileName: `${record.template_name || 'cheque'}_${record.cheque_number || record.cheque_print_id}`
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${(record.cheque_number || record.cheque_print_id)}.pdf"`);
    res.send(buffer);

    // Clean up temp file asynchronously
    if (fullPath) {
      const fs = require('fs');
      fs.unlink(fullPath, () => {});
    }
  } catch (error) {
    console.error('[cheque][prints:pdf] error', error);
    res.status(500).json({ message: 'Failed to generate cheque PDF.' });
  }
});

module.exports = router;
