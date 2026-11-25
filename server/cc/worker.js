/**
 * The Campus Connect background worker.
 *
 * Follows Sharetribe's event feed and runs the handlers in events/handlers.js for each event.
 * It runs as its own process, next to the web service.
 */

// Configure process.env with .env.* files
require('../env').configureEnv();

// This sets up Sentry.
const log = require('../log');

const db = require('./db');
const { requireEnv } = require('./env');
const { getIntegrationSdk } = require('./integrationSdk');
const cursor = require('./events/cursor');
const handlers = require('./events/handlers');
const { pollOnce } = require('./events/poll');

requireEnv([
  'DATABASE_URL',
  'SHARETRIBE_INTEGRATION_CLIENT_ID',
  'SHARETRIBE_INTEGRATION_CLIENT_SECRET',
]);

// How long to wait before asking Sharetribe for more events.
const IDLE_WAIT_MS = 10000; // the feed had nothing more
const BUSY_WAIT_MS = 250; // a full page came back, so more are waiting

let stopping = false;
let wakeUp = () => {};

const sleep = ms =>
  new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    wakeUp = () => {
      clearTimeout(timer);
      resolve();
    };
  });

const run = async () => {
  const sdk = getIntegrationSdk();
  console.log('Campus Connect worker started.'); // eslint-disable-line no-console

  while (!stopping) {
    let fullPage = false;
    try {
      ({ fullPage } = await pollOnce({ sdk, cursor, handlers }));
    } catch (e) {
      // The failed event is fetched again on the next round.
      log.error(e, 'cc-worker-poll-failed');
    }
    if (!stopping) {
      await sleep(fullPage ? BUSY_WAIT_MS : IDLE_WAIT_MS);
    }
  }

  await db.close();
  console.log('Campus Connect worker stopped.'); // eslint-disable-line no-console
};

// Let the current round finish, then stop.
['SIGINT', 'SIGTERM'].forEach(signal => {
  process.on(signal, () => {
    stopping = true;
    wakeUp();
  });
});

run();
