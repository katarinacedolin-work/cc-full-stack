/**
 * Which bell notifications a step in an order causes, and for whom.
 *
 * Sharetribe sends the emails for these steps itself. This only decides what the bell shows.
 */

const PAID = 'Your payout is on its way.';

// For each transition: what the buyer and the seller are told. A function gets the order and
// returns { title, body }, or nothing when that kind of order has no news for that person.
const RULES = {
  'transition/confirm-payment': {
    seller: ({ kind, buyerName, listingTitle }) => ({
      title:
        kind === 'service'
          ? 'New booking request'
          : kind === 'ticket'
          ? 'Ticket sold'
          : 'New order',
      body: `${buyerName} · ${listingTitle}`,
    }),
  },

  // Bookings wait for the seller's answer.
  'transition/accept': {
    buyer: ({ listingTitle }) => ({ title: 'Booking confirmed', body: listingTitle }),
  },
  'transition/decline': {
    buyer: ({ listingTitle }) => ({
      title: 'Request declined',
      body: `${listingTitle} · You were not charged.`,
    }),
  },
  'transition/expire': {
    buyer: ({ listingTitle }) => ({
      title: 'Request expired',
      body: `${listingTitle} · The seller did not answer in time, so you were not charged.`,
    }),
    seller: ({ buyerName, listingTitle }) => ({
      title: 'A booking request expired',
      body: `${buyerName} · ${listingTitle}`,
    }),
  },

  'transition/cancel': {
    buyer: ({ listingTitle }) => ({
      title: 'Order cancelled and refunded',
      body: listingTitle,
    }),
    seller: ({ buyerName, listingTitle }) => ({
      title: 'Order cancelled',
      body: `${buyerName} · ${listingTitle} · The buyer was refunded.`,
    }),
  },

  // The web service writes the same notification when the seller presses "Ready for pickup",
  // so both use one key and the buyer is told once.
  'transition/mark-delivered': {
    key: 'ready',
    buyer: ({ listingTitle }) => ({ title: 'Ready for pickup', body: listingTitle }),
  },

  'transition/mark-received': {
    seller: ({ buyerName, listingTitle }) => ({
      title: 'Pickup confirmed',
      body: `${buyerName} · ${listingTitle} · ${PAID}`,
    }),
  },
  'transition/auto-mark-received': {
    seller: ({ buyerName, listingTitle }) => ({
      title: 'Order completed',
      body: `${buyerName} · ${listingTitle} · ${PAID}`,
    }),
  },

  // A booking is completed when its time has passed. A ticket is completed by scanning it,
  // and a busy door would fill the host's bell, so tickets are left out.
  'transition/complete': {
    buyer: ({ kind, listingTitle }) =>
      kind === 'service' && {
        title: 'How did it go?',
        body: `Leave a review for ${listingTitle}.`,
      },
    seller: ({ kind, buyerName, listingTitle }) =>
      kind === 'service' && {
        title: 'Booking completed',
        body: `${buyerName} · ${listingTitle} · ${PAID}`,
      },
  },

  'transition/dispute': {
    seller: ({ buyerName, listingTitle }) => ({
      title: 'A buyer reported a problem',
      body: `${buyerName} · ${listingTitle} · Campus Connect will look into it.`,
    }),
  },
  'transition/operator-dispute': {
    buyer: ({ listingTitle }) => ({
      title: 'Campus Connect is looking into this order',
      body: listingTitle,
    }),
    seller: ({ buyerName, listingTitle }) => ({
      title: 'Campus Connect is looking into this order',
      body: `${buyerName} · ${listingTitle}`,
    }),
  },
  'transition/mark-received-from-disputed': {
    buyer: ({ listingTitle }) => ({
      title: 'Problem reviewed',
      body: `${listingTitle} · The order was completed.`,
    }),
    seller: ({ buyerName, listingTitle }) => ({
      title: 'Problem settled',
      body: `${buyerName} · ${listingTitle} · ${PAID}`,
    }),
  },
  'transition/cancel-from-disputed': {
    buyer: ({ listingTitle }) => ({
      title: 'Problem settled: you were refunded',
      body: listingTitle,
    }),
    seller: ({ buyerName, listingTitle }) => ({
      title: 'Problem settled: the buyer was refunded',
      body: `${buyerName} · ${listingTitle}`,
    }),
  },

  'transition/review-1-by-customer': {
    seller: ({ buyerName, listingTitle }) => ({
      category: 'reviews',
      title: 'New review',
      body: `${buyerName} reviewed ${listingTitle}. It shows once you review them too, or when the review period ends.`,
    }),
  },
  'transition/review-2-by-customer': {
    seller: ({ buyerName, listingTitle }) => ({
      category: 'reviews',
      title: 'New review',
      body: `${buyerName} reviewed ${listingTitle}.`,
    }),
  },
};

// Transitions that mean the same thing to the people in the order as another one.
const SAME_AS = {
  'transition/operator-accept': 'transition/accept',
  'transition/operator-decline': 'transition/decline',
  'transition/auto-cancel': 'transition/cancel',
  'transition/operator-mark-delivered': 'transition/mark-delivered',
  'transition/mark-received-from-purchased': 'transition/mark-received',
  'transition/operator-complete': 'transition/complete',
  'transition/auto-cancel-from-disputed': 'transition/cancel-from-disputed',
};

const ruleFor = transition => RULES[SAME_AS[transition] || transition] || null;

/**
 * @param {string} transition e.g. 'transition/accept'
 * @returns {boolean} whether this step can put anything on a bell
 */
exports.isNotable = transition => Boolean(ruleFor(transition));

/**
 * The key that keeps "ready for pickup" from reaching the buyer twice.
 *
 * @param {string} transactionId
 * @returns {string}
 */
exports.readyKey = transactionId => `tx:${transactionId}:ready:buyer`;

/**
 * @param {Object} order
 * @param {string} order.transition the transaction's last transition
 * @param {'product'|'service'|'ticket'} order.kind
 * @param {string} order.transactionId
 * @param {string} order.buyerId
 * @param {string} order.buyerName
 * @param {string} order.sellerId
 * @param {string} order.listingTitle
 * @param {string} [order.emoji]
 * @param {string} [order.accent]
 * @returns {Array<Object>} what notifications/store.write takes, one per person told
 */
exports.forTransition = order => {
  const rule = ruleFor(order.transition);
  if (!rule) return [];
  const step = rule.key || (SAME_AS[order.transition] || order.transition).split('/')[1];
  const details = {
    ...order,
    buyerName: order.buyerName || 'A student',
    listingTitle: order.listingTitle || 'Campus Connect order',
  };

  return ['buyer', 'seller']
    .map(side => {
      const text = rule[side] && rule[side](details);
      if (!text) return null;
      const category = text.category || 'orders';
      const isReview = category === 'reviews';
      return {
        userId: side === 'buyer' ? order.buyerId : order.sellerId,
        side,
        category,
        setting: isReview ? 'notifyReviews' : side === 'seller' ? 'notifyRequests' : 'notifyOrders',
        title: text.title,
        body: text.body,
        emoji: order.emoji || '',
        accent: order.accent || 'cobalt',
        action: isReview ? 'reviews' : 'order',
        targetId: order.transactionId,
        dedupeKey: `tx:${order.transactionId}:${step}:${side}`,
      };
    })
    .filter(notification => notification && notification.userId);
};
