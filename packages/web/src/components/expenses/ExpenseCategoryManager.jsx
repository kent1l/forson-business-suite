import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';

export default function ExpenseCategoryManager() {
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [editingCategory, setEditingCategory] = useState(null);

    const [formData, setFormData] = useState({
        category_name: '',
        description: '',
        sort_order: 0
    });
    const [submitLoading, setSubmitLoading] = useState(false);

    const fetchCategories = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/expense-categories/all');
            setCategories(res.data || []);
        } catch (error) {
            console.error('Error fetching categories:', error);
            toast.error('Failed to load expense categories');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchCategories();
    }, [fetchCategories]);

    const handleOpenModal = (category = null) => {
        if (category) {
            setEditingCategory(category);
            setFormData({
                category_name: category.category_name || '',
                description: category.description || '',
                sort_order: category.sort_order || 0
            });
        } else {
            setEditingCategory(null);
            setFormData({
                category_name: '',
                description: '',
                sort_order: categories.length + 1
            });
        }
        setModalOpen(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.category_name.trim()) {
            toast.error('Category name is required');
            return;
        }

        setSubmitLoading(true);
        try {
            if (editingCategory) {
                await api.put(`/expense-categories/${editingCategory.category_id}`, {
                    category_name: formData.category_name.trim(),
                    description: formData.description.trim() || null,
                    sort_order: parseInt(formData.sort_order, 10) || 0
                });
                toast.success('Category updated successfully');
            } else {
                await api.post('/expense-categories', {
                    category_name: formData.category_name.trim(),
                    description: formData.description.trim() || null,
                    sort_order: parseInt(formData.sort_order, 10) || 0
                });
                toast.success('Category created successfully');
            }
            setModalOpen(false);
            fetchCategories();
        } catch (error) {
            console.error('Save category error:', error);
            const msg = error.response?.data?.message || 'Failed to save expense category';
            toast.error(msg);
        } finally {
            setSubmitLoading(false);
        }
    };

    const handleToggleActive = async (category) => {
        try {
            await api.put(`/expense-categories/${category.category_id}/toggle-active`);
            toast.success(`Category "${category.category_name}" ${category.is_active ? 'deactivated' : 'activated'}`);
            fetchCategories();
        } catch (error) {
            console.error('Toggle category error:', error);
            toast.error('Failed to update category status');
        }
    };

    const handleMove = async (index, direction) => {
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= categories.length) return;

        const updated = [...categories];
        const temp = updated[index];
        updated[index] = updated[targetIndex];
        updated[targetIndex] = temp;

        const items = updated.map((cat, idx) => ({
            category_id: cat.category_id,
            sort_order: idx + 1
        }));

        setCategories(updated);
        try {
            await api.put('/expense-categories/reorder', { items });
            toast.success('Sort order updated');
        } catch (error) {
            console.error('Reorder error:', error);
            toast.error('Failed to update sort order');
            fetchCategories();
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div>
                    <h2 className="text-base font-bold text-slate-800">Expense Category Management</h2>
                    <p className="text-xs text-slate-500">Manage, rename, reorder, and activate/deactivate expense categories for consistent financial classification.</p>
                </div>
                <button
                    onClick={() => handleOpenModal()}
                    className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors cursor-pointer whitespace-nowrap"
                >
                    <Icon path={ICONS.plus} className="w-4 h-4 mr-1.5" />
                    <span>Add Expense Category</span>
                </button>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                        <thead>
                            <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-600 uppercase tracking-wider font-semibold">
                                <th className="py-3 px-4 w-16 text-center">Order</th>
                                <th className="py-3 px-4">Category Name</th>
                                <th className="py-3 px-4">Description</th>
                                <th className="py-3 px-4 text-center">Status</th>
                                <th className="py-3 px-4 text-center">Reorder</th>
                                <th className="py-3 px-4 text-center">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {loading ? (
                                <tr>
                                    <td colSpan="6" className="py-12 text-center text-slate-400">Loading categories...</td>
                                </tr>
                            ) : categories.length === 0 ? (
                                <tr>
                                    <td colSpan="6" className="py-12 text-center text-slate-400">No categories found</td>
                                </tr>
                            ) : (
                                categories.map((cat, idx) => (
                                    <tr key={cat.category_id} className="hover:bg-slate-50 transition-colors">
                                        <td className="py-3 px-4 text-center font-mono font-semibold text-slate-500">
                                            {cat.sort_order}
                                        </td>
                                        <td className="py-3 px-4 font-bold text-slate-800">
                                            {cat.category_name}
                                        </td>
                                        <td className="py-3 px-4 text-slate-500">
                                            {cat.description || <span className="text-slate-300 italic">No description</span>}
                                        </td>
                                        <td className="py-3 px-4 text-center">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                                                cat.is_active ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-slate-100 text-slate-500 border border-slate-200'
                                            }`}>
                                                {cat.is_active ? 'ACTIVE' : 'INACTIVE'}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 text-center">
                                            <div className="flex items-center justify-center space-x-1">
                                                <button
                                                    onClick={() => handleMove(idx, 'up')}
                                                    disabled={idx === 0}
                                                    className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer"
                                                >
                                                    <Icon path={ICONS.chevronUp} className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => handleMove(idx, 'down')}
                                                    disabled={idx === categories.length - 1}
                                                    className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer"
                                                >
                                                    <Icon path={ICONS.chevronDown} className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </td>
                                        <td className="py-3 px-4 text-center">
                                            <div className="flex items-center justify-center space-x-2">
                                                <button
                                                    onClick={() => handleOpenModal(cat)}
                                                    className="px-2.5 py-1 text-[11px] font-medium text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 rounded transition-colors cursor-pointer"
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    onClick={() => handleToggleActive(cat)}
                                                    className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors cursor-pointer ${
                                                        cat.is_active
                                                            ? 'text-amber-700 hover:text-amber-900 bg-amber-50 hover:bg-amber-100'
                                                            : 'text-emerald-700 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100'
                                                    }`}
                                                >
                                                    {cat.is_active ? 'Deactivate' : 'Reactivate'}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Create / Edit Modal */}
            {modalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
                    <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md overflow-hidden">
                        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                            <h3 className="text-sm font-bold text-slate-800">
                                {editingCategory ? 'Edit Expense Category' : 'Create New Expense Category'}
                            </h3>
                            <button
                                onClick={() => setModalOpen(false)}
                                className="p-1 text-slate-400 hover:text-slate-600 rounded cursor-pointer"
                            >
                                <Icon path={ICONS.close} className="w-5 h-5" />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-5 space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                                    Category Name <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={formData.category_name}
                                    onChange={(e) => setFormData(prev => ({ ...prev, category_name: e.target.value }))}
                                    placeholder="e.g. Advertising, Equipment, Licenses"
                                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                                    Description
                                </label>
                                <textarea
                                    rows="3"
                                    value={formData.description}
                                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                                    placeholder="Optional description of expenses under this category..."
                                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                                ></textarea>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                                    Display Sort Order
                                </label>
                                <input
                                    type="number"
                                    value={formData.sort_order}
                                    onChange={(e) => setFormData(prev => ({ ...prev, sort_order: e.target.value }))}
                                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>

                            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
                                <button
                                    type="button"
                                    onClick={() => setModalOpen(false)}
                                    disabled={submitLoading}
                                    className="px-3.5 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={submitLoading}
                                    className="px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg shadow-sm cursor-pointer"
                                >
                                    {submitLoading ? 'Saving...' : editingCategory ? 'Update Category' : 'Create Category'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
