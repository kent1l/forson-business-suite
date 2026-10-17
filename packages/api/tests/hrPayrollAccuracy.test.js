'use strict';

const { computePayslip, computeBasicPay } = require('../services/hr/payrollCalculationService');
const { computeWithholdingTax } = require('../services/hr/statutoryService');
const { payslipIssues, assertPayslip } = require('../services/hr/payrollIntegrityService');
const { buildSlip, _trimNum } = require('../helpers/pdf/payslipPdf');
const { _internal: dtr } = require('../services/hr/dtrService');
const punches = require('../services/hr/timePunchService');

const policy = { workingDaysPerYear: 313, standardHoursPerDay: 8, monthlyDivisorMode: 'PERIOD_WORKING_DAYS',
    statutorySchedule: 'SPLIT_HALF', otRateOrdinary: 1.25, otRateRestDay: 1.69,
    regularHolidayRate: 2, regularHolidayUnworked: 1, specialHolidayRate: 1.3, restDayRate: 1.3, nightDiffRate: 0.1 };
const tables = { versions: {}, sssBrackets: [{ range_from: 0, range_to: null, msc: 5000,
    ee_amount: 250, er_amount: 500, ec_amount: 10, mpf_ee: 0, mpf_er: 0 }],
    philhealth: { premium_rate: .05, income_floor: 10000, income_ceiling: 100000, ee_share_ratio: .5 },
    pagibig: { threshold_amount: 1500, ee_rate_below: .01, ee_rate_above: .02, er_rate: .02, max_compensation: 10000 },
    birByFrequency: { SEMI_MONTHLY: [
        { bracket_seq: 1, lower_bound: 0, upper_bound: 10417, base_tax: 0, rate_percent: 0, excess_over: 0 },
        { bracket_seq: 2, lower_bound: 10417, upper_bound: 16666, base_tax: 0, rate_percent: .15, excess_over: 10417 },
        { bracket_seq: 3, lower_bound: 16667, upper_bound: 33332, base_tax: 937.5, rate_percent: .20, excess_over: 16667 },
        { bracket_seq: 4, lower_bound: 33333, upper_bound: null, base_tax: 4270.7, rate_percent: .25, excess_over: 33333 },
    ] } };
const day = (overrides = {}) => ({ work_date: '2026-08-31', day_type: 'Present', day_fraction: 1,
    is_rest_day: false, overtime_hours: 0, night_diff_hours: 0, ...overrides });
const input = (days, overrides = {}) => ({ employee: { employee_id: 1, worker_class: 'EMPLOYEE' },
    compensation: { pay_basis: 'daily', base_rate: 800 },
    dtrSummary: { days_paid: days.reduce((sum, row) => sum + Number(row.day_fraction), 0),
        overtime_hours: days.reduce((sum, row) => sum + Number(row.overtime_hours), 0), days },
    policy, statutoryTables: tables, cutoffSeq: 1, ...overrides });

