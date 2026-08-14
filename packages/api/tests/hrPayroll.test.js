const statutory = require('../services/hr/statutoryService');
const { computePayslip, round2 } = require('../services/hr/payrollCalculationService');
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
        for (const payBasis of ['hourly', 'commission']) {
            expect(() => computePayslip({
                ...base, compensation: { pay_basis: payBasis, base_rate: 20000 },
            })).toThrow(/not supported yet/);
        }
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

// --- Monthly pay basis ---------------------------------------------------
// The defining property of a monthly salary is that it does NOT vary with the
// number of working days a semi-monthly cutoff happens to contain. Every case
// below is a hand-computed reference figure.

const MONTHLY_POLICY = { ...POLICY, monthlyDivisorMode: 'PERIOD_WORKING_DAYS' };

/** A cutoff with 14 scheduled working days, all inside the contract. */
const FULL_PERIOD = { schedDaysInPeriod: 14, schedDaysInMonth: 26, contractDays: 14 };

const monthlyBase = (overrides = {}) => ({
    employee: { employee_id: 9, employee_name: 'Elena Marquez' },
    compensation: {
        compensation_id: 5, pay_basis: 'monthly', salary_model: 'GUARANTEED',
        base_rate: 30000, days_per_year: 313, is_overtime_exempt: true, is_tardiness_exempt: true,
    },
    dtrSummary: { days_paid: 14, days_absent: 0, days_lwop: 0, overtime_hours: 0 },
    periodDays: FULL_PERIOD,
    loans: [], policy: MONTHLY_POLICY, statutoryTables: TABLES, cutoffSeq: 1,
    ...overrides,
});

const basicOf = (result) => result.header.basic_pay;

describe('computePayslip — monthly GUARANTEED salary', () => {
    it('pays exactly half the monthly salary regardless of the cutoff length', () => {
        expect(basicOf(computePayslip(monthlyBase({ cutoffSeq: 1 })))).toBe(15000);
        expect(basicOf(computePayslip(monthlyBase({
            cutoffSeq: 2,
            periodDays: { schedDaysInPeriod: 12, schedDaysInMonth: 26, contractDays: 12 },
            dtrSummary: { days_paid: 12, days_absent: 0, days_lwop: 0 },
        })))).toBe(15000);
    });

    it('ignores absences, lateness and undertime entirely', () => {
        const result = computePayslip(monthlyBase({
            dtrSummary: {
                days_paid: 11, days_absent: 3, days_lwop: 0,
                late_minutes: 200, undertime_minutes: 90,
            },
        }));
        expect(basicOf(result)).toBe(15000);
        expect(result.lines.find((l) => l.componentCode === 'ABSENCE')).toBeUndefined();
    });

    it('uses the contracted monthly salary as the statutory basis, not the derived one', () => {
        const result = computePayslip(monthlyBase());
        expect(result.header.monthly_basis).toBe(30000);
        // MSC caps at 20,000 -> EE 1,000/month -> 500 per cutoff, plus WISP on the excess.
        expect(result.header.sss_ee).toBe(500);
    });

    it('suppresses overtime and night differential when exempt', () => {
        const result = computePayslip(monthlyBase({
            dtrSummary: { days_paid: 14, days_absent: 0, days_lwop: 0, overtime_hours: 10, night_diff_hours: 6 },
        }));
        expect(result.header.overtime_pay).toBe(0);
        expect(result.header.night_diff_pay).toBe(0);
        expect(result.lines.find((l) => l.componentCode === 'OT_REG')).toBeUndefined();
    });

    it('still pays overtime to a monthly earner who is NOT exempt', () => {
        const result = computePayslip(monthlyBase({
            compensation: { ...monthlyBase().compensation, is_overtime_exempt: false },
            dtrSummary: { days_paid: 14, days_absent: 0, days_lwop: 0, overtime_hours: 10 },
        }));
        // 30,000 * 12 / 313 = 1,150.16 daily -> /8 = 143.77 hourly -> *1.25 * 10
        expect(result.header.overtime_pay).toBeCloseTo(1797.13, 1);
    });

    it('pays in full when the DTR has no rows at all', () => {
        expect(basicOf(computePayslip(monthlyBase({ dtrSummary: null })))).toBe(15000);
    });

    it('records the whole derivation in the trace', () => {
        const t = computePayslip(monthlyBase()).trace;
        expect(t.basicPayModel).toBe('MONTHLY_GUARANTEED');
        expect(t.monthlySalary).toBe(30000);
        expect(t.halfMonthEntitlement).toBe(15000);
        expect(t.divisorMode).toBe('PERIOD_WORKING_DAYS');
        expect(t.overtimeExempt).toBe(true);
    });
});

