/**
 * The inbox routes, run against a real Postgres with Sharetribe replaced by a stand-in.
 * Needs the migrations applied (npm run dev-cc-migrate). Removes what it adds.
 */

require('../../env').configureEnv();

jest.mock('./requireUser', () => ({
  requireUser: jest.fn(),
  requireApprovedUser: jest.fn(),
}));

const crypto = require('crypto');
const db = require('../db');
const { requireUser, requireApprovedUser } = require('./requireUser');
const conversations = require('./conversations');
const notifications = require('../notifications/store');
const notifyEvents = require('../events/handlers/notifyEvents');

const hasDatabase = Boolean(process.env.DATABASE_URL);
const maybe = hasDatabase ? describe : describe.skip;

// Sharetribe ids are UUIDs, and the routes check that. Every run makes its own.
const uuid = () => crypto.randomUUID();
const BUYER = uuid();
const SELLER = uuid();
const STRANGER = uuid();
const LISTING = uuid();

const person = (id, displayName) => ({
  id: { uuid: id },
  type: 'user',
  attributes: { state: 'active', profile: { displayName } },
});

const PEOPLE = {
  [BUYER]: person(BUYER, 'Jordan P'),
  [SELLER]: person(SELLER, 'Maya C'),
  [STRANGER]: person(STRANGER, 'Sam T'),
};

const listing = {
  id: { uuid: LISTING },
  type: 'listing',
  attributes: {
    title: 'Desk lamp',
    publicData: { kind: 'product', transactionProcessAlias: 'default-purchase/release-1' },
  },
  relationships: { author: { data: { type: 'user', id: { uuid: SELLER } } } },
};

// What Sharetribe would have been asked to do.
let sharetribe;

const fakeSdk = () => ({
  listings: {
    show: jest.fn(async ({ id }) => {
      if (id.uuid !== LISTING) throw Object.assign(new Error('not found'), { status: 404 });
      return { data: { data: listing, included: [PEOPLE[SELLER]] } };
    }),
  },
  users: {
    show: jest.fn(async ({ id }) => {
      if (!PEOPLE[id.uuid]) throw Object.assign(new Error('not found'), { status: 404 });
      return { data: { data: PEOPLE[id.uuid] } };
    }),
  },
  transactions: {
    initiate: jest.fn(async params => {
      const transactionId = uuid();
      sharetribe.inquiries.push({ ...params, transactionId });
      return { data: { data: { id: { uuid: transactionId } } } };
    }),
  },
  messages: {
    send: jest.fn(async ({ transactionId, content }) => {
      const message = { id: uuid(), transactionId: transactionId.uuid, content };
      sharetribe.messages.push(message);
      return {
        data: { data: { id: { uuid: message.id }, attributes: { createdAt: new Date() } } },
      };
    }),
  },
});

// Runs one route as one student and returns what it answered.
const call = async (handler, userId, { body = {}, params = {}, query = {} } = {}) => {
  const signedIn = { sdk: fakeSdk(), user: PEOPLE[userId], userId };
  requireUser.mockResolvedValue(signedIn);
  requireApprovedUser.mockResolvedValue(signedIn);
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  await handler({ body, params, query }, res);
  return { status: res.statusCode, sdk: signedIn.sdk, ...res.body };
};

const inboxOf = async (userId, side) =>
  (await call(conversations.list, userId, { query: { side } })).conversations;

