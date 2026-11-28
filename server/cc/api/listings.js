/**
 * Listing browse and seller CRUD for /api/cc.
 */

const { types } = require('sharetribe-flex-sdk');
const { getSdk } = require('../../api-util/sdk');
const { httpError } = require('../auth/httpError');
const { ownedStoreId, storeIdsOf } = require('./stores');
const {
  toCampusListing,
  toSharetribeAttrs,
  openAvailabilityPlan,
  isRemovedListing,
  listingImageSourceUrls,
  wholeQuantity,
} = require('../listings/mapListing');
const { availabilityFor, BOOKING_WINDOW_DAYS } = require('../listings/slots');

const { UUID } = types;

const LISTING_INCLUDE = {
  expand: true,
  include: ['author', 'images', 'currentStock'],
  'fields.image': ['variants.listing-card', 'variants.scaled-medium', 'variants.landscape-crop'],
};

// The card variants are for display. A copy needs the largest file Sharetribe will give back.
const DUPLICATE_IMAGE_FIELDS = [
  'variants.scaled-xlarge',
  'variants.scaled-large',
  'variants.default',
  ...LISTING_INCLUDE['fields.image'],
];

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

// Products and tickets are sold from Sharetribe stock; a service is booked by time instead.
const usesStock = kind => kind === 'product' || kind === 'ticket';

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

const downloadImage = async url => {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  } catch (e) {
    throw httpError(502, 'image-copy-failed', 'Could not copy a photo from that listing.');
  }

  const finalUrl = response.url || url;
  const type = (response.headers.get('content-type') || '').split(';')[0].trim();
  const length = Number(response.headers.get('content-length'));
  const typeOk = !type || type.startsWith('image/') || type === 'application/octet-stream';
  if (!response.ok || !finalUrl.startsWith('https://') || !typeOk || length > MAX_IMAGE_BYTES) {
    throw httpError(502, 'image-copy-failed', 'Could not copy a photo from that listing.');
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw httpError(502, 'image-copy-failed', 'Could not copy a photo from that listing.');
  }
  // The Node Sharetribe SDK accepts a Buffer as the image file body (same as /api/cc/images).
  return buffer;
};

