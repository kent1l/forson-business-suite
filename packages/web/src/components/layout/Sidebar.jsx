import React, { useState, useEffect } from 'react';
import Icon from '../ui/Icon';
import BrandLogo from '../ui/BrandLogo';
import { ICONS } from '../../constants';
import { APP_VERSION_LABEL } from '../../constants/version';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api';
import useLocalStorage from '../../hooks/useLocalStorage';

// ─── Storage keys ──────────────────────────────────────────────────────────
const COLLAPSED_KEY = 'forson_sidebar_collapsed';
const CATEGORIES_KEY = 'forson_sidebar_categories';

// Categories all start collapsed by default (empty set = nothing open)
const DEFAULT_OPEN_CATEGORIES = {};

// ─── Category definitions ───────────────────────────────────────────────────
const CATEGORIES = [
    {
        key: 'sales',
        title: 'Sales & Invoicing',
        icon: ICONS.invoice,
        items: [
            { name: 'Approval Queue', icon: ICONS.ar,            page: 'staged_sales',  permission: 'invoicing:create', badge: true },
            { name: 'Invoicing',      icon: ICONS.invoice,       page: 'invoicing',     permission: 'invoicing:create' },
            { name: 'Sales History',  icon: ICONS.history,       page: 'sales_history', permission: 'invoicing:create' },
            { name: 'A/R',            icon: ICONS.ar,            page: 'ar',            permission: 'ar:view' },
        ],
    },
    {
        key: 'inventory',
        title: 'Inventory & Warehouse',
        icon: ICONS.inventory,
        items: [
            { name: 'Inventory',       icon: ICONS.inventory,      page: 'inventory',       permission: 'inventory:view' },
            { name: 'Goods Receipt',   icon: ICONS.receipt,        page: 'goods_receipt',   permission: 'goods_receipt:create' },
            { name: 'Purchase Orders', icon: ICONS.purchase_order, page: 'purchase_orders', permission: 'purchase_orders:view' },
            { name: 'Cycle Count',     icon: ICONS.dashboard,      page: 'cycle_count',     permission: 'cycle_count:execute' },
            { name: 'Manager Audit',   icon: ICONS.reporting,      page: 'manager_audit',   permission: 'cycle_count:manage' },
        ],
    },
    {
        key: 'master_data',
        title: 'Directory & Master Data',
        icon: ICONS.customers,
        items: [
            { name: 'Parts',        icon: ICONS.parts,        page: 'parts',        permission: 'parts:view' },
            { name: 'Applications', icon: ICONS.applications, page: 'applications', permission: 'applications:view' },
            { name: 'Customers',    icon: ICONS.customers,    page: 'customers',    permission: 'customers:view' },
            { name: 'Suppliers',    icon: ICONS.suppliers,    page: 'suppliers',    permission: 'suppliers:view' },
            { name: 'Documents',    icon: ICONS.documents,    page: 'documents',    permission: 'documents:view' },
        ],
    },
    {
        key: 'hr',
        title: 'Human Resources',
        icon: ICONS.employees,
        items: [
            { name: 'Employees',   icon: ICONS.employees, page: 'employees',   permission: ['employees:view', 'hr:view'] },
            { name: 'Departments', icon: ICONS.tag,       page: 'departments', permission: 'hr:view' },
            { name: 'Time Records', icon: ICONS.history,  page: 'dtr',         permission: 'dtr:view' },
            { name: 'Work Schedules', icon: ICONS.settings, page: 'work_schedules', permission: 'hr:view' },
            { name: 'Leave',       icon: ICONS.documents, page: 'leave',       permission: 'leave:view' },
            { name: 'Payroll',     icon: ICONS.dollar,    page: 'payroll',     permission: 'payroll:view' },
            { name: 'Statutory Rates', icon: ICONS.settings, page: 'statutory_tables', permission: 'payroll:config' },
            { name: 'Pay Components', icon: ICONS.tag, page: 'pay_components', permission: 'payroll:config' },
        ],
    },
    {
        key: 'finance',
        title: 'Finance & Expenses',
        icon: ICONS.receipt,
        items: [
            { name: 'A/P',                 icon: ICONS.truck,   page: 'ap',                 permission: 'ap:view' },
            { name: 'Cheques & Treasury', icon: ICONS.bank,    page: 'cheques_treasury',   permission: ['cheques:view', 'pdc:view', 'ar:view', 'ap-pdc:view'] },
            { name: 'Bulk SOA Generator', icon: ICONS.documents, page: 'soa_gen',          permission: 'ar:view' },
            { name: 'Expenses',           icon: ICONS.receipt, page: 'expenses',           permission: 'expenses:view' },
            { name: 'Expense Categories', icon: ICONS.tag,     page: 'expense_categories', permission: 'expenses:manage_categories' },
            { name: 'Learned Terms',      icon: ICONS.star,    page: 'expense_lexicon',    permission: 'expenses:manage_lexicon' },
            { name: 'Paperless Receipts', icon: ICONS.documents, page: 'paperless_receipts', permission: 'documents:view' },
        ],
    },
    {
        key: 'system',
        title: 'System & Analytics',
        icon: ICONS.reporting,
        items: [
            { name: 'Reporting',   icon: ICONS.reporting, page: 'reporting', permission: 'reports:view' },
            { name: 'Settings',    icon: ICONS.settings,  page: 'settings',  permission: 'settings:view' },
            { name: 'User Guide',  icon: ICONS.guide,     external: true, href: '/user-guide.html', permission: 'dashboard:view' },
        ],
    },
];

