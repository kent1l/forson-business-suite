const { Pool } = require('pg');

describe('Database Connection', () => {
  let pool;

  beforeAll(() => {
    pool = new Pool({
      user: process.env.POSTGRES_USER || 'test',
      password: process.env.POSTGRES_PASSWORD || 'test',
      database: process.env.POSTGRES_DB || 'test',
      host: process.env.POSTGRES_HOST || 'localhost',
      port: 5432
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('should connect to the database', async () => {
    const client = await pool.connect();
    const result = await client.query('SELECT 1');
    expect(result.rows[0]['?column?']).toBe(1);
    client.release();
  });
});
