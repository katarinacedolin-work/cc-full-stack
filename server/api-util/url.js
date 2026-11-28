/**
 * Returns true when path is safe to use as a same-origin relative redirect path.
 *
 * @param {unknown} path
 * @returns {boolean}
 */
const isRelativePath = path =>
  typeof path === 'string' && path.startsWith('/') && !path.startsWith('//');

/**
 * Builds an absolute marketplace redirect URL from a relative path.
 * Falls back when path (or fallback) is missing or unsafe.
 *
 * @param {string} rootUrl Marketplace root URL from REACT_APP_MARKETPLACE_ROOT_URL
 * @param {string} [path] Preferred relative path
 * @param {string} [fallback='/'] Fallback relative path when path is unsafe
 * @returns {string}
 */
const buildMarketplaceRedirectUrl = (rootUrl, path, fallback = '/') => {
  const safePath =
    path && isRelativePath(path) ? path : fallback && isRelativePath(fallback) ? fallback : '/';

  const base = (rootUrl || '').replace(/\/$/, '');
  if (!base) {
    return safePath;
  }

  return `${base}${safePath}`;
};

/**
 * Facebook appends `#_=_` to OAuth redirects that have no fragment, which
 * breaks client routing. A trailing `#` blocks that. URLs that already have a
 * fragment (hash routes such as `/#/auth/google-confirm`) stay unchanged —
 * another `#` would become part of the fragment and fail an exact hash match.
 *
 * @param {string} url
 * @returns {string}
 */
const guardOAuthRedirectFragment = url => (String(url).includes('#') ? url : `${url}#`);

module.exports = {
  isRelativePath,
  buildMarketplaceRedirectUrl,
  guardOAuthRedirectFragment,
};
