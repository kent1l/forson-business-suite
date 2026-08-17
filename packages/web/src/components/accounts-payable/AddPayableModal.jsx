import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api';
import Modal from '../ui/Modal';
import Combobox from '../ui/Combobox';
import InfoTip from '../ui/InfoTip';

const today = () => new Date().toISOString().slice(0, 10);

const BLANK_FORM = { supplier_id: '', bill_number: '', bill_date: today(), due_date: '', total_amount: '', notes: '' };

/**
 * Creates a supplier_bill directly, without going through a Purchase Order or
 * Goods Receipt — for invoices/bills that arrive before (or without) a formal
 * stock-in, e.g. services, or paperwork that precedes the physical delivery.
 * Items can be attached to the resulting bill later via AttachItemsModal, which
 * performs the actual stock-in when the goods do arrive.
 */
const AddPayableModal = ({ isOpen, onClose, onCreated, presetSupplier = null }) => {
    const [suppliers, setSuppliers] = useState([]);
    const [form, setForm] = useState(BLANK_FORM);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setForm({ ...BLANK_FORM, supplier_id: presetSupplier?.supplier_id || '' });
        if (!presetSupplier) {
            api.get('/suppliers', { params: { status: 'active' } })
                .then(res => setSuppliers(res.data?.data || res.data || []))
                .catch(() => toast.error('Failed to load suppliers'));
        }
    }, [isOpen, presetSupplier]);

    const handleChange = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

    const handleSubmit = async (e) => {
        e.preventDefault();
        const amount = parseFloat(form.total_amount);
        if (!form.supplier_id) { toast.error('Select a supplier'); return; }
        if (!amount || amount <= 0) { toast.error('Enter a valid total amount'); return; }

        setSaving(true);
        try {
            await api.post('/ap/supplier-bills', {
                supplier_id: form.supplier_id,
                bill_number: form.bill_number.trim() || undefined,
                bill_date: form.bill_date || undefined,
                due_date: form.due_date || undefined,
                total_amount: amount,
                notes: form.notes.trim() || undefined,
            });
            toast.success('Payable created');
            onCreated && onCreated();
            onClose();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to create payable');
        } finally {
            setSaving(false);
        }
    };

    const inputClass = "w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500";
    const labelClass = "block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1";

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="New Payable" maxWidth="max-w-lg">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className={labelClass}>Supplier</label>
                    {presetSupplier ? (
                        <div className="px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-slate-100 text-sm">
                            {presetSupplier.supplier_name}
                        </div>
                    ) : (
                        <Combobox
                            options={suppliers.map(s => ({ value: s.supplier_id, label: s.supplier_name }))}
                            value={form.supplier_id}
                            onChange={(val) => handleChange('supplier_id', val)}
                            placeholder="Select a Supplier"
                        />
                    )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className={labelClass + ' flex items-center gap-1'}>
                            Bill Number
                            <InfoTip label="Bill Number">
                                Identifies this bill. Leave it blank if the supplier didn't give you one — the system auto-generates one for you.
                            </InfoTip>
                        </label>
                        <input type="text" value={form.bill_number} onChange={(e) => handleChange('bill_number', e.target.value)}
                            placeholder="Auto-generated if blank" className={inputClass} />
                    </div>
                    <div>
                        <label className={labelClass}>Bill Date</label>
                        <input type="date" value={form.bill_date} onChange={(e) => handleChange('bill_date', e.target.value)} className={inputClass} />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className={labelClass}>Due Date</label>
                        <input type="date" value={form.due_date} onChange={(e) => handleChange('due_date', e.target.value)} className={inputClass} />
                        <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">Leave blank to auto-compute from the supplier's payment terms.</p>
                    </div>
                    <div>
                        <label className={labelClass + ' flex items-center gap-1'}>
                            Total Amount
                            <InfoTip label="Total Amount">
                                The full amount owed on this bill. Required, and must be greater than zero.
                            </InfoTip>
                        </label>
                        <input type="number" step="0.01" min="0" required value={form.total_amount}
                            onChange={(e) => handleChange('total_amount', e.target.value)} className={inputClass} />
                    </div>
                </div>

                <div>
                    <label className={labelClass}>Notes</label>
                    <textarea value={form.notes} onChange={(e) => handleChange('notes', e.target.value)} rows={2} className={inputClass} />
                </div>

                <p className="text-xs text-gray-500 dark:text-slate-400">
                    This records the payable immediately. Once the physical goods arrive, use <span className="font-medium">Attach Items</span> on the bill to receive stock against it.
                </p>

                <div className="flex justify-end gap-3 pt-2">
                    <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-100 rounded-lg hover:bg-gray-300 dark:hover:bg-slate-600">Cancel</button>
                    <button type="submit" disabled={saving} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
                        {saving ? 'Saving...' : 'Create Payable'}
                    </button>
                </div>
            </form>
        </Modal>
    );
};

export default AddPayableModal;
