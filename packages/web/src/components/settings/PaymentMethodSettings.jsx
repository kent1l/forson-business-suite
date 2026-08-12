import { useState, useEffect } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Modal from '../ui/Modal';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';

const PaymentMethodForm = ({ method, onSave, onCancel }) => {
    const [formData, setFormData] = useState({
        code: '',
        name: '',
        type: 'other',
        enabled: true,
        sort_order: 0,
        config: {
            requires_reference: false,
            reference_label: '',
            requires_receipt_no: false,
            change_allowed: false,
            settlement_type: 'instant',
            max_split_count: null
        }
    });

    useEffect(() => {
        if (method) {
            const newFormData = {
                ...method,
                config: {
                    requires_reference: false,
                    reference_label: '',
                    requires_receipt_no: false,
                    change_allowed: false,
                    settlement_type: 'instant',
                    max_split_count: null,
                    ...method.config
                }
            };
            setFormData(newFormData);
        }
    }, [method]);

    const handleChange = (field, value) => {
        setFormData(prev => ({
            ...prev,
            [field]: value
        }));
    };

    const handleConfigChange = (field, value) => {
        setFormData(prev => ({
            ...prev,
            config: {
                ...prev.config,
                [field]: value
            }
        }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        
        // Auto-set defaults based on type
        const finalConfig = { ...formData.config };
        if (formData.type === 'cash') {
            finalConfig.change_allowed = true;
            finalConfig.settlement_type = 'instant';
        } else if (formData.type === 'card') {
            finalConfig.requires_reference = true;
            finalConfig.reference_label = finalConfig.reference_label || 'Auth Code';
            finalConfig.requires_receipt_no = true;
            finalConfig.change_allowed = false;
            finalConfig.settlement_type = 'instant';
        } else if (formData.type === 'bank') {
            finalConfig.requires_reference = true;
            finalConfig.reference_label = finalConfig.reference_label || 'Reference Number';
            finalConfig.settlement_type = 'delayed';
            finalConfig.change_allowed = false;
        } else if (formData.type === 'mobile') {
            finalConfig.requires_reference = true;
            finalConfig.reference_label = finalConfig.reference_label || 'Transaction ID';
            finalConfig.settlement_type = 'instant';
            finalConfig.change_allowed = false;
        } else if (formData.type === 'credit') {
            finalConfig.settlement_type = 'on_account';
            finalConfig.change_allowed = false;
            finalConfig.requires_reference = false;
        }

        const finalData = {
            ...formData,
            config: finalConfig
        };

        onSave(finalData);
    };

    const typeOptions = [
        { value: 'cash', label: 'Cash' },
        { value: 'card', label: 'Card (Credit/Debit)' },
        { value: 'bank', label: 'Bank Transfer' },
        { value: 'mobile', label: 'Mobile Payment' },
        { value: 'credit', label: 'Credit Terms' },
        { value: 'voucher', label: 'Voucher/Gift Card' },
        { value: 'other', label: 'Other' }
    ];

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Code</label>
                    <input
                        type="text"
                        value={formData.code}
                        onChange={(e) => handleChange('code', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg"
                        placeholder="unique_code"
                        required
                    />
                    <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">Unique identifier (no spaces, lowercase)</p>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Display Name</label>
                    <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => handleChange('name', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg"
                        placeholder="Credit Card"
                        required
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Type</label>
                    <select
                        value={formData.type}
                        onChange={(e) => handleChange('type', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg"
                    >
                        {typeOptions.map(option => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Sort Order</label>
                    <input
                        type="number"
                        value={formData.sort_order}
                        onChange={(e) => handleChange('sort_order', parseInt(e.target.value) || 0)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg"
                        min="0"
                    />
                </div>
            </div>

            <div className="border-t border-gray-200 dark:border-slate-700 pt-4">
                <h4 className="text-sm font-medium text-gray-700 dark:text-slate-300 mb-3">Payment Rules</h4>

                <div className="space-y-3">
                    <div className="flex items-center">
                        <input
                            type="checkbox"
                            id="enabled"
                            checked={formData.enabled}
                            onChange={(e) => handleChange('enabled', e.target.checked)}
                            className="mr-2"
                        />
                        <label htmlFor="enabled" className="text-sm text-gray-700 dark:text-slate-300">Enabled</label>
                    </div>

                    <div className="flex items-center">
                        <input
                            type="checkbox"
                            id="requires_reference"
                            checked={formData.config.requires_reference}
                            onChange={(e) => handleConfigChange('requires_reference', e.target.checked)}
                            className="mr-2"
                        />
                        <label htmlFor="requires_reference" className="text-sm text-gray-700 dark:text-slate-300">Requires Reference/Auth Code</label>
                    </div>

                    {formData.config.requires_reference && (
                        <div className="ml-6">
                            <input
                                type="text"
                                value={formData.config.reference_label}
                                onChange={(e) => handleConfigChange('reference_label', e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg"
                                placeholder="Auth Code"
                            />
                            <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">Label for reference field</p>
                        </div>
                    )}

                    <div className="flex items-center">
                        <input
                            type="checkbox"
                            id="requires_receipt_no"
                            checked={formData.config.requires_receipt_no}
                            onChange={(e) => handleConfigChange('requires_receipt_no', e.target.checked)}
                            className="mr-2"
                        />
                        <label htmlFor="requires_receipt_no" className="text-sm text-gray-700 dark:text-slate-300">Requires Physical Receipt Number</label>
                    </div>

                    <div className="flex items-center">
                        <input
                            type="checkbox"
                            id="change_allowed"
                            checked={formData.config.change_allowed}
                            onChange={(e) => handleConfigChange('change_allowed', e.target.checked)}
                            className="mr-2"
                        />
                        <label htmlFor="change_allowed" className="text-sm text-gray-700 dark:text-slate-300">Change Allowed</label>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Settlement Type</label>
                        <select
                            value={formData.config.settlement_type}
                            onChange={(e) => handleConfigChange('settlement_type', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg"
                        >
                            <option value="instant">Instant - Funds received immediately (cash, cards)</option>
                            <option value="delayed">Delayed - Funds settle later (bank transfer, cheque)</option>
                            <option value="on_account">On Account - No payment now, invoice remains due</option>
                        </select>
                        <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">
                            Instant: counted immediately toward invoice payment. Delayed: marked pending until settled. On Account: no payment recorded.
                        </p>
                    </div>
                </div>
            </div>

            <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-slate-700">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-4 py-2 bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-200 rounded-lg hover:bg-gray-300 dark:hover:bg-slate-600"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    className="px-6 py-2 bg-primary-600 text-white rounded-lg font-semibold hover:bg-primary-700"
                >
                    {method ? 'Update' : 'Create'} Method
                </button>
            </div>
        </form>
    );
};

const PaymentMethodSettings = () => {
    const [methods, setMethods] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingMethod, setEditingMethod] = useState(null);
    const [draggedMethod, setDraggedMethod] = useState(null);

    const fetchMethods = async () => {
        try {
            const response = await api.get('/payment-methods');
            setMethods(response.data);
        } catch {
            toast.error('Failed to fetch payment methods.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchMethods();
    }, []);

    const handleSaveMethod = async (methodData) => {
        try {
            if (editingMethod) {
                const response = await api.put(`/payment-methods/${editingMethod.method_id}`, methodData);
                setMethods(prev => prev.map(m => 
                    m.method_id === editingMethod.method_id ? response.data : m
                ));
                toast.success('Payment method updated successfully.');
            } else {
                const response = await api.post('/payment-methods', methodData);
                setMethods(prev => [...prev, response.data]);
                toast.success('Payment method created successfully.');
            }
            setIsModalOpen(false);
            setEditingMethod(null);
        } catch (err) {
            console.error('[PaymentMethodSettings] Error saving method:', err);
            console.error('[PaymentMethodSettings] Error response:', err.response);
            const message = err.response?.data?.message || 'Failed to save payment method.';
            toast.error(message);
        }
    };

    const handleDeleteMethod = async (method) => {
        if (!confirm(`Are you sure you want to delete "${method.name}"?`)) return;

        try {
            const response = await api.delete(`/payment-methods/${method.method_id}`);
            
            if (response.data.disabled) {
                // Method was disabled instead of deleted
                setMethods(prev => prev.map(m => 
                    m.method_id === method.method_id ? { ...m, enabled: false } : m
                ));
                toast.success('Payment method disabled (was in use).');
            } else {
                // Method was deleted
                setMethods(prev => prev.filter(m => m.method_id !== method.method_id));
                toast.success('Payment method deleted successfully.');
            }
        } catch (err) {
            const message = err.response?.data?.message || 'Failed to delete payment method.';
            toast.error(message);
        }
    };

    const handleToggleEnabled = async (method) => {
        try {
            const updatedMethod = { ...method, enabled: !method.enabled };
            const response = await api.put(`/payment-methods/${method.method_id}`, updatedMethod);
            setMethods(prev => prev.map(m => 
                m.method_id === method.method_id ? response.data : m
            ));
            toast.success(`Payment method ${updatedMethod.enabled ? 'enabled' : 'disabled'}.`);
        } catch (err) {
            const message = err.response?.data?.message || 'Failed to update payment method.';
            toast.error(message);
        }
    };

    const handleReorder = async () => {
        try {
            const reorderedMethods = methods.map((method, index) => ({
                method_id: method.method_id,
                sort_order: index + 1
            }));

            await api.patch('/payment-methods/reorder', { methods: reorderedMethods });
            toast.success('Payment methods reordered successfully.');
        } catch {
            toast.error('Failed to reorder payment methods.');
        }
    };

    const handleDragStart = (e, method) => {
        setDraggedMethod(method);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e, targetMethod) => {
        e.preventDefault();
        
        if (!draggedMethod || draggedMethod.method_id === targetMethod.method_id) return;

        const draggedIndex = methods.findIndex(m => m.method_id === draggedMethod.method_id);
        const targetIndex = methods.findIndex(m => m.method_id === targetMethod.method_id);

        const newMethods = [...methods];
        newMethods.splice(draggedIndex, 1);
        newMethods.splice(targetIndex, 0, draggedMethod);

        setMethods(newMethods);
        setDraggedMethod(null);
        
        // Save the new order
        handleReorder();
    };

    const getTypeIcon = (type) => {
        switch (type) {
            case 'cash': return '💰';
            case 'card': return '💳';
            case 'bank': return '🏦';
            case 'mobile': return '📱';
            case 'credit': return '📋';
            case 'voucher': return '🎟️';
            default: return '💼';
        }
    };

    const getTypeColor = (type) => {
        switch (type) {
            case 'cash': return 'bg-success-100 dark:bg-success-900/30 text-success-700 dark:text-success-500';
            case 'card': return 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-500';
            case 'bank': return 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-400';
            case 'mobile': return 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-400';
            case 'credit': return 'bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-500';
            case 'voucher': return 'bg-pink-100 dark:bg-pink-900/30 text-pink-800 dark:text-pink-400';
            default: return 'bg-gray-100 dark:bg-slate-700 text-gray-800 dark:text-slate-200';
        }
    };

    if (loading) {
        return <div className="text-center py-4 text-gray-500 dark:text-slate-400">Loading payment methods...</div>;
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h3 className="text-lg font-medium text-gray-900 dark:text-slate-100">Payment Methods</h3>
                    <p className="text-sm text-gray-500 dark:text-slate-500">
                        Configure available payment methods and their validation rules
                    </p>
                </div>
                <button
                    onClick={() => {
                        setEditingMethod(null);
                        setIsModalOpen(true);
                    }}
                    className="bg-primary-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-primary-700"
                >
                    Add Method
                </button>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700">
                {methods.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 dark:text-slate-500">
                        No payment methods configured.
                    </div>
                ) : (
                    <div className="divide-y divide-gray-200 dark:divide-slate-700">
                        {methods.map((method) => (
                            <div
                                key={method.method_id}
                                draggable
                                onDragStart={(e) => handleDragStart(e, method)}
                                onDragOver={handleDragOver}
                                onDrop={(e) => handleDrop(e, method)}
                                className={`p-4 hover:bg-gray-50 dark:hover:bg-slate-700/50 cursor-move ${!method.enabled ? 'opacity-60' : ''}`}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center space-x-3">
                                        <div className="text-xl">{getTypeIcon(method.type)}</div>
                                        <div>
                                            <div className="flex items-center space-x-2">
                                                <h4 className="font-medium text-gray-900 dark:text-slate-100">{method.name}</h4>
                                                <span className={`px-2 py-1 text-xs rounded-full ${getTypeColor(method.type)}`}>
                                                    {method.type}
                                                </span>
                                                {!method.enabled && (
                                                    <span className="px-2 py-1 text-xs rounded-full bg-danger-100 dark:bg-danger-900/30 text-danger-700 dark:text-danger-500">
                                                        Disabled
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-sm text-gray-500 dark:text-slate-500">
                                                Code: {method.code}
                                                {method.config.requires_reference && ' • Requires Reference'}
                                                {method.config.requires_receipt_no && ' • Requires Receipt #'}
                                                {method.config.change_allowed && ' • Change Allowed'}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-center space-x-2">
                                        <button
                                            onClick={() => handleToggleEnabled(method)}
                                            className={`px-3 py-1 text-xs rounded-full ${
                                                method.enabled
                                                    ? 'bg-success-100 dark:bg-success-900/30 text-success-700 dark:text-success-500 hover:bg-success-100 dark:hover:bg-success-900/50'
                                                    : 'bg-gray-100 dark:bg-slate-700 text-gray-800 dark:text-slate-200 hover:bg-gray-200 dark:hover:bg-slate-600'
                                            }`}
                                        >
                                            {method.enabled ? 'Enabled' : 'Disabled'}
                                        </button>
                                        <button
                                            onClick={() => {
                                                setEditingMethod(method);
                                                setIsModalOpen(true);
                                            }}
                                            className="p-2 text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300"
                                        >
                                            <Icon path={ICONS.edit} className="h-4 w-4" />
                                        </button>
                                        <button
                                            onClick={() => handleDeleteMethod(method)}
                                            className="p-2 text-danger-500 hover:text-danger-600"
                                        >
                                            <Icon path={ICONS.trash} className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="text-sm text-gray-500 dark:text-slate-500">
                <p><strong>Tip:</strong> Drag and drop to reorder payment methods. The order affects display in POS and invoicing.</p>
                <p><strong>Settlement Types:</strong> Instant methods affect cash metrics immediately, delayed methods are for bank transfers and cheques.</p>
            </div>

            <Modal
                isOpen={isModalOpen}
                onClose={() => {
                    setIsModalOpen(false);
                    setEditingMethod(null);
                }}
                title={editingMethod ? 'Edit Payment Method' : 'Add Payment Method'}
                size="lg"
            >
                <PaymentMethodForm
                    method={editingMethod}
                    onSave={handleSaveMethod}
                    onCancel={() => {
                        setIsModalOpen(false);
                        setEditingMethod(null);
                    }}
                />
            </Modal>
        </div>
    );
};

export default PaymentMethodSettings;
