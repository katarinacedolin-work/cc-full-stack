/**
 * Completing a ticket order in Sharetribe, which is what pays the seller.
 *
 * An order is completed when its ticket is scanned, or a few hours after the event starts if it
 * never is. The ticket process also completes on its own after 85 days, as a backstop.
 */

const { types } = require('sharetribe-flex-sdk');
const log = require('../../log');
const store = require('./store');

const { UUID } = types;

const COMPLETE = 'transition/operator-complete';

/**
 * Issues the ticket for a paid order. Safe to run again for the same order.
 *
 * @param {Object} tx Sharetribe transaction
 * @param {Array<Object>} included the transaction's listing and customer
 * @returns {Promise<Object|null>} the ticket row, or null when the transaction can't have one
 */
exports.issueFor = async (tx, included = []) => {
  const find = ref =>
    ref
      ? included.find(entity => entity.type === ref.type && entity.id.uuid === ref.id.uuid)
      : null;
  const listingRef = tx.relationships?.listing?.data;
  const customerRef = tx.relationships?.customer?.data;
  const providerRef = tx.relationships?.provider?.data;
  if (!listingRef || !customerRef || !providerRef) return null;

  const listing = find(listingRef);
  const profile = find(customerRef)?.attributes?.profile || {};
  return store.issue({
    transactionId: tx.id.uuid,
    listingId: listingRef.id.uuid,
    sellerId: providerRef.id.uuid,
    buyerId: customerRef.id.uuid,
    buyerName: profile.displayName || '',
    listingTitle: listing?.attributes?.title || '',
    eventStartsAt: listing?.attributes?.publicData?.eventStartsAt || null,
  });
};

/**
 * Completes one ticket order.
 *
 * @param {Object} sdk Integration API SDK
 * @param {Object} ticket a ticket row
 * @returns {Promise<boolean>} whether the order is now settled, one way or the other
 */
exports.completeOrder = async (sdk, ticket) => {
  const id = new UUID(ticket.transaction_id);
  try {
    await sdk.transactions.transition({ id, transition: COMPLETE, params: {} });
    await store.markCompleted(ticket.transaction_id);
    return true;
  } catch (e) {
    // Most often the order already left the purchased state. See where it went.
    try {
      const response = await sdk.transactions.show({ id });
      const last = response.data.data.attributes.lastTransition || '';
      if (/complete|review/.test(last)) {
        await store.markCompleted(ticket.transaction_id);
        return true;
      }
      if (/cancel/.test(last)) {
        await store.voidAlways(ticket.transaction_id);
        return true;
      }
    } catch (showError) {
      log.error(showError, 'cc-ticket-order-lookup-failed', {
        transactionId: ticket.transaction_id,
      });
    }
    log.error(e, 'cc-ticket-complete-failed', { transactionId: ticket.transaction_id });
    await store.markCompletionChecked(ticket.transaction_id);
    return false;
  }
};

/**
 * Completes every ticket order that is due. The worker runs this every few minutes.
 *
 * @param {Object} sdk Integration API SDK
 * @returns {Promise<number>} how many orders were settled
 */
exports.completeDue = async sdk => {
  const due = await store.dueForCompletion();
  let settled = 0;
  for (const ticket of due) {
    if (await exports.completeOrder(sdk, ticket)) settled += 1;
  }
  return settled;
};
