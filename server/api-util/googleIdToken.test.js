jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => ({ mockedJwks: true })),
  jwtVerify: jest.fn(),
}));

const { jwtVerify } = require('jose');
const { verifyGoogleIdToken } = require('./googleIdToken');

describe('verifyGoogleIdToken', () => {
  beforeEach(() => {
    jwtVerify.mockReset();
  });

  it('checks the Google signature, issuer, audience, and expiry', async () => {
    jwtVerify.mockResolvedValue({
      payload: {
        email: 'Ada@SDSU.edu',
        email_verified: true,
        given_name: 'Ada',
        family_name: 'Lovelace',
      },
    });

    const account = await verifyGoogleIdToken('signed-token', 'google-client-id');

    expect(jwtVerify).toHaveBeenCalledWith(
      'signed-token',
      { mockedJwks: true },
      {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: 'google-client-id',
        clockTolerance: 30,
      }
    );
    expect(account).toEqual({
      email: 'Ada@SDSU.edu',
      emailVerified: true,
      givenName: 'Ada',
      familyName: 'Lovelace',
    });
  });

  it('treats a missing or non-boolean email_verified claim as unverified', async () => {
    jwtVerify.mockResolvedValue({ payload: { email: 'ada@sdsu.edu', email_verified: 'true' } });

    await expect(verifyGoogleIdToken('signed-token', 'google-client-id')).resolves.toMatchObject({
      emailVerified: false,
    });
  });

  it('rejects a token that fails verification', async () => {
    jwtVerify.mockRejectedValue(new Error('signature verification failed'));

    await expect(verifyGoogleIdToken('forged-token', 'google-client-id')).rejects.toThrow(
      'signature verification failed'
    );
  });

  it('rejects a missing token or audience before calling Google', async () => {
    await expect(verifyGoogleIdToken('', 'google-client-id')).rejects.toThrow(
      'Missing Google ID token.'
    );
    await expect(verifyGoogleIdToken('signed-token', '')).rejects.toThrow(
      'Missing Google ID token.'
    );
    expect(jwtVerify).not.toHaveBeenCalled();
  });
});
