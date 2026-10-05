const cron = require('node-cron');
const db = require('../db');
const MasterDataMergeService = require('./masterDataMergeService');

let job = null;

const runMasterDataMergeSnapshotCleanup = async () => {
    const deleted = await new MasterDataMergeService(db, 'supplier').purgeExpiredMergeSnapshots();
    if (deleted > 0) console.log(`[MasterDataMerge] purged ${deleted} expired snapshot rows`);
    return deleted;
};

const startMasterDataMergeSnapshotCleanup = () => {
    if (job) return job;
    job = cron.schedule('45 3 * * *', () => {
        runMasterDataMergeSnapshotCleanup().catch(error => {
            console.error('[MasterDataMerge] snapshot cleanup failed:', error.message || error);
        });
    });
    return job;
};

module.exports = { startMasterDataMergeSnapshotCleanup, runMasterDataMergeSnapshotCleanup };
