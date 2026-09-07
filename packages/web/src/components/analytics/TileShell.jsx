import { Menu } from '@headlessui/react';
import Icon from '../ui/Icon';
import InfoTip from '../ui/InfoTip';
import LoadingState from '../ui/LoadingState';
import ErrorState from '../ui/ErrorState';
import { ICONS } from '../../constants';
import CoverageBadge from './CoverageBadge';

const SPAN_CLASS = {
    base: { 3: 'col-span-3', 4: 'col-span-4', 6: 'col-span-6', 12: 'col-span-12' },
    md: { 3: 'md:col-span-3', 4: 'md:col-span-4', 6: 'md:col-span-6', 8: 'md:col-span-8', 12: 'md:col-span-12' },
    lg: { 2: 'lg:col-span-2', 3: 'lg:col-span-3', 4: 'lg:col-span-4', 6: 'lg:col-span-6', 8: 'lg:col-span-8', 12: 'lg:col-span-12' },
};

const spanClasses = (span = {}) => [
    SPAN_CLASS.base[span.base] || 'col-span-12',
    SPAN_CLASS.md[span.md] || '',
    SPAN_CLASS.lg[span.lg] || '',
].filter(Boolean).join(' ');

const cacheAge = (ms) => {
    const seconds = Math.round((ms || 0) / 1000);
    if (seconds < 5) return null;
    return seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`;
};

/**
 * The frame every tile sits in: title, explanation, coverage, cache age, error
 * and loading states, and the actions menu.
 *
 * Two things here are requirements rather than decoration. A cached figure says
 * how old it is and offers a refresh, because a stale number at a counter must
 * be visibly stale. And a truncated result says so — a chart that silently shows
 * the top 8 of 444 brands is a chart that lies.
 */
const TileShell = ({
    title, help, span, loading, error, onRetry, coverage, truncated, cached, cacheAgeMs,
    actions = {}, footer, centerBody = false, children,
}) => (
    <section className={`${spanClasses(span)} flex flex-col rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800`}>
        <header className="mb-3 flex items-start justify-between gap-2">
            <h3 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-slate-400">
                {title}
                {help ? <InfoTip label={title}>{help}</InfoTip> : null}
            </h3>
            {(actions.onExportCsv || actions.onDrilldown || actions.onRefresh) && (
                <Menu as="div" className="relative shrink-0">
                    <Menu.Button
                        className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                        aria-label={`Actions for ${title}`}
                    >
                        <Icon path={ICONS.menu} className="h-4 w-4" />
                    </Menu.Button>
                    <Menu.Items className="absolute right-0 z-30 mt-1 w-44 rounded-lg border border-neutral-200 bg-white py-1 shadow-lg focus:outline-none dark:border-slate-700 dark:bg-slate-800">
                        {actions.onRefresh && (
                            <Menu.Item>
                                {({ active }) => (
                                    <button type="button" onClick={actions.onRefresh} className={`block w-full px-3 py-1.5 text-left text-xs ${active ? 'bg-neutral-50 dark:bg-slate-700' : ''} text-neutral-700 dark:text-slate-200`}>
                                        Refresh
                                    </button>
                                )}
                            </Menu.Item>
                        )}
                        {actions.onExportCsv && (
                            <Menu.Item>
                                {({ active }) => (
                                    <button type="button" onClick={actions.onExportCsv} className={`block w-full px-3 py-1.5 text-left text-xs ${active ? 'bg-neutral-50 dark:bg-slate-700' : ''} text-neutral-700 dark:text-slate-200`}>
                                        Export CSV
                                    </button>
                                )}
                            </Menu.Item>
                        )}
                        {actions.onDrilldown && (
                            <Menu.Item>
                                {({ active }) => (
                                    <button type="button" onClick={actions.onDrilldown} className={`block w-full px-3 py-1.5 text-left text-xs ${active ? 'bg-neutral-50 dark:bg-slate-700' : ''} text-neutral-700 dark:text-slate-200`}>
                                        {actions.drilldownLabel || 'Open details'}
                                    </button>
                                )}
                            </Menu.Item>
                        )}
                    </Menu.Items>
                </Menu>
            )}
        </header>

        <div className={`flex-1 min-w-0 ${centerBody ? 'flex flex-col justify-center' : ''}`}>
            {loading ? <LoadingState compact label="Loading…" />
                : error ? <ErrorState title="This tile failed" description={error} onRetry={onRetry} className="py-6" />
                    : children}
        </div>

        {(coverage || truncated || (cached && cacheAge(cacheAgeMs)) || footer) && (
            <footer className="mt-3 space-y-1 border-t border-neutral-100 pt-2 dark:border-slate-700">
                {coverage ? <CoverageBadge coverage={coverage} onFixData={actions.onFixData} /> : null}
                {footer}
                {truncated ? (
                    <p className="text-[11px] text-neutral-500 dark:text-slate-400">
                        Showing the top rows only — there are more than are listed here.
                    </p>
                ) : null}
                {cached && cacheAge(cacheAgeMs) ? (
                    <p className="text-[11px] text-neutral-400 dark:text-slate-500">
                        As of {cacheAge(cacheAgeMs)}
                        {actions.onRefresh ? (
                            <>
                                {' · '}
                                <button type="button" onClick={actions.onRefresh} className="underline hover:no-underline">Refresh</button>
                            </>
                        ) : null}
                    </p>
                ) : null}
            </footer>
        )}
    </section>
);

export default TileShell;
