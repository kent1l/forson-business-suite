const crypto = require('crypto');
const policy = require('./masterDataMergePolicy');
const { enqueuePartUpsert } = require('./meiliOutboxService');

const VERSION = 'master-merge-v2';
const PREVIEW_TTL_MS = 10 * 60 * 1000;
const CONFIG = {
    supplier: { table: 'supplier', id: 'supplier_id', code: 'supplier_code', alias: 'supplier_alias', name: 'supplier_name' },
    customer: { table: 'customer', id: 'customer_id', code: 'customer_code', alias: 'customer_alias', name: null },
    brand: { table: 'brand', id: 'brand_id', code: 'brand_code', alias: 'brand_alias', name: 'brand_name' },
    group: { table: '"group"', id: 'group_id', code: 'group_code', alias: 'group_alias', name: 'group_name' },
};
const DRAFT_KEYS = {
    supplier: new Set(['supplier_id', 'supplierId', 'selectedSupplier', 'freight_supplier_id', 'freightSupplierId']),
    customer: new Set(['customer_id', 'customerId', 'selectedCustomer']),
};
const DRAFT_TYPES = {
    supplier: new Set(['PO', 'GOODS-RECEIPT', 'GOODS_RECEIPT']),
    customer: new Set(['SALE', 'SALES', 'INVOICE', 'POS']),
};

function conflict(message, blockers = []) {
    return Object.assign(new Error(message), { statusCode: 409, blockers });
}

function idsFrom(request) {
    const keepId = Number(request.keepId);
    const mergeIds = [...new Set((request.mergeIds || []).map(Number))].sort((a, b) => a - b);
    if (!Number.isInteger(keepId) || keepId <= 0 || !mergeIds.length ||
        mergeIds.includes(keepId) || mergeIds.some(id => !Number.isInteger(id) || id <= 0)) {
        throw Object.assign(new Error('Choose a canonical record and different positive source IDs.'), { statusCode: 400 });
    }
    return { keepId, mergeIds, allIds: [keepId, ...mergeIds].sort((a, b) => a - b) };
}

