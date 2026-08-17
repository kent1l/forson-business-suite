import { useState } from 'react';
import Icon from '../../ui/Icon';
import InfoTip from '../../ui/InfoTip';
import { ICONS } from '../../../constants';
import { formatCurrency } from '../../../utils/currency';
import LoadingState from '../../ui/LoadingState';
import EmptyState from '../../ui/EmptyState';
import ChangeTransactionDateModal from '../../common/ChangeTransactionDateModal';
import { useAuth } from '../../../contexts/AuthContext';

// Maps an ar_ledger row's entry_type (plus payment_source, which
// disambiguates the two payment tables sharing the "PAYMENT_SETTLED" type —
// see 20260808_01_add_payment_source_to_ar_ledger.sql) to the
// transactionDateService "kind" + the row's id for that kind. Returns null
// for entry types the date-change feature doesn't cover (manual ledger
// adjustments have no anchor document to move).
function resolveDateChangeTarget(row) {
    switch (row.event_type) {
        case 'INVOICE_POSTED':
            return row.invoice_id ? { kind: 'invoice', id: row.invoice_id } : null;
        case 'PAYMENT_SETTLED':
            if (!row.payment_id) return null;
            return { kind: row.payment_source === 'invoice_payments' ? 'invoice_payment' : 'customer_payment', id: row.payment_id };
        case 'CREDIT_MEMO_APPLIED':
            return row.cn_id ? { kind: 'credit_note', id: row.cn_id } : null;
        default:
            return null;
    }
}

