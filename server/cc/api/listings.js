/**
 * Listing browse and seller CRUD for /api/cc.
 */

const { types } = require('sharetribe-flex-sdk');
const { getSdk } = require('../../api-util/sdk');
const { httpError } = require('../auth/httpError');
const {
  toCampusListing,
  toSharetribeAttrs,
  openAvailabilityPlan,
} = require('../listings/mapListing');

const { UUID } = types;

const LISTING_INCLUDE = {
  expand: true,
  include: ['author', 'images', 'currentStock'],
  'fields.image': ['variants.listing-card', 'variants.scaled-medium', 'variants.landscape-crop'],
};

// Products and tickets are sold from Sharetribe stock; a service is booked by time instead.
const usesStock = kind => kind === 'product' || kind === 'ticket';

const wholeNumber = value => Math.max(0, Math.floor(Number(value)) || 0);

/**
 * Sets how many of a listing are left to sell.
 *
 * @param {Object} sdk Marketplace SDK for the seller
 * @param {Object} listingId UUID
 * @param {number|null} oldTotal what Sharetribe has now, or null when stock was never set
 * @param {number} newTotal
 */
const setStock = (sdk, listingId, oldTotal, newTotal) =>
  sdk.stock.compareAndSet({ listingId, oldTotal, newTotal });

const showOwn = async (sdk, id) => {
  const response = await sdk.ownListings.show({ id, ...LISTING_INCLUDE });
  return { listing: response.data.data, included: response.data.included || [] };
};

const currentStockOf = (listing, included) => {
  const ref = listing.relationships?.currentStock?.data;
  const stock = ref
    ? included.find(entity => entity.type === 'stock' && entity.id.uuid === ref.id.uuid)
    : null;
  return stock ? stock.attributes.quantity : null;
};

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

const sharetribeMessage = (error, fallback) => {
  const first = error?.data?.errors?.[0];
  return first?.title || first?.detail || fallback;
};

const asUuid = id => {
  if (!id) {
    throw httpError(400, 'listing-id-required', 'That listing is missing.');
  }
  return new UUID(id);
};

/**
 * GET /api/cc/listings
 * Query: kind, category, q, mine=1
 */
exports.list = async (req, res) => {
  const mine = req.query.mine === '1' || req.query.mine === 'true';
  const { sdk, user } = mine ? await requireUser(req, res) : { sdk: getSdk(req, res), user: null };

  const params = {
    ...LISTING_INCLUDE,
    perPage: Math.min(Number(req.query.limit) || 100, 100),
  };
  if (req.query.kind) {
    params.pub_kind = req.query.kind;
  }
  if (req.query.category && req.query.category !== 'All') {
    params.pub_category = req.query.category;
  }
  if (req.query.q) {
    params.keywords = String(req.query.q);
  }

  let response;
  try {
    response = mine
      ? await sdk.ownListings.query({
          ...params,
          states: ['draft', 'pendingApproval', 'published', 'closed'],
        })
      : await sdk.listings.query({ ...params, states: ['published'] });
  } catch (e) {
    throw httpError(
      e.status || 400,
      'listings-failed',
      sharetribeMessage(e, 'Could not load listings.')
    );
  }

  const included = response.data.included || [];
  let listings = response.data.data.map(listing => toCampusListing(listing, included));

  // Sellers also see their closed and draft listings. Buyers only get published.
  if (mine && user) {
    listings = listings.filter(listing => listing.sellerId === user.id.uuid || !listing.sellerId);
  }

  res.json({ listings });
};

/**
 * GET /api/cc/listings/:id
 */
exports.show = async (req, res) => {
  const sdk = getSdk(req, res);
  try {
    const response = await sdk.listings.show({ id: asUuid(req.params.id), ...LISTING_INCLUDE });
    res.json({
      listing: toCampusListing(response.data.data, response.data.included || []),
    });
  } catch (e) {
    if (e.status === 404) {
      // Drafts and the seller's own closed listings are only on ownListings.
      try {
        const { sdk: ownSdk } = await requireUser(req, res);
        const response = await ownSdk.ownListings.show({
          id: asUuid(req.params.id),
          ...LISTING_INCLUDE,
        });
        res.json({
          listing: toCampusListing(response.data.data, response.data.included || []),
        });
        return;
      } catch (ownError) {
        throw httpError(404, 'listing-not-found', 'That listing is no longer here.');
      }
    }
    throw httpError(
      e.status || 400,
      'listing-failed',
      sharetribeMessage(e, 'Could not load that listing.')
    );
  }
};

/**
 * POST /api/cc/listings
 * Body: Campus Connect listing fields. draft: true keeps it unpublished.
 */
exports.create = async (req, res) => {
  const { sdk } = await requireUser(req, res);
  const fields = req.body || {};
  if (!String(fields.title || '').trim() || !String(fields.description || '').trim()) {
    throw httpError(400, 'listing-incomplete', 'Add a title and a description.');
  }
  if (!(Number(fields.price) > 0)) {
    throw httpError(400, 'price-required', 'Add a price of at least $1.00.');
  }

  const attrs = toSharetribeAttrs(fields);
  const imageIds = Array.isArray(fields.imageIds)
    ? fields.imageIds.map(id => new UUID(id))
    : undefined;

  const kind = attrs.publicData.kind;
  if (kind === 'service') {
    attrs.availabilityPlan = openAvailabilityPlan();
  }

  try {
    const created = await sdk.ownListings.createDraft({
      ...attrs,
      ...(imageIds ? { images: imageIds } : {}),
    });
    const id = created.data.data.id;

    if (usesStock(kind)) {
      const quantity = wholeNumber(fields.quantityAvailable ?? fields.quantity) || 1;
      await setStock(sdk, id, null, quantity);
    }

    if (!fields.draft) {
      await sdk.ownListings.publishDraft({ id });
    }

    const { listing, included } = await showOwn(sdk, id);
    res.status(201).json({ listing: toCampusListing(listing, included) });
  } catch (e) {
    throw httpError(
      e.status || 400,
      'create-failed',
      sharetribeMessage(e, 'Could not create that listing.')
    );
  }
};

