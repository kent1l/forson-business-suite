import React, { useState, useEffect } from 'react';
import Icon from '../ui/Icon';
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
            { name: 'Cheques',        icon: ICONS.receipt,       page: 'cheques',       permission: 'cheques:view' },
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
            { name: 'Power Search',    icon: ICONS.power_search,   page: 'power_search',    permission: 'parts:view' },
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
            { name: 'Employees',    icon: ICONS.employees,    page: 'employees',    permission: 'employees:view' },
        ],
    },
    {
        key: 'system',
        title: 'System & Analytics',
        icon: ICONS.reporting,
        items: [
            { name: 'Reporting', icon: ICONS.reporting, page: 'reporting', permission: 'reports:view' },
            { name: 'Settings',  icon: ICONS.settings,  page: 'settings',  permission: 'settings:view' },
        ],
    },
];

const TOP_ITEMS = [
    { name: 'Dashboard', icon: ICONS.dashboard, page: 'dashboard', permission: 'dashboard:view' },
    { name: 'POS',        icon: ICONS.pos,       page: 'pos',       permission: 'pos:use' },
];

// ─── Accordion: CSS grid-template-rows trick (GPU-accelerated, no layout thrash) ──
function AccordionContent({ isOpen, children }) {
    return (
        <div
            style={{
                display: 'grid',
                gridTemplateRows: isOpen ? '1fr' : '0fr',
                transition: 'grid-template-rows 180ms ease',
            }}
        >
            <div style={{ overflow: 'hidden' }}>{children}</div>
        </div>
    );
}

