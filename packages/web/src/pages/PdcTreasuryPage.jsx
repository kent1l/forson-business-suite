import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency } from '../utils/currency';
import KPICard from '../components/ui/KPICard';
import PdcClearanceDeskTable from '../components/accounts-receivable/PdcClearanceDeskTable';
import PdcOutboundDeskTable from '../components/accounts-payable/PdcOutboundDeskTable';
import IssueOutboundChequeModal from '../components/accounts-payable/IssueOutboundChequeModal';
import Modal from '../components/ui/Modal';

const emptyStats = {
    held_in_safe_count: 0, held_in_safe_total: 0,
    due_today_count: 0, due_today_total: 0,
    cleared_month_total: 0, bounced_count: 0, bounced_total: 0,
};
const emptyOutboundStats = {
    held_for_release_count: 0, held_for_release_total: 0,
    due_today_count: 0, due_today_total: 0,
    cleared_month_total: 0, bounced_count: 0, bounced_total: 0,
};

const PdcTreasuryPage = () => {
    const { hasPermission } = useAuth();
    const canManage = hasPermission('pdc:manage') || hasPermission('ar:manage');
    const canManageOutbound = hasPermission('ap-pdc:manage');
    const canViewOutbound = hasPermission('ap-pdc:view') || canManageOutbound;

    const [activeTab, setActiveTab] = useState('inbound'); // 'inbound' | 'outbound'

    // Inbound (AR) KPI + list state
    const [stats, setStats] = useState(emptyStats);
    const [statsLoading, setStatsLoading] = useState(true);
    const [inboundItems, setInboundItems] = useState([]);
    const [pdcStatusFilter, setPdcStatusFilter] = useState('ALL');
    const [pdcMaturityFilter, setPdcMaturityFilter] = useState('ALL');
    const [inboundLoading, setInboundLoading] = useState(false);

    // Outbound (AP) KPI + list state
    const [outboundStats, setOutboundStats] = useState(emptyOutboundStats);
    const [outboundStatsLoading, setOutboundStatsLoading] = useState(true);
    const [outboundItems, setOutboundItems] = useState([]);
    const [outboundStatusFilter, setOutboundStatusFilter] = useState('ALL');
    const [outboundMaturityFilter, setOutboundMaturityFilter] = useState('ALL');
    const [outboundLoading, setOutboundLoading] = useState(false);
    const [issueModalOpen, setIssueModalOpen] = useState(false);

    // Modal Action States (shared, parameterized by selectedItem.direction)
    const [selectedItem, setSelectedItem] = useState(null);
    const [actionModalType, setActionModalType] = useState(null); // 'clear' | 'bounce' | 'redeposit' | 'void' | 'replace' | 'history'
    const [bounceFeeInput, setBounceFeeInput] = useState('0');
    const [bounceReasonInput, setBounceReasonInput] = useState('');
    const [redepositNotesInput, setRedepositNotesInput] = useState('');
    const [liftHoldInput, setLiftHoldInput] = useState(false);
    const [voidReasonInput, setVoidReasonInput] = useState('');
    const [replaceChequeNumberInput, setReplaceChequeNumberInput] = useState('');
    const [replaceChequeDateInput, setReplaceChequeDateInput] = useState('');
    const [replaceReasonInput, setReplaceReasonInput] = useState('');
    const [clearanceHistory, setClearanceHistory] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [submittingAction, setSubmittingAction] = useState(false);

    const fetchStats = useCallback(async () => {
        setStatsLoading(true);
        try {
            const { data } = await api.get('/ar/pdc/summary-stats');
            if (data?.success && data?.data) setStats(data.data);
        } catch (err) {
            console.error('Error fetching PDC summary stats:', err);
        } finally {
            setStatsLoading(false);
        }
    }, []);

    const fetchInboundItems = useCallback(async () => {
        setInboundLoading(true);
        try {
            const res = await api.get('/ar/collections-clearance', {
                params: {
                    pdc_status: pdcStatusFilter !== 'ALL' ? pdcStatusFilter : undefined,
                    maturity_status: pdcMaturityFilter !== 'ALL' ? pdcMaturityFilter : undefined,
                },
            });
            if (res.data?.success && Array.isArray(res.data?.data)) setInboundItems(res.data.data);
        } catch (err) {
            console.error('Error fetching inbound PDC list:', err);
            toast.error('Failed to load inbound cheque clearance list');
        } finally {
            setInboundLoading(false);
        }
    }, [pdcStatusFilter, pdcMaturityFilter]);

    const fetchOutboundStats = useCallback(async () => {
        if (!canViewOutbound) { setOutboundStatsLoading(false); return; }
        setOutboundStatsLoading(true);
        try {
            const { data } = await api.get('/ap/pdc/summary-stats');
            if (data?.success && data?.data) setOutboundStats(data.data);
        } catch (err) {
            console.error('Error fetching outbound PDC summary stats:', err);
        } finally {
            setOutboundStatsLoading(false);
        }
    }, [canViewOutbound]);

    const fetchOutboundItems = useCallback(async () => {
        if (!canViewOutbound) return;
        setOutboundLoading(true);
        try {
            const res = await api.get('/ap/outbound-clearance', {
                params: {
                    pdc_status: outboundStatusFilter !== 'ALL' ? outboundStatusFilter : undefined,
                    maturity_status: outboundMaturityFilter !== 'ALL' ? outboundMaturityFilter : undefined,
                },
            });
            if (res.data?.success && Array.isArray(res.data?.data)) setOutboundItems(res.data.data);
        } catch (err) {
            console.error('Error fetching outbound cheque list:', err);
            toast.error('Failed to load outbound cheque register');
        } finally {
            setOutboundLoading(false);
        }
    }, [outboundStatusFilter, outboundMaturityFilter, canViewOutbound]);

    useEffect(() => { fetchStats(); fetchInboundItems(); }, [fetchStats, fetchInboundItems]);
    useEffect(() => { fetchOutboundStats(); fetchOutboundItems(); }, [fetchOutboundStats, fetchOutboundItems]);

    const refreshAll = () => { fetchStats(); fetchInboundItems(); fetchOutboundStats(); fetchOutboundItems(); };

    // ── Reminder banner: due-today counts across both directions, computed from
    //    already-fetched lists — no extra API call ──
    const reminderSummary = useMemo(() => {
        const inboundDueToday = inboundItems.filter(i => i.maturity_status === 'DUE_TODAY').length;
        const outboundDueToday = outboundItems.filter(i => i.maturity_status === 'DUE_TODAY').length;
        const needsReplacement = outboundItems.filter(i => i.bounce_count > 0 && ['BOUNCED', 'STALE'].includes(i.pdc_status)).length
            + outboundItems.filter(i => i.maturity_status === 'STALE_CHEQUE' && !['CLEARED', 'VOID', 'REPLACED'].includes(i.pdc_status)).length;
        return { inboundDueToday, outboundDueToday, needsReplacement };
    }, [inboundItems, outboundItems]);

    // ── Inbound action handlers ──
    const handleVerifyClearance = (item) => {
        if (!canManage) return toast.error('You do not have permission to verify payment clearance');
        setSelectedItem({ ...item, direction: 'inbound' });
        setActionModalType('clear');
    };
    const handleMarkBounced = (item) => {
        if (!canManage) return toast.error('You do not have permission to process bounced cheques');
        setSelectedItem({ ...item, direction: 'inbound' });
        setBounceFeeInput('250.00');
        setBounceReasonInput('NSF / Insufficient Funds');
        setActionModalType('bounce');
    };
    const handleRedepositCheque = (item) => {
        if (!canManage) return toast.error('You do not have permission to re-deposit cheques');
        setSelectedItem({ ...item, direction: 'inbound' });
        setRedepositNotesInput('Re-depositing cheque for bank clearance attempt #2');
        setLiftHoldInput(false);
        setActionModalType('redeposit');
    };

    // ── Outbound action handlers ──
    const handleVerifyOutbound = (item) => {
        if (!canManageOutbound) return toast.error('You do not have permission to verify outbound cheques');
        setSelectedItem({ ...item, direction: 'outbound' });
        setActionModalType('clear');
    };
    const handleBounceOutbound = (item) => {
        if (!canManageOutbound) return toast.error('You do not have permission to process bounced cheques');
        setSelectedItem({ ...item, direction: 'outbound' });
        setBounceFeeInput('0.00');
        setBounceReasonInput('NSF / Insufficient Funds');
        setActionModalType('bounce');
    };
    const handleRedepositOutbound = (item) => {
        if (!canManageOutbound) return toast.error('You do not have permission to re-deposit cheques');
        setSelectedItem({ ...item, direction: 'outbound' });
        setRedepositNotesInput('Re-presenting cheque for bank clearance');
        setLiftHoldInput(false);
        setActionModalType('redeposit');
    };
    const handleVoidOutbound = (item) => {
        if (!canManageOutbound) return toast.error('You do not have permission to void cheques');
        setSelectedItem({ ...item, direction: 'outbound' });
        setVoidReasonInput('');
        setActionModalType('void');
    };
    const handleReplaceOutbound = (item) => {
        if (!canManageOutbound) return toast.error('You do not have permission to replace cheques');
        setSelectedItem({ ...item, direction: 'outbound' });
        setReplaceChequeNumberInput('');
        setReplaceChequeDateInput('');
        setReplaceReasonInput('');
        setActionModalType('replace');
    };

    const handleViewHistory = async (item, direction = 'inbound') => {
        setSelectedItem({ ...item, direction });
        setActionModalType('history');
        setHistoryLoading(true);
        try {
            const res = direction === 'outbound'
                ? await api.get(`/ap/outbound-clearance/${item.cheque_record_id}/history`)
                : await api.get(`/ar/collections-clearance/${item.payment_id}/history`, { params: { source_table: item.source_table || 'auto' } });
            setClearanceHistory(res.data?.success && Array.isArray(res.data?.data) ? res.data.data : []);
        } catch (err) {
            console.error('Error fetching cheque history:', err);
            toast.error('Failed to fetch clearance history timeline');
        } finally {
            setHistoryLoading(false);
        }
    };

    const closeModal = () => { setActionModalType(null); setSelectedItem(null); };

    const confirmVerifyClearance = async () => {
        if (!selectedItem) return;
        setSubmittingAction(true);
        try {
            if (selectedItem.direction === 'outbound') {
                await api.post(`/ap/outbound-clearance/${selectedItem.cheque_record_id}/verify`);
            } else {
                await api.post(`/ar/collections-clearance/${selectedItem.payment_id}/verify`, { source_table: selectedItem.source_table || 'auto' });
            }
            toast.success('Cheque verified and cleared!');
            closeModal();
            refreshAll();
        } catch (err) {
            console.error('Error clearing payment:', err);
            toast.error(err.response?.data?.message || 'Failed to verify clearance');
        } finally {
            setSubmittingAction(false);
        }
    };

    const confirmMarkBounced = async () => {
        if (!selectedItem) return;
        setSubmittingAction(true);
        try {
            if (selectedItem.direction === 'outbound') {
                await api.post(`/ap/outbound-clearance/${selectedItem.cheque_record_id}/fail`, {
                    bounce_fee: parseFloat(bounceFeeInput) || 0,
                    reason: bounceReasonInput || 'NSF / Insufficient Funds',
                });
            } else {
                await api.post(`/ar/collections-clearance/${selectedItem.payment_id}/fail`, {
                    source_table: selectedItem.source_table || 'auto',
                    bounce_fee: parseFloat(bounceFeeInput) || 0,
                    reason: bounceReasonInput || 'NSF / Insufficient Funds',
                });
            }
            toast.success('Cheque marked as bounced and reversed.');
            closeModal();
            refreshAll();
        } catch (err) {
            console.error('Error bouncing payment:', err);
            toast.error(err.response?.data?.message || 'Failed to mark cheque as bounced');
        } finally {
            setSubmittingAction(false);
        }
    };

    const confirmRedeposit = async () => {
        if (!selectedItem) return;
        setSubmittingAction(true);
        try {
            if (selectedItem.direction === 'outbound') {
                await api.post(`/ap/outbound-clearance/${selectedItem.cheque_record_id}/redeposit`, {
                    lift_payment_hold: liftHoldInput,
                    notes: redepositNotesInput,
                });
            } else {
                await api.post(`/ar/collections-clearance/${selectedItem.payment_id}/redeposit`, {
                    source_table: selectedItem.source_table || 'auto',
                    lift_credit_hold: liftHoldInput,
                    notes: redepositNotesInput,
                });
            }
            toast.success('Cheque re-deposited for clearance!');
            closeModal();
            refreshAll();
        } catch (err) {
            console.error('Error re-depositing cheque:', err);
            toast.error(err.response?.data?.message || 'Failed to re-deposit cheque');
        } finally {
            setSubmittingAction(false);
        }
    };

    const confirmVoid = async () => {
        if (!selectedItem || !voidReasonInput.trim()) {
            toast.error('A void reason is required');
            return;
        }
        setSubmittingAction(true);
        try {
            await api.post(`/ap/outbound-clearance/${selectedItem.cheque_record_id}/void`, { reason: voidReasonInput.trim() });
            toast.success('Cheque voided');
            closeModal();
            refreshAll();
        } catch (err) {
            console.error('Error voiding cheque:', err);
            toast.error(err.response?.data?.message || 'Failed to void cheque');
        } finally {
            setSubmittingAction(false);
        }
    };

    const confirmReplace = async () => {
        if (!selectedItem || !replaceChequeNumberInput || !replaceChequeDateInput) {
            toast.error('New cheque number and date are required');
            return;
        }
        setSubmittingAction(true);
        try {
            await api.post(`/ap/outbound-clearance/${selectedItem.cheque_record_id}/replace`, {
                new_cheque_number: replaceChequeNumberInput,
                new_cheque_date: replaceChequeDateInput,
                reason: replaceReasonInput,
            });
            toast.success('Replacement cheque issued');
            closeModal();
            refreshAll();
        } catch (err) {
            console.error('Error replacing cheque:', err);
            toast.error(err.response?.data?.message || 'Failed to replace cheque');
        } finally {
            setSubmittingAction(false);
        }
    };

    const activeStats = activeTab === 'outbound' ? outboundStats : stats;
    const activeStatsLoading = activeTab === 'outbound' ? outboundStatsLoading : statsLoading;
    const heldLabel = activeTab === 'outbound' ? 'Held for Release' : 'Held in Vault / Safe';
    const heldTotal = activeTab === 'outbound' ? activeStats.held_for_release_total : activeStats.held_in_safe_total;
    const heldCount = activeTab === 'outbound' ? activeStats.held_for_release_count : activeStats.held_in_safe_count;

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">PDC &amp; Treasury Desk</h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Centralized vault custody, post-dated cheque monitoring, bank clearance, and bounce reversals
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {activeTab === 'outbound' && canManageOutbound && (
                        <button type="button" onClick={() => setIssueModalOpen(true)}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-2 cursor-pointer">
                            <span>+</span> Issue Cheque
                        </button>
                    )}
                    <button type="button" onClick={refreshAll}
                        className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-xl text-xs font-semibold shadow-xs flex items-center gap-2 cursor-pointer">
                        <span>🔄</span> Refresh Treasury Data
                    </button>
                </div>
            </div>

            {/* Due-today / replacement-needed reminder banner */}
            {(reminderSummary.inboundDueToday + reminderSummary.outboundDueToday + reminderSummary.needsReplacement) > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-900 flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="font-bold">⏰ Attention:</span>
                    {reminderSummary.inboundDueToday > 0 && <span>{reminderSummary.inboundDueToday} inbound cheque{reminderSummary.inboundDueToday === 1 ? '' : 's'} due today</span>}
                    {reminderSummary.outboundDueToday > 0 && <span>{reminderSummary.outboundDueToday} outbound cheque{reminderSummary.outboundDueToday === 1 ? '' : 's'} due today</span>}
                    {reminderSummary.needsReplacement > 0 && <span className="text-rose-700 font-semibold">{reminderSummary.needsReplacement} outbound cheque{reminderSummary.needsReplacement === 1 ? '' : 's'} need replacement</span>}
                </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICard title={heldLabel} value={formatCurrency(heldTotal)}
                    subtitle={`${heldCount} cheque${heldCount === 1 ? '' : 's'}`} icon="🏦" color="blue" loading={activeStatsLoading} />
                <KPICard title="Due Today / Mature" value={formatCurrency(activeStats.due_today_total)}
                    subtitle={`${activeStats.due_today_count} cheque${activeStats.due_today_count === 1 ? '' : 's'} ready for bank action`} icon="📅" color="amber" loading={activeStatsLoading} />
                <KPICard title="Cleared This Month" value={formatCurrency(activeStats.cleared_month_total)}
                    subtitle="Successfully cleared bank transactions" icon="✅" color="emerald" loading={activeStatsLoading} />
                <KPICard title="Bounced / NSF Cheques" value={formatCurrency(activeStats.bounced_total)}
                    subtitle={`${activeStats.bounced_count} bounced cheque${activeStats.bounced_count === 1 ? '' : 's'} logged`} icon="⚠️" color="rose" loading={activeStatsLoading} />
            </div>

            <div className="border-b border-gray-200 bg-white rounded-xl shadow-xs px-4 pt-2">
                <div className="flex space-x-8">
                    <button type="button" onClick={() => setActiveTab('inbound')}
                        className={`py-3 px-1 border-b-2 font-bold text-sm transition-all cursor-pointer ${activeTab === 'inbound' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>
                        📥 Customer Cheques (Inbound / AR)
                    </button>
                    <button type="button" onClick={() => setActiveTab('outbound')}
                        className={`py-3 px-1 border-b-2 font-bold text-sm transition-all cursor-pointer ${activeTab === 'outbound' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>
                        📤 Outbound Cheques (Supplier / Loan / Rent / Other)
                    </button>
                </div>
            </div>

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
                    onViewHistory={(item) => handleViewHistory(item, 'inbound')}
                />
            )}

            {activeTab === 'outbound' && (
                canViewOutbound ? (
                    <PdcOutboundDeskTable
                        items={outboundItems}
                        loading={outboundLoading}
                        pdcStatusFilter={outboundStatusFilter}
                        onStatusFilterChange={setOutboundStatusFilter}
                        maturityFilter={outboundMaturityFilter}
                        onMaturityFilterChange={setOutboundMaturityFilter}
                        onVerifyClearance={handleVerifyOutbound}
                        onMarkBounced={handleBounceOutbound}
                        onRedepositCheque={handleRedepositOutbound}
                        onVoidCheque={handleVoidOutbound}
                        onReplaceCheque={handleReplaceOutbound}
                        onViewHistory={(item) => handleViewHistory(item, 'outbound')}
                    />
                ) : (
                    <div className="bg-white p-12 rounded-xl border border-gray-200 text-center shadow-xs space-y-2">
                        <div className="text-4xl">🔒</div>
                        <p className="text-sm text-gray-600">You do not have permission to view outbound cheques.</p>
                    </div>
                )
            )}

            <IssueOutboundChequeModal
                isOpen={issueModalOpen}
                onClose={() => setIssueModalOpen(false)}
                onIssued={refreshAll}
            />

            {/* 1. Verify Clearance Confirmation Modal */}
            <Modal isOpen={actionModalType === 'clear'} onClose={closeModal} title="Verify Cheque Clearance">
                {selectedItem && (
                    <div className="space-y-4">
                        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2 text-xs text-emerald-900">
                            <p className="font-bold text-emerald-950 text-sm">Confirm Bank Clearance</p>
                            <p>You are marking this cheque payment as <strong>CLEARED</strong> by the bank:</p>
                            <ul className="list-disc pl-4 space-y-1 font-mono">
                                <li>{selectedItem.direction === 'outbound' ? 'Payee' : 'Customer'}: <strong>{selectedItem.company_name || selectedItem.payee || selectedItem.first_name}</strong></li>
                                <li>Cheque / Ref #: <strong>{selectedItem.cheque_number || selectedItem.reference_number || `#${selectedItem.payment_id}`}</strong></li>
                                <li>Amount: <strong>{formatCurrency(selectedItem.amount)}</strong></li>
                            </ul>
                        </div>
                        <p className="text-xs text-gray-600">
                            This will post a <code className="bg-gray-100 px-1 py-0.5 rounded text-blue-700">PAYMENT_SETTLED</code> entry to the {selectedItem.direction === 'outbound' ? "supplier's AP ledger" : "customer's AR ledger"} and update the cash balance.
                        </p>
                        <div className="flex justify-end gap-3 pt-2">
                            <button type="button" onClick={closeModal} className="px-4 py-2 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg cursor-pointer">Cancel</button>
                            <button type="button" disabled={submittingAction} onClick={confirmVerifyClearance}
                                className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs cursor-pointer disabled:opacity-50">
                                {submittingAction ? 'Processing...' : 'Confirm Clearance'}
                            </button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* 2. Mark Bounced Modal */}
            <Modal isOpen={actionModalType === 'bounce'} onClose={closeModal} title="Process Bounced Cheque (NSF)">
                {selectedItem && (
                    <div className="space-y-4">
                        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl space-y-2 text-xs text-rose-900">
                            <p className="font-bold text-rose-950 text-sm">⚠️ Automated Reversal Warning</p>
                            <p>Bouncing this cheque will automatically:</p>
                            <ul className="list-disc pl-4 space-y-1">
                                <li>Reverse <strong>{formatCurrency(selectedItem.amount)}</strong> back onto {selectedItem.direction === 'outbound' ? 'open bills' : 'open invoices'}.</li>
                                <li>Post a <code className="bg-rose-100 px-1 py-0.5 rounded font-mono">PDC_BOUNCED_REVERSAL</code> entry to the {selectedItem.direction === 'outbound' ? 'AP' : 'AR'} ledger.</li>
                                <li>Place {selectedItem.direction === 'outbound' ? 'supplier' : 'customer'} <strong>{selectedItem.company_name || selectedItem.payee}</strong> on <strong>{selectedItem.direction === 'outbound' ? 'Payment Hold' : 'Credit Hold'}</strong>.</li>
                            </ul>
                        </div>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-semibold text-gray-700 mb-1">Bounce Reason:</label>
                                <input type="text" value={bounceReasonInput} onChange={(e) => setBounceReasonInput(e.target.value)}
                                    className="w-full text-xs p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-rose-500"
                                    placeholder="e.g. NSF / Insufficient Funds, Account Closed" />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-700 mb-1">Bank Penalty Fee (₱):</label>
                                <input type="number" step="0.01" value={bounceFeeInput} onChange={(e) => setBounceFeeInput(e.target.value)}
                                    className="w-full text-xs p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-rose-500 font-mono" />
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 pt-2">
                            <button type="button" onClick={closeModal} className="px-4 py-2 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg cursor-pointer">Cancel</button>
                            <button type="button" disabled={submittingAction} onClick={confirmMarkBounced}
                                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs cursor-pointer disabled:opacity-50">
                                {submittingAction ? 'Processing...' : 'Confirm Cheque Bounce'}
                            </button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* 3. Re-deposit Modal */}
            <Modal isOpen={actionModalType === 'redeposit'} onClose={closeModal} title="Re-deposit Bounced Cheque">
                {selectedItem && (
                    <div className="space-y-4">
                        <p className="text-xs text-gray-600">
                            Re-presenting cheque <strong>#{selectedItem.cheque_number || selectedItem.reference_number || selectedItem.payment_id}</strong> for bank clearance attempt.
                        </p>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-semibold text-gray-700 mb-1">Re-deposit Notes:</label>
                                <input type="text" value={redepositNotesInput} onChange={(e) => setRedepositNotesInput(e.target.value)}
                                    className="w-full text-xs p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
                            </div>
                            <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                                <input type="checkbox" checked={liftHoldInput} onChange={(e) => setLiftHoldInput(e.target.checked)}
                                    className="rounded text-blue-600 focus:ring-blue-500" />
                                <span>Lift {selectedItem.direction === 'outbound' ? 'payment' : 'credit'} hold upon re-deposit</span>
                            </label>
                        </div>
                        <div className="flex justify-end gap-3 pt-2">
                            <button type="button" onClick={closeModal} className="px-4 py-2 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg cursor-pointer">Cancel</button>
                            <button type="button" disabled={submittingAction} onClick={confirmRedeposit}
                                className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs cursor-pointer disabled:opacity-50">
                                {submittingAction ? 'Processing...' : 'Confirm Re-deposit'}
                            </button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* 4. Void Cheque Modal (outbound only) */}
            <Modal isOpen={actionModalType === 'void'} onClose={closeModal} title="Void Cheque">
                {selectedItem && (
                    <div className="space-y-4">
                        <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-700">
                            Voiding cheque <strong>#{selectedItem.cheque_number}</strong> marks it as spoiled/never issued. This keeps the cheque-number sequence explainable — the number will never be reused.
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">Reason (required):</label>
                            <input type="text" value={voidReasonInput} onChange={(e) => setVoidReasonInput(e.target.value)}
                                className="w-full text-xs p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500" placeholder="e.g. Writing mistake, misprint" />
                        </div>
                        <div className="flex justify-end gap-3 pt-2">
                            <button type="button" onClick={closeModal} className="px-4 py-2 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg cursor-pointer">Cancel</button>
                            <button type="button" disabled={submittingAction} onClick={confirmVoid}
                                className="px-4 py-2 text-xs font-bold text-white bg-gray-700 hover:bg-gray-800 rounded-lg shadow-xs cursor-pointer disabled:opacity-50">
                                {submittingAction ? 'Processing...' : 'Confirm Void'}
                            </button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* 5. Replace Cheque Modal (outbound only) */}
            <Modal isOpen={actionModalType === 'replace'} onClose={closeModal} title="Replace Cheque">
                {selectedItem && (
                    <div className="space-y-4">
                        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
                            Cheque <strong>#{selectedItem.cheque_number}</strong> is no longer usable. A new cheque will be issued for the same obligation, linked back to this one for a continuous audit trail.
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-semibold text-gray-700 mb-1">New Cheque Number:</label>
                                <input type="text" value={replaceChequeNumberInput} onChange={(e) => setReplaceChequeNumberInput(e.target.value)}
                                    className="w-full text-xs p-2 border border-gray-300 rounded-lg font-mono focus:ring-2 focus:ring-amber-500" />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-700 mb-1">New Cheque Date:</label>
                                <input type="date" value={replaceChequeDateInput} onChange={(e) => setReplaceChequeDateInput(e.target.value)}
                                    className="w-full text-xs p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500" />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">Reason:</label>
                            <input type="text" value={replaceReasonInput} onChange={(e) => setReplaceReasonInput(e.target.value)}
                                className="w-full text-xs p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500" placeholder="e.g. Bounced twice, gone stale" />
                        </div>
                        <div className="flex justify-end gap-3 pt-2">
                            <button type="button" onClick={closeModal} className="px-4 py-2 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg cursor-pointer">Cancel</button>
                            <button type="button" disabled={submittingAction} onClick={confirmReplace}
                                className="px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-xs cursor-pointer disabled:opacity-50">
                                {submittingAction ? 'Processing...' : 'Issue Replacement'}
                            </button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* 6. Cheque History Modal */}
            <Modal isOpen={actionModalType === 'history'} onClose={closeModal} title="Cheque Audit & Clearance History">
                {selectedItem && (
                    <div className="space-y-4">
                        <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 flex justify-between items-center text-xs">
                            <div>
                                <span className="font-bold text-gray-900">{selectedItem.company_name || selectedItem.payee || selectedItem.first_name}</span>
                                <span className="text-gray-400 ml-2 font-mono">Ref: #{selectedItem.cheque_number || selectedItem.reference_number || selectedItem.payment_id}</span>
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
                                                log.action === 'REDEPOSITED' ? 'bg-blue-100 text-blue-800' :
                                                log.action === 'VOID' ? 'bg-gray-200 text-gray-700' :
                                                log.action === 'REPLACED' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'
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
                            <button type="button" onClick={closeModal} className="px-4 py-2 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg cursor-pointer">Close</button>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
};

export default PdcTreasuryPage;
