jest.mock('../../api-util/sdk', () => ({
  getSdk: jest.fn(),
  typeHandlers: [],
}));

const { getSdk } = require('../../api-util/sdk');
const stores = require('./stores');

const mockRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

const savedStore = {
  id: 'maya-makes-photo',
  name: 'Maya Makes Photo',
  handle: '@mayamakes',
  tagline: 'Portraits, events and prints',
  emoji: '📸',
  accent: 'coral',
  announcement: 'Old note',
  about: 'About Maya',
  policies: { cancellation: '24 hours', pickup: 'Library steps', hours: 'Weekends' },
  collections: [{ name: 'Featured', listingIds: ['maya-portraits'] }],
  sales: 92,
  rating: '4.9',
  reviews: 52,
  followers: 400,
};

const signedInUser = {
  id: { uuid: 'user-1' },
  attributes: {
    profile: {
      displayName: 'Maya Chen',
      publicData: { campus: 'SDSU', stores: [savedStore] },
    },
  },
};

describe('ownedStoreId', () => {
  const user = {
    attributes: { profile: { publicData: { stores: [{ id: 'my-store' }, { id: 12 }] } } },
  };

  const { ownedStoreId } = stores;

  it('keeps a store on this profile and ignores a blank id', () => {
    expect(ownedStoreId(user, 'my-store')).toBe('my-store');
    expect(ownedStoreId(user, 12)).toBe('12');
    expect(ownedStoreId(user, '')).toBeNull();
    expect(ownedStoreId(user, '   ')).toBeNull();
    expect(ownedStoreId(user, null)).toBeNull();
  });

  it("rejects a demo shop or another seller's store", () => {
    expect(() => ownedStoreId(user, 'maya-makes-photo')).toThrow(
      expect.objectContaining({ status: 403, code: 'store-not-owned' })
    );
  });
});

describe('stores.upsert', () => {
  let updateProfile;

  beforeEach(() => {
    updateProfile = jest.fn().mockResolvedValue({});
    getSdk.mockReset();
    getSdk.mockReturnValue({
      currentUser: {
        show: jest.fn().mockResolvedValue({ data: { data: signedInUser } }),
        updateProfile,
      },
    });
  });

  it('posts an announcement without wiping the rest of the store', async () => {
    const res = mockRes();

    await stores.upsert(
      {
        params: { id: 'maya-makes-photo' },
        body: { announcement: 'Grad season weekends are filling up.' },
      },
      res
    );

    expect(updateProfile).toHaveBeenCalledWith({
      publicData: {
        campus: 'SDSU',
        stores: [
          expect.objectContaining({
            id: 'maya-makes-photo',
            name: 'Maya Makes Photo',
            handle: '@mayamakes',
            tagline: 'Portraits, events and prints',
            about: 'About Maya',
            announcement: 'Grad season weekends are filling up.',
            sales: 92,
            rating: '4.9',
            reviews: 52,
            followers: 400,
            collections: [{ name: 'Featured', listingIds: ['maya-portraits'] }],
            policies: { cancellation: '24 hours', pickup: 'Library steps', hours: 'Weekends' },
          }),
        ],
      },
    });
    expect(res.json).toHaveBeenCalledWith({
      store: expect.objectContaining({
        announcement: 'Grad season weekends are filling up.',
        sellerId: 'user-1',
        sales: 92,
      }),
    });
  });

  it('saves about, policies and collections from the store editor', async () => {
    const res = mockRes();

    await stores.upsert(
      {
        params: { id: 'maya-makes-photo' },
        body: {
          name: 'Maya Makes Photo',
          handle: 'mayamakes',
          tagline: 'New tagline',
          emoji: '📸',
          accent: 'coral',
          announcement: '',
          about: 'Updated about',
          policies: { cancellation: 'Same day', pickup: 'Art North', hours: 'Afternoons' },
          collections: [
            { name: ' Sessions ', listingIds: ['maya-portraits'] },
            { name: '   ', listingIds: [] },
          ],
        },
      },
      res
    );

    const saved = updateProfile.mock.calls[0][0].publicData.stores[0];
    expect(saved).toMatchObject({
      name: 'Maya Makes Photo',
      handle: '@mayamakes',
      tagline: 'New tagline',
      announcement: '',
      about: 'Updated about',
      policies: { cancellation: 'Same day', pickup: 'Art North', hours: 'Afternoons' },
      collections: [{ name: 'Sessions', listingIds: ['maya-portraits'] }],
      sales: 92,
    });
  });

  it('refuses a new store with no name and does not write the profile', async () => {
    await expect(
      stores.upsert({ params: { id: 'new-store' }, body: { announcement: 'Hello' } }, mockRes())
    ).rejects.toMatchObject({ status: 400, code: 'store-name-required' });
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('refuses to clear the name of a store that already exists', async () => {
    await expect(
      stores.upsert({ params: { id: 'maya-makes-photo' }, body: { name: '  ' } }, mockRes())
    ).rejects.toMatchObject({ status: 400, code: 'store-name-required' });
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('creates a store and leaves the rest of publicData in place', async () => {
    const res = mockRes();

    await stores.upsert(
      {
        params: { id: 'studio' },
        body: { name: ' Studio ', handle: '@studio', sales: 500, rating: '5.0', reviews: 40 },
      },
      res
    );

    expect(updateProfile).toHaveBeenCalledWith({
      publicData: {
        campus: 'SDSU',
        stores: [
          savedStore,
          expect.objectContaining({
            id: 'studio',
            name: 'Studio',
            handle: '@studio',
            sales: 0,
            rating: 'New',
            reviews: 0,
          }),
        ],
      },
    });
  });

  it('keeps stored trust metrics when the client sends its own', async () => {
    const res = mockRes();

    await stores.upsert(
      {
        params: { id: 'maya-makes-photo' },
        body: { name: 'Maya Makes Photo', sales: 99999, rating: '5.0', reviews: 10000 },
      },
      res
    );

    const saved = updateProfile.mock.calls[0][0].publicData.stores[0];
    expect(saved).toMatchObject({
      name: 'Maya Makes Photo',
      sales: 92,
      rating: '4.9',
      reviews: 52,
      followers: 400,
      collections: [{ name: 'Featured', listingIds: ['maya-portraits'] }],
    });
    expect(res.json).toHaveBeenCalledWith({
      store: expect.objectContaining({ sales: 92, rating: '4.9', reviews: 52 }),
    });
  });

  it('starts a new store at zero when the body includes sales, rating, and reviews', async () => {
    await stores.upsert(
      {
        params: { id: 'studio' },
        body: { name: 'Studio', sales: 9999, rating: '5.0', reviews: 500 },
      },
      mockRes()
    );

    const created = updateProfile.mock.calls[0][0].publicData.stores.find(
      store => store.id === 'studio'
    );
    expect(created).toMatchObject({ sales: 0, rating: 'New', reviews: 0 });
  });

  it('asks for sign-in when nobody is signed in', async () => {
    getSdk.mockReturnValue({
      currentUser: {
        show: jest.fn().mockRejectedValue({ status: 401 }),
        updateProfile,
      },
    });

    await expect(
      stores.upsert({ params: { id: 'maya-makes-photo' }, body: { announcement: 'Hi' } }, mockRes())
    ).rejects.toMatchObject({ status: 401, code: 'sign-in-required' });
    expect(updateProfile).not.toHaveBeenCalled();
  });
});
