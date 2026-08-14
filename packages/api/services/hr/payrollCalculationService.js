'use strict';

/**
 * Payslip computation.
 *
 * `computePayslip` is deliberately PURE — no database access, no clock, no
 * settings lookups. Every input arrives fully resolved. That is what makes the
 * money maths unit-testable against hand-verified reference cases without
 * mocking a database, which matters more here than anywhere else in the app:
 * a wrong withholding figure is a BIR penalty, not a bug report.
 */

const statutory = require('./statutoryService');

const { round2 } = statutory;

/**
 * Converts a rate to the monthly basis the statutory tables index on.
 * Uses the company's working-days-per-year divisor unless HR recorded an
 * explicit declared monthly basic for an irregular earner.
 *
 * For a monthly earner the base rate already IS the monthly figure, which is
 * what keeps SSS/PhilHealth/Pag-IBIG anchored to the CONTRACTED salary: neither
 * an absence nor a mid-month hire moves the contribution basis, because nothing
 * downstream looks at anything but this function.
 */
const monthlyBasisFor = (compensation, policy) => {
    if (compensation.declared_monthly_basic) return Number(compensation.declared_monthly_basic);
    if (compensation.pay_basis === 'monthly') return round2(Number(compensation.base_rate) || 0);
    const daysPerYear = Number(compensation.days_per_year) || Number(policy.workingDaysPerYear) || 313;
    return round2((Number(compensation.base_rate) || 0) * daysPerYear / 12);
};

/**
 * The value of one unpaid day against a monthly salary.
 *
 * PERIOD_WORKING_DAYS is the default because it is the only mode that closes at
 * both ends: a fully-absent cutoff deducts exactly the entitlement (pay 0.00),
 * and a clean month pays exactly the salary. The other two are offered because
 * some companies contract on them, but both leave a residue on a fully-absent
 * cutoff — they are documented in the migration that seeds the setting.
 */
const unpaidDayValueFor = ({ mode, entitlement, contractDays, monthlySalary, schedDaysInMonth, compensation, policy }) => {
    switch (mode) {
        case 'MONTH_WORKING_DAYS':
            return schedDaysInMonth > 0 ? monthlySalary / schedDaysInMonth : 0;
        case 'ANNUAL_FACTOR': {
            const daysPerYear = Number(compensation.days_per_year) || Number(policy.workingDaysPerYear) || 313;
            return daysPerYear > 0 ? (monthlySalary * 12) / daysPerYear : 0;
        }
        case 'PERIOD_WORKING_DAYS':
        default:
            return contractDays > 0 ? entitlement / contractDays : 0;
    }
};

/**
 * Basic pay for one cutoff, dispatched on the compensation's pay basis.
 *
 * The two bases are computed in opposite directions, and that is the whole
 * point. A daily earner's pay is built UP from attendance ("no work, no pay").
 * A monthly earner's pay starts at the contractual half-month and is only ever
 * reduced — so it cannot drift with the number of working days a cutoff happens
 * to contain.
 *
 * Returns the entitlement separately from the deduction lines so the payslip can
 * show the contracted figure alongside what was taken off it.
 */