// ─── Single nav item ────────────────────────────────────────────────────────
function NavItem({ item, currentPage, onNavigate, setIsOpen, isCollapsed, pendingCount, categoryTitle }) {
    const isActive = currentPage === item.page;
    const badge = item.badge ? pendingCount : 0;

    return (
        <div className="relative group/item">
            <a
                href="#"
                onClick={(e) => {
                    e.preventDefault();
                    onNavigate(item.page);
                    if (setIsOpen) setIsOpen(false);
                }}
                className={[
                    'flex items-center gap-3 rounded-lg text-sm font-medium',
                    'transition-all duration-150 ease-in-out select-none',
                    isCollapsed ? 'px-0 py-2.5 justify-center' : 'px-3 py-2',
                    isActive
                        ? 'bg-blue-600 text-white shadow-sm shadow-blue-200'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                ].join(' ')}
            >
                <Icon
                    path={item.icon}
                    className={[
                        'h-[18px] w-[18px] shrink-0 transition-colors duration-150',
                        isActive ? 'text-white' : 'text-slate-400 group-hover/item:text-slate-700',
                    ].join(' ')}
                />

                {!isCollapsed && (
                    <span className="flex-1 flex items-center justify-between min-w-0">
                        <span className="truncate leading-none">{item.name}</span>
                        {badge > 0 && (
                            <span className="ml-2 shrink-0 bg-amber-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center animate-pulse">
                                {badge > 99 ? '99+' : badge}
                            </span>
                        )}
                    </span>
                )}

                {/* Collapsed mini-mode badge dot */}
                {isCollapsed && badge > 0 && (
                    <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-white" />
                )}
            </a>

            {/* Tooltip — only in collapsed mini mode */}
            {isCollapsed && (
                <div
                    role="tooltip"
                    className={[
                        'pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50',
                        'hidden md:group-hover/item:flex items-center gap-2',
                        'px-3 py-2 rounded-lg bg-slate-900 text-white text-xs shadow-xl whitespace-nowrap',
                        'before:absolute before:top-1/2 before:-translate-y-1/2 before:-left-1.5',
                        'before:border-4 before:border-transparent before:border-r-slate-900',
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
        // Mini mode: render items directly with category divider
        return (
            <div className="space-y-0.5 pt-1">
                <div className="h-px bg-slate-100 mx-2 mb-1.5" />
                {visibleItems.map(item => (
                    <NavItem
                        key={item.page}
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
                    'transition-colors duration-100 cursor-pointer',
                    hasActive && !isOpen
                        ? 'text-blue-600 bg-blue-50'
                        : 'text-slate-400 hover:text-slate-700 hover:bg-slate-50',
                ].join(' ')}
            >
                <span className="text-[10px] font-bold uppercase tracking-widest leading-none">
                    {cat.title}
                </span>
                <Icon
                    path={ICONS.chevronDown}
                    className={[
                        'h-3.5 w-3.5 shrink-0',
                        'transition-transform duration-180 ease-in-out',
                        isOpen ? 'rotate-0' : '-rotate-90',
                    ].join(' ')}
                />
            </button>

            {/* Animated content */}
            <AccordionContent isOpen={isOpen}>
                <div className="space-y-0.5 pb-1 pl-1">
                    {visibleItems.map(item => (
                        <NavItem
                            key={item.page}
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
                    'bg-white border-r border-slate-200/80',
                    // Width snaps instantly (no layout animation) — mobile slide uses transform only
                    'transform transition-transform duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]',
                    'md:relative md:translate-x-0',
                    isOpen ? 'translate-x-0' : '-translate-x-full',
                    isCollapsed ? 'w-64 md:w-[72px]' : 'w-64 md:w-60',
                ].join(' ')}
            >
                {/* ── Header ─────────────────────────────────────────── */}
                <div className="h-16 flex items-center justify-between px-4 border-b border-slate-100 shrink-0">
                    <div className="flex items-center gap-3 overflow-hidden">
                        {/* Brand mark */}
                        <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center font-black text-base shadow-md shadow-blue-200 shrink-0">
                            F
                        </div>
                        {/* Brand name — fades out when collapsed */}
                        <span
                            className={[
                                'font-bold text-slate-800 text-[15px] tracking-tight whitespace-nowrap',
                                'transition-[opacity,width,transform] duration-300',
                                isCollapsed
                                    ? 'opacity-0 max-w-0 -translate-x-2 overflow-hidden'
                                    : 'opacity-100 max-w-[140px] translate-x-0',
                            ].join(' ')}
                        >
                            Forson <span className="text-blue-600">Suite</span>
                        </span>
                    </div>

                    {/* Collapse toggle — desktop only */}
                    <button
                        type="button"
                        onClick={() => setIsCollapsed(v => !v)}
                        title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                        className={[
                            'hidden md:flex items-center justify-center',
                            'h-8 w-8 rounded-lg',
                            'text-slate-400 hover:text-slate-700 hover:bg-slate-100',
                            'transition-colors duration-100 shrink-0 cursor-pointer',
                        ].join(' ')}
                    >
                        <Icon
                            path={isCollapsed ? ICONS.chevronRight : ICONS.chevronLeft}
                            className="h-4 w-4"
                        />
                    </button>
                </div>

                {/* ── Nav body ────────────────────────────────────────── */}
                <nav
                    className="flex-1 overflow-y-auto overflow-x-hidden py-4 space-y-0.5"
                    style={{ scrollbarWidth: 'thin', scrollbarColor: '#e2e8f0 transparent' }}
                >
                    {/* Padding wrapper adjusts with collapsed state */}
                    <div className={isCollapsed ? 'px-2' : 'px-3'}>
                        {/* Top standalone items */}
                        <div className="space-y-0.5 mb-4">
                            {filteredTopItems.map(item => (
                                <NavItem
                                    key={item.page}
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
                        <div className="h-px bg-slate-100 mb-4" />

                        {/* Category groups */}
                        <div className="space-y-2">
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
                <div className="shrink-0 border-t border-slate-100 px-4 py-3 flex items-center justify-between gap-2">
                    {!isCollapsed ? (
                        <span className="text-[10px] text-slate-400 font-mono truncate">{APP_VERSION_LABEL}</span>
                    ) : (
                        <span className="text-[10px] text-slate-400 font-mono text-center w-full">v2.5</span>
                    )}
                </div>
            </aside>
        </>
    );
};

export default Sidebar;
