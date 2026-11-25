/**
 * The bell, the settings that decide what reaches it, and the "something changed" clock the
 * pages poll, all in Postgres.
 *
 * Functions take an optional `client` so they can join a transaction (see db.transaction).
 */

const db = require('../db');

// The settings the pages can switch, and the column each one is kept in.
const SETTING_COLUMNS = {
  notifyMessages: 'notify_messages',
  notifyOrders: 'notify_orders',
  notifyRequests: 'notify_requests',
  notifyReviews: 'notify_reviews',
};

const ALL_ON = Object.fromEntries(Object.keys(SETTING_COLUMNS).map(key => [key, true]));

/**
 * @param {string} userId
 * @returns {Promise<Object>} { notifyMessages, notifyOrders, notifyRequests, notifyReviews }
 */
exports.getSettings = async userId => {
  const { rows } = await db.query('select * from user_settings where user_id = $1', [userId]);
  if (!rows[0]) return { ...ALL_ON };
  return Object.fromEntries(
    Object.entries(SETTING_COLUMNS).map(([key, column]) => [key, Boolean(rows[0][column])])
  );
};

/**
 * @param {string} userId
 * @param {Object} changes any of the setting keys, as booleans. Other keys are ignored
 * @returns {Promise<Object>} the settings after the change
 */
exports.updateSettings = async (userId, changes) => {
  const keys = Object.keys(SETTING_COLUMNS).filter(key => typeof changes?.[key] === 'boolean');
  if (keys.length > 0) {
    const columns = keys.map(key => SETTING_COLUMNS[key]);
    const values = keys.map(key => changes[key]);
    await db.query(
      `insert into user_settings (user_id, ${columns.join(', ')})
       values ($1, ${columns.map((_, index) => `$${index + 2}`).join(', ')})
       on conflict (user_id) do update
         set ${columns.map(column => `${column} = excluded.${column}`).join(', ')},
             updated_at = now()`,
      [userId, ...values]
    );
  }
  return exports.getSettings(userId);
};

/**
 * Puts a notification on someone's bell, unless they switched that kind off.
 *
 * @param {Object} notification
 * @param {string} notification.userId
 * @param {'buyer'|'seller'} notification.side
 * @param {'orders'|'messages'|'reviews'} notification.category
 * @param {string} notification.setting the setting key that can switch it off
 * @param {string} notification.title
 * @param {string} [notification.body]
 * @param {string} [notification.emoji]
 * @param {string} [notification.accent]
 * @param {string} [notification.action] where a click leads: order, inbox, reviews, listing, scan
 * @param {string} [notification.targetId] the order, conversation or listing it leads to
 * @param {string} [notification.dedupeKey] writing the same key again adds nothing
 * @param {boolean} [notification.replace] with a dedupeKey: the newer one takes the place of
 * the older one and is unread again, instead of being dropped
 * @param {Object} [client]
 * @returns {Promise<boolean>} whether a row was written
 */
exports.write = async (notification, client = db) => {
  const column = SETTING_COLUMNS[notification.setting];
  if (!column) throw new Error(`Unknown notification setting: ${notification.setting}`);

  const onConflict = notification.replace
    ? `do update set title = excluded.title, body = excluded.body, emoji = excluded.emoji,
         accent = excluded.accent, created_at = now(), read_at = null`
    : 'do nothing';

  const result = await client.query(
    `insert into notifications
       (user_id, side, category, title, body, emoji, accent, action, target_id, dedupe_key)
     select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
     where coalesce((select ${column} from user_settings where user_id = $1), true)
     on conflict (dedupe_key) ${onConflict}`,
    [
      notification.userId,
      notification.side,
      notification.category,
      notification.title,
      notification.body || '',
      notification.emoji || '',
      notification.accent || 'cobalt',
      notification.action || '',
      notification.targetId || '',
      notification.dedupeKey || null,
    ]
  );
  return result.rowCount > 0;
};

/**
 * @param {Object} query
 * @param {string} query.userId
 * @param {'buyer'|'seller'} query.side
 * @param {number} [query.limit]
 * @returns {Promise<Array<Object>>} newest first
 */
exports.list = async ({ userId, side, limit = 50 }) => {
  const { rows } = await db.query(
    `select * from notifications
     where user_id = $1 and side = $2
     order by created_at desc, id desc
     limit $3`,
    [userId, side, limit]
  );
  return rows;
};

exports.markRead = ({ id, userId }) =>
  db.query(
    `update notifications set read_at = now()
     where id = $1 and user_id = $2 and read_at is null`,
    [id, userId]
  );

exports.markAllRead = ({ userId, side }) =>
  db.query(
    `update notifications set read_at = now()
     where user_id = $1 and side = $2 and read_at is null`,
    [userId, side]
  );

// One conversation has one notification per person, however many messages arrive.
const threadKey = (threadId, userId) => `thread:${threadId}:${userId}`;
exports.threadKey = threadKey;

/**
 * Opening a conversation also clears its notification.
 */
exports.markThreadRead = ({ threadId, userId }) =>
  db.query(
    `update notifications set read_at = now()
     where dedupe_key = $1 and user_id = $2 and read_at is null`,
    [threadKey(threadId, userId), userId]
  );

/**
 * Notes that something changed for these people, so their open pages reload.
 *
 * @param {Array<string>} userIds
 * @param {Object} [client]
 */
exports.touch = async (userIds, client = db) => {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (ids.length === 0) return;
  await client.query(
    `insert into user_activity (user_id, changed_at)
     select unnest($1::text[]), now()
     on conflict (user_id) do update set changed_at = excluded.changed_at`,
    [ids]
  );
};

/**
 * @param {string} userId
 * @returns {Promise<string|null>} when something last changed for them, as an ISO time
 */
exports.changedAt = async userId => {
  const { rows } = await db.query('select changed_at from user_activity where user_id = $1', [
    userId,
  ]);
  return rows[0] ? new Date(rows[0].changed_at).toISOString() : null;
};

exports.SETTING_KEYS = Object.keys(SETTING_COLUMNS);
