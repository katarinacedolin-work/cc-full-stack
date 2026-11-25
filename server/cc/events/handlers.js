/**
 * What the worker does with Sharetribe events.
 *
 * Each handler is an async function that takes one event. Every handler gets every event and
 * returns early for the types it doesn't care about. A handler can run twice for the same
 * event (see poll.js), so running it again must not repeat its effect.
 */
module.exports = [];
