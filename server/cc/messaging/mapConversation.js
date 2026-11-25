/**
 * Maps a conversation in Postgres into the shape the inbox pages use, as one of the two people
 * in it sees it.
 */

const { accentFor, initialsOf } = require('../people');

const CONTEXT_FALLBACK = {
  order: 'Listing',
  direct: 'Direct message',
  job: 'Job Board',
  housing: 'Housing',
  'ticket-post': 'Tickets',
};

/**
 * @param {Object} thread thread row, with the viewer's read_at and done
 * @param {Array<Object>} messages message rows, oldest first
 * @param {string} viewerId
 * @returns {Object} conversation
 */
exports.toConversation = (thread, messages, viewerId) => {
  const viewerStarted = thread.starter_id === viewerId;
  const otherId = viewerStarted ? thread.owner_id : thread.starter_id;
  const otherName = (viewerStarted ? thread.owner_name : thread.starter_name) || 'Student';
  const readAt = thread.read_at ? new Date(thread.read_at).getTime() : 0;

  const conversation = {
    id: String(thread.id),
    kind: thread.kind,
    name: otherName,
    initials: initialsOf(otherName),
    accent: accentFor(otherId),
    personId: otherId,
    context: thread.context_title || CONTEXT_FALLBACK[thread.kind] || 'Campus Connect',
    unread: messages.some(
      message => message.sender_id !== viewerId && new Date(message.created_at).getTime() > readAt
    ),
    done: Boolean(thread.done),
    messages: messages.map(message => ({
      from: message.sender_id === viewerId ? 'me' : 'them',
      text: message.body,
      at: new Date(message.created_at).toISOString(),
    })),
  };

  if (thread.kind === 'order') {
    conversation.listingId = thread.context_id || null;
    // Set once the conversation belongs to a Sharetribe transaction. A question that never
    // became an order has one too, so the pages check it against the orders they know.
    conversation.orderId = thread.transaction_id || null;
  }
  if (viewerStarted && (thread.kind === 'order' || thread.kind === 'direct')) {
    conversation.sellerId = otherId;
  }
  return conversation;
};
