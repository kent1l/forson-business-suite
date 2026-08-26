import React, { useState, useEffect, useCallback } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import ExpenseQuickEntry from '../components/expenses/ExpenseQuickEntry';
import ExpenseSummaryCards from '../components/expenses/ExpenseSummaryCards';
import ExpenseList from '../components/expenses/ExpenseList';
import ExpenseForm from '../components/forms/ExpenseForm';

const getToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

const defaultFilters = () => ({
    date_from: getToday(),
    date_to: getToday(),
    category_id: '',
    payment_method_id: '',
    payee: '',
    show_void: false,
    sort_by: 'expense_date',
    sort_dir: 'desc',
    page: 1
});

export default function ExpensesPage({ onNavigate }) {
    const [expenses, setExpenses] = useState([]);
    const [categories, setCategories] = useState([]);
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [categorySummary, setCategorySummary] = useState([]);
    const [monthlySummary, setMonthlySummary] = useState([]);

    const [pagination, setPagination] = useState({ page: 1, limit: 25, totalItems: 0, totalPages: 1 });
    const [filters, setFilters] = useState(defaultFilters);

    const [loading, setLoading] = useState(false);
    const [formModalOpen, setFormModalOpen] = useState(false);
    const [editingExpense, setEditingExpense] = useState(null);
    const [prefillExpense, setPrefillExpense] = useState(null); // "duplicate entry" source
    const [aiParsedData, setAiParsedData] = useState(null);
    const [aiRawInput, setAiRawInput] = useState('');
    const [aiClarifying, setAiClarifying] = useState(null);
    const [formSubmitLoading, setFormSubmitLoading] = useState(false);
    const [quickEntryResetKey, setQuickEntryResetKey] = useState(0);

    // Fetch dropdown options once on mount
    useEffect(() => {
        const fetchMasterData = async () => {
            try {
                const [catRes, pmRes] = await Promise.all([
                    api.get('/expense-categories'),
                    api.get('/payment-methods/enabled')
                ]);
                setCategories(catRes.data || []);
                setPaymentMethods(pmRes.data || []);
            } catch (error) {
                console.error('Error fetching expense master data:', error);
            }
        };
        fetchMasterData();
    }, []);

    // Fetch expense list & summaries
    const fetchExpensesData = useCallback(async () => {
        setLoading(true);
        try {
            const params = {
                page: filters.page || 1,
                limit: 25,
                date_from: filters.date_from || undefined,
                date_to: filters.date_to || undefined,
                category_id: filters.category_id || undefined,
                payment_method_id: filters.payment_method_id || undefined,
                payee: filters.payee || undefined,
                show_void: filters.show_void ? 'true' : 'false',
                sort_by: filters.sort_by || 'expense_date',
                sort_dir: filters.sort_dir || 'desc'
            };

            const [listRes, summaryCatRes, summaryMonthRes] = await Promise.all([
                api.get('/expenses', { params }),
                api.get('/expenses/summary/by-category', { params: { date_from: filters.date_from, date_to: filters.date_to } }),
                api.get('/expenses/summary/monthly')
            ]);

            setExpenses(listRes.data?.data || []);
            setPagination(listRes.data?.pagination || { page: 1, limit: 25, totalItems: 0, totalPages: 1 });
            setCategorySummary(summaryCatRes.data || []);
            setMonthlySummary(summaryMonthRes.data || []);
        } catch (error) {
            console.error('Error fetching expenses data:', error);
            toast.error('Failed to load expenses list');
        } finally {
            setLoading(false);
        }
    }, [filters]);

    useEffect(() => {
        fetchExpensesData();
    }, [fetchExpensesData]);

    const handleFilterChange = (field, value) => {
        setFilters(prev => ({ ...prev, [field]: value, page: 1 }));
    };

    const handleClearFilters = () => {
        setFilters(defaultFilters());
    };

    const handleDateRangeChange = (dateFrom, dateTo) => {
        setFilters(prev => ({ ...prev, date_from: dateFrom, date_to: dateTo, page: 1 }));
    };

    const handlePageChange = (newPage) => {
        setFilters(prev => ({ ...prev, page: newPage }));
    };

    // Clicking the active column flips direction; a new column starts descending.
    const handleSortChange = (field) => {
        setFilters(prev => ({
            ...prev,
            sort_by: field,
            sort_dir: prev.sort_by === field && prev.sort_dir === 'desc' ? 'asc' : 'desc',
            page: 1
        }));
    };

    // rawText is what the user literally typed (often Cebuano or local shorthand).
    // It must survive all the way to POST /expenses — it is the only text the
    // learning loop can use to pick up local vocabulary.
    const handleQuickEntryParsed = (parsed, rawText, clarifying) => {
        setEditingExpense(null);
        setPrefillExpense(null);
        setAiParsedData(parsed);
        setAiRawInput(rawText || '');
        setAiClarifying(clarifying || null);
        setFormModalOpen(true);
    };

    const handleOpenCreateModal = () => {
        setEditingExpense(null);
        setPrefillExpense(null);
        setAiParsedData(null);
        setAiRawInput('');
        setAiClarifying(null);
        setFormModalOpen(true);
    };

    const handleOpenEditModal = (expense) => {
        setEditingExpense(expense);
        setPrefillExpense(null);
        setAiParsedData(null);
        setAiRawInput('');
        setAiClarifying(null);
        setFormModalOpen(true);
    };

    // Re-use a past expense as the starting point for a new one (rent, subscriptions, etc.).
    // Dates default to today since the intent is "same expense, this period".
    const handleDuplicateExpense = (expense) => {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
        setEditingExpense(null);
        setAiParsedData(null);
        setAiRawInput('');
        setAiClarifying(null);
        setPrefillExpense({
            ...expense,
            expense_id: undefined,
            expense_date: today,
            reference_no: '' // reference numbers are unique per document, never copy them
        });
        setFormModalOpen(true);
    };

    // The guardrail decided this cash-out belongs in another module. Nothing is
    // saved here — the entry is handed to the module that owns that kind of
    // transaction, where the user completes and confirms it.
    const closeFormForRouting = () => {
        setFormModalOpen(false);
        setAiParsedData(null);
        setAiRawInput('');
        setAiClarifying(null);
        setQuickEntryResetKey(prev => prev + 1);
    };

    const handleRouteToApPayment = ({ bill }) => {
        closeFormForRouting();
        toast('Continue in Accounts Payable to settle this bill.', { icon: 'ℹ️' });
        onNavigate?.('ap', {
            tab: 'overview',
            recordPaymentFor: { supplier_id: bill.supplier_id, supplier_name: bill.supplier_name }
        });
    };

    const handleRouteToGoodsReceipt = ({ payee, amount, description }) => {
        closeFormForRouting();
        toast('Add the parts received to record this as stock.', { icon: 'ℹ️' });
        onNavigate?.('goods_receipt', { expensePrefill: { payee, amount, description } });
    };

    const handleFormSubmit = async (payload) => {
        setFormSubmitLoading(true);
        try {
            if (editingExpense) {
                await api.put(`/expenses/${editingExpense.expense_id}`, payload);
                toast.success('Expense record updated successfully!');
            } else {
                await api.post('/expenses', payload);
                toast.success('Expense recorded successfully!');
            }
            setFormModalOpen(false);
            setQuickEntryResetKey(prev => prev + 1);
            fetchExpensesData();
        } catch (error) {
            console.error('Form submission error:', error);
            const msg = error.response?.data?.message || 'Failed to save expense record';
            toast.error(msg);
        } finally {
            setFormSubmitLoading(false);
        }
    };

    const handleVoidExpense = async (expenseId, voidReason) => {
        await api.put(`/expenses/${expenseId}/void`, { void_reason: voidReason });
        toast.success('Expense record voided successfully');
        fetchExpensesData();
    };

    return (
        <div className="space-y-6">
            {/* Header Toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                <div>
                    <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight flex items-center gap-2">
                        <Icon path={ICONS.receipt} className="w-6 h-6 text-primary-600 dark:text-primary-400" />
                        <span>Expense Ledger & Recording</span>
                    </h1>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Track, classify, and audit operating expenses across store operations.
                    </p>
                </div>
                <button
                    onClick={handleOpenCreateModal}
                    className="inline-flex items-center px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors cursor-pointer whitespace-nowrap"
                >
                    <Icon path={ICONS.plus} className="w-4 h-4 mr-1.5" />
                    <span>Record New Expense</span>
                </button>
            </div>

            {/* Natural Language Quick Entry Widget */}
            <ExpenseQuickEntry key={quickEntryResetKey} onParsed={handleQuickEntryParsed} />

            {/* Summary Cards & Monthly Chart */}
            <ExpenseSummaryCards
                categorySummary={categorySummary}
                monthlySummary={monthlySummary}
            />

            {/* Filterable Expense List */}
            <ExpenseList
                expenses={expenses}
                categories={categories}
                paymentMethods={paymentMethods}
                pagination={pagination}
                filters={filters}
                onFilterChange={handleFilterChange}
                onDateRangeChange={handleDateRangeChange}
                onClearFilters={handleClearFilters}
                onPageChange={handlePageChange}
                onSortChange={handleSortChange}
                onEdit={handleOpenEditModal}
                onDuplicate={handleDuplicateExpense}
                onVoid={handleVoidExpense}
                loading={loading}
            />

            {/* Create/Edit Form Modal */}
            {formModalOpen && (
                <ExpenseForm
                    categories={categories}
                    paymentMethods={paymentMethods}
                    initialData={editingExpense || prefillExpense}
                    isDuplicating={!editingExpense && !!prefillExpense}
                    aiParsedData={aiParsedData}
                    aiRawInput={aiRawInput}
                    aiClarifying={aiClarifying}
                    onRouteToApPayment={handleRouteToApPayment}
                    onRouteToGoodsReceipt={handleRouteToGoodsReceipt}
                    onSubmit={handleFormSubmit}
                    onClose={() => setFormModalOpen(false)}
                    loading={formSubmitLoading}
                />
            )}
        </div>
    );
}
