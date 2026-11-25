jest.mock('../../integrationSdk', () => ({
  getIntegrationSdk: jest.fn(),
}));

jest.mock('../../notifications/store', () => ({
  write: jest.fn(async () => true),
  touch: jest.fn(async () => {}),
}));

jest.mock('../../messaging/store', () => ({
  hasSharetribeMessage: jest.fn(async () => false),
  findByTransaction: jest.fn(async () => null),
  create: jest.fn(async thread => ({ id: '7', ...thread })),
}));

jest.mock('../../messaging/deliver', () => ({
  deliver: jest.fn(async () => ({})),
}));

const { getIntegrationSdk } = require('../../integrationSdk');
const notifications = require('../../notifications/store');
const threads = require('../../messaging/store');
const { deliver } = require('../../messaging/deliver');
const notifyEvents = require('./notifyEvents');

const ref = (type, uuid) => ({ data: { type, id: { uuid } } });

const relationships = {
  listing: ref('listing', 'listing-1'),
  customer: ref('user', 'buyer-1'),
  provider: ref('user', 'seller-1'),
};

const included = [
  {
    type: 'listing',
    id: { uuid: 'listing-1' },
    attributes: { title: 'Desk lamp', publicData: { emoji: '💡', accent: 'butter' } },
  },
  { type: 'user', id: { uuid: 'buyer-1' }, attributes: { profile: { displayName: 'Jordan P' } } },
  { type: 'user', id: { uuid: 'seller-1' }, attributes: { profile: { displayName: 'Maya C' } } },
];

const transitioned = (lastTransition, processName = 'default-purchase') => ({
  attributes: {
    eventType: 'transaction/transitioned',
    resource: {
      id: { uuid: 'tx-1' },
      type: 'transaction',
      attributes: { processName, lastTransition },
      relationships,
    },
  },
});

const messageCreated = (overrides = {}) => ({
  attributes: {
    eventType: 'message/created',
    resource: {
      id: { uuid: 'message-1' },
      type: 'message',
      attributes: { content: 'Is this still available?', createdAt: '2026-11-20T18:00:00.000Z' },
      relationships: {
        sender: ref('user', 'buyer-1'),
        transaction: ref('transaction', 'tx-1'),
      },
      ...overrides,
    },
  },
});

describe('notifyEvents', () => {
  let sdk;

  beforeEach(() => {
    jest.clearAllMocks();
    // Jest resets mock implementations between tests here, so each test sets them again.
    threads.hasSharetribeMessage.mockResolvedValue(false);
    threads.findByTransaction.mockResolvedValue(null);
    threads.create.mockImplementation(async thread => ({ id: '7', ...thread }));
    notifications.write.mockResolvedValue(true);
    notifications.touch.mockResolvedValue();
    deliver.mockResolvedValue({});
    sdk = {
      transactions: {
        show: jest.fn(async () => ({
          data: { data: { id: { uuid: 'tx-1' }, relationships }, included },
        })),
      },
    };
    getIntegrationSdk.mockReturnValue(sdk);
  });

  it('puts a paid order on the seller’s bell', async () => {
    await notifyEvents(transitioned('transition/confirm-payment'));
    expect(notifications.write).toHaveBeenCalledTimes(1);
    expect(notifications.write).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'seller-1',
        side: 'seller',
        title: 'New order',
        body: 'Jordan P · Desk lamp',
        emoji: '💡',
        targetId: 'tx-1',
        dedupeKey: 'tx:tx-1:confirm-payment:seller',
      })
    );
    expect(notifications.touch).toHaveBeenCalledWith(['buyer-1', 'seller-1']);
  });

  it('words a booking and a ticket differently from a product', async () => {
    await notifyEvents(transitioned('transition/confirm-payment', 'default-booking'));
    await notifyEvents(transitioned('transition/confirm-payment', 'cc-ticket'));
    expect(notifications.write.mock.calls.map(([n]) => n.title)).toEqual([
      'New booking request',
      'Ticket sold',
    ]);
  });

  it('does not ask Sharetribe about steps nobody is told about', async () => {
    await notifyEvents(transitioned('transition/request-payment'));
    await notifyEvents(transitioned('transition/expire-payment'));
    expect(sdk.transactions.show).not.toHaveBeenCalled();
    expect(notifications.write).not.toHaveBeenCalled();
  });

  it('copies a message into a new conversation for its order', async () => {
    await notifyEvents(messageCreated());
    expect(threads.create).toHaveBeenCalledWith({
      kind: 'order',
      transactionId: 'tx-1',
      contextId: 'listing-1',
      contextTitle: 'Desk lamp',
      starterId: 'buyer-1',
      starterName: 'Jordan P',
      ownerId: 'seller-1',
      ownerName: 'Maya C',
    });
    expect(deliver).toHaveBeenCalledWith({
      thread: expect.objectContaining({ id: '7' }),
      senderId: 'buyer-1',
      body: 'Is this still available?',
      sharetribeId: 'message-1',
      createdAt: '2026-11-20T18:00:00.000Z',
    });
  });

  it('uses the conversation an order already has', async () => {
    threads.findByTransaction.mockResolvedValue({ id: '3', transaction_id: 'tx-1' });
    await notifyEvents(messageCreated());
    expect(sdk.transactions.show).not.toHaveBeenCalled();
    expect(threads.create).not.toHaveBeenCalled();
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({ thread: { id: '3', transaction_id: 'tx-1' } })
    );
  });

  it('leaves a message alone when the web service already stored it', async () => {
    threads.hasSharetribeMessage.mockResolvedValue(true);
    await notifyEvents(messageCreated());
    expect(threads.findByTransaction).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it('ignores a message it cannot place', async () => {
    await notifyEvents(messageCreated({ relationships: {} }));
    expect(deliver).not.toHaveBeenCalled();
  });

  it('ignores other kinds of event', async () => {
    await notifyEvents({
      attributes: { eventType: 'listing/updated', resource: { id: { uuid: 'listing-1' } } },
    });
    await notifyEvents({ attributes: { eventType: 'user/deleted', resource: null } });
    expect(notifications.write).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });
});
