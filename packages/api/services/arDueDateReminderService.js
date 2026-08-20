'use strict';

const cron = require('node-cron');
const db = require('../db');
const notifications = require('./notificationService');
const { manilaDateString } = require('../helpers/manilaDate');

let currentCronJob = null;

/**
 * Daily scan for customer invoices falling due today or already overdue — the
 * receivables mirror of apDueDateReminderService.
 *
 * Invoices with no due_date are on-the-spot sales rather than terms sales, so
 * they are excluded outright instead of being treated as due on their invoice
 * date (the AP side falls back to bill_date because a supplier bill without a
 * due date is still a payable; an invoice without one has already been settled
 * at the counter).
 */
async function runArDueDateReminderScan() {
    console.log('[ArDueDateReminderEngine] Starting daily A/R due-date reminder scan...');
    try {
        const OPEN_STATUSES = ['Unpaid', 'Partially Paid', 'Partially Refunded'];

        const { rows: dueTodayRows } = await db.query(`
            SELECT i.invoice_id, i.invoice_number,
                   i.total_amount - COALESCE(i.amount_paid, 0) AS balance,
                   c.customer_name
            FROM invoice i
            JOIN (
                SELECT customer_id,
                       COALESCE(
                           NULLIF(TRIM(BOTH FROM company_name), ''),
                           NULLIF(TRIM(BOTH FROM COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), '')
                       ) AS customer_name
                FROM customer
            ) c ON c.customer_id = i.customer_id
            WHERE i.status = ANY($1::text[])
              AND i.due_date IS NOT NULL
              AND (i.due_date AT TIME ZONE 'Asia/Manila')::date = $2::date
        `, [OPEN_STATUSES, manilaDateString()]);

        const { rows: overdueRows } = await db.query(`
            SELECT i.invoice_id, i.invoice_number,
                   i.total_amount - COALESCE(i.amount_paid, 0) AS balance,
                   c.customer_name
            FROM invoice i
            JOIN (
                SELECT customer_id,
                       COALESCE(
                           NULLIF(TRIM(BOTH FROM company_name), ''),
                           NULLIF(TRIM(BOTH FROM COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), '')
                       ) AS customer_name
                FROM customer
            ) c ON c.customer_id = i.customer_id
            WHERE i.status = ANY($1::text[])
              AND i.due_date IS NOT NULL
              AND (i.due_date AT TIME ZONE 'Asia/Manila')::date < $2::date
        `, [OPEN_STATUSES, manilaDateString()]);

        console.log(`[ArDueDateReminderEngine] ${dueTodayRows.length} invoice(s) due today, ${overdueRows.length} invoice(s) overdue.`);

        const today = manilaDateString();

        if (dueTodayRows.length > 0) {
            await notifications.emitSafe({
                type: 'ar.invoices_due_today',
                category: 'finance',
                severity: 'info',
                title: `${dueTodayRows.length} customer invoice${dueTodayRows.length === 1 ? '' : 's'} due today`,
                body: `${formatAmount(sumBalance(dueTodayRows))} falling due. ${summariseCustomers(dueTodayRows)}`,
                linkPage: 'ar',
                requiredPermission: 'ar:view',
                dedupeKey: `ar.invoices_due_today:${today}`,
            });
        }

        if (overdueRows.length > 0) {
            await notifications.emitSafe({
                type: 'ar.invoices_overdue',
                category: 'finance',
                severity: 'critical',
                title: `${overdueRows.length} customer invoice${overdueRows.length === 1 ? '' : 's'} overdue`,
                body: `${formatAmount(sumBalance(overdueRows))} past due. ${summariseCustomers(overdueRows)}`,
                linkPage: 'ar',
                requiredPermission: 'ar:view',
                dedupeKey: `ar.invoices_overdue:${today}`,
            });
        }

        return {
            dueToday: dueTodayRows.length,
            overdue: overdueRows.length,
        };
    } catch (err) {
        console.error('[ArDueDateReminderEngine] Error running reminder scan:', err.message);
    }
}

function sumBalance(rows) {
    return rows.reduce((sum, row) => sum + Number(row.balance || 0), 0);
}

/** Names a few customers so the alert is actionable without opening the page. */
function summariseCustomers(rows) {
    const names = [...new Set(rows.map(r => r.customer_name).filter(Boolean))];
    if (names.length === 0) return '';
    const shown = names.slice(0, 3).join(', ');
    return names.length > 3 ? `${shown} and ${names.length - 3} more.` : `${shown}.`;
}

function formatAmount(value) {
    return `₱${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function startArDueDateReminderEngine() {
    try {
        const { rows } = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'AR_DUE_DATE_REMINDER_SCHEDULE'");
        const schedule = (rows.length > 0 && rows[0].setting_value) ? rows[0].setting_value : '0 7 * * *';

        console.log(`[ArDueDateReminderEngine] Scheduling cron job with pattern: ${schedule}`);

        if (currentCronJob) currentCronJob.stop();
        currentCronJob = cron.schedule(schedule, () => { runArDueDateReminderScan(); });
    } catch (err) {
        console.error('[ArDueDateReminderEngine] Failed to start engine:', err.message);
    }
}

module.exports = { startArDueDateReminderEngine, runArDueDateReminderScan };
