/**
 * SDSU email checks. Every signed-up account must use a verified @sdsu.edu address.
 */

const SDSU_SUFFIX = '@sdsu.edu';

/**
 * @param {string} email
 * @returns {boolean}
 */
exports.isSdsuEmail = email => {
  if (typeof email !== 'string') {
    return false;
  }
  const trimmed = email.trim().toLowerCase();
  return trimmed.endsWith(SDSU_SUFFIX) && trimmed.length > SDSU_SUFFIX.length;
};

/**
 * @param {string} email
 * @returns {string} lowercased trimmed email
 */
exports.normalizeEmail = email =>
  String(email || '')
    .trim()
    .toLowerCase();
