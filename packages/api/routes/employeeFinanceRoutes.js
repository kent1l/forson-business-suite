'use strict';
const express=require('express');
const db=require('../db');
const {protect,hasPermission}=require('../middleware/authMiddleware');
const recovery=require('../services/hr/employeeRecoveryService');
const loans=require('../services/hr/employeeLoanService');
const router=express.Router();
const error=(res,e)=>{const status=e.status||(['23505','23514','40001','40P01'].includes(e.code)?409:e.code==='23503'?422:500);if(status===500)console.error('Employee finance:',e);return res.status(status).json({code:e.code||'FINANCE_ERROR',message:status===500?'Employee finance operation failed.':e.message});};
const write=(operation,fn)=>async(req,res)=>{
 const c=await db.getClient();try{await c.query('BEGIN');const result=await recovery.request(c,{requestId:req.body.request_id,actorId:req.user.employee_id,operation:`${operation}:${req.params.id||''}`,payload:req.body},()=>fn(c,req));await c.query('COMMIT');res.status(result.replay?200:201).json(result);}catch(e){await c.query('ROLLBACK');error(res,e);}finally{c.release();}
};
router.post('/hr/employees/:id/loans',protect,hasPermission('employee_finance:manage'),write('loan-create',(c,r)=>loans.create(c,{...r.body,employee_id:r.params.id},r.user)));
router.get('/hr/employees/:id/loans',protect,hasPermission('employee_finance:view'),async(req,res)=>{
 try {const {rows}=await db.query(`SELECT l.*,(l.principal_amount-l.amount_paid)::numeric(12,2) outstanding,
 COALESCE((SELECT json_agg(s ORDER BY s.effective_from) FROM employee_loan_schedule s WHERE s.loan_id=l.loan_id),'[]') schedules,
 COALESCE((SELECT json_agg(a ORDER BY a.activity_id) FROM employee_loan_activity a WHERE a.loan_id=l.loan_id),'[]') activity
 FROM employee_loan l WHERE employee_id=$1 ORDER BY loan_id DESC`,[req.params.id]);res.json(rows);}catch(e){error(res,e);}
});
router.post('/hr/loans/:id/activate',protect,hasPermission('employee_finance:approve'),write('loan-activate',(c,r)=>loans.activate(c,r.params.id,r.body,r.user)));
router.post('/hr/loans/:id/schedule-changes',protect,hasPermission('employee_finance:manage'),write('loan-schedule',(c,r)=>loans.changeSchedule(c,r.params.id,r.body,r.user)));
for(const action of ['hold','resume']) router.post(`/hr/loans/:id/${action}`,protect,hasPermission('employee_finance:manage'),write(`loan-${action}`,(c,r)=>loans.hold(c,r.params.id,r.body,r.user,action==='resume')));
router.post('/hr/employee-collections',protect,hasPermission('employee_finance:collect'),write('employee-collection',(c,r)=>loans.collect(c,r.body,r.user)));
router.get('/payroll/payslips/:id/recoveries',protect,hasPermission('payroll:view'),async(req,res)=>{
 try{const {rows}=await db.query(`SELECT a.*,l.reference_no,l.creditor,l.loan_type,(l.principal_amount-l.amount_paid)::numeric(12,2) outstanding FROM payroll_deduction_allocation a JOIN employee_loan l USING(loan_id) WHERE a.payslip_id=$1 ORDER BY a.loan_id`,[req.params.id]);res.json(rows);}catch(e){error(res,e);}
});
router.post('/payroll/payslips/:id/recovery-review',protect,hasPermission('payroll:approve'),write('recovery-review',(c,r)=>recovery.review(c,r.params.id,r.body,r.user.employee_id)));
router.get('/hr/employee-finance/bank-accounts',protect,hasPermission('employee_finance:view'),async(req,res)=>{try{res.json((await db.query("SELECT bank_account_id,account_name,bank_name FROM bank_account WHERE is_active AND currency='PHP' ORDER BY account_name")).rows);}catch(e){error(res,e);}});
module.exports={router,write,error};
