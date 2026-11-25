/**
 * Checkout and order transitions for /api/cc.
 */

const { types } = require('sharetribe-flex-sdk');
const {
  createCookieTokenStore,
  getSdk,
  getTrustedSdk,
  fetchCommission,
} = require('../../api-util/sdk');
const { transactionLineItems } = require('../../api-util/lineItems');
const { getIntegrationSdk } = require('../integrationSdk');
const { httpError } = require('../auth/httpError');
const db = require('../db');
const { toCampusOrder, BOOKING_PROCESS, PURCHASE_PROCESS } = require('../orders/mapOrder');

const { UUID, Money } = types;

const TX_INCLUDE = {
  expand: true,
  include: ['listing', 'provider', 'customer', 'booking'],
};

const requireUser = async (req, res) => {
  const tokenStore = createCookieTokenStore(req, res);
  const sdk = getSdk(req, res, tokenStore);
  try {
    const response = await sdk.currentUser.show();
    return { sdk, tokenStore, user: response.data.data };
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      throw httpError(401, 'sign-in-required', 'Sign in to continue.');
    }
    throw e;
  }
};

const sharetribeMessage = (error, fallback) => {
  const first = error?.data?.errors?.[0];
  return first?.title || first?.detail || fallback;
};

const processAliasFor = listing => {
  const fromListing = listing.attributes?.publicData?.transactionProcessAlias;
  if (fromListing) return fromListing;
  const kind = listing.attributes?.publicData?.kind;
  if (kind === 'service') return `${BOOKING_PROCESS}/release-1`;
  return `${PURCHASE_PROCESS}/release-1`;
};

const getFlags = async transactionId => {
  const { rows } = await db.query(
    'select ready_for_pickup from order_flags where transaction_id = $1',
    [transactionId]
  );
  return { readyForPickup: Boolean(rows[0]?.ready_for_pickup) };
};

const setReadyFlag = async (transactionId, ready) => {
  await db.query(
    `insert into order_flags (transaction_id, ready_for_pickup, updated_at)
     values ($1, $2, now())
     on conflict (transaction_id) do update
       set ready_for_pickup = excluded.ready_for_pickup,
           updated_at = now()`,
    [transactionId, ready]
  );
};

const loadTransaction = async (sdk, id) => {
  const response = await sdk.transactions.show({ id: new UUID(id), ...TX_INCLUDE });
  return { tx: response.data.data, included: response.data.included || [] };
};

const assertParticipant = (tx, userId, role) => {
  const customerId = tx.relationships?.customer?.data?.id?.uuid;
  const providerId = tx.relationships?.provider?.data?.id?.uuid;
  if (role === 'customer' && customerId !== userId) {
    throw httpError(403, 'not-your-order', 'That order is not yours.');
  }
  if (role === 'provider' && providerId !== userId) {
    throw httpError(403, 'not-your-sale', 'That sale is not yours.');
  }
  if (role === 'either' && customerId !== userId && providerId !== userId) {
    throw httpError(403, 'not-your-order', 'That order is not yours.');
  }
};

const stripeClientSecret = tx =>
  tx.attributes?.protectedData?.stripePaymentIntents?.default?.client_secret ||
  tx.attributes?.protectedData?.stripePaymentIntentClientSecret ||
  null;

/**
 * GET /api/cc/orders?role=buyer|seller
 */
exports.list = async (req, res) => {
  const { sdk, user } = await requireUser(req, res);
  const role = req.query.role === 'seller' ? 'provider' : 'customer';
  const response = await sdk.transactions.query({
    only: role,
    ...TX_INCLUDE,
    perPage: 100,
  });
  const included = response.data.included || [];
  const orders = [];
  for (const tx of response.data.data) {
    const flags = await getFlags(tx.id.uuid);
    orders.push(toCampusOrder(tx, included, flags));
  }
  orders.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  res.json({ orders });
};

/**
 * GET /api/cc/orders/:id
 */
exports.show = async (req, res) => {
  const { sdk, user } = await requireUser(req, res);
  try {
    const { tx, included } = await loadTransaction(sdk, req.params.id);
    assertParticipant(tx, user.id.uuid, 'either');
    const flags = await getFlags(tx.id.uuid);
    res.json({ order: toCampusOrder(tx, included, flags) });
  } catch (e) {
    if (e.status && e.code) throw e;
    throw httpError(404, 'order-not-found', 'That order is no longer here.');
  }
};

/**
 * POST /api/cc/orders
 * Body: { listingId, quantity?, date?, time?, paymentMethodId, note? }
 */
