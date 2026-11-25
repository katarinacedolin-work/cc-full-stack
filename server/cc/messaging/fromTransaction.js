/**
 * What a conversation about an order looks like, read off the Sharetribe transaction.
 */

const { displayNameOf } = require('../people');

const includedFor = (ref, included) =>
  ref?.id?.uuid
    ? included.find(entity => entity.type === ref.type && entity.id?.uuid === ref.id.uuid) || null
    : null;

/**
 * @param {Object} tx Sharetribe transaction with its listing, customer and provider included
 * @param {Array<Object>} [included]
 * @returns {Object} what messaging/store.create takes
 */
exports.threadFromTransaction = (tx, included = []) => {
  const relationships = tx.relationships || {};
  const listing = includedFor(relationships.listing?.data, included);
  const customer = includedFor(relationships.customer?.data, included);
  const provider = includedFor(relationships.provider?.data, included);
  return {
    kind: 'order',
    transactionId: tx.id.uuid,
    contextId: relationships.listing?.data?.id?.uuid || '',
    contextTitle: listing?.attributes?.title || '',
    starterId: relationships.customer?.data?.id?.uuid || '',
    starterName: displayNameOf(customer),
    ownerId: relationships.provider?.data?.id?.uuid || '',
    ownerName: displayNameOf(provider),
  };
};

exports.includedFor = includedFor;
