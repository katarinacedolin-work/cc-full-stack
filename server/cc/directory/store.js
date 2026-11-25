/**
 * Directory entries in Postgres.
 */

const db = require('../db');

/**
 * Everything the pages show, in order within each kind.
 */
exports.list = async () => {
  const { rows } = await db.query(
    `select * from directory_entries where not hidden order by kind, position, id`
  );
  return rows;
};

/**
 * Stores checked entries. An entry that is already there is left as it is, so changes the team
 * made since are kept, unless `replace` is set.
 *
 * @param {Array<{ id: string, kind: string, position: number, details: Object }>} entries
 * @param {Object} [options]
 * @param {boolean} [options.replace] overwrite the entries that are already there
 * @returns {Promise<{ added: number, replaced: number, kept: number }>}
 */
exports.save = (entries, { replace = false } = {}) =>
  db.transaction(async client => {
    const counts = { added: 0, replaced: 0, kept: 0 };
    for (const entry of entries) {
      const values = [entry.id, entry.kind, entry.position, JSON.stringify(entry.details)];
      const inserted = await client.query(
        `insert into directory_entries (id, kind, position, details)
         values ($1, $2, $3, $4)
         on conflict (id) do nothing`,
        values
      );
      if (inserted.rowCount > 0) {
        counts.added += 1;
      } else if (replace) {
        await client.query(
          `update directory_entries
           set kind = $2, position = $3, details = $4, hidden = false, updated_at = now()
           where id = $1`,
          values
        );
        counts.replaced += 1;
      } else {
        counts.kept += 1;
      }
    }
    return counts;
  });
