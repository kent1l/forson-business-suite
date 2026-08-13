const statutory = require('../services/hr/statutoryService');
const { computePayslip } = require('../services/hr/payrollCalculationService');
const { assertTransition, ALLOWED_TRANSITIONS } = require('../services/hr/payrollRunService');

/**
 * Reference tables mirroring what migration 20260813_12 seeds. Building them
 * here rather than reading the database keeps these tests pure: they verify the
 * ARITHMETIC, and every expected figure below was computed by hand.
 */
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
            { bracket_seq: 5, lower_bound: 83333, upper_bound: 333332, base_tax: 16770.70, rate_percent: 0.30, excess_over: 83333 },
            { bracket_seq: 6, lower_bound: 333333, upper_bound: null, base_tax: 91770.70, rate_percent: 0.35, excess_over: 333333 },
        ],
    },
};

const POLICY = {
    statutorySchedule: 'SPLIT_HALF',
    workingDaysPerYear: 313,
    otRateOrdinary: 1.25,
    nightDiffRate: 0.10,
    standardHoursPerDay: 8,
};

// --- SSS -----------------------------------------------------------------

describe('computeSSS', () => {
    it('maps a mid-range salary onto the right MSC band', () => {
        // 15,910.83 falls in the 15,750-16,249.99 band => MSC 16,000.
        const r = statutory.computeSSS(TABLES, 15910.83);
        expect(r.msc).toBe(16000);
        expect(r.ee).toBe(800);     // 5% of 16,000
        expect(r.er).toBe(1600);    // 10% of 16,000
        expect(r.ec).toBe(30);      // EC steps up at MSC 15,000
        expect(r.mpfEe).toBe(0);    // no WISP below MSC 20,000
    });

    it('uses the floor bracket for very low pay', () => {
        const r = statutory.computeSSS(TABLES, 3000);
        expect(r.msc).toBe(5000);
        expect(r.ee).toBe(250);
        expect(r.ec).toBe(10);
    });

    it('caps regular SS at MSC 20,000 and routes the excess to WISP', () => {
        const r = statutory.computeSSS(TABLES, 25000);
        expect(r.msc).toBe(25000);
        expect(r.ee).toBe(1000);      // capped: 5% of 20,000
        expect(r.mpfEe).toBe(250);    // 5% of the 5,000 excess
        expect(r.totalEe).toBe(1250); // what actually leaves the employee's pay
    });

    it('applies the top bracket above the table ceiling', () => {
        const r = statutory.computeSSS(TABLES, 500000);
        expect(r.msc).toBe(35000);
        expect(r.ee).toBe(1000);
        expect(r.mpfEe).toBe(750);
        expect(r.totalEe).toBe(1750);
    });
});

// --- PhilHealth ----------------------------------------------------------

describe('computePhilHealth', () => {
    it('splits the 5% premium evenly', () => {
        // 20,000 x 5% = 1,000 total, 500 each.
        const r = statutory.computePhilHealth(TABLES, 20000);
        expect(r.total).toBe(1000);
        expect(r.ee).toBe(500);
        expect(r.er).toBe(500);
    });

    it('lifts a below-floor salary to the income floor', () => {
        // 8,000 is below the 10,000 floor, so the premium is 10,000 x 5% = 500.
        const r = statutory.computePhilHealth(TABLES, 8000);
        expect(r.total).toBe(500);
        expect(r.ee).toBe(250);
    });

    it('clamps a high salary to the ceiling', () => {
        const r = statutory.computePhilHealth(TABLES, 250000);
        expect(r.total).toBe(5000); // 100,000 x 5%
        expect(r.ee).toBe(2500);
    });

    it('always reconstructs the total from the two shares', () => {
        // An odd premium must not lose or gain a centavo in the split.
        const r = statutory.computePhilHealth(TABLES, 15910.83);
        expect(r.total).toBe(795.54);
        expect(statutory.round2(r.ee + r.er)).toBe(r.total);
    });
});