describe('independent premium reference cases (800/day, 100/hour)', () => {
    it.each([
        ['ordinary', {}, 800],
        ['regular holiday', { day_type: 'Holiday Worked', holiday_type: 'Regular' }, 1600],
        ['regular holiday on rest day', { day_type: 'Holiday Worked', holiday_type: 'Regular', is_rest_day: true }, 2080],
        ['special holiday', { day_type: 'Holiday Worked', holiday_type: 'Special Non-Working' }, 1040],
        ['special holiday on rest day', { day_type: 'Holiday Worked', holiday_type: 'Special Non-Working', is_rest_day: true }, 1200],
        ['rest day', { day_type: 'Rest Day Worked', is_rest_day: true }, 1040],
        ['special working holiday', { holiday_type: 'Special Working' }, 800],
        ['unworked eligible regular holiday', { day_type: 'Holiday', day_fraction: 0, holiday_type: 'Regular', holiday_eligible: true }, 800],
        ['ineligible regular holiday', { day_type: 'Holiday', day_fraction: 0, holiday_type: 'Regular', holiday_eligible: false }, 0],
        ['unworked special holiday', { day_type: 'Holiday', day_fraction: 0, holiday_type: 'Special Non-Working' }, 0],
    ])('%s pays %s with reconciling lines', (_label, overrides, gross) => {
        const result = computePayslip(input([day(overrides)]));
        expect(result.header.gross_pay).toBe(gross);
        expect(payslipIssues(result.header, result.lines)).toEqual([]);
    });

    it.each([
        [{}, 125],
        [{ day_type: 'Rest Day Worked', is_rest_day: true }, 169],
        [{ day_type: 'Holiday Worked', holiday_type: 'Regular' }, 260],
        [{ day_type: 'Holiday Worked', holiday_type: 'Regular', is_rest_day: true }, 338],
        [{ day_type: 'Holiday Worked', holiday_type: 'Special Non-Working' }, 169],
        [{ day_type: 'Holiday Worked', holiday_type: 'Special Non-Working', is_rest_day: true }, 195],
    ])('one OT hour uses its day classification %j', (overrides, expected) => {
        expect(computePayslip(input([day({ ...overrides, overtime_hours: 1 })])).header.overtime_pay).toBe(expected);
    });

    it('night differential uses the holiday hourly wage', () => {
        expect(computePayslip(input([day({ day_type: 'Holiday Worked', holiday_type: 'Regular', night_diff_hours: 4 })])).header.night_diff_pay).toBe(80);
    });
    it('does not invent OT/night overlap or holiday eligibility', () => {
        expect(() => computePayslip(input([day({ overtime_hours: 1, night_diff_hours: 2 })]))).toThrow(/overlap/);
        expect(() => computePayslip(input([day({ day_type: 'Holiday', day_fraction: 0, holiday_type: 'Regular' })]))).toThrow(/eligibility/);
        expect(() => computePayslip(input([day({ day_type: 'Holiday Worked' })]))).toThrow(/calendar/);
    });
    it('does not invent employee premiums on a job-order contract', () => {
        const result = computePayslip(input([day({ day_type: 'Holiday Worked', holiday_type: 'Regular' })],
            { employee: { employee_id: 1, worker_class: 'JOB_ORDER' } }));
        expect(result.header.gross_pay).toBe(800);
    });
    it('does not add an unworked holiday twice when its base was explicitly paid in DTR', () => {
        expect(computePayslip(input([day({ day_type: 'Holiday', holiday_type: 'Regular' })])).header.gross_pay).toBe(800);
    });
});

describe('monthly attendance policy confirmed by the user', () => {
    const monthly = (salaryModel, summary) => ({ compensation: { pay_basis: 'monthly', salary_model: salaryModel, base_rate: 30000 },
        dtrSummary: summary, periodDays: { schedDaysInPeriod: 14, schedDaysInMonth: 26, contractDays: 14 }, policy, cutoffSeq: 1 });
    it('deducts an unpaid half-day at the cutoff divisor, leaving tardiness and undertime paid', () => {
        const basic = computeBasicPay(monthly('ATTENDANCE', { days_paid: 13.5, days_half_unpaid: .5, late_minutes: 120, undertime_minutes: 120 }));
        expect(basic.basicPay).toBe(14464.29);
        expect(basic.deductionLines).toHaveLength(1);
    });
    it('does not reduce a guaranteed salary for half-days', () => {
        expect(computeBasicPay(monthly('GUARANTEED', { days_half_unpaid: .5 })).basicPay).toBe(15000);
    });
    it('keeps a full attendance salary when only late/undertime minutes are recorded', () => {
        expect(computeBasicPay(monthly('ATTENDANCE', { days_paid: 14, late_minutes: 90, undertime_minutes: 60 })).basicPay).toBe(15000);
    });
    it('adds only the holiday premium to monthly pay already including the base day', () => {
        const args = monthly('ATTENDANCE', {});
        const dailyEquivalent = 1150.16;
        const result = computePayslip(input([day({ day_type: 'Holiday Worked', holiday_type: 'Regular' })], {
            ...args, dtrSummary: { days_paid: 1, days: [day({ day_type: 'Holiday Worked', holiday_type: 'Regular' })] },
        }));
        expect(result.header.gross_pay).toBe(15000 + dailyEquivalent);
        expect(payslipIssues(result.header, result.lines)).toEqual([]);
    });
});

describe('BIR centavo boundary regressions', () => {
    it.each([[10416.99, 0], [10417, 0], [10417.01, 0], [16666.50, 937.43],
        [16666.99, 937.50], [16667, 937.50], [33332.99, 4270.70], [33333, 4270.70]])(
        '%s taxable income withholds %s', (income, expected) => expect(computeWithholdingTax(tables, income).tax).toBe(expected));
});

