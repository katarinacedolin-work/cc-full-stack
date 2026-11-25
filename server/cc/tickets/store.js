/**
 * Tickets and door helpers in Postgres.
 */

const db = require('../db');
const { makeCode } = require('./code');
const { NO_SHOW_HOURS } = require('./rules');

const UNIQUE_VIOLATION = '23505';

const findByTransaction = async transactionId => {
  const { rows } = await db.query('select * from tickets where transaction_id = $1', [
    transactionId,
  ]);
  return rows[0] || null;
};

/**
 * Gives a paid ticket order its code. Safe to call again for the same order: the first code
 * stays.
 *
 * @param {Object} ticket
 * @param {string} ticket.transactionId
 * @param {string} ticket.listingId
 * @param {string} ticket.sellerId
 * @param {string} ticket.buyerId
 * @param {string} [ticket.buyerName]
 * @param {string} [ticket.listingTitle]
 * @param {string|Date|null} [ticket.eventStartsAt]
 * @returns {Promise<Object>} the ticket row
 */
exports.issue = async ({
  transactionId,
  listingId,
  sellerId,
  buyerId,
  buyerName = '',
  listingTitle = '',
  eventStartsAt = null,
}) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const { rows } = await db.query(
        `insert into tickets
           (transaction_id, listing_id, seller_id, buyer_id, buyer_name, listing_title, code,
            event_starts_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (transaction_id) do nothing
         returning *`,
        [
          transactionId,
          listingId,
          sellerId,
          buyerId,
          buyerName,
          listingTitle,
          makeCode(),
          eventStartsAt,
        ]
      );
      return rows[0] || (await findByTransaction(transactionId));
    } catch (e) {
      // Another ticket already has this code. Try a new one.
      if (e.code !== UNIQUE_VIOLATION) throw e;
    }
  }
  throw new Error('Could not make a ticket code that is not already in use.');
};

/**
 * @param {Array<string>} transactionIds
 * @returns {Promise<Map<string, Object>>} ticket rows by transaction id
 */
exports.findByTransactions = async transactionIds => {
  const tickets = new Map();
  if (transactionIds.length === 0) return tickets;
  const { rows } = await db.query('select * from tickets where transaction_id = any($1)', [
    transactionIds,
  ]);
  rows.forEach(row => tickets.set(row.transaction_id, row));
  return tickets;
};

exports.findByTransaction = findByTransaction;

/**
 * Cancels a ticket that has not been scanned, so its code stops working.
 *
 * @param {string} transactionId
 * @returns {Promise<'voided'|'used'|'void'|'none'>} 'voided' when this call cancelled it.
 * Otherwise the state it was left in: 'used' (already scanned), 'void' (already cancelled),
 * or 'none' when the order has no ticket yet
 */
exports.voidUnused = async transactionId => {
  const { rows } = await db.query(
    `update tickets set status = 'void', voided_at = now()
     where transaction_id = $1 and status = 'issued'
     returning status`,
    [transactionId]
  );
  if (rows[0]) return 'voided';
  const ticket = await findByTransaction(transactionId);
  return ticket ? ticket.status : 'none';
};

/**
 * Cancels a ticket whatever its state. For when Sharetribe has already refunded the order.
 */
exports.voidAlways = transactionId =>
  db.query(
    `update tickets set status = 'void', voided_at = coalesce(voided_at, now())
     where transaction_id = $1`,
    [transactionId]
  );

/**
 * Undoes voidUnused when the refund did not go through.
 */
exports.restore = transactionId =>
  db.query(
    `update tickets set status = 'issued', voided_at = null
     where transaction_id = $1 and status = 'void'`,
    [transactionId]
  );

// Who may scan a ticket: the seller, and the door helpers of that event.
const MAY_SCAN = `(t.seller_id = $2 or exists (
  select 1 from event_door_helpers h
  where h.listing_id = t.listing_id and h.helper_user_id = $2
))`;

/**
 * Marks a ticket used. Two people scanning the same code at the same moment can't both get
 * 'ok': the update only matches while the ticket is still unused.
 *
 * @param {Object} scan
 * @param {string} scan.code a normalized code
 * @param {string} scan.scannerId the signed-in user
 * @returns {Promise<{ result: 'ok'|'used'|'void'|'unknown', ticket: Object|null }>} 'unknown'
 * covers both a code that doesn't exist and a ticket for somebody else's event
 */
