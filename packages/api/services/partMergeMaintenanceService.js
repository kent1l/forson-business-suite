const cron = require('node-cron');
const db = require('../db');
const PartMergeService = require('./partMergeService');

let job = null;

const runPartMergeSnapshotCleanup = async () => {
    const service = new PartMergeService(db);
    const deleted = await service.purgeExpiredMergeSnapshots();
    if (deleted > 0) console.log(`[PartMerge] purged ${deleted} expired snapshot rows`);
    return deleted;
};

const startPartMergeSnapshotCleanup = () => {
    if (job) return job;
    // Daily in the application's Asia/Manila process timezone. Expiry is also
    // enforced synchronously by revertMerge, so a missed cron run is harmless.
    job = cron.schedule('30 3 * * *', () => {
        runPartMergeSnapshotCleanup().catch((error) => {
            console.error('[PartMerge] snapshot cleanup failed:', error.message || error);
        });
    });
    return job;
};

module.exports = { startPartMergeSnapshotCleanup, runPartMergeSnapshotCleanup };
