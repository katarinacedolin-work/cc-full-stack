/**
 * The inbox: opening conversations, reading them, and sending messages.
 *
 * A conversation about a listing or an order is carried by a Sharetribe transaction, so
 * Sharetribe emails the other person when a message arrives. The first message about a listing
 * starts that transaction as an inquiry. Every other conversation lives in Postgres only.
 */

const { types } = require('sharetribe-flex-sdk');
const { httpError } = require('../auth/httpError');
const { createRateLimiter } = require('../auth/rateLimit');
const log = require('../../log');
const { displayNameOf } = require('../people');
const { processAliasFor } = require('../listings/mapListing');
const store = require('../messaging/store');
const { deliver } = require('../messaging/deliver');
const { toConversation } = require('../messaging/mapConversation');
const { threadFromTransaction } = require('../messaging/fromTransaction');
const notifications = require('../notifications/store');
const { requireUser, requireApprovedUser } = require('./requireUser');

const { UUID } = types;

const MAX_MESSAGE_LENGTH = 2000;

// Fast enough for a real chat, slow enough that a script can't flood someone's inbox.
const sendLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30 });
const openLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30 });

const sideOf = req => (req.query.side === 'seller' ? 'seller' : 'buyer');

const asUuid = (value, error) => {
  const id = String(value || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw error;
  return new UUID(id);
};

const notFound = () => httpError(404, 'conversation-not-found', 'That conversation is not here.');

// The conversation, if the signed-in student is one of the two people in it.
const threadFor = async (threadId, userId) => {
  const thread = await store.findFor({ threadId, userId });
  if (!thread) throw notFound();
  return thread;
};

const respondWith = async (res, threadId, userId, status = 200) => {
  const thread = await threadFor(threadId, userId);
  const messages = await store.messagesFor([thread.id]);
  res
    .status(status)
    .json({ conversation: toConversation(thread, messages.get(thread.id) || [], userId) });
};

/**
 * GET /api/cc/conversations?side=buyer|seller
 */
exports.list = async (req, res) => {
  const { userId } = await requireUser(req, res);
  const threads = await store.listFor({ userId, side: sideOf(req) });
  const messages = await store.messagesFor(threads.map(thread => thread.id));
  res.json({
    conversations: threads.map(thread =>
      toConversation(thread, messages.get(thread.id) || [], userId)
    ),
  });
};

const openForOrder = async ({ sdk, orderId }) => {
  const missing = httpError(404, 'order-not-found', 'That order is no longer here.');
  let response;
  try {
    // Sharetribe only shows a transaction to the two people in it.
    response = await sdk.transactions.show({
      id: asUuid(orderId, missing),
      include: ['listing', 'customer', 'provider'],
    });
  } catch (e) {
    throw missing;
  }
  const tx = response.data.data;
  return (
    (await store.findByTransaction(tx.id.uuid)) ||
    store.create(threadFromTransaction(tx, response.data.included || []))
  );
};

const openForListing = async ({ sdk, user, userId, listingId }) => {
  const missing = httpError(404, 'listing-not-found', 'That listing is no longer here.');
  let response;
  try {
    response = await sdk.listings.show({ id: asUuid(listingId, missing), include: ['author'] });
  } catch (e) {
    throw missing;
  }
  const listing = response.data.data;
  const authorId = listing.relationships?.author?.data?.id?.uuid;
  if (!authorId) throw missing;
  if (authorId === userId) {
    throw httpError(400, 'own-listing', 'This is your own listing.');
  }
  const existing = await store.findForListing({ listingId: listing.id.uuid, starterId: userId });
  if (existing) return existing;

  const author = (response.data.included || []).find(
    entity => entity.type === 'user' && entity.id.uuid === authorId
  );
  return store.create({
    kind: 'order',
    contextId: listing.id.uuid,
    contextTitle: listing.attributes.title || '',
    starterId: userId,
    starterName: displayNameOf(user),
    ownerId: authorId,
    ownerName: displayNameOf(author),
  });
};

const openDirect = async ({ sdk, user, userId, sellerId }) => {
  const missing = httpError(
    404,
    'student-not-found',
    'That student is no longer on Campus Connect.'
  );
  if (String(sellerId) === userId) {
    throw httpError(400, 'own-profile', 'This is your own profile.');
  }
  let other;
  try {
    other = (await sdk.users.show({ id: asUuid(sellerId, missing) })).data.data;
  } catch (e) {
    throw missing;
  }
  if (other.attributes?.banned || other.attributes?.deleted) throw missing;

  return (
    (await store.findDirect(userId, other.id.uuid)) ||
    store.create({
      kind: 'direct',
      starterId: userId,
      starterName: displayNameOf(user),
      ownerId: other.id.uuid,
      ownerName: displayNameOf(other),
    })
  );
};

/**
 * POST /api/cc/conversations
 * Body: { orderId } | { listingId } | { sellerId }
 * Finds the conversation about that order, that listing, or with that seller, and starts one
 * when there is none. Nothing reaches the other person until a message is sent.
 */
exports.open = async (req, res) => {
  const { sdk, user, userId } = await requireApprovedUser(req, res);
  if (!openLimiter.check(userId).ok) {
    throw httpError(429, 'slow-down', 'That was a lot at once. Wait a moment and try again.');
  }
  const { orderId, listingId, sellerId } = req.body || {};

  let thread;
  if (orderId) thread = await openForOrder({ sdk, orderId });
  else if (listingId) thread = await openForListing({ sdk, user, userId, listingId });
  else if (sellerId) thread = await openDirect({ sdk, user, userId, sellerId });
  else throw httpError(400, 'nothing-to-open', 'Pick who to message first.');
  if (!thread) throw notFound();

  // Having it open is what makes an empty conversation show up in this person's inbox.
  await store.markRead({ threadId: thread.id, userId });
  await notifications.markThreadRead({ threadId: thread.id, userId });
  await respondWith(res, thread.id, userId, 201);
};

// The first message about a listing starts a Sharetribe transaction to carry the conversation.
const startInquiry = async (sdk, thread) => {
  const gone = httpError(
    409,
    'listing-unavailable',
    'This listing is not available right now, so its seller cannot be messaged about it.'
  );
  let listing;
  try {
    listing = (await sdk.listings.show({ id: new UUID(thread.context_id) })).data.data;
  } catch (e) {
    throw gone;
  }
  try {
    const response = await sdk.transactions.initiate({
      processAlias: processAliasFor(listing),
      transition: 'transition/inquire',
      params: { listingId: listing.id },
    });
    return response.data.data.id.uuid;
  } catch (e) {
    log.error(e, 'cc-inquiry-failed', { listingId: thread.context_id });
    throw gone;
  }
};

/**
 * POST /api/cc/conversations/:id/messages
 * Body: { text }
 */
exports.send = async (req, res) => {
  const { sdk, userId } = await requireApprovedUser(req, res);
  const text = String(req.body?.text || '').trim();
  if (!text) throw httpError(400, 'message-required', 'Write a message first.');
  if (text.length > MAX_MESSAGE_LENGTH) {
    throw httpError(
      400,
      'message-too-long',
      `Keep a message under ${MAX_MESSAGE_LENGTH} characters.`
    );
  }
  if (!sendLimiter.check(userId).ok) {
    throw httpError(429, 'slow-down', 'You are sending messages very fast. Wait a moment.');
  }

  let thread = await threadFor(req.params.id, userId);

  if (thread.kind === 'order') {
    if (!thread.transaction_id) {
      // Only the buyer can turn a question into a Sharetribe inquiry.
      if (thread.starter_id !== userId) throw notFound();
      const transactionId = await startInquiry(sdk, thread);
      thread = await store.attachTransaction(thread.id, transactionId);
    }
    let sent;
    try {
      sent = await sdk.messages.send({
        transactionId: new UUID(thread.transaction_id),
        content: text,
      });
    } catch (e) {
      log.error(e, 'cc-message-send-failed', { threadId: thread.id });
      throw httpError(502, 'send-failed', 'That message could not be sent. Try again.');
    }
    const message = sent.data.data;
    await deliver({
      thread,
      senderId: userId,
      body: text,
      sharetribeId: message.id.uuid,
      createdAt: message.attributes?.createdAt || null,
    });
  } else {
    await deliver({ thread, senderId: userId, body: text });
  }

  await respondWith(res, thread.id, userId, 201);
};

/**
 * POST /api/cc/conversations/:id/read
 */
exports.markRead = async (req, res) => {
  const { userId } = await requireUser(req, res);
  const thread = await threadFor(req.params.id, userId);
  await store.markRead({ threadId: thread.id, userId });
  await notifications.markThreadRead({ threadId: thread.id, userId });
  res.json({ ok: true });
};

/**
 * POST /api/cc/conversations/:id/done
 * Body: { done }
 */
exports.setDone = async (req, res) => {
  const { userId } = await requireUser(req, res);
  const thread = await threadFor(req.params.id, userId);
  await store.setDone({ threadId: thread.id, userId, done: req.body?.done === true });
  res.json({ ok: true });
};
