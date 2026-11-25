/**
 * These tests need a running Postgres with the migrations applied (npm run dev-cc-migrate).
 * They use the database named in DATABASE_URL and remove what they add.
 */

require('../../env').configureEnv();

const crypto = require('crypto');
const db = require('../db');
const store = require('./store');
const { deliver } = require('./deliver');
const { toConversation } = require('./mapConversation');
const notifications = require('../notifications/store');

const hasDatabase = Boolean(process.env.DATABASE_URL);
const maybe = hasDatabase ? describe : describe.skip;

// Every run gets its own ids, so a run that was stopped halfway can't break the next one.
const run = crypto.randomBytes(6).toString('hex');
const id = name => `test-${run}-${name}`;

const question = (name, overrides = {}) => ({
  kind: 'order',
  contextId: id(`listing-${name}`),
  contextTitle: 'Desk lamp',
  starterId: id('buyer'),
  starterName: 'Jordan Park',
  ownerId: id('seller'),
  ownerName: 'Maya Chen',
  ...overrides,
});

const inbox = async (userId, side) => {
  const threads = await store.listFor({ userId, side });
  const messages = await store.messagesFor(threads.map(thread => thread.id));
  return threads.map(thread => toConversation(thread, messages.get(thread.id) || [], userId));
};

maybe('messaging store', () => {
  afterAll(async () => {
    const like = `test-${run}-%`;
    await db.query('delete from threads where starter_id like $1 or owner_id like $1', [like]);
    await db.query('delete from notifications where user_id like $1', [like]);
    await db.query('delete from user_settings where user_id like $1', [like]);
    await db.query('delete from user_activity where user_id like $1', [like]);
    await db.close();
  });

  it('starts one conversation about a listing, however often it is opened', async () => {
    const first = await store.create(question('once'));
    const second = await store.create(question('once'));
    expect(second.id).toBe(first.id);
  });

  it('keeps one conversation per order', async () => {
    const order = question('order', { transactionId: id('tx-order') });
    const first = await store.create(order);
    const second = await store.create(order);
    expect(second.id).toBe(first.id);
    expect((await store.findByTransaction(id('tx-order'))).id).toBe(first.id);
  });

  it('finds a direct conversation from either side', async () => {
    const thread = await store.create({
      kind: 'direct',
      starterId: id('buyer'),
      ownerId: id('seller'),
    });
    expect((await store.findDirect(id('seller'), id('buyer'))).id).toBe(thread.id);
  });

  it('shows an empty conversation only to the person who opened it', async () => {
    const thread = await store.create(question('empty'));
    await store.markRead({ threadId: thread.id, userId: id('buyer') });
    const forBuyer = await inbox(id('buyer'), 'buyer');
    const forSeller = await inbox(id('seller'), 'seller');
    expect(forBuyer.map(c => c.id)).toContain(thread.id);
    expect(forSeller.map(c => c.id)).not.toContain(thread.id);
  });

  it('delivers a message to the other person, unread, with one bell notification', async () => {
    const thread = await store.create(question('deliver'));
    await deliver({ thread, senderId: id('buyer'), body: 'Is this still available?' });
    await deliver({ thread, senderId: id('buyer'), body: 'I can pick up today.' });

    const forSeller = (await inbox(id('seller'), 'seller')).find(c => c.id === thread.id);
    expect(forSeller.unread).toBe(true);
    expect(forSeller.messages.map(m => m.text)).toEqual([
      'Is this still available?',
      'I can pick up today.',
    ]);
    expect(forSeller.messages.every(m => m.from === 'them')).toBe(true);

    // Two messages, one row on the bell, showing the newer one.
    const bell = await notifications.list({ userId: id('seller'), side: 'seller' });
    const about = bell.filter(n => n.target_id === thread.id);
    expect(about).toHaveLength(1);
    expect(about[0].title).toBe('Jordan Park');
    expect(about[0].body).toBe('I can pick up today.');
    expect(about[0].read_at).toBeNull();

    // The sender is not notified about their own message, and has nothing unread.
    const forBuyer = (await inbox(id('buyer'), 'buyer')).find(c => c.id === thread.id);
    expect(forBuyer.unread).toBe(false);
    expect(await notifications.list({ userId: id('buyer'), side: 'buyer' })).toEqual([]);
  });

  it('clears the unread mark and the bell when the conversation is opened', async () => {
    const thread = await store.create(question('read'));
    await deliver({ thread, senderId: id('buyer'), body: 'Hello' });
    await store.markRead({ threadId: thread.id, userId: id('seller') });
    await notifications.markThreadRead({ threadId: thread.id, userId: id('seller') });

    const forSeller = (await inbox(id('seller'), 'seller')).find(c => c.id === thread.id);
    expect(forSeller.unread).toBe(false);
    const bell = await notifications.list({ userId: id('seller'), side: 'seller' });
    expect(bell.find(n => n.target_id === thread.id).read_at).not.toBeNull();
  });

  it('stores a message from Sharetribe once, however often it arrives', async () => {
    const thread = await store.create(question('mirror', { transactionId: id('tx-mirror') }));
    const copy = {
      thread,
      senderId: id('seller'),
      body: 'Ready when you are.',
      sharetribeId: id('message-1'),
      createdAt: '2026-11-20T18:00:00.000Z',
    };
    const first = await deliver(copy);
    const second = await deliver(copy);
    expect(first.body).toBe('Ready when you are.');
    expect(second).toBeNull();
    expect(await store.hasSharetribeMessage(id('message-1'))).toBe(true);
    const messages = await store.messagesFor([thread.id]);
    expect(messages.get(thread.id)).toHaveLength(1);
  });

  it('brings a conversation back from done when a new message arrives', async () => {
    const thread = await store.create(question('done'));
    await deliver({ thread, senderId: id('buyer'), body: 'First' });
    await store.setDone({ threadId: thread.id, userId: id('seller'), done: true });
    expect((await store.findFor({ threadId: thread.id, userId: id('seller') })).done).toBe(true);
    await deliver({ thread, senderId: id('buyer'), body: 'One more thing' });
    expect((await store.findFor({ threadId: thread.id, userId: id('seller') })).done).toBe(false);
  });

  it('does not show a conversation to someone who is not in it', async () => {
    const thread = await store.create(question('private'));
    expect(await store.findFor({ threadId: thread.id, userId: id('stranger') })).toBeNull();
    expect(await store.findFor({ threadId: 'not-a-number', userId: id('buyer') })).toBeNull();
  });

  it('leaves the bell alone when someone switched message notifications off', async () => {
    await notifications.updateSettings(id('quiet-seller'), { notifyMessages: false });
    const thread = await store.create(question('quiet', { ownerId: id('quiet-seller') }));
    await deliver({ thread, senderId: id('buyer'), body: 'Hello' });
    expect(await notifications.list({ userId: id('quiet-seller'), side: 'seller' })).toEqual([]);
    // The message itself still arrives.
    const forSeller = await inbox(id('quiet-seller'), 'seller');
    expect(forSeller.find(c => c.id === thread.id).unread).toBe(true);
  });

  it('moves the changed-at clock for both people when a message is sent', async () => {
    const thread = await store.create(
      question('clock', { starterId: id('clock-buyer'), ownerId: id('clock-seller') })
    );
    expect(await notifications.changedAt(id('clock-buyer'))).toBeNull();
    await deliver({ thread, senderId: id('clock-buyer'), body: 'Hello' });
    expect(await notifications.changedAt(id('clock-buyer'))).not.toBeNull();
    expect(await notifications.changedAt(id('clock-seller'))).not.toBeNull();
  });
});
