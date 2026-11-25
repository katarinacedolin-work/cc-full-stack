/**
 * Conversations and their messages in Postgres.
 */

const db = require('../db');

// Seller Hub shows the conversations where someone wrote to you as a seller. Everything else,
// including what you started yourself, is on the buyer pages.
const SIDE_FILTER = {
  seller: `(t.owner_id = $1 and t.kind in ('order', 'direct'))`,
  buyer: `(t.starter_id = $1 or (t.owner_id = $1 and t.kind not in ('order', 'direct')))`,
};

exports.findById = async id => {
  // Ids arrive from the address bar, so anything that isn't a number finds nothing.
  if (!/^\d{1,18}$/.test(String(id))) return null;
  const { rows } = await db.query('select * from threads where id = $1', [id]);
  return rows[0] || null;
};

const findByTransaction = async transactionId => {
  const { rows } = await db.query('select * from threads where transaction_id = $1', [
    transactionId,
  ]);
  return rows[0] || null;
};
exports.findByTransaction = findByTransaction;

/**
 * The conversation a buyer already has about a listing: the newest one, whether it is still a
 * question or has become an order.
 */
exports.findForListing = async ({ listingId, starterId }) => {
  const { rows } = await db.query(
    `select * from threads
     where kind = 'order' and context_id = $1 and starter_id = $2 and not hidden
     order by last_message_at desc
     limit 1`,
    [listingId, starterId]
  );
  return rows[0] || null;
};

/**
 * The conversation two people have that isn't about a listing, whoever started it.
 */
exports.findDirect = async (userId, otherId) => {
  const { rows } = await db.query(
    `select * from threads
     where kind = 'direct' and not hidden
       and ((starter_id = $1 and owner_id = $2) or (starter_id = $2 and owner_id = $1))
     order by last_message_at desc
     limit 1`,
    [userId, otherId]
  );
  return rows[0] || null;
};

/**
 * Starts a conversation. When the same one already exists, that one is returned instead.
 *
 * @param {Object} thread
 * @param {'order'|'direct'|'job'|'housing'|'ticket-post'} thread.kind
 * @param {string|null} [thread.transactionId]
 * @param {string} [thread.contextId]
 * @param {string} [thread.contextTitle]
 * @param {string} thread.starterId
 * @param {string} [thread.starterName]
 * @param {string} thread.ownerId
 * @param {string} [thread.ownerName]
 * @returns {Promise<Object>} the thread row
 */
exports.create = async ({
  kind,
  transactionId = null,
  contextId = '',
  contextTitle = '',
  starterId,
  starterName = '',
  ownerId,
  ownerName = '',
}) => {
  const { rows } = await db.query(
    `insert into threads
       (kind, transaction_id, context_id, context_title, starter_id, starter_name, owner_id,
        owner_name)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict do nothing
     returning *`,
    [kind, transactionId, contextId, contextTitle, starterId, starterName, ownerId, ownerName]
  );
  if (rows[0]) return rows[0];
  if (transactionId) return findByTransaction(transactionId);
  const existing = await db.query(
    `select * from threads
     where kind = $1 and context_id = $2 and starter_id = $3 and owner_id = $4
       and transaction_id is null`,
    [kind, contextId, starterId, ownerId]
  );
  return existing.rows[0] || null;
};

/**
 * Ties a question about a listing to the Sharetribe transaction that now carries it.
 */
exports.attachTransaction = async (threadId, transactionId) => {
  const { rows } = await db.query(
    `update threads set transaction_id = $2
     where id = $1 and transaction_id is null
     returning *`,
    [threadId, transactionId]
  );
  return rows[0] || exports.findById(threadId);
};

/**
 * Stores one message. A message that came from Sharetribe is only stored once, however often
 * it arrives.
 *
 * @param {Object} message
 * @param {string} message.threadId
 * @param {string} message.senderId
 * @param {string} message.body
 * @param {string|null} [message.sharetribeId]
 * @param {string|Date|null} [message.createdAt] defaults to now
 * @param {Object} [client]
 * @returns {Promise<Object|null>} the message row, or null when it was already stored
 */
