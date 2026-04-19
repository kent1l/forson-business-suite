const { createChequePdf } = require('../helpers/pdf/chequePdf');

describe('createChequePdf', () => {
    it('builds a non-empty PDF buffer', async () => {
        const pdf = await createChequePdf({
            rows: [{ date: '04/19/2026', payee: 'Test Payee', amount: '123.45', memo: 'Invoice 55' }],
            template: {
                field_positions: {},
                amount_format: 'title_case',
                currency_settings: { enabled: true, label: 'USD' }
            },
            printerProfile: { offset_x: 0, offset_y: 0 }
        });

        expect(Buffer.isBuffer(pdf)).toBe(true);
        expect(pdf.length).toBeGreaterThan(100);
        expect(pdf.toString('utf8', 0, 8)).toContain('%PDF-1.4');
    });

    it('throws when rows are missing', async () => {
        await expect(createChequePdf({ rows: [], template: {} })).rejects.toThrow('At least one cheque row is required');
    });
});
