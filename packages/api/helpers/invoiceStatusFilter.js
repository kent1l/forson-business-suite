const KNOWN_INVOICE_STATUSES = ['Paid', 'Partially Paid', 'Unpaid', 'Partially Refunded', 'Fully Refunded', 'Cancelled'];

// Parses the `status` query param into either 'active' (exclude Cancelled), an array of
// known statuses to filter to (IN-list; supports multi-select), or null (no status filter).
// Accepts a single string, a comma-separated string ("Paid,Unpaid"), or an array (repeated query params).
function normalizeStatusFilter(status) {
    if (!status) return null;
    if (status === 'active') return 'active';
    if (status === 'all') return null;
    const list = Array.isArray(status) ? status : String(status).split(',');
    const known = list.map(s => s.trim()).filter(s => KNOWN_INVOICE_STATUSES.includes(s));
    return known.length > 0 ? known : null;
}

// Builds an invoice-status SQL clause and appends any needed params, given a raw `status`
// query value. `defaultFilter` controls behavior when `status` is omitted entirely
// ('active' excludes Cancelled by default; null applies no filter by default).
// `column` lets callers match their query's table alias (defaults to 'i.status').
function buildStatusClause(status, params, { defaultFilter = null, column = 'i.status' } = {}) {
    const statusFilter = status ? normalizeStatusFilter(status) : defaultFilter;
    if (statusFilter === 'active') {
        return `${column} <> 'Cancelled'`;
    }
    if (Array.isArray(statusFilter)) {
        const placeholders = statusFilter.map((_, idx) => `$${params.length + idx + 1}`).join(', ');
        params.push(...statusFilter);
        return `${column} IN (${placeholders})`;
    }
    return null;
}

module.exports = { KNOWN_INVOICE_STATUSES, normalizeStatusFilter, buildStatusClause };