const computeBasicPay = ({ compensation, dtrSummary, periodDays, policy, cutoffSeq }) => {
    const summary = dtrSummary || {};

    if (compensation.pay_basis === 'daily') {
        const dailyRate = Number(compensation.base_rate) || 0;
        const daysPaid = Number(summary.days_paid) || 0;
        const basicPay = round2(dailyRate * daysPaid);
        return {
            basicPay,
            dailyRate,
            hourlyRate: dailyRate / (Number(policy.standardHoursPerDay) || 8),
            entitlementLine: {
                lineType: 'EARNING', componentCode: 'BASIC', description: 'Basic Pay',
                quantity: daysPaid, rate: dailyRate, amount: basicPay, isTaxable: true, sortOrder: 1,
            },
            deductionLines: [],
            trace: { basicPayModel: 'DAILY_ATTENDANCE', daysPaid, dailyRate },
        };
    }

    if (compensation.pay_basis !== 'monthly') {
        const err = new Error(
            `Pay basis '${compensation.pay_basis}' is not supported yet. Only daily- and monthly-rated payroll is implemented.`
        );
        err.code = 'UNSUPPORTED_PAY_BASIS';
        throw err;
    }

    const monthlySalary = Number(compensation.base_rate) || 0;
    const salaryModel = compensation.salary_model || 'GUARANTEED';
    const { schedDaysInPeriod = 0, schedDaysInMonth = 0, contractDays = 0 } = periodDays || {};

    // Splitting through prorateMonthly rather than dividing by two is what makes
    // the two cutoffs sum to the salary EXACTLY at any amount: the second cutoff
    // takes the remainder, so an odd centavo can never be lost or duplicated.
    const halfMonth = statutory.prorateMonthly(monthlySalary, 'SPLIT_HALF', cutoffSeq);

    // Days outside the employment contract are not absences — they are days the
    // employee was not yet (or no longer) owed a salary for, so they reduce the
    // entitlement itself rather than appearing as a deduction.
    const isPartialContract = schedDaysInPeriod > 0 && contractDays < schedDaysInPeriod;
    const entitlement = isPartialContract
        ? round2(halfMonth * contractDays / schedDaysInPeriod)
        : round2(halfMonth);

    const divisorMode = policy.monthlyDivisorMode || 'PERIOD_WORKING_DAYS';
    const dayValue = unpaidDayValueFor({
        mode: divisorMode, entitlement, contractDays, monthlySalary, schedDaysInMonth, compensation, policy,
    });

    // GUARANTEED means exactly that: showing up is not a condition of payment.
    // Only an approved leave-without-pay — a deliberate HR act — reduces it.
    const lwopDays = Number(summary.days_lwop) || 0;
    const absentDays = salaryModel === 'ATTENDANCE' ? (Number(summary.days_absent) || 0) : 0;

    const deductionLines = [];
    let deducted = 0;
    const addDeduction = (componentCode, description, days) => {
        if (days <= 0 || dayValue <= 0) return;
        // Never deduct past the entitlement: a fully-absent cutoff lands on 0.00,
        // never on a negative payslip.
        const amount = round2(Math.min(days * dayValue, entitlement - deducted));
        if (amount <= 0) return;
        deducted = round2(deducted + amount);
        deductionLines.push({
            lineType: 'EARNING', componentCode, description,
            quantity: days, rate: round2(dayValue), amount: -amount,
            isTaxable: true, sortOrder: 2,
        });
    };
    addDeduction('LWOP', 'Leave Without Pay', lwopDays);
    addDeduction('ABSENCE', 'Absences', absentDays);

    const basicPay = round2(entitlement - deducted);
    // The equivalent daily rate is display-and-overtime only; it never
    // participates in computing basic pay for a monthly earner.
    const daysPerYear = Number(compensation.days_per_year) || Number(policy.workingDaysPerYear) || 313;
    const equivalentDailyRate = round2(monthlySalary * 12 / daysPerYear);

    return {
        basicPay,
        dailyRate: equivalentDailyRate,
        hourlyRate: equivalentDailyRate / (Number(policy.standardHoursPerDay) || 8),
        entitlementLine: {
            lineType: 'EARNING', componentCode: 'BASIC', description: 'Basic Pay',
            quantity: contractDays || schedDaysInPeriod, rate: equivalentDailyRate,
            amount: entitlement, isTaxable: true, sortOrder: 1,
        },
        deductionLines,
        trace: {
            basicPayModel: `MONTHLY_${salaryModel}`,
            monthlySalary,
            halfMonthEntitlement: round2(halfMonth),
            proratedEntitlement: entitlement,
            divisorMode,
            schedDaysInPeriod,
            schedDaysInMonth,
            contractDays,
            partialContract: isPartialContract,
            dayValue: round2(dayValue),
            lwopDays,
            absentDaysDeducted: absentDays,
            totalDayDeductions: deducted,
            equivalentDailyRate,
        },
    };
};

/**
 * Resolves a recurring component's amount for one cutoff.
 *
 * `rate_percent` is a percentage of the basic pay actually earned this cutoff,
 * so a percentage-based allowance shrinks with absences the same way basic does.
 * MONTHLY amounts split across cutoffs; the *_CUTOFF options land wholly on one.
 */
