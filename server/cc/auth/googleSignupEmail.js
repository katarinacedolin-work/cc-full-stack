const { verifyGoogleIdToken } = require('../../api-util/googleIdToken');
const { httpError } = require('./httpError');
const { isSdsuEmail, normalizeEmail } = require('./sdsu');

/**
 * Mailbox to pass to Sharetribe `createWithIdp` for a Google signup.
 *
 * Sharetribe creates the user with the email argument even when it differs from
 * the ID token, leaves `emailVerified` false in that case, and still binds the
 * Google subject to that mailbox. The email therefore has to be the address
 * inside the verified token. `st-authinfo` is readable from page script, so a
 * value taken from that cookie or from the request body is only accepted when
 * it is the same address.
 *
 * @param {string} idToken httpOnly `st-idp-token` cookie
 * @param {string} audience Google OAuth client id
 * @param {...string} requestedEmails emails from the pending-signup cookie or body
 * @returns {Promise<string>} verified @sdsu.edu address from the token
 */
exports.emailForGoogleSignup = async (idToken, audience, ...requestedEmails) => {
  let account;
  try {
    account = await verifyGoogleIdToken(idToken, audience);
  } catch {
    // The token is missing, expired, or not signed by Google.
    throw httpError(400, 'google-session-expired', 'Start again with Continue with Google.');
  }

  // Keep the token's own spelling. Sharetribe copies email_verified only when
  // the address we send is the one in the token.
  const email = String(account.email || '').trim();
  const normalized = normalizeEmail(email);
  if (!account.emailVerified || !isSdsuEmail(normalized)) {
    throw httpError(
      400,
      'sdsu-email-required',
      'Use a Google account registered with your verified @sdsu.edu email.'
    );
  }

  const mismatched = requestedEmails.some(requested => {
    const requestedNormalized = normalizeEmail(requested);
    return requestedNormalized && requestedNormalized !== normalized;
  });
  if (mismatched) {
    throw httpError(400, 'google-session-expired', 'Start again with Continue with Google.');
  }

  return email;
};
