/**
 * How a person is shown on the pages: a name, initials, and a color for their avatar.
 */

const ACCENTS = ['coral', 'butter', 'sky', 'mint', 'lilac', 'cobalt'];

/**
 * @param {Object|null} user a Sharetribe user or currentUser resource
 * @returns {string}
 */
exports.displayNameOf = user => {
  const profile = user?.attributes?.profile || {};
  return (
    profile.displayName ||
    [profile.firstName, profile.lastName].filter(Boolean).join(' ') ||
    'Student'
  );
};

/**
 * @param {string} name
 * @returns {string} up to two letters, or '?' for an empty name
 */
exports.initialsOf = name =>
  String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0].toUpperCase())
    .join('') || '?';

/**
 * @param {string} id anything that identifies the person
 * @returns {string} the same avatar color every time for the same id
 */
exports.accentFor = id => {
  let sum = 0;
  for (const character of String(id || '')) {
    sum = (sum + character.charCodeAt(0)) % 997;
  }
  return ACCENTS[sum % ACCENTS.length];
};
