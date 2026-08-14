'use strict';

/**
 * Editing the statutory schedules.
 *
 * Two ways to change rates, and the choice is forced by whether the version has
 * been used:
 *   - UNUSED version  -> edit in place. This is the normal case for a schedule
 *     that was seeded or entered ahead of time but has not yet paid anybody.
 *   - IN-USE version  -> supersede. The old schedule keeps its dates and its
 *     figures forever so historical payslips stay reproducible, and a new
 *     version takes over from a chosen date.
 *
 * The database enforces this independently (statutory_bracket_guard /
 * statutory_version_guard), so the checks here are for good error messages, not
 * for safety.
 */

/**
 * Builds an SSS bracket table from the rules that actually change when SSS
 * issues a circular, rather than requiring 61 rows to be keyed by hand.
 *
 * The published table is regular: MSC steps in fixed increments, contributions
 * are a flat percentage of MSC, regular SS is capped at a ceiling with the
 * excess going to the provident (WISP/MPF) portion, and EC steps once.
 */
const generateSssBrackets = ({
    mscMin = 5000,
    mscMax = 35000,
    mscStep = 500,
    eeRate = 0.05,
    erRate = 0.10,
    regularSsCeiling = 20000,
    ecLowAmount = 10,
    ecHighAmount = 30,
    ecThreshold = 15000,
}) => {
    if (mscStep <= 0) throw Object.assign(new Error('mscStep must be greater than zero'), { code: 'INVALID_BRACKET_PARAMS' });
    if (mscMax < mscMin) throw Object.assign(new Error('mscMax must be at least mscMin'), { code: 'INVALID_BRACKET_PARAMS' });

    const steps = Math.round((mscMax - mscMin) / mscStep);
    const round2 = (n) => Math.round(n * 100) / 100;
    const half = mscStep / 2;

    return Array.from({ length: steps + 1 }, (_, i) => {
        const msc = mscMin + i * mscStep;
        const regular = Math.min(msc, regularSsCeiling);
        const excess = Math.max(msc - regularSsCeiling, 0);
        return {
            // The first band catches everything below the floor; the last is
            // open-ended so a very high earner still resolves.
            range_from: i === 0 ? 0 : msc - half,
            range_to: i === steps ? null : round2(msc + half - 0.01),
            msc,
            ee_amount: round2(regular * eeRate),
            er_amount: round2(regular * erRate),
            ec_amount: msc < ecThreshold ? ecLowAmount : ecHighAmount,
            mpf_ee: round2(excess * eeRate),
            mpf_er: round2(excess * erRate),
        };
    });
};

const isInUse = async (executor, versionId) => {
    const { rows } = await executor.query('SELECT statutory_version_is_in_use($1) AS in_use', [versionId]);
    return rows[0]?.in_use === true;
};

const assertEditable = async (executor, versionId) => {
    if (await isInUse(executor, versionId)) {
        const err = new Error(
            'This schedule has already been used by a payroll run, so its figures are frozen. '
            + 'Supersede it with a new version effective from a later date instead.'
        );
        err.code = 'VERSION_IN_USE';
        throw err;
    }
};

const getVersion = async (executor, versionId) => {
    const { rows } = await executor.query(
        `SELECT version_id, agency, version_label,
                TO_CHAR(effective_from, 'YYYY-MM-DD') AS effective_from,
                TO_CHAR(effective_to, 'YYYY-MM-DD') AS effective_to,
                source_reference, is_active
         FROM statutory_table_version WHERE version_id = $1`,
        [versionId]
    );
    if (!rows[0]) {
        const err = new Error('Statutory version not found');
        err.code = 'VERSION_NOT_FOUND';
        throw err;
    }
    return rows[0];
};

const createVersion = async (executor, { agency, versionLabel, effectiveFrom, sourceReference, createdBy }) => {
    const { rows } = await executor.query(
        `INSERT INTO statutory_table_version (agency, version_label, effective_from, source_reference, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING version_id, agency, version_label,
                   TO_CHAR(effective_from, 'YYYY-MM-DD') AS effective_from`,
        [agency, versionLabel, effectiveFrom, sourceReference || null, createdBy]
    );
    return rows[0];
};

