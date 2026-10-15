'use strict';

const express = require('express');
const db = require('../db');
const {
  protect,
  hasPermission
} = require('../middleware/authMiddleware');
const recovery = require('../services/hr/employeeRecoveryService');
const loans = require('../services/hr/employeeLoanService');
const router = express.Router();
const settlements = require('../services/hr/employeeSettlementService');
const remittances = require('../services/hr/loanRemittanceService');
const corrections = require('../services/hr/employeeFinanceCorrectionService');
const accounts = require('../services/hr/employeeAccountsService');
const error = (res, e) => {
  const status = e.status || (['23505', '23514', '40001', '40P01'].includes(e.code) ? 409 : ['23503', '22003'].includes(e.code) ? 422 : ['22P02', '22007', '22008'].includes(e.code) ? 400 : 500);
  if (status === 500) console.error('Employee finance:', e);
  return res.status(status).json({
    code: e.code || 'FINANCE_ERROR',
    message: status === 500 ? 'Employee finance operation failed.' : e.message
  });
};
const write = (operation, fn) => async (req, res) => {
  const c = await db.getClient();
  try {
    await c.query('BEGIN');
    const result = await recovery.request(c, {
      requestId: req.body.request_id,
      actorId: req.user.employee_id,
      operation: `${operation}:${req.params.id || ''}`,
      payload: req.body
    }, () => fn(c, req));
    await c.query('COMMIT');
    res.status(result.replay ? 200 : 201).json(result);
  } catch (e) {
    await c.query('ROLLBACK');
    error(res, e);
  } finally {
    c.release();
  }
};
router.post('/hr/employees/:id/loans', protect, hasPermission('employee_finance:manage'), write('loan-create', (c, r) => loans.create(c, {
  ...r.body,
  employee_id: r.params.id
}, r.user)));
router.get('/hr/employees/:id/loans', protect, hasPermission('employee_finance:view'), async (req, res) => {
  try {
    const {
      rows
    } = await db.query(`SELECT l.*,(l.principal_amount-l.amount_paid)::numeric(12,2) outstanding,
 COALESCE((SELECT json_agg(to_jsonb(s)||jsonb_build_object('monthly_installment',s.monthly_installment::text) ORDER BY s.effective_from) FROM employee_loan_schedule s WHERE s.loan_id=l.loan_id),'[]') schedules,
 COALESCE((SELECT json_agg(a ORDER BY a.activity_id) FROM employee_loan_activity a WHERE a.loan_id=l.loan_id),'[]') activity
 FROM employee_loan l WHERE employee_id=$1 ORDER BY loan_id DESC`, [req.params.id]);
    res.json(rows);
  } catch (e) {
    error(res, e);
  }
});
router.post('/hr/loans/:id/activate', protect, hasPermission('employee_finance:approve'), write('loan-activate', (c, r) => loans.activate(c, r.params.id, r.body, r.user)));
router.post('/hr/loans/:id/schedule-changes', protect, hasPermission('employee_finance:manage'), write('loan-schedule', (c, r) => loans.changeSchedule(c, r.params.id, r.body, r.user)));
for (const action of ['hold', 'resume']) router.post(`/hr/loans/:id/${action}`, protect, hasPermission('employee_finance:manage'), write(`loan-${action}`, (c, r) => loans.hold(c, r.params.id, r.body, r.user, action === 'resume')));
router.post('/hr/employee-collections', protect, hasPermission('employee_finance:collect'), write('employee-collection', (c, r) => loans.collect(c, r.body, r.user)));
router.get('/payroll/payslips/:id/recoveries', protect, hasPermission('payroll:view'), async (req, res) => {
  try {
    const {
      rows
    } = await db.query(`SELECT a.*,l.reference_no,l.creditor,l.loan_type,(l.principal_amount-l.amount_paid)::numeric(12,2) outstanding FROM payroll_deduction_allocation a JOIN employee_loan l USING(loan_id) WHERE a.payslip_id=$1 ORDER BY a.loan_id`, [req.params.id]);
    res.json(rows);
  } catch (e) {
    error(res, e);
  }
});
router.post('/payroll/payslips/:id/recovery-review', protect, hasPermission('payroll:approve'), write('recovery-review', (c, r) => recovery.review(c, r.params.id, r.body, r.user.employee_id)));
router.get('/hr/employee-finance/bank-accounts', protect, hasPermission('employee_finance:view'), async (req, res) => {
  try {
    res.json((await db.query("SELECT bank_account_id,account_name,bank_name FROM bank_account WHERE is_active AND currency='PHP' ORDER BY account_name")).rows);
  } catch (e) {
    error(res, e);
  }
});
router.post('/payroll/employee-settlements', protect, hasPermission('employee_finance:pay'), write('employee-settlement', (c, r) => settlements.settle(c, r.body, r.user)));
router.post('/payroll/payouts', protect, hasPermission('employee_finance:pay'), write('payroll-payout', (c, r) => settlements.payout(c, r.body, r.user)));
router.post('/payroll/payouts/:id/reconcile', protect, hasPermission('employee_finance:pay'), write('payout-reconcile', (c, r) => settlements.resolve(c, r.params.id, r.body, r.user)));
router.post('/payroll/payslips/:id/rounding-adjustments', protect, hasPermission('employee_finance:approve'), write('payroll-rounding', (c, r) => settlements.rounding(c, r.params.id, r.body, r.user)));
router.get('/hr/employees/:id/payables', protect, hasPermission('employee_finance:view'), async (req, res) => {
  try {
    res.json(await settlements.payable(db, req.params.id));
  } catch (e) {
    error(res, e);
  }
});
router.get('/hr/employees/:id/payouts', protect, hasPermission('employee_finance:view'), async (req, res) => {
  try {
    res.json((await db.query(`SELECT p.*,COALESCE((SELECT json_agg(to_jsonb(a)||jsonb_build_object('amount',a.amount::text)) FROM payroll_payout_allocation a WHERE a.payout_id=p.payout_id),'[]') allocations,(SELECT json_agg(e ORDER BY e.event_id) FROM payroll_payout_event e WHERE e.payout_id=p.payout_id) events FROM payroll_payout_current p WHERE employee_id=$1 ORDER BY payout_id DESC`, [req.params.id])).rows);
  } catch (e) {
    error(res, e);
  }
});
for (const [suffix, fn] of [['accounts', accounts.summary], ['account-statement', accounts.statement]]) router.get(`/hr/employees/:id/${suffix}`, protect, hasPermission('employee_finance:view'), async (req, res) => {
  const c = await db.getClient();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await accounts.exists(c, req.params.id);
    const result = await fn(c, req.params.id, req.query);
    await c.query('COMMIT');
    res.json(result);
  } catch (e) {
    await c.query('ROLLBACK');
    error(res, e);
  } finally {
    c.release();
  }
});
router.get('/hr/employee-finance/requests/:id', protect, hasPermission('employee_finance:view'), async (req, res) => {
  try {
    const {
      rows: [row]
    } = await db.query('SELECT request_id,operation,result,created_at FROM employee_finance_request WHERE request_id=$1 AND actor_id=$2', [req.params.id, req.user.employee_id]);
    if (!row) return res.status(404).json({
      message: 'Request not recorded; retry the same identity.'
    });
    res.json(row);
  } catch (e) {
    error(res, e);
  }
});
router.get('/hr/employee-finance/employees', protect, hasPermission('employee_finance:view'), async (req, res) => {
  try {
    const {
      parsePaginationQuery,
      paginatedResponse
    } = require('../helpers/pagination');
    const {
      page,
      pageSize,
      limit,
      offset
    } = parsePaginationQuery(req.query);
    const search = `%${String(req.query.search || '').slice(0, 100)}%`;
    const where = "WHERE concat_ws(' ',employee_code,first_name,last_name) ILIKE $1";
    const {
      rows
    } = await db.query(`SELECT employee_id,employee_code,concat_ws(' ',first_name,last_name) employee_name,employment_status FROM employee ${where} ORDER BY last_name,first_name,employee_id LIMIT $2 OFFSET $3`, [search, limit, offset]);
    const {
      rows: [count]
    } = await db.query(`SELECT COUNT(*)::int total FROM employee ${where}`, [search]);
    res.json(paginatedResponse({
      data: rows,
      page,
      pageSize,
      total: count.total
    }));
  } catch (e) {
    error(res, e);
  }
});
const sourceQueries = {
  RECOVERY_CORRECTION: "SELECT c.* FROM payroll_recovery_correction c JOIN payroll_payslip p USING(payslip_id) WHERE correction_id=$1 AND p.employee_id=$2",
  PAYOUT_RETURN: "SELECT c.* FROM payroll_payout_return c JOIN payroll_payout_allocation a USING(payout_allocation_id) JOIN payroll_payslip p USING(payslip_id) WHERE return_id=$1 AND p.employee_id=$2",
  LOAN: "SELECT l.* FROM employee_loan l WHERE loan_id=$1 AND employee_id=$2",
  LOAN_PAYMENT: "SELECT ep.*,l.reference_no,l.creditor,l.version loan_version,r.version run_version FROM employee_loan_payment ep JOIN employee_loan l USING(loan_id) LEFT JOIN payroll_payslip p ON p.payslip_id=ep.payslip_id LEFT JOIN payroll_run r ON r.run_id=p.run_id WHERE payment_id=$1 AND l.employee_id=$2",
  PAYSLIP: "SELECT p.*,r.run_no,r.status FROM payroll_payslip p JOIN payroll_run r USING(run_id) WHERE p.payslip_id=$1 AND p.employee_id=$2",
  LEGACY_SETTLEMENT: "SELECT l.* FROM payroll_legacy_settlement l JOIN payroll_payslip p USING(payslip_id) WHERE l.payslip_id=$1 AND p.employee_id=$2",
  PAYOUT: "SELECT p.*,COALESCE((SELECT json_agg(json_build_object('payout_allocation_id',a.payout_allocation_id,'payslip_id',a.payslip_id,'amount',a.amount::text,'run_version',r.version)) FROM payroll_payout_allocation a JOIN payroll_payslip ps USING(payslip_id) JOIN payroll_run r USING(run_id) WHERE a.payout_id=p.payout_id),'[]') allocations,f.method funding_method,f.external_reference,f.occurred_at,f.evidence funding_evidence FROM payroll_payout_current p LEFT JOIN employee_finance_funding f USING(funding_id) WHERE payout_id=$1 AND employee_id=$2",
  ROUNDING: "SELECT a.* FROM payroll_rounding_adjustment a JOIN payroll_payslip p USING(payslip_id) WHERE adjustment_id=$1 AND p.employee_id=$2",
  ADVANCE: "SELECT a.* FROM cash_advance a WHERE advance_id=$1 AND employee_id=$2",
  ADVANCE_EVENT: "SELECT e.* FROM cash_advance_event e JOIN cash_advance a USING(advance_id) WHERE event_id=$1 AND a.employee_id=$2"
};
router.get('/hr/employees/:id/account-sources/:type/:sourceId', protect, hasPermission('employee_finance:view'), async (req, res) => {
  try {
    const sql = sourceQueries[req.params.type];
    if (!sql) return res.status(404).json({
      message: 'Source not found'
    });
    const {
      rows: [source]
    } = await db.query(sql, [req.params.sourceId, req.params.id]);
    if (!source) return res.status(404).json({
      message: 'Source not found'
    });
    res.json(source);
  } catch (e) {
    error(res, e);
  }
});
router.get('/hr/employees/:id/loan-withholdings', protect, hasPermission('employee_finance:view'), async (req, res) => {
  try {
    res.json({
      withholdings: await remittances.available(db, req.params.id),
      remittances: await remittances.list(db, req.params.id)
    });
  } catch (e) {
    error(res, e);
  }
});
router.post('/hr/loan-remittances', protect, hasPermission('employee_finance:remit'), write('loan-remittance', (c, r) => remittances.remit(c, r.body, r.user)));
router.post('/hr/loan-remittances/:id/reconcile', protect, hasPermission('employee_finance:remit'), write('remittance-reconcile', (c, r) => remittances.reconcile(c, r.params.id, r.body, r.user)));
router.post('/hr/loans/:id/agency-payments', protect, hasPermission('employee_finance:remit'), write('agency-direct-payment', (c, r) => remittances.directAgencyPayment(c, r.params.id, r.body, r.user)));
router.post('/hr/loan-remittances/:id/corrections', protect, hasPermission('employee_finance:correct'), write('remittance-return', (c, r) => corrections.returnRemittance(c, r.params.id, r.body, r.user)));
router.post('/payroll/recoveries/:id/reversals', protect, hasPermission('employee_finance:correct'), write('payroll-recovery-reversal', (c, r) => corrections.reverseRecovery(c, r.params.id, r.body, r.user)));
router.post('/payroll/payout-allocations/:id/returns', protect, hasPermission('employee_finance:correct'), write('payroll-payout-return', (c, r) => corrections.returnPayout(c, r.params.id, r.body, r.user)));
router.post('/hr/employee-collections/:id/refunds', protect, hasPermission('employee_finance:correct'), write('collection-refund', (c, r) => corrections.refundCollection(c, r.params.id, r.body, r.user)));
router.get('/hr/loan-remittances', protect, hasPermission('employee_finance:view'), async (req, res) => {
  try {
    res.json({
      withholdings: await remittances.available(db),
      remittances: await remittances.list(db)
    });
  } catch (e) {
    error(res, e);
  }
});
router.get('/hr/employee-finance/treasury-sources', protect, hasPermission('employee_finance:view'), async (req, res) => {
  try {
    const {
      rows
    } = await db.query(`SELECT * FROM (
 SELECT 'EXPENSE' source_type,e.expense_id::text source_id,e.reference_no reference,e.payee,e.amount,e.expense_date::text source_date FROM expense e WHERE NOT e.is_void AND e.payroll_run_id IS NULL AND NOT EXISTS(SELECT 1 FROM loan_remittance r WHERE r.treasury_expense_id=e.expense_id)
 UNION ALL SELECT 'AP_PAYMENT',p.payment_id::text,p.reference_number,'Supplier #'||p.supplier_id,p.amount,p.payment_date::date::text FROM ap_payment p WHERE p.pdc_status='CLEARED' AND NOT EXISTS(SELECT 1 FROM loan_remittance r WHERE r.treasury_ap_payment_id=p.payment_id)
 ) sources WHERE concat_ws(' ',source_id,reference,payee) ILIKE $1 ORDER BY source_date DESC,source_type,source_id LIMIT 50`, [`%${String(req.query.search || '').slice(0, 100)}%`]);
    res.json(rows);
  } catch (e) {
    error(res, e);
  }
});
module.exports = {
  router,
  write,
  error
};
