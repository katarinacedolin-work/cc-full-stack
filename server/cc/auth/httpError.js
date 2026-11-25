/**
 * Builds an Error that the /api/cc error handler turns into a JSON response.
 *
 * @param {number} status HTTP status
 * @param {string} code short machine-readable code
 * @param {string} message safe to show to the person using the site
 * @returns {Error}
 */
exports.httpError = (status, code, message) => {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
};
