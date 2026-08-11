import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import api from '../api';
import toast from 'react-hot-toast';

// Owns all state/data-fetching for the AR "Customer Ledger & SOA" tab: the
// customer search combobox, ledger fetch, and SOA PDF export.
// `customers`/`setCustomers` is lifted to the page since the Overview tab also
// populates it, and this tab lazily loads it if Overview hasn't run yet.
export default function useARLedgerSoa({ dateRange, customers, setCustomers, activeTab }) {
    const [soaCustomerId, setSoaCustomerId] = useState('');
    const [soaLedger, setSoaLedger] = useState(null);
    const [soaLoading, setSoaLoading] = useState(false);
    const [soaDownloading, setSoaDownloading] = useState(false);
    const [attachReceiptImages, setAttachReceiptImages] = useState(true);
    const [soaSearchQuery, setSoaSearchQuery] = useState('');
    const [soaDropdownOpen, setSoaDropdownOpen] = useState(false);
    const [soaHighlightedIndex, setSoaHighlightedIndex] = useState(-1);
    const soaComboboxRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (soaComboboxRef.current && !soaComboboxRef.current.contains(event.target)) {
                setSoaDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const filteredSoaCustomers = useMemo(() => {
        if (!soaSearchQuery.trim()) return customers;
        const q = soaSearchQuery.toLowerCase();
        return customers.filter(c => {
            const name = (c.company_name || `${c.first_name || ''} ${c.last_name || ''}`).toLowerCase();
            const phone = (c.phone || '').toLowerCase();
            return name.includes(q) || phone.includes(q);
        });
    }, [customers, soaSearchQuery]);

    useEffect(() => {
        setSoaHighlightedIndex(filteredSoaCustomers.length > 0 ? 0 : -1);
    }, [soaSearchQuery, filteredSoaCustomers]);

    const selectSoaCustomer = useCallback((customer) => {
        if (!customer) return;
        const displayName = customer.company_name || `${customer.first_name || ''} ${customer.last_name || ''}`.trim();
        setSoaCustomerId(customer.customer_id);
        setSoaSearchQuery(displayName);
        setSoaDropdownOpen(false);
        setSoaHighlightedIndex(-1);
    }, []);

    const handleClearSoaCustomer = useCallback(() => {
        setSoaCustomerId('');
        setSoaLedger(null);
    }, []);

    const handleSoaKeyDown = (e) => {
        if (!soaDropdownOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            setSoaDropdownOpen(true);
            return;
        }

        if (!soaDropdownOpen || filteredSoaCustomers.length === 0) {
            if (e.key === 'Escape') setSoaDropdownOpen(false);
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSoaHighlightedIndex(prev => (prev < filteredSoaCustomers.length - 1 ? prev + 1 : 0));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSoaHighlightedIndex(prev => (prev > 0 ? prev - 1 : filteredSoaCustomers.length - 1));
        } else if (e.key === 'Enter') {
            if (soaHighlightedIndex >= 0 && soaHighlightedIndex < filteredSoaCustomers.length) {
                e.preventDefault();
                selectSoaCustomer(filteredSoaCustomers[soaHighlightedIndex]);
            }
        } else if (e.key === 'Tab') {
            if (soaHighlightedIndex >= 0 && soaHighlightedIndex < filteredSoaCustomers.length) {
                selectSoaCustomer(filteredSoaCustomers[soaHighlightedIndex]);
            }
        } else if (e.key === 'Escape') {
            setSoaDropdownOpen(false);
        }
    };

    const fetchCustomerLedger = useCallback(async (customerId) => {
        if (!customerId) return;
        try {
            setSoaLoading(true);
            const res = await api.get(`/ar/customers/${customerId}/ledger`, {
                params: {
                    startDate: dateRange.startDate.toISOString(),
                    endDate: dateRange.endDate.toISOString()
                }
            });
            setSoaLedger(res.data);
        } catch (err) {
            console.error('Failed to load customer ledger:', err);
            toast.error('Failed to load customer ledger history.');
        } finally {
            setSoaLoading(false);
        }
    }, [dateRange]);

    const handleExportSoaPdf = useCallback(async () => {
        if (!soaCustomerId) {
            toast.error('Please select a customer first');
            return;
        }
        try {
            setSoaDownloading(true);
            const response = await api.get(`/ar/customers/${soaCustomerId}/soa/pdf`, {
                params: {
                    startDate: dateRange.startDate.toISOString(),
                    endDate: dateRange.endDate.toISOString(),
                    include_receipts: attachReceiptImages ? 'true' : 'false',
                },
                responseType: 'blob'
            });

            const blob = new Blob([response.data], { type: 'application/pdf' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            const safeName = (soaLedger?.customer?.name || 'Customer').replace(/[^A-Za-z0-9_-]/g, '_');
            link.setAttribute('download', `Statement_of_Account_${safeName}.pdf`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
            toast.success('SOA PDF generated successfully!');
        } catch (err) {
            console.error('Failed to export SOA PDF:', err);
            toast.error('Failed to generate SOA PDF.');
        } finally {
            setSoaDownloading(false);
        }
    }, [soaCustomerId, dateRange, soaLedger, attachReceiptImages]);

    // Lazily load the shared customer list if the Overview tab hasn't populated it yet.
    useEffect(() => {
        if (activeTab === 'ledger_soa' && customers.length === 0) {
            api.get('/customers/with-balances', { params: { paginated: 1, page: 1, pageSize: 500 } })
                .then(res => setCustomers(res.data?.data || res.data || []))
                .catch(err => console.error('Failed to load customers for SOA:', err));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, customers.length]);

    useEffect(() => {
        if (soaCustomerId) {
            fetchCustomerLedger(soaCustomerId);
        }
    }, [soaCustomerId, fetchCustomerLedger]);

    return {
        soaCustomerId, soaLedger, soaLoading, soaDownloading,
        attachReceiptImages, setAttachReceiptImages,
        soaSearchQuery, setSoaSearchQuery,
        soaDropdownOpen, setSoaDropdownOpen,
        soaHighlightedIndex, setSoaHighlightedIndex,
        soaComboboxRef, filteredSoaCustomers,
        selectSoaCustomer, handleClearSoaCustomer, handleSoaKeyDown,
        fetchCustomerLedger, handleExportSoaPdf,
    };
}
