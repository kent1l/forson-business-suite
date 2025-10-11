import React, { useState, lazy } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';

const { Suspense } = React;

const Dashboard = lazy(() => import('../../pages/Dashboard'));
const SuppliersPage = lazy(() => import('../../pages/SuppliersPage'));
const PartsPage = lazy(() => import('../../pages/PartsPage'));
const PartsCleanupPage = lazy(() => import('../../pages/PartsCleanupPage'));
const GoodsReceiptPage = lazy(() => import('../../pages/GoodsReceiptPage'));
const GoodsReceiptHistoryPage = lazy(() => import('../../pages/GoodsReceiptHistoryPage'));
const InvoicingPage = lazy(() => import('../../pages/InvoicingPage'));
const ApplicationsPage = lazy(() => import('../../pages/ApplicationsPage'));
const CustomersPage = lazy(() => import('../../pages/CustomersPage'));
const PowerSearchPage = lazy(() => import('../../pages/PowerSearchPage'));
const InventoryPage = lazy(() => import('../../pages/InventoryPage'));
const ReportingPage = lazy(() => import('../../pages/ReportingPage'));
const EmployeesPage = lazy(() => import('../../pages/EmployeesPage'));
const SettingsPage = lazy(() => import('../../pages/SettingsPage'));
const POSPage = lazy(() => import('../../pages/POSPage'));
const PurchaseOrderPage = lazy(() => import('../../pages/PurchaseOrderPage'));
const AccountsReceivablePage = lazy(() => import('../../pages/AccountsReceivablePage'));
const SalesHistoryPage = lazy(() => import('../../pages/SalesHistoryPage'));
const DocumentsPage = lazy(() => import('../../pages/DocumentsPage'));

const PageFallback = () => (
    <div className="flex h-full items-center justify-center rounded-3xl border border-dashed border-blue-200 bg-white/70 p-12 text-sm font-medium text-blue-600 shadow-inner shadow-blue-500/10">
        Loading module…
    </div>
);

const MainLayout = ({ user, onLogout, onNavigate, currentPage, posLines, setPosLines }) => {
    const [sidebarOpen, setSidebarOpen] = useState(false);

    const renderPage = () => {
        switch (currentPage) {
            case 'dashboard': return <Dashboard onNavigate={onNavigate} />;
            case 'pos': return <POSPage user={user} lines={posLines} setLines={setPosLines} />;
            case 'reporting': return <ReportingPage />;
            case 'power_search': return <PowerSearchPage />;
            case 'suppliers': return <SuppliersPage user={user} />;
            case 'parts': return <PartsPage user={user} onNavigate={onNavigate} />;
            case 'parts_cleanup': return <PartsCleanupPage user={user} onNavigate={onNavigate} />;
            case 'applications': return <ApplicationsPage user={user} />;
            case 'customers': return <CustomersPage user={user} />;
            case 'goods_receipt': return <GoodsReceiptPage user={user} onNavigate={onNavigate} />;
            case 'goods_receipt_history': return <GoodsReceiptHistoryPage user={user} />;
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
                    <Suspense fallback={<PageFallback />}>
                        {renderPage()}
                    </Suspense>
                </main>
            </div>
        </div>
    );
};

export default MainLayout;