exports.create = async (req, res) => {
  const { sdk, tokenStore, user } = await requireUser(req, res);
  const { listingId, quantity = 1, date, time, paymentMethodId, note } = req.body || {};
  if (!listingId) throw httpError(400, 'listing-required', 'Pick a listing first.');
  if (!paymentMethodId) {
    throw httpError(400, 'payment-required', 'Add a card to pay.');
  }

  let listingResponse;
  try {
    listingResponse = await sdk.listings.show({ id: new UUID(listingId) });
  } catch (e) {
    throw httpError(404, 'listing-not-found', 'That listing is no longer here.');
  }
  const listing = listingResponse.data.data;
  const kind = listing.attributes?.publicData?.kind || 'product';
  const processAlias = processAliasFor(listing);
  const currency = listing.attributes.price?.currency || 'USD';

  if (kind === 'service' && !(date && time)) {
    throw httpError(400, 'slot-required', 'Pick a time first.');
  }

  const orderData = { currency };
  const params = {
    listingId: new UUID(listingId),
    stockReservationQuantity:
      kind === 'service' ? undefined : Math.max(1, Math.floor(Number(quantity)) || 1),
    cardToken: paymentMethodId,
  };

  if (kind === 'service') {
    // date is YYYY-MM-DD, time is like "4:00 PM". Build a one-hour booking by default.
    const start = parseLocalDateTime(date, time);
    const durationMinutes = Number(listing.attributes.publicData?.durationMinutes) || 60;
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
    params.bookingStart = start.toISOString();
    params.bookingEnd = end.toISOString();
    orderData.bookingDates = { bookingStart: params.bookingStart, bookingEnd: params.bookingEnd };
  } else {
    orderData.stockReservationQuantity = params.stockReservationQuantity;
  }

  if (note) {
    params.protectedData = { customerNote: String(note).slice(0, 500) };
  }

  const commissionResponse = await fetchCommission(sdk);
  const commissionAsset = commissionResponse.data.data[0];
  const { providerCommission, customerCommission } =
    commissionAsset?.type === 'jsonAsset' ? commissionAsset.attributes.data : {};

  const lineItems = transactionLineItems(
    listing,
    {
      ...orderData,
      ...params,
      currency,
    },
    providerCommission,
    customerCommission
  );

  let initiated;
  try {
    const trustedSdk = await getTrustedSdk(req, res, tokenStore);
    initiated = await trustedSdk.transactions.initiate(
      {
        processAlias,
        transition: 'transition/request-payment',
        params: { ...params, lineItems },
      },
      TX_INCLUDE
    );
  } catch (e) {
    throw httpError(
      e.status || 400,
      'checkout-failed',
      sharetribeMessage(e, 'Could not start checkout. Check the price and try again.')
    );
  }

  const tx = initiated.data.data;
  const included = initiated.data.included || [];
  res.status(201).json({
    order: toCampusOrder(tx, included),
    clientSecret: stripeClientSecret(tx),
    transactionId: tx.id.uuid,
  });
};

/**
 * POST /api/cc/orders/:id/confirm-payment
 */
exports.confirmPayment = async (req, res) => {
  const { sdk, user } = await requireUser(req, res);
  const { tx } = await loadTransaction(sdk, req.params.id);
  assertParticipant(tx, user.id.uuid, 'customer');

  try {
    const response = await sdk.transactions.transition(
      {
        id: tx.id,
        transition: 'transition/confirm-payment',
        params: {},
      },
      TX_INCLUDE
    );
    res.json({
      order: toCampusOrder(response.data.data, response.data.included || []),
    });
  } catch (e) {
    throw httpError(
      e.status || 400,
      'confirm-failed',
      sharetribeMessage(e, 'Payment could not be confirmed. Try again.')
    );
  }
};

/**
 * POST /api/cc/orders/:id/actions/:action
 * Buyer/seller actions that use the Marketplace API as the signed-in user.
 * Actions: accept, decline, mark-delivered, mark-received, dispute, review
 */
