const db = require('../db');
const MasterDataMergeService = require('../services/masterDataMergeService');

async function revertFixture(observer, service, operationId, actorId) {
    await observer.query('BEGIN');
    try {
        await service.revertWithClient(observer, operationId, actorId, 'Concurrent test cleanup');
        await observer.query('DELETE FROM master_data_merge_operation WHERE operation_id = $1', [operationId]);
        await observer.query('COMMIT');
    } catch (error) {
        await observer.query('ROLLBACK');
        throw error;
    }
}

// This test needs committed migration triggers visible to two connections.
// Run it only against the disposable CI/test database, never a development DB.
describe('master-data merge concurrent child writer', () => {
    test('a purchase order waiting on the source lock is rejected after merge commit', async () => {
        if (!/^(test|.*_test)$/.test(process.env.DB_NAME || '')) {
            throw new Error('Concurrent merge test requires DB_NAME=test or a *_test database.');
        }
        const service = new MasterDataMergeService(db, 'supplier');
        const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
        const orderNumber = `CONCURRENT-${suffix}`;
        const { rows: [actor] } = await db.query(
            'INSERT INTO employee (first_name, last_name) VALUES ($1, $2) RETURNING employee_id',
            ['Merge', `Concurrency ${suffix}`]);
        const { rows: [keep] } = await db.query(
            'INSERT INTO supplier (supplier_name) VALUES ($1) RETURNING supplier_id', [`Concurrent keep ${suffix}`]);
        const { rows: [source] } = await db.query(
            'INSERT INTO supplier (supplier_name) VALUES ($1) RETURNING supplier_id', [`Concurrent source ${suffix}`]);
        const merge = await db.getClient();
        const writer = await db.getClient();
        const observer = await db.getClient();
        let operationId;
        let transactionOpen = false;
        try {
            await merge.query('BEGIN');
            transactionOpen = true;
            const request = { keepId: keep.supplier_id, mergeIds: [source.supplier_id] };
            const review = await service.review(merge, request, true);
            expect(review.blockers).toEqual([]);
            const { rows: [session] } = await writer.query('SELECT pg_backend_pid() AS pid');
            await writer.query("SET lock_timeout = '10s'");
            const attemptedWrite = writer.query(
                'INSERT INTO purchase_order (po_number, supplier_id, employee_id, total_amount) ' +
                'VALUES ($1, $2, $3, 0)', [orderNumber, source.supplier_id, actor.employee_id])
                .then(() => ({ accepted: true }), error => ({ accepted: false, error }));
            let blocked = false;
            for (let attempt = 0; attempt < 100; attempt++) {
                const { rows: [activity] } = await observer.query(
                    'SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1', [session.pid]);
                if (activity?.wait_event_type === 'Lock') { blocked = true; break; }
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            expect(blocked).toBe(true);
            const result = await service.executeWithClient(merge,
                { ...request, previewFingerprint: review.fingerprint }, actor.employee_id);
            operationId = result.operationId;
            await merge.query('COMMIT');
            transactionOpen = false;
            const outcome = await attemptedWrite;
            expect(outcome.accepted).toBe(false);
            expect(outcome.error.code).toBe('23514');
            const { rows: [orderCount] } = await observer.query(
                'SELECT COUNT(*)::int AS count FROM purchase_order WHERE po_number = $1', [orderNumber]);
            expect(orderCount.count).toBe(0);
            const { rows: [retired] } = await observer.query(
                'SELECT is_active, is_merged, merged_into_supplier_id FROM supplier WHERE supplier_id = $1',
                [source.supplier_id]);
            expect(retired).toEqual({ is_active: false, is_merged: true,
                merged_into_supplier_id: keep.supplier_id });
        } finally {
            try {
                if (transactionOpen) await merge.query('ROLLBACK');
                await observer.query('DELETE FROM purchase_order WHERE po_number = $1', [orderNumber]);
                if (operationId) await revertFixture(observer, service, operationId, actor.employee_id);
                await observer.query('DELETE FROM supplier_alias WHERE supplier_id = ANY($1::int[])',
                    [[keep.supplier_id, source.supplier_id]]);
                await observer.query('DELETE FROM supplier WHERE supplier_id = ANY($1::int[])',
                    [[keep.supplier_id, source.supplier_id]]);
                await observer.query('DELETE FROM employee WHERE employee_id = $1', [actor.employee_id]);
            } finally {
                merge.release();
                writer.release();
                observer.release();
            }
        }
    });
});
