const express = require('express');
const request = require('supertest');
const db = require('../db');
const monitor = require('../services/receiptMonitorService');
let mockUser;
jest.mock('../middleware/authMiddleware', () => ({
    ...jest.requireActual('../middleware/authMiddleware'),
    protect: (req, _res, next) => { req.user = mockUser; next(); },
}));
const app = express(); app.use(express.json()); app.use('/api', require('../routes/physicalDocumentRoutes'));
const base = '/api/settings/physical-document-monitor';

describe('Receipt monitor (isolated real PostgreSQL)', () => {
    let employeeId, customerId, seriesId, typeId, legacy, unassigned;
    const stamp = Date.now();
    // An alphabetic prefix unique to this run, within the parser's ten-letter limit.
    const prefix = `M${String(stamp).slice(-8).split('').map(n => String.fromCharCode(65 + Number(n))).join('')}`;
    const query = (params = {}) => request(app).get(base).query({ series_id: seriesId, ...params });
    const ref = n => `${prefix}-${n}`;
    async function invoice(reference = null, extra = '') {
        const { rows: [record] } = await db.query(`INSERT INTO invoice (invoice_number, customer_id, employee_id,
            total_amount, amount_paid, status, recording_method, physical_receipt_no)
            VALUES ($1,$2,$3,123,0,'Unpaid','PAPER',$4) RETURNING *`, [`MON-${stamp}-${extra}-${Math.random()}`, customerId, employeeId, reference]);
        return record;
    }
    const payload = (record, n, extra = {}) => ({ series_id: seriesId, reference: ref(n), source_type: 'INVOICE', source_id: record.invoice_id,
        expected_reference: record.physical_receipt_no, expected_registry_id: record.physical_document_registry_id,
        expected_version: record.physical_receipt_version, verified: true, reason: 'Verified against original paper', ...extra });
    beforeAll(async () => {
        if (!/test/.test(process.env.DB_NAME || '')) throw new Error('Run against an isolated test database.');
        employeeId = (await db.query(`INSERT INTO employee (first_name,last_name,permission_level_id,username,password_hash,password_salt)
            SELECT 'Monitor','Test',permission_level_id,$1,'hash','salt' FROM permission_level LIMIT 1 RETURNING employee_id`, [`mon_${stamp}`])).rows[0].employee_id;
        customerId = (await db.query("INSERT INTO customer (first_name,last_name) VALUES ('Monitor',$1) RETURNING customer_id", [String(stamp)])).rows[0].customer_id;
        typeId = (await db.query(`INSERT INTO physical_document_type (code,name,short_label,controlled_category,tax_designation,is_active)
            VALUES ($1,'Monitor','MON','SALES_INVOICE','NON_VAT',true) RETURNING type_id`, [prefix])).rows[0].type_id;
        seriesId = (await db.query(`INSERT INTO physical_document_series (type_id,code,name,prefix,min_serial,max_serial)
            VALUES ($1,$2,'Monitor',$2,1,60) RETURNING series_id`, [typeId, prefix])).rows[0].series_id;
        await db.query("INSERT INTO physical_document_series_context (series_id,context) VALUES ($1,'INVOICING')", [seriesId]);
        await db.query(`INSERT INTO physical_document_registry (series_id,canonical_full_reference,serial_number,state)
            VALUES ($1,$2,2,'SPOILED'),($1,$3,40,'SPOILED'),($1,$4,3,'VOIDED'),($1,$5,4,'UNOCCUPIED')`, [seriesId, ref(2), ref(40), ref(3), ref(4)]);
        legacy = await invoice(`${prefix.toLowerCase()} / 00005`, 'legacy');
        unassigned = await invoice();
        mockUser = { employee_id: employeeId, permission_level_id: 10, permissions: [] };
    });
    test('bounded pages and registry/normalized legacy detection', async () => {
        const res = await query(); expect(res.status).toBe(200); expect(res.body.total).toBe('60'); expect(res.body.items).toHaveLength(25);
        expect(res.body.items[1].status).toBe('SPOILED'); expect(res.body.items[2].status).toBe('VOIDED');
        expect(res.body.items[3].status).toBe('NO_RECORD'); expect(res.body.items[4].status).toBe('ISSUED');
        expect(res.body.items[4].candidates[0].id).toBe(legacy.invoice_id);
        const last = await query({ page: 3 }); expect(last.body.items).toHaveLength(10); expect(last.body.items.at(-1).reference).toBe(ref(60));
        expect((await query({ page: 4 })).body.items).toEqual([]);
    });
    test('status filter covers the range before pagination and counts gaps', async () => {
        const res = await query({ status: 'SPOILED' }); expect(res.body.total).toBe('2'); expect(res.body.items.map(r => r.reference)).toEqual([ref(2), ref(40)]);
        const gaps = await query({ status: 'NO_RECORD', page: 2 }); expect(gaps.body.total).toBe('56'); expect(gaps.body.items[0].reference).toBe(ref(29));
        expect((await query({ status: 'nonsense' })).status).toBe(400);
        expect((await query({ page: '1.5' })).status).toBe(400);
    });
    test('follow-up requires a gap, resolves with optimistic concurrency and preserves history', async () => {
        const body = { series_id: seriesId, reference: ref(6), reason: 'Paper missing from booklet' };
        expect((await request(app).post(`${base}/follow-up`).send(body)).status).toBe(201);
        const row = (await query()).body.items.find(r => r.reference === ref(6)); expect(row.follow_up_id).toBeTruthy();
        expect((await request(app).post(`${base}/follow-up`).send(body)).status).toBe(409);
        expect((await request(app).post(`${base}/follow-up`).send({ ...body, resolve: true, expected_event_id: 0 })).status).toBe(409);
        expect((await request(app).post(`${base}/follow-up`).send({ ...body, resolve: true, expected_event_id: row.follow_up_id })).status).toBe(201);
        expect((await query()).body.items.find(r => r.reference === ref(6)).follow_up_id).toBeNull();
        const history = await request(app).get(`${base}/history`).query({ series_id: seriesId, reference: ref(6) });
        expect(history.body.map(e => e.event_type)).toEqual(['FOLLOW_UP_RESOLVED', 'FOLLOW_UP']);
        expect(history.body[0].actor_name).toBe('Monitor Test');
        expect((await request(app).post(`${base}/follow-up`).send({ ...body, reference: ref(2) })).status).toBe(409);
        expect((await request(app).post(`${base}/follow-up`).send({ ...body, reference: ref(99) })).status).toBe(400);
    });
    test('legacy reconciliation preserves financial values and adds ownership/audit/version', async () => {
        const res = await request(app).post(`${base}/reconcile`).send(payload(legacy, 5)); expect(res.status).toBe(201);
        const updated = (await db.query('SELECT * FROM invoice WHERE invoice_id=$1', [legacy.invoice_id])).rows[0];
        expect(updated.physical_receipt_no).toBe(ref(5)); expect(updated.total_amount).toBe(legacy.total_amount);
        expect(updated.amount_paid).toBe(legacy.amount_paid); expect(updated.status).toBe(legacy.status);
        expect(updated.physical_receipt_version).toBe(legacy.physical_receipt_version + 1);
        const event = (await db.query("SELECT * FROM physical_document_event WHERE registry_id=$1 AND event_type='LEGACY_RECONCILED'", [res.body.registry_id])).rows[0];
        expect(event.actor_id).toBe(employeeId); expect(event.reason).toBe('Verified against original paper');
        expect((await request(app).post(`${base}/reconcile`).send(payload(legacy, 5))).status).toBe(409);
    });
    test('blank legacy transaction can be explicitly verified; duplicate concurrent claims have one winner', async () => {
        const other = await invoice();
        const results = await Promise.all([request(app).post(`${base}/reconcile`).send(payload(unassigned, 7)), request(app).post(`${base}/reconcile`).send(payload(other, 7))]);
        expect(results.map(r => r.status).sort()).toEqual([201, 409]);
        expect((await db.query('SELECT COUNT(*) FROM physical_document_registry WHERE series_id=$1 AND serial_number=7', [seriesId])).rows[0].count).toBe('1');
    });
    test('refuses unverified, mismatched, cancelled, Notebook and duplicate legacy owners', async () => {
        const wrong = await invoice(ref(8));
        expect((await request(app).post(`${base}/reconcile`).send(payload(wrong, 9))).status).toBe(409);
        expect((await request(app).post(`${base}/reconcile`).send(payload(wrong, 8, { verified: false }))).status).toBe(400);
        await db.query('INSERT INTO customer_payment (customer_id,employee_id,amount,physical_receipt_no) VALUES ($1,$2,10,$3)', [customerId, employeeId, ref(8)]);
        expect((await request(app).post(`${base}/reconcile`).send(payload(wrong, 8))).status).toBe(409);
        const cancelled = await invoice(ref(10)); await db.query("UPDATE invoice SET status='Cancelled' WHERE invoice_id=$1", [cancelled.invoice_id]);
        expect((await request(app).post(`${base}/reconcile`).send(payload(cancelled, 10))).status).toBe(409);
        const notebook = await invoice(); await db.query("UPDATE invoice SET recording_method='NOTEBOOK' WHERE invoice_id=$1", [notebook.invoice_id]);
        expect((await request(app).post(`${base}/reconcile`).send(payload(notebook, 11))).status).toBe(409);
    });
    test('requires settings and separate transaction permissions', async () => {
        mockUser = { employee_id: employeeId, permission_level_id: 1, permissions: [] };
        expect((await query()).status).toBe(403);
        mockUser.permissions = ['settings:edit']; expect((await query()).status).toBe(200);
        expect((await request(app).get(`${base}/transaction`).query({ source_type: 'INVOICE', source_id: legacy.invoice_id })).status).toBe(403);
        expect((await request(app).post(`${base}/reconcile`).send(payload(unassigned, 12))).status).toBe(403);
        mockUser.permissions.push('invoicing:create');
        const res = await request(app).get(`${base}/transaction`).query({ source_type: 'INVOICE', source_id: legacy.invoice_id });
        expect(res.status).toBe(200); expect(res.body.customer_name).toContain('Monitor'); expect(res.body.employee_id).toBeUndefined();
        mockUser = { employee_id: employeeId, permission_level_id: 10, permissions: [] };
    });
    test('spoilage validates bounds and prefix, recognizes normalized legacy and serializes with follow-up', async () => {
        const body = { series_id: seriesId, physical_receipt_no: ref(13), reason: 'Paper damaged' };
        expect((await request(app).post('/api/settings/physical-document-spoilage').send({ ...body, physical_receipt_no: 'WRONG-13' })).status).toBe(400);
        expect((await request(app).post('/api/settings/physical-document-spoilage').send({ ...body, physical_receipt_no: ref(61) })).status).toBe(400);
        await invoice(`${prefix} 00014`);
        expect((await request(app).post('/api/settings/physical-document-spoilage').send({ ...body, physical_receipt_no: ref(14) })).status).toBe(409);
        expect((await request(app).post('/api/settings/physical-document-spoilage').send(body)).status).toBe(201);
        expect((await request(app).post(`${base}/follow-up`).send({ series_id: seriesId, reference: ref(13), reason: 'Investigate this paper' })).status).toBe(409);
    });
    test('huge range uses exact serials and sparse gap pagination', async () => {
        const high = '9007199254740993';
        const huge = (await db.query(`INSERT INTO physical_document_series (type_id,code,name,prefix,min_serial,max_serial)
            VALUES ($1,$2,'Huge','HUGE',1,$3) RETURNING *`, [typeId, `${prefix}H`, high])).rows[0];
        const res = await query({ series_id: huge.series_id, status: 'NO_RECORD', page: '360287970189640' });
        expect(res.status).toBe(200); expect(res.body.total).toBe(high); expect(res.body.items.at(-1).reference).toBe(`HUGE-${high}`);
        expect(res.body.items).toHaveLength(18);
        await db.query('UPDATE physical_document_series SET min_serial=NULL, max_serial=NULL WHERE series_id=$1', [huge.series_id]);
        expect((await query({ series_id: huge.series_id })).body.needs_bounds).toBe(true);
        expect(monitor.parse(`HUGE-${high}`).serial).toBe(high);
    });
    test('ordinary occupancy checks also block normalized legacy references', async () => {
        const physical = require('../services/physicalDocumentService');
        await invoice(`${prefix} / 00016`);
        const occupied = await physical.isReferenceOccupied(db, seriesId, ref(16));
        expect(occupied.occupied).toBe(true);
    });
    test('follow-up stays open after issuance until explicitly resolved', async () => {
        const body = { series_id: seriesId, reference: ref(17), reason: 'Investigate missing paper' };
        expect((await request(app).post(`${base}/follow-up`).send(body)).status).toBe(201);
        const record = await invoice();
        expect((await request(app).post(`${base}/reconcile`).send(payload(record, 17))).status).toBe(201);
        const row = (await query()).body.items.find(r => r.reference === ref(17));
        expect(row.status).toBe('ISSUED'); expect(row.follow_up_id).toBeTruthy();
        expect((await request(app).post(`${base}/follow-up`).send({ ...body, resolve: true, expected_event_id: row.follow_up_id })).status).toBe(201);
    });
    test('unoccupied history remains visible after spoilage correction', async () => {
        const spoiled = await request(app).post('/api/settings/physical-document-spoilage').send({ series_id: seriesId, physical_receipt_no: ref(18), reason: 'Damaged paper' });
        expect(spoiled.status).toBe(201);
        expect((await request(app).post(`/api/settings/physical-document-spoilage/${spoiled.body.registry_id}/correct`).send({ reason: 'Recorded spoilage in error', expected_version: spoiled.body.version })).status).toBe(200);
        const row = (await query()).body.items.find(r => r.reference === ref(18)); expect(row.status).toBe('NO_RECORD');
        const history = await request(app).get(`${base}/history`).query({ series_id: seriesId, reference: ref(18) });
        expect(history.body.map(e => e.event_type)).toEqual(['SPOILAGE_CORRECTED', 'SPOILED']);
    });
    test('legacy cancellation is voided and competing spoilage/linking has one winner', async () => {
        const cancelled = await invoice(ref(19));
        await db.query("UPDATE invoice SET status='Cancelled' WHERE invoice_id=$1", [cancelled.invoice_id]);
        expect((await query()).body.items.find(r => r.reference === ref(19)).status).toBe('VOIDED');
        const record = await invoice();
        const results = await Promise.all([
            request(app).post(`${base}/reconcile`).send(payload(record, 20)),
            request(app).post('/api/settings/physical-document-spoilage').send({ series_id: seriesId, physical_receipt_no: ref(20), reason: 'Damaged paper' }),
        ]);
        expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    });
    test('payment and collection-group reconciliation retain financial values and group ownership', async () => {
        const collectionType = (await db.query(`INSERT INTO physical_document_type (code,name,short_label,controlled_category,tax_designation,is_active)
            VALUES ($1,'Collections','COL','COLLECTION_RECEIPT','NOT_APPLICABLE',true) RETURNING type_id`, [`${prefix}C`])).rows[0].type_id;
        const collectionPrefix = `${prefix}C`;
        const collectionSeries = (await db.query(`INSERT INTO physical_document_series (type_id,code,name,prefix,min_serial,max_serial)
            VALUES ($1,$2,'Collections',$2,1,50) RETURNING series_id`, [collectionType, collectionPrefix])).rows[0].series_id;
        await db.query("INSERT INTO physical_document_series_context (series_id,context) VALUES ($1,'COLLECTION')", [collectionSeries]);
        const payment = (await db.query(`INSERT INTO customer_payment (customer_id,employee_id,amount,recording_method)
            VALUES ($1,$2,55,'PAPER') RETURNING *`, [customerId, employeeId])).rows[0];
        const paymentBody = { ...payload(payment, 1), series_id: collectionSeries, reference: `${collectionPrefix}-1`, source_type: 'CUSTOMER_PAYMENT', source_id: payment.payment_id };
        const linked = await request(app).post(`${base}/reconcile`).send(paymentBody); expect(linked.status).toBe(201);
        const updated = (await db.query('SELECT * FROM customer_payment WHERE payment_id=$1', [payment.payment_id])).rows[0];
        expect(updated.amount).toBe(payment.amount); expect(updated.physical_document_registry_id).toBe(linked.body.registry_id);
        const group = (await db.query(`INSERT INTO customer_payment_collection_group (group_reference,customer_id,created_by,total_amount,physical_receipt_no)
            VALUES ($1,$2,$3,75,$4) RETURNING *`, [`GROUP-${stamp}`, customerId, employeeId, `${collectionPrefix}-2`])).rows[0];
        const member = (await db.query(`INSERT INTO customer_payment (customer_id,employee_id,amount,collection_group_id,physical_receipt_no)
            VALUES ($1,$2,75,$3,$4) RETURNING *`, [customerId, employeeId, group.group_id, `${collectionPrefix}-2`])).rows[0];
        const grouped = await request(app).post(`${base}/reconcile`).send({ ...payload(group, 2), series_id: collectionSeries,
            reference: `${collectionPrefix}-2`, source_type: 'COLLECTION_GROUP', source_id: group.group_id });
        expect(grouped.status).toBe(201);
        const updatedMember = (await db.query('SELECT * FROM customer_payment WHERE payment_id=$1', [member.payment_id])).rows[0];
        expect(updatedMember.amount).toBe(member.amount); expect(updatedMember.physical_document_registry_id).toBe(grouped.body.registry_id);
        const sources = (await query({ series_id: collectionSeries })).body.items[1].sources;
        expect(sources).toHaveLength(1); expect(sources[0].type).toBe('COLLECTION_GROUP');
        const groupSummary = await request(app).get(`${base}/transaction`).query({ source_type: 'COLLECTION_GROUP', source_id: group.group_id });
        expect(groupSummary.status).toBe(200); expect(groupSummary.body.amount).toBe('75.00');
        expect((await request(app).post(`${base}/reconcile`).send({ ...paymentBody, source_id: member.payment_id,
            expected_reference: updatedMember.physical_receipt_no, expected_registry_id: updatedMember.physical_document_registry_id })).status).toBe(409);
    });
    test('standalone spoilage remains available for series without bounds', async () => {
        const unbounded = (await db.query(`INSERT INTO physical_document_series (type_id,code,name,prefix)
            VALUES ($1,$2,'Unbounded','NOBND') RETURNING series_id`, [typeId, `${prefix}U`])).rows[0].series_id;
        const res = await request(app).post('/api/settings/physical-document-spoilage').send({ series_id: unbounded, physical_receipt_no: 'NOBND-123', reason: 'Damaged unbounded booklet' });
        expect(res.status).toBe(201); expect(res.body.canonical_full_reference).toBe('NOBND-123');
        expect((await query({ series_id: unbounded })).body.needs_bounds).toBe(true);
    });
    test('overlapping series prevent reconciliation', async () => {
        const record = await invoice(ref(15));
        await db.query(`INSERT INTO physical_document_series (type_id,code,name,prefix,min_serial,max_serial)
            VALUES ($1,$2,'Overlap',$3,1,60)`, [typeId, `${prefix}O`, prefix]);
        expect((await request(app).post(`${base}/reconcile`).send(payload(record, 15))).status).toBe(409);
    });
});
