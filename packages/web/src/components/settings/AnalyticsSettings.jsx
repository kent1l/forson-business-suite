import InfoTip from '../ui/InfoTip';

/**
 * Admin configuration for the Business Analytics module.
 *
 * These keys are seeded by the migration rather than created here, because
 * PUT /settings issues an UPDATE and never an upsert — a key that was not
 * inserted silently no-ops when an admin tries to change it.
 *
 * Who may see which figures is not configured here: that is the
 * analytics:view / analytics:financials / analytics:export permissions under
 * Roles & Permissions, so the answer lives in one place rather than two.
 */
const PERIODS = [
    ['today', 'Today'],
    ['yesterday', 'Yesterday'],
    ['last_7_days', 'Last 7 days'],
    ['last_30_days', 'Last 30 days'],
    ['last_90_days', 'Last 90 days'],
    ['this_month', 'This month'],
    ['last_month', 'Last month'],
    ['this_quarter', 'This quarter'],
    ['year_to_date', 'Year to date'],
    ['last_12_months', 'Last 12 months'],
];

const inputClass = 'w-full px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100';

const AnalyticsSettings = ({ settings, handleChange }) => (
    <div className="space-y-8">
        <section>
            <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-slate-100">Business Analytics</h3>
            <p className="mb-4 text-sm text-gray-600 dark:text-slate-400">
                The Analytics page presents period comparison, trend and concentration on top of the
                same data the Reporting page exports. It does not change any figure Reporting produces,
                and turning it off here leaves Reporting and the Dashboard untouched.
            </p>

            <div className="max-w-2xl space-y-4">
                <label className="flex items-start gap-3">
                    <input
                        type="checkbox"
                        name="ANALYTICS_ENABLED"
                        checked={settings?.ANALYTICS_ENABLED !== 'false'}
                        onChange={(e) => handleChange({
                            target: { name: 'ANALYTICS_ENABLED', value: e.target.checked ? 'true' : 'false' },
                        })}
                        className="mt-1 h-4 w-4 rounded border-gray-300 text-primary-600"
                    />
                    <span>
                        <span className="block text-sm font-medium text-gray-800 dark:text-slate-200">
                            Enable the Analytics page
                        </span>
                        <span className="block text-xs text-gray-500 dark:text-slate-400">
                            Hides the page for everyone when off. Who can see it when it is on is set by the
                            <span className="font-mono"> analytics:view </span> permission.
                        </span>
                    </span>
                </label>

                <div>
                    <label className="mb-1 block text-sm font-medium text-gray-800 dark:text-slate-200">
                        Default period
                        <InfoTip label="Default period">
                            The date range a board opens on the first time someone visits. After that each
                            user&rsquo;s own choice is remembered on their device.
                        </InfoTip>
                    </label>
                    <select
                        name="ANALYTICS_DEFAULT_PERIOD"
                        value={settings?.ANALYTICS_DEFAULT_PERIOD ?? 'last_30_days'}
                        onChange={handleChange}
                        className={`${inputClass} max-w-[16rem]`}
                    >
                        {PERIODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                </div>

                <div>
                    <label className="mb-1 block text-sm font-medium text-gray-800 dark:text-slate-200">
                        Cache lifetime (seconds)
                        <InfoTip label="Cache lifetime">
                            How long a figure may be reused before it is recalculated. Short keeps a sale made
                            at the counter visible almost immediately; long absorbs the burst of queries a board
                            makes when it opens. Tiles always say how old a cached figure is and offer a refresh,
                            so nothing here can make a stale number look current.
                        </InfoTip>
                    </label>
                    <input
                        type="number" min="0" max="3600"
                        name="ANALYTICS_CACHE_TTL_SECONDS"
                        value={settings?.ANALYTICS_CACHE_TTL_SECONDS ?? '60'}
                        onChange={handleChange}
                        className={`${inputClass} max-w-[8rem]`}
                    />
                </div>

                <div>
                    <label className="mb-1 block text-sm font-medium text-gray-800 dark:text-slate-200">
                        Low coverage threshold (%)
                        <InfoTip label="Low coverage threshold">
                            Most sale lines in this system carry no recorded cost, so margin can only be measured
                            over the ones that do. Below this share, a profit or margin figure is presented as
                            measured on too little data to lead with. It never changes the number — only how
                            plainly the gap is stated.
                        </InfoTip>
                    </label>
                    <input
                        type="number" min="0" max="100"
                        name="ANALYTICS_LOW_COVERAGE_THRESHOLD"
                        value={settings?.ANALYTICS_LOW_COVERAGE_THRESHOLD ?? '50'}
                        onChange={handleChange}
                        className={`${inputClass} max-w-[8rem]`}
                    />
                </div>
            </div>
        </section>
    </div>
);

export default AnalyticsSettings;
