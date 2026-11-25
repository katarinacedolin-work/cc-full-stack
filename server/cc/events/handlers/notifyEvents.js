/**
 * Fills the bell and the inbox from what happens in Sharetribe.
 *
 * A step in an order becomes a notification for the buyer, the seller or both. A message sent
 * in a Sharetribe transaction is copied into the inbox, unless the web service already stored
 * it when it was sent.
 */

const { getIntegrationSdk } = require('../../integrationSdk');
const { kindFromProcess } = require('../../orders/mapOrder');
const { displayNameOf } = require('../../people');
const notifications = require('../../notifications/store');
const { forTransition, isNotable } = require('../../notifications/orderEvents');
const threads = require('../../messaging/store');
const { deliver } = require('../../messaging/deliver');
const { threadFromTransaction, includedFor } = require('../../messaging/fromTransaction');

// The event carries ids only. The names and the listing come from the transaction itself.
const loadTransaction = async id => {
  const response = await getIntegrationSdk().transactions.show({
    id,
    include: ['listing', 'customer', 'provider'],
  });
  return { tx: response.data.data, included: response.data.included || [] };
};

const onTransition = async resource => {
  const transition = resource.attributes?.lastTransition;
  if (!isNotable(transition)) return;

  const { tx, included } = await loadTransaction(resource.id);
  const relationships = tx.relationships || {};
  const listing = includedFor(relationships.listing?.data, included);
  const customer = includedFor(relationships.customer?.data, included);
  const publicData = listing?.attributes?.publicData || {};
  const buyerId = relationships.customer?.data?.id?.uuid || '';
  const sellerId = relationships.provider?.data?.id?.uuid || '';

  const wanted = forTransition({
    transition,
    kind: kindFromProcess((resource.attributes.processName || '').split('/')[0]),
    transactionId: resource.id.uuid,
    buyerId,
    buyerName: displayNameOf(customer),
    sellerId,
    listingTitle: listing?.attributes?.title || '',
    emoji: publicData.emoji || '',
    accent: publicData.accent || '',
  });
  for (const notification of wanted) {
    await notifications.write(notification);
  }
  // Both pages reload, so the order shows its new status even with the bell switched off.
  await notifications.touch([buyerId, sellerId]);
};

const onMessage = async resource => {
  const transactionId = resource.relationships?.transaction?.data?.id?.uuid;
  const senderId = resource.relationships?.sender?.data?.id?.uuid;
  const body = resource.attributes?.content;
  if (!transactionId || !senderId || !body) return;
  if (await threads.hasSharetribeMessage(resource.id.uuid)) return;

  let thread = await threads.findByTransaction(transactionId);
  if (!thread) {
    // The first message about this order. Nobody has opened a conversation for it yet.
    const { tx, included } = await loadTransaction(resource.relationships.transaction.data.id);
    thread = await threads.create(threadFromTransaction(tx, included));
  }
  if (!thread) return;

  await deliver({
    thread,
    senderId,
    body,
    sharetribeId: resource.id.uuid,
    createdAt: resource.attributes.createdAt || null,
  });
};

/**
 * @param {Object} event Sharetribe event resource
 */
module.exports = async event => {
  const { eventType, resource } = event.attributes;
  if (!resource?.id) return;
  if (eventType === 'transaction/transitioned') await onTransition(resource);
  if (eventType === 'message/created') await onMessage(resource);
};
