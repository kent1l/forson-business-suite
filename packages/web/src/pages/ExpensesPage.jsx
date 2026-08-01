import React, { useState, useEffect, useCallback } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import ExpenseQuickEntry from '../components/expenses/ExpenseQuickEntry';
import ExpenseSummaryCards from '../components/expenses/ExpenseSummaryCards';
import ExpenseList from '../components/expenses/ExpenseList';
import ExpenseForm from '../components/forms/ExpenseForm';

export default function ExpensesPage() {
    const [expenses, setExpenses] = useState([]);
    const [categories, setCategories] = useState([]);
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [categorySummary, setCategorySummary] = useState([]);
    const [monthlySummary, setMonthlySummary] = useState([]);

    const [pagination, setPagination] = useState({ page: 1, limit: 25, totalItems: 0, totalPages: 1 });
    const [filters, setFilters] = useState({
        date_from: '',
        date_to: '',
        category_id: '',
        payment_method_id: '',
        payee: '',
        show_void: false,
        page: 1
    });

    const [loading, setLoading] = useState(false);
    const [formModalOpen, setFormModalOpen] = useState(false);
    const [editingExpense, setEditingExpense] = useState(null);
    const [aiParsedData, setAiParsedData] = useState(null);
    const [formSubmitLoading, setFormSubmitLoading] = useState(false);

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
                show_void: filters.show_void ? 'true' : 'false'
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
        setFilters({
            date_from: '',
            date_to: '',
            category_id: '',
            payment_method_id: '',
            payee: '',
            show_void: false,
            page: 1
        });
    };

    const handlePageChange = (newPage) => {
        setFilters(prev => ({ ...prev, page: newPage }));
    };

    const handleQuickEntryParsed = (parsed, rawText) => {
        setEditingExpense(null);
        setAiParsedData(parsed);
        setFormModalOpen(true);
    };

    const handleOpenCreateModal = () => {
        setEditingExpense(null);
        setAiParsedData(null);
        setFormModalOpen(true);
    };

    const handleOpenEditModal = (expense) => {
        setEditingExpense(expense);
        setAiParsedData(null);
        setFormModalOpen(true);
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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <div>
                    <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                        <Icon path={ICONS.receipt} className="w-6 h-6 text-blue-600" />
                        <span>Expense Ledger & Recording</span>
                    </h1>
                    <p className="text-xs text-slate-500 mt-1">
                        Track, classify, and audit operating expenses across store operations.
                    </p>
                </div>
                <button
                    onClick={handleOpenCreateModal}
                    className="inline-flex items-center px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors cursor-pointer whitespace-nowrap"
                >
                    <Icon path={ICONS.plus} className="w-4 h-4 mr-1.5" />
                    <span>Record New Expense</span>
                </button>
            </div>

            {/* Natural Language Quick Entry Widget */}
            <ExpenseQuickEntry onParsed={handleQuickEntryParsed} />

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
                onClearFilters={handleClearFilters}
                onPageChange={handlePageChange}
                onEdit={handleOpenEditModal}
                onVoid={handleVoidExpense}
                loading={loading}
            />

            {/* Create/Edit Form Modal */}
            {formModalOpen && (
                <ExpenseForm
                    categories={categories}
                    paymentMethods={paymentMethods}
                    initialData={editingExpense}
                    aiParsedData={aiParsedData}
                    onSubmit={handleFormSubmit}
                    onClose={() => setFormModalOpen(false)}
                    loading={formSubmitLoading}
                />
            )}
        </div>
    );
}
