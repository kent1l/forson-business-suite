const db = require('../db');

async function run() {
  try {
    const { rows } = await db.query("SELECT DISTINCT days_to_due FROM public.payment_term ORDER BY days_to_due");
    const days = rows.map(r => Number(r.days_to_due));
    console.log('Found days_to_due values:', days);

    const required = [0,7,15,30];
    const missing = required.filter(r => !days.includes(r));
    if (missing.length) {
      console.error('Missing expected payment term days:', missing);
      process.exit(1);
    }
    console.log('payment_terms DB test passed');
    process.exit(0);
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
}

run();
