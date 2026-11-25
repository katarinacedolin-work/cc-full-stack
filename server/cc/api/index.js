/**
 * The Campus Connect API, mounted at /api/cc. web/shared/api.js is its only caller.
 *
 * Requests and responses are JSON. A failed request answers with
 * { error: { code, message } }, and the message is safe to show to the person using the site.
 */

const express = require('express');
const log = require('../../log');

const router = express.Router();

router.use(express.json());

// ================ Endpoints ================ //

// ================ Fallbacks ================ //

router.use((req, res) => {
  res.status(404).json({ error: { code: 'not-found', message: 'That address does not exist.' } });
});

// Express recognizes an error handler by its four arguments.
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  const isRequestProblem = err.status >= 400 && err.status < 500;
  if (!isRequestProblem) {
    log.error(err, 'cc-api-request-failed', { path: req.path });
  }
  const error = isRequestProblem
    ? { code: err.code || 'bad-request', message: err.message }
    : { code: 'server-error', message: 'Something went wrong on our side. Please try again.' };
  res.status(isRequestProblem ? err.status : 500).json({ error });
});

module.exports = router;
