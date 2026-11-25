/**
 * "Get help": a student writes to the Campus Connect team.
 *
 * The request is kept in Postgres for the team to read. Nothing is emailed from here.
 */

const { httpError } = require('../auth/httpError');
const { createRateLimiter } = require('../auth/rateLimit');
const { displayNameOf } = require('../people');
const store = require('../support/store');
const { requireUser } = require('./requireUser');

const MAX_TOPIC_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 2000;

const caseLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 5 });

/**
 * POST /api/cc/support
 * Body: { topic, message, orderId? }
 * Open to anyone signed in, including a student who is still waiting to be verified.
 */
exports.create = async (req, res) => {
  const { user, userId } = await requireUser(req, res);
  const message = String(req.body?.message || '').trim();
  if (!message) throw httpError(400, 'message-required', 'Tell us a little about what happened.');
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw httpError(
      400,
      'message-too-long',
      `Keep it under ${MAX_MESSAGE_LENGTH} characters. You can send the rest in a second request.`
    );
  }
  if (!caseLimiter.check(userId).ok) {
    throw httpError(
      429,
      'slow-down',
      'You have sent several requests already. We will get to them. Try again in an hour.'
    );
  }

  await store.create({
    userId,
    userName: displayNameOf(user),
    userEmail: user.attributes?.email || '',
    topic: String(req.body?.topic || '')
      .trim()
      .slice(0, MAX_TOPIC_LENGTH),
    message,
    orderId: String(req.body?.orderId || '')
      .trim()
      .slice(0, 64),
  });
  res.status(201).json({ ok: true });
};
