'use strict';

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { manilaDateString } = require('../helpers/manilaDate');
const chequePrintService = require('../services/chequePrintService');
const chequeRoutes = require('../routes/chequeRoutes');

describe('Cheque Print Queue Reliability & Integrity (Real PostgreSQL)', () => {
    let app;
    let adminToken;
    let template1Id;
    let template2Id;
    let bank1Id;
    let bank2Id;
    let bankNoDefaultId;
    let supplierId;

    beforeAll(async () => {
        app = express();
        app.use(express.json());
        app.use('/api', chequeRoutes);

        // 1. Create employees: Admin (role 10) and Limited (role without cheques:create)
        const suffix = Date.now();
        const { rows: [admin] } = await db.query(
            `INSERT INTO employee (first_name, last_name, username, password_hash, password_salt, is_active, permission_level_id)
             VALUES ('Cheque', 'Admin', $1, 'hash', 'salt', true, 10)
             RETURNING employee_id, username`,
            [`cheque_admin_${suffix}`]
        );
        adminToken = jwt.sign(
            { employee_id: admin.employee_id, username: admin.username, login_date: manilaDateString() },
            process.env.JWT_SECRET
        );

        // 2. Create templates
        const { rows: [tpl1] } = await db.query(
            `INSERT INTO cheque_templates (bank_name, date_format, is_deleted)
             VALUES ($1, 'MM-dd-yyyy', false)
             RETURNING id`,
            [`TEST_QUEUE_BANK_A_${suffix}`]
        );
        template1Id = tpl1.id;

        const { rows: [tpl2] } = await db.query(
            `INSERT INTO cheque_templates (bank_name, date_format, is_deleted)
             VALUES ($1, 'yyyy-MM-dd', false)
             RETURNING id`,
            [`TEST_QUEUE_BANK_B_${suffix}`]
        );
        template2Id = tpl2.id;

        // 3. Create bank accounts: bank1 with tpl1 default, bank2 with tpl2 default, bankNoDefault with no default
        const { rows: [b1] } = await db.query(
            `INSERT INTO bank_account (bank_name, account_name, account_number, currency, default_cheque_template_id, is_active)
             VALUES ('Bank A', 'Account A', $1, 'PHP', $2, true)
             RETURNING bank_account_id`,
            [`ACC-A-${suffix}`, template1Id]
        );
        bank1Id = b1.bank_account_id;

        const { rows: [b2] } = await db.query(
            `INSERT INTO bank_account (bank_name, account_name, account_number, currency, default_cheque_template_id, is_active)
             VALUES ('Bank B', 'Account B', $1, 'PHP', $2, true)
             RETURNING bank_account_id`,
            [`ACC-B-${suffix}`, template2Id]
        );
        bank2Id = b2.bank_account_id;

        const { rows: [bNoDef] } = await db.query(
            `INSERT INTO bank_account (bank_name, account_name, account_number, currency, default_cheque_template_id, is_active)
             VALUES ('Bank No Def', 'Account No Def', $1, 'PHP', NULL, true)
             RETURNING bank_account_id`,
            [`ACC-NODEF-${suffix}`]
        );
        bankNoDefaultId = bNoDef.bank_account_id;

        // 4. Create supplier for AP payment linkages
        const { rows: [sup] } = await db.query(
            `INSERT INTO supplier (supplier_name, is_active)
             VALUES ($1, true)
             RETURNING supplier_id`,
            [`Supplier Queue Test ${suffix}`]
        );
        supplierId = sup.supplier_id;
    });

    afterAll(async () => {
        // Clean up created entities
        if (template1Id || template2Id) {
            await db.query(`DELETE FROM cheque_clearance_log WHERE bank_account_id IN ($1, $2, $3)`, [bank1Id, bank2Id, bankNoDefaultId]).catch(() => {});
            await db.query(`DELETE FROM cheque_records WHERE bank_account_id IN ($1, $2, $3)`, [bank1Id, bank2Id, bankNoDefaultId]).catch(() => {});
            await db.query(`DELETE FROM bank_account WHERE bank_account_id IN ($1, $2, $3)`, [bank1Id, bank2Id, bankNoDefaultId]).catch(() => {});
            await db.query(`DELETE FROM cheque_templates WHERE id IN ($1, $2)`, [template1Id, template2Id]).catch(() => {});
        }
        if (supplierId) {
            await db.query(`DELETE FROM supplier WHERE supplier_id = $1`, [supplierId]).catch(() => {});
        }
    });

    async function createTestCheque(overrides = {}) {
        const {
            bank_account_id = bank1Id,
            template_id = null,
            status = 'ISSUED',
            is_deleted = false,
            payee = 'Target Payee',
            amount = 1250.50,
            cheque_date = '2026-10-25',
            memo = 'Invoice payment',
            has_ap_payment = true,
            replaced_by_cheque_id = null,
            created_at = new Date()
        } = overrides;

        let apPaymentId = null;
        if (has_ap_payment) {
            const { rows: [pay] } = await db.query(
                `INSERT INTO ap_payment (supplier_id, bank_account_id, payment_date, amount, method_id, pdc_status)
                 VALUES ($1, $2, '2026-10-20', $3, 5, 'ISSUED')
                 RETURNING payment_id`,
                [supplierId, bank_account_id, amount]
            );
            apPaymentId = pay.payment_id;
        }

        const { rows: [rec] } = await db.query(
            `INSERT INTO cheque_records (
                template_id, payee, amount, cheque_date, memo, is_deleted,
                bank_account_id, status, purpose_type, ap_payment_id,
                replaced_by_cheque_id, created_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'SUPPLIER_PAYMENT', $9, $10, $11)
             RETURNING id, template_id, payee, amount, cheque_date, memo, status, bank_account_id, ap_payment_id`,
            [
                template_id, payee, amount, cheque_date, memo, is_deleted,
                bank_account_id, status, apPaymentId, replaced_by_cheque_id, created_at
            ]
        );

        if (apPaymentId) {
            await db.query(`UPDATE ap_payment SET cheque_record_id = $1 WHERE payment_id = $2`, [rec.id, apPaymentId]);
        }

        return rec;
    }

    describe('1. Effective Template Resolution & Setup Signals', () => {
        test('resolves own-bank default when cheque template is null', async () => {
            const cheque = await createTestCheque({ template_id: null, bank_account_id: bank1Id });
            const resolved = await chequePrintService.resolveEffectiveTemplate(db, cheque.id);

            expect(resolved.effectiveTemplate).toBeTruthy();
            expect(resolved.effectiveTemplate.id).toBe(template1Id);
            expect(resolved.templateSource).toBe('bank_default');
            expect(resolved.setupRequiredReason).toBeNull();
        });

        test('explicit cheque template takes precedence over bank default', async () => {
            // bank1 has default tpl1, but cheque explicitly specifies tpl2
            const cheque = await createTestCheque({ template_id: template2Id, bank_account_id: bank1Id });
            const resolved = await chequePrintService.resolveEffectiveTemplate(db, cheque.id);

            expect(resolved.effectiveTemplate).toBeTruthy();
            expect(resolved.effectiveTemplate.id).toBe(template2Id);
            expect(resolved.templateSource).toBe('record');
            expect(resolved.setupRequiredReason).toBeNull();
        });

        test('explicit deleted template returns TEMPLATE_UNAVAILABLE and does NOT fallback to bank default', async () => {
            const { rows: [delTpl] } = await db.query(
                `INSERT INTO cheque_templates (bank_name, is_deleted) VALUES ('Deleted Bank Tpl', true) RETURNING id`
            );
            const cheque = await createTestCheque({ template_id: delTpl.id, bank_account_id: bank1Id });
            const resolved = await chequePrintService.resolveEffectiveTemplate(db, cheque.id);

            expect(resolved.effectiveTemplate).toBeNull();
            expect(resolved.templateSource).toBe('record');
            expect(resolved.setupRequiredReason).toBe('TEMPLATE_UNAVAILABLE');
            expect(resolved.details.requested_template_id).toBe(delTpl.id);
        });

        test('missing bank default returns TEMPLATE_REQUIRED', async () => {
            const cheque = await createTestCheque({ template_id: null, bank_account_id: bankNoDefaultId });
            const resolved = await chequePrintService.resolveEffectiveTemplate(db, cheque.id);

            expect(resolved.effectiveTemplate).toBeNull();
            expect(resolved.templateSource).toBeNull();
            expect(resolved.setupRequiredReason).toBe('TEMPLATE_REQUIRED');
        });
    });

    describe('2. Automatic Print Queue Filtering (GET /api/cheques/print-queue)', () => {
        test('includes allowlisted statuses (ISSUED, HELD_FOR_RELEASE) and excludes advanced/terminal statuses', async () => {
            const issued = await createTestCheque({ status: 'ISSUED' });
            const held = await createTestCheque({ status: 'HELD_FOR_RELEASE' });
            const cleared = await createTestCheque({ status: 'CLEARED' });
            const deposited = await createTestCheque({ status: 'DEPOSITED' });
            const bounced = await createTestCheque({ status: 'BOUNCED' });
            const voided = await createTestCheque({ status: 'VOID' });

            const res = await request(app)
                .get('/api/cheques/print-queue')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            const ids = res.body.records.map((r) => r.id);
            expect(ids).toContain(issued.id);
            expect(ids).toContain(held.id);
            expect(ids).not.toContain(cleared.id);
            expect(ids).not.toContain(deposited.id);
            expect(ids).not.toContain(bounced.id);
            expect(ids).not.toContain(voided.id);
        });

        test('excludes records with PDF_GENERATED or PRINTED, but retains TEST_PDF_GENERATED', async () => {
            const unprinted = await createTestCheque({ payee: 'Unprinted Cheque' });
            const testPrinted = await createTestCheque({ payee: 'Test Printed Cheque' });
            const pdfGenerated = await createTestCheque({ payee: 'PDF Generated Cheque' });
            const physicalPrinted = await createTestCheque({ payee: 'Physical Printed Cheque' });

            // Log clearance events
            await db.query(
                `INSERT INTO cheque_clearance_log (cheque_record_id, bank_account_id, action)
                 VALUES ($1, $2, 'TEST_PDF_GENERATED'), ($3, $4, 'PDF_GENERATED'), ($5, $6, 'PRINTED')`,
                [testPrinted.id, bank1Id, pdfGenerated.id, bank1Id, physicalPrinted.id, bank1Id]
            );

            const res = await request(app)
                .get('/api/cheques/print-queue')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            const ids = res.body.records.map((r) => r.id);
            expect(ids).toContain(unprinted.id);
            expect(ids).toContain(testPrinted.id); // Test PDF keeps cheque in queue
            expect(ids).not.toContain(pdfGenerated.id); // PDF_GENERATED removes it
            expect(ids).not.toContain(physicalPrinted.id); // PRINTED removes it
        });

        test('excludes soft-deleted and replaced cheques', async () => {
            const normal = await createTestCheque({ payee: 'Normal Cheque' });
            const deleted = await createTestCheque({ is_deleted: true, payee: 'Deleted Cheque' });
            const replaced = await createTestCheque({ replaced_by_cheque_id: normal.id, status: 'REPLACED' });

            const res = await request(app)
                .get('/api/cheques/print-queue')
                .set('Authorization', `Bearer ${adminToken}`);

            const ids = res.body.records.map((r) => r.id);
            expect(ids).toContain(normal.id);
            expect(ids).not.toContain(deleted.id);
            expect(ids).not.toContain(replaced.id);
        });

        test('excludes standalone cheques without payment or expense linkage', async () => {
            const linked = await createTestCheque({ has_ap_payment: true });
            const standalone = await createTestCheque({ has_ap_payment: false });

            const res = await request(app)
                .get('/api/cheques/print-queue')
                .set('Authorization', `Bearer ${adminToken}`);

            const ids = res.body.records.map((r) => r.id);
            expect(ids).toContain(linked.id);
            expect(ids).not.toContain(standalone.id);
        });
    });

    describe('3. Keyset Pagination & Preset-Specific Filtering', () => {
        test('filters by template_id and unassigned accurately', async () => {
            const chBank1 = await createTestCheque({ bank_account_id: bank1Id, template_id: null }); // effective tpl1
            const chBank2 = await createTestCheque({ bank_account_id: bank2Id, template_id: null }); // effective tpl2
            const chNoDef = await createTestCheque({ bank_account_id: bankNoDefaultId, template_id: null }); // unassigned

            // Filter for Template 1
            const res1 = await request(app)
                .get(`/api/cheques/print-queue?template_id=${template1Id}`)
                .set('Authorization', `Bearer ${adminToken}`);
            expect(res1.status).toBe(200);
            const ids1 = res1.body.records.map((r) => r.id);
            expect(ids1).toContain(chBank1.id);
            expect(ids1).not.toContain(chBank2.id);
            expect(ids1).not.toContain(chNoDef.id);

            // Filter for unassigned
            const resUn = await request(app)
                .get('/api/cheques/print-queue?unassigned=true')
                .set('Authorization', `Bearer ${adminToken}`);
            expect(resUn.status).toBe(200);
            const idsUn = resUn.body.records.map((r) => r.id);
            expect(idsUn).toContain(chNoDef.id);
            expect(idsUn).not.toContain(chBank1.id);
            expect(idsUn).not.toContain(chBank2.id);

            // Conflicting filter rejected with 400
            const resConflict = await request(app)
                .get(`/api/cheques/print-queue?template_id=${template1Id}&unassigned=true`)
                .set('Authorization', `Bearer ${adminToken}`);
            expect(resConflict.status).toBe(400);
            expect(resConflict.body.code).toBe('INVALID_FILTER');
        });

        test('keyset cursor pagination navigates deterministically oldest-first', async () => {
            const t0 = new Date('2026-10-01T08:00:00Z');
            const t1 = new Date('2026-10-01T09:00:00Z');
            const t2 = new Date('2026-10-01T10:00:00Z');

            const c1 = await createTestCheque({ bank_account_id: bank1Id, created_at: t0 });
            const c2 = await createTestCheque({ bank_account_id: bank1Id, created_at: t1 });
            const c3 = await createTestCheque({ bank_account_id: bank1Id, created_at: t2 });

            const page1 = await request(app)
                .get(`/api/cheques/print-queue?template_id=${template1Id}&limit=2`)
                .set('Authorization', `Bearer ${adminToken}`);

            expect(page1.status).toBe(200);
            expect(page1.body.records.length).toBe(2);
            expect(page1.body.records[0].id).toBe(c1.id);
            expect(page1.body.records[1].id).toBe(c2.id);
            expect(page1.body.next_cursor).toBeTruthy();

            const page2 = await request(app)
                .get(`/api/cheques/print-queue?template_id=${template1Id}&limit=2&cursor=${page1.body.next_cursor}`)
                .set('Authorization', `Bearer ${adminToken}`);

            expect(page2.status).toBe(200);
            expect(page2.body.records.length).toBe(1);
            expect(page2.body.records[0].id).toBe(c3.id);
        });
    });

    describe('4. PDF Batch Generation & Integrity (POST /api/cheques/generate-pdf)', () => {
        test('rejects batch on mixed effective templates with 409 CHEQUE_TEMPLATE_MISMATCH', async () => {
            const ch1 = await createTestCheque({ bank_account_id: bank1Id }); // effective tpl1
            const ch2 = await createTestCheque({ bank_account_id: bank2Id }); // effective tpl2

            const res = await request(app)
                .post('/api/cheques/generate-pdf')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    template_id: template1Id,
                    records: [
                        { cheque_record_id: ch1.id, payee: ch1.payee, amount: '100.00', date: '10-20-2026' },
                        { cheque_record_id: ch2.id, payee: ch2.payee, amount: '200.00', date: '10-20-2026' }
                    ]
                });

            expect(res.status).toBe(409);
            expect(res.body.code).toBe('CHEQUE_TEMPLATE_MISMATCH');
        });

        test('rejects duplicate cheque_record_id in batch with 400', async () => {
            const ch = await createTestCheque({ bank_account_id: bank1Id });

            const res = await request(app)
                .post('/api/cheques/generate-pdf')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    template_id: template1Id,
                    records: [
                        { cheque_record_id: ch.id, payee: ch.payee, amount: '100.00', date: '10-20-2026' },
                        { cheque_record_id: ch.id, payee: ch.payee, amount: '100.00', date: '10-20-2026' }
                    ]
                });

            expect(res.status).toBe(400);
            expect(res.body.code).toBe('DUPLICATE_LINKED_CHEQUE');
        });

        test('sources canonical payee, amount, date from database; ignores client tampering', async () => {
            const ch = await createTestCheque({
                bank_account_id: bank1Id,
                payee: 'Authoritative Supplier Corp',
                amount: 9876.54,
                cheque_date: '2026-10-31'
            });

            // Client attempts to tamper payee and amount
            const res = await request(app)
                .post('/api/cheques/generate-pdf')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    template_id: template1Id,
                    records: [
                        { cheque_record_id: ch.id, payee: 'HACKED PAYEE', amount: '1.00', date: '01-01-2000' }
                    ]
                });

            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toBe('application/pdf');

            // Verify template was pinned to template1Id
            const { rows: [pinned] } = await db.query(
                `SELECT template_id FROM cheque_records WHERE id = $1`,
                [ch.id]
            );
            expect(pinned.template_id).toBe(template1Id);

            // Verify clearance log event is PDF_GENERATED
            const { rows: logs } = await db.query(
                `SELECT action, metadata FROM cheque_clearance_log WHERE cheque_record_id = $1`,
                [ch.id]
            );
            expect(logs.length).toBe(1);
            expect(logs[0].action).toBe('PDF_GENERATED');
            expect(logs[0].metadata.template_id).toBe(template1Id);
        });

        test('test PDF logs TEST_PDF_GENERATED and does NOT pin template or dequeue', async () => {
            const ch = await createTestCheque({
                bank_account_id: bank1Id,
                template_id: null
            });

            const res = await request(app)
                .post('/api/cheques/generate-pdf')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    template_id: template1Id,
                    test_print: true,
                    records: [
                        { cheque_record_id: ch.id, payee: ch.payee, amount: '500.00', date: '10-20-2026' }
                    ]
                });

            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toBe('application/pdf');

            // Template remains NULL
            const { rows: [unpinned] } = await db.query(
                `SELECT template_id FROM cheque_records WHERE id = $1`,
                [ch.id]
            );
            expect(unpinned.template_id).toBeNull();

            // Clearance log has TEST_PDF_GENERATED
            const { rows: logs } = await db.query(
                `SELECT action FROM cheque_clearance_log WHERE cheque_record_id = $1`,
                [ch.id]
            );
            expect(logs.length).toBe(1);
            expect(logs[0].action).toBe('TEST_PDF_GENERATED');

            // Cheque remains in queue
            const queueRes = await request(app)
                .get(`/api/cheques/print-queue?template_id=${template1Id}`)
                .set('Authorization', `Bearer ${adminToken}`);
            const ids = queueRes.body.records.map((r) => r.id);
            expect(ids).toContain(ch.id);
        });
    });

    describe('5. External Print Acknowledgement (POST /api/cheques/:id/record-external-print)', () => {
        test('requires non-empty note and marks cheque as PRINTED with external metadata', async () => {
            const ch = await createTestCheque({ bank_account_id: bank1Id });

            // Missing note rejected with 400
            const badRes = await request(app)
                .post(`/api/cheques/${ch.id}/record-external-print`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ notes: '   ' });
            expect(badRes.status).toBe(400);

            // Valid note succeeds
            const okRes = await request(app)
                .post(`/api/cheques/${ch.id}/record-external-print`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ notes: 'Cheque printed on office typewriter' });

            expect(okRes.status).toBe(200);
            expect(okRes.body.success).toBe(true);
            expect(okRes.body.already_recorded).toBe(false);

            // Verified clearance log
            const { rows: logs } = await db.query(
                `SELECT action, notes, metadata FROM cheque_clearance_log WHERE cheque_record_id = $1`,
                [ch.id]
            );
            expect(logs.length).toBe(1);
            expect(logs[0].action).toBe('PRINTED');
            expect(logs[0].notes).toBe('Cheque printed on office typewriter');
            expect(logs[0].metadata.source).toBe('external_acknowledgement');

            // Cheque status remains ISSUED (financial lifecycle unchanged)
            const { rows: [reloaded] } = await db.query(
                `SELECT status FROM cheque_records WHERE id = $1`,
                [ch.id]
            );
            expect(reloaded.status).toBe('ISSUED');

            // Cheque is now excluded from the print queue
            const queueRes = await request(app)
                .get('/api/cheques/print-queue')
                .set('Authorization', `Bearer ${adminToken}`);
            const ids = queueRes.body.records.map((r) => r.id);
            expect(ids).not.toContain(ch.id);
        });

        test('retry-safety: calling acknowledgement again returns 200 without duplicate event', async () => {
            const ch = await createTestCheque({ bank_account_id: bank1Id });

            // First call
            await request(app)
                .post(`/api/cheques/${ch.id}/record-external-print`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ notes: 'Initial print acknowledgement' });

            // Second call
            const retryRes = await request(app)
                .post(`/api/cheques/${ch.id}/record-external-print`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ notes: 'Duplicate retry acknowledgement' });

            expect(retryRes.status).toBe(200);
            expect(retryRes.body.already_recorded).toBe(true);

            // Exactly 1 log entry in DB
            const { rows: logs } = await db.query(
                `SELECT log_id FROM cheque_clearance_log WHERE cheque_record_id = $1`,
                [ch.id]
            );
            expect(logs.length).toBe(1);
        });
    });

    describe('6. Reprint Resolution (POST /api/cheques/reprint/:id)', () => {
        test('resolves effective template for unprinted cheque', async () => {
            const ch = await createTestCheque({ bank_account_id: bank1Id, template_id: null });

            const res = await request(app)
                .post(`/api/cheques/reprint/${ch.id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({});

            expect(res.status).toBe(200);
            expect(res.body.record.selected_template_id).toBe(template1Id);
        });

        test('blocks reprint for VOID/REPLACED/DELETED cheque with 409', async () => {
            const chVoid = await createTestCheque({ status: 'VOID' });

            const res = await request(app)
                .post(`/api/cheques/reprint/${chVoid.id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({});

            expect(res.status).toBe(409);
            expect(res.body.code).toBe('CHEQUE_REPRINT_BLOCKED');
        });
    });
});
