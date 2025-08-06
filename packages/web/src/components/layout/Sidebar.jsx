import React from 'react';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';

const Sidebar = ({ onNavigate, currentPage, isOpen, setIsOpen }) => {
    const navItems = [
        { name: 'Dashboard', icon: ICONS.dashboard, page: 'dashboard' },
        { name: 'Reporting', icon: ICONS.reporting, page: 'reporting' },
        { name: 'Power Search', icon: ICONS.power_search, page: 'power_search' },
        { name: 'Invoicing', icon: ICONS.invoice, page: 'invoicing' },
        { name: 'Goods Receipt', icon: ICONS.receipt, page: 'goods_receipt' },
        { name: 'Inventory', icon: ICONS.inventory, page: 'inventory' },
        { name: 'Parts', icon: ICONS.parts, page: 'parts' },
        { name: 'Suppliers', icon: ICONS.suppliers, page: 'suppliers' },
        { name: 'Customers', icon: ICONS.customers, page: 'customers' },
        { name: 'Applications', icon: ICONS.applications, page: 'applications' },
    ];

    return (
        <>
            <div className={`fixed inset-0 bg-black bg-opacity-50 z-20 md:hidden ${isOpen ? 'block' : 'hidden'}`} onClick={() => setIsOpen(false)}></div>
            <div className={`fixed top-0 left-0 h-full bg-white border-r border-gray-200 flex flex-col z-30 w-64 md:w-60 md:relative md:translate-x-0 transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                <div className="h-16 flex items-center px-6 text-lg font-bold text-blue-600">Forson Suite</div>
                <nav className="flex-1 px-4 py-4 space-y-1">
                    {navItems.map(item => (
                        <a
                            key={item.name}
                            href="#"
                            onClick={(e) => { e.preventDefault(); onNavigate(item.page); setIsOpen(false); }}
                            className={`flex items-center px-3 py-2.5 rounded-lg transition-colors duration-200 text-sm font-medium ${currentPage === item.page ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-100'}`}
                        >
                            <Icon path={item.icon} className="h-5 w-5" />
                            <span className="ml-3">{item.name}</span>
                        </a>
                    ))}
                </nav>
            </div>
        </>
    );
};

export default Sidebar;
