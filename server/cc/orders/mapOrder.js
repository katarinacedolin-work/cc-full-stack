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

  if (
    /cancel|decline|expire-payment|expire$|auto-cancel/i.test(last) &&
    !/from-disputed|review/i.test(last)
  ) {
    return 'cancelled';
  }
  if (/dispute/i.test(last) && !/from-disputed|mark-received-from-disputed/i.test(last)) {
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
 * @param {Object} [flags] what Postgres knows about the order
 * @param {boolean} [flags.readyForPickup]
 * @param {Object} [flags.ticket] { status, usedAt, code }, where code is only there for the buyer
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
  const ticket = kind === 'ticket' ? flags.ticket || null : null;
  let status = statusFromTransaction(tx, flags);
  // A scanned ticket is done for both sides, even in the moments before Sharetribe is told.
  if (ticket?.status === 'used' && status === 'confirmed') {
    status = 'completed';
  }

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

  if (kind === 'ticket') {
    // issued, used or void. 'pending' until the ticket has its code, which takes a moment.
    order.ticketStatus = ticket?.status || 'pending';
    order.ticketCode = ticket?.code || null;
    order.usedAt = ticket?.usedAt || null;
  }

  const last = order.lastTransition || '';
  if (kind === 'ticket' && /confirm-payment/i.test(last) && ticket?.status !== 'used') {
    // The seller can refund a ticket until it is scanned.
    order.can.cancel = true;
  }
  if (kind === 'product') {
    if (/confirm-payment/i.test(last)) {
      order.can.markDelivered = true;
      order.can.markReceived = true;
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
