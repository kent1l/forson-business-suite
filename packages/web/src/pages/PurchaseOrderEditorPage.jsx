import { useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import api from '../api';
import PurchaseOrderForm from '../components/forms/PurchaseOrderForm';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';

// Full-page editor for creating or editing a Purchase Order
// Props:
// - user: current authenticated user
// - existingPO: PO object if editing, else null
// - onDone: callback to return to list page
const PurchaseOrderEditorPage = ({ user, existingPO, onDone }) => {

    const modeLabel = useMemo(() => existingPO ? 'Edit Purchase Order' : 'Create Purchase Order', [existingPO]);

    const handleSave = useCallback((poData) => {
        const isEdit = !!existingPO;
        const promise = isEdit
            ? api.put(`/purchase-orders/${existingPO.po_id}`, poData)
            : api.post('/purchase-orders', poData);

        toast.promise(promise, {
            loading: isEdit ? 'Updating Purchase Order...' : 'Creating Purchase Order...',
            success: () => {
                onDone();
                return `Purchase Order ${isEdit ? 'updated' : 'created'} successfully!`;
            },
            error: (err) => err.response?.data?.message || `Failed to ${isEdit ? 'update' : 'create'} PO.`
        });

        return promise;
    }, [existingPO, onDone]);

    return (
        <div className="relative min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 py-10">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 sm:px-6 lg:px-8">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
                            <Icon path={ICONS.purchase_order} className="h-4 w-4" />
                            {existingPO ? 'Editing mode' : 'Creation mode'}
                        </div>
                        <h1 className="text-3xl font-semibold text-slate-900 tracking-tight">{modeLabel}</h1>
                        <p className="max-w-2xl text-sm text-slate-500">
                            Capture supplier details, curate line items, and keep your purchasing workflow tidy. Drafts auto-save, and you can jump back to the list anytime.
                        </p>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        {existingPO && (
                            <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700 shadow-sm">
                                <p className="font-semibold">Currently editing</p>
                                <p className="text-xs text-amber-600">PO #{existingPO.po_number || existingPO.po_id}</p>
                            </div>
                        )}
                        <button
                            onClick={onDone}
                            className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                        >
                            <Icon path={ICONS.chevronDown} className="mr-2 h-4 w-4 -rotate-90" />
                            Back to list
                        </button>
                    </div>
                </div>

                <div className="rounded-3xl border border-white/60 bg-white/90 p-4 shadow-2xl shadow-slate-900/5 backdrop-blur-sm sm:p-6 lg:p-8">
                    <PurchaseOrderForm
                        user={user}
                        existingPO={existingPO}
                        onSave={handleSave}
                        onCancel={onDone}
                    />
                </div>
            </div>
        </div>
    );
};

export default PurchaseOrderEditorPage;
