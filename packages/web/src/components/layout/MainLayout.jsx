import React, { useState } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import Dashboard from '../../pages/Dashboard';
import SuppliersPage from '../../pages/SuppliersPage';
import PartsPage from '../../pages/PartsPage';
import GoodsReceiptPage from '../../pages/GoodsReceiptPage';
import InvoicingPage from '../../pages/InvoicingPage';
import ApplicationsPage from '../../pages/ApplicationsPage';
import CustomersPage from '../../pages/CustomersPage';
import PowerSearchPage from '../../pages/PowerSearchPage';
import InventoryPage from '../../pages/InventoryPage';
import ReportingPage from '../../pages/ReportingPage';
import EmployeesPage from '../../pages/EmployeesPage';
import SettingsPage from '../../pages/SettingsPage';
import POSPage from '../../pages/POSPage';
import PurchaseOrderPage from '../../pages/PurchaseOrderPage';
import AccountsReceivablePage from '../../pages/AccountsReceivablePage';
import SalesHistoryPage from '../../pages/SalesHistoryPage'; // <-- Import new page
import DocumentsPage from '../../pages/DocumentsPage';

const MainLayout = ({ user, onLogout, onNavigate, currentPage, posLines, setPosLines }) => {
    const [sidebarOpen, setSidebarOpen] = useState(false);

    const renderPage = () => {
        switch (currentPage) {
            case 'dashboard': return <Dashboard />;
            case 'pos': return <POSPage user={user} lines={posLines} setLines={setPosLines} />;
            case 'reporting': return <ReportingPage />;
            case 'power_search': return <PowerSearchPage />;
            case 'suppliers': return <SuppliersPage user={user} />;
            case 'parts': return <PartsPage user={user} />;
            case 'applications': return <ApplicationsPage user={user} />;
            case 'customers': return <CustomersPage user={user} />;
            case 'goods_receipt': return <GoodsReceiptPage user={user} />;
            case 'invoicing': return <InvoicingPage user={user} />;
            case 'sales_history': return <SalesHistoryPage />; // <-- Add case for new page
            case 'documents': return <DocumentsPage />;
            case 'purchase_orders': return <PurchaseOrderPage />;
            case 'ar': return <AccountsReceivablePage />;
            case 'inventory': return <InventoryPage user={user} />;
            case 'employees': return <EmployeesPage user={user} />;
            case 'settings': return <SettingsPage user={user} />;
            default: return <Dashboard />;
        }
    };

    return (
        <div className="flex h-screen bg-slate-50 font-sans text-gray-800">
            <Sidebar user={user} onNavigate={onNavigate} currentPage={currentPage} isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />
            <div className="flex-1 flex flex-col overflow-hidden">
                <Header user={user} onLogout={onLogout} onMenuClick={() => setSidebarOpen(true)} />
                <main className="flex-1 overflow-x-hidden overflow-y-auto bg-slate-50 p-4 sm:p-6 md:p-8">
                    {renderPage()}
                </main>
            </div>
        </div>
    );
};

export default MainLayout;