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

// Every run gets its own ids, so a run that was stopped halfway can't break the next one.
const run = crypto.randomBytes(6).toString('hex');
const id = name => `test-${run}-${name}`;

const order = (name, overrides = {}) => ({
  transactionId: id(name),
  listingId: id('event'),
  sellerId: id('host'),
  buyerId: id('buyer'),
  buyerName: 'Jordan P',
  listingTitle: 'Open studio night',
  eventStartsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  ...overrides,
});

maybe('ticket store', () => {
  afterAll(async () => {
    await db.query('delete from tickets where transaction_id like $1', [`test-${run}-%`]);
    await db.query('delete from event_door_helpers where listing_id like $1', [`test-${run}-%`]);
    await db.close();
  });

  it('issues one ticket for an order, however often it is asked', async () => {
    const first = await store.issue(order('issue'));
    const second = await store.issue(order('issue'));
    expect(first.status).toBe('issued');
    expect(first.code).toMatch(/^[2-9A-HJ-NP-Z]{10}$/);
    expect(second.code).toBe(first.code);
  });

  it('lets the host scan a ticket once', async () => {
    const ticket = await store.issue(order('scan-once'));
    const first = await store.scan({ code: ticket.code, scannerId: id('host') });
    const second = await store.scan({ code: ticket.code, scannerId: id('host') });
    expect(first.result).toBe('ok');
    expect(first.ticket.used_by).toBe(id('host'));
    expect(second.result).toBe('used');
  });

  it('lets only one of two scans at the same moment win', async () => {
    const ticket = await store.issue(order('scan-race'));
    const results = await Promise.all(
      Array.from({ length: 8 }, () => store.scan({ code: ticket.code, scannerId: id('host') }))
    );
    expect(results.filter(scan => scan.result === 'ok')).toHaveLength(1);
    expect(results.filter(scan => scan.result === 'used')).toHaveLength(7);
  });

  it('hides a ticket from someone who does not run the event', async () => {
    const ticket = await store.issue(order('scan-stranger'));
    const scan = await store.scan({ code: ticket.code, scannerId: id('stranger') });
    expect(scan).toEqual({ result: 'unknown', ticket: null });
    expect((await store.findByTransaction(id('scan-stranger'))).status).toBe('issued');
  });

  it('lets a door helper scan until the host removes them', async () => {
    const helper = {
      listingId: id('event'),
      hostId: id('host'),
      helperUserId: id('helper'),
      helperName: 'Sam O',
      helperEmail: 'sam@sdsu.edu',
    };
    expect(await store.addHelper(helper)).toBe('added');
    expect(await store.eventsHelpedBy(id('helper'))).toEqual([id('event')]);
    expect(await store.helpersOfHost(id('host'))).toEqual([
      {
        listing_id: id('event'),
        helper_user_id: id('helper'),
        helper_name: 'Sam O',
        helper_email: 'sam@sdsu.edu',
      },
    ]);

    const first = await store.issue(order('helper-1'));
    expect((await store.scan({ code: first.code, scannerId: id('helper') })).result).toBe('ok');

    // Someone else can't remove the host's helper.
    await store.removeHelper({ ...helper, hostId: id('stranger') });
    expect(await store.eventsHelpedBy(id('helper'))).toEqual([id('event')]);

    await store.removeHelper(helper);
    const second = await store.issue(order('helper-2'));
    expect((await store.scan({ code: second.code, scannerId: id('helper') })).result).toBe(
      'unknown'
    );
  });

  it('cancels a ticket that has not been scanned, and can undo that', async () => {
    const ticket = await store.issue(order('void'));
    expect(await store.voidUnused(id('void'))).toBe('voided');
    expect((await store.scan({ code: ticket.code, scannerId: id('host') })).result).toBe('void');
    expect(await store.voidUnused(id('void'))).toBe('void');

    await store.restore(id('void'));
    expect((await store.scan({ code: ticket.code, scannerId: id('host') })).result).toBe('ok');
  });

  it('leaves a scanned ticket alone when asked to cancel it', async () => {
    const ticket = await store.issue(order('void-used'));
    await store.scan({ code: ticket.code, scannerId: id('host') });
    expect(await store.voidUnused(id('void-used'))).toBe('used');
    expect(await store.voidUnused(id('no-such-order'))).toBe('none');
  });

  it('finds the orders that are due to be completed', async () => {
    const hoursAgo = hours => new Date(Date.now() - hours * 60 * 60 * 1000);
    const scanned = await store.issue(order('due-scanned'));
    await store.scan({ code: scanned.code, scannerId: id('host') });
    await store.issue(order('due-no-show', { eventStartsAt: hoursAgo(7) }));
    await store.issue(order('not-due-recent', { eventStartsAt: hoursAgo(2) }));
    await store.issue(order('not-due-upcoming'));
    await store.issue(order('not-due-void', { eventStartsAt: hoursAgo(7) }));
    await store.voidUnused(id('not-due-void'));
    await store.issue(order('not-due-done', { eventStartsAt: hoursAgo(7) }));
    await store.markCompleted(id('not-due-done'));
    await store.issue(order('not-due-just-failed', { eventStartsAt: hoursAgo(7) }));
    await store.markCompletionChecked(id('not-due-just-failed'));

    const due = (await store.dueForCompletion(1000))
      .map(ticket => ticket.transaction_id)
      // Leave out what the other tests in this file, and other runs, left to be completed.
      .filter(transactionId => transactionId.startsWith(`test-${run}-`))
      .filter(transactionId => transactionId.includes('due-'));
    expect(due.sort()).toEqual([id('due-no-show'), id('due-scanned')]);
  });

  it('counts the tickets sold and used for each event', async () => {
    const listingId = id('counted-event');
    const a = await store.issue(order('count-a', { listingId }));
    await store.issue(order('count-b', { listingId }));
    await store.issue(order('count-c', { listingId }));
    await store.scan({ code: a.code, scannerId: id('host') });
    await store.voidUnused(id('count-c'));

    const counts = await store.countsByListing([listingId, id('empty-event')]);
    expect(counts.get(listingId)).toEqual({ sold: 2, used: 1 });
    expect(counts.has(id('empty-event'))).toBe(false);
  });

  it('follows the event when its title or time changes', async () => {
    const listingId = id('moved-event');
    await store.issue(order('moved', { listingId }));
    const startsAt = new Date('2027-01-15T03:00:00Z');
    await store.updateEvent({
      listingId,
      listingTitle: 'Winter showcase',
      eventStartsAt: startsAt,
    });

    const ticket = await store.findByTransaction(id('moved'));
    expect(ticket.listing_title).toBe('Winter showcase');
    expect(ticket.event_starts_at).toEqual(startsAt);
  });
});