// --- Pag-IBIG ------------------------------------------------------------

describe('computePagIbig', () => {
    it('uses the 1% rate at or below the threshold', () => {
        const r = statutory.computePagIbig(TABLES, 1500);
        expect(r.ee).toBe(15);
        expect(r.er).toBe(30);
    });

    it('steps to 2% above the threshold', () => {
        const r = statutory.computePagIbig(TABLES, 1501);
        expect(r.ee).toBe(30.02);
    });

    it('caps the basis at the maximum compensation', () => {
        // Anything above 10,000 contributes on 10,000: 200 each side.
        expect(statutory.computePagIbig(TABLES, 15910.83)).toEqual({ ee: 200, er: 200 });
        expect(statutory.computePagIbig(TABLES, 90000)).toEqual({ ee: 200, er: 200 });
    });
});

// --- Withholding tax -----------------------------------------------------

describe('computeWithholdingTax (semi-monthly)', () => {
    it('exempts income at or below the first bracket', () => {
        expect(statutory.computeWithholdingTax(TABLES, 10417).tax).toBe(0);
        expect(statutory.computeWithholdingTax(TABLES, 5000).tax).toBe(0);
    });

    it('taxes the second bracket at 15% of the excess', () => {
        // 15,000 - 10,417 = 4,583 x 15% = 687.45
        expect(statutory.computeWithholdingTax(TABLES, 15000).tax).toBe(687.45);
    });

    it('applies base tax plus rate in the third bracket', () => {
        // 937.50 + 20% x (24,372.91 - 16,667) = 937.50 + 1,541.18 = 2,478.68
        expect(statutory.computeWithholdingTax(TABLES, 24372.91).tax).toBe(2478.68);
    });

    it('applies the fourth bracket', () => {
        // 4,270.70 + 25% x (50,000 - 33,333) = 4,270.70 + 4,166.75 = 8,437.45
        expect(statutory.computeWithholdingTax(TABLES, 50000).tax).toBe(8437.45);
    });

    it('never returns a negative tax', () => {
        expect(statutory.computeWithholdingTax(TABLES, 0).tax).toBe(0);
        expect(statutory.computeWithholdingTax(TABLES, -500).tax).toBe(0);
    });
});

// --- Proration -----------------------------------------------------------

describe('prorateMonthly', () => {
    it('splits evenly across both cutoffs', () => {
        expect(statutory.prorateMonthly(800, 'SPLIT_HALF', 1)).toBe(400);
        expect(statutory.prorateMonthly(800, 'SPLIT_HALF', 2)).toBe(400);
    });

    it('makes the two cutoffs sum to the monthly figure exactly on an odd amount', () => {
        // The whole point: halving 397.77 twice would over-collect a centavo, so
        // the second cutoff takes the remainder instead.
        const first = statutory.prorateMonthly(397.77, 'SPLIT_HALF', 1);
        const second = statutory.prorateMonthly(397.77, 'SPLIT_HALF', 2);
        expect(first).toBe(198.89);
        expect(second).toBe(198.88);
        expect(statutory.round2(first + second)).toBe(397.77);
    });

    it('puts the whole amount on the second cutoff when configured that way', () => {
        expect(statutory.prorateMonthly(800, 'SECOND_CUTOFF', 1)).toBe(0);
        expect(statutory.prorateMonthly(800, 'SECOND_CUTOFF', 2)).toBe(800);
    });
});

describe('round2', () => {
    it('rounds half up and resists binary float drift', () => {
        expect(statutory.round2(198.885)).toBe(198.89);
        expect(statutory.round2(1.005)).toBe(1.01);
        expect(statutory.round2(2.675)).toBe(2.68);
        expect(statutory.round2(-1.005)).toBe(-1.01);
    });
});

// --- Full payslip, hand-verified -----------------------------------------

