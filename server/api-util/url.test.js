const {
  isRelativePath,
  buildMarketplaceRedirectUrl,
  guardOAuthRedirectFragment,
} = require('./url');

const ROOT_URL = 'https://marketplace.example.com';

describe('isRelativePath()', () => {
  it('accepts normal app paths', () => {
    expect(isRelativePath('/')).toBe(true);
    expect(isRelativePath('/l/listing-id/slug')).toBe(true);
    expect(isRelativePath('/login?email=test')).toBe(true);
  });

  it('rejects open-redirect patterns', () => {
    expect(isRelativePath('//evil.com')).toBe(false);
    expect(isRelativePath('@evil.com')).toBe(false);
    expect(isRelativePath('https://evil.com')).toBe(false);
    expect(isRelativePath('')).toBe(false);
    expect(isRelativePath(null)).toBe(false);
  });
});

describe('buildMarketplaceRedirectUrl()', () => {
  it('builds a same-origin URL from a safe path', () => {
    expect(buildMarketplaceRedirectUrl(ROOT_URL, '/l/listing-id/slug')).toBe(
      'https://marketplace.example.com/l/listing-id/slug'
    );
  });

  it('falls back when path is an open-redirect attempt', () => {
    expect(buildMarketplaceRedirectUrl(ROOT_URL, '@evil.com', '/login')).toBe(
      'https://marketplace.example.com/login'
    );
    expect(buildMarketplaceRedirectUrl(ROOT_URL, '//evil.com', '/')).toBe(
      'https://marketplace.example.com/'
    );
  });

  it('prefers path over fallback when path is safe', () => {
    expect(buildMarketplaceRedirectUrl(ROOT_URL, '/inbox', '/')).toBe(
      'https://marketplace.example.com/inbox'
    );
  });

  it('returns a relative path when root URL is missing', () => {
    expect(buildMarketplaceRedirectUrl('', '/login')).toBe('/login');
  });
});

describe('guardOAuthRedirectFragment()', () => {
  it('adds a trailing hash when the redirect has no fragment', () => {
    expect(guardOAuthRedirectFragment('https://marketplace.example.com/confirm')).toBe(
      'https://marketplace.example.com/confirm#'
    );
    expect(guardOAuthRedirectFragment('https://marketplace.example.com/')).toBe(
      'https://marketplace.example.com/#'
    );
  });

  it('leaves hash routes unchanged so the confirm screen can match them', () => {
    const confirmUrl = 'https://marketplace.example.com/#/auth/google-confirm';
    expect(guardOAuthRedirectFragment(confirmUrl)).toBe(confirmUrl);
    expect(guardOAuthRedirectFragment('/#/auth/google-confirm')).toBe('/#/auth/google-confirm');
  });
});
