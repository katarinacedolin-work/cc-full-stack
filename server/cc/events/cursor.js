/**
 * The worker's saved place in Sharetribe's event feed (the event_cursor table).
 *
 * Sequence ids belong to one Sharetribe environment, so a database must not be reused with a
 * different one.
 */

const db = require('../db');

/**
 * @returns {Promise<{ sequenceId: number|null, startedAt: Date }>} the last finished event,
 * and where to start reading while there isn't one yet
 */
exports.get = async () => {
  const { rows } = await db.query('select sequence_id, started_at from event_cursor');
  const { sequence_id: sequenceId, started_at: startedAt } = rows[0];
  // pg returns bigint columns as strings.
  return { sequenceId: sequenceId == null ? null : Number(sequenceId), startedAt };
};

/**
 * @param {number} sequenceId the event that was just finished
 */
exports.set = async sequenceId => {
  await db.query('update event_cursor set sequence_id = $1', [sequenceId]);
};

/**
 * Moves the start time forward while no event has been stored yet.
 * An older time is left as it is, and a saved sequence id is left as it is.
 *
 * @param {Date} startedAt a start time Sharetribe will still accept
 */
exports.setStartedAt = async startedAt => {
  await db.query(
    'update event_cursor set started_at = $1 where sequence_id is null and started_at < $1',
    [startedAt]
  );
};
