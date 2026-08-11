import { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../api';
import toast from 'react-hot-toast';

// Owns all state/data-fetching for the AR "Customer Wallet Management" tab.
export default function useARWallet({ hasPermission, activeTab }) {
    const [walletCustomers, setWalletCustomers] = useState([]);
    const [walletLoading, setWalletLoading] = useState(false);
    const [selectedWalletCustomer, setSelectedWalletCustomer] = useState(null);
    const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
    const [walletSearch, setWalletSearch] = useState('');
    const [walletPage, setWalletPage] = useState(1);
    const [walletPageSize, setWalletPageSize] = useState(25);

    const fetchWalletCustomers = useCallback(async () => {
        try {
            setWalletLoading(true);
            const res = await api.get('/ar/customer-liabilities');
            setWalletCustomers(res.data?.data || res.data || []);
        } catch (err) {
            console.error('Failed to fetch wallet overview:', err);
            toast.error('Failed to load wallet management data.');
        } finally {
            setWalletLoading(false);
        }
    }, []);

    useEffect(() => {
        if (hasPermission('ar:view') && activeTab === 'wallet') {
            fetchWalletCustomers();
        }
    }, [activeTab, hasPermission, fetchWalletCustomers]);

    useEffect(() => {
        setWalletPage(1);
    }, [walletSearch]);

    const filteredWalletCustomers = useMemo(() => {
        if (!walletSearch.trim()) return walletCustomers;
        const q = walletSearch.toLowerCase();
        return walletCustomers.filter(w => {
            const name = (w.company_name || `${w.first_name || ''} ${w.last_name || ''}`).toLowerCase();
            return name.includes(q);
        });
    }, [walletCustomers, walletSearch]);

    const paginatedWalletCustomers = useMemo(() => {
        const start = (walletPage - 1) * walletPageSize;
        return filteredWalletCustomers.slice(start, start + walletPageSize);
    }, [filteredWalletCustomers, walletPage, walletPageSize]);

    const handleSelectWalletCustomer = useCallback((customer) => {
        setSelectedWalletCustomer(customer);
        setIsWalletModalOpen(true);
    }, []);

    const handleCloseWalletModal = useCallback(() => {
        setIsWalletModalOpen(false);
        setSelectedWalletCustomer(null);
    }, []);

    return {
        walletCustomers, walletLoading,
        selectedWalletCustomer, isWalletModalOpen,
        walletSearch, setWalletSearch,
        walletPage, setWalletPage,
        walletPageSize, setWalletPageSize,
        filteredWalletCustomers, paginatedWalletCustomers,
        handleSelectWalletCustomer, handleCloseWalletModal,
        fetchWalletCustomers,
    };
}
