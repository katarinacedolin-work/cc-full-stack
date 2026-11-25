/**
 * The bell, its settings, and the check the pages make to learn that something changed.
 */

const crypto = require('crypto');
const { httpError } = require('../auth/httpError');
const store = require('../notifications/store');
const { requireUser } = require('./requireUser');

const sideOf = req => (req.query.side === 'seller' ? 'seller' : 'buyer');

// Which field of a notification holds the id its click leads to.
const TARGET_FIELD = {
  order: 'orderId',
  inbox: 'conversationId',
  listing: 'listingId',
  scan: 'listingId',
};

const toNotification = row => {
  const notification = {
    id: String(row.id),
    unread: !row.read_at,
    category: row.category,
    title: row.title,
    body: row.body,
    at: new Date(row.created_at).toISOString(),
    emoji: row.emoji || '🔔',
    accent: row.accent || 'cobalt',
    action: row.action,
  };
  const field = TARGET_FIELD[row.action];
  if (field && row.target_id) notification[field] = row.target_id;
  return notification;
};

/**
 * GET /api/cc/notifications?side=buyer|seller
 */
exports.list = async (req, res) => {
  const { userId } = await requireUser(req, res);
  const rows = await store.list({ userId, side: sideOf(req) });
  res.json({ notifications: rows.map(toNotification) });
};

/**
 * POST /api/cc/notifications/:id/read
 */
exports.markRead = async (req, res) => {
  const { userId } = await requireUser(req, res);
  if (!/^\d{1,18}$/.test(req.params.id)) {
    throw httpError(404, 'notification-not-found', 'That notification is no longer here.');
  }
  await store.markRead({ id: req.params.id, userId });
  res.json({ ok: true });
};

/**
 * POST /api/cc/notifications/read-all?side=buyer|seller
 */
exports.markAllRead = async (req, res) => {
  const { userId } = await requireUser(req, res);
  await store.markAllRead({ userId, side: sideOf(req) });
  res.json({ ok: true });
};

/**
 * GET /api/cc/settings
 * Which kinds of notification reach the bell.
 */
exports.getSettings = async (req, res) => {
  const { userId } = await requireUser(req, res);
  res.json({ settings: await store.getSettings(userId) });
};

/**
 * PATCH /api/cc/settings
 * Body: any of { notifyMessages, notifyOrders, notifyRequests, notifyReviews } as booleans
 */
exports.updateSettings = async (req, res) => {
  const { userId } = await requireUser(req, res);
  res.json({ settings: await store.updateSettings(userId, req.body || {}) });
};

// ================ Changes ================ //

// An open page asks every few seconds whether anything changed. Checking the session with
// Sharetribe that often would be wasteful, so the first answer includes a key that proves who
// is asking. The key only opens this one timestamp.
const configuredSecret = process.env.SHARETRIBE_SDK_CLIENT_SECRET;
// The placeholder from .env-template is public knowledge, so it can't sign anything.
const SECRET = configuredSecret && configuredSecret !== 'change-me' ? configuredSecret : '';

const keyFor = userId =>
  crypto
    .createHmac('sha256', SECRET)
    .update(`cc-changes:${userId}`)
    .digest('hex');

const sameKey = (given, expected) => {
  const a = Buffer.from(String(given));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/**
 * GET /api/cc/changes
 * GET /api/cc/changes?user=<id>&key=<key from an earlier answer>
 * Answers { user, key, at }, where `at` moves whenever a message, notification or order of
 * this student changes.
 */
exports.changes = async (req, res) => {
  let userId = String(req.query.user || '');
  const key = String(req.query.key || '');
  const known = Boolean(SECRET && userId && key && sameKey(key, keyFor(userId)));
  if (!known) {
    ({ userId } = await requireUser(req, res));
  }
  res.set('Cache-Control', 'no-store');
  res.json({
    user: userId,
    key: SECRET ? keyFor(userId) : '',
    at: await store.changedAt(userId),
  });
};