exports.addMessage = async (
  { threadId, senderId, body, sharetribeId = null, createdAt = null },
  client = db
) => {
  const { rows } = await client.query(
    `insert into messages (thread_id, sender_id, body, sharetribe_id, created_at)
     values ($1, $2, $3, $4, coalesce($5::timestamptz, now()))
     on conflict (sharetribe_id) do nothing
     returning *`,
    [threadId, senderId, body, sharetribeId, createdAt]
  );
  const message = rows[0];
  if (!message) return null;

  await client.query(
    `update threads set last_message_at = greatest(last_message_at, $2::timestamptz)
     where id = $1`,
    [threadId, message.created_at]
  );
  // The sender has read their own message.
  await client.query(
    `insert into thread_state (thread_id, user_id, read_at)
     values ($1, $2, $3)
     on conflict (thread_id, user_id) do update
       set read_at = greatest(thread_state.read_at, excluded.read_at)`,
    [threadId, senderId, message.created_at]
  );
  // A new message brings a conversation back out of "done" for the person receiving it.
  await client.query(
    'update thread_state set done = false where thread_id = $1 and user_id <> $2 and done',
    [threadId, senderId]
  );
  return message;
};

exports.hasSharetribeMessage = async sharetribeId => {
  const { rows } = await db.query('select 1 from messages where sharetribe_id = $1', [
    sharetribeId,
  ]);
  return rows.length > 0;
};

/**
 * Notes that someone has the conversation open: everything in it so far is read.
 */
exports.markRead = ({ threadId, userId }) =>
  db.query(
    `insert into thread_state (thread_id, user_id, read_at)
     values ($1, $2, now())
     on conflict (thread_id, user_id) do update set read_at = now()`,
    [threadId, userId]
  );

exports.setDone = ({ threadId, userId, done }) =>
  db.query(
    `insert into thread_state (thread_id, user_id, done)
     values ($1, $2, $3)
     on conflict (thread_id, user_id) do update set done = excluded.done`,
    [threadId, userId, Boolean(done)]
  );

/**
 * One person's conversations on one side of the site, newest first. A conversation nobody has
 * written in yet only shows to the person who opened it, and only for a day.
 *
 * @param {Object} query
 * @param {string} query.userId
 * @param {'buyer'|'seller'} query.side
 * @param {number} [query.limit]
 * @returns {Promise<Array<Object>>} thread rows with that person's read_at and done
 */
exports.listFor = async ({ userId, side, limit = 60 }) => {
  const { rows } = await db.query(
    `select t.*, s.read_at, coalesce(s.done, false) as done
     from threads t
     left join thread_state s on s.thread_id = t.id and s.user_id = $1
     where not t.hidden
       and ${SIDE_FILTER[side] || SIDE_FILTER.buyer}
       and (
         exists (select 1 from messages m where m.thread_id = t.id)
         or s.read_at > now() - interval '1 day'
       )
     order by t.last_message_at desc, t.id desc
     limit $2`,
    [userId, limit]
  );
  return rows;
};

/**
 * One conversation as one person sees it.
 *
 * @returns {Promise<Object|null>} the thread row with their read_at and done, or null when
 * they are not in it
 */
exports.findFor = async ({ threadId, userId }) => {
  if (!/^\d{1,18}$/.test(String(threadId))) return null;
  const { rows } = await db.query(
    `select t.*, s.read_at, coalesce(s.done, false) as done
     from threads t
     left join thread_state s on s.thread_id = t.id and s.user_id = $2
     where t.id = $1 and not t.hidden and (t.starter_id = $2 or t.owner_id = $2)`,
    [threadId, userId]
  );
  return rows[0] || null;
};

/**
 * @param {Array<string>} threadIds
 * @param {number} [perThread] only the newest this many of each conversation
 * @returns {Promise<Map<string, Array<Object>>>} message rows by thread id, oldest first
 */
exports.messagesFor = async (threadIds, perThread = 200) => {
  const byThread = new Map();
  if (threadIds.length === 0) return byThread;
  const { rows } = await db.query(
    `select * from (
       select m.*,
              row_number() over (
                partition by m.thread_id order by m.created_at desc, m.id desc
              ) as newest
       from messages m
       where m.thread_id = any($1::bigint[])
     ) ranked
     where newest <= $2
     order by thread_id, created_at, id`,
    [threadIds, perThread]
  );
  rows.forEach(row => {
    if (!byThread.has(row.thread_id)) byThread.set(row.thread_id, []);
    byThread.get(row.thread_id).push(row);
  });
  return byThread;
};
