const statutory = require('../services/hr/statutoryService');
const { computePayslip } = require('../services/hr/payrollCalculationService');

/** Same reference tables as the golden payroll suite. */
const buildSssBrackets = () => Array.from({ length: 61 }, (_, i) => {
    const msc = 5000 + i * 500;
    return {
        range_from: i === 0 ? 0 : msc - 250,
        range_to: i === 60 ? null : msc + 249.99,
        msc,
        ee_amount: Math.min(msc, 20000) * 0.05,
        er_amount: Math.min(msc, 20000) * 0.10,
        ec_amount: msc < 15000 ? 10 : 30,
        mpf_ee: Math.max(msc - 20000, 0) * 0.05,
        mpf_er: Math.max(msc - 20000, 0) * 0.10,
    };
});

const TABLES = {
    versions: { sssVersionId: 1, philhealthVersionId: 2, pagibigVersionId: 3, birVersionId: 4 },
    sssBrackets: buildSssBrackets(),
    philhealth: { premium_rate: 0.05, income_floor: 10000, income_ceiling: 100000, ee_share_ratio: 0.5 },
    pagibig: { threshold_amount: 1500, ee_rate_below: 0.01, ee_rate_above: 0.02, er_rate: 0.02, max_compensation: 10000 },
    birByFrequency: {
        SEMI_MONTHLY: [
            { bracket_seq: 1, lower_bound: 0, upper_bound: 10417, base_tax: 0, rate_percent: 0, excess_over: 0 },
            { bracket_seq: 2, lower_bound: 10417, upper_bound: 16666, base_tax: 0, rate_percent: 0.15, excess_over: 10417 },
            { bracket_seq: 3, lower_bound: 16667, upper_bound: 33332, base_tax: 937.50, rate_percent: 0.20, excess_over: 16667 },
            { bracket_seq: 4, lower_bound: 33333, upper_bound: 83332, base_tax: 4270.70, rate_percent: 0.25, excess_over: 33333 },
        ],
    },
};

const POLICY = {
    statutorySchedule: 'SPLIT_HALF', workingDaysPerYear: 313,
    otRateOrdinary: 1.25, nightDiffRate: 0.10, standardHoursPerDay: 8,
};

// 610/day x 13 days = 7,930 basic; monthly basis 15,910.83.
const BASE = {
    employee: { employee_id: 3, employee_name: 'Grace Pilar' },
    compensation: { compensation_id: 1, pay_basis: 'daily', base_rate: 610, days_per_year: 313 },
    dtrSummary: { days_paid: 13, days_worked: 13, overtime_hours: 0 },
    loans: [], policy: POLICY, statutoryTables: TABLES, cutoffSeq: 1,
};

const component = (over = {}) => ({
    component_code: 'ALLOWANCE_MEAL', component_name: 'Meal Allowance',
    component_type: 'EARNING', is_taxable: false, amount: 1000,
    frequency: 'EVERY_CUTOFF', ...over,
});

describe('recurring earnings', () => {
    it('adds a non-taxable allowance to gross but not to taxable income', () => {
        const r = computePayslip({ ...BASE, payComponents: [component()] });
        expect(r.header.gross_pay).toBe(8930);              // 7,930 + 1,000
        expect(r.header.allowances_nontaxable).toBe(1000);
        expect(r.header.allowances_taxable).toBe(0);
        // Taxable income excludes the allowance: 7,930 - 698.89.
        expect(r.header.taxable_income).toBe(7231.11);
    });

    it('adds a taxable allowance to both gross and taxable income', () => {
        const r = computePayslip({
            ...BASE,
            payComponents: [component({ component_code: 'ALLOWANCE_COLA', component_name: 'COLA', is_taxable: true })],
        });
        expect(r.header.allowances_taxable).toBe(1000);
        expect(r.header.taxable_income).toBe(8231.11);      // 8,930 - 698.89
    });

    it('computes a percentage allowance against basic pay earned', () => {
        const r = computePayslip({
            ...BASE,
            payComponents: [component({ amount: null, rate_percent: 0.10 })],
        });
        expect(r.header.allowances_nontaxable).toBe(793);   // 10% of 7,930
    });

    it('shrinks a percentage allowance when days are lost', () => {
        // The point of percentage-based: it tracks what was actually earned.
        const r = computePayslip({
            ...BASE,
            dtrSummary: { days_paid: 6.5, overtime_hours: 0 },
            payComponents: [component({ amount: null, rate_percent: 0.10 })],
        });
        expect(r.header.basic_pay).toBe(3965);
        expect(r.header.allowances_nontaxable).toBe(396.5);
    });
});