/**
 * PATCH /api/cc/listings/:id
 */
exports.update = async (req, res) => {
  const { sdk } = await requireUser(req, res);
  const fields = req.body || {};
  const id = asUuid(req.params.id);
  const imageIds = Array.isArray(fields.imageIds)
    ? fields.imageIds.map(imageId => new UUID(imageId))
    : undefined;

  let current;
  try {
    current = await showOwn(sdk, id);
  } catch (e) {
    throw httpError(404, 'listing-not-found', 'That listing is no longer here.');
  }

  // A partial edit is laid over what the listing has now, so the fields the client left out
  // keep their values instead of going back to defaults.
  const before = toCampusListing(current.listing, current.included);
  const attrs = toSharetribeAttrs({ ...before, ...fields });
  const kind = attrs.publicData.kind;

  const update = { id };
  if ('title' in fields) update.title = attrs.title;
  if ('description' in fields) update.description = attrs.description;
  if ('price' in fields) update.price = attrs.price;
  // Merge onto existing publicData so we do not drop rating/reviews written by the worker.
  update.publicData = {
    ...(current.listing.attributes.publicData || {}),
    ...attrs.publicData,
  };
  if (imageIds) update.images = imageIds;

  try {
    if (fields.status === 'active') {
      await sdk.ownListings.open({ id });
    }
    if (fields.status === 'closed' || fields.status === 'paused') {
      await sdk.ownListings.close({ id });
    }
    await sdk.ownListings.update(update);

    const wantsStock = 'quantityAvailable' in fields || 'quantity' in fields;
    if (usesStock(kind) && wantsStock) {
      const oldTotal = currentStockOf(current.listing, current.included);
      const newTotal = wholeNumber(fields.quantityAvailable ?? fields.quantity);
      if (oldTotal !== newTotal) {
        await setStock(sdk, id, oldTotal, newTotal);
      }
    }

    const { listing, included } = await showOwn(sdk, id);
    res.json({ listing: toCampusListing(listing, included) });
  } catch (e) {
    throw httpError(
      e.status || 400,
      'update-failed',
      sharetribeMessage(e, 'Could not update that listing.')
    );
  }
};

/**
 * POST /api/cc/listings/:id/duplicate
 */
exports.duplicate = async (req, res) => {
  const { sdk } = await requireUser(req, res);
  const original = await showOwn(sdk, asUuid(req.params.id));
  const listing = original.listing;
  const attrs = listing.attributes;
  const publicData = { ...(attrs.publicData || {}) };
  delete publicData.rating;
  delete publicData.reviews;
  delete publicData.completed;
  delete publicData.tag;

  try {
    const created = await sdk.ownListings.createDraft({
      title: `${attrs.title} (copy)`,
      description: attrs.description,
      price: attrs.price,
      publicData,
      ...(attrs.availabilityPlan ? { availabilityPlan: attrs.availabilityPlan } : {}),
    });
    const id = created.data.data.id;
    if (usesStock(publicData.kind)) {
      const quantity = currentStockOf(listing, original.included) || 1;
      await setStock(sdk, id, null, quantity);
    }
    const copy = await showOwn(sdk, id);
    res.status(201).json({ listing: toCampusListing(copy.listing, copy.included) });
  } catch (e) {
    throw httpError(
      e.status || 400,
      'duplicate-failed',
      sharetribeMessage(e, 'Could not duplicate that listing.')
    );
  }
};

/**
 * DELETE /api/cc/listings/:id
 * Published listings are closed (Sharetribe cannot delete them). Drafts are discarded.
 */
exports.remove = async (req, res) => {
  const { sdk } = await requireUser(req, res);
  const id = asUuid(req.params.id);
  try {
    const current = await sdk.ownListings.show({ id });
    const state = current.data.data.attributes.state;
    if (state === 'draft' || state === 'pendingApproval') {
      await sdk.ownListings.discardDraft({ id });
    } else {
      await sdk.ownListings.close({ id });
    }
    res.json({ ok: true });
  } catch (e) {
    throw httpError(
      e.status || 400,
      'delete-failed',
      sharetribeMessage(e, 'Could not remove that listing.')
    );
  }
};

/**
 * POST /api/cc/listings/away
 * Body: { away: true|false }
 * Away mode closes all of the seller's published listings, or reopens ones paused by away mode.
 */
exports.setAwayMode = async (req, res) => {
  const { sdk, user } = await requireUser(req, res);
  const away = Boolean(req.body?.away);

  const profile = user.attributes.profile || {};
  const privateData = { ...(profile.privateData || {}), awayMode: away };
  await sdk.currentUser.updateProfile({ privateData });

  const own = await sdk.ownListings.query({
    states: away ? ['published'] : ['closed'],
    perPage: 100,
    expand: true,
  });

  for (const listing of own.data.data) {
    const publicData = listing.attributes.publicData || {};
    if (away) {
      await sdk.ownListings.close({ id: listing.id });
      await sdk.ownListings.update({
        id: listing.id,
        publicData: { ...publicData, awayPaused: true },
      });
    } else if (publicData.awayPaused) {
      await sdk.ownListings.open({ id: listing.id });
      await sdk.ownListings.update({
        id: listing.id,
        publicData: { ...publicData, awayPaused: false },
      });
    }
  }

  res.json({ awayMode: away });
};
