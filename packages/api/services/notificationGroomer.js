'use strict';

const cron = require('node-cron');
const notifications = require('./notificationService');

let currentCronJob = null;

/**
 * Nightly retention pass over the notification tables.
 *
 * Runs at 03:15 Manila — after the day's activity has settled and well before
 * the 07:00 reminder scans, so a long delete never overlaps the emitters. The
 * schedule is fixed rather than settings-driven because there is no operational
 * reason to move it; only the retention window itself is configurable, via
 * NOTIFICATION_RETENTION_DAYS.
 */
function startNotificationGroomer() {
    if (currentCronJob) currentCronJob.stop();
    currentCronJob = cron.schedule('15 3 * * *', async () => {
        try {
            const deleted = await notifications.prune();
            console.log(`[NotificationGroomer] Pruned ${deleted} expired/aged notification(s).`);
        } catch (err) {
            console.error('[NotificationGroomer] Prune failed:', err.message);
        }
    });
    console.log('[NotificationGroomer] Scheduled nightly prune at 03:15.');
}

module.exports = { startNotificationGroomer };
