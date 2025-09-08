import { useCallback } from 'react';
import toast from 'react-hot-toast';
import api from '../api';
import PurchaseOrderForm from '../components/forms/PurchaseOrderForm';

// Full-page editor for creating or editing a Purchase Order
// Props:
// - user: current authenticated user
// - existingPO: PO object if editing, else null
// - onDone: callback to return to list page
const PurchaseOrderEditorPage = ({ user, existingPO, onDone }) => {

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
        <div className="max-w-5xl mx-auto pb-32">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-semibold text-gray-800">{existingPO ? 'Edit Purchase Order' : 'New Purchase Order'}</h1>
                    <p className="text-sm text-gray-500 mt-1">Fill in the details below and save when ready.</p>
                </div>
                <button
                    onClick={onDone}
                    className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-800 text-sm font-medium"
                >Back to List</button>
            </div>
            <div className="bg-white border rounded-xl p-4 sm:p-6 shadow-sm">
                <PurchaseOrderForm
                    user={user}
                    existingPO={existingPO}
                    onSave={handleSave}
                    onCancel={onDone}
                />
            </div>
        </div>
    );
};

export default PurchaseOrderEditorPage;
