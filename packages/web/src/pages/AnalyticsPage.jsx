import { useEffect, useState } from 'react';
import api from '../api';
import { AnalyticsMetaProvider, useAnalyticsMeta } from '../hooks/useAnalyticsMeta';
import AnalyticsBoard from '../components/analytics/AnalyticsBoard';
import LoadingState from '../components/ui/LoadingState';
import ErrorState from '../components/ui/ErrorState';
import InfoTip from '../components/ui/InfoTip';

/**
 * Business Analytics.
 *
 * A separate page from Reporting on purpose: Reporting answers "give me the rows
 * for this range so I can export them", and this answers "how are we doing, and
 * against what". Neither replaces the other, and Reporting is untouched.
 */
const BoardTabs = ({ onNavigate }) => {
    const { loading, error, reload } = useAnalyticsMeta();
    const [boards, setBoards] = useState([]);
    const [active, setActive] = useState(null);
    const [boardsError, setBoardsError] = useState(null);

    useEffect(() => {
        api.get('/analytics/boards')
            .then((res) => {
                setBoards(res.data || []);
                setActive((current) => current || res.data?.[0]?.id || null);
            })
            .catch((err) => setBoardsError(err?.response?.data?.message || 'Could not load the boards.'));
    }, []);

    if (loading) return <LoadingState label="Loading the metric catalogue…" />;
    if (error) return <ErrorState title="Analytics is unavailable" description={error} onRetry={reload} />;
    if (boardsError) return <ErrorState title="Analytics is unavailable" description={boardsError} />;
    if (!active) return <LoadingState label="Loading boards…" />;

    const current = boards.find((b) => b.id === active);

    return (
        <div>
            {boards.length > 1 && (
                <nav className="mb-4 flex gap-1 border-b border-neutral-200 dark:border-slate-700">
                    {boards.map((b) => (
                        <button
                            key={b.id}
                            type="button"
                            onClick={() => setActive(b.id)}
                            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                                b.id === active
                                    ? 'border-primary-600 text-primary-700 dark:text-primary-400'
                                    : 'border-transparent text-neutral-500 hover:text-neutral-700 dark:text-slate-400 dark:hover:text-slate-200'
                            }`}
                        >
                            {b.title}
                        </button>
                    ))}
                </nav>
            )}

            {current?.description && (
                <p className="mb-4 text-sm text-neutral-500 dark:text-slate-400">{current.description}</p>
            )}

            {/* An insight can point at another board ("see the reorder list"), so
                the tab state has to be reachable from inside the board. */}
            <AnalyticsBoard
                boardId={active}
                onNavigate={onNavigate}
                onSelectBoard={(id) => { if (boards.some((b) => b.id === id)) setActive(id); }}
            />
        </div>
    );
};

const AnalyticsPage = ({ onNavigate }) => (
    <AnalyticsMetaProvider>
        <div className="p-4 sm:p-6">
            <header className="mb-5">
                <h1 className="flex items-center gap-1.5 text-2xl font-semibold text-neutral-800 dark:text-slate-100">
                    Business Analytics
                    <InfoTip label="Business Analytics">
                        Every figure here states how much of the underlying data it actually measured.
                        Margin, in particular, is computed only over sales lines that carry a recorded
                        cost — so it describes a real profit on part of the business, never an estimate
                        across all of it. Figures may differ from an older Reporting export taken before
                        the profit calculation was corrected.
                    </InfoTip>
                </h1>
            </header>
            <BoardTabs onNavigate={onNavigate} />
        </div>
    </AnalyticsMetaProvider>
);

export default AnalyticsPage;