describe('recurring deductions', () => {
    it('subtracts a deduction component from net without touching taxable income', () => {
        const r = computePayslip({
            ...BASE,
            payComponents: [component({
                component_code: 'HMO_EE', component_name: 'HMO Premium Share',
                component_type: 'DEDUCTION', amount: 500,
            })],
        });
        expect(r.header.other_deductions).toBe(500);
        expect(r.header.gross_pay).toBe(7930);
        expect(r.header.total_deductions).toBe(1198.89);    // 698.89 + 500
        expect(r.header.net_pay).toBe(6731.11);
    });

    it('keeps net = gross - deductions with a mix of components', () => {
        const r = computePayslip({
            ...BASE,
            payComponents: [
                component({ amount: 1000 }),
                component({ component_code: 'UNIFORM', component_name: 'Uniform', component_type: 'DEDUCTION', amount: 250 }),
            ],
        });
        expect(statutory.round2(r.header.gross_pay - r.header.total_deductions)).toBe(r.header.net_pay);
    });
});

describe('component frequency', () => {
    const meal = (frequency) => component({ frequency, amount: 1000 });

    it('applies EVERY_CUTOFF on both cutoffs', () => {
        expect(computePayslip({ ...BASE, payComponents: [meal('EVERY_CUTOFF')] }).header.allowances_nontaxable).toBe(1000);
        expect(computePayslip({ ...BASE, cutoffSeq: 2, payComponents: [meal('EVERY_CUTOFF')] }).header.allowances_nontaxable).toBe(1000);
    });

    it('restricts FIRST_CUTOFF and SECOND_CUTOFF to their own cutoff', () => {
        expect(computePayslip({ ...BASE, payComponents: [meal('FIRST_CUTOFF')] }).header.allowances_nontaxable).toBe(1000);
        expect(computePayslip({ ...BASE, cutoffSeq: 2, payComponents: [meal('FIRST_CUTOFF')] }).header.allowances_nontaxable).toBe(0);
        expect(computePayslip({ ...BASE, payComponents: [meal('SECOND_CUTOFF')] }).header.allowances_nontaxable).toBe(0);
        expect(computePayslip({ ...BASE, cutoffSeq: 2, payComponents: [meal('SECOND_CUTOFF')] }).header.allowances_nontaxable).toBe(1000);
    });

    it('splits MONTHLY across the two cutoffs without losing a centavo', () => {
        const odd = component({ frequency: 'MONTHLY', amount: 777.77 });
        const first = computePayslip({ ...BASE, payComponents: [odd] }).header.allowances_nontaxable;
        const second = computePayslip({ ...BASE, cutoffSeq: 2, payComponents: [odd] }).header.allowances_nontaxable;
        expect(first).toBe(388.89);
        expect(second).toBe(388.88);
        expect(statutory.round2(first + second)).toBe(777.77);
    });
});

describe('standing statutory overrides', () => {
    it('replaces the monthly contribution and prorates the override', () => {
        // Voluntary Pag-IBIG of 600/month instead of the mandatory 200.
        const r = computePayslip({ ...BASE, statutoryOverrides: { HDMF_EE: 600 } });
        expect(r.header.pagibig_ee).toBe(300);              // 600 / 2
        // Taxable income moves with it: 7,930 - (400 + 198.89 + 300).
        expect(r.header.taxable_income).toBe(7031.11);
    });

    it('overrides SSS and flows the change into tax', () => {
        const r = computePayslip({
            ...BASE,
            compensation: { compensation_id: 2, pay_basis: 'daily', base_rate: 2000, days_per_year: 313 },
            statutoryOverrides: { SSS_EE: 0 },
        });
        expect(r.header.sss_ee).toBe(0);
        // Deductions drop, so taxable income and therefore tax both rise.
        // Gross is 2,000 x 13 = 26,000, less (0 + 375 + 652.09 + 100).
        expect(r.header.taxable_income).toBe(24872.91);
        // Against the golden case (SSS charged normally) tax rises by 100 —
        // exactly 20% of the 500 that is no longer deducted.
        expect(r.header.withholding_tax).toBe(2578.68);
    });

    it('overrides withholding tax directly', () => {
        const r = computePayslip({
            ...BASE,
            compensation: { compensation_id: 2, pay_basis: 'daily', base_rate: 2000, days_per_year: 313 },
            statutoryOverrides: { WTAX: 2000 },
        });
        expect(r.header.withholding_tax).toBe(1000);        // monthly 2,000 halved
        // The trace keeps both figures so the gap is auditable.
        expect(r.trace.computedWithholdingTax).toBe(2478.68);
        expect(r.trace.appliedWithholdingTax).toBe(1000);
    });

    it('records what was overridden in the trace', () => {
        const r = computePayslip({ ...BASE, statutoryOverrides: { HDMF_EE: 600 } });
        expect(r.trace.statutoryOverridesApplied).toEqual({ HDMF_EE: 600 });
    });
});

