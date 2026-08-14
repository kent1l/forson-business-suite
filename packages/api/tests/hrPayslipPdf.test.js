const { buildSlip, paginate, VALID_PER_PAGE, _money, _trimNum } = require('../helpers/pdf/payslipPdf');
const { parsePunchCsv, _internal } = require('../services/hr/timePunchService');

const PAYSLIP = {
    payslip_id: 1, payslip_no: 'PAY-202609-0001-001',
    employee_name: 'Grace Pilar', employee_code: 'EMP-0003',
    position_title: 'Secretary', department_name: 'Administration',
    gross_pay: '10150.00', total_deductions: '698.89', net_pay: '9451.11',
    days_paid: '15.000', overtime_hours: '0.00', daily_rate: '610.00',
    total_employer_contrib: '1113.89',
};

const LINES = [
    { line_type: 'EARNING', component_code: 'BASIC', description: 'Basic Pay', quantity: '15', rate: '610', amount: '9150.00', sort_order: 1 },
    { line_type: 'EARNING', component_code: 'ALLOWANCE_RICE', description: 'Rice Allowance', quantity: null, rate: null, amount: '1000.00', sort_order: 10 },
    { line_type: 'EARNING', component_code: 'OT_REG', description: 'Overtime Pay', quantity: '0', rate: '95', amount: '0.00', sort_order: 2 },
    { line_type: 'DEDUCTION', component_code: 'SSS_EE', description: 'SSS Contribution', quantity: null, rate: null, amount: '400.00', sort_order: 30 },
    { line_type: 'DEDUCTION', component_code: 'PHIC_EE', description: 'PhilHealth Contribution', quantity: null, rate: null, amount: '198.89', sort_order: 32 },
    { line_type: 'DEDUCTION', component_code: 'HDMF_EE', description: 'Pag-IBIG Contribution', quantity: null, rate: null, amount: '100.00', sort_order: 33 },
    { line_type: 'EMPLOYER_CONTRIBUTION', component_code: 'SSS_ER', description: 'SSS Employer Share', quantity: null, rate: null, amount: '800.00', sort_order: 50 },
];

const CTX = { company: { name: 'Forson Trading' }, periodLabel: '2026-09-01 to 2026-09-15', payDate: '2026-09-15' };

describe('buildSlip', () => {
    const slip = buildSlip(PAYSLIP, LINES, CTX);

    it('splits lines into earnings and deductions', () => {
        expect(slip.earnings.map((e) => e.label)).toEqual(['Basic Pay', 'Rice Allowance']);
        expect(slip.deductions.map((d) => d.label))
            .toEqual(['SSS Contribution', 'PhilHealth Contribution', 'Pag-IBIG Contribution']);
    });

    it('drops zero-value lines, which cost space and say nothing', () => {
        expect(slip.earnings.find((e) => e.label === 'Overtime Pay')).toBeUndefined();
    });

    it('keeps employer contributions off the slip body', () => {
        const labels = [...slip.earnings, ...slip.deductions].map((l) => l.label);
        expect(labels).not.toContain('SSS Employer Share');
        // It appears only as the explanatory footnote.
        expect(slip.show_employer_note).toBe(true);
    });

    it('shows a quantity only where it varies', () => {
        expect(slip.earnings.find((e) => e.label === 'Basic Pay').qty).toBe('15 @ 610.00');
        expect(slip.earnings.find((e) => e.label === 'Rice Allowance').qty).toBeNull();
    });

    it('orders lines by their sort order, not insertion order', () => {
        const many = buildSlip(PAYSLIP, [
            { line_type: 'DEDUCTION', description: 'Withholding Tax', amount: '10', sort_order: 34 },
            { line_type: 'DEDUCTION', description: 'SSS Contribution', amount: '20', sort_order: 30 },
        ], CTX);
        expect(many.deductions.map((d) => d.label)).toEqual(['SSS Contribution', 'Withholding Tax']);
    });

    it('formats money with thousands separators and two decimals', () => {
        expect(slip.gross_pay).toBe('10,150.00');
        expect(slip.net_pay).toBe('9,451.11');
    });

    it('suppresses the overtime stat when there is none', () => {
        expect(slip.overtime_hours).toBeNull();
    });

    it('carries the identity snapshot, not a live lookup', () => {
        expect(slip.employee_name).toBe('Grace Pilar');
        expect(slip.employee_code).toBe('EMP-0003');
        expect(slip.payslip_no).toBe('PAY-202609-0001-001');
    });
});

