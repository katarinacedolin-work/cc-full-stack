const { createRemoteJWKSet, jwtVerify } = require('jose');

// Google publishes the keys that sign ID tokens. jose caches them.
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

// Google issues tokens with either issuer. Both are valid.
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/**
 * Verifies a Google ID token and returns the identity claims Sharetribe will trust.
 * The signature, issuer, audience, and expiry are checked. Callers must still
 * decide which email is allowed to become the marketplace mailbox.
 *
 * @param {string} idToken Google `id_token` from the OAuth callback
 * @param {string} audience Google OAuth client id (`REACT_APP_GOOGLE_CLIENT_ID`)
 * @returns {Promise<{ email: string, emailVerified: boolean, givenName: string, familyName: string }>}
 */
exports.verifyGoogleIdToken = async (idToken, audience) => {
  if (typeof idToken !== 'string' || !idToken || typeof audience !== 'string' || !audience) {
    throw new Error('Missing Google ID token.');
  }

  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: GOOGLE_ISSUERS,
    audience,
    clockTolerance: 30,
  });

  return {
    email: typeof payload.email === 'string' ? payload.email : '',
    emailVerified: payload.email_verified === true,
    givenName: typeof payload.given_name === 'string' ? payload.given_name : '',
    familyName: typeof payload.family_name === 'string' ? payload.family_name : '',
  };
};
