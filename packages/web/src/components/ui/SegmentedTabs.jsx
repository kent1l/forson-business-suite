/**
 * Underline-style tab switcher shared across pages that split content into a
 * few top-level sections (e.g. Treasury Desk's Inbound/Outbound split, and
 * the Cheques & Treasury module's section nav). Centralizes the active/hover
 * color so it stays on the brand's primary token instead of a hardcoded blue.
 */
const SegmentedTabs = ({ tabs = [], active, onChange, className = '' }) => (
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

export default SegmentedTabs;
