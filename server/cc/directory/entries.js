/**
 * The directory: what the team lists by hand next to what students post.
 *
 * There are three kinds of entry. Each is a plain object in the seed file
 * (server/cc/db/seed/directory.json):
 *
 *   school-service  { id, title, provider, category, hours, description, website,
 *                     websiteLabel?, emoji?, accent? }
 *   apartment       { id, title, kicker, meta, price, summary, facts: [[label, value]],
 *                     emoji?, accent? }
 *   agent           { id, name, brokerage, focus, summary, website, accent? }
 *
 * An agent has a link to their own site and nothing else. Students can't message one.
 */

const { initialsOf } = require('../people');

const ACCENTS = ['coral', 'butter', 'sky', 'mint', 'lilac'];

const REQUIRED = {
  'school-service': ['title', 'provider', 'category', 'hours', 'description', 'website'],
  apartment: ['title', 'kicker', 'meta', 'price', 'summary'],
  agent: ['name', 'brokerage', 'focus', 'summary', 'website'],
};

const DEFAULT_EMOJI = { 'school-service': '🏫', apartment: '🏢' };

// The key each kind is listed under, in the seed file and in the API's answer.
const LIST_KEYS = { 'school-service': 'schoolServices', apartment: 'apartments', agent: 'agents' };

const text = value => String(value ?? '').trim();

// A link the pages can put in an href. Anything else, such as javascript:, is refused.
const isWebLink = value => {
  try {
    return ['http:', 'https:'].includes(new URL(String(value)).protocol);
  } catch (e) {
    return false;
  }
};

/**
 * Checks one entry from the seed file and returns it ready to store.
 *
 * @param {'school-service'|'apartment'|'agent'} kind
 * @param {Object} entry
 * @returns {{ id: string, kind: string, details: Object }}
 * @throws {Error} that names the entry and what is wrong with it
 */
exports.checkEntry = (kind, entry = {}) => {
  const id = text(entry.id);
  const fail = problem => new Error(`${kind} "${id || '(no id)'}": ${problem}`);
  if (!REQUIRED[kind]) throw fail('is not a kind of entry');
  if (!/^[a-z0-9][a-z0-9-]{1,59}$/.test(id)) {
    throw fail('needs an id of lowercase letters, numbers and dashes');
  }

  const details = {};
  for (const field of REQUIRED[kind]) {
    details[field] = text(entry[field]);
    if (!details[field]) throw fail(`needs ${field}`);
  }
  if ('website' in details && !isWebLink(details.website)) {
    throw fail('website has to start with https:// or http://');
  }

  const accent = text(entry.accent);
  if (accent && !ACCENTS.includes(accent))
    throw fail(`accent has to be one of ${ACCENTS.join(', ')}`);
  details.accent = accent || ACCENTS[0];

  if (kind === 'school-service') {
    details.websiteLabel = text(entry.websiteLabel) || 'Visit website';
  }
  if (kind !== 'agent') {
    details.emoji = text(entry.emoji) || DEFAULT_EMOJI[kind];
  }
  if (kind === 'apartment') {
    const facts = Array.isArray(entry.facts) ? entry.facts : [];
    details.facts = facts.map(fact => {
      const [label, value] = Array.isArray(fact) ? fact.map(text) : [];
      if (!label || !value) throw fail('each fact is a [label, value] pair');
      return [label, value];
    });
  }
  return { id, kind, details };
};

/**
 * Checks a whole seed file.
 *
 * @param {Object} file { schoolServices: [], apartments: [], agents: [] }
 * @returns {Array<{ id: string, kind: string, position: number, details: Object }>}
 * @throws {Error} for the first entry that is wrong, or for an id used twice
 */
exports.checkFile = (file = {}) => {
  const seen = new Set();
  return Object.entries(LIST_KEYS).flatMap(([kind, key]) => {
    const list = file[key] ?? [];
    if (!Array.isArray(list)) throw new Error(`${key} has to be a list`);
    return list.map((entry, position) => {
      const checked = exports.checkEntry(kind, entry);
      if (seen.has(checked.id)) throw new Error(`The id "${checked.id}" is used twice`);
      seen.add(checked.id);
      return { ...checked, position };
    });
  });
};

const toPublic = row => {
  const entry = { id: row.id, ...row.details };
  if (row.kind === 'agent') entry.initials = initialsOf(entry.name);
  return entry;
};

/**
 * @param {Array<Object>} rows directory_entries rows, in order
 * @returns {{ schoolServices: Array, apartments: Array, agents: Array }} what the pages load
 */
exports.toDirectory = rows => {
  const directory = { schoolServices: [], apartments: [], agents: [] };
  rows.forEach(row => {
    const key = LIST_KEYS[row.kind];
    // A link is checked again on the way out, in case a row was written some other way.
    if (!key || ('website' in row.details && !isWebLink(row.details.website))) return;
    directory[key].push(toPublic(row));
  });
  return directory;
};