describe('run adjustments', () => {
    const adj = (over = {}) => ({
        component_code: 'OTHER_EARNING', component_name: 'Performance Bonus',
        component_type: 'EARNING', is_taxable: true,
        adjustment_type: 'ADD', amount: 5000, reason: 'Q3 bonus', ...over,
    });

    it('ADD contributes an extra earning that reaches gross and tax', () => {
        const r = computePayslip({ ...BASE, adjustments: [adj()] });
        expect(r.header.gross_pay).toBe(12930);             // 7,930 + 5,000
        expect(r.header.taxable_income).toBe(12231.11);
        // 12,231.11 is in the second bracket: 15% over 10,417.
        expect(r.header.withholding_tax).toBe(272.12);
    });

    it('ADD can also be a one-off deduction', () => {
        const r = computePayslip({
            ...BASE,
            adjustments: [adj({
                component_code: 'OTHER_DEDUCTION', component_name: 'Lost tool',
                component_type: 'DEDUCTION', is_taxable: false, amount: 800,
            })],
        });
        expect(r.header.other_deductions).toBe(800);
        expect(r.header.net_pay).toBe(6431.11);             // 7,930 - 698.89 - 800
    });

    it('OVERRIDE replaces the computed statutory amount for this run only', () => {
        const r = computePayslip({
            ...BASE,
            adjustments: [adj({
                component_code: 'PHIC_EE', component_name: 'PhilHealth',
                component_type: 'DEDUCTION', is_taxable: false,
                adjustment_type: 'OVERRIDE', amount: 0, reason: 'Already remitted separately',
            })],
        });
        expect(r.header.philhealth_ee).toBe(0);
        expect(r.header.total_deductions).toBe(500);        // 400 + 0 + 100
    });

    it('OVERRIDE beats a standing override, being the more specific statement', () => {
        const r = computePayslip({
            ...BASE,
            statutoryOverrides: { HDMF_EE: 600 },
            adjustments: [adj({
                component_code: 'HDMF_EE', component_name: 'Pag-IBIG',
                component_type: 'DEDUCTION', is_taxable: false,
                adjustment_type: 'OVERRIDE', amount: 50, reason: 'One-off correction',
            })],
        });
        expect(r.header.pagibig_ee).toBe(50);
    });

    it('OVERRIDE replaces a recurring component amount', () => {
        const r = computePayslip({
            ...BASE,
            payComponents: [component({ amount: 1000 })],
            adjustments: [adj({
                component_code: 'ALLOWANCE_MEAL', component_name: 'Meal Allowance',
                component_type: 'EARNING', is_taxable: false,
                adjustment_type: 'OVERRIDE', amount: 250, reason: 'Half month only',
            })],
        });
        expect(r.header.allowances_nontaxable).toBe(250);
    });

    it('caps a loan override at the outstanding balance', () => {
        const r = computePayslip({
            ...BASE,
            cutoffSeq: 2,
            loans: [{
                loan_id: 1, loan_type: 'CASH_ADVANCE', component_code: 'CASH_ADVANCE',
                principal_amount: 6000, amortization_amount: 500, amount_paid: 5900, deduct_on_cutoff: 2,
            }],
            adjustments: [adj({
                component_code: 'CASH_ADVANCE', component_name: 'Cash Advance',
                component_type: 'DEDUCTION', is_taxable: false,
                adjustment_type: 'OVERRIDE', amount: 5000, reason: 'Settle in full',
            })],
        });
        expect(r.header.loans_total).toBe(100);             // only 100 was still owed
    });

    it('records every adjustment with its reason in the trace', () => {
        const r = computePayslip({ ...BASE, adjustments: [adj()] });
        expect(r.trace.runAdjustmentsApplied).toEqual([
            { component: 'OTHER_EARNING', type: 'ADD', amount: 5000, reason: 'Q3 bonus' },
        ]);
    });
});

describe('everything together still reconciles', () => {
    it('keeps net = gross - deductions and lines matching the header', () => {
        const r = computePayslip({
            ...BASE,
            payComponents: [
                component({ amount: 1000 }),
                component({ component_code: 'ALLOWANCE_COLA', component_name: 'COLA', is_taxable: true, amount: 500 }),
                component({ component_code: 'HMO_EE', component_name: 'HMO', component_type: 'DEDUCTION', amount: 300 }),
            ],
            statutoryOverrides: { HDMF_EE: 600 },
            adjustments: [{
                component_code: 'OTHER_EARNING', component_name: 'Bonus', component_type: 'EARNING',
                is_taxable: true, adjustment_type: 'ADD', amount: 2000, reason: 'Spot bonus',
            }],
            loans: [{
                loan_id: 1, loan_type: 'SSS_SALARY', component_code: 'SSS_LOAN',
                principal_amount: 6000, amortization_amount: 500, amount_paid: 0, deduct_on_cutoff: 1,
            }],
        });

        expect(statutory.round2(r.header.gross_pay - r.header.total_deductions)).toBe(r.header.net_pay);

        const sum = (type) => statutory.round2(
            r.lines.filter((l) => l.lineType === type).reduce((t, l) => t + l.amount, 0)
        );
        expect(sum('EARNING')).toBe(r.header.gross_pay);
        expect(sum('DEDUCTION')).toBe(r.header.total_deductions);
    });
});
