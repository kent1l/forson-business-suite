import React, { useState, useEffect } from 'react';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';

export default function ExpenseForm({
    categories = [],
    paymentMethods = [],
    initialData = null,
    aiParsedData = null,
    onSubmit,
    onClose,
    loading = false
}) {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

    const [formData, setFormData] = useState({
        expense_date: today,
        category_id: '',
        amount: '',
        payee: '',
        payment_method_id: '',
        payment_method_text: 'Cash',
        reference_no: '',
        notes: ''
    });

    const [aiMeta, setAiMeta] = useState(null); // stores original AI suggestions for correction tracking
    const [errors, setErrors] = useState({});

    useEffect(() => {
        if (initialData) {
            setFormData({
                expense_date: initialData.expense_date || today,
                category_id: initialData.category?.category_id || initialData.category_id || '',
                amount: initialData.amount || '',
                payee: initialData.payee || '',
                payment_method_id: initialData.payment_method?.method_id || initialData.payment_method_id || '',
                payment_method_text: initialData.payment_method_text || 'Cash',
                reference_no: initialData.reference_no || '',
                notes: initialData.notes || ''
            });
            setAiMeta(null);
        } else if (aiParsedData) {
            setFormData({
                expense_date: aiParsedData.expense_date || today,
                category_id: aiParsedData.category_id || '',
                amount: aiParsedData.amount !== null && aiParsedData.amount !== undefined ? aiParsedData.amount : '',
                payee: aiParsedData.payee || '',
                payment_method_id: aiParsedData.payment_method_id || '',
                payment_method_text: aiParsedData.payment_method_text || 'Cash',
                reference_no: aiParsedData.reference_no || '',
                notes: aiParsedData.notes || ''
            });
            setAiMeta({
                original: { ...aiParsedData },
                confidence: aiParsedData.confidence || {}
            });
        }
    }, [initialData, aiParsedData]);

    const handleChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        if (errors[field]) {
            setErrors(prev => ({ ...prev, [field]: null }));
        }
    };

    const handlePaymentMethodChange = (e) => {
        const selectedId = e.target.value;
        if (!selectedId) {
            setFormData(prev => ({ ...prev, payment_method_id: '', payment_method_text: 'Cash' }));
        } else {
            const pm = paymentMethods.find(p => String(p.method_id) === String(selectedId));
            setFormData(prev => ({
                ...prev,
                payment_method_id: selectedId,
                payment_method_text: pm ? pm.name : 'Cash'
            }));
        }
    };

    const validate = () => {
        const errs = {};
        if (!formData.expense_date) errs.expense_date = 'Expense date is required';
        if (!formData.category_id) errs.category_id = 'Category is required';
        
        const numAmount = parseFloat(formData.amount);
        if (isNaN(numAmount) || numAmount <= 0) {
            errs.amount = 'Amount must be a positive number';
        } else if (numAmount > 99999999.99) {
            errs.amount = 'Amount exceeds maximum limit';
        }

        setErrors(errs);
        return Object.keys(errs).length === 0;
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!validate()) return;

        // Build AI correction list if AI was used and user modified fields
        let corrections = [];
        if (aiMeta && aiMeta.original) {
            const orig = aiMeta.original;
            if (orig.category_id && String(orig.category_id) !== String(formData.category_id)) {
                corrections.push({ field_name: 'category_id', ai_suggestion: orig.category_name || orig.category_id, user_correction: formData.category_id });
            }
            if (orig.amount && parseFloat(orig.amount) !== parseFloat(formData.amount)) {
                corrections.push({ field_name: 'amount', ai_suggestion: orig.amount, user_correction: formData.amount });
            }
            if (orig.payee !== formData.payee) {
                corrections.push({ field_name: 'payee', ai_suggestion: orig.payee, user_correction: formData.payee });
            }
            if (orig.expense_date !== formData.expense_date) {
                corrections.push({ field_name: 'expense_date', ai_suggestion: orig.expense_date, user_correction: formData.expense_date });
            }
        }

        const payload = {
            expense_date: formData.expense_date,
            category_id: parseInt(formData.category_id, 10),
            amount: parseFloat(formData.amount),
            payee: formData.payee.trim() || null,
            payment_method_id: formData.payment_method_id ? parseInt(formData.payment_method_id, 10) : null,
            payment_method_text: formData.payment_method_text || 'Cash',
            reference_no: formData.reference_no.trim() || null,
            notes: formData.notes.trim() || null,
            ai_corrections: corrections
        };

        onSubmit(payload);
    };

    const isAiField = (fieldName) => {
        if (!aiMeta || !aiMeta.original) return false;
        return aiMeta.original[fieldName] !== undefined && aiMeta.original[fieldName] !== null;
    };

    const getConfidenceWarning = (fieldName) => {
        if (!aiMeta || !aiMeta.confidence) return null;
        const score = aiMeta.confidence[fieldName];
        if (typeof score === 'number' && score < 0.70) {
            return (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800 border border-amber-300 ml-2">
                    ⚠️ Low confidence ({Math.round(score * 100)}%)
                </span>
            );
        }
        return null;
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
            <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
                    <div className="flex items-center space-x-2">
                        <span className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                            <Icon path={ICONS.receipt} className="w-5 h-5" />
                        </span>
                        <div>
                            <h3 className="text-lg font-bold text-slate-800">
                                {initialData ? 'Edit Expense Record' : 'Record New Expense'}
                            </h3>
                            <p className="text-xs text-slate-500">
                                {initialData ? `Expense #${initialData.expense_id}` : 'Fill in the structured expense details below'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={loading}
                        className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/60 transition-colors"
                    >
                        <Icon path={ICONS.close} className="w-5 h-5" />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {aiMeta && (
                        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between text-xs text-blue-800">
                            <div className="flex items-center space-x-2">
                                <Icon path={ICONS.star} className="w-4 h-4 text-blue-600" />
                                <span>Fields pre-filled by AI. Please review before saving.</span>
                            </div>
                            <span className="font-semibold text-blue-700">Overall confidence: {Math.round((aiMeta.confidence.overall || 0.8) * 100)}%</span>
                        </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Amount */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                                Amount (₱) <span className="text-red-500">*</span>
                                {isAiField('amount') && <span className="ml-1 text-[10px] text-blue-600 bg-blue-50 px-1 rounded">◆ AI</span>}
                                {getConfidenceWarning('amount')}
                            </label>
                            <div className="relative">
                                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 font-semibold text-sm">₱</span>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    value={formData.amount}
                                    onChange={(e) => handleChange('amount', e.target.value)}
                                    placeholder="0.00"
                                    className={`w-full pl-8 pr-3 py-2 text-sm bg-white border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                                        errors.amount ? 'border-red-500 focus:ring-red-500' : isAiField('amount') ? 'border-blue-300 bg-blue-50/20' : 'border-slate-300'
                                    }`}
                                />
                            </div>
                            {errors.amount && <p className="text-xs text-red-500 mt-1">{errors.amount}</p>}
                        </div>

                        {/* Date */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                                Expense Date <span className="text-red-500">*</span>
                                {isAiField('expense_date') && <span className="ml-1 text-[10px] text-blue-600 bg-blue-50 px-1 rounded">◆ AI</span>}
                                {getConfidenceWarning('date')}
                            </label>
                            <input
                                type="date"
                                value={formData.expense_date}
                                onChange={(e) => handleChange('expense_date', e.target.value)}
                                className={`w-full px-3 py-2 text-sm bg-white border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                                    errors.expense_date ? 'border-red-500 focus:ring-red-500' : isAiField('expense_date') ? 'border-blue-300 bg-blue-50/20' : 'border-slate-300'
                                }`}
                            />
                            {errors.expense_date && <p className="text-xs text-red-500 mt-1">{errors.expense_date}</p>}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Category */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                                Category <span className="text-red-500">*</span>
                                {isAiField('category_id') && <span className="ml-1 text-[10px] text-blue-600 bg-blue-50 px-1 rounded">◆ AI</span>}
                                {getConfidenceWarning('category')}
                            </label>
                            <select
                                value={formData.category_id}
                                onChange={(e) => handleChange('category_id', e.target.value)}
                                className={`w-full px-3 py-2 text-sm bg-white border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                                    errors.category_id ? 'border-red-500 focus:ring-red-500' : isAiField('category_id') ? 'border-blue-300 bg-blue-50/20' : 'border-slate-300'
                                }`}
                            >
                                <option value="">-- Select Expense Category --</option>
                                {categories.map(cat => (
                                    <option key={cat.category_id} value={cat.category_id}>
                                        {cat.category_name}
                                    </option>
                                ))}
                            </select>
                            {errors.category_id && <p className="text-xs text-red-500 mt-1">{errors.category_id}</p>}
                        </div>

                        {/* Payment Method */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                                Payment Method
                                {isAiField('payment_method_id') && <span className="ml-1 text-[10px] text-blue-600 bg-blue-50 px-1 rounded">◆ AI</span>}
                                {getConfidenceWarning('payment_method')}
                            </label>
                            <select
                                value={formData.payment_method_id}
                                onChange={handlePaymentMethodChange}
                                className={`w-full px-3 py-2 text-sm bg-white border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                                    isAiField('payment_method_id') ? 'border-blue-300 bg-blue-50/20' : 'border-slate-300'
                                }`}
                            >
                                <option value="">Custom / Cash Default</option>
                                {paymentMethods.map(pm => (
                                    <option key={pm.method_id} value={pm.method_id}>
                                        {pm.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Payee */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                                Payee / Vendor
                                {isAiField('payee') && <span className="ml-1 text-[10px] text-blue-600 bg-blue-50 px-1 rounded">◆ AI</span>}
                            </label>
                            <input
                                type="text"
                                value={formData.payee}
                                onChange={(e) => handleChange('payee', e.target.value)}
                                placeholder="e.g. Meralco, Landlord, Shell"
                                className={`w-full px-3 py-2 text-sm bg-white border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                                    isAiField('payee') ? 'border-blue-300 bg-blue-50/20' : 'border-slate-300'
                                }`}
                            />
                        </div>

                        {/* Reference No */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                                Reference / OR / Receipt No.
                            </label>
                            <input
                                type="text"
                                value={formData.reference_no}
                                onChange={(e) => handleChange('reference_no', e.target.value)}
                                placeholder="e.g. OR-2026-9941"
                                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                            />
                        </div>
                    </div>

                    {/* Notes */}
                    <div>
                        <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                            Notes / Remarks
                        </label>
                        <textarea
                            rows="3"
                            value={formData.notes}
                            onChange={(e) => handleChange('notes', e.target.value)}
                            placeholder="Additional details about this expense..."
                            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors resize-none"
                        ></textarea>
                    </div>

                    {/* Footer Actions */}
                    <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-100">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={loading}
                            className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg shadow-sm transition-colors cursor-pointer inline-flex items-center"
                        >
                            {loading ? (
                                <>
                                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    <span>Saving...</span>
                                </>
                            ) : (
                                <span>{initialData ? 'Update Expense' : 'Save Expense Record'}</span>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