// Customer Ledger & Statement of Account tab: customer search combobox,
// running-balance ledger table, and PDC/floating-collections breakdown.
const ARLedgerSoaTab = ({
    soaComboboxRef,
    soaSearchQuery,
    onSoaSearchQueryChange,
    soaDropdownOpen,
    setSoaDropdownOpen,
    soaHighlightedIndex,
    setSoaHighlightedIndex,
    filteredSoaCustomers,
    soaCustomerId,
    selectSoaCustomer,
    onClearSoaCustomer,
    handleSoaKeyDown,
    attachReceiptImages,
    setAttachReceiptImages,
    handleExportSoaPdf,
    soaDownloading,
    soaLoading,
    soaLedger,
    dateRange,
    onAfterDateChange,
}) => {
    const { hasPermission } = useAuth();
    const canChangeDate = hasPermission(['transaction:change_date', 'transaction:change_date_unrestricted']);
    const [dateChangeTarget, setDateChangeTarget] = useState(null); // { kind, id, currentDate, label } | null

    return (
        <div className="space-y-6">
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="w-full md:w-96 relative" ref={soaComboboxRef}>
                    <label className="block text-xs font-semibold uppercase text-gray-600 mb-1">Search Customer</label>
                    <div className="relative">
                        <input
                            type="text"
                            value={soaSearchQuery}
                            onChange={(e) => {
                                onSoaSearchQueryChange(e.target.value);
                                setSoaDropdownOpen(true);
                                if (!e.target.value) {
                                    onClearSoaCustomer();
                                }
                            }}
                            onFocus={() => setSoaDropdownOpen(true)}
                            onKeyDown={handleSoaKeyDown}
                            placeholder="Search customer name, company..."
                            className="w-full px-3 py-2 pr-8 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        {soaSearchQuery && (
                            <button
                                type="button"
                                onClick={() => {
                                    onSoaSearchQueryChange('');
                                    onClearSoaCustomer();
                                    setSoaDropdownOpen(false);
                                    setSoaHighlightedIndex(-1);
                                }}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none p-1 rounded-full hover:bg-gray-100 transition-colors"
                                title="Clear search"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        )}
                    </div>

                    {/* Search Dropdown Results */}
                    {soaDropdownOpen && (
                        <div className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
                            {filteredSoaCustomers.length === 0 ? (
                                <div className="p-3 text-xs text-gray-500 text-center">No matching customer accounts found</div>
                            ) : (
                                filteredSoaCustomers.map((c, idx) => {
                                    const displayName = c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim();
                                    const isSelected = String(c.customer_id) === String(soaCustomerId);
                                    const isHighlighted = idx === soaHighlightedIndex;
                                    return (
                                        <button
                                            key={c.customer_id}
                                            type="button"
                                            ref={(el) => {
                                                if (isHighlighted && el) {
                                                    el.scrollIntoView({ block: 'nearest' });
                                                }
                                            }}
                                            onClick={() => selectSoaCustomer(c)}
                                            onMouseEnter={() => setSoaHighlightedIndex(idx)}
                                            className={`w-full text-left px-3 py-2 text-sm flex justify-between items-center transition-colors border-b border-gray-100 last:border-0 ${
                                                isHighlighted
                                                    ? 'bg-blue-100 font-semibold text-blue-900 ring-1 ring-blue-300'
                                                    : isSelected
                                                    ? 'bg-blue-50 font-semibold text-blue-700'
                                                    : 'text-gray-700 hover:bg-blue-50'
                                            }`}
                                        >
                                            <span className="truncate">{displayName}</span>
                                            <span className="font-mono text-xs text-gray-500 ml-2 whitespace-nowrap">
                                                {formatCurrency(c.total_balance_due || c.balance_due || 0)}
                                            </span>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    )}
                </div>
                {soaCustomerId && (
                    <div className="flex items-center gap-4">
                        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                            <div className="relative">
                                <input
                                    type="checkbox"
                                    checked={attachReceiptImages}
                                    onChange={(e) => setAttachReceiptImages(e.target.checked)}
                                    className="sr-only peer"
                                />
                                <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
                            </div>
                            <span className="text-xs font-semibold text-gray-700">Attach images</span>
                        </label>
                        <button
                            onClick={handleExportSoaPdf}
                            disabled={soaDownloading}
                            className="px-5 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 text-sm font-semibold transition-colors flex items-center gap-2 shadow-sm"
                        >
                            <Icon path={ICONS.documents} className="w-4 h-4" />
                            {soaDownloading ? 'Generating PDF...' : 'Export Statement of Account (PDF)'}
                        </button>
                    </div>
                )}
            </div>

            {soaLoading ? (
                <div className="bg-white rounded-xl border">
                    <LoadingState label="Loading customer ledger history..." />
                </div>
            ) : !soaLedger ? (
                <div className="bg-white rounded-xl border">
                    <EmptyState
                        icon={ICONS.customers}
                        title="No customer selected"
                        description="Please select a customer to view their statement of account and ledger history."
                    />
                </div>
            ) : (
                <div className="space-y-6">
                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                        <div className="p-6 border-b border-gray-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gray-50">
                            <div>
                                <div className="flex items-center gap-2">
                                    <h3 className="text-xl font-bold text-gray-800">{soaLedger.customer.name}</h3>
                                    <span className="px-2.5 py-0.5 rounded bg-blue-100 text-blue-800 text-xs font-mono font-semibold">
                                        {soaLedger.statement_number || 'SOA-STATEMENT'}
                                    </span>
                                </div>
                                <p className="text-xs text-gray-500 mt-1">
                                    Account ID: <span className="font-mono font-semibold">CUST-{soaLedger.customer.customer_id}</span> | {soaLedger.customer.email || 'No email'} | {soaLedger.customer.phone || 'No phone'}
                                </p>
                            </div>
                            <div className="text-right">
                                <div className="text-xs uppercase font-semibold text-gray-500 flex items-center justify-end gap-1">
                                    Net Account Balance
                                    <InfoTip label="Net Account Balance" align="right">
                                        The authoritative, ledger-based total this customer owes — drawn from the AR ledger rather than any single invoice, which is why it can differ slightly from adding up the table below by hand if a manual adjustment was posted.
                                    </InfoTip>
                                </div>
                                <div className="text-2xl font-bold font-mono text-blue-700">{formatCurrency(soaLedger.closing_balance)}</div>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left text-gray-500">
                                <thead className="text-xs text-gray-700 uppercase bg-gray-100 border-b">
                                    <tr>
                                        <th className="px-5 py-3">Txn Date</th>
                                        <th className="px-5 py-3">Due Date</th>
                                        <th className="px-5 py-3">Ref / Doc #</th>
                                        <th className="px-5 py-3">Description</th>
                                        <th className="px-5 py-3 text-right">Charges (Dr)</th>
                                        <th className="px-5 py-3 text-right">Credits (Cr)</th>
                                        <th className="px-5 py-3 text-right font-bold">Running Balance</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    <tr className="bg-blue-50/60 font-semibold text-gray-800">
                                        <td className="px-5 py-3 whitespace-nowrap">{dateRange.startDate.toLocaleDateString()}</td>
                                        <td className="px-5 py-3">—</td>
                                        <td className="px-5 py-3 font-mono text-xs text-gray-400">—</td>
                                        <td className="px-5 py-3 font-semibold text-blue-900">OPENING BALANCE BROUGHT FORWARD</td>
                                        <td className="px-5 py-3 text-right font-mono">—</td>
                                        <td className="px-5 py-3 text-right font-mono">—</td>
                                        <td className="px-5 py-3 text-right font-mono font-bold text-blue-900">{formatCurrency(soaLedger.opening_balance)}</td>
                                    </tr>
                                    {soaLedger.ledger_rows.map((row, idx) => {
                                        const dateChangeTargetForRow = resolveDateChangeTarget(row);
                                        return (
                                        <tr key={row.ledger_id || idx} className="hover:bg-gray-50">
                                            <td className="px-5 py-3.5 whitespace-nowrap">
                                                <div className="flex items-center gap-1.5">
                                                    <span>{new Date(row.date).toLocaleDateString()}</span>
                                                    {canChangeDate && dateChangeTargetForRow && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setDateChangeTarget({
                                                                ...dateChangeTargetForRow,
                                                                currentDate: row.date,
                                                                label: `${row.type_label || row.event_type} — ${row.primary_ref || row.sub_ref || ''}`,
                                                            })}
                                                            className="inline-flex items-center justify-center w-5 h-5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-1"
                                                            title="Change transaction date"
                                                        >
                                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                            </svg>
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-5 py-3.5 whitespace-nowrap text-gray-600">{row.due_date ? new Date(row.due_date).toLocaleDateString() : '—'}</td>
                                            <td className="px-5 py-3.5 font-mono text-xs">
                                                <div className="font-bold text-gray-900">
                                                    {row.primary_ref || row.physical_receipt_no || '-'}
                                                </div>
                                                {row.sub_ref && (
                                                    <div className="text-[11px] font-normal text-gray-400 mt-0.5">
                                                        {row.sub_ref}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-5 py-3.5">
                                                <div className="font-semibold text-gray-800">{row.type_label || row.event_type}</div>
                                                {row.description && <div className="text-xs text-gray-500">{row.description}</div>}
                                            </td>
                                            <td className="px-5 py-3.5 text-right font-mono text-gray-900 font-medium">{row.debit_amount ? formatCurrency(row.debit_amount) : '—'}</td>
                                            <td className="px-5 py-3.5 text-right font-mono text-emerald-700 font-medium">{row.credit_amount ? formatCurrency(row.credit_amount) : '—'}</td>
                                            <td className="px-5 py-3.5 text-right font-mono font-bold text-gray-900">{formatCurrency(row.running_balance)}</td>
                                        </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Floating Collections / Pending Cheques Breakdown Table */}
                    {soaLedger.pending_cheques && soaLedger.pending_cheques.length > 0 && (
                        <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-5 shadow-sm">
                            <div className="flex justify-between items-center mb-3">
                                <h4 className="text-sm font-bold text-amber-900 flex items-center gap-2">
                                    <Icon path={ICONS.history} className="w-4 h-4 shrink-0 text-amber-700" />
                                    <span>Floating Collections / Uncleared Cheques</span>
                                    <InfoTip label="Floating Collections / Uncleared Cheques">
                                        Cheque and bank transfer payments are recorded as pending until someone marks them settled after the bank clears them. The customer still technically owes this amount until then.
                                    </InfoTip>
                                    <span className="px-2 py-0.5 bg-amber-200 text-amber-900 rounded-full text-xs font-semibold">
                                        {soaLedger.pending_cheque_count} Items
                                    </span>
                                </h4>
                                <div className="text-sm font-bold font-mono text-amber-950">
                                    Total: {formatCurrency(soaLedger.pending_cheque_total)}
                                </div>
                            </div>
                            <p className="text-xs text-amber-800 mb-3">
                                The following cheques have been received and committed against invoices, but remain pending bank clearance.
                            </p>
                            <div className="overflow-x-auto bg-white rounded-lg border border-amber-200">
                                <table className="w-full text-xs text-left text-gray-600">
                                    <thead className="bg-amber-100/60 text-amber-950 uppercase font-semibold border-b border-amber-200">
                                        <tr>
                                            <th className="px-4 py-2.5">Cheque Date</th>
                                            <th className="px-4 py-2.5">Cheque / Ref #</th>
                                            <th className="px-4 py-2.5">Drawee Bank</th>
                                            <th className="px-4 py-2.5 text-center">Clearance Status</th>
                                            <th className="px-4 py-2.5 text-right">Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-amber-100">
                                        {soaLedger.pending_cheques.map((item) => (
                                            <tr key={item.payment_id} className="hover:bg-amber-50/30">
                                                <td className="px-4 py-2 whitespace-nowrap">{new Date(item.cheque_date).toLocaleDateString()}</td>
                                                <td className="px-4 py-2 font-mono font-semibold text-gray-800">{item.reference_number || '-'}</td>
                                                <td className="px-4 py-2">{item.payment_method_name || 'Bank Instrument'}</td>
                                                <td className="px-4 py-2 text-center">
                                                    <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 text-xs font-medium">
                                                        {item.pdc_status}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2 text-right font-mono font-bold text-gray-900">{formatCurrency(item.amount)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {dateChangeTarget && (
                <ChangeTransactionDateModal
                    isOpen={!!dateChangeTarget}
                    onClose={() => setDateChangeTarget(null)}
                    kind={dateChangeTarget.kind}
                    id={dateChangeTarget.id}
                    currentDate={dateChangeTarget.currentDate}
                    transactionLabel={dateChangeTarget.label}
                    onApplied={() => {
                        setDateChangeTarget(null);
                        onAfterDateChange && onAfterDateChange();
                    }}
                />
            )}
        </div>
    );
};

export default ARLedgerSoaTab;
