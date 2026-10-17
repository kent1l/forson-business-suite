'use strict';

// Explicit opt-in; all fixtures roll back, and business databases are refused.
if (!/^codex_employee_finance_verify_[a-z0-9_]+$/.test(process.env.EMPLOYEE_FINANCE_TEST_DB || '')) {
    throw new Error('Select a disposable EMPLOYEE_FINANCE_TEST_DB.');
}
process.env.DB_NAME = process.env.EMPLOYEE_FINANCE_TEST_DB;
const db = require('../db');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const dtr = require('../services/hr/dtrService');
const runs = require('../services/hr/payrollRunService');
const integrity = require('../services/hr/payrollIntegrityService');

async function main() {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const tag = randomUUID();
        const { rows: [department] } = await client.query(
            'INSERT INTO department(department_name) VALUES($1) RETURNING department_id', [`Payroll accuracy ${tag}`]);
        const { rows: [schedule] } = await client.query('SELECT schedule_id FROM work_schedule ORDER BY schedule_id LIMIT 1');
        const { rows: [employee] } = await client.query(
            `INSERT INTO employee(first_name,last_name,username,password_hash,password_salt,permission_level_id,
                department_id,work_schedule_id,date_hired,is_payroll_eligible,worker_class)
             VALUES('Payroll','Accuracy',$1,'unused','unused',10,$2,$3,'2026-08-01',true,'EMPLOYEE') RETURNING employee_id`,
            [tag, department.department_id, schedule.schedule_id]);
        const id = employee.employee_id;
        await client.query(`INSERT INTO employee_compensation(employee_id,effective_date,pay_basis,base_rate)
            VALUES($1,'2026-08-01','daily',800)`, [id]);
        let { rows: [period] } = await client.query("SELECT pay_period_id FROM pay_period WHERE period_start='2026-08-16' AND period_end='2026-08-31' AND period_type='SEMI_MONTHLY'");
        if (!period) ({ rows: [period] } = await client.query(`INSERT INTO pay_period(period_year,period_month,period_seq,period_start,period_end,pay_date)
            VALUES(2026,8,2,'2026-08-16','2026-08-31','2026-08-31') RETURNING pay_period_id`));
        const { rows: [run] } = await client.query(
            `INSERT INTO payroll_run(run_no,run_type,pay_period_id,period_start,period_end,pay_date,department_id,created_by)
             VALUES($1,'REGULAR',$2,'2026-08-16','2026-08-31','2026-08-31',$3,$4) RETURNING run_id`,
            [`ACCURACY-${tag.slice(0, 20)}`, period.pay_period_id, department.department_id, id]);
        await dtr.generateForPeriod(client, { employeeIds: [id], periodStart: '2026-08-01', periodEnd: '2026-08-31', createdBy: id });
        const compute = async () => {
            await runs.computeRun(client, { runId: run.run_id, computedBy: id });
            const result = await integrity.assertRun(client, run.run_id, { requireCurrentComputation: true });
            return result.payslips[0];
        };
        let slip = await compute();
        assert.equal(Number(slip.holiday_pay), 800, 'eligible unworked regular holiday is persisted');
        await client.query('SAVEPOINT accuracy_tamper');
        await client.query(`UPDATE payroll_payslip_line SET amount=amount+.01
            WHERE payslip_id=$1 AND component_code='BASIC'`, [slip.payslip_id]);
        await assert.rejects(() => integrity.assertRun(client, run.run_id), /Earning lines/);
        await client.query('ROLLBACK TO SAVEPOINT accuracy_tamper');
        await client.query(`UPDATE daily_time_record SET day_type='Holiday Worked',day_fraction=1,hours_worked=8,overtime_hours=1
            WHERE employee_id=$1 AND work_date='2026-08-31'`, [id]);
        slip = await compute();
        assert.equal(Number(slip.holiday_pay), 800, 'holiday premium added on top of the daily base');
        assert.equal(Number(slip.overtime_pay), 260, 'holiday OT uses 2 × 1.3, not ordinary 1.25');
        await client.query(`UPDATE daily_time_record SET day_type='Holiday',day_fraction=0,hours_worked=0,overtime_hours=0
            WHERE employee_id=$1 AND work_date='2026-08-31'`, [id]);
        await client.query(`INSERT INTO employee_compensation(employee_id,effective_date,pay_basis,salary_model,base_rate,is_tardiness_exempt)
            VALUES($1,'2026-08-16','monthly','ATTENDANCE',30000,false)`, [id]);
        await client.query(`UPDATE daily_time_record SET day_type='Half Day',day_fraction=.5,late_minutes=120,undertime_minutes=120
            WHERE dtr_id=(SELECT dtr_id FROM daily_time_record WHERE employee_id=$1 AND work_date BETWEEN '2026-08-16' AND '2026-08-31'
                AND day_type='Present' ORDER BY work_date LIMIT 1)`, [id]);
        slip = await compute();
        const days = slip.computation_trace.contractDays;
        assert.equal(Number(slip.basic_pay), Math.round((15000 - 15000 / days / 2) * 100) / 100,
            'monthly half-day deduction is persisted; lateness/undertime stay paid');
        await client.query(`INSERT INTO employee_compensation(employee_id,effective_date,pay_basis,salary_model,base_rate)
            VALUES($1,'2026-08-20','monthly','ATTENDANCE',32000)`, [id]);
        await assert.rejects(() => compute(), /compensation changes inside/);
        console.log('PASS actual PostgreSQL: holiday eligibility, persisted premium components, holiday OT, monthly half-days, paid lateness/undertime, exact run/line reconciliation, split-rate guard. All fixtures rolled back.');
    } finally {
        await client.query('ROLLBACK');
        client.release();
    }
}
main().then(() => process.exit(0)).catch((error) => { console.error(error.stack); process.exit(1); });
