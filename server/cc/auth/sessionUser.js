/**
 * Turns a Sharetribe currentUser into the session shape Campus Connect screens expect.
 */

/**
 * @param {Object|null} user Sharetribe currentUser resource, or null when signed out
 * @returns {{
 *   userId: string,
 *   email: string,
 *   emailVerified: boolean,
 *   approved: boolean,
 *   firstName: string,
 *   lastName: string,
 *   displayName: string,
 *   isAdmin: boolean,
 *   awayMode: boolean
 * }|null}
 */
exports.toSession = user => {
  if (!user) {
    return null;
  }
  const { attributes = {}, id } = user;
  const profile = attributes.profile || {};
  const privateData = profile.privateData || {};
  const displayName =
    profile.displayName ||
    [profile.firstName, profile.lastName]
      .filter(Boolean)
      .join(' ')
      .trim() ||
    attributes.email ||
    '';

  // With "require approval to join", a new account is pending-approval until the worker
  // approves it. Banned accounts are also not active.
  const approved = attributes.state === 'active';
  const metadata = attributes.profile?.metadata || attributes.metadata || {};

  return {
    userId: id.uuid,
    email: attributes.email || '',
    emailVerified: Boolean(attributes.emailVerified),
    approved,
    state: attributes.state || null,
    firstName: profile.firstName || '',
    lastName: profile.lastName || '',
    displayName,
    isAdmin: Boolean(metadata.isAdmin),
    termsAcceptedAt: privateData.termsAcceptedAt || null,
    termsVersion: privateData.termsVersion || null,
    // Away mode lives on the profile. The seller hub mock resets on reload, so the
    // toggle has to read this flag or it shows off while listings stay closed.
    awayMode: Boolean(privateData.awayMode),
  };
};
