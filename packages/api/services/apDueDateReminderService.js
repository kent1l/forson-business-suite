'use strict';

const cron = require('node-cron');
const db = require('../db');
const notifications = require('./notificationService');
const { manilaDateString } = require('../helpers/manilaDate');

let currentCronJob = null;

/**
 * Daily scan for supplier bills due today / overdue.
 *
 * Raises one summary notification per condition rather than one per bill: a
 * shop with forty overdue bills would otherwise bury every other alert in the
 * panel, and the row-level detail already exists on the AP page the
 * notification links to. The dedupe key is scoped to the Manila date so the
 * scan is idempotent within a day but still speaks up again tomorrow.
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

        const today = manilaDateString();

        if (dueTodayRows.length > 0) {
            await notifications.emitSafe({
                type: 'ap.bills_due_today',
                category: 'finance',
                severity: 'warning',
                title: `${dueTodayRows.length} supplier bill${dueTodayRows.length === 1 ? '' : 's'} due today`,
                body: summariseBills(dueTodayRows),
                linkPage: 'ap',
                requiredPermission: 'ap:view',
                dedupeKey: `ap.bills_due_today:${today}`,
            });
        }

        if (overdueRows.length > 0) {
            const total = overdueRows.reduce((sum, row) => sum + Number(row.balance || 0), 0);
            await notifications.emitSafe({
                type: 'ap.bills_overdue',
                category: 'finance',
                severity: 'critical',
                title: `${overdueRows.length} supplier bill${overdueRows.length === 1 ? '' : 's'} overdue`,
                body: `${formatAmount(total)} outstanding past due. ${summariseBills(overdueRows)}`,
                linkPage: 'ap',
                requiredPermission: 'ap:view',
                dedupeKey: `ap.bills_overdue:${today}`,
            });
        }

        return {
            dueToday: dueTodayRows.length,
            overdue: overdueRows.length,
        };
    } catch (err) {
        console.error('[ApDueDateReminderEngine] Error running reminder scan:', err.message);
    }
}

/** Names a few suppliers so the alert is actionable without opening the page. */
function summariseBills(rows) {
    const names = [...new Set(rows.map(r => r.supplier_name).filter(Boolean))];
    const shown = names.slice(0, 3).join(', ');
    return names.length > 3 ? `${shown} and ${names.length - 3} more.` : `${shown}.`;
}

function formatAmount(value) {
    return `₱${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
