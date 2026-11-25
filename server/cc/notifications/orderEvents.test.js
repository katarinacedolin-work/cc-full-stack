const { forTransition, isNotable, readyKey } = require('./orderEvents');

const order = (transition, overrides = {}) => ({
  transition,
  kind: 'product',
  transactionId: 'tx-1',
  buyerId: 'buyer-1',
  buyerName: 'Jordan P',
  sellerId: 'seller-1',
  listingTitle: 'Desk lamp',
  emoji: '💡',
  accent: 'butter',
  ...overrides,
});

const told = notifications => notifications.map(notification => notification.side);

describe('orderEvents', () => {
  it('tells the seller about a paid order, in words that fit what was sold', () => {
    const titleFor = kind => forTransition(order('transition/confirm-payment', { kind }))[0].title;
    expect(titleFor('product')).toBe('New order');
    expect(titleFor('service')).toBe('New booking request');
    expect(titleFor('ticket')).toBe('Ticket sold');
  });

  it('sends a paid order to Seller Hub under the requests setting', () => {
    const [notification] = forTransition(order('transition/confirm-payment'));
    expect(notification).toEqual({
      userId: 'seller-1',
      side: 'seller',
      category: 'orders',
      setting: 'notifyRequests',
      title: 'New order',
      body: 'Jordan P · Desk lamp',
      emoji: '💡',
      accent: 'butter',
      action: 'order',
      targetId: 'tx-1',
      dedupeKey: 'tx:tx-1:confirm-payment:seller',
    });
  });

  it('tells the buyer when a booking is accepted or declined', () => {
    const accepted = forTransition(order('transition/accept', { kind: 'service' }));
    const declined = forTransition(order('transition/decline', { kind: 'service' }));
    expect(told(accepted)).toEqual(['buyer']);
    expect(accepted[0].setting).toBe('notifyOrders');
    expect(accepted[0].title).toBe('Booking confirmed');
    expect(declined[0].body).toContain('not charged');
  });

  it('tells both people when an order is cancelled', () => {
    expect(told(forTransition(order('transition/cancel')))).toEqual(['buyer', 'seller']);
  });

  it('treats a step the operator or the clock took like the same step taken by a person', () => {
    const byPerson = forTransition(order('transition/cancel'));
    const byClock = forTransition(order('transition/auto-cancel'));
    expect(byClock.map(n => n.title)).toEqual(byPerson.map(n => n.title));
    // Their keys match too, so an order can never be announced as cancelled twice.
    expect(byClock.map(n => n.dedupeKey)).toEqual(byPerson.map(n => n.dedupeKey));
  });

  it('uses one key for "ready for pickup", whoever writes it', () => {
    const [fromSeller] = forTransition(order('transition/mark-delivered'));
    const [fromOperator] = forTransition(order('transition/operator-mark-delivered'));
    expect(fromSeller.dedupeKey).toBe(readyKey('tx-1'));
    expect(fromOperator.dedupeKey).toBe(readyKey('tx-1'));
    expect(fromSeller.side).toBe('buyer');
  });

  it('tells the seller they are paid once the buyer has the order', () => {
    const [received] = forTransition(order('transition/mark-received-from-purchased'));
    expect(received.side).toBe('seller');
    expect(received.body).toContain('payout');
  });

  it('says nothing when a ticket order is completed, so a busy door does not fill the bell', () => {
    expect(forTransition(order('transition/operator-complete', { kind: 'ticket' }))).toEqual([]);
  });

  it('tells both people when a booking is completed', () => {
    const done = forTransition(order('transition/complete', { kind: 'service' }));
    expect(told(done)).toEqual(['buyer', 'seller']);
  });

  it('files a review under reviews, behind its own setting', () => {
    const [review] = forTransition(order('transition/review-1-by-customer'));
    expect(review.category).toBe('reviews');
    expect(review.setting).toBe('notifyReviews');
    expect(review.action).toBe('reviews');
    expect(review.side).toBe('seller');
  });

  it('ignores steps nobody needs to hear about', () => {
    ['transition/request-payment', 'transition/inquire', 'transition/expire-payment'].forEach(
      transition => {
        expect(isNotable(transition)).toBe(false);
        expect(forTransition(order(transition))).toEqual([]);
      }
    );
  });

  it('skips a person it has no id for', () => {
    expect(forTransition(order('transition/cancel', { buyerId: '' })).map(n => n.side)).toEqual([
      'seller',
    ]);
  });
});