const componentAmountFor = (component, { basicPay, cutoffSeq }) => {
    const base = component.rate_percent != null
        ? round2(basicPay * Number(component.rate_percent))
        : round2(Number(component.amount) || 0);

    switch (component.frequency) {
        case 'FIRST_CUTOFF':
            return cutoffSeq === 1 ? base : 0;
        case 'SECOND_CUTOFF':
            return cutoffSeq === 2 ? base : 0;
        case 'MONTHLY': {
            const first = round2(base / 2);
            return cutoffSeq === 1 ? first : round2(base - first);
        }
        case 'EVERY_CUTOFF':
        default:
            return base;
    }
};

/**
 * Final pay for a departing employee.
 *
 * This is SUPPLEMENTARY to their last regular payslip, not a replacement for
 * it: the days they actually worked in their final cutoff are paid by the
 * REGULAR run, which already prorates to the separation date. What is left over
 * is what only falls due on separation.
 *
 * Composition (per company policy):
 *   + pro-rated 13th month pay, less whatever has already been paid this year
 *   - every outstanding loan balance, recovered in full rather than left open
 *
 * No statutory contributions: 13th month pay is not part of the SSS, PhilHealth
 * or Pag-IBIG basis. Withholding applies only to the portion of 13th month and
 * other benefits exceeding the annual tax-exempt cap (₱90,000 under TRAIN).
 */
