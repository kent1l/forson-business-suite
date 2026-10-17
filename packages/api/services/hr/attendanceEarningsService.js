'use strict';

const { round2 } = require('./statutoryService');

const invalid = (message) => {
    const error = new Error(message);
    error.code = 'PAYROLL_INPUT_REVIEW_REQUIRED';
    error.status = 422;
    throw error;
};

/** Day-specific premiums cannot be recovered from a cutoff's total OT hours. */
const computeAttendanceEarnings = ({ employee, compensation, summary, dailyRate, hourlyRate, policy }) => {
    const days = summary.days;
    const exempt = Boolean(compensation.is_overtime_exempt);
    const contractor = employee.worker_class === 'JOB_ORDER';
    const lines = [];
    const totals = { holidayPay: 0, overtimePay: 0, nightDiffPay: 0 };
    const add = (key, code, description, quantity, rate) => {
        const amount = round2(quantity * rate);
        if (!amount) return;
        totals[key] = round2(totals[key] + amount);
        lines.push({ lineType: 'EARNING', componentCode: code, description,
            quantity, rate: round2(rate), amount, isTaxable: true, sortOrder: 3 });
    };
    if (!Array.isArray(days)) {
        if (Number(summary.days_holiday) || Number(summary.days_holiday_worked) || Number(summary.days_rest_day_worked)) {
            invalid('Daily records with holiday type and rest-day status are required to calculate premiums.');
        }
        if (!exempt) {
            add('overtimePay', 'OT_REG', 'Ordinary Overtime', Number(summary.overtime_hours) || 0,
                hourlyRate * Number(policy.otRateOrdinary || 1.25));
            add('nightDiffPay', 'NIGHT_DIFF', 'Night Differential', Number(summary.night_diff_hours) || 0,
                hourlyRate * Number(policy.nightDiffRate || 0.10));
        }
        return { ...totals, lines };
    }

    for (const day of days) {
        const fraction = Number(day.day_fraction) || 0;
        const worked = ['Present', 'Half Day', 'Holiday Worked', 'Rest Day Worked'].includes(day.day_type);
        const rest = day.is_rest_day || day.day_type === 'Rest Day Worked';
        const type = day.holiday_type;
        if (day.day_type.startsWith('Holiday') && !type) {
            invalid(`${day.work_date}: attach the holiday calendar entry before computing payroll.`);
        }
        if (type === 'Local' && !contractor) {
            invalid(`${day.work_date}: classify the local holiday as regular, special non-working or special working before computing payroll.`);
        }
        const regular = type === 'Regular';
        const special = type === 'Special Non-Working';
        let multiplier = 1;
        if (!contractor) {
            if (regular) multiplier = Number(policy.regularHolidayRate || 2) * (rest ? Number(policy.restDayRate || 1.3) : 1);
            else if (special) multiplier = rest ? 1.5 : Number(policy.specialHolidayRate || 1.3);
            else if (rest) multiplier = Number(policy.restDayRate || 1.3);
        }

        if (worked && !contractor && multiplier !== 1) {
            // Monthly salary already includes the base wage on scheduled days;
            // an unscheduled rest day has no such base payment to subtract.
            const included = compensation.pay_basis === 'monthly' && rest ? 0 : 1;
            add('holidayPay', regular ? 'HOLIDAY_REG' : special ? 'HOLIDAY_SPECIAL' : 'REST_DAY',
                `${regular ? 'Regular Holiday' : special ? 'Special Holiday' : 'Rest Day'} Premium (${day.work_date})`,
                fraction, dailyRate * (multiplier - included));
        }

        if (!worked && regular && !contractor && compensation.pay_basis === 'daily') {
            const eligible = fraction > 0 || day.holiday_eligible;
            if (eligible == null) invalid(`${day.work_date}: preceding working-day attendance is missing; review holiday pay eligibility.`);
            if (eligible) add('holidayPay', 'HOLIDAY_UNWORKED', `Regular Holiday Pay (${day.work_date})`,
                Math.max(1 - fraction, 0), dailyRate * Number(policy.regularHolidayUnworked || 1));
        }

        if (exempt) continue;
        const ot = Number(day.overtime_hours) || 0;
        const night = Number(day.night_diff_hours) || 0;
        if (!worked && (ot || night)) invalid(`${day.work_date}: overtime or night hours require a worked day.`);
        if (ot > 0 && night > 0) {
            invalid(`${day.work_date}: overlapping overtime and night hours need a reviewed allocation; their overlap is not recorded in the DTR.`);
        }
        const otMultiplier = regular || special ? multiplier * 1.3
            : rest ? Number(policy.otRateRestDay || 1.69) : Number(policy.otRateOrdinary || 1.25);
        add('overtimePay', 'OT_REG', `Overtime (${day.work_date})`, ot, hourlyRate * otMultiplier);
        add('nightDiffPay', 'NIGHT_DIFF', `Night Differential (${day.work_date})`, night,
            hourlyRate * multiplier * Number(policy.nightDiffRate || 0.10));
    }
    return { ...totals, lines };
};

module.exports = { computeAttendanceEarnings, invalid };