describe('computePayslip — monthly salary splits exactly', () => {
    // The property that motivated the whole change: two cutoffs must reconstruct
    // the monthly salary to the centavo, for any salary and any cutoff shape.
    it.each([30000, 25000.01, 18333.33, 41666.67, 99999.99, 7.77])(
        'cutoff 1 + cutoff 2 === %p exactly',
        (salary) => {
            const run = (cutoffSeq, schedDays) => basicOf(computePayslip(monthlyBase({
                cutoffSeq,
                compensation: { ...monthlyBase().compensation, base_rate: salary },
                periodDays: { schedDaysInPeriod: schedDays, schedDaysInMonth: 26, contractDays: schedDays },
                dtrSummary: { days_paid: schedDays, days_absent: 0, days_lwop: 0 },
            })));
            // Deliberately lopsided cutoffs — 12 days then 14 — which is exactly
            // what broke the old daily-rate approach.
            expect(round2(run(1, 12) + run(2, 14))).toBe(round2(salary));
        }
    );

    it('holds across every month shape including a leap February', () => {
        const salary = 33333.33;
        // (cutoff 1 days, cutoff 2 days) for Feb 2028 (leap), Feb 2026, and a 31-day month.
        for (const [d1, d2] of [[13, 13], [13, 12], [13, 14]]) {
            const run = (cutoffSeq, schedDays) => basicOf(computePayslip(monthlyBase({
                cutoffSeq,
                compensation: { ...monthlyBase().compensation, base_rate: salary },
                periodDays: { schedDaysInPeriod: schedDays, schedDaysInMonth: d1 + d2, contractDays: schedDays },
                dtrSummary: { days_paid: schedDays, days_absent: 0, days_lwop: 0 },
            })));
            expect(round2(run(1, d1) + run(2, d2))).toBe(salary);
        }
    });
});

describe('computePayslip — leave without pay', () => {
    it('deducts approved LWOP even under a GUARANTEED salary', () => {
        const result = computePayslip(monthlyBase({
            dtrSummary: { days_paid: 12, days_absent: 0, days_lwop: 2 },
        }));
        // 15,000 / 14 scheduled days = 1,071.4286 per day, 2 days off.
        expect(basicOf(result)).toBe(12857.14);
        const line = result.lines.find((l) => l.componentCode === 'LWOP');
        expect(line.amount).toBe(-2142.86);
        expect(line.lineType).toBe('EARNING'); // negative earning, not a deduction
    });

    it('reduces gross and taxable income, not just net', () => {
        const clean = computePayslip(monthlyBase());
        const withLwop = computePayslip(monthlyBase({
            dtrSummary: { days_paid: 12, days_absent: 0, days_lwop: 2 },
        }));
        expect(withLwop.header.gross_pay).toBeLessThan(clean.header.gross_pay);
        expect(withLwop.header.taxable_income).toBeLessThan(clean.header.taxable_income);
    });

    it('handles a half-day unpaid leave', () => {
        const result = computePayslip(monthlyBase({
            dtrSummary: { days_paid: 13.5, days_absent: 0, days_lwop: 0.5 },
        }));
        expect(basicOf(result)).toBe(14464.29); // 15,000 - 535.71
    });
});

describe('computePayslip — monthly ATTENDANCE model', () => {
    const attendance = (overrides = {}) => monthlyBase({
        compensation: { ...monthlyBase().compensation, salary_model: 'ATTENDANCE' },
        ...overrides,
    });

    it('deducts unpaid absences', () => {
        expect(basicOf(computePayslip(attendance({
            dtrSummary: { days_paid: 11, days_absent: 3, days_lwop: 0 },
        })))).toBe(11785.71); // 15,000 - 3 * 1,071.4286
    });

    it('lands exactly on zero when every scheduled day is absent', () => {
        const result = computePayslip(attendance({
            dtrSummary: { days_paid: 0, days_absent: 14, days_lwop: 0 },
        }));
        expect(basicOf(result)).toBe(0);
    });

    it('never goes negative when absences exceed the scheduled days', () => {
        expect(basicOf(computePayslip(attendance({
            dtrSummary: { days_paid: 0, days_absent: 20, days_lwop: 3 },
        })))).toBe(0);
    });

    it('still charges statutory contributions on a fully-absent cutoff', () => {
        const result = computePayslip(attendance({
            dtrSummary: { days_paid: 0, days_absent: 14, days_lwop: 0 },
        }));
        expect(result.header.monthly_basis).toBe(30000);
        expect(result.header.sss_ee).toBe(500);
    });
});

