import { useState, useEffect, useCallback } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency } from '../utils/currency';
import KPICard from '../components/ui/KPICard';
import PdcClearanceDeskTable from '../components/accounts-receivable/PdcClearanceDeskTable';
import Modal from '../components/ui/Modal';

const PdcTreasuryPage = () => {
    const { hasPermission } = useAuth();
    const canManage = hasPermission('pdc:manage') || hasPermission('ar:manage');

    const [activeTab, setActiveTab] = useState('inbound'); // 'inbound' | 'outbound' | 'logs'

    // KPI Summary Stats
    const [stats, setStats] = useState({
        held_in_safe_count: 0,
        held_in_safe_total: 0,
        due_today_count: 0,
        due_today_total: 0,
        cleared_month_total: 0,
        bounced_count: 0,
        bounced_total: 0,
    });
    const [statsLoading, setStatsLoading] = useState(true);

    // Inbound Cheques State
    const [inboundItems, setInboundItems] = useState([]);
    const [pdcStatusFilter, setPdcStatusFilter] = useState('ALL');
    const [pdcMaturityFilter, setPdcMaturityFilter] = useState('ALL');
    const [inboundLoading, setInboundLoading] = useState(false);

    // Modal Action States
    const [selectedItem, setSelectedItem] = useState(null);
    const [actionModalType, setActionModalType] = useState(null); // 'clear' | 'bounce' | 'redeposit' | 'history'
    const [bounceFeeInput, setBounceFeeInput] = useState('0');
    const [bounceReasonInput, setBounceReasonInput] = useState('');
    const [redepositNotesInput, setRedepositNotesInput] = useState('');
    const [liftCreditHoldInput, setLiftCreditHoldInput] = useState(false);
    const [clearanceHistory, setClearanceHistory] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [submittingAction, setSubmittingAction] = useState(false);

    // Fetch Summary Stats
    const fetchStats = useCallback(async () => {
        setStatsLoading(true);
        try {
            const { data } = await api.get('/ar/pdc/summary-stats');
            if (data?.success && data?.data) {
                setStats(data.data);
            }
        } catch (err) {
            console.error('Error fetching PDC summary stats:', err);
        } finally {
            setStatsLoading(false);
        }
    }, []);

    // Fetch Inbound Cheques List
    const fetchInboundItems = useCallback(async () => {
        setInboundLoading(true);
        try {
            const res = await api.get('/ar/collections-clearance', {
                params: {
                    pdc_status: pdcStatusFilter !== 'ALL' ? pdcStatusFilter : undefined,
                    maturity_status: pdcMaturityFilter !== 'ALL' ? pdcMaturityFilter : undefined,
                },
            });
            if (res.data?.success && Array.isArray(res.data?.data)) {
                setInboundItems(res.data.data);
            }
        } catch (err) {
            console.error('Error fetching inbound PDC list:', err);
            toast.error('Failed to load inbound cheque clearance list');
        } finally {
            setInboundLoading(false);
        }
    }, [pdcStatusFilter, pdcMaturityFilter]);

    useEffect(() => {
        fetchStats();
        fetchInboundItems();
    }, [fetchStats, fetchInboundItems]);

    // Handle Clearance Verification
    const handleVerifyClearance = async (item) => {
        if (!canManage) {
            toast.error('You do not have permission to verify payment clearance');
            return;
        }
        setSelectedItem(item);
        setActionModalType('clear');
    };

    const confirmVerifyClearance = async () => {
        if (!selectedItem) return;
        setSubmittingAction(true);
        try {
            await api.post(`/ar/collections-clearance/${selectedItem.payment_id}/verify`, {
                source_table: selectedItem.source_table || 'auto',
            });
            toast.success(`Payment #${selectedItem.payment_id} verified and cleared!`);
            setActionModalType(null);
            setSelectedItem(null);
            fetchStats();
            fetchInboundItems();
        } catch (err) {
            console.error('Error clearing payment:', err);
            toast.error(err.response?.data?.message || 'Failed to verify clearance');
        } finally {
            setSubmittingAction(false);
        }
    };

    // Handle Mark Bounced
    const handleMarkBounced = (item) => {
        if (!canManage) {
            toast.error('You do not have permission to process bounced cheques');
            return;
        }
        setSelectedItem(item);
        setBounceFeeInput('250.00');
        setBounceReasonInput('NSF / Insufficient Funds');
        setActionModalType('bounce');
    };

    const confirmMarkBounced = async () => {
        if (!selectedItem) return;
        setSubmittingAction(true);
        try {
            await api.post(`/ar/collections-clearance/${selectedItem.payment_id}/fail`, {
                source_table: selectedItem.source_table || 'auto',
                bounce_fee: parseFloat(bounceFeeInput) || 0,
                reason: bounceReasonInput || 'NSF / Insufficient Funds',
            });
            toast.success(`Payment #${selectedItem.payment_id} marked as bounced and reversed.`);
            setActionModalType(null);
            setSelectedItem(null);
            fetchStats();
            fetchInboundItems();
        } catch (err) {
            console.error('Error bouncing payment:', err);
            toast.error(err.response?.data?.message || 'Failed to mark payment as bounced');
        } finally {
            setSubmittingAction(false);
        }
    };

    // Handle Re-deposit
    const handleRedepositCheque = (item) => {
        if (!canManage) {
            toast.error('You do not have permission to re-deposit cheques');
            return;
        }
        setSelectedItem(item);
        setRedepositNotesInput('Re-depositing cheque for bank clearance attempt #2');
        setLiftCreditHoldInput(false);
        setActionModalType('redeposit');
    };

    const confirmRedeposit = async () => {
        if (!selectedItem) return;
        setSubmittingAction(true);
        try {
            await api.post(`/ar/collections-clearance/${selectedItem.payment_id}/redeposit`, {
                source_table: selectedItem.source_table || 'auto',
                lift_credit_hold: liftCreditHoldInput,
                notes: redepositNotesInput,
            });
            toast.success(`Cheque #${selectedItem.payment_id} re-deposited for clearance!`);
            setActionModalType(null);
            setSelectedItem(null);
            fetchStats();
            fetchInboundItems();
        } catch (err) {
            console.error('Error re-depositing cheque:', err);
            toast.error(err.response?.data?.message || 'Failed to re-deposit cheque');
        } finally {
            setSubmittingAction(false);
        }
    };

    // View Audit History
    const handleViewHistory = async (item) => {
        setSelectedItem(item);
        setActionModalType('history');
        setHistoryLoading(true);
        try {
            const res = await api.get(`/ar/collections-clearance/${item.payment_id}/history`, {
                params: { source_table: item.source_table || 'auto' },
            });
            if (res.data?.success && Array.isArray(res.data?.data)) {
                setClearanceHistory(res.data.data);
            } else {
                setClearanceHistory([]);
            }
        } catch (err) {
            console.error('Error fetching cheque history:', err);
            toast.error('Failed to fetch clearance history timeline');
        } finally {
            setHistoryLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Header Title */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">PDC &amp; Treasury Desk</h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Centralized vault custody, post-dated cheque monitoring, bank clearance, and bounce reversals
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => { fetchStats(); fetchInboundItems(); }}
                    className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-xl text-xs font-semibold shadow-xs flex items-center gap-2 cursor-pointer"
                >
                    <span>🔄</span> Refresh Treasury Data
                </button>
            </div>

            {/* Vault Summary KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICard
                    title="Held in Vault / Safe"
                    value={formatCurrency(stats.held_in_safe_total)}
                    subtitle={`${stats.held_in_safe_count} cheque${stats.held_in_safe_count === 1 ? '' : 's'} in safe custody`}
                    icon="🏦"
                    color="blue"
                    loading={statsLoading}
                />
                <KPICard
                    title="Due Today / Mature"
                    value={formatCurrency(stats.due_today_total)}
                    subtitle={`${stats.due_today_count} cheque${stats.due_today_count === 1 ? '' : 's'} ready for bank deposit`}
                    icon="📅"
                    color="amber"
                    loading={statsLoading}
                />
                <KPICard
                    title="Cleared This Month"
                    value={formatCurrency(stats.cleared_month_total)}
                    subtitle="Successfully cleared bank deposits"
                    icon="✅"
                    color="emerald"
                    loading={statsLoading}
                />
                <KPICard
                    title="Bounced / NSF Cheques"
                    value={formatCurrency(stats.bounced_total)}
                    subtitle={`${stats.bounced_count} bounced cheque${stats.bounced_count === 1 ? '' : 's'} logged`}
                    icon="⚠️"
                    color="rose"
                    loading={statsLoading}
                />
            </div>

            {/* Top Workspace Tabs */}
            <div className="border-b border-gray-200 bg-white rounded-xl shadow-xs px-4 pt-2">
                <div className="flex space-x-8">
                    <button
                        type="button"
                        onClick={() => setActiveTab('inbound')}
                        className={`py-3 px-1 border-b-2 font-bold text-sm transition-all cursor-pointer ${
                            activeTab === 'inbound'
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                    >
                        📥 Customer Cheques (Inbound / AR)
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('outbound')}
                        className={`py-3 px-1 border-b-2 font-bold text-sm transition-all cursor-pointer ${
                            activeTab === 'outbound'
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                    >
                        📤 Supplier Cheques (Outbound / AP)
                    </button>
                </div>
            </div>

            {/* Tab 1: Inbound Customer Cheques */}
            {activeTab === 'inbound' && (
                <PdcClearanceDeskTable
                    items={inboundItems}
                    loading={inboundLoading}
                    pdcStatusFilter={pdcStatusFilter}
                    onStatusFilterChange={setPdcStatusFilter}
                    maturityFilter={pdcMaturityFilter}
                    onMaturityFilterChange={setPdcMaturityFilter}
                    onVerifyClearance={handleVerifyClearance}
                    onMarkBounced={handleMarkBounced}
                    onRedepositCheque={handleRedepositCheque}
                    onViewHistory={handleViewHistory}
                />
            )}

            {/* Tab 2: Outbound Supplier Cheques */}
            {activeTab === 'outbound' && (
                <div className="bg-white p-12 rounded-xl border border-gray-200 text-center shadow-xs space-y-3">
                    <div className="text-4xl">📤</div>
                    <h3 className="text-lg font-bold text-gray-800">Supplier Cheques (Outbound AP)</h3>
                    <p className="text-xs text-gray-500 max-w-md mx-auto">
                        Supplier post-dated cheque issuing &amp; bank withdrawal schedules. Issued cheques to vendors are tracked here against AP bill settlements.
                    </p>
                    <span className="inline-block px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-semibold border border-blue-200">
                        Integrated with AP Supplier Disbursements
                    </span>
                </div>
            )}

            {/* ── MODALS ──────────────────────────────────────────────────────────── */}

            {/* 1. Verify Clearance Confirmation Modal */}
            <Modal
                isOpen={actionModalType === 'clear'}
                onClose={() => { setActionModalType(null); setSelectedItem(null); }}
                title="Verify Cheque Clearance"
            >
                {selectedItem && (
                    <div className="space-y-4">
                        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2 text-xs text-emerald-900">
                            <p className="font-bold text-emerald-950 text-sm">Confirm Bank Clearance</p>
                            <p>You are marking this cheque payment as <strong>CLEARED</strong> by the bank:</p>
                            <ul className="list-disc pl-4 space-y-1 font-mono">
                                <li>Customer: <strong>{selectedItem.company_name || selectedItem.first_name}</strong></li>
                                <li>Cheque / Ref #: <strong>{selectedItem.reference_number || `#${selectedItem.payment_id}`}</strong></li>
                                <li>Amount: <strong>{formatCurrency(selectedItem.amount)}</strong></li>
                                {selectedItem.invoice_count > 1 && (
                                    <li>Invoices Covered: <strong>{selectedItem.invoice_count} invoices ({selectedItem.invoice_number})</strong></li>
                                )}
                            </ul>
                        </div>
                        <p className="text-xs text-gray-600">
                            This will post a <code className="bg-gray-100 px-1 py-0.5 rounded text-blue-700">PAYMENT_SETTLED</code> entry to the customer's A/R ledger and update the cash balance.
                        </p>
                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                type="button"
                                onClick={() => { setActionModalType(null); setSelectedItem(null); }}
                                className="px-4 py-2 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={submittingAction}
                                onClick={confirmVerifyClearance}
                                className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs cursor-pointer disabled:opacity-50"
                            >
                                {submittingAction ? 'Processing...' : 'Confirm Clearance'}
                            </button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* 2. Mark Bounced Modal */}
            <Modal
                isOpen={actionModalType === 'bounce'}
                onClose={() => { setActionModalType(null); setSelectedItem(null); }}
                title="Process Bounced Cheque (NSF)"
            >
                {selectedItem && (
                    <div className="space-y-4">
                        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl space-y-2 text-xs text-rose-900">
                            <p className="font-bold text-rose-950 text-sm">⚠️ Automated Reversal Warning</p>
                            <p>Bouncing this cheque will automatically:</p>
                            <ul className="list-disc pl-4 space-y-1">
                                <li>Reverse <strong>{formatCurrency(selectedItem.amount)}</strong> back onto open invoices.</li>
                                <li>Post a <code className="bg-rose-100 px-1 py-0.5 rounded font-mono">PDC_BOUNCED_REVERSAL</code> entry to the AR ledger.</li>
                                <li>Place customer <strong>{selectedItem.company_name || selectedItem.first_name}</strong> on <strong>Credit Hold</strong>.</li>
                            </ul>
                        </div>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-semibold text-gray-700 mb-1">Bounce Reason:</label>
                                <input
                                    type="text"
                                    value={bounceReasonInput}
                                    onChange={(e) => setBounceReasonInput(e.target.value)}
                                    className="w-full text-xs p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-rose-500"
                                    placeholder="e.g. NSF / Insufficient Funds, Account Closed"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-700 mb-1">Bank Penalty Fee (₱):</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={bounceFeeInput}
                                    onChange={(e) => setBounceFeeInput(e.target.value)}
                                    className="w-full text-xs p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-rose-500 font-mono"
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                type="button"
                                onClick={() => { setActionModalType(null); setSelectedItem(null); }}
                                className="px-4 py-2 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={submittingAction}
                                onClick={confirmMarkBounced}
                                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs cursor-pointer disabled:opacity-50"
                            >
                                {submittingAction ? 'Processing...' : 'Confirm Cheque Bounce'}
                            </button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* 3. Re-deposit Modal */}
            <Modal
                isOpen={actionModalType === 'redeposit'}
                onClose={() => { setActionModalType(null); setSelectedItem(null); }}
                title="Re-deposit Bounced Cheque"
            >
                {selectedItem && (
                    <div className="space-y-4">
                        <p className="text-xs text-gray-600">
                            Re-depositing cheque <strong>#{selectedItem.reference_number || selectedItem.payment_id}</strong> for bank clearance attempt.
                        </p>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-semibold text-gray-700 mb-1">Re-deposit Notes:</label>
                                <input
                                    type="text"
                                    value={redepositNotesInput}
                                    onChange={(e) => setRedepositNotesInput(e.target.value)}
                                    className="w-full text-xs p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={liftCreditHoldInput}
                                    onChange={(e) => setLiftCreditHoldInput(e.target.checked)}
                                    className="rounded text-blue-600 focus:ring-blue-500"
                                />
                                <span>Lift credit hold on customer profile upon re-deposit</span>
                            </label>
                        </div>
                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                type="button"
                                onClick={() => { setActionModalType(null); setSelectedItem(null); }}
                                className="px-4 py-2 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={submittingAction}
                                onClick={confirmRedeposit}
                                className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs cursor-pointer disabled:opacity-50"
                            >
                                {submittingAction ? 'Processing...' : 'Confirm Re-deposit'}
                            </button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* 4. Cheque History Modal */}
            <Modal
                isOpen={actionModalType === 'history'}
                onClose={() => { setActionModalType(null); setSelectedItem(null); }}
                title="Cheque Audit & Clearance History"
            >
                {selectedItem && (
                    <div className="space-y-4">
                        <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 flex justify-between items-center text-xs">
                            <div>
                                <span className="font-bold text-gray-900">{selectedItem.company_name || selectedItem.first_name}</span>
                                <span className="text-gray-400 ml-2 font-mono">Ref: #{selectedItem.reference_number || selectedItem.payment_id}</span>
                            </div>
                            <span className="font-bold font-mono text-blue-900">{formatCurrency(selectedItem.amount)}</span>
                        </div>

                        {historyLoading ? (
                            <div className="text-center py-6 text-xs text-gray-500 animate-pulse">Loading history timeline...</div>
                        ) : clearanceHistory.length === 0 ? (
                            <div className="text-center py-6 text-xs text-gray-400">No log entries found for this cheque.</div>
                        ) : (
                            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                                {clearanceHistory.map((log) => (
                                    <div key={log.log_id} className="p-3 bg-white border border-gray-200 rounded-lg shadow-2xs space-y-1 text-xs">
                                        <div className="flex justify-between items-center">
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                                log.action === 'CLEARED' ? 'bg-emerald-100 text-emerald-800' :
                                                log.action === 'BOUNCED' ? 'bg-rose-100 text-rose-800' :
                                                log.action === 'REDEPOSITED' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'
                                            }`}>
                                                {log.action} (Attempt #{log.attempt_number || 1})
                                            </span>
                                            <span className="text-[10px] text-gray-400">{new Date(log.created_at).toLocaleString()}</span>
                                        </div>
                                        {log.notes && <p className="text-gray-700 font-medium">{log.notes}</p>}
                                        {log.bounce_reason && <p className="text-rose-600 font-mono text-[11px]">Reason: {log.bounce_reason}</p>}
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="flex justify-end pt-2">
                            <button
                                type="button"
                                onClick={() => { setActionModalType(null); setSelectedItem(null); }}
                                className="px-4 py-2 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg cursor-pointer"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
};

export default PdcTreasuryPage;