maybe('conversation routes', () => {
  beforeEach(() => {
    sharetribe = { inquiries: [], messages: [] };
  });

  afterAll(async () => {
    const people = [BUYER, SELLER, STRANGER];
    await db.query('delete from threads where starter_id = any($1) or owner_id = any($1)', [
      people,
    ]);
    await db.query('delete from notifications where user_id = any($1)', [people]);
    await db.query('delete from user_activity where user_id = any($1)', [people]);
    await db.close();
  });

  let conversationId;

  it('opens a question about a listing without telling the seller or Sharetribe anything', async () => {
    const opened = await call(conversations.open, BUYER, { body: { listingId: LISTING } });
    conversationId = opened.conversation.id;

    expect(opened.status).toBe(201);
    expect(opened.conversation).toMatchObject({
      name: 'Maya C',
      context: 'Desk lamp',
      sellerId: SELLER,
      listingId: LISTING,
      orderId: null,
      unread: false,
      messages: [],
    });
    expect(sharetribe.inquiries).toEqual([]);
    expect((await inboxOf(BUYER, 'buyer')).map(c => c.id)).toContain(conversationId);
    expect(await inboxOf(SELLER, 'seller')).toEqual([]);
    expect(await notifications.list({ userId: SELLER, side: 'seller' })).toEqual([]);
  });

  it('gives back the same conversation when the listing is opened again', async () => {
    const again = await call(conversations.open, BUYER, { body: { listingId: LISTING } });
    expect(again.conversation.id).toBe(conversationId);
  });

  it('starts a Sharetribe inquiry with the first message, and sends the message through it', async () => {
    const sent = await call(conversations.send, BUYER, {
      params: { id: conversationId },
      body: { text: '  Is this still available?  ' },
    });

    expect(sharetribe.inquiries).toHaveLength(1);
    expect(sharetribe.inquiries[0]).toMatchObject({
      processAlias: 'default-purchase/release-1',
      transition: 'transition/inquire',
      params: { listingId: { uuid: LISTING } },
    });
    expect(sharetribe.messages).toEqual([
      expect.objectContaining({
        transactionId: sharetribe.inquiries[0].transactionId,
        content: 'Is this still available?',
      }),
    ]);
    expect(sent.conversation.orderId).toBe(sharetribe.inquiries[0].transactionId);
    expect(sent.conversation.messages).toEqual([
      expect.objectContaining({ from: 'me', text: 'Is this still available?' }),
    ]);
  });

  it('shows the seller the message, unread, in Seller Hub and on the bell', async () => {
    const [forSeller] = await inboxOf(SELLER, 'seller');
    expect(forSeller).toMatchObject({ id: conversationId, name: 'Jordan P', unread: true });
    expect(forSeller.messages[0]).toMatchObject({ from: 'them', text: 'Is this still available?' });
    // It is a seller conversation, so it is not on the seller's buyer pages.
    expect(await inboxOf(SELLER, 'buyer')).toEqual([]);

    const bell = await notifications.list({ userId: SELLER, side: 'seller' });
    expect(bell).toHaveLength(1);
    expect(bell[0]).toMatchObject({
      title: 'Jordan P',
      action: 'inbox',
      target_id: conversationId,
    });
    expect(bell[0].read_at).toBeNull();
  });

  it('reuses the inquiry for the reply instead of starting another', async () => {
    const reply = await call(conversations.send, SELLER, {
      params: { id: conversationId },
      body: { text: 'Yes, it is!' },
    });
    expect(sharetribe.inquiries).toEqual([]);
    expect(reply.sdk.transactions.initiate).not.toHaveBeenCalled();
    expect(sharetribe.messages[0].transactionId).toBe(reply.conversation.orderId);
    expect(reply.conversation.messages.map(m => [m.from, m.text])).toEqual([
      ['them', 'Is this still available?'],
      ['me', 'Yes, it is!'],
    ]);
  });

  it('does not store a message twice when the worker sees it in the event feed', async () => {
    const [before] = await inboxOf(BUYER, 'buyer');
    const { rows } = await db.query(
      'select sharetribe_id, sender_id from messages where thread_id = $1 order by id',
      [conversationId]
    );
    // The same two messages, as Sharetribe reports them afterwards.
    for (const row of rows) {
      await notifyEvents({
        attributes: {
          eventType: 'message/created',
          resource: {
            id: { uuid: row.sharetribe_id },
            type: 'message',
            attributes: {
              content: 'whatever Sharetribe says',
              createdAt: new Date().toISOString(),
            },
            relationships: {
              sender: { data: { type: 'user', id: { uuid: row.sender_id } } },
              transaction: { data: { type: 'transaction', id: { uuid: before.orderId } } },
            },
          },
        },
      });
    }
    const [after] = await inboxOf(BUYER, 'buyer');
    expect(after.messages).toEqual(before.messages);
  });

  it('copies in a message that reached Sharetribe some other way', async () => {
    const [before] = await inboxOf(BUYER, 'buyer');
    await notifyEvents({
      attributes: {
        eventType: 'message/created',
        resource: {
          id: { uuid: uuid() },
          type: 'message',
          attributes: {
            content: 'Your order is ready for pickup.',
            createdAt: new Date().toISOString(),
          },
          relationships: {
            sender: { data: { type: 'user', id: { uuid: SELLER } } },
            transaction: { data: { type: 'transaction', id: { uuid: before.orderId } } },
          },
        },
      },
    });
    const [after] = await inboxOf(BUYER, 'buyer');
    expect(after.messages).toHaveLength(before.messages.length + 1);
    expect(after.messages.at(-1)).toMatchObject({
      from: 'them',
      text: 'Your order is ready for pickup.',
    });
    expect(after.unread).toBe(true);
  });

  it('marks a conversation read and clears its notification', async () => {
    await call(conversations.markRead, BUYER, { params: { id: conversationId } });
    const [forBuyer] = await inboxOf(BUYER, 'buyer');
    expect(forBuyer.unread).toBe(false);
    const bell = await notifications.list({ userId: BUYER, side: 'buyer' });
    expect(bell.every(n => n.read_at)).toBe(true);
  });

  it('lets the seller mark a conversation done', async () => {
    await call(conversations.setDone, SELLER, {
      params: { id: conversationId },
      body: { done: true },
    });
    expect((await inboxOf(SELLER, 'seller'))[0].done).toBe(true);
    // Done is each person's own. The buyer's copy is untouched.
    expect((await inboxOf(BUYER, 'buyer'))[0].done).toBe(false);
  });

  it('keeps everyone else out of a conversation', async () => {
    const asStranger = handler =>
      call(handler, STRANGER, { params: { id: conversationId }, body: { text: 'Hi', done: true } });
    await expect(asStranger(conversations.send)).rejects.toMatchObject({ status: 404 });
    await expect(asStranger(conversations.markRead)).rejects.toMatchObject({ status: 404 });
    await expect(asStranger(conversations.setDone)).rejects.toMatchObject({ status: 404 });
    expect(await inboxOf(STRANGER, 'buyer')).toEqual([]);
    expect(await inboxOf(STRANGER, 'seller')).toEqual([]);
  });

  it('refuses an empty message, a huge one, and a question about your own listing', async () => {
    const send = text =>
      call(conversations.send, BUYER, { params: { id: conversationId }, body: { text } });
    await expect(send('   ')).rejects.toMatchObject({ code: 'message-required' });
    await expect(send('x'.repeat(2001))).rejects.toMatchObject({ code: 'message-too-long' });
    await expect(
      call(conversations.open, SELLER, { body: { listingId: LISTING } })
    ).rejects.toMatchObject({ code: 'own-listing' });
    expect(sharetribe.messages).toEqual([]);
  });

  it('answers 404 for a listing or student that does not exist', async () => {
    await expect(
      call(conversations.open, BUYER, { body: { listingId: uuid() } })
    ).rejects.toMatchObject({ status: 404, code: 'listing-not-found' });
    await expect(
      call(conversations.open, BUYER, { body: { listingId: 'not-an-id' } })
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      call(conversations.open, BUYER, { body: { sellerId: uuid() } })
    ).rejects.toMatchObject({ status: 404, code: 'student-not-found' });
    await expect(call(conversations.open, BUYER, { body: {} })).rejects.toMatchObject({
      code: 'nothing-to-open',
    });
  });

  it('keeps a direct conversation in Postgres only, and finds it from either side', async () => {
    const opened = await call(conversations.open, STRANGER, { body: { sellerId: SELLER } });
    const sent = await call(conversations.send, STRANGER, {
      params: { id: opened.conversation.id },
      body: { text: 'Do you take custom orders?' },
    });
    expect(sharetribe.inquiries).toEqual([]);
    expect(sharetribe.messages).toEqual([]);
    expect(sent.conversation.context).toBe('Direct message');

    // The seller answering from their side lands in the same conversation.
    const fromSeller = await call(conversations.open, SELLER, { body: { sellerId: STRANGER } });
    expect(fromSeller.conversation.id).toBe(opened.conversation.id);
    expect(fromSeller.conversation.messages).toHaveLength(1);
  });
});