const updateVersion = async (executor, { versionId, versionLabel, effectiveFrom, effectiveTo, sourceReference }) => {
    await assertEditable(executor, versionId);
    const { rows } = await executor.query(
        `UPDATE statutory_table_version
         SET version_label = COALESCE($1, version_label),
             effective_from = COALESCE($2::date, effective_from),
             effective_to = $3::date,
             source_reference = COALESCE($4, source_reference)
         WHERE version_id = $5
         RETURNING version_id, agency, version_label,
                   TO_CHAR(effective_from, 'YYYY-MM-DD') AS effective_from,
                   TO_CHAR(effective_to, 'YYYY-MM-DD') AS effective_to`,
        [versionLabel || null, effectiveFrom || null, effectiveTo || null, sourceReference || null, versionId]
    );
    return rows[0];
};

/**
 * Replaces the figures on an unused version.
 *
 * SSS accepts either `mode: 'generate'` with rule parameters, or explicit rows
 * for the rare irregular table. The other agencies are simple enough to set
 * directly.
 */
const replaceBrackets = async (executor, { versionId, payload }) => {
    const version = await getVersion(executor, versionId);
    await assertEditable(executor, versionId);

    if (version.agency === 'SSS') {
        const brackets = payload.mode === 'replace'
            ? payload.brackets
            : generateSssBrackets(payload.params || {});
        if (!Array.isArray(brackets) || brackets.length === 0) {
            throw Object.assign(new Error('At least one bracket is required'), { code: 'INVALID_BRACKET_PARAMS' });
        }

        await executor.query('DELETE FROM sss_contribution_bracket WHERE version_id = $1', [versionId]);
        for (const b of brackets) {
            await executor.query(
                `INSERT INTO sss_contribution_bracket
                    (version_id, range_from, range_to, msc, ee_amount, er_amount, ec_amount, mpf_ee, mpf_er)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                [versionId, b.range_from, b.range_to ?? null, b.msc,
                    b.ee_amount, b.er_amount, b.ec_amount ?? 0, b.mpf_ee ?? 0, b.mpf_er ?? 0]
            );
        }
        return { agency: 'SSS', bracketCount: brackets.length };
    }

    if (version.agency === 'PHILHEALTH') {
        const { premium_rate, income_floor, income_ceiling, ee_share_ratio } = payload;
        await executor.query(
            `INSERT INTO philhealth_config (version_id, premium_rate, income_floor, income_ceiling, ee_share_ratio)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (version_id) DO UPDATE
             SET premium_rate = EXCLUDED.premium_rate,
                 income_floor = EXCLUDED.income_floor,
                 income_ceiling = EXCLUDED.income_ceiling,
                 ee_share_ratio = EXCLUDED.ee_share_ratio`,
            [versionId, premium_rate, income_floor, income_ceiling, ee_share_ratio ?? 0.5]
        );
        return { agency: 'PHILHEALTH' };
    }

    if (version.agency === 'PAGIBIG') {
        const { threshold_amount, ee_rate_below, ee_rate_above, er_rate, max_compensation } = payload;
        await executor.query(
            `INSERT INTO pagibig_config
                (version_id, threshold_amount, ee_rate_below, ee_rate_above, er_rate, max_compensation)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (version_id) DO UPDATE
             SET threshold_amount = EXCLUDED.threshold_amount,
                 ee_rate_below = EXCLUDED.ee_rate_below,
                 ee_rate_above = EXCLUDED.ee_rate_above,
                 er_rate = EXCLUDED.er_rate,
                 max_compensation = EXCLUDED.max_compensation`,
            [versionId, threshold_amount, ee_rate_below, ee_rate_above, er_rate, max_compensation]
        );
        return { agency: 'PAGIBIG' };
    }

    // BIR_WTAX
    const brackets = payload.brackets;
    if (!Array.isArray(brackets) || brackets.length === 0) {
        throw Object.assign(new Error('At least one bracket is required'), { code: 'INVALID_BRACKET_PARAMS' });
    }
    const frequency = payload.payroll_frequency || 'SEMI_MONTHLY';
    await executor.query(
        'DELETE FROM bir_withholding_bracket WHERE version_id = $1 AND payroll_frequency = $2',
        [versionId, frequency]
    );
    let seq = 0;
    for (const b of brackets) {
        seq += 1;
        await executor.query(
            `INSERT INTO bir_withholding_bracket
                (version_id, payroll_frequency, bracket_seq, lower_bound, upper_bound, base_tax, rate_percent, excess_over)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [versionId, frequency, seq, b.lower_bound, b.upper_bound ?? null,
                b.base_tax ?? 0, b.rate_percent, b.excess_over ?? b.lower_bound]
        );
    }
    return { agency: 'BIR_WTAX', payroll_frequency: frequency, bracketCount: brackets.length };
};

/**
 * Supersedes a version: closes the old one the day before the new start date
 * and clones its figures into a new version for editing.
 *
 * Cloning rather than starting blank matters — a circular usually moves one
 * number, and re-keying 61 SSS rows to change a rate is how mistakes happen.
 */
const supersedeVersion = async (executor, { versionId, effectiveFrom, versionLabel, sourceReference, createdBy }) => {
    const old = await getVersion(executor, versionId);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom || '')) {
        throw Object.assign(new Error('effectiveFrom must be a YYYY-MM-DD date'), { code: 'INVALID_EFFECTIVE_DATE' });
    }
    if (effectiveFrom <= old.effective_from) {
        throw Object.assign(
            new Error(`The new schedule must start after the one it replaces (${old.effective_from}).`),
            { code: 'INVALID_EFFECTIVE_DATE' }
        );
    }

    // Close the old range first: the exclusion constraint would reject the
    // insert while the old version is still open-ended.
    await executor.query(
        "UPDATE statutory_table_version SET effective_to = ($1::date - INTERVAL '1 day')::date WHERE version_id = $2",
        [effectiveFrom, versionId]
    );

    const created = await createVersion(executor, {
        agency: old.agency,
        versionLabel: versionLabel || `${old.version_label} (superseded ${effectiveFrom})`,
        effectiveFrom,
        sourceReference: sourceReference || old.source_reference,
        createdBy,
    });

    // Clone the figures so the new version starts from the current numbers.
    if (old.agency === 'SSS') {
        await executor.query(
            `INSERT INTO sss_contribution_bracket
                (version_id, range_from, range_to, msc, ee_amount, er_amount, ec_amount, mpf_ee, mpf_er)
             SELECT $1, range_from, range_to, msc, ee_amount, er_amount, ec_amount, mpf_ee, mpf_er
             FROM sss_contribution_bracket WHERE version_id = $2`,
            [created.version_id, versionId]
        );
    } else if (old.agency === 'PHILHEALTH') {
        await executor.query(
            `INSERT INTO philhealth_config (version_id, premium_rate, income_floor, income_ceiling, ee_share_ratio)
             SELECT $1, premium_rate, income_floor, income_ceiling, ee_share_ratio
             FROM philhealth_config WHERE version_id = $2`,
            [created.version_id, versionId]
        );
    } else if (old.agency === 'PAGIBIG') {
        await executor.query(
            `INSERT INTO pagibig_config
                (version_id, threshold_amount, ee_rate_below, ee_rate_above, er_rate, max_compensation)
             SELECT $1, threshold_amount, ee_rate_below, ee_rate_above, er_rate, max_compensation
             FROM pagibig_config WHERE version_id = $2`,
            [created.version_id, versionId]
        );
    } else {
        await executor.query(
            `INSERT INTO bir_withholding_bracket
                (version_id, payroll_frequency, bracket_seq, lower_bound, upper_bound, base_tax, rate_percent, excess_over)
             SELECT $1, payroll_frequency, bracket_seq, lower_bound, upper_bound, base_tax, rate_percent, excess_over
             FROM bir_withholding_bracket WHERE version_id = $2`,
            [created.version_id, versionId]
        );
    }

    return { supersededVersionId: versionId, newVersion: created };
};

module.exports = {
    generateSssBrackets,
    isInUse,
    assertEditable,
    getVersion,
    createVersion,
    updateVersion,
    replaceBrackets,
    supersedeVersion,
};