describe('computePayslip — rank-and-file daily earner', () => {
    const employee = { employee_id: 3, employee_code: 'EMP-1', employee_name: 'Grace Pilar' };
    const compensation = { compensation_id: 1, pay_basis: 'daily', base_rate: 610, days_per_year: 313 };
    const dtrSummary = { days_paid: 13, days_worked: 13, days_absent: 0, days_on_leave: 0, overtime_hours: 0 };

    const result = computePayslip({
        employee, compensation, dtrSummary, loans: [],
        policy: POLICY, statutoryTables: TABLES, cutoffSeq: 1,
    });

    it('derives the monthly basis from the daily rate', () => {
        // 610 x 313 / 12 = 15,910.83
        expect(result.header.monthly_basis).toBe(15910.83);
    });

    it('computes basic pay from days paid', () => {
        expect(result.header.basic_pay).toBe(7930); // 610 x 13
        expect(result.header.gross_pay).toBe(7930);
    });

    it('halves each monthly contribution onto this cutoff', () => {
        expect(result.header.sss_ee).toBe(400);        // 800 / 2
        expect(result.header.philhealth_ee).toBe(198.89); // 397.77 -> first half
        expect(result.header.pagibig_ee).toBe(100);    // 200 / 2
        expect(result.header.sss_mpf_ee).toBe(0);
    });

    it('taxes gross less statutory contributions, not gross', () => {
        // 7,930 - (400 + 198.89 + 100) = 7,231.11, which is inside the exempt band.
        expect(result.header.taxable_income).toBe(7231.11);
        expect(result.header.withholding_tax).toBe(0);
    });

    it('reconciles net = gross - deductions', () => {
        expect(result.header.total_deductions).toBe(698.89);
        expect(result.header.net_pay).toBe(7231.11);
        expect(statutory.round2(result.header.gross_pay - result.header.total_deductions))
            .toBe(result.header.net_pay);
    });

    it('records the employer share separately from the employee deductions', () => {
        // (1,600 + 30 + 397.77 + 200) / 2 = 1,113.89 (halves: 800 + 15 + 198.89 + 100)
        expect(result.header.sss_er).toBe(800);
        expect(result.header.sss_ec).toBe(15);
        expect(result.header.total_employer_contrib).toBe(1113.89);
    });
});

describe('computePayslip — higher earner crossing into a tax bracket', () => {
    const result = computePayslip({
        employee: { employee_id: 4, employee_name: 'Senior Staff' },
        compensation: { compensation_id: 2, pay_basis: 'daily', base_rate: 2000, days_per_year: 313 },
        dtrSummary: { days_paid: 13, days_worked: 13, overtime_hours: 0 },
        loans: [], policy: POLICY, statutoryTables: TABLES, cutoffSeq: 1,
    });

    it('reaches the SSS ceiling and generates a WISP deduction', () => {
        // 2,000 x 313 / 12 = 52,166.67 -> top MSC 35,000.
        expect(result.header.monthly_basis).toBe(52166.67);
        expect(result.header.sss_ee).toBe(500);      // 1,000 / 2
        expect(result.header.sss_mpf_ee).toBe(375);  // 750 / 2
    });

    it('computes withholding tax in the third bracket', () => {
        // Gross 26,000 less (500 + 375 + 652.09 + 100) = 24,372.91 taxable.
        expect(result.header.taxable_income).toBe(24372.91);
        expect(result.header.withholding_tax).toBe(2478.68);
    });

    it('reconciles the whole payslip', () => {
        expect(result.header.gross_pay).toBe(26000);
        expect(result.header.total_deductions).toBe(4105.77);
        expect(result.header.net_pay).toBe(21894.23);
    });
});