exports.action = async (req, res) => {
  const { sdk, user } = await requireUser(req, res);
  const action = req.params.action;
  const { tx, included } = await loadTransaction(sdk, req.params.id);
  const processName = (tx.attributes.processName || '').split('/')[0];
  const listing = included.find(
    entity =>
      entity.type === 'listing' && entity.id.uuid === tx.relationships?.listing?.data?.id?.uuid
  );

  const transitions = {
    accept: { transition: 'transition/accept', role: 'provider', processes: [BOOKING_PROCESS] },
    decline: { transition: 'transition/decline', role: 'provider', processes: [BOOKING_PROCESS] },
    'mark-delivered': {
      transition: 'transition/mark-delivered',
      role: 'provider',
      processes: [PURCHASE_PROCESS],
    },
    'mark-received': {
      transition: null, // chosen below
      role: 'customer',
      processes: [PURCHASE_PROCESS],
    },
    dispute: { transition: 'transition/dispute', role: 'customer', processes: [PURCHASE_PROCESS] },
    'review-customer': {
      transition: null,
      role: 'customer',
      processes: [BOOKING_PROCESS, PURCHASE_PROCESS, 'cc-ticket'],
    },
    'review-provider': {
      transition: null,
      role: 'provider',
      processes: [BOOKING_PROCESS, PURCHASE_PROCESS, 'cc-ticket'],
    },
  };

  const spec = transitions[action];
  if (!spec) throw httpError(400, 'unknown-action', 'That order action is not supported.');
  if (!spec.processes.includes(processName)) {
    throw httpError(400, 'wrong-process', 'That action does not apply to this order.');
  }
  assertParticipant(tx, user.id.uuid, spec.role);

  let transition = spec.transition;
  let params = {};

  if (action === 'mark-received') {
    const last = tx.attributes.lastTransition || '';
    transition = /mark-delivered/i.test(last)
      ? 'transition/mark-received'
      : 'transition/mark-received-from-purchased';
  }

  if (action === 'dispute') {
    const reason = String(req.body?.reason || '').trim();
    const message = String(req.body?.message || '').trim();
    if (!reason) throw httpError(400, 'reason-required', 'Pick a reason for the problem.');
    params.protectedData = { disputeReason: reason, disputeMessage: message };
    // A reports table lands in the safety PR; for now the dispute transition + message is enough.
    if (message) {
      try {
        await sdk.messages.send({
          transactionId: tx.id,
          content: `Problem reported: ${reason}. ${message}`,
        });
      } catch (e) {
        // Non-fatal.
      }
    }
  }

  if (action === 'review-customer' || action === 'review-provider') {
    const rating = Number(req.body?.rating);
    const content = String(req.body?.content || '').trim();
    if (!(rating >= 1 && rating <= 5)) {
      throw httpError(400, 'rating-required', 'Pick a rating from 1 to 5.');
    }
    const byCustomer = action === 'review-customer';
    const first = byCustomer
      ? 'transition/review-1-by-customer'
      : 'transition/review-1-by-provider';
    const second = byCustomer
      ? 'transition/review-2-by-customer'
      : 'transition/review-2-by-provider';
    // Try first review transition; if it fails because the other party already reviewed, try second.
    transition = first;
    params = {
      reviewRating: rating,
      reviewContent: content,
    };
    try {
      const response = await sdk.transactions.transition(
        { id: tx.id, transition, params },
        TX_INCLUDE
      );
      res.json({ order: toCampusOrder(response.data.data, response.data.included || []) });
      return;
    } catch (e) {
      transition = second;
    }
  }

  if (action === 'mark-delivered') {
    // Also set the ready-for-pickup flag used by the Seller Hub UI.
    await setReadyFlag(tx.id.uuid, true);
  }

  try {
    const response = await sdk.transactions.transition(
      { id: tx.id, transition, params },
      TX_INCLUDE
    );
    const flags = await getFlags(tx.id.uuid);
    res.json({ order: toCampusOrder(response.data.data, response.data.included || [], flags) });
  } catch (e) {
    throw httpError(
      e.status || 400,
      'action-failed',
      sharetribeMessage(e, 'Could not update that order.')
    );
  }
};

/**
 * POST /api/cc/orders/:id/ready-for-pickup
 * Seller notice only — does not change the Sharetribe state until mark-delivered.
 */
exports.readyForPickup = async (req, res) => {
  const { sdk, user } = await requireUser(req, res);
  const { tx, included } = await loadTransaction(sdk, req.params.id);
  assertParticipant(tx, user.id.uuid, 'provider');
  await setReadyFlag(tx.id.uuid, true);
  try {
    await sdk.messages.send({
      transactionId: tx.id,
      content: 'Your order is ready for pickup.',
    });
  } catch (e) {
    // Non-fatal.
  }
  // Prefer transitioning to mark-delivered when the process allows it.
  try {
    const response = await sdk.transactions.transition(
      { id: tx.id, transition: 'transition/mark-delivered', params: {} },
      TX_INCLUDE
    );
    res.json({
      order: toCampusOrder(response.data.data, response.data.included || [], {
        readyForPickup: true,
      }),
    });
  } catch (e) {
    const flags = { readyForPickup: true };
    res.json({ order: toCampusOrder(tx, included, flags) });
  }
};

