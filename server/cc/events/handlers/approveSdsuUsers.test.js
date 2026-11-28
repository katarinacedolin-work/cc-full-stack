jest.mock('../../integrationSdk', () => ({
  getIntegrationSdk: jest.fn(),
}));

jest.mock('../../../log', () => ({
  error: jest.fn(),
}));

const { getIntegrationSdk } = require('../../integrationSdk');
const approveSdsuUsers = require('./approveSdsuUsers');

const event = (eventType, attributes) => ({
  attributes: {
    eventType,
    resource: {
      id: { uuid: 'user-1' },
      attributes,
    },
  },
});

describe('approveSdsuUsers', () => {
  let sdk;

  beforeEach(() => {
    sdk = {
      users: {
        approve: jest.fn(async () => ({})),
        updatePermissions: jest.fn(async () => ({})),
      },
    };
    getIntegrationSdk.mockReturnValue(sdk);
  });

  it('approves a verified pending SDSU user', async () => {
    await approveSdsuUsers(
      event('user/updated', {
        email: 'student@sdsu.edu',
        emailVerified: true,
        state: 'pending-approval',
      })
    );
    expect(sdk.users.approve).toHaveBeenCalledWith({ id: { uuid: 'user-1' } });
  });

  it('ignores unverified SDSU users', async () => {
    await approveSdsuUsers(
      event('user/created', {
        email: 'student@sdsu.edu',
        emailVerified: false,
        state: 'pending-approval',
      })
    );
    expect(sdk.users.approve).not.toHaveBeenCalled();
  });

  it('revokes permissions when an active user leaves SDSU email', async () => {
    await approveSdsuUsers(
      event('user/email_updated', {
        email: 'student@gmail.com',
        emailVerified: true,
        state: 'active',
      })
    );
    expect(sdk.users.updatePermissions).toHaveBeenCalledWith({
      id: { uuid: 'user-1' },
      postListings: 'permission/deny',
      initiateTransactions: 'permission/deny',
    });
  });

  it('restores permissions when an active user returns to a verified SDSU email', async () => {
    await approveSdsuUsers(
      event('user/email_verified', {
        email: 'student@sdsu.edu',
        emailVerified: true,
        state: 'active',
        permissions: {
          postListings: 'permission/deny',
          initiateTransactions: 'permission/deny',
          read: 'permission/allow',
        },
      })
    );
    expect(sdk.users.approve).not.toHaveBeenCalled();
    expect(sdk.users.updatePermissions).toHaveBeenCalledWith({
      id: { uuid: 'user-1' },
      postListings: 'permission/allow',
      initiateTransactions: 'permission/allow',
    });
  });

  it('leaves permissions alone when an active SDSU user can already post and checkout', async () => {
    await approveSdsuUsers(
      event('user/updated', {
        email: 'student@sdsu.edu',
        emailVerified: true,
        state: 'active',
        permissions: {
          postListings: 'permission/allow',
          initiateTransactions: 'permission/allow',
        },
      })
    );
    expect(sdk.users.approve).not.toHaveBeenCalled();
    expect(sdk.users.updatePermissions).not.toHaveBeenCalled();
  });

  it('does not restore permissions before the SDSU email is verified', async () => {
    await approveSdsuUsers(
      event('user/email_updated', {
        email: 'student@sdsu.edu',
        emailVerified: false,
        state: 'active',
        permissions: {
          postListings: 'permission/deny',
          initiateTransactions: 'permission/deny',
        },
      })
    );
    expect(sdk.users.updatePermissions).not.toHaveBeenCalled();
  });

  it('ignores unrelated events', async () => {
    await approveSdsuUsers(event('listing/created', {}));
    expect(sdk.users.approve).not.toHaveBeenCalled();
  });
});