describe('computePayslip — DTR drives pay', () => {
    const base = {
        employee: { employee_id: 3, employee_name: 'Grace Pilar' },
        compensation: { compensation_id: 1, pay_basis: 'daily', base_rate: 610, days_per_year: 313 },
        loans: [], policy: POLICY, statutoryTables: TABLES, cutoffSeq: 1,
    };

    it('pays a half day at half rate', () => {
        const r = computePayslip({ ...base, dtrSummary: { days_paid: 12.5, overtime_hours: 0 } });
        expect(r.header.basic_pay).toBe(7625); // 610 x 12.5
    });

    it('still charges statutory contributions when no days were worked', () => {
        // Contributions are monthly obligations, not per-day, so a zero-days
        // cutoff produces a negative net rather than silently zeroing them.
        const r = computePayslip({ ...base, dtrSummary: { days_paid: 0, overtime_hours: 0 } });
        expect(r.header.basic_pay).toBe(0);
        expect(r.header.sss_ee).toBe(400);
        expect(r.header.net_pay).toBe(-698.89);
    });

    it('adds overtime at the configured multiplier', () => {
        // hourly = 610/8 = 76.25; 10h x 76.25 x 1.25 = 953.13
        const r = computePayslip({ ...base, dtrSummary: { days_paid: 13, overtime_hours: 10 } });
        expect(r.header.overtime_pay).toBe(953.13);
        expect(r.header.gross_pay).toBe(8883.13);
    });
});

describe('computePayslip — loans', () => {
    const base = {
        employee: { employee_id: 3, employee_name: 'Grace Pilar' },
        compensation: { compensation_id: 1, pay_basis: 'daily', base_rate: 610, days_per_year: 313 },
        dtrSummary: { days_paid: 13, overtime_hours: 0 },
        policy: POLICY, statutoryTables: TABLES, cutoffSeq: 2,
    };

    it('deducts an instalment on the configured cutoff only', () => {
        const loan = {
            loan_id: 1, loan_type: 'SSS_SALARY', component_code: 'SSS_LOAN',
            principal_amount: 6000, amortization_amount: 500, amount_paid: 0, deduct_on_cutoff: 2,
        };
        const onCutoff2 = computePayslip({ ...base, loans: [loan] });
        expect(onCutoff2.header.loans_total).toBe(500);

        const onCutoff1 = computePayslip({ ...base, cutoffSeq: 1, loans: [loan] });
        expect(onCutoff1.header.loans_total).toBe(0);
    });

    it('never deducts more than the outstanding balance', () => {
        // 5,800 already paid on a 6,000 loan leaves 200, not the full 500.
        const loan = {
            loan_id: 1, loan_type: 'CASH_ADVANCE', component_code: 'CASH_ADVANCE',
            principal_amount: 6000, amortization_amount: 500, amount_paid: 5800, deduct_on_cutoff: 2,
        };
        const r = computePayslip({ ...base, loans: [loan] });
        expect(r.header.loans_total).toBe(200);
    });

    it('skips a fully paid loan', () => {
        const loan = {
            loan_id: 1, loan_type: 'CASH_ADVANCE', component_code: 'CASH_ADVANCE',
            principal_amount: 6000, amortization_amount: 500, amount_paid: 6000, deduct_on_cutoff: 2,
        };
        expect(computePayslip({ ...base, loans: [loan] }).header.loans_total).toBe(0);
    });
});

describe('computePayslip — guards', () => {
    const base = {
        employee: { employee_id: 3, employee_name: 'Grace Pilar' },
        dtrSummary: { days_paid: 13, overtime_hours: 0 },
        loans: [], policy: POLICY, statutoryTables: TABLES, cutoffSeq: 1,
    };

    it('refuses to pay an employee with no compensation on record', () => {
        expect(() => computePayslip({ ...base, compensation: null }))
            .toThrow(/No compensation on record/);
    });

    it('refuses an unimplemented pay basis rather than paying something wrong', () => {
        expect(() => computePayslip({
            ...base, compensation: { pay_basis: 'monthly', base_rate: 20000 },
        })).toThrow(/not supported yet/);
    });

    it('honours a declared monthly basic over the derived one', () => {
        const r = computePayslip({
            ...base,
            compensation: { compensation_id: 1, pay_basis: 'daily', base_rate: 610, days_per_year: 313, declared_monthly_basic: 20000 },
        });
        expect(r.header.monthly_basis).toBe(20000);
        expect(r.header.sss_ee).toBe(500); // MSC 20,000 -> 1,000 monthly -> 500 per cutoff
    });
});