describe('statement accuracy and fail-closed computation', () => {
    it('keeps a one-off addition independent of an override on its recurring component', () => {
        const component = { component_code: 'ALLOWANCE', component_name: 'Allowance', component_type: 'EARNING',
            amount: 1000, is_taxable: true, frequency: 'EVERY_CUTOFF' };
        const result = computePayslip(input([day()], { payComponents: [component], adjustments: [
            { ...component, adjustment_type: 'OVERRIDE', amount: 250 },
            { ...component, adjustment_type: 'ADD', amount: 50 },
        ] }));
        expect(result.header.allowances_taxable).toBe(300);
        expect(payslipIssues(result.header, result.lines)).toEqual([]);
    });
    it('refuses an override that would silently do nothing', () => {
        expect(() => computePayslip(input([day()], { adjustments: [{ component_code: 'BASIC', adjustment_type: 'OVERRIDE', amount: 100 }] }))).toThrow(/no recurring/);
    });
    it('final pay treats ADD on a deduction component as a deduction and records taxable additions', () => {
        const result = computePayslip(input([], { runType: 'FINAL_PAY', finalPay: { basicEarnedThisYear: 120000 }, adjustments: [
            { component_code: 'OTHER_DEDUCTION', component_type: 'DEDUCTION', adjustment_type: 'ADD', amount: 500 },
            { component_code: 'BONUS', component_type: 'EARNING', adjustment_type: 'ADD', amount: 1000, is_taxable: true },
        ] }));
        expect(result.header.gross_pay).toBe(11000);
        expect(result.header.other_deductions).toBe(500);
        expect(result.header.net_pay).toBe(10500);
        expect(result.header.taxable_income).toBe(1000);
        expect(result.trace.requiresAnnualisation).toBe(true);
        expect(payslipIssues(result.header, result.lines)).toEqual([]);
    });
    it('does not tax a previously assessed 13th-month excess a second time', () => {
        const result = computePayslip(input([], { runType: 'FINAL_PAY',
            finalPay: { basicEarnedThisYear: 1200000, thirteenthMonthAlreadyPaid: 95000 } }));
        expect(result.header.gross_pay).toBe(5000);
        expect(result.header.taxable_income).toBe(5000);
    });
    it('detects a one-cent line/header mismatch and invalid amounts', () => {
        const result = computePayslip(input([day()]));
        expect(() => assertPayslip(result.header, result.lines)).not.toThrow();
        expect(() => assertPayslip(result.header, [{ ...result.lines[0], amount: 800.01 }, ...result.lines.slice(1)])).toThrow(/Earning lines/);
        expect(payslipIssues({ ...result.header, gross_pay: NaN }, result.lines)).not.toEqual([]);
    });
    it.each(['SPECIAL', 'THIRTEENTH_MONTH'])('does not pay regular salary again on %s', (runType) => {
        expect(() => computePayslip(input([day()], { runType }))).toThrow(/dedicated/);
    });
    it('does not describe monthly basic as quantity multiplied by the equivalent daily rate', () => {
        const view = buildSlip({ pay_basis: 'monthly', salary_model: 'ATTENDANCE', daily_rate: 1150.16, days_paid: 13.125 },
            [{ line_type: 'EARNING', component_code: 'BASIC', description: 'Basic Pay', quantity: 14, rate: 1150.16, amount: 15000 }],
            { company: { name: 'Test' } });
        expect(view.earnings[0].qty).toBeNull();
        expect(view.rate_label).toBe('Equivalent daily rate');
        expect(view.days_paid).toBe('13.125');
        expect(_trimNum(.125)).toBe('0.125');
    });
    it('treats a special working holiday as an ordinary scheduled day', () => {
        const resolved = dtr.resolveDay({ isoDate: '2026-08-03', scheduleDay: { time_in: '08:00', time_out: '17:00' },
            holiday: { holiday_id: 1, holiday_type: 'Special Working' } });
        expect(resolved.day_type).toBe('Present');
        expect(resolved.day_fraction).toBe(1);
    });
    it('renders punch times in Manila, including midnight', () => {
        expect(punches._internal.toTime('2026-08-14T01:30:00Z')).toBe('09:30:00');
        expect(punches._internal.toTime('2026-08-13T16:00:00Z')).toBe('00:00:00');
    });
});
