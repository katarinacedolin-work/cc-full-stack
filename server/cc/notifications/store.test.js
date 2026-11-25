/**
 * These tests need a running Postgres with the migrations applied (npm run dev-cc-migrate).
 * They use the database named in DATABASE_URL and remove what they add.
 */

require('../../env').configureEnv();

const crypto = require('crypto');
const db = require('../db');
const store = require('./store');

const hasDatabase = Boolean(process.env.DATABASE_URL);
const maybe = hasDatabase ? describe : describe.skip;

const run = crypto.randomBytes(6).toString('hex');
const id = name => `test-${run}-${name}`;

const notification = (userId, overrides = {}) => ({
  userId,
  side: 'seller',
  category: 'orders',
  setting: 'notifyRequests',
  title: 'New order',
  body: 'Jordan P · Desk lamp',
  emoji: '💡',
  accent: 'butter',
  action: 'order',
  targetId: id('tx'),
  ...overrides,
});

maybe('notification store', () => {
  afterAll(async () => {
    const like = `test-${run}-%`;
    await db.query('delete from notifications where user_id like $1', [like]);
    await db.query('delete from user_settings where user_id like $1', [like]);
    await db.query('delete from user_activity where user_id like $1', [like]);
    await db.close();
  });

  it('has every kind of notification on until someone switches one off', async () => {
    expect(await store.getSettings(id('new'))).toEqual({
      notifyMessages: true,
      notifyOrders: true,
      notifyRequests: true,
      notifyReviews: true,
    });
  });

  it('changes only the settings it is given, and ignores anything else', async () => {
    const settings = await store.updateSettings(id('picky'), {
      notifyReviews: false,
      notifyOrders: 'no',
      isAdmin: true,
    });
    expect(settings).toEqual({
      notifyMessages: true,
      notifyOrders: true,
      notifyRequests: true,
      notifyReviews: false,
    });
    expect((await store.updateSettings(id('picky'), { notifyReviews: true })).notifyReviews).toBe(
      true
    );
  });

  it('writes the same notification once, however often the worker repeats an event', async () => {
    const user = id('repeat');
    const first = await store.write(notification(user, { dedupeKey: id('key') }));
    const second = await store.write(notification(user, { dedupeKey: id('key') }));
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(await store.list({ userId: user, side: 'seller' })).toHaveLength(1);
  });

  it('skips a kind of notification the person switched off', async () => {
    const user = id('off');
    await store.updateSettings(user, { notifyRequests: false });
    expect(await store.write(notification(user))).toBe(false);
    expect(await store.write(notification(user, { setting: 'notifyReviews' }))).toBe(true);
  });

  it('keeps the buyer pages and Seller Hub apart', async () => {
    const user = id('sides');
    await store.write(notification(user, { side: 'buyer', setting: 'notifyOrders' }));
    await store.write(notification(user, { side: 'seller' }));
    expect(await store.list({ userId: user, side: 'buyer' })).toHaveLength(1);
    await store.markAllRead({ userId: user, side: 'buyer' });
    const [stillUnread] = await store.list({ userId: user, side: 'seller' });
    expect(stillUnread.read_at).toBeNull();
  });

  it('only lets a person mark their own notifications read', async () => {
    const user = id('owner');
    await store.write(notification(user));
    const [row] = await store.list({ userId: user, side: 'seller' });
    await store.markRead({ id: row.id, userId: id('someone-else') });
    expect((await store.list({ userId: user, side: 'seller' }))[0].read_at).toBeNull();
    await store.markRead({ id: row.id, userId: user });
    expect((await store.list({ userId: user, side: 'seller' }))[0].read_at).not.toBeNull();
  });

  it('refuses a notification with no setting behind it', async () => {
    await expect(
      store.write(notification(id('bad'), { setting: 'notifyEverything' }))
    ).rejects.toThrow('Unknown notification setting');
  });

  it('moves the changed-at clock forward each time something changes', async () => {
    const user = id('clock');
    expect(await store.changedAt(user)).toBeNull();
    await store.touch([user, user, null]);
    const first = await store.changedAt(user);
    await new Promise(resolve => setTimeout(resolve, 15));
    await store.touch([user]);
    const second = await store.changedAt(user);
    expect(new Date(second).getTime()).toBeGreaterThan(new Date(first).getTime());
  });
});
