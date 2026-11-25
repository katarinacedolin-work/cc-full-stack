const { types } = require('sharetribe-flex-sdk');
const { toCampusOrder, statusFromTransaction } = require('./mapOrder');

const { UUID, Money } = types;

const tx = (overrides = {}) => ({
  id: new UUID('tx-1'),
  type: 'transaction',
  attributes: {
    processName: 'default-purchase',
    processAlias: 'default-purchase/release-1',
    lastTransition: 'transition/confirm-payment',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastTransitionedAt: '2026-01-01T00:05:00.000Z',
    payinTotal: new Money(2000, 'USD'),
    payoutTotal: new Money(1728, 'USD'),
    lineItems: [
      {
        code: 'line-item/item',
        quantity: 2,
        lineTotal: new Money(2000, 'USD'),
      },
      {
        code: 'line-item/provider-commission',
        lineTotal: new Money(-72, 'USD'),
      },
    ],
    protectedData: { customerNote: 'Meet at the library' },
    ...overrides.attributes,
  },
  relationships: {
    listing: { data: { id: new UUID('listing-1'), type: 'listing' } },
    customer: { data: { id: new UUID('buyer-1'), type: 'user' } },
    provider: { data: { id: new UUID('seller-1'), type: 'user' } },
    ...overrides.relationships,
  },
});

const included = [
  {
    id: new UUID('listing-1'),
    type: 'listing',
    attributes: {
      title: 'Desk lamp',
      publicData: { kind: 'product', accent: 'butter', emoji: '💡' },
    },
  },
  {
    id: new UUID('buyer-1'),
    type: 'user',
    attributes: { profile: { displayName: 'Sam Aztec', firstName: 'Sam', lastName: 'Aztec' } },
  },
  {
    id: new UUID('seller-1'),
    type: 'user',
    attributes: { profile: { displayName: 'Maya Chen', firstName: 'Maya', lastName: 'Chen' } },
  },
];

describe('statusFromTransaction', () => {
  it('maps purchase confirm-payment to confirmed', () => {
    expect(
      statusFromTransaction({
        attributes: {
          processName: 'default-purchase',
          lastTransition: 'transition/confirm-payment',
        },
      })
    ).toBe('confirmed');
  });

  it('maps ready-for-pickup flag and mark-delivered to ready', () => {
    expect(
      statusFromTransaction(
        {
          attributes: {
            processName: 'default-purchase',
            lastTransition: 'transition/mark-delivered',
          },
        },
        { readyForPickup: true }
      )
    ).toBe('ready');
  });

  it('maps booking confirm-payment to requested', () => {
    expect(
      statusFromTransaction({
        attributes: {
          processName: 'default-booking',
          lastTransition: 'transition/confirm-payment',
        },
      })
    ).toBe('requested');
  });
});

describe('toCampusOrder', () => {
  it('maps a paid product order', () => {
    expect(toCampusOrder(tx(), included)).toMatchObject({
      id: 'tx-1',
      listingId: 'listing-1',
      kind: 'product',
      status: 'confirmed',
      quantity: 2,
      total: 20,
      platformFee: 0.72,
      buyer: 'Sam Aztec',
      seller: 'Maya Chen',
      title: 'Desk lamp',
      note: 'Meet at the library',
      can: expect.objectContaining({ markDelivered: true, markReceived: true, cancel: true }),
    });
  });
});
