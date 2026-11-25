/**
 * Scanning tickets at the door, and the students a host lets scan with them.
 */

const { types } = require('sharetribe-flex-sdk');
const { getSdk } = require('../../api-util/sdk');
const { getIntegrationSdk } = require('../integrationSdk');
const { httpError } = require('../auth/httpError');
const { isSdsuEmail } = require('../auth/sdsu');
const { createRateLimiter } = require('../auth/rateLimit');
const log = require('../../log');
const { toSlot, toDayLabel, campusDateKey } = require('../time');
const { normalizeCode } = require('../tickets/code');
const { completeOrder } = require('../tickets/complete');
const store = require('../tickets/store');
const notifications = require('../notifications/store');
const { displayNameOf } = require('../people');

const { UUID } = types;

// A notification is extra. Scanning and adding helpers work without it.
const notifyQuietly = async (notification, alsoReload = []) => {
  try {
    await notifications.write(notification);
    await notifications.touch([notification.userId, ...alsoReload]);
  } catch (e) {
    log.error(e, 'cc-ticket-notification-failed', { dedupeKey: notification.dedupeKey });
  }
};

// A busy door scans a ticket every second or two. This only stops someone guessing codes.
const scanLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 120 });

const requireUser = async (req, res) => {
  const sdk = getSdk(req, res);
  try {
    const response = await sdk.currentUser.show();
    return { sdk, user: response.data.data };
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      throw httpError(401, 'sign-in-required', 'Sign in to continue.');
    }
    throw e;
  }
};

const whenLabel = value => {
  const { date, time } = toSlot(value);
  return date === campusDateKey() ? `at ${time}` : `on ${toDayLabel(value)} at ${time}`;
};

const eventWhen = startsAt =>
  startsAt ? `${toDayLabel(startsAt)} · ${toSlot(startsAt).time}` : '';

/**
 * POST /api/cc/tickets/scan
 * Body: { code }
 * Answers { ok, title, message }. A valid ticket is marked used.
 */
exports.scan = async (req, res) => {
  const { user } = await requireUser(req, res);
  const scannerId = user.id.uuid;

  const limit = scanLimiter.check(scannerId);
  if (!limit.ok) {
    throw httpError(429, 'too-many-scans', 'Too many scans at once. Wait a moment and try again.');
  }

  const unknown = {
    ok: false,
    title: 'No ticket found',
    message: 'That code is not a ticket for one of your events.',
  };
  const code = normalizeCode(req.body?.code);
  if (!code) {
    res.json(unknown);
    return;
  }

  const { result, ticket } = await store.scan({ code, scannerId });

  if (result === 'ok') {
    // Completing the order pays the seller. The door doesn't wait for it, and the worker
    // finishes it if this try fails.
    if (!ticket.completed_at) {
      completeOrder(getIntegrationSdk(), ticket).catch(e =>
        log.error(e, 'cc-ticket-complete-after-scan-failed', {
          transactionId: ticket.transaction_id,
        })
      );
    }
    // The buyer sees their ticket was used. If it wasn't them at the door, they know at once.
    notifyQuietly({
      userId: ticket.buyer_id,
      side: 'buyer',
      category: 'orders',
      setting: 'notifyOrders',
      title: 'Ticket scanned',
      body: [ticket.listing_title, 'Enjoy the event.'].filter(Boolean).join(' · '),
      emoji: '🎟️',
      accent: 'coral',
      action: 'order',
      targetId: ticket.transaction_id,
      dedupeKey: `tx:${ticket.transaction_id}:scanned:buyer`,
    });
    res.json({
      ok: true,
      title: 'Marked used',
      message: [ticket.buyer_name, ticket.listing_title].filter(Boolean).join(' · ') || code,
    });
    return;
  }
  if (result === 'used') {
    res.json({
      ok: false,
      title: 'Already used',
      message: `This ticket was scanned ${whenLabel(ticket.used_at)}.`,
    });
    return;
  }
  if (result === 'void') {
    res.json({
      ok: false,
      title: 'Cancelled ticket',
      message: 'This ticket was cancelled and refunded.',
    });
    return;
  }
  res.json(unknown);
};

/**
 * GET /api/cc/tickets/door
 * The events the signed-in student can scan tickets for, as the host or as a door helper.
 */
