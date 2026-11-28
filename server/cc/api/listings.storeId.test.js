jest.mock('../../api-util/sdk', () => ({
  getSdk: jest.fn(),
  typeHandlers: [],
}));

const { getSdk } = require('../../api-util/sdk');
const listings = require('./listings');

const mockRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

const user = {
  id: { uuid: 'user-1' },
  attributes: {
    profile: {
      displayName: 'Maya Chen',
      publicData: { stores: [{ id: 'my-store', name: 'Mine' }] },
    },
  },
};

const ownListing = storeId => ({
  id: { uuid: 'listing-1' },
  type: 'listing',
  attributes: {
    title: 'Tutoring',
    description: 'Calc',
    state: 'published',
    price: { amount: 3000, currency: 'USD' },
    publicData: { kind: 'service', category: 'Learn', unit: 'hour', storeId },
  },
  relationships: {
    author: { data: { id: { uuid: 'user-1' }, type: 'user' } },
    images: { data: [] },
  },
});

const sdkFor = listing => {
  const createDraft = jest
    .fn()
    .mockResolvedValue({ data: { data: { id: { uuid: 'listing-1' } } } });
  const update = jest.fn().mockResolvedValue({});
  const show = jest.fn().mockResolvedValue({ data: { data: listing, included: [] } });
  getSdk.mockReturnValue({
    currentUser: {
      show: jest.fn().mockResolvedValue({ data: { data: user } }),
    },
    ownListings: {
      createDraft,
      publishDraft: jest.fn().mockResolvedValue({}),
      update,
      show,
      open: jest.fn().mockResolvedValue({}),
      close: jest.fn().mockResolvedValue({}),
    },
  });
  return { createDraft, update };
};

const serviceFields = storeId => ({
  title: 'Tutoring',
  description: 'Calc II',
  price: 30,
  kind: 'service',
  ...(storeId === undefined ? {} : { storeId }),
});

describe('listing store ownership', () => {
  beforeEach(() => {
    getSdk.mockReset();
  });

  it('rejects a create that names a store the seller does not own', async () => {
    const { createDraft } = sdkFor(ownListing(null));
    await expect(
      listings.create({ body: serviceFields('maya-makes-photo') }, mockRes())
    ).rejects.toMatchObject({ status: 403, code: 'store-not-owned' });
    expect(createDraft).not.toHaveBeenCalled();
  });

  it('saves a store on the seller profile and leaves a listing with no store unattached', async () => {
    const owned = sdkFor(ownListing('my-store'));
    await listings.create({ body: serviceFields('my-store') }, mockRes());
    expect(owned.createDraft.mock.calls[0][0].publicData.storeId).toBe('my-store');

    const plain = sdkFor(ownListing(null));
    await listings.create({ body: serviceFields() }, mockRes());
    expect(plain.createDraft.mock.calls[0][0].publicData.storeId).toBeNull();
  });

  it("rejects an update onto someone else's store and drops a store the seller no longer owns", async () => {
    const foreign = sdkFor(ownListing('my-store'));
    await expect(
      listings.update(
        { params: { id: 'listing-1' }, body: { storeId: 'maya-makes-photo' } },
        mockRes()
      )
    ).rejects.toMatchObject({ status: 403, code: 'store-not-owned' });
    expect(foreign.update).not.toHaveBeenCalled();

    const { update } = sdkFor(ownListing('maya-makes-photo'));
    await listings.update({ params: { id: 'listing-1' }, body: { title: 'Calc II' } }, mockRes());
    expect(update.mock.calls[0][0].publicData.storeId).toBeNull();
  });

  it("keeps the seller's own store on a partial edit and on a duplicate", async () => {
    const { update } = sdkFor(ownListing('my-store'));
    await listings.update({ params: { id: 'listing-1' }, body: { title: 'Calc II' } }, mockRes());
    expect(update.mock.calls[0][0].publicData.storeId).toBe('my-store');

    const { createDraft } = sdkFor(ownListing('my-store'));
    await listings.duplicate({ params: { id: 'listing-1' }, body: {} }, mockRes());
    expect(createDraft.mock.calls[0][0].publicData.storeId).toBe('my-store');

    const stolen = sdkFor(ownListing('maya-makes-photo'));
    await listings.duplicate({ params: { id: 'listing-1' }, body: {} }, mockRes());
    expect(stolen.createDraft.mock.calls[0][0].publicData.storeId).toBeNull();
  });
});
