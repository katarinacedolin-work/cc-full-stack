const { toSession } = require('./sessionUser');

const user = overrides => ({
  id: { uuid: 'user-1' },
  attributes: {
    email: 'student@sdsu.edu',
    emailVerified: true,
    state: 'active',
    profile: {
      firstName: 'Sam',
      lastName: 'Aztec',
      displayName: 'Sam A.',
      privateData: { termsAcceptedAt: '2026-01-01T00:00:00.000Z', termsVersion: '2026-01' },
      metadata: { isAdmin: false },
    },
    ...overrides,
  },
});

describe('toSession', () => {
  it('returns null when signed out', () => {
    expect(toSession(null)).toBeNull();
  });

  it('maps an active user', () => {
    expect(toSession(user())).toEqual({
      userId: 'user-1',
      email: 'student@sdsu.edu',
      emailVerified: true,
      approved: true,
      state: 'active',
      firstName: 'Sam',
      lastName: 'Aztec',
      displayName: 'Sam A.',
      isAdmin: false,
      termsAcceptedAt: '2026-01-01T00:00:00.000Z',
      termsVersion: '2026-01',
    });
  });

  it('marks pending-approval users as not approved', () => {
    expect(toSession(user({ state: 'pending-approval' })).approved).toBe(false);
  });
});
