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

const listing = (uuid, publicData = { kind: 'service' }) => ({
  id: { uuid },
  attributes: { state: 'published', publicData },
});

const page = (items, totalPages = 1) => ({
  data: { data: items, meta: { totalPages, perPage: 100 } },
});

describe('listings.setAwayMode', () => {
  let sdk;
  const previousClient = process.env.REACT_APP_SHARETRIBE_SDK_CLIENT_ID;
  const previousSecret = process.env.SHARETRIBE_SDK_CLIENT_SECRET;

  const signedIn = () => ({
    data: {
      data: {
        id: { uuid: 'user-1' },
        attributes: { profile: { privateData: { campus: 'SDSU', awayMode: false } } },
      },
    },
  });

  beforeEach(() => {
    process.env.REACT_APP_SHARETRIBE_SDK_CLIENT_ID = 'test-client';
    process.env.SHARETRIBE_SDK_CLIENT_SECRET = 'test-secret';
    sdk = {
      currentUser: {
        show: jest.fn().mockResolvedValue(signedIn()),
        updateProfile: jest.fn().mockResolvedValue({}),
      },
      ownListings: {
        query: jest.fn().mockResolvedValue(page([])),
        close: jest.fn().mockResolvedValue({}),
        open: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    getSdk.mockReset();
    getSdk.mockReturnValue(sdk);
  });

  afterEach(() => {
    if (previousClient === undefined) delete process.env.REACT_APP_SHARETRIBE_SDK_CLIENT_ID;
    else process.env.REACT_APP_SHARETRIBE_SDK_CLIENT_ID = previousClient;
    if (previousSecret === undefined) delete process.env.SHARETRIBE_SDK_CLIENT_SECRET;
    else process.env.SHARETRIBE_SDK_CLIENT_SECRET = previousSecret;
  });

  it('closes every published page before it writes the profile flag', async () => {
    const res = mockRes();
    const steps = [];
    sdk.ownListings.query.mockImplementation(async ({ page: pageNumber }) => {
      steps.push(`query-${pageNumber}`);
      if (pageNumber === 1) return page([listing('a', { kind: 'service' })], 2);
      return page([listing('b', { kind: 'product' })], 2);
    });
    sdk.ownListings.close.mockImplementation(async ({ id }) => {
      steps.push(`close-${id.uuid}`);
    });
    sdk.ownListings.update.mockImplementation(async ({ id, publicData }) => {
      steps.push(`flag-${id.uuid}-${publicData.awayPaused}`);
    });
    sdk.currentUser.updateProfile.mockImplementation(async body => {
      steps.push('profile');
      return body;
    });

    await listings.setAwayMode({ body: { away: true } }, res);

    expect(steps).toEqual([
      'query-1',
      'query-2',
      'close-a',
      'flag-a-true',
      'close-b',
      'flag-b-true',
      'profile',
    ]);
    expect(sdk.currentUser.updateProfile).toHaveBeenCalledWith({
      privateData: { campus: 'SDSU', awayMode: true },
    });
    expect(res.json).toHaveBeenCalledWith({ awayMode: true });
  });

  it('reopens listings paused by away mode and leaves manual pauses and deletes alone', async () => {
    const res = mockRes();
    sdk.ownListings.query.mockResolvedValue(
      page([
        listing('paused', { kind: 'service', awayPaused: true }),
        listing('manual', { kind: 'service' }),
        listing('deleted', { kind: 'service', awayPaused: true, removed: true }),
      ])
    );

    await listings.setAwayMode({ body: { away: false } }, res);

    expect(sdk.ownListings.query).toHaveBeenCalledWith({
      states: ['closed'],
      page: 1,
      perPage: 100,
    });
    expect(sdk.ownListings.open).toHaveBeenCalledTimes(1);
    expect(sdk.ownListings.open).toHaveBeenCalledWith({ id: { uuid: 'paused' } });
    expect(sdk.ownListings.update).toHaveBeenCalledWith({
      id: { uuid: 'paused' },
      publicData: { kind: 'service', awayPaused: false },
    });
    expect(sdk.currentUser.updateProfile).toHaveBeenCalledWith({
      privateData: { campus: 'SDSU', awayMode: false },
    });
    expect(res.json).toHaveBeenCalledWith({ awayMode: false });
  });

  it('does not write the profile when a later close fails, and reopens what it already closed', async () => {
    const res = mockRes();
    sdk.ownListings.query.mockResolvedValue(
      page([listing('a', { kind: 'service' }), listing('b', { kind: 'service' })])
    );
    sdk.ownListings.close.mockImplementation(async ({ id }) => {
      if (id.uuid === 'b') {
        const error = new Error('nope');
        error.status = 409;
        throw error;
      }
    });

    await expect(listings.setAwayMode({ body: { away: true } }, res)).rejects.toMatchObject({
      status: 502,
      code: 'away-mode-failed',
      message: 'Could not update away mode. Your listings were left as they were.',
    });

    expect(sdk.currentUser.updateProfile).not.toHaveBeenCalled();
    expect(sdk.ownListings.open).toHaveBeenCalledWith({ id: { uuid: 'a' } });
    expect(sdk.ownListings.update).toHaveBeenLastCalledWith({
      id: { uuid: 'a' },
      publicData: { kind: 'service', awayPaused: false },
    });
    expect(res.json).not.toHaveBeenCalled();
  });

  it('reopens a listing when its away flag cannot be saved', async () => {
    const res = mockRes();
    sdk.ownListings.query.mockResolvedValue(page([listing('a', { kind: 'service', spot: 'library' })]));
    sdk.ownListings.update.mockRejectedValueOnce(new Error('flag failed'));

    await expect(listings.setAwayMode({ body: { away: true } }, res)).rejects.toMatchObject({
      status: 502,
      code: 'away-mode-failed',
      message: 'Could not update away mode. Your listings were left as they were.',
    });

    expect(sdk.currentUser.updateProfile).not.toHaveBeenCalled();
    expect(sdk.ownListings.open).toHaveBeenCalledWith({ id: { uuid: 'a' } });
    expect(sdk.ownListings.update).toHaveBeenLastCalledWith({
      id: { uuid: 'a' },
      publicData: { kind: 'service', spot: 'library', awayPaused: false },
    });
  });

  it('rolls listings back when the profile write fails', async () => {
    const res = mockRes();
    sdk.ownListings.query.mockResolvedValue(page([listing('a', { kind: 'service' })]));
    sdk.currentUser.updateProfile.mockRejectedValue(new Error('profile down'));

    await expect(listings.setAwayMode({ body: { away: true } }, res)).rejects.toMatchObject({
      status: 502,
      code: 'away-mode-failed',
      message: 'Could not update away mode. Your listings were left as they were.',
    });

    expect(sdk.ownListings.open).toHaveBeenCalledWith({ id: { uuid: 'a' } });
    expect(res.json).not.toHaveBeenCalled();
  });

  it('says away mode did not finish when a closed listing cannot be reopened', async () => {
    const res = mockRes();
    sdk.ownListings.query.mockResolvedValue(page([listing('a')]));
    sdk.currentUser.updateProfile.mockRejectedValue(new Error('profile down'));
    sdk.ownListings.open.mockRejectedValue(new Error('cannot reopen'));

    await expect(listings.setAwayMode({ body: { away: true } }, res)).rejects.toMatchObject({
      status: 502,
      code: 'away-mode-failed',
      message: 'Away mode did not finish. Check your listings and try again.',
    });
    expect(res.json).not.toHaveBeenCalled();
  });

  it('does not call Sharetribe when keys are not configured', async () => {
    process.env.REACT_APP_SHARETRIBE_SDK_CLIENT_ID = 'change-me';

    await expect(listings.setAwayMode({ body: { away: true } }, mockRes())).rejects.toMatchObject({
      status: 503,
      code: 'sharetribe-not-configured',
    });
    expect(getSdk).not.toHaveBeenCalled();
  });

  it('does not call Sharetribe when the client secret is missing', async () => {
    delete process.env.SHARETRIBE_SDK_CLIENT_SECRET;

    await expect(listings.setAwayMode({ body: { away: true } }, mockRes())).rejects.toMatchObject({
      status: 503,
      code: 'sharetribe-not-configured',
    });
    expect(getSdk).not.toHaveBeenCalled();
  });

  it('does not write the profile when the listing query fails', async () => {
    const res = mockRes();
    sdk.ownListings.query.mockRejectedValue(Object.assign(new Error('timeout'), { status: 500 }));

    await expect(listings.setAwayMode({ body: { away: true } }, res)).rejects.toMatchObject({
      status: 502,
      code: 'away-mode-failed',
      message: 'Could not update away mode. Your listings were left as they were.',
    });
    expect(sdk.ownListings.close).not.toHaveBeenCalled();
    expect(sdk.currentUser.updateProfile).not.toHaveBeenCalled();
  });
});
