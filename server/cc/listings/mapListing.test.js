const { types } = require('sharetribe-flex-sdk');
const { toCampusListing, toSharetribeAttrs, openAvailabilityPlan } = require('./mapListing');

const { UUID, Money } = types;

const listing = {
  id: new UUID('listing-1'),
  type: 'listing',
  attributes: {
    title: 'Calc tutoring',
    description: 'Help with midterms',
    state: 'published',
    price: new Money(3000, 'USD'),
    publicData: {
      kind: 'service',
      category: 'Learn',
      unit: 'hour',
      accent: 'sky',
      emoji: '∫',
      rating: 4.9,
      reviews: 11,
      storeId: 'store-1',
    },
  },
  relationships: {
    author: { data: { id: new UUID('user-1'), type: 'user' } },
    images: { data: [{ id: new UUID('img-1'), type: 'image' }] },
  },
};

const included = [
  {
    id: new UUID('user-1'),
    type: 'user',
    attributes: {
      profile: { displayName: 'Noah Williams', firstName: 'Noah', lastName: 'Williams' },
    },
  },
  {
    id: new UUID('img-1'),
    type: 'image',
    attributes: {
      variants: {
        'listing-card': { url: 'https://example.com/card.jpg' },
      },
    },
  },
];

describe('toCampusListing', () => {
  it('maps a published service listing', () => {
    expect(toCampusListing(listing, included)).toMatchObject({
      id: 'listing-1',
      kind: 'service',
      category: 'Learn',
      title: 'Calc tutoring',
      description: 'Help with midterms',
      price: 30,
      unit: 'hour',
      seller: 'Noah Williams',
      initials: 'NW',
      sellerId: 'user-1',
      storeId: 'store-1',
      rating: '4.9',
      reviews: 11,
      status: 'active',
      verified: true,
      campus: 'SDSU',
      photo: 'https://example.com/card.jpg',
      images: ['https://example.com/card.jpg'],
    });
  });

  it('maps draft and closed states', () => {
    expect(
      toCampusListing(
        { ...listing, attributes: { ...listing.attributes, state: 'draft' } },
        included
      ).status
    ).toBe('draft');
    expect(
      toCampusListing(
        { ...listing, attributes: { ...listing.attributes, state: 'closed' } },
        included
      ).status
    ).toBe('closed');
  });
});

describe('toSharetribeAttrs', () => {
  it('builds create attrs for a product', () => {
    const attrs = toSharetribeAttrs({
      kind: 'product',
      title: 'Desk lamp',
      description: 'Works well',
      price: 12.5,
      category: 'Dorm',
      merchandiseType: 'resale',
      condition: 'Good condition',
      quantity: 2,
    });
    expect(attrs.title).toBe('Desk lamp');
    expect(attrs.price).toEqual(new Money(1250, 'USD'));
    expect(attrs.publicData).toMatchObject({
      kind: 'product',
      category: 'Dorm',
      merchandiseType: 'resale',
      quantityAvailable: 2,
    });
  });

  it('builds create attrs for a service', () => {
    const attrs = toSharetribeAttrs({
      kind: 'service',
      title: 'Tutoring',
      description: 'Calc II',
      price: 30,
      category: 'Learn',
      duration: 'hour',
    });
    expect(attrs.publicData.kind).toBe('service');
    expect(attrs.publicData.unit).toBe('hour');
  });

  it('sets the process and unit type the checkout needs', () => {
    const base = { title: 'A', description: 'B', price: 5 };
    expect(toSharetribeAttrs({ ...base, kind: 'product' }).publicData).toMatchObject({
      transactionProcessAlias: 'default-purchase/release-1',
      unitType: 'item',
    });
    expect(toSharetribeAttrs({ ...base, kind: 'service' }).publicData).toMatchObject({
      transactionProcessAlias: 'default-booking/release-1',
      unitType: 'fixed',
    });
    expect(toSharetribeAttrs({ ...base, kind: 'ticket' }).publicData).toMatchObject({
      transactionProcessAlias: 'cc-ticket/release-1',
      unitType: 'item',
    });
  });

  it('keeps a listing the same when its mapped form is saved again', () => {
    const before = toCampusListing(listing, included);
    const attrs = toSharetribeAttrs({ ...before, title: 'Calc II tutoring' });
    expect(attrs.publicData).toMatchObject({
      kind: 'service',
      category: 'Learn',
      unit: 'hour',
      accent: 'sky',
      storeId: 'store-1',
    });
  });
});

describe('stock', () => {
  it('reads how many are left from Sharetribe stock when it is included', () => {
    const product = {
      ...listing,
      attributes: {
        ...listing.attributes,
        publicData: { kind: 'product', quantityAvailable: 5 },
      },
      relationships: {
        ...listing.relationships,
        currentStock: { data: { id: new UUID('stock-1'), type: 'stock' } },
      },
    };
    const stock = { id: new UUID('stock-1'), type: 'stock', attributes: { quantity: 2 } };
    expect(toCampusListing(product, [...included, stock]).quantityAvailable).toBe(2);
    expect(toCampusListing(product, included).quantityAvailable).toBe(5);
  });
});

describe('openAvailabilityPlan', () => {
  it('covers every day of the week', () => {
    const plan = openAvailabilityPlan();
    expect(plan.type).toBe('availability-plan/time');
    expect(plan.entries).toHaveLength(7);
  });
});
