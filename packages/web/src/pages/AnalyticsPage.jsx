import { useCallback, useEffect, useState } from 'react';
import api from '../api';
import { AnalyticsMetaProvider, useAnalyticsMeta } from '../hooks/useAnalyticsMeta';
import AnalyticsBoard from '../components/analytics/AnalyticsBoard';
import CreateBoardModal from '../components/analytics/CreateBoardModal';
import LoadingState from '../components/ui/LoadingState';
import ErrorState from '../components/ui/ErrorState';
import InfoTip from '../components/ui/InfoTip';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';

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
    const [isCreateOpen, setIsCreateOpen] = useState(false);

    const loadBoards = useCallback(() => {
        api.get('/analytics/boards')
            .then((res) => {
                setBoards(res.data || []);
                setActive((current) => current || res.data?.[0]?.id || null);
            })
            .catch((err) => setBoardsError(err?.response?.data?.message || 'Could not load the boards.'));
    }, []);

    useEffect(() => {
        loadBoards();
    }, [loadBoards]);

    const handleBoardCreated = (newBoard) => {
        setBoards((prev) => [...prev, newBoard]);
        setActive(newBoard.id);
    };

    const handleDeleteBoard = async (boardId) => {
        if (!window.confirm('Are you sure you want to delete this custom board?')) return;
        try {
            await api.delete(`/analytics/boards/${boardId}`);
            setBoards((prev) => {
                const updated = prev.filter((b) => b.id !== boardId);
                if (active === boardId) {
                    setActive(updated[0]?.id || null);
                }
                return updated;
            });
        } catch (err) {
            alert(err?.response?.data?.message || 'Failed to delete board.');
        }
    };

    if (loading) return <LoadingState label="Loading the metric catalogue…" />;
    if (error) return <ErrorState title="Analytics is unavailable" description={error} onRetry={reload} />;
    if (boardsError) return <ErrorState title="Analytics is unavailable" description={boardsError} />;
    if (!active) return <LoadingState label="Loading boards…" />;

    const current = boards.find((b) => b.id === active);

    return (
        <div>
            <nav className="mb-4 flex flex-wrap items-center gap-1 border-b border-neutral-200 dark:border-slate-700">
                {boards.map((b) => (
                    <button
                        key={b.id}
                        type="button"
                        onClick={() => setActive(b.id)}
                        className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                            b.id === active
                                ? 'border-primary-600 text-primary-700 dark:text-primary-400'
                                : 'border-transparent text-neutral-500 hover:text-neutral-700 dark:text-slate-400 dark:hover:text-slate-200'
                        }`}
                    >
                        <span>{b.title}</span>
                        {b.isCustom && (
                            <span className="rounded bg-neutral-100 px-1 py-0.5 text-[10px] text-neutral-600 dark:bg-slate-700 dark:text-slate-300">
                                Custom
                            </span>
                        )}
                    </button>
                ))}

                <button
                    type="button"
                    onClick={() => setIsCreateOpen(true)}
                    className="ml-auto mb-1 flex items-center gap-1 rounded-md border border-dashed border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:border-primary-500 hover:text-primary-600 dark:border-slate-600 dark:text-slate-300 dark:hover:border-primary-400 dark:hover:text-primary-400"
                >
                    <Icon path={ICONS.plus} className="h-3.5 w-3.5" />
                    New Board
                </button>
            </nav>

            <div className="mb-4 flex items-center justify-between">
                {current?.description ? (
                    <p className="text-sm text-neutral-500 dark:text-slate-400">{current.description}</p>
                ) : <div />}
                {current?.isCustom && current?.isOwner && (
                    <button
                        type="button"
                        onClick={() => handleDeleteBoard(current.id)}
                        className="flex items-center gap-1 text-xs text-neutral-400 hover:text-danger-600 dark:hover:text-danger-400"
                    >
                        <Icon path={ICONS.trash} className="h-3.5 w-3.5" /> Delete this board
                    </button>
                )}
            </div>

            {/* An insight can point at another board ("see the reorder list"), so
                the tab state has to be reachable from inside the board. */}
            <AnalyticsBoard
                boardId={active}
                onNavigate={onNavigate}
                onSelectBoard={(id) => { if (boards.some((b) => b.id === id)) setActive(id); }}
            />

            <CreateBoardModal
                isOpen={isCreateOpen}
                onClose={() => setIsCreateOpen(false)}
                onCreated={handleBoardCreated}
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
