/**
 * Fetches the next page of Sharetribe events and runs every handler for each one, oldest first.
 *
 * The place in the feed is saved after each event, so a restart continues where it stopped.
 * When a handler throws, this stops and throws too: the place stays on the event before, and
 * the next call gets the failed event again. Nothing is skipped, which is why handlers must be
 * safe to run twice for the same event.
 *
 * Until the first event is stored, the query uses a start time. Sharetribe keeps events for
 * 90 days on a live marketplace and 7 days on dev and test, and it rejects an older start.
 * A quiet feed would otherwise retry that rejected query forever and miss every later event,
 * so an expired start is moved forward to a time the API still accepts.
 */

// Sharetribe counts the window from midnight UTC. Staying one day inside it keeps the
// timestamp valid when the request arrives.
const LIVE_RETENTION_DAYS = 90;
const TEST_RETENTION_DAYS = 7;

const earliestStart = days => {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start;
};

// Stable parts of the error only. The wording of `details` is not part of the API.
const isExpiredStart = error => {
  const errors = error && error.data && error.data.errors;
  if (!Array.isArray(errors)) {
    return false;
  }
  return errors.some(item => {
    const path = item && item.source && item.source.path;
    return (
      item.code === 'validation-invalid-value' &&
      Array.isArray(path) &&
      path.includes('createdAtStart')
    );
  });
};

/**
 * @param {Object} deps
 * @param {Object} deps.sdk Integration API SDK
 * @param {Object} deps.cursor the saved place: get(), set(sequenceId), and setStartedAt(date)
 * @param {Array<Function>} deps.handlers async functions that take one event
 * @returns {Promise<{ count: number, fullPage: boolean }>} how many events were handled, and
 * whether the page was full, which means more are already waiting
 */
exports.pollOnce = async ({ sdk, cursor, handlers }) => {
  let { sequenceId, startedAt } = await cursor.get();
  startedAt = new Date(startedAt);

  if (sequenceId == null) {
    const liveStart = earliestStart(LIVE_RETENTION_DAYS);
    if (startedAt < liveStart) {
      startedAt = liveStart;
      await cursor.setStartedAt(startedAt);
    }
  }

  const from =
    sequenceId == null ? { createdAtStart: startedAt } : { startAfterSequenceId: sequenceId };

  let response;
  try {
    response = await sdk.events.query(from);
  } catch (error) {
    // Dev and test keep a shorter history, so the live window can still be rejected.
    if (sequenceId != null || !isExpiredStart(error)) {
      throw error;
    }
    startedAt = earliestStart(TEST_RETENTION_DAYS);
    await cursor.setStartedAt(startedAt);
    response = await sdk.events.query({ createdAtStart: startedAt });
  }

  const events = response.data.data;

  for (const event of events) {
    for (const handle of handlers) {
      await handle(event);
    }
    await cursor.set(event.attributes.sequenceId);
  }

  return { count: events.length, fullPage: events.length === response.data.meta.perPage };
};
