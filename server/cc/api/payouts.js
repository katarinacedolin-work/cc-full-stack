/**
 * Read-only payout status from the seller's Stripe Connect account on Sharetribe.
 */

const { getSdk, createCookieTokenStore } = require('../../api-util/sdk');
const { httpError } = require('../auth/httpError');

/**
 * GET /api/cc/payouts
 */
exports.getPayouts = async (req, res) => {
  const tokenStore = createCookieTokenStore(req, res);
  const sdk = getSdk(req, res, tokenStore);
  let stripeAccount;
  try {
    const response = await sdk.currentUser.show({ include: ['stripeAccount'] });
    const user = response.data.data;
    const included = response.data.included || [];
    // The SDK does not inline included resources; resolve the relationship manually.
    const accountRef = user?.relationships?.stripeAccount?.data;
    const accountId = accountRef?.id?.uuid || accountRef?.id;
    stripeAccount = accountId
      ? included.find(
          r => r.type === 'stripeAccount' && (r.id?.uuid || r.id) === accountId
        ) || accountRef
      : null;
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      throw httpError(401, 'sign-in-required', 'Sign in to continue.');
    }
    throw e;
  }

  const attrs = stripeAccount?.attributes || {};
  const stripeConnected = Boolean(stripeAccount?.id);
  const chargesEnabled = Boolean(
    attrs.stripeConnectedData?.charges_enabled ?? attrs.chargesEnabled
  );
  const payoutsEnabled = Boolean(
    attrs.stripeConnectedData?.payouts_enabled ?? attrs.payoutsEnabled
  );

  res.json({
    payouts: {
      available: 0,
      pending: 0,
      method: stripeConnected
        ? payoutsEnabled
          ? 'Stripe Connect · payouts on'
          : 'Stripe Connect · finish setup'
        : 'Not connected',
      schedule: 'After pickup is received, a session ends, or an event completes',
      history: [],
      stripeConnected,
      chargesEnabled,
      payoutsEnabled,
      onboardingComplete: stripeConnected && chargesEnabled && payoutsEnabled,
    },
  });
};