describe('paginate', () => {
    const slips = Array.from({ length: 7 }, (_, i) => ({ n: i }));

    it('chunks slips into sheets', () => {
        const sheets = paginate(slips, 4);
        expect(sheets).toHaveLength(2);
        expect(sheets[0].slips).toHaveLength(4);
        expect(sheets[1].slips).toHaveLength(3);
    });

    it('flags the last slip on each sheet so it drops its cut rule', () => {
        const sheets = paginate(slips, 4);
        expect(sheets[0].slips[3].lastInSheet).toBe(true);
        expect(sheets[0].slips[0].lastInSheet).toBe(false);
        expect(sheets[1].slips[2].lastInSheet).toBe(true);
    });

    it('handles an exact fit without an empty trailing sheet', () => {
        expect(paginate(Array.from({ length: 8 }, (_, i) => ({ n: i })), 4)).toHaveLength(2);
    });

    it('handles a single slip', () => {
        const sheets = paginate([{ n: 1 }], 4);
        expect(sheets).toHaveLength(1);
        expect(sheets[0].slips[0].lastInSheet).toBe(true);
    });
});

describe('layout density', () => {
    it('offers only densities that fit a slip with a full set of deductions', () => {
        // 5-up clipped the Total Deductions row and 6-up overlapped the net pay
        // when tested against a six-deduction slip, so both were removed.
        expect(VALID_PER_PAGE).toEqual([2, 3, 4]);
    });
});

describe('formatters', () => {
    it('formats money without a currency symbol', () => {
        expect(_money('1234.5')).toBe('1,234.50');
        expect(_money(0)).toBe('0.00');
        expect(_money(null)).toBe('0.00');
    });

    it('trims trailing zeros from counts so "15.000" reads as "15"', () => {
        expect(_trimNum('15.000')).toBe('15');
        expect(_trimNum('12.50')).toBe('12.5');
        expect(_trimNum(0)).toBe('0');
    });
});

// --- Biometric import ----------------------------------------------------

describe('parsePunchCsv', () => {
    it('reads a standard export', () => {
        const { rows, errors } = parsePunchCsv(
            'biometric_id,timestamp,direction\n1001,2026-09-01 07:02:11,IN\n1001,2026-09-01 17:04:55,OUT'
        );
        expect(errors).toHaveLength(0);
        expect(rows).toHaveLength(2);
        expect(rows[0].biometricId).toBe('1001');
        expect(rows[0].direction).toBe('IN');
        expect(rows[1].direction).toBe('OUT');
    });

    it('accepts the various header names terminals emit', () => {
        const { rows } = parsePunchCsv('user_id,datetime,status\n7,2026-09-01 08:00:00,I');
        expect(rows[0].biometricId).toBe('7');
        expect(rows[0].direction).toBe('IN');
    });

    it('decodes the direction encodings terminals use', () => {
        const { rows } = parsePunchCsv(
            'id,time,type\n1,2026-09-01 07:00:00,0\n2,2026-09-01 17:00:00,1\n'
            + '3,2026-09-01 07:00:00,Check-In\n4,2026-09-01 17:00:00,CHECK-OUT'
        );
        expect(rows.map((r) => r.direction)).toEqual(['IN', 'OUT', 'IN', 'OUT']);
    });

    it('leaves the direction null when the terminal does not record one', () => {
        const { rows } = parsePunchCsv('id,time\n1,2026-09-01 07:00:00');
        expect(rows[0].direction).toBeNull();
    });

    it('refuses a file without the columns it needs', () => {
        const { rows, errors } = parsePunchCsv('name,department\nJuan,Sales');
        expect(rows).toHaveLength(0);
        expect(errors[0]).toMatch(/needs at least a biometric id column/);
    });

    it('reports unreadable rows rather than dropping them silently', () => {
        // A payroll import must never lose a punch without saying so.
        const { rows, errors } = parsePunchCsv(
            'id,time\n1,2026-09-01 07:00:00\n2,not-a-date\n,2026-09-01 08:00:00'
        );
        expect(rows).toHaveLength(1);
        expect(errors).toHaveLength(2);
        expect(errors[0]).toMatch(/unreadable timestamp/);
        expect(errors[1]).toMatch(/missing id or timestamp/);
    });

    it('handles an empty file', () => {
        expect(parsePunchCsv('').errors[0]).toMatch(/empty/);
    });
});

describe('punch hour derivation', () => {
    const { hoursBetween } = _internal;

    it('nets the break out of the span', () => {
        expect(hoursBetween('2026-09-01T07:00:00Z', '2026-09-01T17:00:00Z', 60)).toBe(9);
    });

    it('returns zero when the out precedes the in', () => {
        expect(hoursBetween('2026-09-01T17:00:00Z', '2026-09-01T07:00:00Z', 0)).toBe(0);
    });

    it('never goes negative when the break exceeds the span', () => {
        expect(hoursBetween('2026-09-01T07:00:00Z', '2026-09-01T07:30:00Z', 60)).toBe(0);
    });
});
