import InfoTip from '../ui/InfoTip';

/**
 * States how much of the underlying data a figure actually measured.
 *
 * The presentation is deliberately not a scale from 0 to 100. `none` is its own
 * state with no number at all, because a "0% cost coverage" badge next to
 * "₱0.00" reads as "we made no money", and "No cost data" reads as "we do not
 * know". Those must not look alike.
 *
 * Kept next to the analytics tiles rather than reusing CostCoverageNotice
 * directly: that component is shaped for a report card's footer and speaks only
 * about profit, whereas this one is inline, compact, and driven by whichever
 * trust rule the metric declared.
 */
const LEVEL = {
    ok: { chip: 'text-neutral-500 dark:text-slate-400', dot: 'bg-success-500' },
    partial: { chip: 'text-amber-700 dark:text-amber-400', dot: 'bg-amber-500' },
    low: { chip: 'text-amber-700 dark:text-amber-400', dot: 'bg-amber-500' },
    none: { chip: 'text-neutral-500 dark:text-slate-400', dot: 'bg-neutral-400' },
};

const pct = (ratio) => `${Math.round((Number(ratio) || 0) * 1000) / 10}%`;
const count = (n) => Number(n || 0).toLocaleString();

const CoverageBadge = ({ coverage, onFixData = null, className = '' }) => {
    if (!coverage) return null;
    const style = LEVEL[coverage.level] || LEVEL.none;
    const missingRows = Math.max(0, Number(coverage.denRows || 0) - Number(coverage.numRows || 0));

    const headline = coverage.level === 'none'
        ? 'No cost data for this period'
        : `Measured on ${pct(coverage.valueRatio)} of the data`;

    return (
        <div className={`flex items-start gap-1.5 text-[11px] ${style.chip} ${className}`}>
            <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
            <span className="flex-1 leading-snug">
                {headline}
                <InfoTip label={coverage.label || 'Coverage'}>
                    {coverage.explanation}
                    {coverage.denRows ? (
                        <>
                            {' '}
                            Here {count(missingRows)} of {count(coverage.denRows)} rows are excluded
                            {' '}({pct(coverage.rowRatio)} of rows carry the data, weighing {pct(coverage.valueRatio)} of the value).
                        </>
                    ) : null}
                </InfoTip>
                {onFixData && missingRows > 0 ? (
                    <>
                        {' · '}
                        <button type="button" onClick={onFixData} className="underline hover:no-underline">
                            Fix the data
                        </button>
                    </>
                ) : null}
            </span>
        </div>
    );
};

export default CoverageBadge;