exports.scan = async ({ code, scannerId }) => {
  const updated = await db.query(
    `update tickets t set status = 'used', used_at = now(), used_by = $2
     where t.code = $1 and t.status = 'issued' and ${MAY_SCAN}
     returning t.*`,
    [code, scannerId]
  );
  if (updated.rows[0]) return { result: 'ok', ticket: updated.rows[0] };

  const existing = await db.query(`select t.* from tickets t where t.code = $1 and ${MAY_SCAN}`, [
    code,
    scannerId,
  ]);
  const ticket = existing.rows[0] || null;
  return { result: ticket ? ticket.status : 'unknown', ticket };
};

exports.markCompleted = transactionId =>
  db.query(
    `update tickets set completed_at = coalesce(completed_at, now())
     where transaction_id = $1`,
    [transactionId]
  );

exports.markCompletionChecked = transactionId =>
  db.query('update tickets set completion_checked_at = now() where transaction_id = $1', [
    transactionId,
  ]);

/**
 * Tickets whose order should be completed now: scanned ones, and unscanned ones whose event
 * started a while ago. One that just failed waits an hour before it is tried again.
 *
 * @param {number} [limit]
 * @returns {Promise<Array<Object>>}
 */
exports.dueForCompletion = async (limit = 25) => {
  const { rows } = await db.query(
    `select * from tickets
     where completed_at is null
       and status <> 'void'
       and (status = 'used' or event_starts_at < now() - make_interval(hours => $1))
       and (completion_checked_at is null or completion_checked_at < now() - interval '1 hour')
     order by issued_at
     limit $2`,
    [NO_SHOW_HOURS, limit]
  );
  return rows;
};

/**
 * Keeps the copies of the listing's title and event time up to date.
 */
exports.updateEvent = ({ listingId, listingTitle, eventStartsAt }) =>
  db.query(
    `update tickets set listing_title = $2, event_starts_at = $3
     where listing_id = $1
       and (listing_title is distinct from $2 or event_starts_at is distinct from $3)`,
    [listingId, listingTitle, eventStartsAt]
  );

/**
 * @param {Array<string>} listingIds
 * @returns {Promise<Map<string, { sold: number, used: number }>>}
 */
exports.countsByListing = async listingIds => {
  const counts = new Map();
  if (listingIds.length === 0) return counts;
  const { rows } = await db.query(
    `select listing_id,
            count(*) filter (where status <> 'void')::int as sold,
            count(*) filter (where status = 'used')::int as used
     from tickets
     where listing_id = any($1)
     group by listing_id`,
    [listingIds]
  );
  rows.forEach(row => counts.set(row.listing_id, { sold: row.sold, used: row.used }));
  return counts;
};

// ================ Door helpers ================ //

const MAX_HELPERS = 20;

/**
 * @param {Object} helper
 * @returns {Promise<'added'|'full'>}
 */
exports.addHelper = async ({ listingId, hostId, helperUserId, helperName, helperEmail }) => {
  const { rows } = await db.query(
    'select count(*)::int as n from event_door_helpers where listing_id = $1',
    [listingId]
  );
  if (rows[0].n >= MAX_HELPERS) return 'full';
  await db.query(
    `insert into event_door_helpers
       (listing_id, helper_user_id, helper_name, helper_email, host_id)
     values ($1, $2, $3, $4, $5)
     on conflict (listing_id, helper_user_id) do update
       set helper_name = excluded.helper_name, helper_email = excluded.helper_email`,
    [listingId, helperUserId, helperName, helperEmail, hostId]
  );
  return 'added';
};

exports.removeHelper = ({ listingId, hostId, helperUserId }) =>
  db.query(
    `delete from event_door_helpers
     where listing_id = $1 and helper_user_id = $2 and host_id = $3`,
    [listingId, helperUserId, hostId]
  );

/**
 * @param {string} hostId
 * @returns {Promise<Array<Object>>} the helpers of every event this host runs
 */
exports.helpersOfHost = async hostId => {
  const { rows } = await db.query(
    `select listing_id, helper_user_id, helper_name, helper_email
     from event_door_helpers where host_id = $1 order by created_at`,
    [hostId]
  );
  return rows;
};

/**
 * @param {string} userId
 * @returns {Promise<Array<string>>} listing ids of the events this user helps at
 */
exports.eventsHelpedBy = async userId => {
  const { rows } = await db.query(
    'select listing_id from event_door_helpers where helper_user_id = $1',
    [userId]
  );
  return rows.map(row => row.listing_id);
};

exports.MAX_HELPERS = MAX_HELPERS;
