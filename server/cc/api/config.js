/**
 * Public client config. Safe to expose to the browser.
 */

exports.getConfig = async (req, res) => {
  res.json({
    marketplaceName: process.env.REACT_APP_MARKETPLACE_NAME || 'Campus Connect',
    stripePublishableKey: process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY || null,
    rootUrl: process.env.REACT_APP_MARKETPLACE_ROOT_URL || null,
  });
};
