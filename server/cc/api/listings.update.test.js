jest.mock('../../api-util/sdk', () => ({
  getSdk: jest.fn(),
  typeHandlers: [],
}));

const { types } = require('sharetribe-flex-sdk');
const { getSdk } = require('../../api-util/sdk');
const { update } = require('./listings');

const { UUID, Money } = types;
const LISTING_ID = '00000000-0000-4000-8000-000000000001';

const mockRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

const ownListing = state => ({
  id: new UUID(LISTING_ID),
  type: 'ownListing',
  attributes: {
    title: 'Calc tutoring',
    description: 'Help with midterms',
    state,
    price: new Money(3000, 'USD'),
    publicData: { kind: 'service', category: 'Learn', unit: 'hour' },
  },
  relationships: {},
});

const sdkFor = state => {
  const listing = ownListing(state);
  const show = jest.fn().mockResolvedValue({ data: { data: listing, included: [] } });
  const sdk = {
    currentUser: {
      show: jest.fn().mockResolvedValue({ data: { data: { id: new UUID('user-1') } } }),
    },
    ownListings: {
      show,
      publishDraft: jest.fn().mockResolvedValue({}),
      open: jest.fn().mockResolvedValue({}),
      close: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  getSdk.mockReturnValue(sdk);
  return sdk;
};

const patch = (body, sdkState) => {
  const sdk = sdkFor(sdkState);
  const res = mockRes();
  return update({ params: { id: LISTING_ID }, body }, res).then(() => ({ sdk, res }));
};

describe('listings.update status transitions', () => {
  beforeEach(() => {
    getSdk.mockReset();
  });

  it('publishes a draft instead of reopening it', async () => {
    const { sdk } = await patch({ status: 'active' }, 'draft');

    expect(sdk.ownListings.publishDraft).toHaveBeenCalledTimes(1);
    expect(sdk.ownListings.open).not.toHaveBeenCalled();
    expect(sdk.ownListings.update).toHaveBeenCalled();
  });

  it('reopens a closed listing', async () => {
    const { sdk } = await patch({ status: 'active' }, 'closed');

    expect(sdk.ownListings.open).toHaveBeenCalledTimes(1);
    expect(sdk.ownListings.publishDraft).not.toHaveBeenCalled();
  });

  it('leaves an already published listing published when saving it as active', async () => {
    const { sdk } = await patch({ status: 'active', title: 'Calc tutoring' }, 'published');

    expect(sdk.ownListings.publishDraft).not.toHaveBeenCalled();
    expect(sdk.ownListings.open).not.toHaveBeenCalled();
    expect(sdk.ownListings.update).toHaveBeenCalled();
  });

  it('closes a published listing when Seller Hub pauses it', async () => {
    const { sdk } = await patch({ status: 'paused' }, 'published');

    expect(sdk.ownListings.close).toHaveBeenCalledTimes(1);
    expect(sdk.ownListings.open).not.toHaveBeenCalled();
  });

  it('does not publish a draft when pausing it', async () => {
    const { sdk } = await patch({ status: 'paused' }, 'draft');

    expect(sdk.ownListings.publishDraft).not.toHaveBeenCalled();
    expect(sdk.ownListings.close).not.toHaveBeenCalled();
    expect(sdk.ownListings.update).toHaveBeenCalled();
  });

  it('keeps an already paused listing closed and reports it as paused', async () => {
    const { sdk, res } = await patch({ status: 'paused', title: 'Calc tutoring' }, 'closed');

    expect(sdk.ownListings.close).not.toHaveBeenCalled();
    expect(sdk.ownListings.open).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        listing: expect.objectContaining({ status: 'paused' }),
      })
    );
  });
});
