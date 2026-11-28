/**
 * Stores live in the seller's Sharetribe profile publicData.stores array.
 */

const { getSdk } = require('../../api-util/sdk');
const { httpError } = require('../auth/httpError');
const { accentOf, emojiOf } = require('../listings/mapListing');

const requireUser = async (req, res) => {
  const sdk = getSdk(req, res);
  try {
    const response = await sdk.currentUser.show();
    return { sdk, user: response.data.data };
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      throw httpError(401, 'sign-in-required', 'Sign in to continue.');
    }
    throw e;
  }
};

const storesOf = user => {
  const stores = user.attributes?.profile?.publicData?.stores;
  return Array.isArray(stores) ? stores : [];
};

/**
 * Ids of stores saved on this seller's profile.
 *
 * @param {Object} user Sharetribe current user
 * @returns {string[]}
 */
exports.storeIdsOf = user =>
  storesOf(user)
    .map(store => (store && store.id != null ? String(store.id) : ''))
    .filter(Boolean);

/**
 * Store id to write onto a listing. Empty means the listing is not in a store.
 * Any other id must already be on the signed-in seller's profile, so a listing
 * cannot be published onto a demo shop or another seller's storefront.
 *
 * @param {Object} user Sharetribe current user
 * @param {string|null|undefined} storeId
 * @returns {string|null}
 */
exports.ownedStoreId = (user, storeId) => {
  if (storeId == null || String(storeId).trim() === '') return null;
  const id = String(storeId);
  if (!exports.storeIdsOf(user).includes(id)) {
    throw httpError(403, 'store-not-owned', 'That store is not on your profile.');
  }
  return id;
};

const toStore = (store, seller) => {
  const profile = seller?.attributes?.profile || {};
  return {
    ...store,
    emoji: emojiOf(store.emoji, '✦'),
    accent: accentOf(store.accent, 'cobalt'),
    sellerId: seller?.id?.uuid || store.sellerId,
    sellerName: profile.displayName || store.sellerName || '',
  };
};

/**
 * GET /api/cc/stores
 */
exports.list = async (req, res) => {
  const sdk = getSdk(req, res);
  // Browse: query users who have published a store. Until we have a search index for that,
  // return the signed-in seller's stores, or an empty list for anonymous browse.
  try {
    const { user } = await requireUser(req, res);
    res.json({ stores: storesOf(user).map(store => toStore(store, user)) });
  } catch (e) {
    if (e.status === 401) {
      res.json({ stores: [] });
      return;
    }
    throw e;
  }
};

/**
 * GET /api/cc/stores/:id
 */
exports.show = async (req, res) => {
  const { sdk, user } = await requireUser(req, res);
  const store = storesOf(user).find(entry => entry.id === req.params.id);
  if (!store) {
    // Other sellers' stores will come from a user query once Console search is set up.
    throw httpError(404, 'store-not-found', 'That store is no longer here.');
  }
  res.json({ store: toStore(store, user) });
};

const text = value => String(value ?? '').trim();

const POLICY_KEYS = ['cancellation', 'pickup', 'hours'];

const cleanCollections = collections =>
  (Array.isArray(collections) ? collections : [])
    .filter(collection => collection && text(collection.name))
    .map(collection => ({
      name: text(collection.name),
      listingIds: Array.isArray(collection.listingIds) ? collection.listingIds : [],
    }));

const cleanPolicies = (policies, current) => {
  const incoming =
    policies && typeof policies === 'object' && !Array.isArray(policies) ? policies : {};
  const prior = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  return POLICY_KEYS.reduce((next, key) => {
    if (key in incoming) next[key] = String(incoming[key] ?? '');
    else if (key in prior) next[key] = prior[key];
    return next;
  }, {});
};

/**
 * A partial edit is laid over the store that is already saved, so omitted fields keep their values.
 * Sales, rating, and reviews are copied from that store and never from the request.
 */
const applyStoreChanges = (current, body) => {
  const next = {
    ...current,
    sales: current.sales ?? 0,
    rating: current.rating ?? 'New',
    reviews: current.reviews ?? 0,
  };
  if ('name' in body) {
    const name = text(body.name);
    if (!name) throw httpError(400, 'store-name-required', 'Give the store a name.');
    next.name = name;
  }
  if ('handle' in body) {
    const handle = text(body.handle);
    next.handle = handle ? handle.replace(/^@?/, '@') : current.handle || current.id;
  }
  if ('tagline' in body) next.tagline = text(body.tagline);
  if ('emoji' in body) next.emoji = emojiOf(body.emoji, current.emoji || '✦');
  if ('accent' in body) next.accent = accentOf(body.accent, current.accent || 'cobalt');
  if ('announcement' in body) next.announcement = text(body.announcement);
  if ('about' in body) next.about = String(body.about ?? '');
  if ('policies' in body) next.policies = cleanPolicies(body.policies, current.policies);
  if ('collections' in body) next.collections = cleanCollections(body.collections);
  next.emoji = emojiOf(next.emoji, '✦');
  next.accent = accentOf(next.accent, 'cobalt');
  return next;
};

const blankStore = id => ({
  id,
  name: '',
  handle: id,
  tagline: '',
  emoji: '✦',
  accent: 'cobalt',
  announcement: '',
  about: '',
  policies: {},
  collections: [],
  sales: 0,
  rating: 'New',
  reviews: 0,
});

/**
 * PUT /api/cc/stores/:id
 * Creates or updates one store on the signed-in seller's profile.
 * Body fields are optional on an existing store, so an announcement can be posted on its own.
 */
exports.upsert = async (req, res) => {
  const { sdk, user } = await requireUser(req, res);
  const body = req.body || {};
  const id = req.params.id;
  const existing = storesOf(user);
  const current = existing.find(store => store.id === id);
  if (!current && !text(body.name)) {
    throw httpError(400, 'store-name-required', 'Give the store a name.');
  }

  const next = applyStoreChanges(current || blankStore(id), body);
  const stores = current
    ? existing.map(store => (store.id === id ? next : store))
    : [...existing, next];

  await sdk.currentUser.updateProfile({
    publicData: {
      ...(user.attributes?.profile?.publicData || {}),
      stores,
    },
  });

  res.json({ store: toStore(next, user) });
};
