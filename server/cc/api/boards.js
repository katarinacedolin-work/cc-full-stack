/**
 * The boards: the Job Board, housing posts, and the ticket chat.
 *
 * A post belongs to the student who wrote it. Nothing is bought through one; other students
 * message its author, and that conversation is opened in conversations.js.
 */

const { httpError } = require('../auth/httpError');
const { createRateLimiter } = require('../auth/rateLimit');
const { displayNameOf } = require('../people');
const store = require('../boards/store');
const { readPost, isBoard } = require('../boards/rules');
const { toPost } = require('../boards/mapPost');
const { requireUser, requireApprovedUser } = require('./requireUser');

// Plenty for someone posting by hand.
const postLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 10 });

/**
 * GET /api/cc/board-posts?kind=job|housing|ticket
 */
exports.list = async (req, res) => {
  const { userId } = await requireUser(req, res);
  const kind = String(req.query.kind || '');
  if (!isBoard(kind)) throw httpError(400, 'unknown-board', 'That board does not exist.');
  const rows = await store.listOpen(kind);
  res.json({ posts: rows.map(row => toPost(row, userId)) });
};

/**
 * POST /api/cc/board-posts
 * Body: { kind: 'job', title, where, schedule, pay, summary }
 *     | { kind: 'housing', title, place, dates, rent, summary }
 *     | { kind: 'ticket', ticketKind: 'resell' | 'request', event, price }
 */
exports.create = async (req, res) => {
  const { user, userId } = await requireApprovedUser(req, res);
  const post = readPost(req.body);
  if (!postLimiter.check(userId).ok) {
    throw httpError(429, 'slow-down', 'That is a lot of posts at once. Try again in a while.');
  }
  const row = await store.create({ ...post, authorId: userId, authorName: displayNameOf(user) });
  res.status(201).json({ post: toPost(row, userId) });
};

/**
 * DELETE /api/cc/board-posts/:id
 * Takes your own post off its board. Conversations about it stay in both inboxes.
 */
exports.remove = async (req, res) => {
  const { userId } = await requireUser(req, res);
  const closed = await store.close({ id: req.params.id, authorId: userId });
  if (!closed) throw httpError(404, 'post-not-found', 'That post is no longer on the board.');
  res.json({ ok: true });
};
