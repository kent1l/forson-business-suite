const { amountToWords } = require('../chequeAmountWords');
let PDFDocument;
let StandardFonts;
try {
    ({ PDFDocument, StandardFonts } = require('pdf-lib'));
} catch (_error) {
    PDFDocument = null;
    StandardFonts = null;
}

const LETTER = { width: 612, height: 792 };

function resolveAlignedX({
    text,
    x,
    alignment = 'left',
    font,
    fontSize,
    maxWidth
}) {
    const width = font.widthOfTextAtSize(String(text || ''), fontSize);
    if (alignment === 'right') return x - width;
    if (alignment === 'center') return x - (width / 2);
    if (typeof maxWidth === 'number' && Number.isFinite(maxWidth) && maxWidth > 0) return x;
    return x;
}

function fitFontSize({
    text,
    font,
    preferredSize,
    maxWidth,
    minFontSize = 8
}) {
    const content = String(text || '');
    if (!content || !maxWidth || !Number.isFinite(maxWidth)) return preferredSize;

    let size = preferredSize;
    while (size > minFontSize && font.widthOfTextAtSize(content, size) > maxWidth) {
        size -= 0.25;
    }
    return Math.max(size, minFontSize);
}

function createFallbackPdf({ rows, template, xOffset, yOffset, testPrint }) {
    const positions = template?.field_positions || {};
    const currencySettings = template?.currency_settings || { enabled: true, label: 'USD' };
    const pages = rows.map((row) => {
        const amountWords = amountToWords(row.amount);
        const words = template?.amount_format === 'upper' ? amountWords.toUpperCase() : amountWords;
        const drawText = (text, cfg, fallback) => {
            const x = Number(cfg?.x ?? fallback.x) + xOffset;
            const y = Number(cfg?.y ?? fallback.y) + yOffset;
            const size = Number(cfg?.fontSize ?? fallback.fontSize);
            const escapedText = String(text || '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
            return `BT /F1 ${size} Tf ${x} ${y} Td (${escapedText}) Tj ET`;
        };
        const lines = [
            drawText(row.date, positions.date, { x: 430, y: 700, fontSize: 11 }),
            drawText(row.payee, positions.payee, { x: 90, y: 655, fontSize: 12 }),
            drawText(row.amount, positions.amountNumeric, { x: 490, y: 655, fontSize: 12 }),
            drawText(words, positions.amountWords, { x: 90, y: 625, fontSize: 11 }),
            drawText(row.memo || '', positions.memo, { x: 90, y: 585, fontSize: 10 })
        ];
        if (currencySettings.enabled !== false) {
            lines.push(drawText(currencySettings.label || 'USD', positions.currency, { x: 515, y: 655, fontSize: 11 }));
        }
        if (testPrint) {
            lines.push(drawText('*** TEST PRINT ***', { x: 220, y: 760, fontSize: 11 }, { x: 220, y: 760, fontSize: 11 }));
        }
        return lines;
    });

    let output = '%PDF-1.4\n';
    const objects = [];
    const addObject = (body) => {
        const id = objects.length + 1;
        objects.push({ id, body });
        return id;
    };
    const pageIds = [];
    for (const lines of pages) {
        const stream = lines.join('\n');
        const contentId = addObject(`<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`);
        const pageId = addObject(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${LETTER.width} ${LETTER.height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
        pageIds.push(pageId);
    }
    objects.unshift({ id: 3, body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' });
    objects.unshift({ id: 2, body: `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>` });
    objects.unshift({ id: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' });
    objects.sort((a, b) => a.id - b.id);

    const offsets = [];
    for (const obj of objects) {
        offsets[obj.id] = Buffer.byteLength(output, 'utf8');
        output += `${obj.id} 0 obj\n${obj.body}\nendobj\n`;
    }
    const xrefOffset = Buffer.byteLength(output, 'utf8');
    output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i += 1) {
        output += `${String(offsets[i] || 0).padStart(10, '0')} 00000 n \n`;
    }
    output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return Buffer.from(output, 'utf8');
}

async function createChequePdf({ rows, template, printerProfile = { offset_x: 0, offset_y: 0 }, testPrint = false }) {
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error('At least one cheque row is required');
    }

    const positions = template?.field_positions || {};
    const currencySettings = template?.currency_settings || { enabled: true, label: 'USD' };
    const xOffset = Number(printerProfile.offset_x || 0);
    const yOffset = Number(printerProfile.offset_y || 0);

    if (!PDFDocument || !StandardFonts) {
        return {
            buffer: createFallbackPdf({ rows, template, xOffset, yOffset, testPrint }),
            renderer: 'fallback',
            warning: 'pdf-lib unavailable; fallback renderer used'
        };
    }

    try {
        const pdfDoc = await PDFDocument.create();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

        rows.forEach((row) => {
            const page = pdfDoc.addPage([LETTER.width, LETTER.height]);
            const amountWords = amountToWords(row.amount);
            const words = template?.amount_format === 'upper' ? amountWords.toUpperCase() : amountWords;

        const drawText = (text, cfg, fallback) => {
            const baseX = Number(cfg?.x ?? fallback.x) + xOffset;
            const y = Number(cfg?.y ?? fallback.y) + yOffset;
            const preferredSize = Number(cfg?.fontSize ?? fallback.fontSize);
            const minFontSize = Number(cfg?.minFontSize ?? fallback.minFontSize ?? 8);
            const maxWidth = Number(cfg?.maxWidth ?? fallback.maxWidth ?? NaN);
            const alignment = cfg?.alignment ?? fallback.alignment ?? 'left';
            const renderedSize = fitFontSize({
                text,
                font,
                preferredSize,
                maxWidth,
                minFontSize
            });
            const x = resolveAlignedX({
                text,
                x: baseX,
                alignment,
                font,
                fontSize: renderedSize,
                maxWidth
            });
            page.drawText(String(text || ''), { x, y, size: renderedSize, font, characterSpacing: Number(cfg?.charSpacing ?? fallback.charSpacing ?? 0) });
        };

        const drawBoxedDate = (text, cfg, fallback) => {
            const content = String(text || '');
            const x = Number(cfg?.x ?? fallback.x) + xOffset;
            const y = Number(cfg?.y ?? fallback.y) + yOffset;
            const size = Number(cfg?.fontSize ?? fallback.fontSize);
            const spacing = Number(cfg?.charSpacing ?? fallback.charSpacing ?? 14);
            content.split('').forEach((char, index) => {
                page.drawText(char, { x: x + (index * spacing), y, size, font });
            });
        };

        const dateCfg = positions.date || {};
        if (dateCfg.mode === 'boxed') {
            drawBoxedDate(row.date, dateCfg, { x: 430, y: 700, fontSize: 11, charSpacing: 14 });
        } else {
            drawText(row.date, dateCfg, { x: 430, y: 700, fontSize: 11, alignment: 'left', charSpacing: 0 });
        }
        drawText(row.payee, positions.payee, { x: 90, y: 655, fontSize: 12, alignment: 'left', maxWidth: 380, minFontSize: 8 });
        drawText(row.amount, positions.amountNumeric, { x: 490, y: 655, fontSize: 12, alignment: 'right' });
        drawText(words, positions.amountWords, { x: 90, y: 625, fontSize: 11, alignment: 'left', maxWidth: 420, minFontSize: 8 });
        drawText(row.memo || '', positions.memo, { x: 90, y: 585, fontSize: 10, alignment: 'left', maxWidth: 220, minFontSize: 8 });

        if (currencySettings.enabled !== false) {
            drawText(currencySettings.label || 'USD', positions.currency, { x: 515, y: 655, fontSize: 11, alignment: 'left' });
        }
        if (testPrint) {
            page.drawText('*** TEST PRINT ***', { x: 220, y: 760, size: 11, font });
        }
        });

        const bytes = await pdfDoc.save();
        return { buffer: Buffer.from(bytes), renderer: 'pdf-lib', warning: null };
    } catch (error) {
        return {
            buffer: createFallbackPdf({ rows, template, xOffset, yOffset, testPrint }),
            renderer: 'fallback',
            warning: `pdf-lib failed (${error.message || 'unknown error'}); fallback renderer used`
        };
    }
}

module.exports = { createChequePdf };
