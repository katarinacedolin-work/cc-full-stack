/**
 * Fetches the next page of Sharetribe events and runs every handler for each one, oldest first.
 *
 * The place in the feed is saved after each event, so a restart continues where it stopped.
 * When a handler throws, this stops and throws too: the place stays on the event before, and
 * the next call gets the failed event again. Nothing is skipped, which is why handlers must be
 * safe to run twice for the same event.
 *
 * @param {Object} deps
 * @param {Object} deps.sdk Integration API SDK
 * @param {Object} deps.cursor the saved place: get() and set(sequenceId)
 * @param {Array<Function>} deps.handlers async functions that take one event
 * @returns {Promise<{ count: number, fullPage: boolean }>} how many events were handled, and
 * whether the page was full, which means more are already waiting
 */
exports.pollOnce = async ({ sdk, cursor, handlers }) => {
  const { sequenceId, startedAt } = await cursor.get();
  const from =
    sequenceId == null ? { createdAtStart: startedAt } : { startAfterSequenceId: sequenceId };

  const response = await sdk.events.query(from);
  const events = response.data.data;

  for (const event of events) {
    for (const handle of handlers) {
      await handle(event);
    }
    await cursor.set(event.attributes.sequenceId);
  }

  return { count: events.length, fullPage: events.length === response.data.meta.perPage };
};
