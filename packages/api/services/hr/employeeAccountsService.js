'use strict';

const {
  parsePaginationQuery,
  paginatedResponse
} = require('../../helpers/pagination');
const {
  fail
} = require('./employeeRecoveryService');
const settlement = require('./employeeSettlementService');
// Each row has one canonical owner. Funding/allocation rows never invent another receipt.
const entries = `WITH entries AS (
 SELECT l.employee_id,CASE l.creditor WHEN 'COMPANY' THEN 'COMPANY' ELSE 'GOVERNMENT' END domain,'LOAN' source_type,l.loan_id::text source_id,l.created_at occurred_at,l.principal_amount::numeric(12,2) amount,COALESCE(l.reference_no,l.loan_type) description FROM employee_loan l WHERE l.activation_state<>'DRAFT'
 UNION ALL SELECT l.employee_id,CASE l.creditor WHEN 'COMPANY' THEN 'COMPANY' ELSE 'GOVERNMENT' END,'LOAN_PAYMENT',ep.payment_id::text,ep.occurred_at,(CASE WHEN ep.reversal_of IS NULL THEN -ep.amount ELSE ep.amount END)::numeric(12,2),CASE WHEN ep.reversal_of IS NULL THEN 'Loan recovery' ELSE 'Linked recovery correction' END FROM employee_loan_payment ep JOIN employee_loan l USING(loan_id)
 UNION ALL SELECT p.employee_id,'EMPLOYEE','PAYSLIP',p.payslip_id::text,COALESCE(r.approved_at,r.created_at),p.net_pay,'Approved net wage entitlement' FROM payroll_payslip p JOIN payroll_run r USING(run_id) WHERE r.status IN ('Approved','Paid','Posted')
 UNION ALL SELECT p.employee_id,'EMPLOYEE','LEGACY_SETTLEMENT',l.payslip_id::text,l.recorded_at,-l.asserted_net,l.provenance FROM payroll_legacy_settlement l JOIN payroll_payslip p USING(payslip_id)
 UNION ALL SELECT p.employee_id,'EMPLOYEE','PAYOUT',p.payout_id::text,f.occurred_at,-p.amount,'Actual confirmed wage payout' FROM payroll_payout_current p JOIN employee_finance_funding f USING(funding_id) WHERE p.status='CONFIRMED'
 UNION ALL SELECT p.employee_id,'EMPLOYEE','ROUNDING',a.adjustment_id::text,a.created_at,a.amount,'Employer-funded upward rounding: '||a.policy_version FROM payroll_rounding_adjustment a JOIN payroll_payslip p USING(payslip_id)
 UNION ALL SELECT p.employee_id,'EMPLOYEE','RECOVERY_CORRECTION',c.correction_id::text,c.created_at,c.amount,'Reversed recovery restored wages payable' FROM payroll_recovery_correction c JOIN payroll_payslip p USING(payslip_id)
 UNION ALL SELECT p.employee_id,'EMPLOYEE','PAYOUT_RETURN',r.return_id::text,f.occurred_at,r.amount,'Verified returned wages remain payable' FROM payroll_payout_return r JOIN payroll_payout_allocation a USING(payout_allocation_id) JOIN payroll_payslip p USING(payslip_id) JOIN employee_finance_funding f ON f.funding_id=r.return_funding_id
 UNION ALL SELECT a.employee_id,'ADVANCES','ADVANCE',a.advance_id::text,a.created_at,a.amount,a.purpose FROM cash_advance a
 UNION ALL SELECT a.employee_id,'ADVANCES','ADVANCE_EVENT',e.event_id::text,e.created_at,CASE WHEN e.kind IN ('CONSUMPTION','RETURN') THEN -e.amount ELSE 0 END,'Advance '||e.kind FROM cash_advance_event e JOIN cash_advance a USING(advance_id)
)`;
async function exists(client, id) {
  if (!(await client.query('SELECT 1 FROM employee WHERE employee_id=$1', [id])).rowCount) fail(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found.');
}
async function summary(client, id, query = {}) {
  await exists(client, id);
  const {
    rows: loans
  } = await client.query(`SELECT creditor,COALESCE(SUM(principal_amount-amount_paid),0)::numeric(14,2) outstanding,COUNT(*)::int count FROM employee_loan WHERE employee_id=$1 AND activation_state<>'DRAFT' GROUP BY creditor`, [id]);
  const {
    rows: [wages]
  } = await client.query(`SELECT COALESCE(SUM(net_pay+correction_amount+rounding_amount-actual_paid-legacy_asserted_paid),0)::numeric(14,2) unpaid_salary,COALESCE(SUM(pending_amount),0)::numeric(14,2) pending,COUNT(*) FILTER(WHERE legacy_provenance IS NOT NULL)::int legacy_assertions FROM payroll_employee_payable WHERE employee_id=$1`, [id]);
  const {
    rows: withheld
  } = await client.query(`SELECT l.creditor,COALESCE(SUM(CASE WHEN p.reversal_of IS NULL THEN p.amount ELSE -p.amount END),0)::numeric(14,2) withheld FROM employee_loan_payment p JOIN employee_loan l USING(loan_id) WHERE l.employee_id=$1 AND l.creditor<>'COMPANY' AND p.payslip_id IS NOT NULL GROUP BY l.creditor`, [id]);
  const {
    rows: advances
  } = await client.query(`SELECT a.*,(a.amount-COALESCE((SELECT SUM(e.amount) FROM cash_advance_event e WHERE e.advance_id=a.advance_id AND e.kind IN ('CONSUMPTION','RETURN')),0))::numeric(14,2) outstanding_custody FROM cash_advance a WHERE a.employee_id=$1 ORDER BY a.advance_id DESC`, [id]);
  return {
    employee_id: Number(id),
    as_of: new Date().toISOString(),
    partial: false,
    categories: {
      owed_to_company: loans.find(l => l.creditor === 'COMPANY') || {
        outstanding: '0.00',
        count: 0
      },
      owed_to_employee: wages,
      government_loans: {
        obligations: loans.filter(l => l.creditor !== 'COMPANY'),
        withheld,
        remittance_available: true,
        installments: await require('./loanRemittanceService').available(client, id)
      },
      business_advances: {
        records: advances,
        source: 'cash_advance'
      }
    },
    transactions: await statement(client, id, query),
    payables: await settlement.payable(client, id)
  };
}
async function statement(client, id, query = {}) {
  const {
    page,
    pageSize,
    offset,
    limit
  } = parsePaginationQuery(query);
  const domain = query.domain || null;
  if (domain && !['COMPANY', 'EMPLOYEE', 'GOVERNMENT', 'ADVANCES'].includes(domain)) fail(400, 'INVALID_DOMAIN', 'Choose one of the four account categories.');
  for (const key of ['from', 'to']) if (query[key] && !/^\d{4}-\d{2}-\d{2}$/.test(query[key])) fail(400, 'INVALID_DATE', 'Statement dates must use YYYY-MM-DD.');
  if (query.from && query.to && query.from > query.to) fail(400, 'INVALID_DATE_RANGE', 'From date must precede to date.');
  const params = [id, domain, query.from || null, query.to || null];
  const predicate = `employee_id=$1 AND ($2::text IS NULL OR domain=$2) AND ($3::date IS NULL OR occurred_at>=($3::date::timestamp AT TIME ZONE 'Asia/Manila')) AND ($4::date IS NULL OR occurred_at<(($4::date+1)::timestamp AT TIME ZONE 'Asia/Manila'))`;
  const {
    rows
  } = await client.query(`${entries} SELECT *,COUNT(*) OVER()::int total FROM entries WHERE ${predicate} ORDER BY occurred_at DESC,source_type,source_id LIMIT $5 OFFSET $6`, [...params, limit, offset]);
  const {
    rows: balances
  } = await client.query(`${entries} SELECT domain,COALESCE(SUM(amount) FILTER(WHERE $3::date IS NOT NULL AND occurred_at<($3::date::timestamp AT TIME ZONE 'Asia/Manila')),0)::numeric(14,2) opening,
 COALESCE(SUM(amount) FILTER(WHERE $4::date IS NULL OR occurred_at<(($4::date+1)::timestamp AT TIME ZONE 'Asia/Manila')),0)::numeric(14,2) closing FROM entries WHERE employee_id=$1 AND ($2::text IS NULL OR domain=$2) GROUP BY domain`, params);
  const {
    rows: [count]
  } = await client.query(`${entries} SELECT COUNT(*)::int total FROM entries WHERE ${predicate}`, params);
  return {
    ...paginatedResponse({
      data: rows,
      page,
      pageSize,
      total: count.total
    }),
    balances
  };
}
module.exports = {
  summary,
  statement,
  exists,
  entries
};