const TOP_ITEMS = [
    { name: 'Dashboard',    icon: ICONS.dashboard,    page: 'dashboard',    permission: 'dashboard:view' },
    { name: 'POS',          icon: ICONS.pos,          page: 'pos',          permission: 'pos:use' },
    { name: 'Power Search', icon: ICONS.power_search, page: 'power_search', permission: 'parts:view' },
    { name: 'My Pay',       icon: ICONS.dollar,       page: 'my_pay',       permission: 'payslip:view_own' },
];

// ─── Accordion: CSS grid-template-rows trick with smooth fade/slide ──
function AccordionContent({ isOpen, children }) {
    return (
        <div
            style={{
                display: 'grid',
                gridTemplateRows: isOpen ? '1fr' : '0fr',
                transition: 'grid-template-rows 260ms cubic-bezier(0.2, 0, 0, 1)',
            }}
        >
            <div
                style={{
                    overflow: 'hidden',
                    opacity: isOpen ? 1 : 0,
                    transform: isOpen ? 'translateY(0)' : 'translateY(-4px)',
                    transition: 'opacity 220ms cubic-bezier(0.2, 0, 0, 1), transform 220ms cubic-bezier(0.2, 0, 0, 1)',
                }}
            >
                {children}
            </div>
        </div>
    );
}

