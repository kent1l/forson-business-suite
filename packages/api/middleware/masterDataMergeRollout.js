// Rollout stages: off -> preview -> execute. Read per request so operators can
// switch a stage without changing which route implementation owns the merge.
function requireMergeStage(required) {
    return (_req, res, next) => {
        const stage = process.env.ENABLE_SAFE_MASTER_DATA_MERGE || 'off';
        const levels = { off: 0, preview: 1, execute: 2 };
        res.set('X-Master-Data-Merge-Stage', levels[stage] === undefined ? 'off' : stage);
        if ((levels[stage] || 0) < levels[required]) {
            return res.status(503).json({ message: 'Master-data merge is not enabled at this rollout stage.' });
        }
        return next();
    };
}

module.exports = { requireMergeStage };
