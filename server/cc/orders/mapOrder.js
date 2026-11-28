/**
 * Maps a Sharetribe transaction into the Campus Connect order shape.
 */

const { toSlot } = require('../time');

const BOOKING_PROCESS = 'default-booking';
const PURCHASE_PROCESS = 'default-purchase';

const kindFromProcess = processName => {
  if (processName === BOOKING_PROCESS) return 'service';
  if (processName === PURCHASE_PROCESS) return 'product';
  if (processName === 'cc-ticket') return 'ticket';
  return 'product';
};

/**
 * Campus Connect status labels used by the Seller Hub and buyer order pages.
 */
const statusFromTransaction = (tx, { readyForPickup = false } = {}) => {
  const last = tx.attributes?.lastTransition || '';
  const processName = (tx.attributes?.processName || '').split('/')[0];

  // Resolutions out of a dispute (cancel-from-disputed, auto-cancel-from-disputed) are cancellations.
  if (/cancel|decline|expire-payment|expire$|auto-cancel/i.test(last) && !/review/i.test(last)) {
    return 'cancelled';
  }
  // Only the transition that enters the dispute state counts as disputed; mark-received-from-disputed
  // falls through to 'completed' below.
  if (/dispute/i.test(last) && !/from-disputed/i.test(last)) {
    return 'disputed';
  }
  if (/complete|mark-received|auto-mark-received|review/i.test(last)) {
    return 'completed';
  }
  if (readyForPickup || /mark-delivered/i.test(last)) {
    return 'ready';
  }
  if (processName === BOOKING_PROCESS) {
    if (/request-payment|confirm-payment|inquire/i.test(last) && !/accept/i.test(last)) {
      // After payment, booking waits for the seller to accept.
      if (/confirm-payment/i.test(last)) return 'requested';
      return 'pending-payment';
    }
    if (/accept/i.test(last)) return 'confirmed';
  }
  if (processName === PURCHASE_PROCESS || processName === 'cc-ticket') {
    if (/confirm-payment/i.test(last)) return 'confirmed';
    if (/request-payment/i.test(last)) return 'pending-payment';
  }
  return 'confirmed';
};

// Questions asked before buying, and payments that timed out, are never orders.
const NEVER_AN_ORDER = /transition\/(inquire|expire-payment)$/;
// A checkout that was started but not paid yet.
const AWAITING_PAYMENT = /transition\/(request-payment|request-payment-after-inquiry)$/;

/**
 * Whether a transaction belongs in one person's list of orders. A checkout still waiting for
 * payment shows for the buyer, who can finish paying (Sharetribe expires it after 15 minutes),
 * but not for the seller, who has nothing to act on until it is paid.
 *
 * @param {Object} tx Sharetribe transaction
 * @param {'customer'|'provider'} role The side of the order whose list this is
 * @returns {boolean}
 */
const isListedOrder = (tx, role) => {
  const last = tx.attributes?.lastTransition || '';
  if (NEVER_AN_ORDER.test(last)) return false;
  if (AWAITING_PAYMENT.test(last)) return role === 'customer';
  return true;
};

const personFrom = (ref, included = []) => {
  if (!ref?.id?.uuid) return null;
  return (
    included.find(entity => entity.type === ref.type && entity.id?.uuid === ref.id.uuid) || null
  );
};

const listingFrom = (tx, included = []) => {
  const ref = tx.relationships?.listing?.data;
  return personFrom(ref, included);
};

const displayName = user => {
  const profile = user?.attributes?.profile || {};
  return (
    profile.displayName ||
    [profile.firstName, profile.lastName].filter(Boolean).join(' ') ||
    'Student'
  );
};

const initialsOf = name =>
  String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() || '')
    .join('') || '?';

const moneyAmount = money => (money && typeof money.amount === 'number' ? money.amount / 100 : 0);

/**
 * @param {Object} tx Sharetribe transaction
 * @param {Array} [included]
 * @param {Object} [flags] { readyForPickup }
 */
