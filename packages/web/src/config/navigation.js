import { ICONS } from '../constants';

// ─── Category definitions ───────────────────────────────────────────────────
// Single source of truth for navigable tools/pages — consumed by Sidebar.jsx
// (rendering) and CommandPalette.jsx (search). `keywords` are synonyms so the
// command palette can match on description/intent, not just the literal name.
export const CATEGORIES = [
    {
        key: 'sales',
        title: 'Sales & Invoicing',
        icon: ICONS.invoice,
        items: [
            { name: 'Approval Queue', icon: ICONS.ar,            page: 'staged_sales',  permission: 'invoicing:create', badge: true, keywords: ['pending sales', 'cashier approval', 'staged sales'] },
            { name: 'Invoicing',      icon: ICONS.invoice,       page: 'invoicing',     permission: 'invoicing:create', keywords: ['create invoice', 'bill customer'] },
            { name: 'Sales History',  icon: ICONS.history,       page: 'sales_history', permission: 'invoicing:create', keywords: ['past sales', 'transactions'] },
            { name: 'A/R',            icon: ICONS.ar,            page: 'ar',            permission: 'ar:view', keywords: ['accounts receivable', 'receivables', 'customer balance', 'ar'] },
        ],
    },
    {
        key: 'inventory',
        title: 'Inventory & Warehouse',
        icon: ICONS.inventory,
        items: [
            { name: 'Inventory',       icon: ICONS.inventory,      page: 'inventory',       permission: 'inventory:view', keywords: ['stock', 'warehouse'] },
            { name: 'Goods Receipt',   icon: ICONS.receipt,        page: 'goods_receipt',   permission: 'goods_receipt:create', keywords: ['receive stock', 'grn'] },
            { name: 'Purchase Orders', icon: ICONS.purchase_order, page: 'purchase_orders', permission: 'purchase_orders:view', keywords: ['po', 'purchasing', 'order stock'] },
            { name: 'Cycle Count',     icon: ICONS.dashboard,      page: 'cycle_count',     permission: 'cycle_count:execute', keywords: ['stock count', 'inventory audit'] },
            { name: 'Manager Audit',   icon: ICONS.reporting,      page: 'manager_audit',   permission: 'cycle_count:manage', keywords: ['cycle count review', 'audit approval'] },
        ],
    },
    {
        key: 'master_data',
        title: 'Directory & Master Data',
        icon: ICONS.customers,
        items: [
            { name: 'Parts',        icon: ICONS.parts,        page: 'parts',        permission: 'parts:view', keywords: ['products', 'catalog', 'catalogue', 'sku'] },
            { name: 'Applications', icon: ICONS.applications, page: 'applications', permission: 'applications:view', keywords: ['part fitment', 'vehicle applications'] },
            { name: 'Customers',    icon: ICONS.customers,    page: 'customers',    permission: 'customers:view', keywords: ['clients', 'buyers'] },
            { name: 'Suppliers',    icon: ICONS.suppliers,    page: 'suppliers',    permission: 'suppliers:view', keywords: ['vendors'] },
            { name: 'Documents',    icon: ICONS.documents,    page: 'documents',    permission: 'documents:view', keywords: ['files', 'attachments'] },
        ],
    },
    {
        key: 'hr',
        title: 'Human Resources',
        icon: ICONS.employees,
        items: [
            { name: 'Employees',   icon: ICONS.employees, page: 'employees',   permission: ['employees:view', 'hr:view'], keywords: ['staff', 'personnel'] },
            { name: 'Departments', icon: ICONS.tag,       page: 'departments', permission: 'hr:view', keywords: ['org structure'] },
            { name: 'Time Records', icon: ICONS.history,  page: 'dtr',         permission: 'dtr:view', keywords: ['attendance', 'clock in', 'clock out', 'dtr', 'timesheet', 'punch', 'punch in', 'punch out', 'time in', 'time out'] },
            { name: 'Work Schedules', icon: ICONS.settings, page: 'work_schedules', permission: 'hr:view', keywords: ['shifts', 'roster'] },
            { name: 'Leave',       icon: ICONS.documents, page: 'leave',       permission: 'leave:view', keywords: ['vacation', 'time off', 'leave requests'] },
            { name: 'Payroll',     icon: ICONS.dollar,    page: 'payroll',     permission: 'payroll:view', keywords: ['salary', 'wages', 'pay run'] },
            { name: 'Statutory Rates', icon: ICONS.settings, page: 'statutory_tables', permission: 'payroll:config', keywords: ['sss', 'philhealth', 'pag-ibig', 'tax tables'] },
            { name: 'Pay Components', icon: ICONS.tag, page: 'pay_components', permission: 'payroll:config', keywords: ['allowances', 'deductions', 'earnings'] },
        ],
    },
    {
        key: 'finance',
        title: 'Finance & Expenses',
        icon: ICONS.receipt,
        items: [
            { name: 'A/P',                 icon: ICONS.truck,   page: 'ap',                 permission: 'ap:view', keywords: ['accounts payable', 'payables', 'supplier balance', 'ap', 'supplier bill', 'bill'] },
            { name: 'Cheques & Treasury', icon: ICONS.bank,    page: 'cheques_treasury',   permission: ['cheques:view', 'pdc:view', 'ar:view', 'ap-pdc:view'], keywords: ['pdc', 'post-dated cheques', 'bank', 'check', 'checks', 'cheque', 'cheques'] },
            { name: 'Bulk SOA Generator', icon: ICONS.documents, page: 'soa_gen',          permission: 'ar:view', keywords: ['statement of account', 'soa'] },
            { name: 'Expenses',           icon: ICONS.receipt, page: 'expenses',           permission: 'expenses:view', keywords: ['spending', 'costs'] },
            { name: 'Expense Categories', icon: ICONS.tag,     page: 'expense_categories', permission: 'expenses:manage_categories', keywords: ['expense types'] },
            { name: 'Learned Terms',      icon: ICONS.star,    page: 'expense_lexicon',    permission: 'expenses:manage_lexicon', keywords: ['expense lexicon', 'ocr terms'] },
            { name: 'Paperless Receipts', icon: ICONS.documents, page: 'paperless_receipts', permission: 'documents:view', keywords: ['ocr', 'scan receipt', 'digital receipts'] },
        ],
    },
    {
        key: 'system',
        title: 'System & Analytics',
        icon: ICONS.reporting,
        items: [
            { name: 'Reporting',   icon: ICONS.reporting, page: 'reporting', permission: 'reports:view', keywords: ['analytics', 'reports'] },
            { name: 'Settings',    icon: ICONS.settings,  page: 'settings',  permission: 'settings:view', keywords: ['configuration', 'preferences'] },
            { name: 'User Guide',  icon: ICONS.guide,     external: true, href: '/user-guide.html', permission: 'dashboard:view', keywords: ['help', 'documentation', 'manual'] },
        ],
    },
];

const TOP_ITEMS = [
    { name: 'Dashboard',    icon: ICONS.dashboard,    page: 'dashboard',    permission: 'dashboard:view', keywords: ['home', 'overview'] },
    { name: 'POS',          icon: ICONS.pos,          page: 'pos',          permission: 'pos:use', keywords: ['point of sale', 'checkout', 'sell', 'cashier'] },
    { name: 'Power Search', icon: ICONS.power_search, page: 'power_search', permission: 'parts:view', keywords: ['find part', 'lookup', 'part search'] },
    { name: 'My Pay',       icon: ICONS.dollar,       page: 'my_pay',       permission: 'payslip:view_own', keywords: ['payslip', 'salary', 'my payroll'] },
];

export { TOP_ITEMS };

// ─── Flattened list for search/command-palette use ──────────────────────────
export function getAllNavItems() {
    const flattened = [];

    for (const item of TOP_ITEMS) {
        flattened.push({ ...item, id: item.page ?? item.href, categoryTitle: null });
    }

    for (const cat of CATEGORIES) {
        for (const item of cat.items) {
            flattened.push({ ...item, id: item.page ?? item.href, categoryTitle: cat.title });
        }
    }

    return flattened;
}
