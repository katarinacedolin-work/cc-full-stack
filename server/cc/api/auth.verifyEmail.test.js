jest.mock('../../api-util/sdk', () => ({
  getSdk: jest.fn(),
  typeHandlers: [],
}));

const { getSdk } = require('../../api-util/sdk');
const { verifyEmail } = require('./auth');

const mockRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

const signedInUser = {
  id: { uuid: 'user-1' },
  attributes: {
    email: 'ada@sdsu.edu',
    emailVerified: false,
    state: 'active',
    profile: { firstName: 'Ada', lastName: 'Lovelace' },
  },
};

describe('verifyEmail', () => {
  beforeEach(() => {
    getSdk.mockReset();
  });

  it('asks for sign-in and does not call Sharetribe when nobody is signed in', async () => {
    const verify = jest.fn();
    getSdk.mockReturnValue({
      currentUser: {
        show: jest.fn().mockRejectedValue({ status: 401 }),
        verifyEmail: verify,
      },
    });

    await expect(
      verifyEmail({ body: { token: 'valid-token' } }, mockRes())
    ).rejects.toMatchObject({
      status: 401,
      code: 'auth-required',
    });
    expect(verify).not.toHaveBeenCalled();
  });

  it('verifies with the signed-in session and returns that session', async () => {
    const verified = {
      ...signedInUser,
      attributes: { ...signedInUser.attributes, emailVerified: true },
    };
    const verify = jest.fn().mockResolvedValue({});
    getSdk.mockReturnValue({
      currentUser: {
        show: jest
          .fn()
          .mockResolvedValueOnce({ data: { data: signedInUser } })
          .mockResolvedValueOnce({ data: { data: verified } }),
        verifyEmail: verify,
      },
    });
    const res = mockRes();

    await verifyEmail({ body: { token: '  valid-token  ' } }, res);

    expect(verify).toHaveBeenCalledWith({ verificationToken: 'valid-token' });
    expect(res.json).toHaveBeenCalledWith({
      session: expect.objectContaining({
        userId: 'user-1',
        email: 'ada@sdsu.edu',
        emailVerified: true,
      }),
    });
  });

  it('replaces a generic Sharetribe 403 with a message about the link', async () => {
    const verify = jest.fn().mockRejectedValue({
      status: 403,
      data: { errors: [{ title: 'Forbidden', detail: 'Token mismatch' }] },
    });
    getSdk.mockReturnValue({
      currentUser: {
        show: jest.fn().mockResolvedValue({ data: { data: signedInUser } }),
        verifyEmail: verify,
      },
    });

    await expect(
      verifyEmail({ body: { token: 'someone-elses-token' } }, mockRes())
    ).rejects.toMatchObject({
      status: 403,
      code: 'verify-failed',
      message: 'Token mismatch',
    });
  });

  it('rejects a missing token before checking the session', async () => {
    await expect(verifyEmail({ body: {} }, mockRes())).rejects.toMatchObject({
      status: 400,
      code: 'token-required',
    });
    expect(getSdk).not.toHaveBeenCalled();
  });
});
