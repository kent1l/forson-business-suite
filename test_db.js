const db = require('./packages/api/db');

async function test() {
    try {
        let res = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'employee%';");
        console.log('Employees:', res.rows);

        res = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'part%';");
        console.log('Parts:', res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
test();
