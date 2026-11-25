/**
 * Sharetribe's Integration API, which acts as the marketplace operator rather than as a
 * signed-in user. Keep it on the server: its credentials can read and change everything.
 */

const sharetribeIntegrationSdk = require('sharetribe-flex-integration-sdk');

const {
  createRateLimiter,
  devQueryLimiterConfig,
  devCommandLimiterConfig,
} = sharetribeIntegrationSdk.util;

let sdk = null;

/**
 * @returns {Object} the Integration API SDK, created on first use
 */
exports.getIntegrationSdk = () => {
  if (!sdk) {
    sdk = sharetribeIntegrationSdk.createInstance({
      clientId: process.env.SHARETRIBE_INTEGRATION_CLIENT_ID,
      clientSecret: process.env.SHARETRIBE_INTEGRATION_CLIENT_SECRET,
      // Sharetribe allows fewer requests in test environments than in live ones. These are the
      // test limits (about one read a second), which are also plenty for a live campus.
      queryLimiter: createRateLimiter(devQueryLimiterConfig),
      commandLimiter: createRateLimiter(devCommandLimiterConfig),
    });
  }
  return sdk;
};
