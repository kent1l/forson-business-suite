import React, { useState, lazy, useMemo } from 'react';
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
const ChequePrinterPage = lazy(() => import('../../pages/ChequePrinterPage'));

const PageFallback = () => (
    <div className="flex h-full items-center justify-center rounded-3xl border border-dashed border-blue-200 bg-white/70 p-12 text-sm font-medium text-blue-600 shadow-inner shadow-blue-500/10">
        Loading module…
    </div>
);

const MainLayout = ({ user, onLogout, onNavigate, currentPage, posLines, setPosLines }) => {
    const [sidebarOpen, setSidebarOpen] = useState(false);

    const pageRenderers = useMemo(() => ({
        dashboard: () => <Dashboard onNavigate={onNavigate} />,
        pos: () => <POSPage user={user} lines={posLines} setLines={setPosLines} />,
        reporting: () => <ReportingPage />,
        power_search: () => <PowerSearchPage />,
        suppliers: () => <SuppliersPage user={user} />,
        parts: () => <PartsPage user={user} onNavigate={onNavigate} />,
        parts_cleanup: () => <PartsCleanupPage user={user} onNavigate={onNavigate} />,
        customers: () => <CustomersPage user={user} />,
        goods_receipt: () => <GoodsReceiptPage user={user} onNavigate={onNavigate} />,
        goods_receipt_history: () => <GoodsReceiptHistoryPage user={user} />,
        invoicing: () => <InvoicingPage user={user} />,
        sales_history: () => <SalesHistoryPage />,
        documents: () => <DocumentsPage />,
        purchase_orders: () => <PurchaseOrderPage />,
        ar: () => <AccountsReceivablePage />,
        inventory: () => <InventoryPage user={user} />,
        employees: () => <EmployeesPage user={user} />,
        cheque_printer: () => <ChequePrinterPage />,
        settings: () => <SettingsPage user={user} />
    }), [user, onNavigate, posLines, setPosLines]);

    const renderPage = pageRenderers[currentPage] || pageRenderers.dashboard;

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