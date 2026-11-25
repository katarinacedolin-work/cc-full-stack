/**
 * The Campus Connect API, mounted at /api/cc. web/shared/api.js is its only caller.
 *
 * Requests and responses are JSON. A failed request answers with
 * { error: { code, message } }, and the message is safe to show to the person using the site.
 */

const express = require('express');
const log = require('../../log');
const asyncHandler = require('./asyncHandler');
const auth = require('./auth');
const listings = require('./listings');
const images = require('./images');
const stores = require('./stores');
const orders = require('./orders');
const config = require('./config');
const payouts = require('./payouts');
const tickets = require('./tickets');
const conversations = require('./conversations');
const notifications = require('./notifications');
const boards = require('./boards');
const directory = require('./directory');
const support = require('./support');

const router = express.Router();

router.use(express.json({ limit: '2mb' }));

// ================ Auth ================ //

router.get('/session', asyncHandler(auth.getSession));
router.post('/signup', asyncHandler(auth.signup));
router.post('/login', asyncHandler(auth.login));
router.post('/logout', asyncHandler(auth.logout));
router.post('/password-reset/request', asyncHandler(auth.requestPasswordReset));
router.post('/password-reset/confirm', asyncHandler(auth.confirmPasswordReset));
router.post('/verify-email', asyncHandler(auth.verifyEmail));
router.post('/resend-verification', asyncHandler(auth.resendVerification));
router.post('/signup-with-google', asyncHandler(auth.signupWithGoogle));
router.patch('/account', asyncHandler(auth.updateAccount));

// ================ Listings and stores ================ //

router.get('/listings', asyncHandler(listings.list));
router.post('/listings', asyncHandler(listings.create));
router.post('/listings/away', asyncHandler(listings.setAwayMode));
router.get('/listings/:id', asyncHandler(listings.show));
router.patch('/listings/:id', asyncHandler(listings.update));
router.post('/listings/:id/duplicate', asyncHandler(listings.duplicate));
router.delete('/listings/:id', asyncHandler(listings.remove));

router.post(
  '/images',
  express.raw({ type: ['image/*', 'application/octet-stream'], limit: '10mb' }),
  asyncHandler(images.upload)
);

router.get('/stores', asyncHandler(stores.list));
router.get('/stores/:id', asyncHandler(stores.show));
router.put('/stores/:id', asyncHandler(stores.upsert));

// ================ Orders and payouts ================ //

router.get('/config', asyncHandler(config.getConfig));
router.get('/orders', asyncHandler(orders.list));
router.post('/orders', asyncHandler(orders.create));
router.post('/orders/line-items', asyncHandler(orders.lineItems));
router.get('/orders/:id', asyncHandler(orders.show));
router.post('/orders/:id/confirm-payment', asyncHandler(orders.confirmPayment));
router.post('/orders/:id/ready-for-pickup', asyncHandler(orders.readyForPickup));
router.post('/orders/:id/actions/:action', asyncHandler(orders.action));
router.post('/orders/:id/operator/:action', asyncHandler(orders.operatorAction));
router.get('/payouts', asyncHandler(payouts.getPayouts));

// ================ Tickets ================ //

router.post('/tickets/scan', asyncHandler(tickets.scan));
router.get('/tickets/door', asyncHandler(tickets.door));
router.post('/tickets/door-helpers', asyncHandler(tickets.addHelper));
router.delete('/tickets/door-helpers/:listingId/:userId', asyncHandler(tickets.removeHelper));

// ================ Messages and notifications ================ //

router.get('/conversations', asyncHandler(conversations.list));
router.post('/conversations', asyncHandler(conversations.open));
router.post('/conversations/:id/messages', asyncHandler(conversations.send));
router.post('/conversations/:id/read', asyncHandler(conversations.markRead));
router.post('/conversations/:id/done', asyncHandler(conversations.setDone));

router.get('/notifications', asyncHandler(notifications.list));
router.post('/notifications/read-all', asyncHandler(notifications.markAllRead));
router.post('/notifications/:id/read', asyncHandler(notifications.markRead));
router.get('/settings', asyncHandler(notifications.getSettings));
router.patch('/settings', asyncHandler(notifications.updateSettings));
router.get('/changes', asyncHandler(notifications.changes));

// ================ Boards, the directory and support ================ //

router.get('/board-posts', asyncHandler(boards.list));
router.post('/board-posts', asyncHandler(boards.create));
router.delete('/board-posts/:id', asyncHandler(boards.remove));
router.get('/directory', asyncHandler(directory.list));
router.post('/support', asyncHandler(support.create));

// ================ Fallbacks ================ //

router.use((req, res) => {
  res.status(404).json({ error: { code: 'not-found', message: 'That address does not exist.' } });
});

// Express recognizes an error handler by its four arguments.
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  // httpError() always sets both status and code. Keep those messages, including 503.
  const known = Number.isInteger(err.status) && err.status >= 400 && Boolean(err.code);
  if (!known || err.status >= 500) {
    log.error(err, 'cc-api-request-failed', { path: req.path });
  }
  if (known) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  res.status(500).json({
    error: { code: 'server-error', message: 'Something went wrong on our side. Please try again.' },
  });
});

module.exports = router;
