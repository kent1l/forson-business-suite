'use strict';

const cron = require('node-cron');
const db = require('../db');

let currentCronJob = null;

/**
 * Daily scan for supplier bills due today / overdue. Deliberately minimal, same
 * philosophy as pdcReminderService.js: logs a structured summary rather than
 * sending email/SMS — the AP monitoring page's in-app KPIs/aging view cover the
 * UI side from data they already load.
 */
async function runApDueDateReminderScan() {
    console.log('[ApDueDateReminderEngine] Starting daily AP due-date reminder scan...');
    try {
        const { rows: dueTodayRows } = await db.query(`
            SELECT sb.bill_id, sb.bill_number, sb.total_amount - sb.amount_paid AS balance, s.supplier_name
            FROM supplier_bill sb
            JOIN supplier s ON s.supplier_id = sb.supplier_id
            WHERE sb.status IN ('Unpaid', 'Partially Paid') AND COALESCE(sb.due_date, sb.bill_date) = CURRENT_DATE
        `);
        const { rows: overdueRows } = await db.query(`
            SELECT sb.bill_id, sb.bill_number, sb.total_amount - sb.amount_paid AS balance, s.supplier_name
            FROM supplier_bill sb
            JOIN supplier s ON s.supplier_id = sb.supplier_id
            WHERE sb.status IN ('Unpaid', 'Partially Paid') AND COALESCE(sb.due_date, sb.bill_date) < CURRENT_DATE
        `);

        console.log(`[ApDueDateReminderEngine] ${dueTodayRows.length} bill(s) due today, ${overdueRows.length} bill(s) overdue.`);

        return {
            dueToday: dueTodayRows.length,
            overdue: overdueRows.length,
        };
    } catch (err) {
        console.error('[ApDueDateReminderEngine] Error running reminder scan:', err.message);
    }
}

async function startApDueDateReminderEngine() {
    try {
        const { rows } = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'AP_DUE_DATE_REMINDER_SCHEDULE'");
        const schedule = (rows.length > 0 && rows[0].setting_value) ? rows[0].setting_value : '0 7 * * *';

        console.log(`[ApDueDateReminderEngine] Scheduling cron job with pattern: ${schedule}`);

        if (currentCronJob) currentCronJob.stop();
        currentCronJob = cron.schedule(schedule, () => { runApDueDateReminderScan(); });
    } catch (err) {
        console.error('[ApDueDateReminderEngine] Failed to start engine:', err.message);
    }
}

module.exports = { startApDueDateReminderEngine, runApDueDateReminderScan };