describe('payslip lines', () => {
    const result = computePayslip({
        employee: { employee_id: 3, employee_name: 'Grace Pilar' },
        compensation: { compensation_id: 1, pay_basis: 'daily', base_rate: 610, days_per_year: 313 },
        dtrSummary: { days_paid: 13, overtime_hours: 0 },
        loans: [], policy: POLICY, statutoryTables: TABLES, cutoffSeq: 1,
    });

    it('omits zero-value lines so a payslip is not padded with noise', () => {
        expect(result.lines.find((l) => l.componentCode === 'OT_REG')).toBeUndefined();
        expect(result.lines.find((l) => l.componentCode === 'SSS_MPF_EE')).toBeUndefined();
    });

    it('reconciles earning lines minus deduction lines against net pay', () => {
        const sum = (type) => statutory.round2(
            result.lines.filter((l) => l.lineType === type).reduce((t, l) => t + l.amount, 0)
        );
        expect(statutory.round2(sum('EARNING') - sum('DEDUCTION'))).toBe(result.header.net_pay);
    });

    it('keeps employer contributions out of the employee deduction total', () => {
        const employer = result.lines.filter((l) => l.lineType === 'EMPLOYER_CONTRIBUTION');
        expect(employer.length).toBeGreaterThan(0);
        const employerSum = statutory.round2(employer.reduce((t, l) => t + l.amount, 0));
        expect(employerSum).toBe(result.header.total_employer_contrib);
        expect(result.header.total_deductions).not.toBe(employerSum);
    });

    it('stores a trace that explains the figures', () => {
        expect(result.trace.sssMsc).toBe(16000);
        expect(result.trace.statutorySchedule).toBe('SPLIT_HALF');
        expect(result.trace.monthlyBasis).toBe(15910.83);
        expect(result.trace.statutoryVersions).toBeDefined();
    });
});

// --- State machine -------------------------------------------------------

describe('payroll run state machine', () => {
    it('allows the happy path end to end', () => {
        expect(() => assertTransition('Draft', 'Computed')).not.toThrow();
        expect(() => assertTransition('Computed', 'Approved')).not.toThrow();
        expect(() => assertTransition('Approved', 'Paid')).not.toThrow();
        expect(() => assertTransition('Paid', 'Posted')).not.toThrow();
    });

    it('allows recompute by going back to Draft', () => {
        expect(() => assertTransition('Computed', 'Draft')).not.toThrow();
    });

    it('blocks skipping approval', () => {
        expect(() => assertTransition('Computed', 'Paid')).toThrow(/cannot move/);
        expect(() => assertTransition('Draft', 'Approved')).toThrow(/cannot move/);
        expect(() => assertTransition('Draft', 'Posted')).toThrow(/cannot move/);
    });

    it('blocks un-approving or un-posting in place', () => {
        expect(() => assertTransition('Approved', 'Draft')).toThrow(/cannot move/);
        expect(() => assertTransition('Posted', 'Paid')).toThrow(/cannot move/);
    });

    it('treats Voided as terminal', () => {
        expect(ALLOWED_TRANSITIONS.Voided).toEqual([]);
        expect(() => assertTransition('Voided', 'Draft')).toThrow(/cannot move/);
    });

    it('allows voiding from every non-terminal state', () => {
        for (const state of ['Draft', 'Computed', 'Approved', 'Paid', 'Posted']) {
            expect(() => assertTransition(state, 'Voided')).not.toThrow();
        }
    });
});
