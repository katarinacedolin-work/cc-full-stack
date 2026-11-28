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

jest.mock('../../api-util/googleIdToken', () => ({
  verifyGoogleIdToken: jest.fn(),
}));

const { verifyGoogleIdToken } = require('../../api-util/googleIdToken');
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

const verifiedSdsuAccount = {
  email: 'ada@sdsu.edu',
  emailVerified: true,
  givenName: 'Ada',
  familyName: 'Lovelace',
};

describe('signupWithGoogle terms', () => {
  beforeEach(() => {
    verifyGoogleIdToken.mockReset();
    verifyGoogleIdToken.mockResolvedValue(verifiedSdsuAccount);
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

    const params = __mockFns.createWithIdp.mock.calls[0][0];
    expect(params.email).toBe('ada@sdsu.edu');
    expect(params.idpToken).toBe('token-from-cookie');
    expect(params.privateData.termsVersion).toBe('2026-01');
    expect(params.privateData.termsAcceptedAt).not.toBe('1999-01-01T00:00:00.000Z');
    expect(Date.parse(params.privateData.termsAcceptedAt)).toBeGreaterThanOrEqual(before);
    expect(verifyGoogleIdToken).toHaveBeenCalledWith('token-from-cookie', 'google-client-id');
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('does not create a user when the cookie email differs from the token email', async () => {
    const res = mockRes();

    await expect(
      signupWithGoogle(
        {
          ip: 'email-swapped',
          cookies: {
            ...pendingCookies,
            'st-authinfo': {
              ...pendingCookies['st-authinfo'],
              email: 'victim@sdsu.edu',
            },
          },
          body: { firstName: 'Ada', lastName: 'Lovelace', acceptTerms: true },
        },
        res
      )
    ).rejects.toMatchObject({
      status: 400,
      code: 'google-session-expired',
    });

    expect(__mockFns.createWithIdp).not.toHaveBeenCalled();
  });

  it('rejects a token whose email is not a verified @sdsu.edu address', async () => {
    verifyGoogleIdToken.mockResolvedValue({
      email: 'ada@gmail.com',
      emailVerified: true,
    });
    const res = mockRes();

    await expect(
      signupWithGoogle(
        {
          ip: 'token-not-sdsu',
          cookies: pendingCookies,
          body: { firstName: 'Ada', lastName: 'Lovelace', acceptTerms: true },
        },
        res
      )
    ).rejects.toMatchObject({ code: 'sdsu-email-required' });

    expect(__mockFns.createWithIdp).not.toHaveBeenCalled();
  });

  it('rejects an unverified token email even when the cookie says @sdsu.edu', async () => {
    verifyGoogleIdToken.mockResolvedValue({
      email: 'ada@sdsu.edu',
      emailVerified: false,
    });
    const res = mockRes();

    await expect(
      signupWithGoogle(
        {
          ip: 'token-unverified',
          cookies: pendingCookies,
          body: { firstName: 'Ada', lastName: 'Lovelace', acceptTerms: true },
        },
        res
      )
    ).rejects.toMatchObject({ code: 'sdsu-email-required' });

    expect(__mockFns.createWithIdp).not.toHaveBeenCalled();
  });
});
