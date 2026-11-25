/**
 * Keeps tickets in step with Sharetribe.
 *
 * The web service issues a ticket as soon as the buyer pays and cancels it when the seller
 * refunds, so most of the time there is nothing left to do here. This covers what the web
 * service missed (a crash between the payment and the insert) and what happens outside it
 * (a refund from Sharetribe Console, an edited event time).
 */

const { getIntegrationSdk } = require('../../integrationSdk');
const store = require('../../tickets/store');
const { issueFor } = require('../../tickets/complete');

const TICKET_PROCESS = 'cc-ticket';

const onTransition = async tx => {
  if (tx.attributes?.processName !== TICKET_PROCESS) return;
  const transactionId = tx.id.uuid;
  const last = tx.attributes.lastTransition;

  if (last === 'transition/confirm-payment') {
    if (await store.findByTransaction(transactionId)) return;
    // The event doesn't carry the listing or the buyer's name.
    const response = await getIntegrationSdk().transactions.show({
      id: tx.id,
      include: ['listing', 'customer', 'provider'],
    });
    await issueFor(response.data.data, response.data.included || []);
    return;
  }
  if (last === 'transition/cancel') {
    await store.voidAlways(transactionId);
    return;
  }
  if (last === 'transition/operator-complete' || last === 'transition/auto-complete') {
    await store.markCompleted(transactionId);
  }
};

const onListingUpdated = async listing => {
  const publicData = listing.attributes?.publicData || {};
  if (publicData.kind !== 'ticket') return;
  await store.updateEvent({
    listingId: listing.id.uuid,
    listingTitle: listing.attributes.title || '',
    eventStartsAt: publicData.eventStartsAt || null,
  });
};

/**
 * @param {Object} event Sharetribe event resource
 */
module.exports = async event => {
  const { eventType, resource } = event.attributes;
  if (!resource?.id) return;
  if (eventType === 'transaction/transitioned') await onTransition(resource);
  if (eventType === 'listing/updated') await onListingUpdated(resource);
};
