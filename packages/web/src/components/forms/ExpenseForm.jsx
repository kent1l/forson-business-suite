import React, { useState, useEffect, useRef } from 'react';
import api from '../../api';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';

export default function ExpenseForm({
    categories = [],
    paymentMethods = [],
    initialData = null,
    isDuplicating = false,
    aiParsedData = null,
    aiRawInput = '',
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

    // Payee autocomplete — keeps vendor spelling consistent so reporting totals don't fragment.
    const [payeeSuggestions, setPayeeSuggestions] = useState([]);
    const [showPayeeSuggestions, setShowPayeeSuggestions] = useState(false);
    const payeeWrapRef = useRef(null);

    // Non-blocking duplicate warning (same date + amount + payee already recorded).
    const [duplicateMatches, setDuplicateMatches] = useState([]);
    const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);
    const [checkingDuplicate, setCheckingDuplicate] = useState(false);

    const cleanDateStr = (val) => {
        if (!val) return today;
        return typeof val === 'string' ? val.split('T')[0] : today;
    };

    // Displays "15,000.50" while the underlying form value stays a plain numeric string.
    const formatAmountDisplay = (raw) => {
        if (raw === '' || raw === null || raw === undefined) return '';
        const str = String(raw);
        const [intPart, decPart] = str.split('.');
        const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        if (decPart === undefined) return withCommas;
        return `${withCommas}.${decPart}`;
    };

    const handleAmountChange = (input) => {
        // Strip everything except digits and a single decimal point, cap at 2 decimals.
        let cleaned = String(input).replace(/[^0-9.]/g, '');
        const firstDot = cleaned.indexOf('.');
        if (firstDot !== -1) {
            cleaned = `${cleaned.slice(0, firstDot + 1)}${cleaned.slice(firstDot + 1).replace(/\./g, '')}`;
            const [i, d] = cleaned.split('.');
            cleaned = `${i}.${d.slice(0, 2)}`;
        }
        handleChange('amount', cleaned);
    };

    useEffect(() => {
        if (initialData) {
            setFormData({
                expense_date: cleanDateStr(initialData.expense_date),
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
                expense_date: cleanDateStr(aiParsedData.expense_date),
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
        // Any change to the identity of the expense re-opens the duplicate question.
        if (field === 'expense_date' || field === 'amount' || field === 'payee') {
            setDuplicateMatches([]);
            setDuplicateAcknowledged(false);
        }
    };

    // Debounced payee lookup against previously recorded payees.
    useEffect(() => {
        if (!showPayeeSuggestions) return undefined;

        let cancelled = false;
        const timer = setTimeout(async () => {
            try {
                const res = await api.get('/expenses/payees', {
                    params: { q: formData.payee || undefined }
                });
                if (!cancelled) setPayeeSuggestions(Array.isArray(res.data) ? res.data : []);
            } catch {
                if (!cancelled) setPayeeSuggestions([]);
            }
        }, 250);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [formData.payee, showPayeeSuggestions]);

    // Close the suggestion dropdown when clicking outside of it.
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (payeeWrapRef.current && !payeeWrapRef.current.contains(event.target)) {
                setShowPayeeSuggestions(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

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

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!validate()) return;

        // Warn (never block) if an identical expense is already on file for this date.
        // Existing matches mean the user has already been shown the warning for this exact
        // date/amount/payee combination, so a second submit is their confirmation to proceed.
        if (duplicateMatches.length === 0 && !duplicateAcknowledged) {
            setCheckingDuplicate(true);
            try {
                const res = await api.get('/expenses/check-duplicate', {
                    params: {
                        expense_date: formData.expense_date,
                        amount: parseFloat(formData.amount),
                        payee: formData.payee?.trim() || undefined,
                        exclude_id: initialData?.expense_id || undefined
                    }
                });
                if (res.data?.isDuplicate) {
                    setDuplicateMatches(res.data.matches || []);
                    setCheckingDuplicate(false);
                    return; // Surface the warning; user confirms with "Save anyway".
                }
            } catch {
                // Duplicate checking is advisory only — never let it block a legitimate save.
            } finally {
                setCheckingDuplicate(false);
            }
        }

        // Build AI correction list if AI was used and user modified fields
        let corrections = [];
        if (aiMeta && aiMeta.original) {
            const orig = aiMeta.original;
            if (orig.category_id && String(orig.category_id) !== String(formData.category_id)) {
                // Record the corrected category by NAME. Sending the raw ID here used to
                // produce examples like 'from "Transportation & Delivery" to "3"', which
                // taught the model to emit bare integers.
                const chosen = categories.find(c => String(c.category_id) === String(formData.category_id));
                corrections.push({
                    field_name: 'category',
                    ai_suggestion: orig.category_name || String(orig.category_id),
                    user_correction: chosen ? chosen.category_name : String(formData.category_id)
                });
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
            ai_corrections: corrections,
            // Carries the user's original wording (and the AI's proposal) to the
            // server so the lexicon can learn local terms from real entries.
            raw_input: aiRawInput || null,
            ai_parsed: aiMeta?.original || null
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
                                {isDuplicating
                                    ? 'Duplicate Expense'
                                    : initialData ? 'Edit Expense Record' : 'Record New Expense'}
                            </h3>
                            <p className="text-xs text-slate-500">
                                {isDuplicating
                                    ? 'Copied from a previous entry — review the date and amount before saving'
                                    : initialData ? `Expense #${initialData.expense_id}` : 'Fill in the structured expense details below'}
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
                                    type="text"
                                    inputMode="decimal"
                                    value={formatAmountDisplay(formData.amount)}
                                    onChange={(e) => handleAmountChange(e.target.value)}
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
                        <div className="relative" ref={payeeWrapRef}>
                            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                                Payee / Vendor
                                {isAiField('payee') && <span className="ml-1 text-[10px] text-blue-600 bg-blue-50 px-1 rounded">◆ AI</span>}
                            </label>
                            <input
                                type="text"
                                value={formData.payee}
                                onChange={(e) => handleChange('payee', e.target.value)}
                                onFocus={() => setShowPayeeSuggestions(true)}
                                autoComplete="off"
                                placeholder="e.g. Meralco, Landlord, Shell"
                                className={`w-full px-3 py-2 text-sm bg-white border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                                    isAiField('payee') ? 'border-blue-300 bg-blue-50/20' : 'border-slate-300'
                                }`}
                            />
                            {showPayeeSuggestions && payeeSuggestions.length > 0 && (
                                <ul className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg py-1">
                                    {payeeSuggestions.map((name) => (
                                        <li key={name}>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    handleChange('payee', name);
                                                    setShowPayeeSuggestions(false);
                                                }}
                                                className="w-full text-left px-3 py-1.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 cursor-pointer transition-colors"
                                            >
                                                {name}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <p className="text-[10px] text-slate-400 mt-1">
                                Pick an existing name when possible so reports group correctly.
                            </p>
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

                    {/* Possible duplicate warning — advisory, never blocking */}
                    {duplicateMatches.length > 0 && !duplicateAcknowledged && (
                        <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg space-y-2">
                            <div className="flex items-start space-x-2">
                                <Icon path={ICONS.warning} className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                                <div className="text-xs text-amber-900">
                                    <p className="font-semibold">This looks like it may already be recorded.</p>
                                    <p className="text-amber-800 mt-0.5">
                                        Found {duplicateMatches.length} existing expense{duplicateMatches.length > 1 ? 's' : ''} with the same date, amount, and payee:
                                    </p>
                                </div>
                            </div>
                            <ul className="space-y-1 pl-6">
                                {duplicateMatches.map((m) => (
                                    <li key={m.expense_id} className="text-xs text-amber-900 bg-amber-100/60 rounded px-2 py-1">
                                        <span className="font-semibold">#{m.expense_id}</span>
                                        {' · '}{m.category?.category_name || 'Uncategorized'}
                                        {' · ₱'}{parseFloat(m.amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        {m.reference_no ? ` · Ref ${m.reference_no}` : ''}
                                    </li>
                                ))}
                            </ul>
                            <p className="text-[11px] text-amber-700 pl-6">
                                If this is a separate, genuine expense, choose “Save anyway”.
                            </p>
                        </div>
                    )}

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
                            disabled={loading || checkingDuplicate}
                            onClick={() => {
                                // Second press after a duplicate warning means "yes, save it".
                                if (duplicateMatches.length > 0) setDuplicateAcknowledged(true);
                            }}
                            className={`px-5 py-2 text-sm font-medium text-white rounded-lg shadow-sm transition-colors cursor-pointer inline-flex items-center disabled:opacity-60 ${
                                duplicateMatches.length > 0 && !duplicateAcknowledged
                                    ? 'bg-amber-600 hover:bg-amber-500'
                                    : 'bg-blue-600 hover:bg-blue-500'
                            }`}
                        >
                            {loading || checkingDuplicate ? (
                                <>
                                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    <span>{checkingDuplicate ? 'Checking...' : 'Saving...'}</span>
                                </>
                            ) : duplicateMatches.length > 0 && !duplicateAcknowledged ? (
                                <span>Save anyway</span>
                            ) : (
                                <span>{initialData && !isDuplicating ? 'Update Expense' : 'Save Expense Record'}</span>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
