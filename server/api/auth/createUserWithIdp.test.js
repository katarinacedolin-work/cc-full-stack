const sharetribeSdk = require('sharetribe-flex-sdk');

process.env.REACT_APP_GOOGLE_CLIENT_ID = 'google-client-id';

jest.mock('../../api-util/sdk', () => ({
  handleError: jest.fn(),
  serialize: jest.fn(data => JSON.stringify(data)),
  typeHandlers: [],
}));

jest.mock('../../api-util/googleIdToken', () => ({
  verifyGoogleIdToken: jest.fn(),
}));

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

const { verifyGoogleIdToken } = require('../../api-util/googleIdToken');
const { handleError } = require('../../api-util/sdk');
const createUserWithIdp = require('./createUserWithIdp');

const { __mockFns } = sharetribeSdk;

const mockRes = () => ({
  status: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  send: jest.fn().mockReturnThis(),
  end: jest.fn().mockReturnThis(),
  clearCookie: jest.fn().mockReturnThis(),
});

const authInfoCookie = 'j:{"idpId":"google","email":"ada@sdsu.edu"}';

describe('createUserWithIdp', () => {
  beforeEach(() => {
    verifyGoogleIdToken.mockReset();
    verifyGoogleIdToken.mockResolvedValue({
      email: 'ada@sdsu.edu',
      emailVerified: true,
    });
    handleError.mockReset();
    __mockFns.createWithIdp.mockReset();
    __mockFns.loginWithIdp.mockReset();
    __mockFns.createWithIdp.mockResolvedValue({});
    __mockFns.loginWithIdp.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      data: {},
    });
    sharetribeSdk.createInstance.mockReturnValue({
      currentUser: { createWithIdp: __mockFns.createWithIdp },
      loginWithIdp: __mockFns.loginWithIdp,
    });
  });

  it('returns 400 when st-idp-token cookie is missing', () => {
    const res = mockRes();
    createUserWithIdp(
      {
        cookies: { 'st-authinfo': authInfoCookie },
        body: {},
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(__mockFns.createWithIdp).not.toHaveBeenCalled();
  });

  it('returns 400 when st-authinfo cookie is missing', () => {
    const res = mockRes();
    createUserWithIdp(
      {
        cookies: { 'st-idp-token': 'token-from-cookie' },
        body: {},
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(__mockFns.createWithIdp).not.toHaveBeenCalled();
  });

  it('uses idpToken and idpId from cookies, and the email from the verified token', async () => {
    const res = mockRes();
    await createUserWithIdp(
      {
        cookies: {
          'st-idp-token': 'token-from-cookie',
          'st-authinfo': authInfoCookie,
        },
        body: {
          idpToken: 'token-from-body',
          idpId: 'facebook',
          email: 'victim@sdsu.edu',
          firstName: 'Edited',
        },
      },
      res
    );

    expect(__mockFns.createWithIdp).not.toHaveBeenCalled();
    expect(handleError).toHaveBeenCalledWith(
      res,
      expect.objectContaining({ status: 400, data: {} })
    );
  });

  it('does not create a user when the cookie email differs from the token email', async () => {
    const res = mockRes();
    await createUserWithIdp(
      {
        cookies: {
          'st-idp-token': 'token-from-cookie',
          'st-authinfo': 'j:{"idpId":"google","email":"victim@sdsu.edu"}',
        },
        body: { firstName: 'Edited' },
      },
      res
    );

    expect(__mockFns.createWithIdp).not.toHaveBeenCalled();
    expect(handleError).toHaveBeenCalledWith(
      res,
      expect.objectContaining({ status: 400, data: {} })
    );
  });

  it('creates the Google user with the verified token email when the body does not substitute one', async () => {
    const res = mockRes();
    await createUserWithIdp(
      {
        cookies: {
          'st-idp-token': 'token-from-cookie',
          'st-authinfo': authInfoCookie,
        },
        body: {
          idpToken: 'token-from-body',
          idpId: 'facebook',
          firstName: 'Edited',
        },
      },
      res
    );

    expect(__mockFns.createWithIdp).toHaveBeenCalledWith({
      idpId: 'google',
      idpClientId: 'google-client-id',
      idpToken: 'token-from-cookie',
      email: 'ada@sdsu.edu',
      firstName: 'Edited',
    });
    expect(__mockFns.loginWithIdp).toHaveBeenCalledWith({
      idpId: 'google',
      idpClientId: 'google-client-id',
      idpToken: 'token-from-cookie',
    });
    expect(res.clearCookie).toHaveBeenCalledWith('st-authinfo', expect.any(Object));
    expect(res.clearCookie).toHaveBeenCalledWith('st-idp-token', expect.any(Object));
  });
});
