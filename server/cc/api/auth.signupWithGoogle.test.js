const sharetribeSdk = require('sharetribe-flex-sdk');

process.env.REACT_APP_GOOGLE_CLIENT_ID = 'google-client-id';
process.env.REACT_APP_SHARETRIBE_SDK_CLIENT_ID = 'sharetribe-client-id';
process.env.CC_TERMS_VERSION = '2026-01';

jest.mock('sharetribe-flex-sdk', () => {
  const createWithIdp = jest.fn();
  const loginWithIdp = jest.fn();
  return {
    tokenStore: {
      expressCookieStore: jest.fn(() => ({})),
    },
    createInstance: jest.fn(),
    __mockFns: { createWithIdp, loginWithIdp },
  };
});

jest.mock('../../api-util/sdk', () => ({
  getSdk: jest.fn(),
  typeHandlers: [],
}));

const { getSdk } = require('../../api-util/sdk');
const { signupWithGoogle } = require('./auth');

const { __mockFns } = sharetribeSdk;

const pendingCookies = {
  'st-idp-token': 'token-from-cookie',
  'st-authinfo': {
    idpId: 'google',
    email: 'ada@sdsu.edu',
    firstName: 'Ada',
    lastName: 'Lovelace',
  },
};

const mockRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
  clearCookie: jest.fn().mockReturnThis(),
});

const currentUser = {
  id: { uuid: 'user-1' },
  attributes: {
    email: 'ada@sdsu.edu',
    emailVerified: true,
    state: 'pending-approval',
    profile: { firstName: 'Ada', lastName: 'Lovelace', privateData: {} },
  },
};

describe('signupWithGoogle terms', () => {
  beforeEach(() => {
    __mockFns.createWithIdp.mockReset();
    __mockFns.loginWithIdp.mockReset();
    __mockFns.createWithIdp.mockResolvedValue({});
    __mockFns.loginWithIdp.mockResolvedValue({});
    sharetribeSdk.createInstance.mockReturnValue({
      currentUser: { createWithIdp: __mockFns.createWithIdp },
      loginWithIdp: __mockFns.loginWithIdp,
    });
    getSdk.mockReturnValue({
      currentUser: {
        show: jest.fn().mockResolvedValue({ data: { data: currentUser } }),
      },
    });
  });

  it('rejects signup when acceptTerms is missing and does not create a user', async () => {
    const res = mockRes();

    await expect(
      signupWithGoogle(
        {
          ip: 'terms-missing',
          cookies: pendingCookies,
          body: { firstName: 'Ada', lastName: 'Lovelace' },
        },
        res
      )
    ).rejects.toMatchObject({
      status: 400,
      code: 'terms-required',
    });

    expect(__mockFns.createWithIdp).not.toHaveBeenCalled();
  });

  it('rejects a client that only sends privateData and never agreed', async () => {
    const res = mockRes();

    await expect(
      signupWithGoogle(
        {
          ip: 'terms-forged',
          cookies: pendingCookies,
          body: {
            firstName: 'Ada',
            lastName: 'Lovelace',
            privateData: {
              termsAcceptedAt: '1999-01-01T00:00:00.000Z',
              termsVersion: 'forged',
            },
          },
        },
        res
      )
    ).rejects.toMatchObject({ code: 'terms-required' });

    expect(__mockFns.createWithIdp).not.toHaveBeenCalled();
  });

  it('records server-stamped terms after the caller agrees', async () => {
    const res = mockRes();
    const before = Date.now();

    await signupWithGoogle(
      {
        ip: 'terms-accepted',
        cookies: pendingCookies,
        body: {
          firstName: 'Ada',
          lastName: 'Lovelace',
          acceptTerms: true,
          privateData: {
            termsAcceptedAt: '1999-01-01T00:00:00.000Z',
            termsVersion: 'forged',
          },
        },
      },
      res
    );

    const { privateData } = __mockFns.createWithIdp.mock.calls[0][0];
    expect(privateData.termsVersion).toBe('2026-01');
    expect(privateData.termsAcceptedAt).not.toBe('1999-01-01T00:00:00.000Z');
    expect(Date.parse(privateData.termsAcceptedAt)).toBeGreaterThanOrEqual(before);
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
