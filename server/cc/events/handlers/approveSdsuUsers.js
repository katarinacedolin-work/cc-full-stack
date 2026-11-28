/**
 * Approves verified @sdsu.edu users. An active user who leaves SDSU loses listing and
 * order permissions. Coming back stays active, so approval does not run again, and
 * those permissions are granted back once the SDSU email is verified.
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

const DENY = 'permission/deny';
const ALLOW = 'permission/allow';

// Only write when the stored permissions would actually change. A redundant
// updatePermissions call emits another user/updated event and keeps this worker looping.
const listingOrOrdersDenied = permissions =>
  permissions?.postListings === DENY || permissions?.initiateTransactions === DENY;

const listingAndOrdersDenied = permissions =>
  permissions?.postListings === DENY && permissions?.initiateTransactions === DENY;

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

  if (
    !isSdsuEmail(email) &&
    state === 'active' &&
    !listingAndOrdersDenied(user.attributes?.permissions)
  ) {
    try {
      await sdk.users.updatePermissions({
        id: user.id,
        postListings: DENY,
        initiateTransactions: DENY,
      });
    } catch (e) {
      log.error(e, 'cc-revoke-non-sdsu-permissions-failed', { userId: user.id.uuid });
      throw e;
    }
    return;
  }

  if (
    isSdsuEmail(email) &&
    emailVerified &&
    state === 'active' &&
    listingOrOrdersDenied(user.attributes?.permissions)
  ) {
    try {
      await sdk.users.updatePermissions({
        id: user.id,
        postListings: ALLOW,
        initiateTransactions: ALLOW,
      });
    } catch (e) {
      log.error(e, 'cc-restore-sdsu-permissions-failed', { userId: user.id.uuid });
      throw e;
    }
  }
};
