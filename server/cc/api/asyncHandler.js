/**
 * Runs an async route handler and forwards thrown errors to the /api/cc error handler.
 * Express 5 does this on its own for native async functions; this keeps the call sites clear
 * and works the same if a route is ever mounted on Express 4.
 *
 * @param {Function} fn async (req, res, next) => …
 */
module.exports = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
