jest.mock('../../integrationSdk', () => ({
  getIntegrationSdk: jest.fn(),
}));

jest.mock('../../tickets/store', () => ({
  findByTransaction: jest.fn(async () => null),
  voidAlways: jest.fn(async () => {}),
  markCompleted: jest.fn(async () => {}),
  updateEvent: jest.fn(async () => {}),
}));

jest.mock('../../tickets/complete', () => ({
  issueFor: jest.fn(async () => ({})),
}));

const { getIntegrationSdk } = require('../../integrationSdk');
const store = require('../../tickets/store');
const { issueFor } = require('../../tickets/complete');
const ticketEvents = require('./ticketEvents');

const transitioned = (lastTransition, processName = 'cc-ticket') => ({
  attributes: {
    eventType: 'transaction/transitioned',
    resource: { id: { uuid: 'tx-1' }, attributes: { processName, lastTransition } },
  },
});

describe('ticketEvents', () => {
  let sdk;

  beforeEach(() => {
    jest.clearAllMocks();
    store.findByTransaction.mockResolvedValue(null);
    sdk = {
      transactions: {
        show: jest.fn(async () => ({ data: { data: { id: { uuid: 'tx-1' } }, included: [] } })),
      },
    };
    getIntegrationSdk.mockReturnValue(sdk);
  });

  it('issues a ticket when a ticket order is paid', async () => {
    await ticketEvents(transitioned('transition/confirm-payment'));
    expect(sdk.transactions.show).toHaveBeenCalledWith({
      id: { uuid: 'tx-1' },
      include: ['listing', 'customer', 'provider'],
    });
    expect(issueFor).toHaveBeenCalledWith({ id: { uuid: 'tx-1' } }, []);
  });

  it('does not ask Sharetribe again when the web service already issued the ticket', async () => {
    store.findByTransaction.mockResolvedValue({ code: 'K7M3QX9RTB' });
    await ticketEvents(transitioned('transition/confirm-payment'));
    expect(sdk.transactions.show).not.toHaveBeenCalled();
    expect(issueFor).not.toHaveBeenCalled();
  });

  it('cancels the ticket when the order is refunded', async () => {
    await ticketEvents(transitioned('transition/cancel'));
    expect(store.voidAlways).toHaveBeenCalledWith('tx-1');
  });

  it('records an order that Sharetribe completed', async () => {
    await ticketEvents(transitioned('transition/auto-complete'));
    await ticketEvents(transitioned('transition/operator-complete'));
    expect(store.markCompleted).toHaveBeenCalledTimes(2);
  });

  it('ignores orders for products and services', async () => {
    await ticketEvents(transitioned('transition/confirm-payment', 'default-purchase'));
    await ticketEvents(transitioned('transition/cancel', 'default-booking'));
    expect(issueFor).not.toHaveBeenCalled();
    expect(store.voidAlways).not.toHaveBeenCalled();
  });

  it('follows an event whose title or time was edited', async () => {
    await ticketEvents({
      attributes: {
        eventType: 'listing/updated',
        resource: {
          id: { uuid: 'listing-1' },
          attributes: {
            title: 'Winter showcase',
            publicData: { kind: 'ticket', eventStartsAt: '2027-01-15T03:00:00.000Z' },
          },
        },
      },
    });
    expect(store.updateEvent).toHaveBeenCalledWith({
      listingId: 'listing-1',
      listingTitle: 'Winter showcase',
      eventStartsAt: '2027-01-15T03:00:00.000Z',
    });
  });

  it('ignores edits to other kinds of listing', async () => {
    await ticketEvents({
      attributes: {
        eventType: 'listing/updated',
        resource: {
          id: { uuid: 'listing-2' },
          attributes: { title: 'Desk chair', publicData: { kind: 'product' } },
        },
      },
    });
    expect(store.updateEvent).not.toHaveBeenCalled();
  });
});
