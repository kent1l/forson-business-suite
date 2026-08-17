const { amountToWords } = require('../chequeAmountWords');
let PDFDocument;
let StandardFonts;
try {
    ({ PDFDocument, StandardFonts } = require('pdf-lib'));
} catch {
    PDFDocument = null;
    StandardFonts = null;
}

const DEFAULT_PAPER = { width: 576, height: 216 }; // 8in x 3in @ 72 DPI

// Standard Helvetica AFM widths (1/1000 em) so the fallback (no pdf-lib) renderer
// can approximate the same shrink-to-fit and alignment behavior as the primary
// pdf-lib renderer instead of drawing raw, unaligned, non-shrinking text.
const HELVETICA_WIDTHS = {
    ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, "'": 191,
    '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
    '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556, '8': 556, '9': 556,
    ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
    A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
    '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
    a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
    '{': 334, '|': 260, '}': 334, '~': 584
};
const HELVETICA_DEFAULT_WIDTH = 556;

function estimateTextWidth(text, fontSize) {
    const content = String(text || '');
    let units = 0;
    for (const char of content) {
        units += HELVETICA_WIDTHS[char] ?? HELVETICA_DEFAULT_WIDTH;
    }
    return (units / 1000) * fontSize;
}

function estimateFitFontSize({ text, preferredSize, maxWidth, minFontSize = 8 }) {
    const content = String(text || '');
    if (!content || !maxWidth || !Number.isFinite(maxWidth)) return { size: preferredSize, overflowed: false };
    let size = preferredSize;
    while (size > minFontSize && estimateTextWidth(content, size) > maxWidth) {
        size -= 0.25;
    }
    const finalSize = Math.max(size, minFontSize);
    return { size: finalSize, overflowed: estimateTextWidth(content, finalSize) > maxWidth };
}

function estimateAlignedX({ text, x, alignment = 'left', fontSize }) {
    const width = estimateTextWidth(text, fontSize);
    if (alignment === 'right') return x - width;
    if (alignment === 'center') return x - (width / 2);
    return x;
}

function applyEndFiller(text, filler, enabled) {
    const content = String(text || '').trim();
    if (!enabled) return content;
    const token = String(filler || '').trim();
    if (!token || !content) return content;
    return `${token} ${content} ${token}`;
}

function resolvePaperSize(paperSettings = {}) {
    const widthIn = Number(paperSettings.widthIn);
    const heightIn = Number(paperSettings.heightIn);
    const width = Number.isFinite(widthIn) && widthIn > 0 ? widthIn * 72 : DEFAULT_PAPER.width;
    const height = Number.isFinite(heightIn) && heightIn > 0 ? heightIn * 72 : DEFAULT_PAPER.height;
    return { width, height };
}

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
    if (!content || !maxWidth || !Number.isFinite(maxWidth)) return { size: preferredSize, overflowed: false };

    let size = preferredSize;
    while (size > minFontSize && font.widthOfTextAtSize(content, size) > maxWidth) {
        size -= 0.25;
    }
    const finalSize = Math.max(size, minFontSize);
    return { size: finalSize, overflowed: font.widthOfTextAtSize(content, finalSize) > maxWidth };
}

function toPdfLibSafeText(text, font) {
    const content = String(text || '');
    try {
        font.encodeText(content);
        return content;
    } catch {
        return Array.from(content).map((char) => {
            try {
                font.encodeText(char);
                return char;
            } catch {
                return '?';
            }
        }).join('');
    }
}

