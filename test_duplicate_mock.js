const DuplicateFinder = require('./packages/api/services/duplicateFinder');

const mockPool = {
    query: async (text, params) => {
        return { rows: [] };
    }
};

async function run() {
    const df = new DuplicateFinder(mockPool);
    try {
        await df.findDuplicateGroups({ minSimilarity: 0.8, limit: 50, excludeMerged: true });
        console.log("Success");
    } catch(err) {
        console.error("Error:", err);
    }
}
run();
