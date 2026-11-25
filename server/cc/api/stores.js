/**
 * Stores live in the seller's Sharetribe profile publicData.stores array.
 */

const { getSdk } = require('../../api-util/sdk');
const { httpError } = require('../auth/httpError');

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

const toStore = (store, seller) => {
  const profile = seller?.attributes?.profile || {};
  return {
    ...store,
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
  // return the signed-in seller's stores, or an empty list for anonymous browse (seeded later).
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

/**
 * PUT /api/cc/stores/:id
 * Creates or updates one store on the signed-in seller's profile.
 */
exports.upsert = async (req, res) => {
  const { sdk, user } = await requireUser(req, res);
  const body = req.body || {};
  const id = req.params.id;
  if (!String(body.name || '').trim()) {
    throw httpError(400, 'store-name-required', 'Give the store a name.');
  }

  const existing = storesOf(user);
  const next = {
    id,
    name: String(body.name).trim(),
    handle: String(body.handle || '').trim() || id,
    tagline: String(body.tagline || '').trim(),
    emoji: body.emoji || '✦',
    accent: body.accent || 'cobalt',
    collections: Array.isArray(body.collections) ? body.collections : [],
    sales: Number(body.sales) || 0,
    rating: body.rating != null ? body.rating : 'New',
    reviews: Number(body.reviews) || 0,
  };

  const stores = existing.some(store => store.id === id)
    ? existing.map(store => (store.id === id ? { ...store, ...next } : store))
    : [...existing, next];

  await sdk.currentUser.updateProfile({
    publicData: {
      ...(user.attributes.profile.publicData || {}),
      stores,
    },
  });

  res.json({ store: toStore(next, user) });
};