exports.toCampusOrder = (tx, included = [], flags = {}) => {
  const processName = tx.attributes?.processName || '';
  const kind = kindFromProcess(processName.split('/')[0]);
  const listing = listingFrom(tx, included);
  const customer = personFrom(tx.relationships?.customer?.data, included);
  const provider = personFrom(tx.relationships?.provider?.data, included);
  const booking = personFrom(tx.relationships?.booking?.data, included);
  const publicData = listing?.attributes?.publicData || {};
  const lineItems = tx.attributes?.lineItems || [];
  const providerCommission = lineItems.find(item => item.code === 'line-item/provider-commission');
  const buyerName = displayName(customer);
  const sellerName = displayName(provider);
  const qty =
    lineItems.find(item => item.code === 'line-item/item' || item.code === 'line-item/units')
      ?.quantity || 1;
  const status = statusFromTransaction(tx, flags);

  const order = {
    id: tx.id.uuid,
    listingId: listing?.id?.uuid || null,
    kind,
    status,
    quantity: Number(qty) || 1,
    qty: Number(qty) || 1,
    total: moneyAmount(tx.attributes?.payinTotal),
    amount: moneyAmount(tx.attributes?.payinTotal),
    payout: moneyAmount(tx.attributes?.payoutTotal),
    platformFee: providerCommission ? Math.abs(moneyAmount(providerCommission.lineTotal)) : 0,
    placedAt: tx.attributes?.createdAt || null,
    updatedAt: tx.attributes?.lastTransitionedAt || tx.attributes?.createdAt || null,
    buyer: buyerName,
    buyerId: customer?.id?.uuid || null,
    buyerInitials: initialsOf(buyerName),
    seller: sellerName,
    sellerId: provider?.id?.uuid || null,
    title: listing?.attributes?.title || '',
    lastTransition: tx.attributes?.lastTransition || null,
    processName,
    processAlias: tx.attributes?.processAlias || null,
    readyForPickup: Boolean(flags.readyForPickup),
    listingTitle: listing?.attributes?.title || '',
    accent: publicData.accent || 'cobalt',
    emoji: publicData.emoji || '📦',
    note: tx.attributes?.protectedData?.customerNote || '',
    reviewRequested: false,
    can: {
      markDelivered: false,
      markReceived: false,
      dispute: false,
      accept: false,
      decline: false,
      cancel: false,
      complete: false,
      review: false,
    },
  };

  if (booking?.attributes?.start) {
    // The pages show a slot as a campus date and clock, the way the booking picker does.
    const slot = toSlot(booking.attributes.start);
    order.date = slot.date;
    order.time = slot.time;
    order.bookingStart = booking.attributes.start;
    order.bookingEnd = booking.attributes.end;
  }

  const last = order.lastTransition || '';
  if (kind === 'product') {
    if (/confirm-payment/i.test(last)) {
      // The buyer can only confirm receipt once the seller marks the item ready/delivered.
      order.can.markDelivered = true;
      order.can.cancel = true;
    }
    if (/mark-delivered/i.test(last) || flags.readyForPickup) {
      order.can.markDelivered = false;
      order.can.markReceived = true;
      order.can.dispute = true;
      order.can.cancel = true;
      order.can.complete = true; // seller "mark picked up" = already delivered; buyer confirms
    }
  }
  if (kind === 'service') {
    if (/confirm-payment/i.test(last) && !/accept/i.test(last)) {
      order.can.accept = true;
      order.can.decline = true;
    }
    if (/accept/i.test(last)) {
      order.can.complete = true;
      order.can.cancel = true;
    }
  }
  if (/complete|mark-received|auto-complete/i.test(last)) {
    order.can = {
      markDelivered: false,
      markReceived: false,
      dispute: true,
      accept: false,
      decline: false,
      cancel: false,
      complete: false,
      review: true,
    };
  }
  if (status === 'cancelled' || status === 'disputed') {
    order.can = {
      markDelivered: false,
      markReceived: false,
      dispute: false,
      accept: false,
      decline: false,
      cancel: false,
      complete: false,
      review: false,
    };
  }

  return order;
};

exports.BOOKING_PROCESS = BOOKING_PROCESS;
exports.PURCHASE_PROCESS = PURCHASE_PROCESS;
exports.kindFromProcess = kindFromProcess;
exports.statusFromTransaction = statusFromTransaction;
exports.isListedOrder = isListedOrder;
