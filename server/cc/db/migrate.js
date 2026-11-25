/**
 * Brings the database up to date.
 *
 * Runs the .sql files in ./migrations that this database hasn't run yet, in file-name order.
 * Each file runs in its own transaction and is recorded in the schema_migrations table, so
 * running this again does nothing. To change the schema, add a new file; never edit one that
 * has already run somewhere.
 */

require('../../env').configureEnv();

const fs = require('fs');
const path = require('path');
const db = require('./index');
const { requireEnv } = require('../env');

const migrationsDir = path.join(__dirname, 'migrations');

const migrate = async () => {
  await db.query(
    `create table if not exists schema_migrations (
       name text primary key,
       applied_at timestamptz not null default now()
     )`
  );
  const { rows } = await db.query('select name from schema_migrations');
  const applied = new Set(rows.map(row => row.name));

  const files = fs
    .readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort();
  const pending = files.filter(file => !applied.has(file));

  for (const file of pending) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await db.transaction(async client => {
      await client.query(sql);
      await client.query('insert into schema_migrations (name) values ($1)', [file]);
    });
    console.log(`Applied ${file}`); // eslint-disable-line no-console
  }

  console.log(pending.length > 0 ? 'Database is up to date.' : 'Nothing to apply.'); // eslint-disable-line no-console
};

requireEnv(['DATABASE_URL']);

migrate()
  .catch(e => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.close());
