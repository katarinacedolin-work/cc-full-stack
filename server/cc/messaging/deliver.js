/**
 * Stores a message and tells the person it is for.
 *
 * The web service calls this when someone sends a message, and the worker calls it for each
 * message it sees in Sharetribe's event feed. Whichever is first stores the message; the other
 * finds it already there and does nothing.
 */

const db = require('../db');
const { accentFor } = require('../people');
const store = require('./store');
const notifications = require('../notifications/store');

const PREVIEW_LENGTH = 140;

const preview = text => {
  const oneLine = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  return oneLine.length > PREVIEW_LENGTH ? `${oneLine.slice(0, PREVIEW_LENGTH - 1)}…` : oneLine;
};

/**
 * Which pages show a conversation to one of the people in it. Someone written to as a seller
 * reads it in Seller Hub; everyone else reads it on the buyer pages.
 *
 * @param {Object} thread thread row
 * @param {string} userId
 * @returns {'buyer'|'seller'}
 */
const sideFor = (thread, userId) =>
  userId === thread.owner_id && (thread.kind === 'order' || thread.kind === 'direct')
    ? 'seller'
    : 'buyer';

/**
 * @param {Object} delivery
 * @param {Object} delivery.thread thread row
 * @param {string} delivery.senderId
 * @param {string} delivery.body
 * @param {string|null} [delivery.sharetribeId] the message's id in Sharetribe, if it has one
 * @param {string|Date|null} [delivery.createdAt]
 * @returns {Promise<Object|null>} the message row, or null when it was already stored
 */
exports.deliver = ({ thread, senderId, body, sharetribeId = null, createdAt = null }) =>
  db.transaction(async client => {
    const message = await store.addMessage(
      { threadId: thread.id, senderId, body, sharetribeId, createdAt },
      client
    );
    if (!message) return null;

    const people = [thread.starter_id, thread.owner_id];
    const senderName =
      senderId === thread.starter_id
        ? thread.starter_name
        : senderId === thread.owner_id
        ? thread.owner_name
        : 'Campus Connect';

    for (const userId of people.filter(id => id !== senderId)) {
      await notifications.write(
        {
          userId,
          side: sideFor(thread, userId),
          category: 'messages',
          setting: 'notifyMessages',
          title: senderName || 'New message',
          body: preview(body),
          emoji: '💬',
          accent: accentFor(senderId),
          action: 'inbox',
          targetId: String(thread.id),
          dedupeKey: notifications.threadKey(thread.id, userId),
          replace: true,
        },
        client
      );
    }
    await notifications.touch(people, client);
    return message;
  });

exports.sideFor = sideFor;
exports.preview = preview;
