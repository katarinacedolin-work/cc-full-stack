const { createCookieTokenStore, getSdk } = require('../../api-util/sdk');
const { httpError } = require('../auth/httpError');

/**
 * The signed-in student, or a 401.
 *
 * @param {Object} req
 * @param {Object} res
 * @returns {Promise<{ sdk: Object, tokenStore: Object, user: Object, userId: string }>} the
 * Marketplace SDK acting as that student, and their currentUser resource
 */
exports.requireUser = async (req, res) => {
  const tokenStore = createCookieTokenStore(req, res);
  const sdk = getSdk(req, res, tokenStore);
  try {
    const response = await sdk.currentUser.show();
    const user = response.data.data;
    return { sdk, tokenStore, user, userId: user.id.uuid };
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      throw httpError(401, 'sign-in-required', 'Sign in to continue.');
    }
    throw e;
  }
};

/**
 * The signed-in student, who must also be past SDSU email verification. Posting and messaging
 * need this; Sharetribe checks it itself for listings and orders.
 */
exports.requireApprovedUser = async (req, res) => {
  const found = await exports.requireUser(req, res);
  if (found.user.attributes.state !== 'active') {
    throw httpError(403, 'not-verified', 'Finish verifying your SDSU email first.');
  }
  return found;
};
