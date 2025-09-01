const db = require('../db');

describe('Database Module', () => {
  test('exports required database interface', () => {
    expect(typeof db.query).toBe('function');
    expect(typeof db.getClient).toBe('function');
  });
});
