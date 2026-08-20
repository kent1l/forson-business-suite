import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Icon from '../ui/Icon';
import InfoTip from '../ui/InfoTip';
import { ICONS } from '../../constants';

const EMPTY_FORM = { component_name: '', component_type: 'DEDUCTION', is_taxable: true, sort_order: 0 };

export default function PayComponentManager() {
    const [components, setComponents] = useState([]);
    const [loading, setLoading] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [editingComponent, setEditingComponent] = useState(null);
    const [formData, setFormData] = useState(EMPTY_FORM);
    const [componentCode, setComponentCode] = useState('');
    const [submitLoading, setSubmitLoading] = useState(false);

    const fetchComponents = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/hr/pay-components/all');
            setComponents(res.data || []);
        } catch (error) {
            console.error('Error fetching pay components:', error);
            toast.error('Failed to load pay components');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchComponents();
    }, [fetchComponents]);

    const handleOpenModal = (component = null) => {
        if (component) {
            setEditingComponent(component);
            setComponentCode(component.component_code);
            setFormData({
                component_name: component.component_name || '',
                component_type: component.component_type,
                is_taxable: component.is_taxable,
                sort_order: component.sort_order || 0
            });
        } else {
            setEditingComponent(null);
            setComponentCode('');
            setFormData({ ...EMPTY_FORM, sort_order: components.length + 1 });
        }
        setModalOpen(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.component_name.trim()) {
            toast.error('Name is required');
            return;
        }
        if (!editingComponent && !/^[A-Za-z0-9_]{2,40}$/.test(componentCode.trim())) {
            toast.error('Code must be 2-40 characters of letters, numbers or underscore');
            return;
        }

        setSubmitLoading(true);
        try {
            const payload = {
                component_name: formData.component_name.trim(),
                component_type: formData.component_type,
                is_taxable: formData.is_taxable,
                sort_order: parseInt(formData.sort_order, 10) || 0
            };
            if (editingComponent) {
                await api.put(`/hr/pay-components/${editingComponent.component_code}`, payload);
                toast.success('Pay component updated successfully');
            } else {
                await api.post('/hr/pay-components', { ...payload, component_code: componentCode.trim() });
                toast.success('Pay component created successfully');
            }
            setModalOpen(false);
            fetchComponents();
        } catch (error) {
            console.error('Save pay component error:', error);
            const msg = error.response?.data?.message || 'Failed to save pay component';
            toast.error(msg);
        } finally {
            setSubmitLoading(false);
        }
    };

    const handleToggleActive = async (component) => {
        try {
            await api.put(`/hr/pay-components/${component.component_code}/toggle-active`);
            toast.success(`"${component.component_name}" ${component.is_active ? 'deactivated' : 'activated'}`);
            fetchComponents();
        } catch (error) {
            console.error('Toggle pay component error:', error);
            toast.error('Failed to update pay component status');
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card">
                <div>
                    <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">Pay Component Management</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        Define custom earning and deduction types employees can be assigned (e.g. HMO, union dues).
                        Engine-generated and statutory components are system-owned and cannot be edited here.
                    </p>
                </div>
                <button
                    onClick={() => handleOpenModal()}
                    className="inline-flex items-center px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors cursor-pointer whitespace-nowrap"
                >
                    <Icon path={ICONS.plus} className="w-4 h-4 mr-1.5" />
                    <span>Add Pay Component</span>
                </button>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-card border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                        <thead>
                            <tr className="bg-slate-100/70 dark:bg-slate-700/40 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 uppercase tracking-wider font-semibold">
                                <th className="py-3 px-4 w-16 text-center">Order</th>
                                <th className="py-3 px-4">Code</th>
                                <th className="py-3 px-4">Name</th>
                                <th className="py-3 px-4 text-center">Type</th>
                                <th className="py-3 px-4 text-center">
                                    <span className="inline-flex items-center justify-center gap-1">
                                        Taxable
                                        <InfoTip label="Taxable">
                                            Whether this component counts toward taxable income when withholding tax is
                                            computed for a payslip.
                                        </InfoTip>
                                    </span>
                                </th>
                                <th className="py-3 px-4 text-center">
                                    <span className="inline-flex items-center justify-center gap-1">
                                        Source
                                        <InfoTip label="Source">
                                            SYSTEM components (basic pay, overtime, statutory contributions) are built into
                                             the payroll engine and locked. CUSTOM components are created here and can be
                                            edited or deactivated.
                                        </InfoTip>
                                    </span>
                                </th>
                                <th className="py-3 px-4 text-center">Status</th>
                                <th className="py-3 px-4 text-center">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                            {loading ? (
                                <tr><td colSpan="8" className="py-12 text-center text-slate-400 dark:text-slate-500">Loading pay components...</td></tr>
                            ) : components.length === 0 ? (
                                <tr><td colSpan="8" className="py-12 text-center text-slate-400 dark:text-slate-500">No pay components found</td></tr>
                            ) : (
                                components.map((pc) => (
                                    <tr key={pc.component_code} className="hover:bg-slate-50 dark:hover:bg-slate-700/40 text-slate-800 dark:text-slate-200 transition-colors">
                                        <td className="py-3 px-4 text-center font-mono font-semibold text-slate-500 dark:text-slate-400">{pc.sort_order}</td>
                                        <td className="py-3 px-4 font-mono font-semibold text-slate-500 dark:text-slate-400">{pc.component_code}</td>
                                        <td className="py-3 px-4 font-bold text-slate-900 dark:text-slate-100">{pc.component_name}</td>
                                        <td className="py-3 px-4 text-center">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                                                pc.component_type === 'DEDUCTION' ? 'bg-danger-100 dark:bg-danger-900/30 text-danger-800 dark:text-danger-400 border border-danger-200 dark:border-danger-800' : 'bg-primary-100 dark:bg-primary-900/30 text-primary-800 dark:text-primary-400 border border-primary-200 dark:border-primary-800'
                                            }`}>
                                                {pc.component_type}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 text-center text-slate-500 dark:text-slate-400">{pc.is_taxable ? 'Yes' : 'No'}</td>
                                        <td className="py-3 px-4 text-center">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                                                pc.is_system ? 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600' : 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                                            }`}>
                                                {pc.is_system ? 'SYSTEM' : 'CUSTOM'}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 text-center">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                                                pc.is_active ? 'bg-success-100 dark:bg-success-900/30 text-success-800 dark:text-success-400 border border-success-200 dark:border-success-800' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600'
                                            }`}>
                                                {pc.is_active ? 'ACTIVE' : 'INACTIVE'}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 text-center">
                                            {pc.is_system ? (
                                                <span className="text-slate-400 dark:text-slate-600 italic">Locked</span>
                                            ) : (
                                                <div className="flex items-center justify-center space-x-2">
                                                    <button
                                                        onClick={() => handleOpenModal(pc)}
                                                        className="px-2.5 py-1 text-[11px] font-medium text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-300 bg-primary-50 dark:bg-primary-950/30 hover:bg-primary-100 dark:hover:bg-primary-900/40 rounded transition-colors cursor-pointer"
                                                    >
                                                        Edit
                                                    </button>
                                                    <button
                                                        onClick={() => handleToggleActive(pc)}
                                                        className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors cursor-pointer ${
                                                            pc.is_active
                                                                ? 'text-warning-800 dark:text-warning-400 hover:text-warning-900 bg-warning-50 dark:bg-warning-950/30 hover:bg-warning-100 dark:hover:bg-warning-900/40'
                                                                : 'text-success-800 dark:text-success-400 hover:text-success-900 bg-success-50 dark:bg-success-950/30 hover:bg-success-100 dark:hover:bg-success-900/40'
                                                        }`}
                                                    >
                                                        {pc.is_active ? 'Deactivate' : 'Reactivate'}
                                                    </button>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {modalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 w-full max-w-md overflow-hidden">
                        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex items-center justify-between">
                            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                                {editingComponent ? 'Edit Pay Component' : 'Create New Pay Component'}
                            </h3>
                            <button
                                onClick={() => setModalOpen(false)}
                                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded cursor-pointer"
                            >
                                <Icon path={ICONS.close} className="w-5 h-5" />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-5 space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                                    Code <span className="text-danger-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={componentCode}
                                    disabled={!!editingComponent}
                                    onChange={(e) => setComponentCode(e.target.value.toUpperCase())}
                                    placeholder="e.g. HMO_EE, UNION_DUES"
                                    className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-slate-100 dark:disabled:bg-slate-800 disabled:text-slate-400 dark:disabled:text-slate-500"
                                />
                                {!editingComponent && (
                                    <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">Letters, numbers and underscore only. Cannot be changed after creation.</p>
                                )}
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                                    Name <span className="text-danger-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={formData.component_name}
                                    onChange={(e) => setFormData(prev => ({ ...prev, component_name: e.target.value }))}
                                    placeholder="e.g. HMO Employee Share"
                                    className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                                        Type
                                    </label>
                                    <select
                                        value={formData.component_type}
                                        onChange={(e) => setFormData(prev => ({ ...prev, component_type: e.target.value }))}
                                        className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                                    >
                                        <option value="DEDUCTION">Deduction</option>
                                        <option value="EARNING">Earning</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                                        Sort Order
                                    </label>
                                    <input
                                        type="number"
                                        value={formData.sort_order}
                                        onChange={(e) => setFormData(prev => ({ ...prev, sort_order: e.target.value }))}
                                        className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono"
                                    />
                                </div>
                            </div>

                            <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={formData.is_taxable}
                                    onChange={(e) => setFormData(prev => ({ ...prev, is_taxable: e.target.checked }))}
                                    className="rounded border-slate-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500"
                                />
                                Taxable (included in withholding tax computation)
                            </label>

                            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100 dark:border-slate-700">
                                <button
                                    type="button"
                                    onClick={() => setModalOpen(false)}
                                    disabled={submitLoading}
                                    className="px-3.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg cursor-pointer transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={submitLoading}
                                    className="px-4 py-1.5 text-xs font-medium text-white bg-primary-600 hover:bg-primary-500 rounded-lg shadow-sm cursor-pointer transition-colors"
                                >
                                    {submitLoading ? 'Saving...' : editingComponent ? 'Update Component' : 'Create Component'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
