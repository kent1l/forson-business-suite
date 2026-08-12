const TONE_CLASSES = {
    success: 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400',
    danger: 'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-400',
    warning: 'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400',
    info: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    primary: 'bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-400',
    neutral: 'bg-neutral-100 text-neutral-700 dark:bg-slate-700 dark:text-slate-300',
};

/**
 * Shared status/maturity pill badge. `tone` maps to the app's semantic color
 * tokens so status meaning stays visually consistent (and dark-mode-correct)
 * across the cheque/PDC desk tables and history views.
 */
const StatusBadge = ({ tone = 'neutral', label, className = '', pill = true }) => (
    <span
        className={`text-[10px] font-bold uppercase px-2.5 py-1 ${pill ? 'rounded-full' : 'rounded-md'} ${TONE_CLASSES[tone] || TONE_CLASSES.neutral} ${className}`}
    >
        {label}
    </span>
);

export default StatusBadge;
