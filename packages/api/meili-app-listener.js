const db = require('./db');
const { syncApplications, removeApplication } = require('./meili-applications');

const startMeiliApplicationsListener = async () => {
  const client = await db.getClient();
  const pendingUpserts = new Set();
  const pendingDeletes = new Set();
  let timer = null;

  const flush = async () => {
    const upserts = Array.from(pendingUpserts);
    const deletes = Array.from(pendingDeletes);
    pendingUpserts.clear();
    pendingDeletes.clear();
    timer = null;
    try {
      for (const id of deletes) await removeApplication(id);
      if (upserts.length) {
        const { rows } = await db.query(`
          SELECT a.application_id, a.make_id, a.model_id, a.engine_id,
                 vmk.make_name AS make, vmd.model_name AS model, veng.engine_name AS engine
          FROM application a
          LEFT JOIN vehicle_make vmk ON a.make_id = vmk.make_id
          LEFT JOIN vehicle_model vmd ON a.model_id = vmd.model_id
          LEFT JOIN vehicle_engine veng ON a.engine_id = veng.engine_id
          WHERE a.application_id = ANY($1::int[])`, [upserts]);
        const docs = rows.map(r => ({
          application_id: r.application_id,
          make_id: r.make_id,
          model_id: r.model_id,
          engine_id: r.engine_id,
          make: r.make || '',
          model: r.model || '',
          engine: r.engine || '',
          label: [r.make, r.model, r.engine].filter(Boolean).join(' ')
        }));
        if (docs.length) await syncApplications(docs);
      }
    } catch (e) {
      console.error('Meili applications batch flush error:', e && e.stack ? e.stack : e);
    }
  };

  const schedule = () => { if (!timer) timer = setTimeout(flush, 300); };

  try {
    await client.query('LISTEN meili_app_sync');
    console.log('Listening for meili_app_sync notifications...');
    client.on('notification', (msg) => {
      try {
        const payload = JSON.parse(msg.payload || '{}');
        if (payload.action === 'delete' && payload.application_id) {
          pendingDeletes.add(payload.application_id);
          pendingUpserts.delete(payload.application_id);
          schedule();
        } else if (payload.action === 'upsert' && payload.application_id) {
          pendingUpserts.add(payload.application_id);
          pendingDeletes.delete(payload.application_id);
          schedule();
        }
      } catch (e) {
        console.error('Error handling meili_app_sync:', e && e.stack ? e.stack : e);
      }
    });
    client.on('error', (err) => console.error('Postgres app listener error:', err && err.stack ? err.stack : err));
    process.on('exit', () => client.release());
    process.on('SIGINT', () => client.release());
    process.on('SIGTERM', () => client.release());
  } catch (err) {
    console.error('Failed to start Meili applications listener:', err && err.stack ? err.stack : err);
    try { client.release(); } catch (e) { console.error('Release client failed:', e && e.stack ? e.stack : e); }
  }
};

module.exports = { startMeiliApplicationsListener };
