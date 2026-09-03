import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import Icon from '../components/ui/Icon';
import SearchBar from '../components/SearchBar';
import FilterBar from '../components/ui/FilterBar';
import StatusBadge from '../components/ui/StatusBadge';
import EmptyState from '../components/ui/EmptyState';
import LoadingState from '../components/ui/LoadingState';
import ErrorState from '../components/ui/ErrorState';
import PaginationControls from '../components/ui/PaginationControls';
import { ICONS } from '../constants';
import { formatCurrency } from '../utils/currency';
import { useAuth } from '../contexts/AuthContext';

/**
 * The queue of receipts waiting to be checked.
 *
 * A draft is a receipt somebody has typed up but nobody has committed: no stock has
 * moved, no payable exists, no cost has changed. That is the whole point — it gives a
 * second person a chance to compare the entry against the supplier's paperwork before
 * any of it becomes true. This page is where that second person works, so it is built
 * for scanning a stack rather than studying one document: value and line count up
 * front, and bulk actions for the common case where several receipts are fine.
 */
const TABS = [
  { key: 'all', label: 'All pending' },
  { key: 'Draft', label: 'Drafts' },
  { key: 'Submitted', label: 'Awaiting review' },
];

const GoodsReceiptDraftsPage = ({ onNavigate }) => {
  const { hasPermission } = useAuth();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [activeTab, setActiveTab] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  const canSubmit = hasPermission('goods_receipt:submit');
  const canPost = hasPermission('goods_receipt:post');

  const fetchDrafts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/goods-receipts/drafts', {
        params: { status: activeTab, q: search || undefined, page, pageSize, paginated: 1 },
      });
      setRows(res.data?.data || []);
      setTotal(res.data?.total || 0);
      setSelected(new Set());
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not load pending receipts.');
    } finally {
      setLoading(false);
    }
  }, [activeTab, search, page, pageSize]);

  useEffect(() => { fetchDrafts(); }, [fetchDrafts]);
  useEffect(() => { setPage(1); }, [activeTab, search]);

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.grn_id)), [rows, selected]);
  // Only offer a bulk action where it is legal for every row picked — a mixed selection
  // that half-succeeds is worse than no bulk action at all.
  const canBulkSubmit = canSubmit && selectedRows.length > 0 && selectedRows.every((r) => r.workflow_status === 'Draft');
  const canBulkPost = canPost && selectedRows.length > 0 && selectedRows.every((r) => r.workflow_status === 'Submitted');

  const toggle = (grnId) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(grnId)) next.delete(grnId); else next.add(grnId);
    return next;
  });

  const toggleAll = () => setSelected((prev) => (
    prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.grn_id))
  ));

  const runBulk = async (label, call) => {
    setBusy(true);
    const results = await Promise.allSettled(selectedRows.map((r) => call(r)));
    setBusy(false);

    const failed = results.filter((r) => r.status === 'rejected');
    const succeeded = results.length - failed.length;
    if (succeeded > 0) toast.success(`${succeeded} receipt${succeeded === 1 ? '' : 's'} ${label}.`);
    // Name the failures rather than swallowing them — a receipt that silently did not
    // post is exactly the thing this queue exists to prevent.
    failed.forEach((f, i) => {
      const message = f.reason?.response?.data?.message || 'failed';
      toast.error(`${selectedRows[i]?.grn_number || 'Receipt'}: ${message}`, { duration: 7000 });
    });
    fetchDrafts();
  };

  const bulkSubmit = () => runBulk('sent for review', (r) => api.patch(`/goods-receipts/${r.grn_id}/submit`));
  const bulkPost = () => runBulk('posted', (r) => api.post(`/goods-receipts/${r.grn_id}/post`));
  const bulkCancel = () => {
    if (!window.confirm(`Cancel ${selectedRows.length} receipt(s)? Nothing has been posted, so nothing is reversed — the documents are simply abandoned.`)) return;
    runBulk('cancelled', (r) => api.patch(`/goods-receipts/${r.grn_id}/cancel`));
  };

  const openReceipt = (row) => onNavigate('goods_receipt', { grnId: row.grn_id });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Receipts awaiting review</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
            None of these have moved stock or created a payable yet.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('goods_receipt')}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700"
        >
          <Icon path={ICONS.plus} className="h-4 w-4" />
          New receipt
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterBar tabs={TABS} activeTab={activeTab} onTabClick={setActiveTab} />
        <div className="w-full sm:w-72">
          <SearchBar
            value={search}
            onChange={setSearch}
            onClear={() => setSearch('')}
            placeholder="Receipt no., supplier, invoice no."
          />
        </div>
      </div>

      {selectedRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-900/20 px-4 py-2">
          <span className="text-sm font-medium text-primary-900 dark:text-primary-200">
            {selectedRows.length} selected
          </span>
          <div className="flex flex-wrap gap-2 ml-auto">
            <button type="button" disabled={!canBulkSubmit || busy} onClick={bulkSubmit}
              className="px-3 py-1.5 text-sm rounded-md bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
              title={canBulkSubmit ? '' : 'Every selected receipt must still be a draft.'}>
              Submit for review
            </button>
            <button type="button" disabled={!canBulkPost || busy} onClick={bulkPost}
              className="px-3 py-1.5 text-sm rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              title={canBulkPost ? '' : 'Every selected receipt must be awaiting review.'}>
              Post
            </button>
            <button type="button" disabled={!canSubmit || busy} onClick={bulkCancel}
              className="px-3 py-1.5 text-sm rounded-md border border-danger-300 dark:border-danger-700 text-danger-700 dark:text-danger-300 hover:bg-danger-50 dark:hover:bg-danger-900/20 disabled:opacity-50 disabled:cursor-not-allowed">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading && <LoadingState />}
      {!loading && error && <ErrorState message={error} onRetry={fetchDrafts} />}
      {!loading && !error && rows.length === 0 && (
        <EmptyState
          icon={ICONS.receipt}
          title="Nothing waiting"
          description="Receipts saved as drafts, and those submitted for review, appear here until they are posted."
        />
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 dark:bg-slate-900/60 border-b border-gray-200 dark:border-slate-700">
              <tr>
                <th className="px-3 py-2 w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all receipts on this page"
                    checked={selected.size === rows.length && rows.length > 0}
                    onChange={toggleAll}
                  />
                </th>
                <th className="px-3 py-2 font-medium text-gray-600 dark:text-slate-300">Receipt</th>
                <th className="px-3 py-2 font-medium text-gray-600 dark:text-slate-300">Supplier</th>
                <th className="px-3 py-2 font-medium text-gray-600 dark:text-slate-300">Supplier invoice</th>
                <th className="px-3 py-2 font-medium text-gray-600 dark:text-slate-300 text-right">Lines</th>
                <th className="px-3 py-2 font-medium text-gray-600 dark:text-slate-300 text-right">Value</th>
                <th className="px-3 py-2 font-medium text-gray-600 dark:text-slate-300">Entered by</th>
                <th className="px-3 py-2 font-medium text-gray-600 dark:text-slate-300">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {rows.map((row) => (
                <tr
                  key={row.grn_id}
                  onClick={() => openReceipt(row)}
                  className="hover:bg-gray-50 dark:hover:bg-slate-700/50 cursor-pointer"
                >
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.grn_number}`}
                      checked={selected.has(row.grn_id)}
                      onChange={() => toggle(row.grn_id)}
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-gray-900 dark:text-slate-100">{row.grn_number}</td>
                  <td className="px-3 py-2 text-gray-900 dark:text-slate-100">{row.supplier_name}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-slate-400">{row.supplier_invoice_no || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-slate-400">{row.line_count}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900 dark:text-slate-100">
                    {formatCurrency(Number(row.total_value) || 0)}
                    {Number(row.freight_amount) > 0 && (
                      <span className="block text-[11px] font-normal text-gray-500 dark:text-slate-400">
                        incl. {formatCurrency(Number(row.freight_amount))} freight
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-600 dark:text-slate-400">{row.created_by_name || '—'}</td>
                  <td className="px-3 py-2">
                    <StatusBadge
                      pill
                      tone={row.workflow_status === 'Submitted' ? 'warning' : 'neutral'}
                      label={row.workflow_status === 'Submitted' ? 'Awaiting review' : 'Draft'}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && total > 0 && (
        <PaginationControls
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      )}
    </div>
  );
};

export default GoodsReceiptDraftsPage;