// ─── Single nav item ────────────────────────────────────────────────────────
function NavItem({ item, currentPage, onNavigate, setIsOpen, isCollapsed, pendingCount, categoryTitle }) {
    const isActive = !item.external && currentPage === item.page;
    const badge = item.badge ? pendingCount : 0;

    return (
        <div className="relative group/item flex justify-center w-full">
            <a
                href={item.external ? item.href : '#'}
                target={item.external ? '_blank' : undefined}
                rel={item.external ? 'noopener noreferrer' : undefined}
                onClick={(e) => {
                    if (item.external) {
                        if (setIsOpen) setIsOpen(false);
                        return; // let the browser open the link in a new tab
                    }
                    e.preventDefault();
                    onNavigate(item.page);
                    if (setIsOpen) setIsOpen(false);
                }}
                className={[
                    'flex items-center text-sm font-medium select-none',
                    'transition-all duration-200 ease-[cubic-bezier(0.2,0,0,1)]',
                    isCollapsed
                        ? 'h-10 w-10 rounded-xl justify-center'
                        : 'px-3 py-2.5 rounded-xl gap-3 w-full',
                    isActive
                        ? 'bg-primary-600 text-white shadow-md shadow-primary-600/30 dark:shadow-none'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white',
                ].join(' ')}
            >
                <Icon
                    path={item.icon}
                    className={[
                        'h-5 w-5 shrink-0 transition-colors duration-150',
                        isActive ? 'text-white' : 'text-slate-500 group-hover/item:text-slate-800',
                    ].join(' ')}
                />

                {!isCollapsed && (
                    <span className="flex-1 flex items-center justify-between min-w-0">
                        <span className="truncate leading-tight">{item.name}</span>
                        {badge > 0 && (
                            <span className="ml-2 shrink-0 bg-amber-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center animate-pulse">
                                {badge > 99 ? '99+' : badge}
                            </span>
                        )}
                    </span>
                )}

                {/* Collapsed mini-mode badge dot */}
                {isCollapsed && badge > 0 && (
                    <span className="absolute top-1 right-1 h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-white" />
                )}
            </a>

            {/* Tooltip — only in collapsed mini mode */}
            {isCollapsed && (
                <div
                    role="tooltip"
                    className={[
                        'pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50',
                        'hidden md:group-hover/item:flex items-center gap-2',
                        'px-3 py-2 rounded-lg bg-slate-900 dark:bg-slate-700 text-white text-xs shadow-xl whitespace-nowrap',
                        'before:absolute before:top-1/2 before:-translate-y-1/2 before:-left-1.5',
                        'before:border-4 before:border-transparent before:border-r-slate-900 dark:before:border-r-slate-700',
                    ].join(' ')}
                >
                    {categoryTitle && (
                        <span className="text-slate-500 text-[10px] font-normal">{categoryTitle} ›</span>
                    )}
                    <span className="font-semibold">{item.name}</span>
                    {badge > 0 && (
                        <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                            {badge}
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Category accordion group ───────────────────────────────────────────────
function CategoryGroup({ cat, currentPage, onNavigate, setIsOpen, isCollapsed, isOpen, onToggle, pendingCount, hasPermission }) {
    const visibleItems = cat.items.filter(item => hasPermission(item.permission));
    if (visibleItems.length === 0) return null;

    // Determine if any item in this group is active (for visual hint in mini mode)
    const hasActive = visibleItems.some(i => i.page === currentPage);

    if (isCollapsed) {
        // Mini mode: render items directly centered with subtle divider line
        return (
            <div className="space-y-1 py-1 w-full flex flex-col items-center">
                <div className="w-8 h-px bg-slate-200/80 my-1" />
                {visibleItems.map(item => (
                    <NavItem
                        key={item.page || item.name}
                        item={item}
                        currentPage={currentPage}
                        onNavigate={onNavigate}
                        setIsOpen={setIsOpen}
                        isCollapsed={true}
                        pendingCount={pendingCount}
                        categoryTitle={cat.title}
                    />
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-0.5 pt-1">
            {/* Accordion trigger */}
            <button
                type="button"
                onClick={onToggle}
                className={[
                    'w-full flex items-center justify-between gap-2',
                    'px-3 py-2.5 min-h-[36px] rounded-lg text-left',
                    'transition-colors duration-200 ease-[cubic-bezier(0.2,0,0,1)] cursor-pointer',
                    hasActive && !isOpen
                        ? 'text-primary-600 dark:text-primary-500 bg-primary-50 dark:bg-primary-900/40'
                        : 'text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800',
                ].join(' ')}
            >
                <span className="text-[10px] font-bold uppercase tracking-widest leading-none">
                    {cat.title}
                </span>
                <Icon
                    path={ICONS.chevronDown}
                    className={[
                        'h-3.5 w-3.5 shrink-0',
                        'transition-transform duration-260 ease-[cubic-bezier(0.2,0,0,1)]',
                        isOpen ? 'rotate-0' : '-rotate-90',
                    ].join(' ')}
                />
            </button>

            {/* Animated content */}
            <AccordionContent isOpen={isOpen}>
                <div className="space-y-0.5 pb-1 pl-1">
                    {visibleItems.map(item => (
                        <NavItem
                            key={item.page || item.name}
                            item={item}
                            currentPage={currentPage}
                            onNavigate={onNavigate}
                            setIsOpen={setIsOpen}
                            isCollapsed={false}
                            pendingCount={pendingCount}
                            categoryTitle={cat.title}
                        />
                    ))}
                </div>
            </AccordionContent>
        </div>
    );
}

// ─── Main sidebar component ─────────────────────────────────────────────────
const Sidebar = ({ onNavigate, currentPage, isOpen, setIsOpen }) => {
    const { hasPermission } = useAuth();
    const [pendingCount, setPendingCount] = useState(0);

    // Sidebar mini-mode: persists last state
    const [isCollapsed, setIsCollapsed] = useLocalStorage(COLLAPSED_KEY, false);

    // Category open/closed: starts all collapsed (empty object = nothing open)
    const [openCategories, setOpenCategories] = useLocalStorage(CATEGORIES_KEY, DEFAULT_OPEN_CATEGORIES);

    const toggleCategory = (key) => {
        setOpenCategories(prev => ({ ...prev, [key]: !prev[key] }));
    };

    // Fetch pending approval queue count
    useEffect(() => {
        const fetch = async () => {
            try {
                const { data } = await api.get('/sales/staging?status=PENDING');
                setPendingCount(data.length);
            } catch {
                // silent
            }
        };
        fetch();
        const id = setInterval(fetch, 10_000);
        return () => clearInterval(id);
    }, []);

    const filteredTopItems = TOP_ITEMS.filter(i => hasPermission(i.permission));

    return (
        <>
            {/* ── Mobile backdrop ─────────────────────────────────────── */}
            <div
                aria-hidden="true"
                className={[
                    'fixed inset-0 z-20 bg-slate-900/50 backdrop-blur-sm md:hidden',
                    'transition-opacity duration-300',
                    isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
                ].join(' ')}
                onClick={() => setIsOpen(false)}
            />

            {/* ── Sidebar shell ───────────────────────────────────────── */}
            <aside
                className={[
                    'fixed top-0 left-0 h-full z-30 flex flex-col',
                    'bg-white dark:bg-slate-900 border-r border-slate-200/80 dark:border-slate-800',
                    'transform transition-[width,transform] duration-300 ease-[cubic-bezier(0.2,0,0,1)]',
                    'md:relative md:translate-x-0',
                    isOpen ? 'translate-x-0' : '-translate-x-full',
                    isCollapsed ? 'w-64 md:w-[72px]' : 'w-64 md:w-60',
                ].join(' ')}
            >
                {/* ── Header ─────────────────────────────────────────── */}
                <div
                    className={[
                        'h-16 flex items-center border-b border-slate-100 dark:border-slate-800 shrink-0 transition-all duration-300',
                        isCollapsed ? 'justify-center px-0' : 'justify-between px-4',
                    ].join(' ')}
                >
                    {!isCollapsed ? (
                        <>
                            <div className="flex items-center gap-3 overflow-hidden">
                                {/* Brand mark */}
                                <BrandLogo
                                    variant="icon"
                                    className="h-10 w-10 rounded-xl object-contain shrink-0"
                                    fallback={
                                        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary-600 to-accent-600 text-white flex items-center justify-center font-black text-lg shadow-md shadow-primary-600/30 shrink-0">
                                            F
                                        </div>
                                    }
                                />
                                {/* Brand name / full logo */}
                                <BrandLogo
                                    variant="full"
                                    className="h-6 max-w-[130px] object-contain"
                                    fallback={
                                        <span className="font-bold text-slate-800 dark:text-slate-100 text-[15px] tracking-tight whitespace-nowrap transition-opacity duration-300">
                                            Forson <span className="text-primary-600 dark:text-primary-500">Suite</span>
                                        </span>
                                    }
                                />
                            </div>

                            {/* Collapse toggle button */}
                            <button
                                type="button"
                                onClick={() => setIsCollapsed(true)}
                                title="Collapse sidebar"
                                className="hidden md:flex items-center justify-center h-8 w-8 rounded-lg text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors duration-150 shrink-0 cursor-pointer"
                            >
                                <Icon path={ICONS.chevronLeft} className="h-4 w-4" />
                            </button>
                        </>
                    ) : (
                        /* Collapsed Header: Centered 40px Brand Mark with Expand Toggle capability */
                        <div className="relative group/logo flex items-center justify-center w-full">
                            <button
                                type="button"
                                onClick={() => setIsCollapsed(false)}
                                title="Expand sidebar"
                                className="relative h-10 w-10 rounded-xl overflow-hidden bg-gradient-to-br from-primary-600 to-accent-600 text-white flex items-center justify-center font-black text-lg shadow-md shadow-primary-600/30 transition-all duration-200 hover:scale-105 cursor-pointer shrink-0"
                            >
                                <BrandLogo variant="icon" className="h-full w-full object-contain" fallback={<span>F</span>} />
                                <div className="absolute inset-0 rounded-xl bg-slate-900/20 opacity-0 group-hover/logo:opacity-100 transition-opacity flex items-center justify-center">
                                    <Icon path={ICONS.chevronRight} className="h-4 w-4 text-white" />
                                </div>
                            </button>
                        </div>
                    )}
                </div>

                {/* ── Nav body ────────────────────────────────────────── */}
                <nav
                    className={`flex-1 overflow-y-auto overflow-x-hidden py-4 space-y-0.5 ${
                        isCollapsed ? '[&::-webkit-scrollbar]:hidden' : ''
                    }`}
                    style={{
                        scrollbarWidth: isCollapsed ? 'none' : 'thin',
                        scrollbarColor: '#e2e8f0 transparent',
                        msOverflowStyle: isCollapsed ? 'none' : 'auto',
                    }}
                >
                    {/* Padding wrapper adjusts with collapsed state */}
                    <div className={isCollapsed ? 'px-0 flex flex-col items-center w-full' : 'px-3'}>
                        {/* Top standalone items */}
                        <div className={isCollapsed ? 'space-y-1 w-full flex flex-col items-center' : 'space-y-0.5 mb-4'}>
                            {filteredTopItems.map(item => (
                                <NavItem
                                    key={item.page || item.name}
                                    item={item}
                                    currentPage={currentPage}
                                    onNavigate={onNavigate}
                                    setIsOpen={setIsOpen}
                                    isCollapsed={isCollapsed}
                                    pendingCount={pendingCount}
                                    categoryTitle=""
                                />
                            ))}
                        </div>

                        {/* Separator */}
                        <div className={isCollapsed ? 'w-8 h-px bg-slate-200/80 dark:bg-slate-700 my-2' : 'h-px bg-slate-100 dark:bg-slate-800 mb-4'} />

                        {/* Category groups */}
                        <div className={isCollapsed ? 'space-y-1 w-full flex flex-col items-center' : 'space-y-2'}>
                            {CATEGORIES.map(cat => (
                                <CategoryGroup
                                    key={cat.key}
                                    cat={cat}
                                    currentPage={currentPage}
                                    onNavigate={onNavigate}
                                    setIsOpen={setIsOpen}
                                    isCollapsed={isCollapsed}
                                    isOpen={!!openCategories[cat.key]}
                                    onToggle={() => toggleCategory(cat.key)}
                                    pendingCount={pendingCount}
                                    hasPermission={hasPermission}
                                />
                            ))}
                        </div>
                    </div>
                </nav>

                {/* ── Footer ─────────────────────────────────────────── */}
                <div className="shrink-0 border-t border-slate-100 dark:border-slate-800 px-4 py-3 flex items-center justify-between gap-2">
                    {!isCollapsed ? (
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono truncate">{APP_VERSION_LABEL}</span>
                    ) : (
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono text-center w-full">v2.5</span>
                    )}
                </div>
            </aside>
        </>
    );
};

export default Sidebar;
