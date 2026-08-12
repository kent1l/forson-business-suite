/**
 * Tab switcher shared across pages that split content into a few sections
 * (e.g. Treasury Desk's Inbound/Outbound split, the Cheques & Treasury
 * module's top-level section nav, and nested settings sub-tabs).
 * Centralizes the active/hover color so it stays on the brand's primary
 * token instead of a hardcoded blue.
 *
 * `variant="underline"` (default) reads as primary navigation — use it for
 * the outermost tab level. `variant="pills"` reads as a secondary, nested
 * control — use it one level deeper (e.g. settings sub-tabs) so the two
 * levels are visually distinguishable at a glance.
 */
const SegmentedTabs = ({ tabs = [], active, onChange, className = '', variant = 'underline' }) => {
    if (variant === 'pills') {
        return (
            <div className={`inline-flex flex-wrap gap-1 rounded-lg bg-gray-100 dark:bg-slate-900/60 p-1 ${className}`}>
                {tabs.map((tab) => {
                    const isActive = tab.key === active;
                    return (
                        <button
                            key={tab.key}
                            type="button"
                            onClick={() => onChange(tab.key)}
                            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                                isActive
                                    ? 'bg-white dark:bg-slate-700 text-primary-700 dark:text-primary-400 shadow-sm'
                                    : 'text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200'
                            }`}
                        >
                            {tab.label}
                            {tab.badge > 0 && (
                                <span className="min-w-[16px] h-[16px] px-1 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center">
                                    {tab.badge > 99 ? '99+' : tab.badge}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
        );
    }

    return (
        <div className={`flex flex-wrap gap-x-6 gap-y-1 ${className}`}>
            {tabs.map((tab) => {
                const isActive = tab.key === active;
                return (
                    <button
                        key={tab.key}
                        type="button"
                        onClick={() => onChange(tab.key)}
                        className={`py-3 px-1 border-b-2 font-bold text-sm transition-all cursor-pointer flex items-center gap-2 ${
                            isActive
                                ? 'border-primary-600 text-primary-600 dark:border-primary-500 dark:text-primary-500'
                                : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 hover:border-gray-300 dark:hover:border-slate-600'
                        }`}
                    >
                        {tab.label}
                        {tab.badge > 0 && (
                            <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center">
                                {tab.badge > 99 ? '99+' : tab.badge}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
};

export default SegmentedTabs;