const computeFinalPay = ({ employee, compensation, loans = [], policy, statutoryTables, finalPay, adjustments = [] }) => {
    const lines = [];
    const addLine = (line) => { if (line.amount !== 0) lines.push(line); };

    const basicEarned = Number(finalPay?.basicEarnedThisYear) || 0;
    const alreadyPaid = Number(finalPay?.thirteenthMonthAlreadyPaid) || 0;
    const exemptCap = Number(policy.thirteenthMonthExemptCap) || 90000;

    // PD 851: total basic salary earned in the calendar year divided by 12.
    const entitlement = round2(basicEarned / 12);
    const thirteenthMonth = round2(Math.max(entitlement - alreadyPaid, 0));

    addLine({
        lineType: 'EARNING', componentCode: 'THIRTEENTH_MONTH', description: '13th Month Pay (pro-rated)',
        quantity: null, rate: null, amount: thirteenthMonth, isTaxable: false, sortOrder: 1,
    });

    // One-off additions (a separation bonus, a last allowance) ride alongside,
    // so the run-adjustment UI works on a final pay exactly as on a regular one.
    let otherEarnings = 0;
    let otherDeductions = 0;
    for (const adj of adjustments) {
        const amount = round2(Number(adj.amount) || 0);
        if (amount === 0) continue;
        if (adj.adjustment_type === 'ADD') {
            otherEarnings = round2(otherEarnings + amount);
            addLine({
                lineType: 'EARNING', componentCode: adj.component_code,
                description: adj.component_name || adj.component_code,
                amount, isTaxable: Boolean(adj.is_taxable), sortOrder: 10,
            });
        } else if (adj.adjustment_type === 'DEDUCT') {
            otherDeductions = round2(otherDeductions + amount);
            addLine({
                lineType: 'DEDUCTION', componentCode: adj.component_code,
                description: adj.component_name || adj.component_code,
                amount, isTaxable: false, sortOrder: 45,
            });
        }
    }

    const grossPay = round2(thirteenthMonth + otherEarnings);

    // Only the excess over the annual cap is taxable. The cap covers 13th month
    // AND other benefits for the year, so the figure already paid counts toward
    // it — otherwise splitting a bonus across two runs would dodge the ceiling.
    const benefitsForYear = round2(alreadyPaid + thirteenthMonth);
    const taxableBenefits = round2(Math.max(benefitsForYear - exemptCap, 0));
    const isExempt = compensation?.statutory_coverage === 'EXEMPT';

    // No tax is withheld here even when there IS an excess, and that is a
    // deliberate refusal rather than an omission. The excess is taxed at the
    // employee's marginal rate on their TOTAL annual income, which means
    // annualisation — a year-end process this system does not implement. Running
    // the annual table over the excess in isolation would put it in the
    // 0%-below-250k band and produce a confidently wrong ₱0.00.
    //
    // So the amount is computed, recorded on the payslip as taxable income, and
    // raised as a run warning for the year-end BIR 2316. Visibly unwithheld
    // beats invisibly under-withheld.
    const withholdingTax = 0;
    const requiresAnnualisation = !isExempt && taxableBenefits > 0;

    // Every outstanding loan closes here, regardless of which cutoff it was
    // scheduled against — there will be no later payslip to deduct from.
    //
    // But a payslip can only ever hand money over, never collect it. When the
    // balances exceed what is payable, recovery stops at zero and the remainder
    // becomes a debt to chase outside payroll. Letting the net go negative would
    // produce a "payment" that cannot be made and would silently mark loans as
    // settled when no money changed hands.
    const loanDeductions = [];
    let loansTotal = 0;
    let unrecoveredLoanBalance = 0;
    let available = round2(grossPay - withholdingTax - otherDeductions);
    for (const loan of loans) {
        const outstanding = round2(Number(loan.principal_amount) - Number(loan.amount_paid));
        if (outstanding <= 0) continue;
        const amount = round2(Math.min(outstanding, Math.max(available, 0)));
        if (amount > 0) {
            available = round2(available - amount);
            loansTotal = round2(loansTotal + amount);
            loanDeductions.push({ loanId: loan.loan_id, amount });
            const settled = amount >= outstanding;
            addLine({
                lineType: 'DEDUCTION', componentCode: loan.component_code,
                description: `${loan.reference_no ? `${loan.loan_type} (${loan.reference_no})` : loan.loan_type}`
                    + (settled ? ' — full settlement' : ' — partial, balance remains due'),
                amount, isTaxable: false, sortOrder: 40,
            });
        }
        unrecoveredLoanBalance = round2(unrecoveredLoanBalance + round2(outstanding - amount));
    }

    const totalDeductions = round2(withholdingTax + loansTotal + otherDeductions);
    const netPay = round2(grossPay - totalDeductions);

    return {
        header: {
            employee_id: employee.employee_id,
            employee_code: employee.employee_code,
            employee_name: employee.employee_name,
            position_title: employee.position_title,
            department_name: employee.department_name,
            pay_basis: compensation?.pay_basis || 'daily',
            salary_model: compensation?.salary_model || null,
            is_overtime_exempt: Boolean(compensation?.is_overtime_exempt),
            worker_class: employee.worker_class || 'EMPLOYEE',
            statutory_coverage: isExempt ? 'EXEMPT' : 'COVERED',
            daily_rate: 0,
            monthly_basis: 0,
            compensation_id: compensation?.compensation_id || null,

            days_worked: 0, days_paid: 0, days_absent: 0, days_on_leave: 0, overtime_hours: 0,

            basic_pay: 0, overtime_pay: 0, holiday_pay: 0, night_diff_pay: 0,
            allowances_taxable: 0, allowances_nontaxable: 0,
            other_earnings: round2(thirteenthMonth + otherEarnings),
            gross_pay: grossPay,

            sss_ee: 0, sss_mpf_ee: 0, philhealth_ee: 0, pagibig_ee: 0,
            withholding_tax: withholdingTax,
            loans_total: loansTotal,
            other_deductions: otherDeductions,
            total_deductions: totalDeductions,
            taxable_income: taxableBenefits,
            net_pay: netPay,

            sss_er: 0, sss_mpf_er: 0, sss_ec: 0, philhealth_er: 0, pagibig_er: 0,
            total_employer_contrib: 0,
        },
        lines,
        loanDeductions,
        trace: {
            basicPayModel: 'FINAL_PAY',
            dateSeparated: employee.date_separated || null,
            basicEarnedThisYear: basicEarned,
            thirteenthMonthEntitlement: entitlement,
            thirteenthMonthAlreadyPaid: alreadyPaid,
            thirteenthMonthPayable: thirteenthMonth,
            exemptCap,
            benefitsForYear,
            taxableBenefits,
            withholdingTax,
            requiresAnnualisation,
            loansSettled: loanDeductions,
            unrecoveredLoanBalance,
            statutoryVersions: statutoryTables?.versions,
        },
    };
};

