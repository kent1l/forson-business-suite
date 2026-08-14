'use strict';

/**
 * Philippine statutory contribution and withholding calculations.
 *
 * This module owns "what do the tables say" and nothing about payroll
 * structure. Given a resolved set of table versions it is fully deterministic,
 * which is what lets the payroll engine reproduce a historical run exactly.
 *
 * Nothing here reads settings or the clock: versions are resolved once per run
 * and passed in, so a run recomputed next year still uses last year's schedule.
 */

/** Round to 2dp, half-up, avoiding the binary-float drift of naive toFixed. */
const round2 = (n) => {
    const scaled = Number((Math.abs(n) * 100).toPrecision(15));
    const rounded = Math.round(scaled) / 100;
    return n < 0 ? -rounded : rounded;
};

/**
 * Finds the statutory version in force for each agency on a given date.
 * The DB's exclusion constraint guarantees at most one match per agency.
 */
const resolveVersions = async (executor, asOfDate) => {
    const { rows } = await executor.query(
        `SELECT agency, version_id, version_label
         FROM statutory_table_version
         WHERE is_active = TRUE
           AND effective_from <= $1
           AND (effective_to IS NULL OR effective_to >= $1)`,
        [asOfDate]
    );
    const byAgency = Object.fromEntries(rows.map((r) => [r.agency, r.version_id]));

    const missing = ['SSS', 'PHILHEALTH', 'PAGIBIG', 'BIR_WTAX'].filter((a) => !byAgency[a]);
    if (missing.length > 0) {
        const err = new Error(
            `No statutory schedule is on file for ${missing.join(', ')} as of ${asOfDate}. `
            + 'Add the current schedule under Payroll settings before computing this run.'
        );
        err.code = 'STATUTORY_VERSION_MISSING';
        throw err;
    }

    return {
        sssVersionId: byAgency.SSS,
        philhealthVersionId: byAgency.PHILHEALTH,
        pagibigVersionId: byAgency.PAGIBIG,
        birVersionId: byAgency.BIR_WTAX,
        labels: Object.fromEntries(rows.map((r) => [r.agency, r.version_label])),
    };
};

/**
 * Loads every bracket/config row for a resolved version set, in four queries.
 * Called once per payroll run — never per employee.
 */
const loadTables = async (executor, versions) => {
    const [sss, philhealth, pagibig, bir] = await Promise.all([
        executor.query(
            `SELECT range_from, range_to, msc, ee_amount, er_amount, ec_amount, mpf_ee, mpf_er
             FROM sss_contribution_bracket WHERE version_id = $1 ORDER BY range_from`,
            [versions.sssVersionId]
        ),
        executor.query('SELECT * FROM philhealth_config WHERE version_id = $1', [versions.philhealthVersionId]),
        executor.query('SELECT * FROM pagibig_config WHERE version_id = $1', [versions.pagibigVersionId]),
        executor.query(
            `SELECT payroll_frequency, bracket_seq, lower_bound, upper_bound, base_tax, rate_percent, excess_over
             FROM bir_withholding_bracket WHERE version_id = $1 ORDER BY payroll_frequency, bracket_seq`,
            [versions.birVersionId]
        ),
    ]);

    const birByFrequency = {};
    for (const row of bir.rows) {
        (birByFrequency[row.payroll_frequency] ||= []).push(row);
    }

    return {
        versions,
        sssBrackets: sss.rows,
        philhealth: philhealth.rows[0],
        pagibig: pagibig.rows[0],
        birByFrequency,
    };
};

/**
 * SSS contribution for a monthly basis.
 *
 * Regular SS applies up to the MSC ceiling for regular contributions; anything
 * above flows into the WISP/provident (MPF) portion. Both are the employee's
 * money coming out of pay, so callers must add ee + mpfEe for total withheld.
 */
