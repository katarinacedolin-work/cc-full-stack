const { types } = require('sharetribe-flex-sdk');
const {
  toCampusListing,
  toSharetribeAttrs,
  openAvailabilityPlan,
  isRemovedListing,
  listingImageSourceUrls,
} = require('./mapListing');

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

  it('maps a draft to draft and a closed listing to paused', () => {
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
    ).toBe('paused');
    const awayPaused = toCampusListing(
      {
        ...listing,
        attributes: {
          ...listing.attributes,
          state: 'closed',
          publicData: { ...listing.attributes.publicData, awayPaused: true },
        },
      },
      included
    );
    expect(awayPaused.status).toBe('paused');
    expect(awayPaused.awayPaused).toBe(true);
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

  it('keeps a sold-out quantity of zero', () => {
    const soldOut = toSharetribeAttrs({
      kind: 'product',
      title: 'Linen sundress',
      description: 'Like new',
      price: 22,
      quantityAvailable: 0,
    });
    expect(soldOut.publicData.quantityAvailable).toBe(0);

    const fromQuantity = toSharetribeAttrs({
      kind: 'product',
      title: 'Linen sundress',
      description: 'Like new',
      price: 22,
      quantity: 0,
    });
    expect(fromQuantity.publicData.quantityAvailable).toBe(0);

    // The seller form sends the stock field as a string.
    const fromString = toSharetribeAttrs({
      kind: 'product',
      title: 'Linen sundress',
      description: 'Like new',
      price: 22,
      quantityAvailable: '0',
    });
    expect(fromString.publicData.quantityAvailable).toBe(0);
  });

  it('defaults a missing product quantity to one', () => {
    const attrs = toSharetribeAttrs({
      kind: 'product',
      title: 'Desk lamp',
      description: 'Works well',
      price: 12,
    });
    expect(attrs.publicData.quantityAvailable).toBe(1);
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

  it('keeps an allowlisted accent and a plain emoji', () => {
    const attrs = toSharetribeAttrs({
      kind: 'service',
      title: 'Tutoring',
      description: 'Calc II',
      price: 30,
      accent: 'sky',
      emoji: '∫',
    });
    expect(attrs.publicData.accent).toBe('sky');
    expect(attrs.publicData.emoji).toBe('∫');
  });

  it('drops accent and emoji values that are not on the allowlist', () => {
    const attrs = toSharetribeAttrs({
      kind: 'product',
      title: 'Lamp',
      description: 'Works',
      price: 12,
      accent: 'butter" onmouseover="alert(1)',
      emoji: '<img src=x onerror=alert(1)>',
    });
    expect(attrs.publicData.accent).toBe('butter');
    expect(attrs.publicData.emoji).toBe('📦');
  });

  it('drops emoji that is text rather than a symbol', () => {
    const attrs = toSharetribeAttrs({
      kind: 'service',
      title: 'Tutoring',
      description: 'Calc II',
      price: 30,
      emoji: 'alert(1)',
    });
    expect(attrs.publicData.emoji).toBe('✨');
  });

  it('does not return stored markup from a public listing', () => {
    const poisoned = {
      ...listing,
      attributes: {
        ...listing.attributes,
        publicData: {
          ...listing.attributes.publicData,
          accent: 'sky"><img src=x onerror=alert(1)>',
          emoji: '<svg onload=alert(1)>',
        },
      },
    };
    const mapped = toCampusListing(poisoned, included);
    expect(mapped.accent).toBe('cobalt');
    expect(mapped.emoji).toBe('✨');
  });

  it('keeps a listing the same when its mapped form is saved again', () => {
    const before = toCampusListing(listing, included);
    const attrs = toSharetribeAttrs(
      { ...before, title: 'Calc II tutoring' },
      { ownedStoreIds: ['store-1'] }
    );
    expect(attrs.publicData).toMatchObject({
      kind: 'service',
      category: 'Learn',
      unit: 'hour',
      accent: 'sky',
      storeId: 'store-1',
    });
  });

  it('drops a store id the caller does not own', () => {
    const fields = {
      kind: 'product',
      title: 'Desk lamp',
      description: 'Works well',
      price: 12,
      storeId: 'maya-makes-photo',
    };
    expect(toSharetribeAttrs(fields).publicData.storeId).toBeNull();
    expect(
      toSharetribeAttrs(fields, { ownedStoreIds: ['my-store'] }).publicData.storeId
    ).toBeNull();
    expect(
      toSharetribeAttrs(fields, { ownedStoreIds: ['maya-makes-photo'] }).publicData.storeId
    ).toBe('maya-makes-photo');
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

describe('isRemovedListing', () => {
  it('is true only after the seller deletes a listing', () => {
    expect(isRemovedListing(listing)).toBe(false);
    expect(
      isRemovedListing({
        attributes: { publicData: { ...listing.attributes.publicData, removed: true } },
      })
    ).toBe(true);
  });
});

describe('listingImageSourceUrls', () => {
  const image = (id, variants) => ({
    id: new UUID(id),
    type: 'image',
    attributes: { variants },
  });

  it('keeps listing order and prefers the largest named variant', () => {
    const source = {
      ...listing,
      relationships: {
        images: {
          data: [
            { id: new UUID('img-1'), type: 'image' },
            { id: new UUID('img-2'), type: 'image' },
          ],
        },
      },
    };
    const urls = listingImageSourceUrls(source, [
      image('img-1', {
        'listing-card': { url: 'https://cdn.example/card.jpg', width: 400, height: 400 },
        'scaled-xlarge': { url: 'https://cdn.example/large.jpg', width: 2400, height: 2400 },
      }),
      image('img-2', {
        'listing-card': { url: 'https://cdn.example/second.jpg', width: 400, height: 400 },
      }),
    ]);
    expect(urls).toEqual(['https://cdn.example/large.jpg', 'https://cdn.example/second.jpg']);
  });

  it('uses the biggest https variant when none of the named ones are present', () => {
    const urls = listingImageSourceUrls(listing, [
      image('img-1', {
        thumb: { url: 'https://cdn.example/thumb.jpg', width: 80, height: 80 },
        original: { url: 'https://cdn.example/original.jpg', width: 1600, height: 1200 },
        insecure: { url: 'http://cdn.example/secret.jpg', width: 4000, height: 4000 },
      }),
    ]);
    expect(urls).toEqual(['https://cdn.example/original.jpg']);
  });

  it('returns null when a photo cannot be copied', () => {
    expect(listingImageSourceUrls(listing, included)).toEqual(['https://example.com/card.jpg']);
    expect(listingImageSourceUrls(listing, [])).toEqual([null]);
  });
});

describe('openAvailabilityPlan', () => {
  it('covers every day of the week', () => {
    const plan = openAvailabilityPlan();
    expect(plan.type).toBe('availability-plan/time');
    expect(plan.entries).toHaveLength(7);
  });
});