describe('computePayslip — mid-cutoff hire and separation', () => {
    it('prorates basic pay to the days inside the contract', () => {
        const result = computePayslip(monthlyBase({
            cutoffSeq: 2,
            periodDays: { schedDaysInPeriod: 14, schedDaysInMonth: 26, contractDays: 10 },
            dtrSummary: { days_paid: 10, days_absent: 0, days_lwop: 0 },
        }));
        expect(basicOf(result)).toBe(10714.29); // 15,000 * 10/14
    });

    it('leaves the statutory basis at the FULL monthly salary', () => {
        const result = computePayslip(monthlyBase({
            cutoffSeq: 2,
            periodDays: { schedDaysInPeriod: 14, schedDaysInMonth: 26, contractDays: 10 },
            dtrSummary: { days_paid: 10, days_absent: 0, days_lwop: 0 },
        }));
        expect(result.header.monthly_basis).toBe(30000);
        expect(result.trace.partialContract).toBe(true);
    });

    it('deducts LWOP against the prorated entitlement, not the full half', () => {
        const result = computePayslip(monthlyBase({
            periodDays: { schedDaysInPeriod: 14, schedDaysInMonth: 26, contractDays: 10 },
            dtrSummary: { days_paid: 9, days_absent: 0, days_lwop: 1 },
        }));
        // entitlement 10,714.29, day value 10,714.29/10 = 1,071.429
        expect(basicOf(result)).toBe(9642.86);
    });
});

describe('computePayslip — monthly edge cases', () => {
    it('pays the entitlement and deducts nothing when no schedule is attached', () => {
        const result = computePayslip(monthlyBase({
            periodDays: { schedDaysInPeriod: 0, schedDaysInMonth: 0, contractDays: 0 },
            dtrSummary: { days_paid: 0, days_absent: 5, days_lwop: 2 },
        }));
        expect(basicOf(result)).toBe(15000);
        expect(Number.isFinite(result.header.net_pay)).toBe(true);
    });

    it('defaults to GUARANTEED when no salary model is recorded', () => {
        const result = computePayslip(monthlyBase({
            compensation: { ...monthlyBase().compensation, salary_model: null },
            dtrSummary: { days_paid: 11, days_absent: 3, days_lwop: 0 },
        }));
        expect(basicOf(result)).toBe(15000);
    });

    it('reconciles net, gross and the payslip lines in every monthly case', () => {
        const cases = [
            monthlyBase(),
            monthlyBase({ dtrSummary: { days_paid: 12, days_absent: 0, days_lwop: 2 } }),
            monthlyBase({
                compensation: { ...monthlyBase().compensation, salary_model: 'ATTENDANCE' },
                dtrSummary: { days_paid: 0, days_absent: 14, days_lwop: 0 },
            }),
        ];
        for (const input of cases) {
            const { header, lines } = computePayslip(input);
            expect(header.net_pay).toBe(round2(header.gross_pay - header.total_deductions));
            const earnings = lines
                .filter((l) => l.lineType === 'EARNING')
                .reduce((sum, l) => round2(sum + l.amount), 0);
            expect(earnings).toBe(header.gross_pay);
        }
    });
});

// --- Job-order / contract-of-service workers -----------------------------
// A job-order worker is outside SSS/PhilHealth/Pag-IBIG coverage entirely, and
// is paid a gross fee with no compensation withholding. The guard must suppress
// the employer share too — that is the half an amount-override cannot reach.

