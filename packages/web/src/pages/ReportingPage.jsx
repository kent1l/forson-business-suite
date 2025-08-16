import React, { useState, Suspense, lazy } from 'react';
import { useAuth } from '../contexts/AuthContext';

// Dynamically import all report components
const SalesReport = lazy(() => import('../components/reports/SalesReport'));
const InventoryValuationReport = lazy(() => import('../components/reports/InventoryValuationReport'));
const TopSellingReport = lazy(() => import('../components/reports/TopSellingReport'));
const LowStockReport = lazy(() => import('../components/reports/LowStockReport'));
const SalesByCustomerReport = lazy(() => import('../components/reports/SalesByCustomerReport'));
const InventoryMovementReport = lazy(() => import('../components/reports/InventoryMovementReport'));
const ProfitabilityReport = lazy(() => import('../components/reports/ProfitabilityReport'));

// Map tab keys to their corresponding components and labels
const reportTabs = [
    { key: 'sales', label: 'Sales Summary', component: SalesReport },
    { key: 'valuation', label: 'Inventory Valuation', component: InventoryValuationReport },
    { key: 'top_selling', label: 'Top-Selling Products', component: TopSellingReport },
    { key: 'low_stock', label: 'Low Stock', component: LowStockReport },
    { key: 'sales_by_customer', label: 'Sales by Customer', component: SalesByCustomerReport },
    { key: 'inventory_movement', label: 'Inventory Movement', component: InventoryMovementReport },
    { key: 'profitability', label: 'Profitability by Product', component: ProfitabilityReport },
];

const ReportingPage = () => {
    const { hasPermission } = useAuth();
    const [activeTab, setActiveTab] = useState('sales');

    if (!hasPermission('reports:view')) {
        return (
            <div className="text-center p-8">
                <h1 className="text-2xl font-bold text-red-600">Access Denied</h1>
                <p className="text-gray-600 mt-2">You do not have permission to view this page.</p>
            </div>
        );
    }

    const ActiveReportComponent = reportTabs.find(tab => tab.key === activeTab)?.component;

    return (
        <div>
            <h1 className="text-2xl font-semibold text-gray-800 mb-6">Reports</h1>
            <div className="mb-6 border-b border-gray-200">
                <nav className="-mb-px flex space-x-6 overflow-x-auto">
                    {reportTabs.map(tab => (
                        <button 
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)} 
                            className={`py-3 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${activeTab === tab.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </nav>
            </div>

            <div>
                <Suspense fallback={<p>Loading report...</p>}>
                    {ActiveReportComponent && <ActiveReportComponent />}
                </Suspense>
            </div>
        </div>
    );
};

export default ReportingPage;