function formatNumericAmount(amount) {
    if (amount === null || amount === undefined || amount === '') return '0.00';
    const cleaned = String(amount).replace(/[^0-9.-]/g, '');
    const num = Number(cleaned);
    if (Number.isNaN(num)) return '0.00';
    return num.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function createFallbackPdf({ rows, template, xOffset, yOffset, testPrint, isLetterFeed, overflowWarnings = [] }) {
    const positions = template?.field_positions || {};
    const currencySettings = template?.currency_settings || { enabled: true, label: '₱' };
    const amountWordsSettings = template?.amount_words_settings || { suffix: 'pesos' };
    const textSettings = template?.text_settings || {};
    const paperSize = resolvePaperSize(template?.paper_settings);
    const pageWidth = isLetterFeed ? 612 : paperSize.width;
    const pageHeight = isLetterFeed ? 792 : paperSize.height;
    const pages = rows.map((row, rowIndex) => {
        const amountWords = amountToWords(row.amount, { suffix: amountWordsSettings?.suffix || 'pesos' });
        const words = template?.amount_format === 'upper' ? amountWords.toUpperCase() : amountWords;
        const amountWordsText = applyEndFiller(words, textSettings?.amountWordsFiller, textSettings?.amountWordsFillerEnabled);
        const payeeText = applyEndFiller(row.payee, textSettings?.payeeFiller, textSettings?.payeeFillerEnabled);
        const formattedAmount = formatNumericAmount(row.amount);
        const drawText = (text, cfg, fallback, fieldLabel) => {
            const content = String(text || '');
            const baseX = Number(cfg?.x ?? fallback.x) + xOffset;
            const y = Number(cfg?.y ?? fallback.y) + yOffset;
            const preferredSize = Number(cfg?.fontSize ?? fallback.fontSize);
            const minFontSize = Number(cfg?.minFontSize ?? fallback.minFontSize ?? 8);
            const maxWidth = Number(cfg?.maxWidth ?? fallback.maxWidth ?? NaN);
            const alignment = cfg?.alignment ?? fallback.alignment ?? 'left';
            const { size, overflowed } = estimateFitFontSize({ text: content, preferredSize, maxWidth, minFontSize });
            if (overflowed && fieldLabel) {
                overflowWarnings.push(`Row ${rowIndex + 1} ${fieldLabel} text may not fit at minimum font size`);
            }
            const x = estimateAlignedX({ text: content, x: baseX, alignment, fontSize: size });
            const escapedText = content.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
            return `BT /F1 ${size} Tf ${x} ${y} Td (${escapedText}) Tj ET`;
        };
        const lines = [
            drawText(row.date, positions.date, { x: 426, y: 178, fontSize: 11 }, null),
            drawText(payeeText, positions.payee, { x: 72, y: 136, fontSize: 12, maxWidth: 380, minFontSize: 8 }, 'payee'),
            drawText(formattedAmount, positions.amountNumeric, { x: 534, y: 136, fontSize: 12, alignment: 'right' }, null),
            drawText(amountWordsText, positions.amountWords, { x: 72, y: 104, fontSize: 11, maxWidth: 420, minFontSize: 8 }, 'amount-in-words')
        ];
        if (currencySettings.enabled !== false) {
            lines.push(drawText(currencySettings.label || '₱', positions.currency, { x: 474, y: 136, fontSize: 11 }, null));
        }
        if (testPrint) {
            lines.push(drawText('*** TEST PRINT ***', { x: 220, y: 198, fontSize: 11 }, { x: 220, y: 198, fontSize: 11 }, null));
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
        const pageId = addObject(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
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
    const currencySettings = template?.currency_settings || { enabled: true, label: '₱' };
    const amountWordsSettings = template?.amount_words_settings || { suffix: 'pesos' };
    const textSettings = template?.text_settings || {};
    const paperSize = resolvePaperSize(template?.paper_settings);
    const feedType = String(printerProfile?.feed_type || 'native');
    const isLetterFeed = ['letter_center', 'letter_left', 'letter_right'].includes(feedType);
    const baseYOffset = isLetterFeed ? (792 - paperSize.height) : 0;
    const baseXOffset = feedType === 'letter_center'
        ? ((612 - paperSize.width) / 2)
        : feedType === 'letter_right'
            ? (612 - paperSize.width)
            : 0;
    const finalXOffset = baseXOffset + Number(printerProfile.offset_x || 0);
    const finalYOffset = baseYOffset + Number(printerProfile.offset_y || 0);

    const overflowWarnings = [];

    if (!PDFDocument || !StandardFonts) {
        return {
            buffer: createFallbackPdf({ rows, template, xOffset: finalXOffset, yOffset: finalYOffset, testPrint, isLetterFeed, overflowWarnings }),
            renderer: 'fallback',
            warning: overflowWarnings.length ? overflowWarnings.join('; ') : 'pdf-lib unavailable; fallback renderer used'
        };
    }

    try {
        const pdfDoc = await PDFDocument.create();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

        rows.forEach((row, rowIndex) => {
            const pageDimensions = isLetterFeed ? [612, 792] : [paperSize.width, paperSize.height];
            const page = pdfDoc.addPage(pageDimensions);
            const amountWords = amountToWords(row.amount, { suffix: amountWordsSettings?.suffix || 'pesos' });
            const words = template?.amount_format === 'upper' ? amountWords.toUpperCase() : amountWords;
            const amountWordsText = applyEndFiller(words, textSettings?.amountWordsFiller, textSettings?.amountWordsFillerEnabled);
            const payeeText = applyEndFiller(row.payee, textSettings?.payeeFiller, textSettings?.payeeFillerEnabled);

        const drawText = (text, cfg, fallback, fieldLabel) => {
            const baseX = Number(cfg?.x ?? fallback.x) + finalXOffset;
            const y = Number(cfg?.y ?? fallback.y) + finalYOffset;
            const preferredSize = Number(cfg?.fontSize ?? fallback.fontSize);
            const minFontSize = Number(cfg?.minFontSize ?? fallback.minFontSize ?? 8);
            const maxWidth = Number(cfg?.maxWidth ?? fallback.maxWidth ?? NaN);
            const alignment = cfg?.alignment ?? fallback.alignment ?? 'left';
            const safeText = toPdfLibSafeText(text, font);
            const { size: renderedSize, overflowed } = fitFontSize({
                text: safeText,
                font,
                preferredSize,
                maxWidth,
                minFontSize
            });
            if (overflowed && fieldLabel) {
                overflowWarnings.push(`Row ${rowIndex + 1} ${fieldLabel} text may not fit at minimum font size`);
            }
            const x = resolveAlignedX({
                text: safeText,
                x: baseX,
                alignment,
                font,
                fontSize: renderedSize,
                maxWidth
            });
            page.drawText(safeText, { x, y, size: renderedSize, font, characterSpacing: Number(cfg?.charSpacing ?? fallback.charSpacing ?? 0) });
        };

        const drawBoxedDate = (text, cfg, fallback) => {
            const content = String(text || '').replace(/[^0-9]/g, '');
            const y = Number(cfg?.y ?? fallback.y) + finalYOffset;
            const size = Number(cfg?.fontSize ?? fallback.fontSize);
            const blocks = cfg?.blocks;

            const parts = {
                MM: content.slice(0, 2),
                DD: content.slice(2, 4),
                YYYY: content.slice(4, 8)
            };

            if (blocks && typeof blocks === 'object') {
                ['MM', 'DD', 'YYYY'].forEach((key) => {
                    const value = parts[key];
                    if (!value) return;
                    const blockCfg = blocks[key] || {};
                    const startX = Number(blockCfg.startX);
                    const spacing = Number(blockCfg.charSpacing ?? cfg?.charSpacing ?? fallback.charSpacing ?? 14);
                    if (!Number.isFinite(startX)) return;
                    value.split('').forEach((char, index) => {
                        page.drawText(char, { x: startX + finalXOffset + (index * spacing), y, size, font });
                    });
                });
                return;
            }

            const x = Number(cfg?.x ?? fallback.x) + finalXOffset;
            const spacing = Number(cfg?.charSpacing ?? fallback.charSpacing ?? 14);
            const blockSpacing = Number(cfg?.blockSpacing ?? spacing);
            
            let currentX = x;
            content.split('').forEach((char, index) => {
                page.drawText(char, { x: currentX, y, size, font });
                if (index === 1 || index === 3) {
                    currentX += blockSpacing;
                } else {
                    currentX += spacing;
                }
            });
        };

        const dateCfg = positions.date || {};
        if (dateCfg.mode === 'boxed') {
            drawBoxedDate(row.date, dateCfg, { x: 426, y: 178, fontSize: 11, charSpacing: 14 });
        } else {
            drawText(row.date, dateCfg, { x: 426, y: 178, fontSize: 11, alignment: 'left', charSpacing: 0 }, null);
        }
        const formattedAmount = formatNumericAmount(row.amount);
        drawText(payeeText, positions.payee, { x: 72, y: 136, fontSize: 12, alignment: 'left', maxWidth: 380, minFontSize: 8 }, 'payee');
        drawText(formattedAmount, positions.amountNumeric, { x: 534, y: 136, fontSize: 12, alignment: 'right' }, null);
        drawText(amountWordsText, positions.amountWords, { x: 72, y: 104, fontSize: 11, alignment: 'left', maxWidth: 420, minFontSize: 8 }, 'amount-in-words');

        if (currencySettings.enabled !== false) {
            drawText(currencySettings.label || '₱', positions.currency, { x: 474, y: 136, fontSize: 11, alignment: 'left' }, null);
        }
        if (testPrint) {
            page.drawText('*** TEST PRINT ***', { x: 220, y: 198, size: 11, font });
        }
        });

        const bytes = await pdfDoc.save();
        return {
            buffer: Buffer.from(bytes),
            renderer: 'pdf-lib',
            warning: overflowWarnings.length ? overflowWarnings.join('; ') : null
        };
    } catch (error) {
        const fallbackOverflowWarnings = [];
        return {
            buffer: createFallbackPdf({ rows, template, xOffset: finalXOffset, yOffset: finalYOffset, testPrint, isLetterFeed, overflowWarnings: fallbackOverflowWarnings }),
            renderer: 'fallback',
            warning: [
                `pdf-lib failed (${error.message || 'unknown error'}); fallback renderer used`,
                ...fallbackOverflowWarnings
            ].join('; ')
        };
    }
}

module.exports = { createChequePdf, formatNumericAmount };