describe('computePayslip — statutory coverage EXEMPT', () => {
    const exemptBase = (overrides = {}) => ({
        employee: { employee_id: 21, employee_name: 'Rico Delgado', worker_class: 'JOB_ORDER' },
        compensation: {
            compensation_id: 7, pay_basis: 'daily', base_rate: 800,
            days_per_year: 313, statutory_coverage: 'EXEMPT',
        },
        dtrSummary: { days_paid: 12, overtime_hours: 0 },
        loans: [], policy: POLICY, statutoryTables: TABLES, cutoffSeq: 1,
        ...overrides,
    });

    it('deducts no employee contributions and no withholding tax', () => {
        const h = computePayslip(exemptBase()).header;
        expect(h.sss_ee).toBe(0);
        expect(h.sss_mpf_ee).toBe(0);
        expect(h.philhealth_ee).toBe(0);
        expect(h.pagibig_ee).toBe(0);
        expect(h.withholding_tax).toBe(0);
        expect(h.taxable_income).toBe(0);
    });

    it('incurs no EMPLOYER share either', () => {
        const h = computePayslip(exemptBase()).header;
        expect(h.sss_er).toBe(0);
        expect(h.sss_mpf_er).toBe(0);
        expect(h.sss_ec).toBe(0);
        expect(h.philhealth_er).toBe(0);
        expect(h.pagibig_er).toBe(0);
        expect(h.total_employer_contrib).toBe(0);
    });

    it('pays the gross fee out in full', () => {
        const h = computePayslip(exemptBase()).header;
        expect(h.gross_pay).toBe(9600); // 800 x 12
        expect(h.net_pay).toBe(9600);
        expect(h.total_deductions).toBe(0);
    });

    it('emits no statutory lines at all on the payslip', () => {
        const { lines } = computePayslip(exemptBase());
        const statutoryCodes = ['SSS_EE', 'SSS_MPF_EE', 'PHIC_EE', 'HDMF_EE', 'WTAX',
            'SSS_ER', 'SSS_MPF_ER', 'SSS_EC', 'PHIC_ER', 'HDMF_ER'];
        for (const code of statutoryCodes) {
            expect(lines.find((l) => l.componentCode === code)).toBeUndefined();
        }
    });

    it('does not lift a low fee to the PhilHealth income floor', () => {
        // The floor is 10,000/month. Zeroing AFTER computing would have invented
        // a 250 deduction here, so the tables must be skipped, not zeroed.
        const h = computePayslip(exemptBase({
            compensation: { compensation_id: 7, pay_basis: 'daily', base_rate: 300, days_per_year: 313, statutory_coverage: 'EXEMPT' },
        })).header;
        expect(h.philhealth_ee).toBe(0);
        expect(h.monthly_basis).toBe(0);
    });

    it('cannot have coverage reintroduced by a standing or run override', () => {
        const h = computePayslip(exemptBase({
            statutoryOverrides: { SSS_EE: 1000, PHIC_EE: 500, WTAX: 2000 },
            adjustments: [{ adjustment_type: 'OVERRIDE', component_code: 'HDMF_EE', amount: 200 }],
        })).header;
        expect(h.sss_ee).toBe(0);
        expect(h.philhealth_ee).toBe(0);
        expect(h.withholding_tax).toBe(0);
        expect(h.pagibig_ee).toBe(0);
    });

    it('still recovers a cash advance', () => {
        const r = computePayslip(exemptBase({
            loans: [{
                loan_id: 5, loan_type: 'CASH_ADVANCE', component_code: 'CASH_ADVANCE',
                principal_amount: 3000, amortization_amount: 1000, amount_paid: 0, deduct_on_cutoff: 1,
            }],
        }));
        expect(r.header.loans_total).toBe(1000);
        expect(r.header.net_pay).toBe(8600);
    });

    it('records the class and coverage for audit', () => {
        const r = computePayslip(exemptBase());
        expect(r.header.worker_class).toBe('JOB_ORDER');
        expect(r.header.statutory_coverage).toBe('EXEMPT');
        expect(r.trace.statutoryCoverage).toBe('EXEMPT');
    });

    it('works with a flat monthly fee as well as a daily rate', () => {
        const h = computePayslip(exemptBase({
            compensation: {
                compensation_id: 8, pay_basis: 'monthly', salary_model: 'GUARANTEED',
                base_rate: 40000, days_per_year: 313, statutory_coverage: 'EXEMPT',
                is_overtime_exempt: true,
            },
            periodDays: { schedDaysInPeriod: 13, schedDaysInMonth: 26, contractDays: 13 },
            dtrSummary: { days_paid: 13, days_absent: 0, days_lwop: 0 },
        })).header;
        expect(h.basic_pay).toBe(20000);
        expect(h.net_pay).toBe(20000);
        expect(h.total_employer_contrib).toBe(0);
    });
});

describe('computePayslip — coverage guard is inert for employees', () => {
    it('leaves a COVERED employee exactly as before', () => {
        const covered = {
            employee: { employee_id: 3, employee_name: 'Grace Pilar' },
            compensation: {
                compensation_id: 1, pay_basis: 'daily', base_rate: 610,
                days_per_year: 313, statutory_coverage: 'COVERED',
            },
            dtrSummary: { days_paid: 13, overtime_hours: 0 },
            loans: [], policy: POLICY, statutoryTables: TABLES, cutoffSeq: 1,
        };
        const h = computePayslip(covered).header;
        // Same figures the pre-existing rank-and-file suite asserts.
        expect(h.monthly_basis).toBe(15910.83);
        expect(h.sss_ee).toBe(400);
        expect(h.net_pay).toBe(round2(h.gross_pay - h.total_deductions));
        expect(h.total_employer_contrib).toBeGreaterThan(0);
    });

    it('treats a missing coverage value as COVERED', () => {
        const h = computePayslip({
            employee: { employee_id: 3, employee_name: 'Grace Pilar' },
            compensation: { compensation_id: 1, pay_basis: 'daily', base_rate: 610, days_per_year: 313 },
            dtrSummary: { days_paid: 13, overtime_hours: 0 },
            loans: [], policy: POLICY, statutoryTables: TABLES, cutoffSeq: 1,
        }).header;
        expect(h.sss_ee).toBe(400);
        expect(h.statutory_coverage).toBe('COVERED');
    });
});
