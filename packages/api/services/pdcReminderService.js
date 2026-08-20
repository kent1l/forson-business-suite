'use strict';

const cron = require('node-cron');
const db = require('../db');
const pdcService = require('./pdcService');
const apPdcService = require('./apPdcService');
const notifications = require('./notificationService');
const { manilaDateString } = require('../helpers/manilaDate');

let currentCronJob = null;

/**
 * Daily scan for cheques due today / gone stale (both directions), and outbound
 * cheques that have crossed PDC_MAX_BOUNCE_ATTEMPTS and need a replacement.
 *
 * Each condition raises one summary notification keyed to the Manila date, so
 * re-running the scan (or restarting the API mid-morning) cannot double-post.
 * Inbound and outbound are gated on different permissions — collections staff
 * hold pdc:view, the payables desk holds ap-pdc:view — so they are emitted as
 * separate notifications rather than one combined treasury digest.
 */
async function runPdcReminderScan() {
    console.log('[PdcReminderEngine] Starting daily PDC reminder scan...');
    try {
        const { staleDays, maxBounceAttempts } = await apPdcService.getPdcSettings(db);

        const inbound = await pdcService.getCollectionsClearanceList(db, null, null);
        const inboundDueToday = inbound.filter(i => i.maturity_status === 'DUE_TODAY');
        const inboundStale = inbound.filter(i => i.maturity_status === 'STALE_CHEQUE');

        const outbound = await apPdcService.getOutboundClearanceList(db, null, null);
        const outboundDueToday = outbound.filter(i => i.maturity_status === 'DUE_TODAY');
        const outboundStale = outbound.filter(i => i.maturity_status === 'STALE_CHEQUE');
        const needsReplacement = outbound.filter(i =>
            ['BOUNCED', 'STALE'].includes(i.pdc_status) && (i.bounce_count || 0) >= maxBounceAttempts
        );

        console.log(`[PdcReminderEngine] Inbound: ${inboundDueToday.length} due today, ${inboundStale.length} stale (>${staleDays}d).`);
        console.log(`[PdcReminderEngine] Outbound: ${outboundDueToday.length} due today, ${outboundStale.length} stale (>${staleDays}d), ${needsReplacement.length} need replacement (>=${maxBounceAttempts} bounces).`);

        const today = manilaDateString();

        await raise({
            rows: inboundDueToday,
            type: 'pdc.inbound_due_today',
            severity: 'warning',
            title: n => `${n} customer cheque${n === 1 ? '' : 's'} mature today`,
            body: 'Ready for deposit on the Collections Clearance desk.',
            linkState: { section: 'treasury', tab: 'inbound', maturityFilter: 'DUE_TODAY' },
            permission: 'pdc:view',
            idKey: 'payment_id',
            dedupeKey: `pdc.inbound_due_today:${today}`,
        });

        await raise({
            rows: inboundStale,
            type: 'pdc.inbound_stale',
            severity: 'critical',
            title: n => `${n} customer cheque${n === 1 ? ' has' : 's have'} gone stale`,
            body: `Undeposited for more than ${staleDays} days — these need to be chased or replaced.`,
            linkState: { section: 'treasury', tab: 'inbound', maturityFilter: 'STALE_CHEQUE' },
            permission: 'pdc:view',
            idKey: 'payment_id',
            dedupeKey: `pdc.inbound_stale:${today}`,
        });

        await raise({
            rows: outboundDueToday,
            type: 'ap-pdc.outbound_due_today',
            severity: 'warning',
            title: n => `${n} issued cheque${n === 1 ? '' : 's'} mature today`,
            body: 'Make sure the funding account can cover them before they are presented.',
            linkState: { section: 'treasury', tab: 'outbound', maturityFilter: 'DUE_TODAY' },
            permission: 'ap-pdc:view',
            idKey: 'cheque_record_id',
            dedupeKey: `ap-pdc.outbound_due_today:${today}`,
        });

        await raise({
            rows: outboundStale,
            type: 'ap-pdc.outbound_stale',
            severity: 'warning',
            title: n => `${n} issued cheque${n === 1 ? ' has' : 's have'} gone stale`,
            body: `Uncleared for more than ${staleDays} days.`,
            linkState: { section: 'treasury', tab: 'outbound', maturityFilter: 'STALE_CHEQUE' },
            permission: 'ap-pdc:view',
            idKey: 'cheque_record_id',
            dedupeKey: `ap-pdc.outbound_stale:${today}`,
        });

        await raise({
            rows: needsReplacement,
            type: 'ap-pdc.needs_replacement',
            severity: 'critical',
            title: n => `${n} cheque${n === 1 ? '' : 's'} need replacement`,
            body: `Bounced or gone stale at least ${maxBounceAttempts} time(s). Issue a replacement to keep the supplier settled.`,
            // No maturity filter: these are already past maturity, and the thing
            // that identifies them is the bounced status.
            linkState: { section: 'treasury', tab: 'outbound', statusFilter: 'BOUNCED' },
            permission: 'ap-pdc:manage',
            idKey: 'cheque_record_id',
            dedupeKey: `ap-pdc.needs_replacement:${today}`,
        });

        return {
            inboundDueToday: inboundDueToday.length,
            inboundStale: inboundStale.length,
            outboundDueToday: outboundDueToday.length,
            outboundStale: outboundStale.length,
            needsReplacement: needsReplacement.length,
        };
    } catch (err) {
        console.error('[PdcReminderEngine] Error running reminder scan:', err.message);
    }
}

/**
 * Emits one summary notification for a bucket of cheques, or nothing at all
 * when the bucket is empty — "0 cheques mature today" is noise, not news.
 */
async function raise({ rows, type, severity, title, body, linkState, idKey, permission, dedupeKey }) {
    if (!rows.length) return;
    await notifications.emitSafe({
        type,
        category: 'treasury',
        severity,
        title: title(rows.length),
        body,
        // Both desks live under Cheques & Treasury; linkState picks the section
        // and the tab within it, and `highlight` names the exact rows to mark.
        linkPage: 'cheques_treasury',
        linkState: { ...linkState, highlight: highlightFor(rows, idKey) },
        requiredPermission: permission,
        dedupeKey,
    });
}

// Ids are capped because they ride along in the notification row and are only
// used to mark what is already on screen — the deep link's own filter is what
// narrows the list, so a long tail adds bytes without adding meaning.
const MAX_HIGHLIGHT_IDS = 50;

function highlightFor(rows, idKey) {
    const ids = rows
        .map((row) => row[idKey])
        .filter((id) => id !== null && id !== undefined)
        .slice(0, MAX_HIGHLIGHT_IDS);
    return ids.length ? { type: idKey, ids } : undefined;
}

async function startPdcReminderEngine() {
    try {
        const { rows } = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'PDC_REMINDER_SCHEDULE'");
        const schedule = (rows.length > 0 && rows[0].setting_value) ? rows[0].setting_value : '0 7 * * *';

        console.log(`[PdcReminderEngine] Scheduling cron job with pattern: ${schedule}`);

        if (currentCronJob) currentCronJob.stop();
        currentCronJob = cron.schedule(schedule, () => { runPdcReminderScan(); });
    } catch (err) {
        console.error('[PdcReminderEngine] Failed to start engine:', err.message);
    }
}

module.exports = { startPdcReminderEngine, runPdcReminderScan };