// An image id can belong to only one listing, so each photo is uploaded again.
const copyListingImages = async (sdk, listing, included) => {
  const urls = listingImageSourceUrls(listing, included);
  if (urls.some(url => !url)) {
    throw httpError(502, 'image-copy-failed', 'Could not copy a photo from that listing.');
  }

  const images = [];
  for (const url of urls) {
    const buffer = await downloadImage(url);
    try {
      const uploaded = await sdk.images.upload({ image: buffer }, { expand: true });
      const id = uploaded?.data?.data?.id;
      if (!id?.uuid) {
        throw httpError(502, 'image-copy-failed', 'Could not copy a photo from that listing.');
      }
      images.push(new UUID(id.uuid));
    } catch (e) {
      if (e.code) throw e;
      throw httpError(
        502,
        'image-copy-failed',
        sharetribeMessage(e, 'Could not copy a photo from that listing.')
      );
    }
  }
  return images;
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
  // Sellers also see paused listings (closed on Sharetribe) and drafts. Buyers only get
  // published listings. A delete closes the listing and flags it, so it is left out here
  // instead of coming back as paused.
  let listings = response.data.data
    .filter(listing => !isRemovedListing(listing))
    .map(listing => toCampusListing(listing, included));

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
    if (isRemovedListing(response.data.data)) {
      throw httpError(404, 'listing-not-found', 'That listing is no longer here.');
    }
    res.json({
      listing: toCampusListing(response.data.data, response.data.included || []),
    });
  } catch (e) {
    if (e.status === 404) {
      // Drafts and the seller's own paused listings are only on ownListings.
      try {
        const { sdk: ownSdk } = await requireUser(req, res);
        const response = await ownSdk.ownListings.show({
          id: asUuid(req.params.id),
          ...LISTING_INCLUDE,
        });
        if (isRemovedListing(response.data.data)) {
          throw httpError(404, 'listing-not-found', 'That listing is no longer here.');
        }
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

const TIMESLOT_PAGE = 500;

/** Every timeslot in the window. A full page means another page may follow. */
const queryTimeslots = async (sdk, listingId, start, end) => {
  const collected = [];
  let page = 1;
  for (;;) {
    const response = await sdk.timeslots.query({
      listingId,
      start,
      end,
      page,
      perPage: TIMESLOT_PAGE,
    });
    const batch = response.data.data || [];
    collected.push(...batch);
    const perPage = response.data.meta?.perPage || TIMESLOT_PAGE;
    if (batch.length < perPage || page >= 12) break;
    page += 1;
  }
  return collected;
};

/** Public listing, or the signed-in seller's own draft or closed listing. */
const loadListingResource = async (req, res, id) => {
  const sdk = getSdk(req, res);
  try {
    const response = await sdk.listings.show({ id, ...LISTING_INCLUDE });
    return { sdk, resource: response.data.data, included: response.data.included || [] };
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  try {
    const { sdk: ownSdk } = await requireUser(req, res);
    const response = await ownSdk.ownListings.show({ id, ...LISTING_INCLUDE });
    return { sdk: ownSdk, resource: response.data.data, included: response.data.included || [] };
  } catch (e) {
    throw httpError(404, 'listing-not-found', 'That listing is no longer here.');
  }
};

/**
 * GET /api/cc/listings/:id/availability
 * Open times for a service, as { duration, slots: [{ date, time }] }.
 * Products and tickets have no bookable times.
 */
exports.availability = async (req, res) => {
  const id = asUuid(req.params.id);
  let loaded;
  try {
    loaded = await loadListingResource(req, res, id);
  } catch (e) {
    if (e.code === 'listing-not-found') throw e;
    throw httpError(
      e.status || 400,
      'listing-failed',
      sharetribeMessage(e, 'Could not load that listing.')
    );
  }

  if (isRemovedListing(loaded.resource)) {
    throw httpError(404, 'listing-not-found', 'That listing is no longer here.');
  }

  const listing = toCampusListing(loaded.resource, loaded.included);
  if (listing.kind !== 'service') {
    res.json({ duration: null, slots: [] });
    return;
  }

  const start = new Date();
  const end = new Date(start.getTime() + BOOKING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  let timeslots;
  try {
    timeslots = await queryTimeslots(loaded.sdk, id, start, end);
  } catch (e) {
    throw httpError(
      e.status || 400,
      'availability-failed',
      sharetribeMessage(e, 'Could not load open times.')
    );
  }

  res.json(availabilityFor(listing, timeslots, start));
};

/**
 * POST /api/cc/listings
 * Body: Campus Connect listing fields. draft: true keeps it unpublished.
 */
exports.create = async (req, res) => {
  const { sdk, user } = await requireUser(req, res);
  const fields = req.body || {};
  if (!String(fields.title || '').trim() || !String(fields.description || '').trim()) {
    throw httpError(400, 'listing-incomplete', 'Add a title and a description.');
  }
  if (!(Number(fields.price) > 0)) {
    throw httpError(400, 'price-required', 'Add a price of at least $1.00.');
  }

  const ownedStoreIds = storeIdsOf(user);
  // Reject a shop the caller does not own instead of publishing onto it.
  const storeId = ownedStoreId(user, fields.storeId);
  const attrs = toSharetribeAttrs({ ...fields, storeId }, { ownedStoreIds });
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
      // 0 means sold out. || would treat that as missing and restock the new listing to 1.
      const quantity = wholeQuantity(fields.quantityAvailable ?? fields.quantity, 1);
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
  const { sdk, user } = await requireUser(req, res);
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
  const ownedStoreIds = storeIdsOf(user);
  // An explicit storeId must belong to this seller. A partial edit keeps the
  // current store only while they still own it, and drops one that does not.
  const storeId =
    'storeId' in fields
      ? ownedStoreId(user, fields.storeId)
      : before.storeId && ownedStoreIds.includes(String(before.storeId))
      ? String(before.storeId)
      : null;
  const attrs = toSharetribeAttrs({ ...before, ...fields, storeId }, { ownedStoreIds });
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
    // open only reopens a closed listing. Seller Hub publishes a draft by setting
    // status to active, and that transition is publishDraft. Pause closes a published
    // listing. Closing one that is already closed is not a valid transition. A draft is not
    // visible to buyers, so pausing it needs no transition. Never publish it to close it,
    // because a failed close would leave the listing live.
    const state = current.listing.attributes.state;
    const wantsPause = fields.status === 'paused' || fields.status === 'closed';
    if (fields.status === 'active' && state === 'draft') {
      await sdk.ownListings.publishDraft({ id });
    } else if (fields.status === 'active' && state === 'closed') {
      await sdk.ownListings.open({ id });
    } else if (wantsPause && state === 'published') {
      await sdk.ownListings.close({ id });
    }
    await sdk.ownListings.update(update);

    const wantsStock = 'quantityAvailable' in fields || 'quantity' in fields;
    if (usesStock(kind) && wantsStock) {
      const oldTotal = currentStockOf(current.listing, current.included);
      const newTotal = wholeQuantity(fields.quantityAvailable ?? fields.quantity);
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
  const { sdk, user } = await requireUser(req, res);
  const response = await sdk.ownListings.show({
    id: asUuid(req.params.id),
    ...LISTING_INCLUDE,
    'fields.image': DUPLICATE_IMAGE_FIELDS,
  });
  const listing = response.data.data;
  const included = response.data.included || [];
  const attrs = listing.attributes;
  const publicData = { ...(attrs.publicData || {}) };
  delete publicData.rating;
  delete publicData.reviews;
  delete publicData.completed;
  delete publicData.tag;
  delete publicData.removed;
  delete publicData.awayPaused;
  if (!storeIdsOf(user).includes(String(publicData.storeId || ''))) {
    publicData.storeId = null;
  }

  const images = await copyListingImages(sdk, listing, included);

  try {
    const created = await sdk.ownListings.createDraft({
      title: `${attrs.title} (copy)`,
      description: attrs.description,
      price: attrs.price,
      publicData,
      ...(attrs.availabilityPlan ? { availabilityPlan: attrs.availabilityPlan } : {}),
      ...(images.length ? { images } : {}),
    });
    const id = created.data.data.id;
    if (usesStock(publicData.kind)) {
      // 0 means sold out and must be copied. || would treat that as missing and restock to 1.
      const quantity = currentStockOf(listing, included) ?? 1;
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
    const listing = current.data.data;
    const state = listing.attributes.state;
    if (state === 'draft' || state === 'pendingApproval') {
      await sdk.ownListings.discardDraft({ id });
    } else {
      // Published listings can only be closed. Flag the close as a delete so the
      // seller list does not show it as paused.
      if (state !== 'closed') {
        await sdk.ownListings.close({ id });
      }
      const publicData = listing.attributes.publicData || {};
      await sdk.ownListings.update({
        id,
        publicData: { ...publicData, removed: true },
      });
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

const AWAY_PAGE_SIZE = 100;
const AWAY_MAX_PAGES = 50;

const sharetribeConfigured = () => {
  const clientId = process.env.REACT_APP_SHARETRIBE_SDK_CLIENT_ID;
  const secret = process.env.SHARETRIBE_SDK_CLIENT_SECRET;
  return (
    Boolean(clientId) && clientId !== 'change-me' && Boolean(secret) && secret !== 'change-me'
  );
};

const ownListingsInStates = async (sdk, states) => {
  const listings = [];
  for (let page = 1; page <= AWAY_MAX_PAGES; page += 1) {
    const response = await sdk.ownListings.query({ states, page, perPage: AWAY_PAGE_SIZE });
    const data = response && response.data;
    const batch = (data && data.data) || [];
    listings.push(...batch);
    if (batch.length === 0) return listings;
    const totalPages = data && data.meta && data.meta.totalPages;
    const lastPage = totalPages ? page >= totalPages : batch.length < AWAY_PAGE_SIZE;
    if (lastPage) return listings;
  }
  throw httpError(
    502,
    'away-mode-failed',
    'Could not update away mode. Your listings were left as they were.'
  );
};

// Sharetribe merges publicData, so a rollback has to write the previous awayPaused value.
const restoredPublicData = publicData => ({
  ...publicData,
  awayPaused: Boolean(publicData.awayPaused),
});

const restoreAwayChanges = async (sdk, changes) => {
  let restored = true;
  for (const change of changes.reverse()) {
    try {
      if (change.reopen) {
        await sdk.ownListings.open({ id: change.id });
      } else {
        await sdk.ownListings.close({ id: change.id });
      }
      await sdk.ownListings.update({
        id: change.id,
        publicData: restoredPublicData(change.publicData),
      });
    } catch {
      restored = false;
    }
  }
  return restored;
};

/**
 * POST /api/cc/listings/away
 * Body: { away: true|false }
 * Away mode closes all of the seller's published listings, or reopens ones paused by away mode.
 * The profile flag is written only after every listing change succeeds. A failure rolls those
 * changes back and leaves the flag untouched, so the toggle cannot say away mode is on while
 * listings are still public.
 */
exports.setAwayMode = async (req, res) => {
  if (!sharetribeConfigured()) {
    throw httpError(503, 'sharetribe-not-configured', 'Sharetribe keys are not set in .env yet.');
  }

  const { sdk, user } = await requireUser(req, res);
  const away = Boolean(req.body?.away);
  const profile = user.attributes.profile || {};
  const undo = [];

  try {
    const listings = await ownListingsInStates(sdk, away ? ['published'] : ['closed']);

    for (const listing of listings) {
      const publicData = listing.attributes.publicData || {};
      if (away) {
        await sdk.ownListings.close({ id: listing.id });
        undo.push({ id: listing.id, publicData, reopen: true });
        await sdk.ownListings.update({
          id: listing.id,
          publicData: { ...publicData, awayPaused: true },
        });
      } else if (publicData.awayPaused && !publicData.removed) {
        await sdk.ownListings.open({ id: listing.id });
        undo.push({ id: listing.id, publicData, reopen: false });
        await sdk.ownListings.update({
          id: listing.id,
          publicData: { ...publicData, awayPaused: false },
        });
      }
    }

    await sdk.currentUser.updateProfile({
      privateData: { ...(profile.privateData || {}), awayMode: away },
    });
  } catch (e) {
    const restored = undo.length === 0 || (await restoreAwayChanges(sdk, undo));
    if (e.code && Number.isInteger(e.status) && restored) throw e;
    const failure = httpError(
      502,
      'away-mode-failed',
      restored
        ? 'Could not update away mode. Your listings were left as they were.'
        : 'Away mode did not finish. Check your listings and try again.'
    );
    failure.cause = e;
    throw failure;
  }

  res.json({ awayMode: away });
};
