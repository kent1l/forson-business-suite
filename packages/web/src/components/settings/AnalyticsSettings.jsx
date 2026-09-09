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

                <div className="flex items-start gap-3">
                    <input
                        type="checkbox"
                        id="ANALYTICS_INSIGHTS_ENABLED"
                        name="ANALYTICS_INSIGHTS_ENABLED"
                        checked={settings?.ANALYTICS_INSIGHTS_ENABLED !== 'false'}
                        onChange={(e) => handleChange({
                            target: { name: 'ANALYTICS_INSIGHTS_ENABLED', value: e.target.checked ? 'true' : 'false' },
                        })}
                        className="mt-1 h-4 w-4 rounded border-neutral-300 text-primary-600"
                    />
                    <label htmlFor="ANALYTICS_INSIGHTS_ENABLED" className="text-sm font-medium text-gray-800 dark:text-slate-200">
                        Show the insights panel
                        <InfoTip label="Insights panel">
                            A short list above each board saying what stands out — dead stock, parts about to run
                            out, how much of your sales the profit figures actually cover. Every line is worked
                            out from fixed rules in the code, never written by an AI, and each one names the
                            figures it came from so you can check it.
                        </InfoTip>
                    </label>
                </div>

                <div className="flex items-start gap-3">
                    <input
                        type="checkbox"
                        id="ANALYTICS_ALERTS_ENABLED"
                        name="ANALYTICS_ALERTS_ENABLED"
                        checked={settings?.ANALYTICS_ALERTS_ENABLED !== 'false'}
                        onChange={(e) => handleChange({
                            target: { name: 'ANALYTICS_ALERTS_ENABLED', value: e.target.checked ? 'true' : 'false' },
                        })}
                        className="mt-1 h-4 w-4 rounded border-neutral-300 text-primary-600"
                    />
                    <label htmlFor="ANALYTICS_ALERTS_ENABLED" className="text-sm font-medium text-gray-800 dark:text-slate-200">
                        Send insight alerts &amp; the weekly digest
                        <InfoTip label="Insight alerts">
                            When on, a daily scan raises an in-app notification for any critical or warning
                            insight, and a weekly digest summarises revenue, margin, open A/R and dead stock.
                            Both reuse the same rules and figures as the insights panel above.
                        </InfoTip>
                    </label>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-800 dark:text-slate-200">
                            Alert scan schedule (cron, Manila time)
                        </label>
                        <input
                            type="text"
                            name="ANALYTICS_ALERT_SCHEDULE"
                            value={settings?.ANALYTICS_ALERT_SCHEDULE ?? '30 7 * * *'}
                            onChange={handleChange}
                            placeholder="30 7 * * *"
                            disabled={settings?.ANALYTICS_ALERTS_ENABLED === 'false'}
                            className={`${inputClass} max-w-[14rem] font-mono disabled:opacity-50`}
                        />
                        <p className="mt-1 text-xs text-gray-500 dark:text-slate-500">
                            How often the daily insight scan runs. <a href="https://crontab.guru/" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary-600 dark:hover:text-primary-500">crontab.guru</a>
                        </p>
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-800 dark:text-slate-200">
                            Weekly digest schedule (cron, Manila time)
                        </label>
                        <input
                            type="text"
                            name="ANALYTICS_DIGEST_SCHEDULE"
                            value={settings?.ANALYTICS_DIGEST_SCHEDULE ?? '0 8 * * 1'}
                            onChange={handleChange}
                            placeholder="0 8 * * 1"
                            disabled={settings?.ANALYTICS_ALERTS_ENABLED === 'false'}
                            className={`${inputClass} max-w-[14rem] font-mono disabled:opacity-50`}
                        />
                        <p className="mt-1 text-xs text-gray-500 dark:text-slate-500">
                            When the weekly business summary notification goes out.
                        </p>
                    </div>
                </div>

                <div>
                    <label className="mb-1 block text-sm font-medium text-gray-800 dark:text-slate-200">
                        Walk-in customer record
                        <InfoTip label="Walk-in customer record">
                            The customer used for counter sales. It carries the great majority of invoices, so
                            until Analytics knows which record it is, it cannot tell counter trade apart from a
                            real account — and the insight about relying too much on one customer stays hidden
                            rather than naming the walk-in record. Enter the customer ID, or leave it blank if
                            you do not use one.
                        </InfoTip>
                    </label>
                    <input
                        type="number" min="1"
                        name="ANALYTICS_WALKIN_CUSTOMER_ID"
                        value={settings?.ANALYTICS_WALKIN_CUSTOMER_ID ?? ''}
                        onChange={handleChange}
                        placeholder="Not set"
                        className={`${inputClass} max-w-[8rem]`}
                    />
                </div>
            </div>
        </section>
    </div>
);

export default AnalyticsSettings;
