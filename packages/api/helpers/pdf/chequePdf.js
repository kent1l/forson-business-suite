const { amountToWords } = require('../chequeAmountWords');

const LETTER = { width: 612, height: 792 };

function escapePdfText(input) {
    return String(input || '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildPdfObjects(pages) {
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

    return objects.sort((a, b) => a.id - b.id);
}

function createChequePdf({ rows, template, printerProfile = { offset_x: 0, offset_y: 0 } }) {
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error('At least one cheque row is required');
    }

    const positions = template?.field_positions || {};
    const currencySettings = template?.currency_settings || { enabled: true, label: 'USD' };
    const xOffset = Number(printerProfile.offset_x || 0);
    const yOffset = Number(printerProfile.offset_y || 0);

    const pages = rows.map((row) => {
        const amountWords = amountToWords(row.amount);
        const words = template?.amount_format === 'upper' ? amountWords.toUpperCase() : amountWords;

        const drawText = (text, cfg, fallback) => {
            const x = Number(cfg?.x ?? fallback.x) + xOffset;
            const y = Number(cfg?.y ?? fallback.y) + yOffset;
            const size = Number(cfg?.fontSize ?? fallback.fontSize);
            return `BT /F1 ${size} Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET`;
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

        return lines;
    });

    let output = '%PDF-1.4\n';
    const offsets = [];
    const objects = buildPdfObjects(pages);

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

module.exports = { createChequePdf };
