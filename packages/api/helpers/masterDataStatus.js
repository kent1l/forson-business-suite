const TABLES = {
    supplier: ['supplier', 'supplier_id'],
    customer: ['customer', 'customer_id'],
    brand: ['brand', 'brand_id'],
    group: ['"group"', 'group_id'],
};

async function masterStatus(db, entity, id) {
    const [table, column] = TABLES[entity];
    const { rows } = await db.query(
        `SELECT ${column} AS id, is_active, is_merged, merged_into_${column} AS canonical_id
         FROM public.${table} WHERE ${column} = $1`, [id]);
    return rows[0] || null;
}

function retiredConflict(entity, status) {
    return {
        message: `This ${entity} was merged and is read-only. Use canonical ${entity} #${status.canonical_id}.`,
        canonicalId: status.canonical_id,
        retiredId: status.id,
    };
}

async function rejectRetired(db, entity, id, res) {
    const status = await masterStatus(db, entity, id);
    if (status?.is_merged) {
        res.status(409).json(retiredConflict(entity, status));
        return true;
    }
    return false;
}

function requireActiveMasters(db, fields) {
    return async (req, res, next) => {
        if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();
        const candidates = [];
        const visit = value => {
            if (Array.isArray(value)) return value.forEach(visit);
            if (!value || typeof value !== 'object') return;
            for (const [key, child] of Object.entries(value)) {
                if (fields[key] && child !== null && child !== undefined && child !== '' &&
                    typeof child !== 'object') {
                    candidates.push([fields[key], child]);
                } else if (typeof child === 'object') visit(child);
            }
        };
        visit(req.body);
        try {
            for (const [entity, id] of candidates) {
                if (!Number.isInteger(Number(id)) || Number(id) <= 0) {
                    return res.status(400).json({ message: `Invalid ${entity} ID.` });
                }
                const status = await masterStatus(db, entity, id);
                if (status?.is_merged) return res.status(409).json(retiredConflict(entity, status));
                if (status && !status.is_active) {
                    return res.status(409).json({ message: `Inactive ${entity} #${id} cannot be used.`, inactiveId: status.id });
                }
            }
            next();
        } catch (error) { next(error); }
    };
}

function hasMasterIds(value) {
    if (Array.isArray(value)) return value.some(hasMasterIds);
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, child]) =>
        ['supplier_id', 'freight_supplier_id', 'customer_id', 'brand_id', 'group_id',
            'supplierId', 'freightSupplierId', 'selectedSupplier', 'customerId', 'selectedCustomer',
            'brandId', 'groupId'].includes(key)
        || hasMasterIds(child));
}

module.exports = { masterStatus, rejectRetired, retiredConflict, requireActiveMasters, hasMasterIds };