function displayName(entity, row) {
    if (entity === 'customer') return row.company_name?.trim() ||
        [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.customer_code;
    return row[CONFIG[entity].name];
}

function keyMatches(value, ids) {
    return (typeof value === 'string' || typeof value === 'number') &&
        String(value).trim() !== '' && ids.has(Number(value));
}

function rewriteDraft(value, keys, sources, keepId, hits = []) {
    if (Array.isArray(value)) return value.map(item => rewriteDraft(item, keys, sources, keepId, hits));
    if (!value || typeof value !== 'object') return value;
    const output = {};
    for (const [key, child] of Object.entries(value)) {
        if (keys.has(key) && keyMatches(child, sources)) {
            hits.push(key);
            output[key] = typeof child === 'string' ? String(keepId) : keepId;
        } else {
            output[key] = rewriteDraft(child, keys, sources, keepId, hits);
        }
    }
    return output;
}

function findUnregisteredDraftIds(value, keys, sources, entity, strict = false, path = '') {
    if (Array.isArray(value)) return value.flatMap((item, index) =>
        findUnregisteredDraftIds(item, keys, sources, entity, strict, path + '[' + index + ']'));
    if (!value || typeof value !== 'object') return [];
    const unknown = [];
    for (const [key, child] of Object.entries(value)) {
        const childPath = path ? path + '.' + key : key;
        if (!keys.has(key) && keyMatches(child, sources) &&
            (strict || key.toLowerCase().includes(entity))) unknown.push(childPath);
        unknown.push(...findUnregisteredDraftIds(child, keys, sources, entity, strict, childPath));
    }
    return unknown;
}

class MasterDataMergeService {
    constructor(db, entity) {
        if (!CONFIG[entity]) throw new Error('Unsupported master-data entity: ' + entity);
        this.db = db;
        this.entity = entity;
        this.config = CONFIG[entity];
        this.policy = policy[entity];
        this.primaryKeys = new Map();
    }

    async assertCatalogPolicy(client) {
        const { rows } = await client.query(
            "SELECT child.relname AS table_name, a.attname AS column_name FROM pg_constraint fk " +
            "JOIN pg_class child ON child.oid = fk.conrelid JOIN pg_namespace cn ON cn.oid = child.relnamespace " +
            "JOIN pg_class parent ON parent.oid = fk.confrelid JOIN pg_namespace pn ON pn.oid = parent.relnamespace " +
            "JOIN pg_attribute a ON a.attrelid = child.oid AND a.attnum = fk.conkey[1] " +
            "WHERE fk.contype = 'f' AND cardinality(fk.conkey) = 1 AND cn.nspname = 'public' " +
            "AND pn.nspname = 'public' AND parent.relname = $1", [this.entity]);
        const actual = rows.map(row => row.table_name + '.' + row.column_name).sort();
        const expected = this.policy.references.map(([table, column]) => table + '.' + column).sort();
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            throw conflict('Master-data relationship policy is out of date; merge is disabled.');
        }
    }

    async loadMasters(client, request, locked = false) {
        const { keepId, mergeIds, allIds } = idsFrom(request);
        const sql = 'SELECT * FROM public.' + this.config.table + ' WHERE ' + this.config.id +
            ' = ANY($1::int[]) ORDER BY ' + this.config.id + (locked ? ' FOR UPDATE' : '');
        const { rows } = await client.query(sql, [allIds]);
        if (rows.length !== allIds.length) throw conflict('One or more selected records no longer exist.');
        const keep = rows.find(row => row[this.config.id] === keepId);
        if (!keep.is_active || keep.is_merged || keep['merged_into_' + this.config.id]) {
            throw conflict('The canonical record must be active and unmerged.');
        }
        if (rows.some(row => mergeIds.includes(row[this.config.id]) &&
            (row.is_merged || row['merged_into_' + this.config.id]))) {
            throw conflict('A selected source has already been merged. Choose its current canonical record.');
        }
        return { keep, sources: rows.filter(row => mergeIds.includes(row[this.config.id])), keepId, mergeIds, allIds };
    }

    async lockMasters(client, request) {
        const { allIds } = idsFrom(request);
        for (const id of allIds) {
            await client.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [this.policy.namespace, id]);
        }
        return this.loadMasters(client, request, true);
    }

    async impact(client, mergeIds) {
        const impact = {};
        for (const [table, column, action] of this.policy.references) {
            if (action === 'provenance' || action === 'workflow') continue;
            const { rows } = await client.query(
                'SELECT COUNT(*)::int AS count FROM public.' + table + ' WHERE ' + column + ' = ANY($1::int[])',
                [mergeIds]);
            impact[table + '.' + column] = rows[0].count;
        }
        return impact;
    }

    async relationshipSignatures(client, mergeIds) {
        const signatures = {};
        for (const [table, column, action] of this.policy.references) {
            if (action === 'provenance' || action === 'workflow') continue;
            const columns = await this.primaryKey(client, table);
            const key = 'jsonb_build_array(' + columns.map(name => 't.' + name).join(', ') + ')';
            const { rows } = await client.query(
                'SELECT md5(COALESCE(jsonb_agg(' + key + ' ORDER BY ' + key + ')::text, \'[]\')) AS digest ' +
                'FROM public.' + table + ' t WHERE t.' + column + ' = ANY($1::int[])', [mergeIds]);
            signatures[table + '.' + column] = rows[0].digest;
        }
        return signatures;
    }

    async receiptBlockers(client, allIds, keepId) {
        if (this.entity !== 'supplier') return [];
        const specs = [
            ['supplier_invoice_no', "supplier_invoice_no IS NOT NULL AND status <> 'Voided' AND workflow_status <> 'Cancelled'"],
            ['physical_receipt_no', "physical_receipt_no IS NOT NULL AND length(trim(physical_receipt_no)) > 0 AND status <> 'Voided'"],
        ];
        const blockers = [];
        for (const [field, active] of specs) {
            const { rows } = await client.query(
                'SELECT ' + field + ' AS value, array_agg(grn_id ORDER BY grn_id) AS record_ids, ' +
                'array_agg(supplier_id ORDER BY grn_id) AS owner_ids ' +
                'FROM public.goods_receipt WHERE supplier_id = ANY($1::int[]) AND ' + active +
                ' GROUP BY ' + field + ' HAVING COUNT(*) > 1', [allIds]);
            for (const row of rows) blockers.push({
                table: 'goods_receipt', field, value: row.value, recordIds: row.record_ids,
                canonicalId: keepId, sourceIds: [...new Set(row.owner_ids.filter(id => id !== keepId))],
                reason: 'duplicate_supplier_receipt_number',
            });
        }
        return blockers;
    }

    async certificateBlockers(client, allIds, keepId) {
        if (this.entity !== 'customer') return [];
        const { rows } = await client.query(
            "SELECT certificate_no AS value, array_agg(certificate_id ORDER BY certificate_id) AS record_ids, " +
            "array_agg(customer_id ORDER BY certificate_id) AS owner_ids " +
            "FROM public.withholding_tax_certificate WHERE customer_id = ANY($1::int[]) " +
            "AND certificate_no IS NOT NULL AND status <> 'CANCELLED' " +
            "GROUP BY certificate_no HAVING COUNT(*) > 1", [allIds]);
        return rows.map(row => ({
            table: 'withholding_tax_certificate', field: 'certificate_no', value: row.value,
            recordIds: row.record_ids, canonicalId: keepId,
            sourceIds: [...new Set(row.owner_ids.filter(id => id !== keepId))],
            reason: 'duplicate_customer_certificate',
        }));
    }

    async drafts(client, mergeIds, keepId) {
        if (!DRAFT_KEYS[this.entity]) return { affected: [], blockers: [] };
        const { rows } = await client.query(
            'SELECT draft_id, draft_name, transaction_type, draft_data FROM public.draft_transaction ' +
            'WHERE expires_at > CURRENT_TIMESTAMP ORDER BY draft_id');
        const affected = [], blockers = [], sources = new Set(mergeIds);
        for (const row of rows) {
            const hits = [];
            const updated = rewriteDraft(row.draft_data, DRAFT_KEYS[this.entity], sources, keepId, hits);
            const supported = DRAFT_TYPES[this.entity].has(row.transaction_type) &&
                (row.draft_data?.version === undefined || row.draft_data.version === 1);
            const unknown = findUnregisteredDraftIds(row.draft_data, DRAFT_KEYS[this.entity], sources,
                this.entity, !supported);
            if (!hits.length && !unknown.length) continue;
            if (!supported || unknown.length) blockers.push({
                table: 'draft_transaction', field: 'draft_data', recordIds: [row.draft_id],
                reason: 'unknown_draft_payload', transactionType: row.transaction_type, paths: unknown,
            });
            affected.push({ ...row, updated, hits: [...new Set(hits)].sort() });
        }
        return { affected, blockers };
    }

    async walletState(client, allIds, locked = false) {
        if (this.entity !== 'customer') return { wallets: [], transactions: [], blockers: [] };
        const { rows: wallets } = await client.query(
            'SELECT * FROM public.customer_wallet WHERE customer_id = ANY($1::int[]) ORDER BY wallet_id' +
            (locked ? ' FOR UPDATE' : ''), [allIds]);
        const { rows: transactions } = await client.query(
            'SELECT * FROM public.customer_wallet_transaction WHERE customer_id = ANY($1::int[]) ' +
            'ORDER BY created_at, transaction_id' + (locked ? ' FOR UPDATE' : ''), [allIds]);
        const blockers = [];
        for (const wallet of wallets) {
            const sum = transactions.filter(tx => tx.wallet_id === wallet.wallet_id)
                .reduce((total, tx) => total + Math.round(Number(tx.amount) * 100), 0);
            if (sum !== Math.round(Number(wallet.balance) * 100)) blockers.push({
                table: 'customer_wallet', field: 'balance', recordIds: [wallet.wallet_id],
                reason: 'wallet_ledger_mismatch', customerId: wallet.customer_id,
            });
        }
        if (transactions.some(tx => !wallets.some(wallet =>
            wallet.wallet_id === tx.wallet_id && wallet.customer_id === tx.customer_id))) {
            blockers.push({ table: 'customer_wallet_transaction', field: 'wallet_id', reason: 'wallet_owner_mismatch' });
        }
        let balance = 0;
        for (const tx of transactions) {
            balance += Math.round(Number(tx.amount) * 100);
            if (balance < 0) {
                blockers.push({ table: 'customer_wallet_transaction', field: 'amount',
                    recordIds: [tx.transaction_id], reason: 'negative_combined_wallet_balance' });
                break;
            }
        }
        return { wallets, transactions, blockers };
    }

    async review(client, request, locked = false) {
        const state = locked ? await this.lockMasters(client, request) : await this.loadMasters(client, request);
        const impact = await this.impact(client, state.mergeIds);
        const relationships = await this.relationshipSignatures(client, state.mergeIds);
        const { rows: aliases } = await client.query(
            'SELECT * FROM public.' + this.config.alias + ' WHERE ' + this.config.id +
            ' = ANY($1::int[]) ORDER BY ' + this.entity + '_alias_id', [state.allIds]);
        const { rows: suggestions } = await client.query(
            'SELECT * FROM public.' + this.entity + '_duplicate_suggestion WHERE ' + this.config.id +
            ' = ANY($1::int[]) OR duplicate_' + this.config.id +
            ' = ANY($1::int[]) ORDER BY suggestion_id', [state.mergeIds]);
        const drafts = await this.drafts(client, state.mergeIds, state.keepId);
        const wallets = await this.walletState(client, state.allIds, locked);
        const blockers = [
            ...await this.receiptBlockers(client, state.allIds, state.keepId),
            ...await this.certificateBlockers(client, state.allIds, state.keepId),
            ...drafts.blockers, ...wallets.blockers,
        ];
        const fingerprintInput = {
            version: VERSION, entity: this.entity, keepId: state.keepId, mergeIds: state.mergeIds,
            masters: [state.keep, ...state.sources].map(row =>
                [row[this.config.id], displayName(this.entity, row), row[this.config.code],
                    row.is_active, row.is_merged, row['merged_into_' + this.config.id]]),
            impact, relationships, blockers, drafts: drafts.affected.map(row => [row.draft_id, row.draft_data]),
            aliases, suggestions,
            wallets: wallets.wallets.map(row => [row.wallet_id, row.balance]),
            walletTransactions: wallets.transactions.map(row =>
                [row.transaction_id, row.customer_id, row.amount, row.balance_after, row.created_at]),
        };
        const fingerprint = crypto.createHash('sha256').update(JSON.stringify(fingerprintInput)).digest('hex');
        return { ...state, impact, aliases, suggestions, drafts, wallets, blockers, fingerprint };
    }

    async preview(request, actorEmployeeId, client = this.db) {
        await this.assertCatalogPolicy(client);
        const review = await this.review(client, request);
        const impact = { ...review.impact };
        if (this.entity === 'brand' || this.entity === 'group') {
            impact.parts_reassigned = impact['part.' + this.config.id] || 0;
        }
        if (review.blockers.length && Number.isInteger(Number(actorEmployeeId)) && Number(actorEmployeeId) > 0) {
            await client.query(
                `INSERT INTO public.master_data_merge_blocked_preview
                 (entity_type, canonical_id, source_ids, actor_employee_id, impact, blockers, master_names)
                 VALUES ($1, $2, $3::int[], $4, $5::jsonb, $6::jsonb, $7::jsonb)`,
                [this.entity, review.keepId, review.mergeIds, actorEmployeeId,
                    JSON.stringify(impact), JSON.stringify(review.blockers),
                    JSON.stringify([review.keep, ...review.sources].map(row => ({
                        id: row[this.config.id], name: displayName(this.entity, row), code: row[this.config.code],
                    })))]);
        }
        return {
            keep: review.keep, merge: review.sources, impact,
            conflicts: review.blockers, drafts: review.drafts.affected.map(row =>
                ({ draftId: row.draft_id, draftName: row.draft_name, paths: row.hits })),
            aliasesToUnion: [
                ...review.sources.map(row => ({ name: displayName(this.entity, row),
                    code: row[this.config.code], sourceId: row[this.config.id] })),
                ...review.aliases.filter(row => review.mergeIds.includes(row[this.config.id]))
                    .map(row => ({ name: row.alias_name, code: row.alias_code, sourceId: row[this.config.id] })),
            ],
            tagsToUnion: this.entity === 'customer' ? impact['customer_tag.customer_id'] || 0 : 0,
            walletTotal: review.wallets.wallets.reduce((sum, row) => sum + Number(row.balance), 0),
            previewFingerprint: review.fingerprint,
            previewToken: this.previewToken(review.fingerprint, Date.now()),
            warnings: ['Historical documents will display under the canonical record after merging.'],
            postconditionScope: [...Object.keys(review.impact),
                ...(review.drafts.affected.length ? ['draft_transaction.draft_data'] : []),
                ...(this.entity === 'customer' ? ['customer_wallet.balance', 'customer_wallet_transaction.balance_after'] : []),
                ...((this.entity === 'brand' || this.entity === 'group') ? ['meili_sync_outbox.part'] : [])],
        };
    }

    previewToken(fingerprint, issuedAt) {
        const payload = `${VERSION}:${this.entity}:${fingerprint}:${issuedAt}`;
        const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET;
        if (!secret) throw new Error('A server signing secret is required for merge previews.');
        const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
        return `${issuedAt}.${signature}`;
    }

    assertPreviewToken(request) {
        const match = /^(\d{13})\.([a-f0-9]{64})$/.exec(request.previewToken || '');
        if (!match) throw conflict('Refresh the merge preview before confirming.');
        const issuedAt = Number(match[1]);
        if (issuedAt > Date.now() || Date.now() - issuedAt > PREVIEW_TTL_MS) {
            throw conflict('Merge preview expired. Refresh and review it again.');
        }
        const expected = this.previewToken(request.previewFingerprint, issuedAt);
        if (!crypto.timingSafeEqual(Buffer.from(request.previewToken), Buffer.from(expected))) {
            throw conflict('Merge preview token is invalid. Refresh and review it again.');
        }
    }

    async history(limit = 50, client = this.db) {
        const size = Math.min(Math.max(Number(limit) || 50, 1), 100);
        const { rows } = await client.query(
            `SELECT o.operation_id, o.canonical_id, o.source_ids, o.actor_employee_id,
                    CONCAT_WS(' ', actor.first_name, actor.last_name) AS actor_name,
                    o.started_at, o.completed_at,
                    o.undo_expires_at, o.status, o.impact, o.decisions,
                    o.reverted_at, o.reverted_by_employee_id, o.revert_reason,
                    CONCAT_WS(' ', reverter.first_name, reverter.last_name) AS reverted_by_name,
                    (SELECT jsonb_agg(s.before_image ORDER BY s.record_id)
                     FROM public.master_data_merge_snapshot s
                     WHERE s.operation_id = o.operation_id AND s.table_name = $1) AS master_before_images,
                    (status = 'active' AND undo_expires_at > NOW()) AS within_undo_window
             FROM public.master_data_merge_operation o
             LEFT JOIN public.employee actor ON actor.employee_id = o.actor_employee_id
             LEFT JOIN public.employee reverter ON reverter.employee_id = o.reverted_by_employee_id
             WHERE entity_type = $1
             ORDER BY started_at DESC LIMIT $2`, [this.entity, size]);
        const operations = rows.map(row => {
            const masters = row.master_before_images || [];
            const find = id => masters.find(master => master[this.config.id] === id);
            const { master_before_images: _beforeImages, ...operation } = row;
            return {
                ...operation,
                canonical: find(row.canonical_id) ? {
                    id: row.canonical_id, name: displayName(this.entity, find(row.canonical_id)),
                    code: find(row.canonical_id)[this.config.code],
                } : { id: row.canonical_id },
                sources: row.source_ids.map(id => find(id) ? {
                    id, name: displayName(this.entity, find(id)), code: find(id)[this.config.code],
                } : { id }),
                revertEligible: row.within_undo_window && row.decisions?.afterImagesCaptured === true &&
                    Number.isInteger(row.decisions?.snapshotCount),
            };
        });
        const { rows: blocked } = await client.query(
            `SELECT p.preview_id, p.canonical_id, p.source_ids, p.actor_employee_id,
                    CONCAT_WS(' ', actor.first_name, actor.last_name) AS actor_name,
                    p.observed_at, p.impact, p.blockers, p.master_names
             FROM public.master_data_merge_blocked_preview p
             LEFT JOIN public.employee actor ON actor.employee_id = p.actor_employee_id
             WHERE p.entity_type = $1 ORDER BY p.observed_at DESC LIMIT $2`, [this.entity, size]);
        return [...operations, ...blocked.map(row => ({
            operation_id: row.preview_id, canonical_id: row.canonical_id, source_ids: row.source_ids,
            actor_employee_id: row.actor_employee_id, actor_name: row.actor_name,
            started_at: row.observed_at, status: 'blocked',
            impact: { references: row.impact }, blockers: row.blockers,
            canonical: row.master_names.find(item => item.id === row.canonical_id),
            sources: row.master_names.filter(item => row.source_ids.includes(item.id)),
            revertEligible: false, within_undo_window: false,
        }))].sort((a, b) => new Date(b.started_at) - new Date(a.started_at)).slice(0, size);
    }

    async execute(request, actorEmployeeId) {
        idsFrom(request);
        if (!Array.isArray(request.suggestionIds || [])) {
            throw Object.assign(new Error('Suggestion IDs must be an array.'), { statusCode: 400 });
        }
        if (typeof request.previewFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(request.previewFingerprint)) {
            throw conflict('Refresh the merge preview before confirming.');
        }
        this.assertPreviewToken(request);
        if (request.acknowledgeHistoricalDocuments !== true) {
            throw Object.assign(new Error('Acknowledge the historical document change before merging.'), { statusCode: 400 });
        }
        const client = await this.db.getClient();
        try {
            await client.query('BEGIN');
            const result = await this.executeWithClient(client, request, actorEmployeeId);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async primaryKey(client, table) {
        if (this.primaryKeys.has(table)) return this.primaryKeys.get(table);
        const { rows } = await client.query(
            "SELECT a.attname FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid " +
            "JOIN pg_namespace n ON n.oid = t.relnamespace " +
            "JOIN unnest(i.indkey) WITH ORDINALITY k(attnum, ordinal) ON true " +
            "JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum " +
            "WHERE n.nspname = 'public' AND t.relname = $1 AND i.indisprimary ORDER BY k.ordinal", [table]);
        if (!rows.length) throw new Error('Snapshot table lacks a primary key: ' + table);
        const columns = rows.map(row => row.attname);
        this.primaryKeys.set(table, columns);
        return columns;
    }

    async snapshot(client, operationId, table, where, ids) {
        const columns = await this.primaryKey(client, table);
        const key = 'jsonb_build_array(' + columns.map(column => 't.' + column).join(', ') + ')::text';
        await client.query(
            'INSERT INTO public.master_data_merge_snapshot (operation_id, table_name, record_id, before_image) ' +
            'SELECT $1, $2, ' + key + ', to_jsonb(t) FROM (SELECT * FROM public.' +
            (table === 'group' ? '"group"' : table) + ' t WHERE ' + where + ' FOR UPDATE) t' +
            ' ON CONFLICT (operation_id, table_name, record_id) DO NOTHING',
            [operationId, table, ids]);
    }

    async captureAfterImages(client, operationId, keepId) {
        const { rows: tables } = await client.query(
            'SELECT DISTINCT table_name FROM public.master_data_merge_snapshot WHERE operation_id = $1',
            [operationId]);
        for (const { table_name: table } of tables) {
            const columns = await this.primaryKey(client, table);
            const key = 'jsonb_build_array(' + columns.map(name => 't."' + name + '"').join(', ') + ')::text';
            const relation = table === 'group' ? '"group"' : '"' + table + '"';
            await client.query(
                'UPDATE public.master_data_merge_snapshot s SET after_image = to_jsonb(t) ' +
                'FROM public.' + relation + ' t WHERE s.operation_id = $1 AND s.table_name = $2 ' +
                'AND s.record_id = ' + key, [operationId, table]);
        }
        const addedTables = [this.config.alias];
        if (this.entity === 'customer') addedTables.push('customer_tag', 'customer_wallet');
        for (const table of addedTables) {
            const columns = await this.primaryKey(client, table);
            const key = 'jsonb_build_array(' + columns.map(name => 't."' + name + '"').join(', ') + ')::text';
            await client.query(
                'INSERT INTO public.master_data_merge_snapshot ' +
                '(operation_id, table_name, record_id, before_image, after_image) ' +
                'SELECT $1, $2, ' + key + ', NULL, to_jsonb(t) FROM public."' + table + '" t ' +
                'WHERE t."' + this.config.id + '" = $3 ' +
                'ON CONFLICT (operation_id, table_name, record_id) DO UPDATE ' +
                'SET after_image = EXCLUDED.after_image', [operationId, table, keepId]);
        }
    }

    async captureBeforeImages(client, operationId, review) {
        const captured = new Set();
        const capture = async (table, column, ids) => {
            const key = table + '.' + column + ':' + ids.join(',');
            if (captured.has(key)) return;
            captured.add(key);
            await this.snapshot(client, operationId, table, 't.' + column + ' = ANY($3::int[])', ids);
        };
        await capture(this.entity, this.config.id, review.allIds);
        for (const [table, column, action] of this.policy.references) {
            if (action === 'provenance') continue;
            if (action === 'workflow') {
                await capture(table, column, review.allIds);
            } else {
                await capture(table, column, action === 'union' ? review.allIds : review.mergeIds);
            }
        }
        if (this.entity === 'customer') {
            await capture('customer_wallet', 'customer_id', review.allIds);
            await capture('customer_wallet_transaction', 'customer_id', review.allIds);
        }
        if (this.entity === 'brand' || this.entity === 'group') {
            await this.snapshot(client, operationId, 'entity_duplicate_decision_cache',
                't.entity_type = ' + "'" + this.entity + "'" +
                ' AND (t.left_entity_id = ANY($3::int[]) OR t.right_entity_id = ANY($3::int[]))', review.mergeIds);
        }
        for (const draft of review.drafts.affected) {
            await this.snapshot(client, operationId, 'draft_transaction', 't.draft_id = ANY($3::int[])', [draft.draft_id]);
        }
    }

    async unionTags(client, review) {
        if (this.entity !== 'customer') return;
        await client.query(
            'INSERT INTO public.customer_tag (customer_id, tag_id) ' +
            'SELECT $1, tag_id FROM public.customer_tag WHERE customer_id = ANY($2::int[]) ON CONFLICT DO NOTHING',
            [review.keepId, review.mergeIds]);
        await client.query('DELETE FROM public.customer_tag WHERE customer_id = ANY($1::int[])', [review.mergeIds]);
    }

    async unionAliases(client, review) {
        const table = this.config.alias;
        const owner = this.config.id;
        const aliasKey = this.entity + '_alias_id';
        const { rows } = await client.query(
            'SELECT * FROM public.' + table + ' WHERE ' + owner + ' = ANY($1::int[]) ORDER BY ' + aliasKey + ' FOR UPDATE',
            [review.allIds]);
        const canonicalNames = new Set([displayName(this.entity, review.keep).trim().toLowerCase()]);
        const canonicalCodes = new Set([String(review.keep[this.config.code] || '').trim().toLowerCase()]);
        for (const row of rows.filter(item => item[owner] === review.keepId)) {
            canonicalNames.add(row.alias_name.trim().toLowerCase());
            if (row.alias_code) canonicalCodes.add(row.alias_code.trim().toLowerCase());
        }
        for (const source of review.sources) {
            const candidates = [
                ...rows.filter(row => row[owner] === source[owner]),
                { alias_name: displayName(this.entity, source), alias_code: source[this.config.code],
                    ['source_' + owner]: source[owner] },
            ];
            for (const item of candidates) {
                let name = String(item.alias_name || '').trim();
                const rawCode = String(item.alias_code || '').trim();
                if (!name) continue;
                if (canonicalNames.has(name.toLowerCase())) {
                    if (!rawCode || canonicalCodes.has(rawCode.toLowerCase())) continue;
                    name = canonicalNames.has(rawCode.toLowerCase()) ? rawCode + ' (former code)' : rawCode;
                }
                if (canonicalNames.has(name.toLowerCase())) continue;
                const code = rawCode && !canonicalCodes.has(rawCode.toLowerCase()) ? rawCode : null;
                await client.query(
                    'INSERT INTO public.' + table + ' (' + owner + ', alias_name, alias_code, source_' + owner + ') ' +
                    'VALUES ($1, $2, $3, $4)',
                    [review.keepId, name, code, item['source_' + owner] || source[owner]]);
                canonicalNames.add(name.toLowerCase());
                if (code) canonicalCodes.add(code.toLowerCase());
            }
        }
        await client.query('DELETE FROM public.' + table + ' WHERE ' + owner + ' = ANY($1::int[])', [review.mergeIds]);
    }

    async consolidateWallets(client, review) {
        if (this.entity !== 'customer' || !review.wallets.wallets.some(wallet =>
            review.mergeIds.includes(wallet.customer_id))) return;
        const fresh = await this.walletState(client, review.allIds, true);
        if (fresh.blockers.length) throw conflict('Wallet ledger must be reconciled before merge.', fresh.blockers);
        let canonical = fresh.wallets.find(wallet => wallet.customer_id === review.keepId);
        if (!canonical) {
            const { rows } = await client.query(
                'INSERT INTO public.customer_wallet (customer_id, balance) VALUES ($1, 0) RETURNING *',
                [review.keepId]);
            canonical = rows[0];
        }
        for (const tx of fresh.transactions) {
            await client.query(
                'UPDATE public.customer_wallet_transaction SET wallet_id = $1, customer_id = $2 WHERE transaction_id = $3',
                [canonical.wallet_id, review.keepId, tx.transaction_id]);
        }
        let cents = 0;
        for (const tx of fresh.transactions) {
            cents += Math.round(Number(tx.amount) * 100);
            if (cents < 0) throw conflict('Combined wallet chronology would become negative.');
            await client.query('UPDATE public.customer_wallet_transaction SET balance_after = $1 WHERE transaction_id = $2',
                [cents / 100, tx.transaction_id]);
        }
        await client.query('DELETE FROM public.customer_wallet WHERE customer_id = ANY($1::int[])', [review.mergeIds]);
        await client.query('UPDATE public.customer_wallet SET balance = $1, updated_at = NOW() WHERE wallet_id = $2',
            [cents / 100, canonical.wallet_id]);
    }

    async moveReferences(client, review) {
        for (const [table, column, action] of this.policy.references) {
            if (action !== 'move') continue;
            await client.query(
                'UPDATE public.' + table + ' SET ' + column + ' = $1 WHERE ' + column + ' = ANY($2::int[])',
                [review.keepId, review.mergeIds]);
        }
    }

    async rewriteDrafts(client, review) {
        for (const row of review.drafts.affected) {
            await client.query(
                'UPDATE public.draft_transaction SET draft_data = $1::jsonb, last_updated = NOW() WHERE draft_id = $2',
                [JSON.stringify(row.updated), row.draft_id]);
        }
    }

    async archiveSuggestions(client, review, suggestionIds, actorEmployeeId) {
        const table = this.entity + '_duplicate_suggestion';
        const key = this.config.id;
        const selected = [...new Set(suggestionIds.map(Number))];
        if (selected.some(id => !Number.isInteger(id) || id <= 0)) {
            throw Object.assign(new Error('Suggestion IDs must be positive integers.'), { statusCode: 400 });
        }
        const { rows } = await client.query(
            'SELECT * FROM public.' + table + ' WHERE ' + key + ' = ANY($1::int[]) OR duplicate_' + key +
            ' = ANY($1::int[]) FOR UPDATE', [review.mergeIds]);
        if (selected.some(id => !rows.some(row => Number(row.suggestion_id) === id && row.status === 'pending'))) {
            throw conflict('A selected suggestion is no longer pending for these sources.');
        }
        if (selected.length) await client.query(
            "UPDATE public." + table + " SET status = 'merged', merged_at = NOW(), merged_by = $1, updated_at = NOW() " +
            "WHERE suggestion_id = ANY($2::bigint[]) AND status = 'pending'", [actorEmployeeId, selected]);
        await client.query(
            "UPDATE public." + table + " SET status = 'dismissed', dismissed_at = NOW(), dismissed_by = $1, updated_at = NOW() " +
            "WHERE status = 'pending' AND (" + key + " = ANY($2::int[]) OR duplicate_" + key + " = ANY($2::int[]))",
            [actorEmployeeId, review.mergeIds]);
        if (this.entity === 'brand' || this.entity === 'group') {
            await client.query(
                'DELETE FROM public.entity_duplicate_decision_cache WHERE entity_type = $1 AND ' +
                '(left_entity_id = ANY($2::int[]) OR right_entity_id = ANY($2::int[]))',
                [this.entity, review.mergeIds]);
        }
        return rows;
    }

    async assertPostconditions(client, review, affectedParts) {
        for (const [table, column, action] of this.policy.references) {
            if (action === 'provenance' || action === 'workflow') continue;
            const { rows } = await client.query(
                'SELECT 1 FROM public.' + table + ' WHERE ' + column + ' = ANY($1::int[]) LIMIT 1',
                [review.mergeIds]);
            if (rows.length) throw new Error('Merge left source reference: ' + table + '.' + column);
        }
        const drafts = await this.drafts(client, review.mergeIds, review.keepId);
        if (drafts.affected.length || drafts.blockers.length) throw new Error('Merge left an active draft on a source.');
        const { rows: masters } = await client.query(
            'SELECT ' + this.config.id + ', is_active, is_merged, merged_into_' + this.config.id +
            ' FROM public.' + this.config.table + ' WHERE ' + this.config.id + ' = ANY($1::int[])',
            [review.allIds]);
        if (masters.some(row => row[this.config.id] === review.keepId ? (!row.is_active || row.is_merged) :
            (row.is_active || !row.is_merged || row['merged_into_' + this.config.id] !== review.keepId))) {
            throw new Error('Master retirement postcondition failed.');
        }
        if (this.entity === 'customer') {
            const wallet = await this.walletState(client, review.allIds);
            if (wallet.blockers.length) throw new Error('Wallet postcondition failed.');
            let cents = 0;
            for (const tx of wallet.transactions) {
                cents += Math.round(Number(tx.amount) * 100);
                if (Math.round(Number(tx.balance_after) * 100) !== cents) {
                    throw new Error('Wallet transaction running-balance postcondition failed.');
                }
            }
        }
        if (affectedParts.length) {
            const { rows } = await client.query(
                "SELECT COUNT(DISTINCT entity_id)::int AS count FROM public.meili_sync_outbox " +
                "WHERE entity_type = 'part' AND event_type = 'upsert_part' AND entity_id = ANY($1::bigint[]) " +
                "AND status = 'pending'", [affectedParts]);
            if (rows[0].count !== affectedParts.length) throw new Error('Catalog sync postcondition failed.');
        }
    }

    revertTables() {
        return new Set([
            this.entity, this.config.alias, this.entity + '_duplicate_suggestion',
            ...this.policy.references.map(([table]) => table),
            ...(DRAFT_KEYS[this.entity] ? ['draft_transaction'] : []),
            ...(this.entity === 'customer' ? ['customer_wallet', 'customer_wallet_transaction'] : []),
            ...((this.entity === 'brand' || this.entity === 'group') ? ['entity_duplicate_decision_cache'] : []),
        ]);
    }

    async currentSnapshotRow(client, snapshot, image = snapshot.after_image) {
        if (!this.revertTables().has(snapshot.table_name)) throw conflict('Unknown snapshot table; automatic revert is disabled.');
        const table = snapshot.table_name;
        const relation = table === 'group' ? '"group"' : '"' + table + '"';
        const columns = await this.primaryKey(client, table);
        const key = 'jsonb_build_array(' + columns.map(name => 't."' + name + '"').join(', ') + ')::text';
        const { rows } = await client.query(
            'SELECT to_jsonb(t) = $2::jsonb AS matches FROM public.' + relation + ' t ' +
            'WHERE ' + key + ' = $1 FOR UPDATE',
            [snapshot.record_id, image === null ? null : JSON.stringify(image)]);
        return rows[0] || null;
    }

    async assertRevertSafe(client, operation, snapshots) {
        if (operation.status !== 'active' || new Date(operation.undo_expires_at) <= new Date()) {
            throw conflict('This merge is outside its revert window.');
        }
        if (operation.decisions?.afterImagesCaptured !== true || !snapshots.length ||
            Number(operation.decisions.snapshotCount) !== snapshots.length ||
            snapshots.some(row => row.before_image === null && row.after_image === null)) {
            throw conflict('Complete merge snapshots are unavailable; use a forward correction.');
        }
        const ids = [operation.canonical_id, ...operation.source_ids];
        const { rows: otherMerges } = await client.query(
            `SELECT operation_id FROM public.master_data_merge_operation
             WHERE entity_type = $1 AND operation_id <> $2 AND started_at >= $3
               AND (canonical_id = ANY($4::int[]) OR source_ids && $4::int[]) LIMIT 1`,
            [this.entity, operation.operation_id, operation.completed_at, ids]);
        if (otherMerges.length) throw conflict('A selected master took part in another merge after this one.');
        for (const snapshot of snapshots) {
            const current = await this.currentSnapshotRow(client, snapshot);
            if (snapshot.after_image === null ? current !== null : !current?.matches) {
                throw conflict('An affected ' + snapshot.table_name + ' row changed after the merge; use a forward correction.');
            }
        }
        const scoped = [this.config.alias];
        if (this.entity === 'customer') scoped.push('customer_tag', 'customer_wallet', 'customer_wallet_transaction');
        for (const table of scoped) {
            const columns = await this.primaryKey(client, table);
            const key = 'jsonb_build_array(' + columns.map(name => 't."' + name + '"').join(', ') + ')::text';
            const { rows } = await client.query(
                'SELECT ' + key + ' AS record_id FROM public."' + table + '" t WHERE t."' +
                this.config.id + '" = ANY($1::int[]) FOR UPDATE', [ids]);
            const known = new Set(snapshots.filter(row => row.table_name === table).map(row => row.record_id));
            if (rows.some(row => !known.has(row.record_id))) {
                throw conflict('New ' + table + ' activity makes this revert unsafe.');
            }
        }
    }

    async restoreSnapshotRow(client, snapshot) {
        const table = snapshot.table_name;
        const relation = table === 'group' ? '"group"' : '"' + table + '"';
        const type = 'public.' + relation;
        const columns = await this.primaryKey(client, table);
        const key = 'jsonb_build_array(' + columns.map(name => 't."' + name + '"').join(', ') + ')::text';
        if (snapshot.before_image === null) {
            await client.query('DELETE FROM public.' + relation + ' t WHERE ' + key + ' = $1', [snapshot.record_id]);
        } else if (snapshot.after_image === null) {
            await client.query('INSERT INTO public.' + relation +
                ' SELECT (jsonb_populate_record(NULL::' + type + ', $1::jsonb)).*',
                [JSON.stringify(snapshot.before_image)]);
        } else {
            const { rows: writable } = await client.query(
                `SELECT column_name FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = $1 AND is_generated = 'NEVER'
                 ORDER BY ordinal_position`, [table]);
            const assignments = writable.map(row => row.column_name).filter(name => !columns.includes(name))
                .map(name => '"' + name + '" = restored."' + name + '"').join(', ');
            if (assignments) await client.query(
                'UPDATE public.' + relation + ' t SET ' + assignments +
                ' FROM jsonb_populate_record(NULL::' + type + ', $2::jsonb) restored ' +
                'WHERE ' + key + ' = $1', [snapshot.record_id, JSON.stringify(snapshot.before_image)]);
        }
    }

    async revertWithClient(client, operationId, actorEmployeeId, reason) {
        if (!/^[0-9a-f-]{36}$/i.test(String(operationId))) {
            throw Object.assign(new Error('A valid merge operation ID is required.'), { statusCode: 400 });
        }
        if (!Number.isInteger(Number(actorEmployeeId)) || Number(actorEmployeeId) <= 0 ||
            typeof reason !== 'string' || !reason.trim()) {
            throw Object.assign(new Error('A revert actor and reason are required.'), { statusCode: 400 });
        }
        await this.assertCatalogPolicy(client);
        const { rows: [operation] } = await client.query(
            'SELECT * FROM public.master_data_merge_operation WHERE operation_id = $1 AND entity_type = $2 FOR UPDATE',
            [operationId, this.entity]);
        if (!operation) throw Object.assign(new Error('Merge operation not found.'), { statusCode: 404 });
        const ids = [operation.canonical_id, ...operation.source_ids].sort((a, b) => a - b);
        for (const id of ids) await client.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [this.policy.namespace, id]);
        const { rows: masters } = await client.query(
            'SELECT ' + this.config.id + ' FROM public.' + this.config.table + ' WHERE ' +
            this.config.id + ' = ANY($1::int[]) ORDER BY ' + this.config.id + ' FOR UPDATE', [ids]);
        if (masters.length !== ids.length) throw conflict('A merge master is missing; automatic revert is unsafe.');
        const { rows: snapshots } = await client.query(
            'SELECT table_name, record_id, before_image, after_image FROM public.master_data_merge_snapshot ' +
            'WHERE operation_id = $1 ORDER BY table_name, record_id', [operationId]);
        await this.assertRevertSafe(client, operation, snapshots);
        await client.query("SELECT set_config('master_data_merge.revert_operation', $1, true)", [operationId]);
        const byTable = table => snapshots.filter(row => row.table_name === table);
        const unions = [this.config.alias, ...(this.entity === 'customer' ? ['customer_tag'] : [])];
        for (const table of unions) for (const row of byTable(table).filter(item => item.before_image === null)) {
            await this.restoreSnapshotRow(client, row);
        }
        for (const row of byTable(this.entity)) await this.restoreSnapshotRow(client, row);
        for (const row of byTable('customer_wallet').filter(item => item.after_image === null)) {
            await this.restoreSnapshotRow(client, row);
        }
        const delayed = new Set([this.entity, ...unions, 'customer_wallet']);
        for (const row of snapshots.filter(item => !delayed.has(item.table_name))) {
            await this.restoreSnapshotRow(client, row);
        }
        for (const table of unions) for (const row of byTable(table).filter(item => item.before_image !== null)) {
            await this.restoreSnapshotRow(client, row);
        }
        for (const row of byTable('customer_wallet').filter(item => item.after_image !== null)) {
            await this.restoreSnapshotRow(client, row);
        }
        for (const snapshot of snapshots) {
            const restored = await this.currentSnapshotRow(client, snapshot, snapshot.before_image);
            if (snapshot.before_image === null ? restored !== null : !restored?.matches) {
                throw new Error('Restored row failed its before-image postcondition: ' + snapshot.table_name);
            }
        }
        const remaining = await this.walletState(client, ids);
        if (remaining.blockers.length) throw conflict('Restored wallet ledger is inconsistent; revert was rolled back.');
        const affectedParts = snapshots.filter(row => row.table_name === 'part')
            .map(row => row.before_image?.part_id).filter(Boolean);
        for (const partId of affectedParts) {
            await enqueuePartUpsert(partId, { source: 'masterDataMergeService.revert', entity: this.entity }, client);
        }
        await client.query(
            "UPDATE public.master_data_merge_operation SET status = 'reverted', reverted_at = NOW(), " +
            'reverted_by_employee_id = $2, revert_reason = $3 WHERE operation_id = $1',
            [operationId, actorEmployeeId, reason.trim()]);
        return { operationId, restoredIds: operation.source_ids, canonicalId: operation.canonical_id };
    }

    async revert(operationId, actorEmployeeId, reason) {
        const client = await this.db.getClient();
        try {
            await client.query('BEGIN');
            const result = await this.revertWithClient(client, operationId, actorEmployeeId, reason);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            if (['23505', '23503', '23514'].includes(error.code)) {
                throw conflict('A later change conflicts with the original master data; use a forward correction.');
            }
            throw error;
        } finally { client.release(); }
    }

    async purgeExpiredMergeSnapshotsWithClient(client) {
        await client.query(
            "UPDATE public.master_data_merge_operation SET status = 'expired' " +
            "WHERE status = 'active' AND undo_expires_at <= NOW()");
        const result = await client.query(
            'DELETE FROM public.master_data_merge_snapshot snapshot ' +
            'USING public.master_data_merge_operation operation ' +
            'WHERE snapshot.operation_id = operation.operation_id ' +
            "AND operation.undo_expires_at < NOW() - INTERVAL '90 days'");
        return result.rowCount;
    }

    async purgeExpiredMergeSnapshots() {
        const client = await this.db.getClient();
        try {
            await client.query('BEGIN');
            const deleted = await this.purgeExpiredMergeSnapshotsWithClient(client);
            await client.query('COMMIT');
            return deleted;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally { client.release(); }
    }

    async executeWithClient(client, request, actorEmployeeId) {
        if (!Number.isInteger(Number(actorEmployeeId)) || Number(actorEmployeeId) <= 0) {
            throw Object.assign(new Error('A valid merge actor is required.'), { statusCode: 400 });
        }
        if (!Array.isArray(request.suggestionIds || [])) {
            throw Object.assign(new Error('Suggestion IDs must be an array.'), { statusCode: 400 });
        }
        if (typeof request.previewFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(request.previewFingerprint)) {
            throw conflict('Refresh the merge preview before confirming.');
        }
        await this.assertCatalogPolicy(client);
        const review = await this.review(client, request, true);
        if (review.fingerprint !== request.previewFingerprint) {
            throw conflict('Merge impact changed. Refresh the preview and review it again.');
        }
        if (review.blockers.length) throw conflict('Resolve the listed merge blockers before retrying.', review.blockers);
        const selected = request.suggestionIds || [];
        const { rows: [operation] } = await client.query(
            "INSERT INTO public.master_data_merge_operation " +
            "(entity_type, canonical_id, source_ids, actor_employee_id, undo_expires_at, impact, decisions) " +
            "VALUES ($1, $2, $3::int[], $4, NOW() + INTERVAL '24 hours', $5::jsonb, $6::jsonb) " +
            "RETURNING operation_id",
            [this.entity, review.keepId, review.mergeIds, actorEmployeeId,
                JSON.stringify({ references: review.impact, drafts: review.drafts.affected.length }),
                JSON.stringify({ suggestionIds: selected, policyVersion: VERSION })]);
        await this.captureBeforeImages(client, operation.operation_id, review);
        await client.query("SELECT set_config('master_data_merge.operation', $1, true)", [operation.operation_id]);
        const affectedParts = [];
        if (this.entity === 'brand' || this.entity === 'group') {
            const { rows } = await client.query(
                'SELECT part_id FROM public.part WHERE ' + this.config.id + ' = ANY($1::int[]) ORDER BY part_id',
                [review.mergeIds]);
            affectedParts.push(...rows.map(row => row.part_id));
        }
        await this.unionTags(client, review);
        await this.unionAliases(client, review);
        await this.consolidateWallets(client, review);
        await this.moveReferences(client, review);
        await this.rewriteDrafts(client, review);
        const suggestions = await this.archiveSuggestions(client, review, selected, actorEmployeeId);
        await client.query(
            'UPDATE public.' + this.config.table + ' SET is_merged = TRUE, is_active = FALSE, merged_into_' +
            this.config.id + ' = $1 WHERE ' + this.config.id + ' = ANY($2::int[])',
            [review.keepId, review.mergeIds]);
        for (const partId of affectedParts) {
            await enqueuePartUpsert(partId, { source: 'masterDataMergeService', entity: this.entity }, client);
        }
        await this.assertPostconditions(client, review, affectedParts);
        await this.captureAfterImages(client, operation.operation_id, review.keepId);
        const { rows: [snapshotTotal] } = await client.query(
            'SELECT COUNT(*)::int AS count FROM public.master_data_merge_snapshot WHERE operation_id = $1',
            [operation.operation_id]);
        await client.query(
            "UPDATE public.master_data_merge_operation SET status = 'active', completed_at = NOW(), " +
            "decisions = decisions || $2::jsonb WHERE operation_id = $1",
            [operation.operation_id, JSON.stringify({ suggestions, afterImagesCaptured: true, snapshotCount: snapshotTotal.count })]);
        return { operationId: operation.operation_id, keepId: review.keepId,
            mergedIds: review.mergeIds, impact: review.impact, partsReassigned: affectedParts.length };
    }
}

module.exports = MasterDataMergeService;
