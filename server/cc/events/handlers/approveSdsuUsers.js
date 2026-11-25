/**
 * Approves verified @sdsu.edu users, and removes listing/order permissions from anyone
 * whose email is no longer an SDSU address.
 *
 * Requires "require approval to join" to be turned on in Sharetribe Console.
 */

const { isSdsuEmail } = require('../../auth/sdsu');
const { getIntegrationSdk } = require('../../integrationSdk');
const log = require('../../../log');

const USER_EVENTS = new Set([
  'user/created',
  'user/updated',
  'user/email_updated',
  'user/email_verified',
]);

/**
 * @param {Object} event Sharetribe event resource
 */
module.exports = async event => {
  if (!USER_EVENTS.has(event.attributes.eventType)) {
    return;
  }

  const user = event.attributes.resource;
  if (!user?.id) {
    return;
  }

  const email = user.attributes?.email || '';
  const emailVerified = Boolean(user.attributes?.emailVerified);
  const state = user.attributes?.state;
  const sdk = getIntegrationSdk();

  if (isSdsuEmail(email) && emailVerified && state === 'pending-approval') {
    try {
      await sdk.users.approve({ id: user.id });
    } catch (e) {
      // Already approved, or a race with another worker pass.
      if (e.status !== 409 && e.status !== 400) {
        log.error(e, 'cc-approve-sdsu-user-failed', { userId: user.id.uuid });
        throw e;
      }
    }
    return;
  }

  if (!isSdsuEmail(email) && state === 'active') {
    try {
      await sdk.users.updatePermissions({
        id: user.id,
        postListings: 'permission/deny',
        initiateTransactions: 'permission/deny',
      });
    } catch (e) {
      log.error(e, 'cc-revoke-non-sdsu-permissions-failed', { userId: user.id.uuid });
      throw e;
    }
  }
};
