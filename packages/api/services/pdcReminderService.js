'use strict';

const cron = require('node-cron');
const db = require('../db');
const pdcService = require('./pdcService');
const apPdcService = require('./apPdcService');

let currentCronJob = null;

/**
 * Daily scan for cheques due today / gone stale (both directions), and outbound
 * cheques that have crossed PDC_MAX_BOUNCE_ATTEMPTS and need a replacement.
 * Deliberately minimal: logs a structured summary rather than sending
 * email/SMS — the in-app banner on the Treasury Desk page covers the UI side
 * from data it already has loaded.
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
