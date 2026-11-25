/**
 * Loads the directory: school-provided services, apartment buildings and real estate agents.
 *
 *   node server/cc/db/seedDirectory.js [file] [--replace]
 *
 * `file` defaults to ./seed/directory.json. Entries that are already in the database are left
 * as they are, so running this again only adds what is new. Pass --replace to overwrite them
 * with what the file says. Nothing is ever removed; an entry that is gone from the file stays.
 */

require('../../env').configureEnv();

const fs = require('fs');
const path = require('path');
const db = require('./index');
const { requireEnv } = require('../env');
const { checkFile } = require('../directory/entries');
const store = require('../directory/store');

const args = process.argv.slice(2);
const replace = args.includes('--replace');
const file = path.resolve(
  args.find(arg => !arg.startsWith('--')) || path.join(__dirname, 'seed', 'directory.json')
);

const seed = async () => {
  // Every entry is checked before any is stored, so a mistake in the file changes nothing.
  const entries = checkFile(JSON.parse(fs.readFileSync(file, 'utf8')));
  const { added, replaced, kept } = await store.save(entries, { replace });
  /* eslint-disable no-console */
  console.log(`Read ${entries.length} entries from ${file}`);
  console.log(`Added ${added}, replaced ${replaced}, left ${kept} as they were.`);
  if (kept > 0) console.log('Run again with --replace to overwrite the ones that were left.');
  /* eslint-enable no-console */
};

requireEnv(['DATABASE_URL']);

seed()
  .catch(e => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());
