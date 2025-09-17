/**
 * DueDateEditor Component
 *
 * A modern, professional modal component for editing invoice due dates.
 * Features include date picker, day adjustment controls, reason field, and
 * validation - all styled consistently with the Forson Business Suite.
 *
 * Features:
 * - Date picker with visual feedback
 * - Quick day adjustment buttons (+/- 7, 15, 30 days)
 * - Custom day adjustment input
 * - Optional reason field for change tracking
 * - Professional styling with proper spacing and colors
 * - Loading states and error handling
 * - Responsive design
 *
 * Used in: CustomerInvoiceDetailsModal.jsx for due date editing functionality
 */

import { useState, useEffect } from 'react';
import Modal from './Modal';
import api from '../../api';
import toast from 'react-hot-toast';

const DueDateEditor = ({
    isOpen,
    onClose,
    invoice,
    onSaved
}) => {
    const [newDueDate, setNewDueDate] = useState('');
    const [reason, setReason] = useState('');
    const [customDaysAdjustment, setCustomDaysAdjustment] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    // Initialize form when modal opens
    useEffect(() => {
        if (isOpen && invoice?.due_date) {
            const dueDate = new Date(invoice.due_date);
            // Format date in local timezone to avoid timezone conversion issues
            const year = dueDate.getFullYear();
            const month = String(dueDate.getMonth() + 1).padStart(2, '0');
            const day = String(dueDate.getDate()).padStart(2, '0');
            setNewDueDate(`${year}-${month}-${day}`);
        } else if (isOpen) {
            // If no due date, default to today in local timezone
            const today = new Date();
            const year = today.getFullYear();
            const month = String(today.getMonth() + 1).padStart(2, '0');
            const day = String(today.getDate()).padStart(2, '0');
            setNewDueDate(`${year}-${month}-${day}`);
        }
        setReason('');
        setCustomDaysAdjustment('');
    }, [isOpen, invoice]);

    const adjustDateByDays = (days) => {
        const currentDate = newDueDate ? new Date(newDueDate + 'T00:00:00') : new Date();
        const adjustedDate = new Date(currentDate);
        adjustedDate.setDate(adjustedDate.getDate() + days);
        
        // Format date in local timezone
        const year = adjustedDate.getFullYear();
        const month = String(adjustedDate.getMonth() + 1).padStart(2, '0');
        const day = String(adjustedDate.getDate()).padStart(2, '0');
        setNewDueDate(`${year}-${month}-${day}`);
    };

    const handleCustomDaysApply = () => {
        const days = parseInt(customDaysAdjustment);
        if (!isNaN(days)) {
            adjustDateByDays(days);
            setCustomDaysAdjustment('');
        }
    };

    const handleSave = async () => {
        if (!newDueDate) {
            toast.error('Please select a due date');
            return;
        }
        if (!reason.trim()) {
            toast.error('Reason is required');
            return;
        }

        setIsLoading(true);
        try {
            const response = await api.put(`/invoices/${invoice.invoice_id}/due-date`, {
                new_due_date: newDueDate,
                reason: reason.trim()
            });

            toast.success('Due date updated successfully');
            onSaved(response.data);
            onClose();
        } catch (error) {
            console.error('Failed to update due date:', error);
            toast.error(error.response?.data?.message || 'Failed to update due date');
        } finally {
            setIsLoading(false);
        }
    };

    const handleCancel = () => {
        onClose();
    };

    if (!invoice) return null;

    const originalDueDate = invoice.due_date ? new Date(invoice.due_date) : null;
    const selectedDate = newDueDate ? new Date(newDueDate) : null;
    
    // Calculate days difference
    let daysDifference = null;
    if (originalDueDate && selectedDate) {
        const timeDiff = selectedDate.getTime() - originalDueDate.getTime();
        daysDifference = Math.round(timeDiff / (1000 * 60 * 60 * 24));
    }

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleCancel}
            title={`Edit Due Date - Invoice ${invoice.invoice_number}`}
            maxWidth="max-w-lg"
        >
            <div className="space-y-6">
                {/* Current Due Date Info */}
                <div className="bg-gray-50 p-4 rounded-lg">
                    <h3 className="text-sm font-medium text-gray-700 mb-2">Current Information</h3>
                    <div className="text-sm text-gray-600">
                        <div>Invoice: <span className="font-mono">{invoice.invoice_number}</span></div>
                        <div>Current Due Date: <span className="font-medium">
                            {originalDueDate ? originalDueDate.toLocaleDateString() : 'Not set'}
                        </span></div>
                    </div>
                </div>

                {/* Date Picker */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        New Due Date
                    </label>
                    <input
                        type="date"
                        value={newDueDate}
                        onChange={(e) => setNewDueDate(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    
                    {/* Days difference indicator */}
                    {daysDifference !== null && (
                        <div className="mt-2 text-sm">
                            {daysDifference === 0 ? (
                                <span className="text-gray-600">No change</span>
                            ) : daysDifference > 0 ? (
                                <span className="text-green-600">
                                    +{daysDifference} day{daysDifference !== 1 ? 's' : ''} (extension)
                                </span>
                            ) : (
                                <span className="text-orange-600">
                                    {daysDifference} day{daysDifference !== -1 ? 's' : ''} (reduction)
                                </span>
                            )}
                        </div>
                    )}
                </div>

                {/* Quick Adjustment Buttons */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-3">
                        Quick Adjustments
                    </label>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                        <button
                            type="button"
                            onClick={() => adjustDateByDays(-30)}
                            className="px-3 py-2 text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                        >
                            -30 days
                        </button>
                        <button
                            type="button"
                            onClick={() => adjustDateByDays(-15)}
                            className="px-3 py-2 text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                        >
                            -15 days
                        </button>
                        <button
                            type="button"
                            onClick={() => adjustDateByDays(-7)}
                            className="px-3 py-2 text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                        >
                            -7 days
                        </button>
                        <button
                            type="button"
                            onClick={() => adjustDateByDays(7)}
                            className="px-3 py-2 text-sm bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
                        >
                            +7 days
                        </button>
                        <button
                            type="button"
                            onClick={() => adjustDateByDays(15)}
                            className="px-3 py-2 text-sm bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
                        >
                            +15 days
                        </button>
                        <button
                            type="button"
                            onClick={() => adjustDateByDays(30)}
                            className="px-3 py-2 text-sm bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
                        >
                            +30 days
                        </button>
                    </div>

                    {/* Custom day adjustment */}
                    <div className="flex gap-2">
                        <input
                            type="number"
                            placeholder="Custom days (+ or -)"
                            value={customDaysAdjustment}
                            onChange={(e) => setCustomDaysAdjustment(e.target.value)}
                            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                        <button
                            type="button"
                            onClick={handleCustomDaysApply}
                            disabled={!customDaysAdjustment}
                            className="px-4 py-2 text-sm bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Apply
                        </button>
                    </div>
                </div>

                {/* Reason Field */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        Reason for Change <span className="text-red-600">*</span>
                    </label>
                    <textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Enter reason for due date change..."
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                    />
                    {!reason.trim() && (
                        <p className="mt-1 text-xs text-red-600">Reason is required.</p>
                    )}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-4 border-t border-gray-200">
                    <button
                        type="button"
                        onClick={handleCancel}
                        disabled={isLoading}
                        className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={isLoading || !newDueDate || !reason.trim()}
                        className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                    >
                        {isLoading ? (
                            <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                Saving...
                            </>
                        ) : (
                            'Save Changes'
                        )}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

export default DueDateEditor;