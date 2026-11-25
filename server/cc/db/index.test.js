/**
 * These tests need a running Postgres. They use the database named in DATABASE_URL.
 */

require('../../env').configureEnv();

const db = require('./index');

const hasDatabase = Boolean(process.env.DATABASE_URL);
const maybe = hasDatabase ? describe : describe.skip;

maybe('db', () => {
  afterAll(() => db.close());

  it('runs a query', async () => {
    const { rows } = await db.query('select $1::int as n', [7]);
    expect(rows).toEqual([{ n: 7 }]);
  });

  it('commits a transaction', async () => {
    const n = await db.transaction(async client => {
      const { rows } = await client.query('select 1 as n');
      return rows[0].n;
    });
    expect(n).toBe(1);
  });

  it('rolls a transaction back when the work throws', async () => {
    await db.query('create table if not exists cc_tx_test (id integer primary key)');
    try {
      await expect(
        db.transaction(async client => {
          await client.query('insert into cc_tx_test (id) values (1)');
          throw new Error('stop');
        })
      ).rejects.toThrow('stop');
      const { rows } = await db.query('select * from cc_tx_test where id = 1');
      expect(rows).toEqual([]);
    } finally {
      await db.query('drop table if exists cc_tx_test');
    }
  });
});
