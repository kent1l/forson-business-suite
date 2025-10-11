import Icon from '../ui/Icon';
import { ICONS } from '../../constants';
import { useAuth } from '../../contexts/AuthContext';

const Sidebar = ({ onNavigate, currentPage, isOpen, setIsOpen }) => {
    const { hasPermission } = useAuth();

    const navItems = [
        { name: 'Dashboard', icon: ICONS.dashboard, page: 'dashboard', permission: 'dashboard:view' },
        { name: 'POS', icon: ICONS.pos, page: 'pos', permission: 'pos:use' },
        { name: 'Reporting', icon: ICONS.reporting, page: 'reporting', permission: 'reports:view' },
        { name: 'Power Search', icon: ICONS.power_search, page: 'power_search', permission: 'parts:view' },
        { name: 'Invoicing', icon: ICONS.invoice, page: 'invoicing', permission: 'invoicing:create' },
        { name: 'Documents', icon: ICONS.documents || ICONS.archive, page: 'documents', permission: 'documents:view' },
        { name: 'Cheque Printer', icon: ICONS.cheque, page: 'cheque_printer', permissions: ['cheque:print', 'cheque:template_manage', 'cheque:records_view'] },
        { name: 'Sales History', icon: ICONS.history, page: 'sales_history', permission: 'invoicing:create' },
        { name: 'Goods Receipt', icon: ICONS.receipt, page: 'goods_receipt', permission: 'goods_receipt:create' },
        { name: 'Purchase Orders', icon: ICONS.purchase_order, page: 'purchase_orders', permission: 'purchase_orders:view' },
        { name: 'Inventory', icon: ICONS.inventory, page: 'inventory', permission: 'inventory:view' },
        { name: 'A/R', icon: ICONS.ar, page: 'ar', permission: 'ar:view' },
        { name: 'Parts', icon: ICONS.parts, page: 'parts', permission: 'parts:view' },
        { name: 'Suppliers', icon: ICONS.suppliers, page: 'suppliers', permission: 'suppliers:view' },
        { name: 'Customers', icon: ICONS.customers, page: 'customers', permission: 'customers:view' },
        { name: 'Employees', icon: ICONS.employees, page: 'employees', permission: 'employees:view' },
        { name: 'Settings', icon: ICONS.settings, page: 'settings', permission: 'settings:view' },
    ];

    const canViewNavItem = (item) => {
        const permissions = item.permissions || (item.permission ? [item.permission] : []);
        if (!permissions.length) return true;
        return permissions.some((permission) => hasPermission(permission));
    };

    return (
        <>
            <div
                className={`fixed inset-0 z-20 bg-black bg-opacity-50 md:hidden ${isOpen ? 'block' : 'hidden'}`}
                onClick={() => setIsOpen(false)}
            ></div>
            <div
                className={`fixed top-0 left-0 z-30 flex h-full w-64 transform flex-col border-r border-gray-200 bg-white transition-transform duration-300 ease-in-out md:relative md:w-60 md:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
            >
                <div className="flex h-16 items-center px-6 text-lg font-bold text-blue-600">Forson Business Suite</div>
                <nav className="flex-1 space-y-1 px-4 py-4">
                    {navItems.filter(canViewNavItem).map((item) => (
                        <a
                            key={item.name}
                            href="#"
                            onClick={(event) => {
                                event.preventDefault();
                                onNavigate(item.page);
                                setIsOpen(false);
                            }}
                            className={`flex items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-200 ${currentPage === item.page ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-100'}`}
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