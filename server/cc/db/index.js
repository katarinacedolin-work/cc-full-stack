/**
 * The Postgres connection shared by the web service and the worker.
 *
 * The pool is created on first use, so loading this file doesn't need a database.
 */

const { Pool } = require('pg');
const log = require('../../log');

let pool = null;

const getPool = () => {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    // Without a listener, an error on an idle connection would crash the process.
    pool.on('error', e => log.error(e, 'cc-postgres-idle-connection-failed'));
  }
  return pool;
};

/**
 * Runs one statement.
 *
 * @param {string} text SQL with $1, $2... placeholders
 * @param {Array} [params] values for the placeholders
 * @returns {Promise<Object>} the pg result; rows are in result.rows
 */
exports.query = (text, params) => getPool().query(text, params);

/**
 * Runs several statements in one transaction. It commits when `work` resolves and rolls back
 * when it throws.
 *
 * @param {Function} work async function that takes the client to run its statements on
 * @returns {Promise<*>} what `work` returned
 */
exports.transaction = async work => {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
};

/**
 * Closes every connection. Call it before the process exits.
 */
exports.close = async () => {
  if (pool) {
    const closing = pool;
    pool = null;
    await closing.end();
  }
};