/**
 * POST /api/cc/orders/:id/operator/:action
 * Seller-facing buttons that only the operator can run in default processes.
 * Actions: cancel, complete
 */
exports.operatorAction = async (req, res) => {
  const { sdk, user } = await requireUser(req, res);
  const { tx, included } = await loadTransaction(sdk, req.params.id);
  assertParticipant(tx, user.id.uuid, 'provider');

  const processName = (tx.attributes.processName || '').split('/')[0];
  const action = req.params.action;
  let transition;
  if (action === 'cancel') {
    transition = 'transition/cancel';
  } else if (action === 'complete') {
    transition =
      processName === BOOKING_PROCESS
        ? 'transition/operator-complete'
        : 'transition/operator-mark-delivered';
  } else {
    throw httpError(400, 'unknown-action', 'That operator action is not supported.');
  }

  const reason = String(req.body?.reason || '').trim();
  const message = String(req.body?.message || '').trim();

  try {
    const integrationSdk = getIntegrationSdk();
    await integrationSdk.transactions.transition({
      id: tx.id,
      transition,
      params:
        reason || message
          ? { protectedData: { operatorReason: reason, operatorMessage: message } }
          : {},
    });
  } catch (e) {
    throw httpError(
      e.status || 400,
      'operator-action-failed',
      sharetribeMessage(e, 'Could not update that order.')
    );
  }

  if (message) {
    try {
      await sdk.messages.send({ transactionId: tx.id, content: message });
    } catch (e) {
      // Non-fatal.
    }
  }

  const refreshed = await loadTransaction(sdk, req.params.id);
  const flags = await getFlags(req.params.id);
  res.json({ order: toCampusOrder(refreshed.tx, refreshed.included, flags) });
};

/**
 * POST /api/cc/orders/line-items
 * Speculative totals for the checkout summary.
 */
exports.lineItems = async (req, res) => {
  const { sdk } = await requireUser(req, res);
  const { listingId, quantity = 1, date, time } = req.body || {};
  if (!listingId) throw httpError(400, 'listing-required', 'Pick a listing first.');

  const listingResponse = await sdk.listings.show({ id: new UUID(listingId) });
  const listing = listingResponse.data.data;
  const kind = listing.attributes?.publicData?.kind || 'product';
  const currency = listing.attributes.price?.currency || 'USD';
  const commissionResponse = await fetchCommission(sdk);
  const commissionAsset = commissionResponse.data.data[0];
  const { providerCommission, customerCommission } =
    commissionAsset?.type === 'jsonAsset' ? commissionAsset.attributes.data : {};

  const orderData = { currency };
  if (kind === 'service') {
    if (!(date && time)) throw httpError(400, 'slot-required', 'Pick a time first.');
    const start = parseLocalDateTime(date, time);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    orderData.bookingDates = {
      bookingStart: start.toISOString(),
      bookingEnd: end.toISOString(),
    };
  } else {
    orderData.stockReservationQuantity = Math.max(1, Math.floor(Number(quantity)) || 1);
  }

  const lineItems = transactionLineItems(
    listing,
    orderData,
    providerCommission,
    customerCommission
  );

  const payin = lineItems
    .filter(item => item.includeFor?.includes('customer'))
    .reduce((sum, item) => sum + (item.lineTotal?.amount || 0), 0);
  const payout = lineItems
    .filter(item => item.includeFor?.includes('provider'))
    .reduce((sum, item) => sum + (item.lineTotal?.amount || 0), 0);
  const fee = lineItems
    .filter(item => item.code === 'line-item/provider-commission')
    .reduce((sum, item) => sum + Math.abs(item.lineTotal?.amount || 0), 0);

  res.json({
    currency,
    payinTotal: payin / 100,
    payoutTotal: payout / 100,
    platformFee: fee / 100,
  });
};

function parseLocalDateTime(date, time) {
  // "4:00 PM" → 24h
  const match = String(time)
    .trim()
    .match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) {
    throw httpError(400, 'bad-time', 'That time does not look right.');
  }
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3].toUpperCase();
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  const iso = `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
  // Interpret as America/Los_Angeles by appending offset roughly; for v1 use local Date parse.
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    throw httpError(400, 'bad-time', 'That date and time do not look right.');
  }
  return parsed;
}
