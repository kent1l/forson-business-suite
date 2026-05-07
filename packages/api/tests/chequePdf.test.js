const { createChequePdf } = require('../helpers/pdf/chequePdf');

describe('createChequePdf', () => {
    it('builds a non-empty PDF buffer', async () => {
        const result = await createChequePdf({
            rows: [{ date: '04/19/2026', payee: 'Test Payee', amount: '123.45', memo: 'Invoice 55' }],
            template: {
                field_positions: {},
                amount_format: 'title_case',
                currency_settings: { enabled: true, label: 'USD' },
                amount_words_settings: { suffix: 'pesos' },
                text_settings: { payeeFillerEnabled: true, payeeFiller: '***', amountWordsFillerEnabled: true, amountWordsFiller: '--' }
            },
            printerProfile: { offset_x: 0, offset_y: 0 }
        });
        const pdf = result.buffer;

        expect(Buffer.isBuffer(pdf)).toBe(true);
        expect(pdf.length).toBeGreaterThan(100);
        expect(pdf.toString('utf8', 0, 8)).toMatch(/^%PDF-1\.[0-9]/);
        expect(['pdf-lib', 'fallback']).toContain(result.renderer);
    });

    it('throws when rows are missing', async () => {
        await expect(createChequePdf({ rows: [], template: {} })).rejects.toThrow('At least one cheque row is required');
    });

    it('supports test print and boxed date options', async () => {
        const result = await createChequePdf({
            rows: [{ date: '04/19/2026', payee: 'Long Payee Name For Fit Testing', amount: '98765.43', memo: 'Calibrate' }],
            template: {
                field_positions: {
                    date: { x: 430, y: 700, fontSize: 11, mode: 'boxed', charSpacing: 12 },
                    payee: { x: 90, y: 655, fontSize: 12, maxWidth: 120, minFontSize: 8 }
                },
                amount_format: 'upper',
                currency_settings: { enabled: true, label: 'USD' }
            },
            printerProfile: { offset_x: 1, offset_y: -1 },
            testPrint: true
        });
        const pdf = result.buffer;
        expect(Buffer.isBuffer(pdf)).toBe(true);
        expect(pdf.length).toBeGreaterThan(100);
    });

    it('uses letter canvas and feed alignment offsets when feed_type is letter_right', async () => {
        const result = await createChequePdf({
            rows: [{ date: '04/19/2026', payee: 'Feed Type Test', amount: '500.00', memo: '' }],
            template: { field_positions: {}, amount_format: 'upper' },
            printerProfile: { feed_type: 'letter_right', offset_x: 0, offset_y: 0 }
        });

        if (result.renderer === 'pdf-lib') {
            const { PDFDocument } = require('pdf-lib');
            const pdfDoc = await PDFDocument.load(result.buffer);
            const pages = pdfDoc.getPages();
            expect(pages.length).toBeGreaterThan(0);
            const { width, height } = pages[0].getSize();
            expect(width).toBeCloseTo(612, 0);
            expect(height).toBeCloseTo(792, 0);
        } else {
            const pdfText = result.buffer.toString('latin1');
            expect(pdfText).toContain('/MediaBox [0 0 612 792]');
        }
    });
});


describe('createChequePdf fallback renderer offsets', () => {
    afterEach(() => {
        jest.resetModules();
        jest.dontMock('pdf-lib');
    });

    it('applies final printer offsets in fallback path when pdf-lib is unavailable', async () => {
        jest.resetModules();
        jest.doMock('pdf-lib', () => {
            throw new Error('Simulated missing pdf-lib');
        });

        const { createChequePdf: createWithFallback } = require('../helpers/pdf/chequePdf');

        const result = await createWithFallback({
            rows: [{ date: '04/19/2026', payee: 'Offset Check', amount: '123.45', memo: '' }],
            template: { field_positions: {} },
            printerProfile: { offset_x: 10, offset_y: 20 }
        });

        expect(result.renderer).toBe('fallback');
        const pdfText = result.buffer.toString('latin1');
        expect(pdfText).toContain('436 198 Td');
    });
});