exports.door = async (req, res) => {
  const { sdk, user } = await requireUser(req, res);
  const userId = user.id.uuid;

  const own = await sdk.ownListings.query({ states: ['published', 'closed'], perPage: 100 });
  const hosted = own.data.data.filter(listing => {
    const publicData = listing.attributes.publicData || {};
    return publicData.kind === 'ticket' && !publicData.deleted;
  });

  const [helperRows, helpedIds] = await Promise.all([
    store.helpersOfHost(userId),
    store.eventsHelpedBy(userId),
  ]);

  let helped = [];
  if (helpedIds.length > 0) {
    // The Integration API also returns events the host has paused.
    const response = await getIntegrationSdk().listings.query({
      ids: helpedIds.slice(0, 100).join(','),
    });
    helped = response.data.data;
  }

  const counts = await store.countsByListing(
    [...hosted, ...helped].map(listing => listing.id.uuid)
  );

  const toEvent = (listing, role) => {
    const listingId = listing.id.uuid;
    const startsAt = listing.attributes.publicData?.eventStartsAt || null;
    return {
      listingId,
      title: listing.attributes.title || '',
      eventStartsAt: startsAt,
      when: eventWhen(startsAt),
      role,
      sold: counts.get(listingId)?.sold || 0,
      used: counts.get(listingId)?.used || 0,
      helpers:
        role === 'host'
          ? helperRows
              .filter(row => row.listing_id === listingId)
              .map(row => ({
                userId: row.helper_user_id,
                name: row.helper_name,
                email: row.helper_email,
              }))
          : [],
    };
  };

  const events = [
    ...hosted.map(listing => toEvent(listing, 'host')),
    ...helped.map(listing => toEvent(listing, 'helper')),
  ].sort((a, b) => String(a.eventStartsAt || '').localeCompare(String(b.eventStartsAt || '')));

  res.json({ events });
};

/**
 * POST /api/cc/tickets/door-helpers
 * Body: { listingId, email }
 * The host lets another student scan tickets for one event.
 */
exports.addHelper = async (req, res) => {
  const { sdk, user } = await requireUser(req, res);
  const { listingId } = req.body || {};
  const email = String(req.body?.email || '')
    .trim()
    .toLowerCase();

  if (!listingId) throw httpError(400, 'event-required', 'Pick an event first.');
  if (!isSdsuEmail(email)) {
    throw httpError(400, 'sdsu-email-required', 'Enter their @sdsu.edu email.');
  }
  if (email === String(user.attributes.email || '').toLowerCase()) {
    throw httpError(400, 'already-host', 'You can already scan tickets for your own event.');
  }

  let listing;
  try {
    listing = (await sdk.ownListings.show({ id: new UUID(listingId) })).data.data;
  } catch (e) {
    throw httpError(404, 'event-not-found', 'That event is not one of yours.');
  }
  if (listing.attributes.publicData?.kind !== 'ticket') {
    throw httpError(400, 'not-an-event', 'Door helpers are only for ticketed events.');
  }

  const notFound = httpError(
    404,
    'student-not-found',
    'No student on Campus Connect uses that email. Ask them to sign up first.'
  );
  let helper;
  try {
    helper = (await getIntegrationSdk().users.show({ email })).data.data;
  } catch (e) {
    if (e.status === 404) throw notFound;
    throw e;
  }
  if (helper.attributes.state !== 'active' || helper.attributes.banned) throw notFound;

  const result = await store.addHelper({
    listingId,
    hostId: user.id.uuid,
    helperUserId: helper.id.uuid,
    helperName: helper.attributes.profile?.displayName || '',
    helperEmail: email,
  });
  if (result === 'full') {
    throw httpError(
      400,
      'too-many-helpers',
      `An event can have up to ${store.MAX_HELPERS} door helpers.`
    );
  }
  await notifyQuietly({
    userId: helper.id.uuid,
    side: 'seller',
    category: 'orders',
    setting: 'notifyRequests',
    title: 'You can scan tickets',
    body: `${displayNameOf(user)} added you as a door helper for ${listing.attributes.title ||
      'an event'}. Open Seller Hub at the door to scan.`,
    emoji: '🎟️',
    accent: 'coral',
    action: 'scan',
    targetId: listingId,
    dedupeKey: `helper:${listingId}:${helper.id.uuid}`,
    replace: true,
  });
  res.status(201).json({ ok: true });
};

/**
 * DELETE /api/cc/tickets/door-helpers/:listingId/:userId
 */
exports.removeHelper = async (req, res) => {
  const { user } = await requireUser(req, res);
  await store.removeHelper({
    listingId: req.params.listingId,
    hostId: user.id.uuid,
    helperUserId: req.params.userId,
  });
  res.json({ ok: true });
};