const computeSSS = (tables, monthlyBasis) => {
    const basis = Number(monthlyBasis) || 0;
    const bracket = tables.sssBrackets.find(
        (b) => basis >= Number(b.range_from) && (b.range_to === null || basis <= Number(b.range_to))
    // Falling off the top of the table means the employee earns above the
    // highest bracket, so the top bracket applies.
    ) || tables.sssBrackets[tables.sssBrackets.length - 1];

    if (!bracket) return { msc: 0, ee: 0, er: 0, ec: 0, mpfEe: 0, mpfEr: 0, totalEe: 0 };

    const ee = Number(bracket.ee_amount);
    const mpfEe = Number(bracket.mpf_ee);
    return {
        msc: Number(bracket.msc),
        ee,
        er: Number(bracket.er_amount),
        ec: Number(bracket.ec_amount),
        mpfEe,
        mpfEr: Number(bracket.mpf_er),
        totalEe: round2(ee + mpfEe),
    };
};

/**
 * PhilHealth premium. The basis is clamped to the floor/ceiling, then the
 * premium is split between employee and employer.
 */
const computePhilHealth = (tables, monthlyBasis) => {
    const cfg = tables.philhealth;
    if (!cfg) return { total: 0, ee: 0, er: 0 };

    const basis = Math.min(
        Math.max(Number(monthlyBasis) || 0, Number(cfg.income_floor)),
        Number(cfg.income_ceiling)
    );
    const total = round2(basis * Number(cfg.premium_rate));
    const ee = round2(total * Number(cfg.ee_share_ratio));
    // Employer takes the remainder so the two shares always reconstruct the
    // total exactly, even when halving produces a half-centavo.
    return { total, ee, er: round2(total - ee) };
};

/** Pag-IBIG. Rate steps at the threshold; the basis is capped. */
const computePagIbig = (tables, monthlyBasis) => {
    const cfg = tables.pagibig;
    if (!cfg) return { ee: 0, er: 0 };

    const raw = Number(monthlyBasis) || 0;
    const basis = Math.min(raw, Number(cfg.max_compensation));
    const eeRate = raw <= Number(cfg.threshold_amount)
        ? Number(cfg.ee_rate_below)
        : Number(cfg.ee_rate_above);

    return { ee: round2(basis * eeRate), er: round2(basis * Number(cfg.er_rate)) };
};

/**
 * BIR withholding tax on taxable income for one payroll frequency.
 *
 * Taxable income is gross less the statutory contributions, which are
 * deductible under the TRAIN law.
 */
const computeWithholdingTax = (tables, taxableIncome, frequency = 'SEMI_MONTHLY') => {
    const brackets = tables.birByFrequency?.[frequency];
    if (!brackets || brackets.length === 0) return { tax: 0, bracketSeq: null };

    const income = Number(taxableIncome) || 0;
    if (income <= 0) return { tax: 0, bracketSeq: null };

    const bracket = brackets.find(
        (b) => income >= Number(b.lower_bound) && (b.upper_bound === null || income <= Number(b.upper_bound))
    ) || brackets[brackets.length - 1];

    const tax = Number(bracket.base_tax)
        + ((income - Number(bracket.excess_over)) * Number(bracket.rate_percent));

    return {
        tax: round2(Math.max(tax, 0)),
        bracketSeq: bracket.bracket_seq,
        baseTax: Number(bracket.base_tax),
        ratePercent: Number(bracket.rate_percent),
        excessOver: Number(bracket.excess_over),
    };
};

/**
 * Splits a monthly contribution across the cutoffs of a semi-monthly payroll.
 *
 * 'SPLIT_HALF'    — half on each cutoff (the common arrangement).
 * 'SECOND_CUTOFF' — the whole amount on the second cutoff only.
 *
 * On SPLIT_HALF the second cutoff takes the remainder rather than another half,
 * so the two cutoffs always sum to exactly the monthly figure even when halving
 * lands on a half-centavo. Getting this wrong by a centavo a month is what
 * makes year-end remittance reconciliation fail.
 */
const prorateMonthly = (monthlyAmount, schedule, cutoffSeq) => {
    const amount = Number(monthlyAmount) || 0;
    if (schedule === 'SECOND_CUTOFF') {
        return cutoffSeq === 2 ? round2(amount) : 0;
    }
    const first = round2(amount / 2);
    return cutoffSeq === 1 ? first : round2(amount - first);
};

module.exports = {
    resolveVersions,
    loadTables,
    computeSSS,
    computePhilHealth,
    computePagIbig,
    computeWithholdingTax,
    prorateMonthly,
    round2,
};