/**
 * Computes one payslip.
 *
 * @param {object} input
 * @param {object} input.employee        - identity snapshot fields
 * @param {object} input.compensation    - effective-dated rate row
 * @param {object} input.dtrSummary      - totals from dtrService.summarizePeriodBulk
 * @param {object} input.periodDays      - from dtrService.scheduledDaysBulk; the
 *                                         divisor a monthly salary deducts against
 * @param {Array}  input.loans           - active loans due on this cutoff
 * @param {object} input.policy          - PAYROLL_* values snapshotted on the run
 * @param {object} input.statutoryTables - from statutoryService.loadTables
 * @param {number} input.cutoffSeq       - 1 or 2 within the month
 * @returns {{header: object, lines: Array, trace: object}}
 */
const computePayslip = ({
    employee, compensation, dtrSummary, periodDays, loans = [], policy, statutoryTables, cutoffSeq,
    payComponents = [], statutoryOverrides = {}, adjustments = [], runType = 'REGULAR',
    finalPay = null,
}) => {
    if (runType === 'FINAL_PAY') {
        return computeFinalPay({
            employee, compensation, loans, policy, statutoryTables, finalPay, adjustments,
        });
    }
    if (!compensation) {
        const err = new Error(`No compensation on record for ${employee.employee_name} as of this period.`);
        err.code = 'NO_COMPENSATION';
        throw err;
    }
    const summary = dtrSummary || {};
    const isOvertimeExempt = Boolean(compensation.is_overtime_exempt);
    // An exempt employee accrues no premium, so any hours the DTR happens to
    // carry are ignored rather than silently paid.
    const overtimeHours = isOvertimeExempt ? 0 : (Number(summary.overtime_hours) || 0);
    const nightDiffHours = isOvertimeExempt ? 0 : (Number(summary.night_diff_hours) || 0);

    const lines = [];
    const addLine = (line) => { if (line.amount !== 0) lines.push(line); };

    // --- Earnings --------------------------------------------------------
    // Basic pay is computed per pay basis: built up from attendance for a daily
    // earner, reduced down from the contract for a monthly one. Throws
    // UNSUPPORTED_PAY_BASIS for the bases still unimplemented.
    const basic = computeBasicPay({ compensation, dtrSummary, periodDays, policy, cutoffSeq });
    const { basicPay, dailyRate, hourlyRate } = basic;
    addLine(basic.entitlementLine);
    // Unpaid days ride as NEGATIVE earnings rather than deductions, so gross pay
    // and taxable income both reflect what was actually earned.
    for (const line of basic.deductionLines) addLine(line);

    const overtimePay = round2(overtimeHours * hourlyRate * Number(policy.otRateOrdinary || 1.25));
    addLine({
        lineType: 'EARNING', componentCode: 'OT_REG', description: 'Overtime Pay',
        quantity: overtimeHours, rate: round2(hourlyRate * Number(policy.otRateOrdinary || 1.25)),
        amount: overtimePay, isTaxable: true, sortOrder: 3,
    });

    const nightDiffPay = round2(nightDiffHours * hourlyRate * Number(policy.nightDiffRate || 0.10));
    addLine({
        lineType: 'EARNING', componentCode: 'NIGHT_DIFF', description: 'Night Differential',
        quantity: nightDiffHours, rate: round2(hourlyRate * Number(policy.nightDiffRate || 0.10)),
        amount: nightDiffPay, isTaxable: true, sortOrder: 4,
    });

    // --- Recurring components and one-off additions ----------------------
    // ADD adjustments are folded in here, alongside the standing components,
    // so a one-off bonus behaves exactly like a component for gross and tax.
    const oneOffAdditions = adjustments
        .filter((a) => a.adjustment_type === 'ADD')
        .map((a) => ({
            component_code: a.component_code,
            component_name: a.component_name || a.component_code,
            component_type: a.component_type,
            is_taxable: a.is_taxable,
            amount: a.amount,
            frequency: 'EVERY_CUTOFF',
            _oneOff: true,
        }));

    // An OVERRIDE on a non-statutory component replaces the recurring amount.
    const overrideByComponent = new Map(
        adjustments.filter((a) => a.adjustment_type === 'OVERRIDE').map((a) => [a.component_code, a])
    );

    let allowancesTaxable = 0;
    let allowancesNonTaxable = 0;
    let otherDeductions = 0;

    for (const component of [...payComponents, ...oneOffAdditions]) {
        const override = overrideByComponent.get(component.component_code);
        const amount = override
            ? round2(Number(override.amount))
            : componentAmountFor(component, { basicPay, cutoffSeq });
        if (amount === 0) continue;

        if (component.component_type === 'DEDUCTION') {
            otherDeductions = round2(otherDeductions + amount);
            addLine({
                lineType: 'DEDUCTION', componentCode: component.component_code,
                description: component.component_name, amount, isTaxable: false, sortOrder: 45,
            });
        } else {
            if (component.is_taxable) allowancesTaxable = round2(allowancesTaxable + amount);
            else allowancesNonTaxable = round2(allowancesNonTaxable + amount);
            addLine({
                lineType: 'EARNING', componentCode: component.component_code,
                description: component.component_name, amount,
                isTaxable: Boolean(component.is_taxable), sortOrder: 10,
            });
        }
    }

    const grossPay = round2(
        basicPay + overtimePay + nightDiffPay + allowancesTaxable + allowancesNonTaxable
    );

    // --- Statutory contributions ----------------------------------------
    // Contributions are monthly by law, so they are computed on a monthly basis
    // and then prorated onto this cutoff.
    //
    // A job-order / contract-of-service worker is outside the coverage entirely:
    // no employee share, no EMPLOYER share, and no compensation withholding.
    // The tables are not merely zeroed afterwards but skipped, because
    // PhilHealth lifts any basis below its income floor — computing on a zero
    // basis would invent a contribution rather than suppress one.
    const isStatutoryExempt = compensation.statutory_coverage === 'EXEMPT';
    const NO_CONTRIBUTION = { ee: 0, er: 0, ec: 0, mpfEe: 0, mpfEr: 0, msc: 0, total: 0 };

    const monthlyBasis = isStatutoryExempt ? 0 : monthlyBasisFor(compensation, policy);
    const schedule = policy.statutorySchedule || 'SPLIT_HALF';

    const sss = isStatutoryExempt
        ? NO_CONTRIBUTION
        : statutory.computeSSS(statutoryTables, compensation.sss_msc_override || monthlyBasis);
    const philhealth = isStatutoryExempt
        ? NO_CONTRIBUTION
        : statutory.computePhilHealth(statutoryTables, monthlyBasis);
    const pagibig = isStatutoryExempt
        ? NO_CONTRIBUTION
        : statutory.computePagIbig(statutoryTables, monthlyBasis);

    // A standing override replaces the MONTHLY figure, which is then prorated
    // exactly like a computed one — so an override behaves identically to a
    // table value from here on.
    const monthlyOrOverride = (code, computed) => (
        statutoryOverrides[code] != null ? Number(statutoryOverrides[code]) : computed
    );
    // A run-scoped OVERRIDE replaces the final per-cutoff amount instead, since
    // it is a statement about this payslip rather than about the schedule.
    const applyRunOverride = (code, value) => {
        const adj = overrideByComponent.get(code);
        return adj ? round2(Number(adj.amount)) : value;
    };
    // An exempt worker is not covered, so a standing or run-scoped override
    // cannot reintroduce a contribution — coverage wins over both.
    const resolveStatutory = (code, monthlyComputed) => (isStatutoryExempt ? 0 : applyRunOverride(
        code, statutory.prorateMonthly(monthlyOrOverride(code, monthlyComputed), schedule, cutoffSeq)
    ));

    const sssEe = resolveStatutory('SSS_EE', sss.ee);
    const sssMpfEe = resolveStatutory('SSS_MPF_EE', sss.mpfEe);
    const philhealthEe = resolveStatutory('PHIC_EE', philhealth.ee);
    const pagibigEe = resolveStatutory('HDMF_EE', pagibig.ee);

    const sssEr = statutory.prorateMonthly(sss.er, schedule, cutoffSeq);
    const sssMpfEr = statutory.prorateMonthly(sss.mpfEr, schedule, cutoffSeq);
    const sssEc = statutory.prorateMonthly(sss.ec, schedule, cutoffSeq);
    const philhealthEr = statutory.prorateMonthly(philhealth.er, schedule, cutoffSeq);
    const pagibigEr = statutory.prorateMonthly(pagibig.er, schedule, cutoffSeq);

    addLine({ lineType: 'DEDUCTION', componentCode: 'SSS_EE', description: 'SSS Contribution', amount: sssEe, isTaxable: false, sortOrder: 30 });
    addLine({ lineType: 'DEDUCTION', componentCode: 'SSS_MPF_EE', description: 'SSS WISP (Provident)', amount: sssMpfEe, isTaxable: false, sortOrder: 31 });
    addLine({ lineType: 'DEDUCTION', componentCode: 'PHIC_EE', description: 'PhilHealth Contribution', amount: philhealthEe, isTaxable: false, sortOrder: 32 });
    addLine({ lineType: 'DEDUCTION', componentCode: 'HDMF_EE', description: 'Pag-IBIG Contribution', amount: pagibigEe, isTaxable: false, sortOrder: 33 });

    // --- Withholding tax -------------------------------------------------
    // Statutory contributions are deductible under TRAIN, so tax is computed on
    // gross less those contributions — not on gross.
    const statutoryDeductions = round2(sssEe + sssMpfEe + philhealthEe + pagibigEe);
    // Non-taxable allowances (rice, meal, de minimis) are part of gross but not
    // of taxable income, so tax is computed on the taxable earnings only.
    const taxableEarnings = round2(basicPay + overtimePay + nightDiffPay + allowancesTaxable);
    // An exempt worker earns a fee, not compensation, so the compensation tax
    // table does not apply to them at all — the figure is zero rather than
    // computed-and-suppressed, and taxable income follows so BIR 1601-C
    // reporting cannot pick up a base that was never taxable.
    const taxableIncome = isStatutoryExempt
        ? 0
        : round2(Math.max(taxableEarnings - statutoryDeductions, 0));
    const wtax = isStatutoryExempt
        ? { tax: 0, bracketSeq: null }
        : statutory.computeWithholdingTax(statutoryTables, taxableIncome, 'SEMI_MONTHLY');

    // Tax can be overridden either standing (monthly, prorated) or per run.
    const withholdingTax = isStatutoryExempt ? 0 : applyRunOverride(
        'WTAX',
        statutoryOverrides.WTAX != null
            ? statutory.prorateMonthly(Number(statutoryOverrides.WTAX), schedule, cutoffSeq)
            : wtax.tax
    );

    addLine({
        lineType: 'DEDUCTION', componentCode: 'WTAX', description: 'Withholding Tax',
        amount: withholdingTax, isTaxable: false, sortOrder: 34,
    });

    // --- Loans -----------------------------------------------------------
    // A loan never deducts more than its outstanding balance, so the final
    // instalment self-trims instead of overshooting.
    const loanDeductions = [];
    let loansTotal = 0;
    for (const loan of loans) {
        if (Number(loan.deduct_on_cutoff) !== Number(cutoffSeq)) continue;
        const outstanding = round2(Number(loan.principal_amount) - Number(loan.amount_paid));
        if (outstanding <= 0) continue;
        // An override on a loan component sets the instalment for this run (a
        // partial payment, say), but still never exceeds what is owed.
        const scheduled = applyRunOverride(loan.component_code, Number(loan.amortization_amount));
        const amount = round2(Math.min(scheduled, outstanding));
        if (amount <= 0) continue;
        loansTotal = round2(loansTotal + amount);
        loanDeductions.push({ loanId: loan.loan_id, amount });
        addLine({
            lineType: 'DEDUCTION', componentCode: loan.component_code,
            description: loan.reference_no ? `${loan.loan_type} (${loan.reference_no})` : loan.loan_type,
            amount, isTaxable: false, sortOrder: 40,
        });
    }

    // --- Employer share (cost, not withheld) -----------------------------
    addLine({ lineType: 'EMPLOYER_CONTRIBUTION', componentCode: 'SSS_ER', description: 'SSS Employer Share', amount: sssEr, isTaxable: false, sortOrder: 50 });
    addLine({ lineType: 'EMPLOYER_CONTRIBUTION', componentCode: 'SSS_MPF_ER', description: 'SSS WISP Employer Share', amount: sssMpfEr, isTaxable: false, sortOrder: 51 });
    addLine({ lineType: 'EMPLOYER_CONTRIBUTION', componentCode: 'SSS_EC', description: 'Employees Compensation', amount: sssEc, isTaxable: false, sortOrder: 52 });
    addLine({ lineType: 'EMPLOYER_CONTRIBUTION', componentCode: 'PHIC_ER', description: 'PhilHealth Employer Share', amount: philhealthEr, isTaxable: false, sortOrder: 53 });
    addLine({ lineType: 'EMPLOYER_CONTRIBUTION', componentCode: 'HDMF_ER', description: 'Pag-IBIG Employer Share', amount: pagibigEr, isTaxable: false, sortOrder: 54 });

    const totalDeductions = round2(statutoryDeductions + withholdingTax + loansTotal + otherDeductions);
    const netPay = round2(grossPay - totalDeductions);
    const totalEmployerContrib = round2(sssEr + sssMpfEr + sssEc + philhealthEr + pagibigEr);

    return {
        header: {
            employee_id: employee.employee_id,
            employee_code: employee.employee_code,
            employee_name: employee.employee_name,
            position_title: employee.position_title,
            department_name: employee.department_name,
            pay_basis: compensation.pay_basis,
            salary_model: compensation.salary_model || null,
            is_overtime_exempt: isOvertimeExempt,
            worker_class: employee.worker_class || 'EMPLOYEE',
            statutory_coverage: isStatutoryExempt ? 'EXEMPT' : 'COVERED',
            daily_rate: dailyRate,
            monthly_basis: monthlyBasis,
            compensation_id: compensation.compensation_id,

            days_worked: Number(summary.days_worked) || 0,
            days_paid: Number(summary.days_paid) || 0,
            days_absent: Number(summary.days_absent) || 0,
            days_on_leave: Number(summary.days_on_leave) || 0,
            overtime_hours: overtimeHours,

            basic_pay: basicPay,
            overtime_pay: overtimePay,
            holiday_pay: 0,
            night_diff_pay: nightDiffPay,
            allowances_taxable: allowancesTaxable,
            allowances_nontaxable: allowancesNonTaxable,
            other_earnings: 0,
            gross_pay: grossPay,

            sss_ee: sssEe,
            sss_mpf_ee: sssMpfEe,
            philhealth_ee: philhealthEe,
            pagibig_ee: pagibigEe,
            withholding_tax: withholdingTax,
            loans_total: loansTotal,
            other_deductions: otherDeductions,
            total_deductions: totalDeductions,
            taxable_income: taxableIncome,
            net_pay: netPay,

            sss_er: sssEr,
            sss_mpf_er: sssMpfEr,
            sss_ec: sssEc,
            philhealth_er: philhealthEr,
            pagibig_er: pagibigEr,
            total_employer_contrib: totalEmployerContrib,
        },
        lines,
        loanDeductions,
        // Stored on the payslip so anyone can reconstruct how the figure was
        // reached years later, without re-running the engine.
        trace: {
            ...basic.trace,
            monthlyBasis,
            workerClass: employee.worker_class || 'EMPLOYEE',
            statutoryCoverage: isStatutoryExempt ? 'EXEMPT' : 'COVERED',
            overtimeExempt: isOvertimeExempt,
            tardinessExempt: Boolean(compensation.is_tardiness_exempt),
            statutorySchedule: schedule,
            cutoffSeq,
            sssMsc: sss.msc,
            sssMonthly: { ee: sss.ee, er: sss.er, ec: sss.ec, mpfEe: sss.mpfEe, mpfEr: sss.mpfEr },
            philhealthMonthly: philhealth,
            pagibigMonthly: pagibig,
            statutoryDeductions,
            taxableEarnings,
            taxableIncome,
            taxBracket: wtax,
            // Recorded so a payslip can always be explained: what the table said
            // versus what a human forced.
            computedWithholdingTax: wtax.tax,
            appliedWithholdingTax: withholdingTax,
            statutoryOverridesApplied: statutoryOverrides,
            runAdjustmentsApplied: adjustments.map((a) => ({
                component: a.component_code, type: a.adjustment_type, amount: a.amount, reason: a.reason,
            })),
            hourlyRate: round2(hourlyRate),
            statutoryVersions: statutoryTables.versions,
        },
    };
};

module.exports = { computePayslip, computeBasicPay, computeFinalPay, monthlyBasisFor, round2 };
