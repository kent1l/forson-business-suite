import { useEffect, useState } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Modal from '../ui/Modal';
import { useAuth } from '../../contexts/AuthContext';

const SalesCorrectionModal = ({ isOpen, onClose, invoice, onCompleted }) => {
    const { hasPermission } = useAuth();
    const [preview, setPreview] = useState(null);
    const [reasonCode, setReasonCode] = useState('ENTRY_ERROR');
    const [reasonText, setReasonText] = useState('');
    const [caseRow, setCaseRow] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!isOpen || !invoice) return;
        let active = true;
        setPreview(null); setCaseRow(null); setReasonText('');
        api.post('/sales-corrections/preview', { invoice_id: invoice.invoice_id })
            .then(({ data }) => active && setPreview(data))
            .catch(err => active && toast.error(err.response?.data?.message || 'Unable to assess this sale.'));
        return () => { active = false; };
    }, [isOpen, invoice]);

    const createCase = async () => {
        if (reasonText.trim().length < 5) return toast.error('Describe the mistake in at least five characters.');
        setLoading(true);
        try {
            const { data } = await api.post('/sales-corrections', {
                invoice_id: invoice.invoice_id, reason_code: reasonCode, reason_text: reasonText,
            }, { headers: { 'Idempotency-Key': crypto.randomUUID() } });
            setCaseRow(data.case);
            if (data.case.state === 'REQUIRES_MANUAL_REVIEW') {
                toast('This case has been recorded for manager/accounting review.');
            }
        } catch (err) {
            toast.error(err.response?.data?.message || 'Unable to create correction case.');
        } finally { setLoading(false); }
    };

    const approve = async () => {
        setLoading(true);
        try {
            const { data } = await api.post(`/sales-corrections/${caseRow.correction_case_id}/approve`);
            setCaseRow(data.case);
            toast.success('Sale corrected. Create the replacement as a new sale.');
            onCompleted();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Unable to approve correction.');
        } finally { setLoading(false); }
    };

    const proposal = preview?.proposal;
    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Correct & Restart Sale" maxWidth="max-w-2xl">
            <div className="space-y-4 text-sm">
                <p className="text-gray-600 dark:text-slate-300">
                    The original invoice remains in the audit trail. Any replacement must use a new invoice identity.
                </p>
                {proposal && (
                    <div className={`rounded-lg border p-3 ${proposal.automatic ? 'border-primary-200 bg-primary-50 dark:border-primary-800 dark:bg-primary-950/30' : 'border-warning-200 bg-warning-50 dark:border-warning-800 dark:bg-warning-950/30'}`}>
                        <div className="font-semibold">{proposal.automatic ? 'Eligible for cancel and restart' : 'Manager/accounting review required'}</div>
                        <div className="mt-1 text-gray-600 dark:text-slate-300">{proposal.reason || 'No payment or credit note will be changed; stock and A/R will be reversed once after approval.'}</div>
                    </div>
                )}
                {!caseRow && <>
                    <label className="block">Reason code
                        <select value={reasonCode} onChange={e => setReasonCode(e.target.value)} className="mt-1 w-full rounded border p-2 dark:bg-slate-800">
                            <option value="ENTRY_ERROR">Entry error</option><option value="WRONG_CUSTOMER">Wrong customer</option><option value="WRONG_ITEMS">Wrong items</option><option value="OTHER">Other</option>
                        </select>
                    </label>
                    <label className="block">Describe the mistake
                        <textarea value={reasonText} onChange={e => setReasonText(e.target.value)} rows="3" className="mt-1 w-full rounded border p-2 dark:bg-slate-800" />
                    </label>
                    <button disabled={loading || !preview} onClick={createCase} className="rounded bg-primary-600 px-4 py-2 font-semibold text-white disabled:opacity-50">Create correction case</button>
                </>}
                {caseRow && <div className="rounded border border-gray-200 p-3 dark:border-slate-700">
                    <div className="font-semibold">Case #{caseRow.correction_case_id}: {caseRow.state.replaceAll('_', ' ')}</div>
                    {caseRow.state === 'PENDING_APPROVAL' && (hasPermission('sales_correction:approve')
                        ? <button disabled={loading} onClick={approve} className="mt-3 rounded bg-success-600 px-4 py-2 font-semibold text-white disabled:opacity-50">Approve and execute</button>
                        : <p className="mt-2 text-warning-700 dark:text-warning-300">A manager with correction approval must approve this case.</p>)}
                    {caseRow.state === 'COMPLETED' && <p className="mt-2 text-success-700 dark:text-success-300">Completed. Close this dialog and start a clean replacement sale.</p>}
                    {caseRow.state === 'REQUIRES_MANUAL_REVIEW' && <p className="mt-2 text-warning-700 dark:text-warning-300">No financial entries were changed. Record the required payment/refund evidence during accounting review.</p>}
                </div>}
            </div>
        </Modal>
    );
};

export default SalesCorrectionModal;
