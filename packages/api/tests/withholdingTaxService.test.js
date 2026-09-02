jest.mock('../db', () => ({ query: jest.fn() }));

const {
    computeWithholding,
    computeWithholdingForInvoice,
    loadWithholdingConfig,
    splitBaseByClass,
    DEFAULTS,
} = require('../services/withholdingTaxService');

const db = require('../db');

const config = {
    ewtRateGoods: 0.01,
    ewtRateServices: 0.02,
    vatRateGov: 0.05,
    atcGoods: 'WC158',
    atcServices: 'WC160',
    atcVatGov: 'WV010',
};

const privateAgent = { is_withholding_agent: true, customer_type: 'PRIVATE' };
const governmentAgent = { is_withholding_agent: true, customer_type: 'GOVERNMENT' };
const ordinaryCustomer = { is_withholding_agent: false, customer_type: 'PRIVATE' };

const goodsPart = { part_id: 1, is_service: false };
const servicePart = { part_id: 2, is_service: true };

describe('withholding tax', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        console.error.mockRestore();
    });

    describe('applicability', () => {
        test('does not apply to a customer who is not a withholding agent', () => {
            const result = computeWithholding({
                lines: [{ part_id: 1, tax_base: 10000 }],
                parts: [goodsPart],
                customer: ordinaryCustomer,
                config,
            });

            expect(result.applicable).toBe(false);
            expect(result.total_withheld).toBe(0);
            expect(result.components).toEqual([]);
        });

        test('does not apply when there is no base to withhold from', () => {
            const result = computeWithholding({
                lines: [], parts: [], customer: privateAgent, config,
            });

            expect(result.applicable).toBe(false);
            expect(result.total_withheld).toBe(0);
        });
    });

    describe('private withholding agent (Form 2307 only)', () => {
        // The worked example: a parts invoice whose VAT-exclusive base is
        // 9,857.14 on a total of 11,040.00.
        test('withholds 1% of the VAT-exclusive base on goods', () => {
            const result = computeWithholding({
                lines: [
                    { part_id: 1, tax_base: 4000.00 },
                    { part_id: 1, tax_base: 3000.00 },
                    { part_id: 1, tax_base: 2857.14 },
                ],
                parts: [goodsPart],
                customer: privateAgent,
                config,
            });

            expect(result.base_goods).toBe(9857.14);
            expect(result.ewt_total).toBe(98.57);      // 9,857.14 x 1%
            expect(result.vat_withheld_total).toBe(0); // private buyer withholds no VAT
            expect(result.total_withheld).toBe(98.57);
            expect(result.components).toHaveLength(1);
            expect(result.components[0]).toMatchObject({
                withholding_type: 'EWT_GOODS',
                treatment: 'INCOME_TAX_CREDITABLE',
                certificate_type: '2307',
                atc_code: 'WC158',
                rate_snapshot: 0.01,
                tax_base: 9857.14,
                expected_withheld: 98.57,
            });
        });

        test('is computed on the base, never on the VAT-inclusive total', () => {
            // The customer's most common mistake, encoded so the service can
            // never drift into making it: 11,040 x 1% would be 110.40.
            const result = computeWithholding({
                lines: [{ part_id: 1, tax_base: 9857.14 }],
                parts: [goodsPart],
                customer: privateAgent,
                config,
            });

            expect(result.total_withheld).toBe(98.57);
            expect(result.total_withheld).not.toBeCloseTo(110.40, 2);
        });
    });

    describe('mixed goods and services', () => {
        test('rounds each ATC class separately rather than blending the base', () => {
            // Blending would give (1,000.05 + 500.05) x some average rate. Each
            // class is its own line on the certificate, so each rounds alone:
            //   goods    1,000.05 x 1% = 10.0005 -> 10.00
            //   services   500.05 x 2% = 10.001  -> 10.00
            const result = computeWithholding({
                lines: [
                    { part_id: 1, tax_base: 1000.05 },
                    { part_id: 2, tax_base: 500.05 },
                ],
                parts: [goodsPart, servicePart],
                customer: privateAgent,
                config,
            });

            expect(result.base_goods).toBe(1000.05);
            expect(result.base_services).toBe(500.05);
            expect(result.components).toHaveLength(2);

            const goods = result.components.find(c => c.withholding_type === 'EWT_GOODS');
            const services = result.components.find(c => c.withholding_type === 'EWT_SERVICES');
            expect(goods.expected_withheld).toBe(10.00);
            expect(goods.atc_code).toBe('WC158');
            expect(services.expected_withheld).toBe(10.00);
            expect(services.atc_code).toBe('WC160');
            expect(services.rate_snapshot).toBe(0.02);
            expect(result.ewt_total).toBe(20.00);
        });

        test('treats a part with no service flag as goods', () => {
            const result = computeWithholding({
                lines: [{ part_id: 99, tax_base: 1000 }],
                parts: [],                        // part not found in the lookup
                customer: privateAgent,
                config,
            });

            expect(result.base_goods).toBe(1000);
            expect(result.base_services).toBe(0);
            expect(result.total_withheld).toBe(10.00);
        });
    });

    describe('government buyer (2307 plus 2306)', () => {
        test('withholds both EWT and 5% VAT on the same base', () => {
            const result = computeWithholding({
                lines: [{ part_id: 1, tax_base: 10000 }],
                parts: [goodsPart],
                customer: governmentAgent,
                config,
            });

            expect(result.ewt_total).toBe(100.00);          // 1%
            expect(result.vat_withheld_total).toBe(500.00); // 5%
            expect(result.total_withheld).toBe(600.00);

            const vat = result.components.find(c => c.withholding_type === 'VAT_GOV');
            expect(vat).toMatchObject({
                treatment: 'VAT_CREDITABLE',
                certificate_type: '2306',
                rate_snapshot: 0.05,
                tax_base: 10000,
                expected_withheld: 500.00,
            });
        });

        test('applies withholding VAT across goods and services combined', () => {
            const result = computeWithholding({
                lines: [
                    { part_id: 1, tax_base: 6000 },
                    { part_id: 2, tax_base: 4000 },
                ],
                parts: [goodsPart, servicePart],
                customer: governmentAgent,
                config,
            });

            const vat = result.components.find(c => c.withholding_type === 'VAT_GOV');
            expect(vat.tax_base).toBe(10000);          // 6,000 + 4,000
            expect(vat.expected_withheld).toBe(500.00);
            // EWT still splits: 6,000 x 1% + 4,000 x 2% = 60 + 80
            expect(result.ewt_total).toBe(140.00);
            expect(result.total_withheld).toBe(640.00);
        });

        test('a private buyer never has VAT withheld', () => {
            const result = computeWithholding({
                lines: [{ part_id: 1, tax_base: 10000 }],
                parts: [goodsPart],
                customer: privateAgent,
                config,
            });

            expect(result.components.some(c => c.withholding_type === 'VAT_GOV')).toBe(false);
            expect(result.vat_withheld_total).toBe(0);
        });
    });

    describe('the settlement identity', () => {
        test('cash plus withholding equals the invoice total', () => {
            const B = 10000, V = 1200, T = B + V;

            const result = computeWithholding({
                lines: [{ part_id: 1, tax_base: B }],
                parts: [goodsPart],
                customer: governmentAgent,
                config,
            });

            const cash = Math.round((T - result.total_withheld) * 100) / 100;
            expect(cash).toBe(10600.00);
            expect(Math.round((cash + result.total_withheld) * 100) / 100).toBe(T);
        });
    });

    describe('splitBaseByClass', () => {
        test('sums each class independently', () => {
            expect(splitBaseByClass(
                [{ part_id: 1, tax_base: 100 }, { part_id: 2, tax_base: 50 }, { part_id: 1, tax_base: 25 }],
                [goodsPart, servicePart]
            )).toEqual({ baseGoods: 125, baseServices: 50 });
        });
    });

    describe('configuration', () => {
        test('falls back to statutory defaults when settings are absent', async () => {
            db.query.mockResolvedValueOnce({ rows: [] });

            const cfg = await loadWithholdingConfig();

            expect(cfg.ewtRateGoods).toBe(DEFAULTS.EWT_RATE_GOODS);
            expect(cfg.ewtRateServices).toBe(DEFAULTS.EWT_RATE_SERVICES);
            expect(cfg.vatRateGov).toBe(DEFAULTS.WITHHOLDING_VAT_RATE_GOV);
            expect(cfg.atcGoods).toBe('WC158');
        });

        test('reads configured rates over the defaults', async () => {
            db.query.mockResolvedValueOnce({ rows: [
                { setting_key: 'EWT_RATE_GOODS', setting_value: '0.02' },
                { setting_key: 'EWT_ATC_GOODS', setting_value: 'WC999' },
            ] });

            const cfg = await loadWithholdingConfig();

            expect(cfg.ewtRateGoods).toBe(0.02);
            expect(cfg.atcGoods).toBe('WC999');
            expect(cfg.ewtRateServices).toBe(DEFAULTS.EWT_RATE_SERVICES);
        });

        test('clamps and reports a rate stored as a percentage instead of a fraction', async () => {
            // 1 meaning "1%" would be read as 100% by a naive parse.
            db.query.mockResolvedValueOnce({ rows: [
                { setting_key: 'EWT_RATE_GOODS', setting_value: '12' },
            ] });

            const cfg = await loadWithholdingConfig();

            expect(cfg.ewtRateGoods).toBe(1);
            expect(console.error).toHaveBeenCalled();
        });
    });

    describe('computeWithholdingForInvoice', () => {
        test('loads config then computes', async () => {
            db.query.mockResolvedValueOnce({ rows: [] });

            const result = await computeWithholdingForInvoice({
                lines: [{ part_id: 1, tax_base: 10000 }],
                parts: [goodsPart],
                customer: privateAgent,
            });

            expect(result.total_withheld).toBe(100.00);
        });
    });
});
