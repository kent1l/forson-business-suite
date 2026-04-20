const { createChequePdf } = require('../helpers/pdf/chequePdf');

describe('createChequePdf', () => {
    it('builds a non-empty PDF buffer', async () => {
        const result = await createChequePdf({
            rows: [{ date: '04/19/2026', payee: 'Test Payee', amount: '123.45', memo: 'Invoice 55' }],
            template: {
                field_positions: {},
                amount_format: 'title_case',
                currency_settings: { enabled: true, label: 'USD' }
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
});
