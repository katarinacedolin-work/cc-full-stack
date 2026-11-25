jest.mock('./store', () => ({
  issue: jest.fn(async ticket => ticket),
  markCompleted: jest.fn(async () => {}),
  markCompletionChecked: jest.fn(async () => {}),
  voidAlways: jest.fn(async () => {}),
  dueForCompletion: jest.fn(async () => []),
}));

jest.mock('../../log', () => ({
  error: jest.fn(),
}));

const store = require('./store');
const { issueFor, completeOrder, completeDue } = require('./complete');

const TX_ID = '6a1f0c2e-8f1b-4c56-9a1d-2f6f0e9b7c11';
const ticket = { transaction_id: TX_ID };

const sdkWith = ({ transition, lastTransition }) => ({
  transactions: {
    transition: jest.fn(transition),
    show: jest.fn(async () => ({ data: { data: { attributes: { lastTransition } } } })),
  },
});

describe('issueFor', () => {
  it('issues a ticket from the paid order', async () => {
    const tx = {
      id: { uuid: TX_ID },
      relationships: {
        listing: { data: { id: { uuid: 'listing-1' }, type: 'listing' } },
        customer: { data: { id: { uuid: 'buyer-1' }, type: 'user' } },
        provider: { data: { id: { uuid: 'seller-1' }, type: 'user' } },
      },
    };
    const included = [
      {
        id: { uuid: 'listing-1' },
        type: 'listing',
        attributes: {
          title: 'Open studio night',
          publicData: { eventStartsAt: '2026-12-05T03:00:00.000Z' },
        },
      },
      {
        id: { uuid: 'buyer-1' },
        type: 'user',
        attributes: { profile: { displayName: 'Jordan P' } },
      },
    ];

    await issueFor(tx, included);
    expect(store.issue).toHaveBeenCalledWith({
      transactionId: TX_ID,
      listingId: 'listing-1',
      sellerId: 'seller-1',
      buyerId: 'buyer-1',
      buyerName: 'Jordan P',
      listingTitle: 'Open studio night',
      eventStartsAt: '2026-12-05T03:00:00.000Z',
    });
  });

  it('does nothing for a transaction without a listing', async () => {
    store.issue.mockClear();
    expect(await issueFor({ id: { uuid: TX_ID }, relationships: {} })).toBeNull();
    expect(store.issue).not.toHaveBeenCalled();
  });
});

describe('completeOrder', () => {
  beforeEach(() => jest.clearAllMocks());

  it('completes the order and records it', async () => {
    const sdk = sdkWith({ transition: async () => ({}) });
    expect(await completeOrder(sdk, ticket)).toBe(true);
    expect(sdk.transactions.transition).toHaveBeenCalledWith({
      id: expect.objectContaining({ uuid: TX_ID }),
      transition: 'transition/operator-complete',
      params: {},
    });
    expect(store.markCompleted).toHaveBeenCalledWith(TX_ID);
  });

  it('records an order that was already completed', async () => {
    const sdk = sdkWith({
      transition: async () => {
        throw Object.assign(new Error('conflict'), { status: 409 });
      },
      lastTransition: 'transition/auto-complete',
    });
    expect(await completeOrder(sdk, ticket)).toBe(true);
    expect(store.markCompleted).toHaveBeenCalledWith(TX_ID);
    expect(store.markCompletionChecked).not.toHaveBeenCalled();
  });

  it('cancels the ticket of an order that was refunded', async () => {
    const sdk = sdkWith({
      transition: async () => {
        throw Object.assign(new Error('conflict'), { status: 409 });
      },
      lastTransition: 'transition/cancel',
    });
    expect(await completeOrder(sdk, ticket)).toBe(true);
    expect(store.voidAlways).toHaveBeenCalledWith(TX_ID);
    expect(store.markCompleted).not.toHaveBeenCalled();
  });

  it('leaves an order it could not complete for a later try', async () => {
    const sdk = sdkWith({
      transition: async () => {
        throw Object.assign(new Error('unavailable'), { status: 503 });
      },
      lastTransition: 'transition/confirm-payment',
    });
    expect(await completeOrder(sdk, ticket)).toBe(false);
    expect(store.markCompleted).not.toHaveBeenCalled();
    expect(store.markCompletionChecked).toHaveBeenCalledWith(TX_ID);
  });
});

describe('completeDue', () => {
  it('goes through every due order and counts the ones it settled', async () => {
    const other = '0b9d3c47-52aa-4f0e-b1a3-7d2f4c8e9a10';
    store.dueForCompletion.mockResolvedValueOnce([ticket, { transaction_id: other }]);
    const sdk = sdkWith({
      transition: async ({ id }) => {
        if (id.uuid === other) throw Object.assign(new Error('unavailable'), { status: 503 });
        return {};
      },
      lastTransition: 'transition/confirm-payment',
    });
    expect(await completeDue(sdk)).toBe(1);
    expect(sdk.transactions.transition).toHaveBeenCalledTimes(2);
  });
});
