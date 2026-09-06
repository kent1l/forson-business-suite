import InfoTip from './InfoTip';

/**
 * States how much of a period's revenue a profit figure actually measured.
 *
 * Most parts in this system were created without a cost, so the sale lines that
 * reference them record `cost_at_sale` as 0 -- indistinguishable from a genuinely
 * free item. Those lines are excluded from profit, which means a profit figure
 * describes a subset of sales, not all of them. Showing the number without
 * saying so invites it to be read as the whole picture.
 *
 * Shared rather than inlined per report because the same disclosure is needed
 * anywhere a margin is shown.
 */

const LEVEL_STYLES = {
    ok: {
        wrapper: 'text-gray-500 dark:text-slate-400',
        dot: 'bg-success-500',
    },
    partial: {
        wrapper: 'text-amber-700 dark:text-amber-400',
        dot: 'bg-amber-500',
    },
    low: {
        wrapper: 'text-amber-700 dark:text-amber-400',
        dot: 'bg-amber-500',
    },
    none: {
        wrapper: 'text-gray-500 dark:text-slate-400',
        dot: 'bg-gray-400',
    },
};

const formatPercent = (ratio) => `${Math.round((Number(ratio) || 0) * 1000) / 10}%`;

const formatCount = (n) => Number(n || 0).toLocaleString();

const CostCoverageNotice = ({ coverage, className = '', onFixCostData = null }) => {
    if (!coverage) return null;

    const { valueRatio, level, costedLines, totalLines, explanation } = coverage;
    const styles = LEVEL_STYLES[level] || LEVEL_STYLES.none;
    const uncostedLines = Math.max(0, Number(totalLines || 0) - Number(costedLines || 0));

    const headline = level === 'none'
        ? 'No cost data for this period'
        : `Profit measured on ${formatPercent(valueRatio)} of sales`;

    return (
        <div className={`mt-3 pt-3 border-t border-gray-100 dark:border-slate-700 flex items-start gap-2 text-xs ${styles.wrapper} ${className}`}>
            <span className={`mt-1 h-1.5 w-1.5 rounded-full shrink-0 ${styles.dot}`} aria-hidden="true" />
            <span className="flex-1">
                {headline}
                <InfoTip label="Cost coverage">
                    {explanation || 'Profit is measured only on lines that carry a recorded cost.'}
                    {totalLines ? (
                        <>
                            {' '}
                            In this period {formatCount(uncostedLines)} of {formatCount(totalLines)} lines
                            have no recorded cost and are excluded from both revenue and cost.
                        </>
                    ) : null}
                </InfoTip>
                {onFixCostData && uncostedLines > 0 ? (
                    <>
                        {' · '}
                        <button
                            type="button"
                            onClick={onFixCostData}
                            className="underline hover:no-underline cursor-pointer"
                        >
                            Fix cost data
                        </button>
                    </>
                ) : null}
            </span>
        </div>
    );
};

export default CostCoverageNotice;
