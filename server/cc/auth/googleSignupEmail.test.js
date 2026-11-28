jest.mock('../../api-util/googleIdToken', () => ({
  verifyGoogleIdToken: jest.fn(),
}));

const { verifyGoogleIdToken } = require('../../api-util/googleIdToken');
const { emailForGoogleSignup } = require('./googleSignupEmail');

describe('emailForGoogleSignup', () => {
  beforeEach(() => {
    verifyGoogleIdToken.mockReset();
  });

  it('returns the token address, and treats a case-only difference as the same mailbox', async () => {
    verifyGoogleIdToken.mockResolvedValue({
      email: '  Ada@SDSU.EDU ',
      emailVerified: true,
    });

    await expect(emailForGoogleSignup('token', 'client', 'ada@sdsu.edu')).resolves.toBe(
      'Ada@SDSU.EDU'
    );
  });

  it('rejects a requested address that differs from the token', async () => {
    verifyGoogleIdToken.mockResolvedValue({
      email: 'ada@sdsu.edu',
      emailVerified: true,
    });

    await expect(emailForGoogleSignup('token', 'client', 'victim@sdsu.edu')).rejects.toMatchObject({
      status: 400,
      code: 'google-session-expired',
    });
  });

  it('rejects an unverified or non-SDSU token email', async () => {
    verifyGoogleIdToken.mockResolvedValue({
      email: 'ada@sdsu.edu',
      emailVerified: false,
    });
    await expect(emailForGoogleSignup('token', 'client', 'ada@sdsu.edu')).rejects.toMatchObject({
      code: 'sdsu-email-required',
    });

    verifyGoogleIdToken.mockResolvedValue({
      email: 'ada@gmail.com',
      emailVerified: true,
    });
    await expect(emailForGoogleSignup('token', 'client', 'ada@gmail.com')).rejects.toMatchObject({
      code: 'sdsu-email-required',
    });
  });

  it('rejects a token that does not verify', async () => {
    verifyGoogleIdToken.mockRejectedValue(new Error('bad signature'));

    await expect(emailForGoogleSignup('forged', 'client', 'ada@sdsu.edu')).rejects.toMatchObject({
      status: 400,
      code: 'google-session-expired',
    });
  });
});
