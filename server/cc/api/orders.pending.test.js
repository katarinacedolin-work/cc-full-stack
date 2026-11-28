jest.mock('../../api-util/sdk', () => ({
  createCookieTokenStore: jest.fn(),
  getSdk: jest.fn(),
  getTrustedSdk: jest.fn(),
  fetchCommission: jest.fn(),
}));
jest.mock('../../api-util/lineItems', () => ({ transactionLineItems: jest.fn() }));
jest.mock('../../api-util/lineItemHelpers', () => ({ constructValidLineItems: jest.fn() }));
jest.mock('../integrationSdk', () => ({ getIntegrationSdk: jest.fn() }));
jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../../log', () => ({ error: jest.fn() }));

const { types } = require('sharetribe-flex-sdk');
const { getSdk } = require('../../api-util/sdk');
const db = require('../db');
const orders = require('./orders');

const { UUID, Money } = types;

const mockRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

const transaction = (id, lastTransition) => ({
  id: new UUID(id),
  type: 'transaction',
  attributes: {
    processName: 'default-purchase',
    lastTransition,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastTransitionedAt: '2026-01-01T00:05:00.000Z',
    payinTotal: new Money(2000, 'USD'),
    lineItems: [],
    protectedData: {
      stripePaymentIntents: { default: { stripePaymentIntentClientSecret: 'pi_1_secret_abc' } },
    },
  },
  relationships: {
    listing: { data: { id: new UUID('listing-1'), type: 'listing' } },
    customer: { data: { id: new UUID('buyer-1'), type: 'user' } },
    provider: { data: { id: new UUID('seller-1'), type: 'user' } },
  },
});

describe('orders that are waiting for payment', () => {
  let sdk;

  const signInAs = userId => {
    sdk.currentUser.show.mockResolvedValue({ data: { data: { id: { uuid: userId } } } });
  };

  beforeEach(() => {
    sdk = {
      currentUser: { show: jest.fn() },
      transactions: { query: jest.fn(), show: jest.fn() },
    };
    getSdk.mockReset();
    getSdk.mockReturnValue(sdk);
    db.query.mockReset();
    db.query.mockResolvedValue({ rows: [] });
    signInAs('buyer-1');
  });

  describe('list', () => {
    const transactions = [
      transaction('paid', 'transition/confirm-payment'),
      transaction('unpaid', 'transition/request-payment'),
      transaction('unpaid-after-inquiry', 'transition/request-payment-after-inquiry'),
      transaction('asked', 'transition/inquire'),
      transaction('timed-out', 'transition/expire-payment'),
    ];

    const listIds = async role => {
      sdk.transactions.query.mockResolvedValue({ data: { data: transactions, included: [] } });
      const res = mockRes();
      await orders.list({ query: { role } }, res);
      return res.json.mock.calls[0][0].orders.map(order => order.id).sort();
    };

    it('shows the buyer their unpaid checkouts so they can finish paying', async () => {
      expect(await listIds('buyer')).toEqual(['paid', 'unpaid', 'unpaid-after-inquiry']);
    });

    it('marks an unpaid checkout as pending-payment for the buyer', async () => {
      sdk.transactions.query.mockResolvedValue({ data: { data: transactions, included: [] } });
      const res = mockRes();
      await orders.list({ query: { role: 'buyer' } }, res);
      const byId = Object.fromEntries(res.json.mock.calls[0][0].orders.map(o => [o.id, o]));
      expect(byId.unpaid.status).toBe('pending-payment');
      expect(byId.paid.status).toBe('confirmed');
    });

    it('does not show the seller a checkout the buyer has not paid for', async () => {
      expect(await listIds('seller')).toEqual(['paid']);
    });

    it('never puts the Stripe client secret in a list', async () => {
      sdk.transactions.query.mockResolvedValue({ data: { data: transactions, included: [] } });
      const res = mockRes();
      await orders.list({ query: { role: 'buyer' } }, res);
      expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('pi_1_secret_abc');
    });
  });

  describe('show', () => {
    const showAs = async (userId, lastTransition) => {
      signInAs(userId);
      sdk.transactions.show.mockResolvedValue({
        data: { data: transaction('tx-1', lastTransition), included: [] },
      });
      const res = mockRes();
      await orders.show({ params: { id: 'tx-1' } }, res);
      return res.json.mock.calls[0][0];
    };

    it('gives the buyer the client secret while payment is pending', async () => {
      const payload = await showAs('buyer-1', 'transition/request-payment');
      expect(payload.order.status).toBe('pending-payment');
      expect(payload.clientSecret).toBe('pi_1_secret_abc');
    });

    it('does not give the seller the client secret', async () => {
      const payload = await showAs('seller-1', 'transition/request-payment');
      expect(payload.order.status).toBe('pending-payment');
      expect(payload).not.toHaveProperty('clientSecret');
    });

    it('does not hand the client secret out once the order is paid', async () => {
      const payload = await showAs('buyer-1', 'transition/confirm-payment');
      expect(payload.order.status).toBe('confirmed');
      expect(payload).not.toHaveProperty('clientSecret');
    });

    it('refuses someone who is not part of the order', async () => {
      signInAs('stranger-1');
      sdk.transactions.show.mockResolvedValue({
        data: { data: transaction('tx-1', 'transition/request-payment'), included: [] },
      });
      const res = mockRes();
      await expect(orders.show({ params: { id: 'tx-1' } }, res)).rejects.toMatchObject({
        status: 403,
      });
      expect(res.json).not.toHaveBeenCalled();
    });
  });
});
