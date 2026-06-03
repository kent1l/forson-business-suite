import React from 'react';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';
import { APP_VERSION_LABEL } from '../../constants/version';
import { useAuth } from '../../contexts/AuthContext'; // <-- NEW: Import useAuth

const Sidebar = ({ onNavigate, currentPage, isOpen, setIsOpen }) => {
    const { user, hasPermission } = useAuth(); // <-- NEW: Use the auth context

    const navItems = [
        { name: 'Dashboard', icon: ICONS.dashboard, page: 'dashboard', permission: 'dashboard:view' },
        { name: 'POS', icon: ICONS.pos, page: 'pos', permission: 'pos:use' },
        { name: 'Reporting', icon: ICONS.reporting, page: 'reporting', permission: 'reports:view' },
        { name: 'Power Search', icon: ICONS.power_search, page: 'power_search', permission: 'parts:view' }, // Assuming parts:view is sufficient
        { name: 'Invoicing', icon: ICONS.invoice, page: 'invoicing', permission: 'invoicing:create' },
        { name: 'Documents', icon: ICONS.documents || ICONS.archive, page: 'documents', permission: 'documents:view' },
        { name: 'Cheques', icon: ICONS.receipt, page: 'cheques', permission: 'cheques:view' },
        { name: 'Sales History', icon: ICONS.history, page: 'sales_history', permission: 'invoicing:create' },
        { name: 'Goods Receipt', icon: ICONS.receipt, page: 'goods_receipt', permission: 'goods_receipt:create' },
        { name: 'Purchase Orders', icon: ICONS.purchase_order, page: 'purchase_orders', permission: 'purchase_orders:view' },
        { name: 'Inventory', icon: ICONS.inventory, page: 'inventory', permission: 'inventory:view' },
        { name: 'Cycle Count', icon: ICONS.dashboard, page: 'cycle_count', permission: 'cycle_count:execute' },
        { name: 'A/R', icon: ICONS.ar, page: 'ar', permission: 'ar:view' },
        { name: 'Parts', icon: ICONS.parts, page: 'parts', permission: 'parts:view' },
        { name: 'Suppliers', icon: ICONS.suppliers, page: 'suppliers', permission: 'suppliers:view' },
        { name: 'Customers', icon: ICONS.customers, page: 'customers', permission: 'customers:view' },
        { name: 'Applications', icon: ICONS.applications, page: 'applications', permission: 'applications:view' },
        { name: 'Employees', icon: ICONS.employees, page: 'employees', permission: 'employees:view' },
        { name: 'Settings', icon: ICONS.settings, page: 'settings', permission: 'settings:view' },
    ];

    return (
        <>
            <div className={`fixed inset-0 bg-black bg-opacity-50 z-20 md:hidden ${isOpen ? 'block' : 'hidden'}`} onClick={() => setIsOpen(false)}></div>
            <div className={`fixed top-0 left-0 h-full bg-white border-r border-gray-200 flex flex-col z-30 w-64 md:w-60 md:relative md:translate-x-0 transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                <div className="h-16 flex items-center px-6 text-lg font-bold text-blue-600">Forson Business Suite</div>
                <nav className="flex-1 px-4 py-4 space-y-1">
                    {navItems.map(item => (
                        hasPermission(item.permission) && ( // <-- NEW: Conditionally render based on permission
                            <a
                                key={item.name}
                                href="#"
                                onClick={(e) => { e.preventDefault(); onNavigate(item.page); setIsOpen(false); }}
                                className={`flex items-center px-3 py-2.5 rounded-lg transition-colors duration-200 text-sm font-medium ${currentPage === item.page ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-100'}`}
                            >
                                <Icon path={item.icon} className="h-5 w-5" />
                                <span className="ml-3">{item.name}</span>
                            </a>
                        )
                    ))}
                </nav>
                <div className="px-6 py-4 text-[11px] text-gray-400 border-t border-gray-100">
                    {APP_VERSION_LABEL}
                </div>
            </div>
        </>
    );
};

export default Sidebar;
