/**
 * Maps a Sharetribe listing (with included author and images) into the Campus Connect listing
 * shape that web/shared/api.js and the views already use.
 */

const { types } = require('sharetribe-flex-sdk');
const { Money } = types;

const MONEY_DIVISOR = 100; // USD cents

// Which Sharetribe transaction process each kind of listing is sold through.
const PROCESS_ALIAS = {
  product: 'default-purchase/release-1',
  service: 'default-booking/release-1',
  ticket: 'cc-ticket/release-1',
};

// The unit the line items are priced in (see server/api-util/lineItems.js). A service's price
// is for one whole session, so its unit is 'fixed' rather than 'hour'.
const UNIT_TYPE = { product: 'item', service: 'fixed', ticket: 'item' };

const TIMEZONE = 'America/Los_Angeles';

// Cover colors the Campus Connect CSS actually styles. Anything else is a class-attribute breakout.
const ACCENTS = ['coral', 'lilac', 'butter', 'sky', 'mint', 'cobalt'];

// A cover emoji is a short run of symbols. ASCII can spell a tag, a quote, or an
// event handler, so letters, spaces, and markup are all rejected.
const EMOJI_MAX = 16;

const isEmoji = value => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > EMOJI_MAX) return false;
  for (const char of text) {
    if (char.codePointAt(0) < 0x80) return false;
  }
  return true;
};

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string} an allowlisted accent class
 */
const accentOf = (value, fallback) =>
  ACCENTS.includes(value) ? value : ACCENTS.includes(fallback) ? fallback : 'butter';

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string} a cover emoji that cannot be interpreted as HTML
 */
const emojiOf = (value, fallback) => {
  if (isEmoji(value)) return value.trim();
  if (isEmoji(fallback)) return fallback.trim();
  return '✦';
};

/**
 * Non-negative whole quantity. Zero means sold out and is kept.
 * A missing or non-numeric value uses `fallback` (1 when a new listing omits stock).
 *
 * @param {*} value
 * @param {number} [fallback=0]
 * @returns {number}
 */
const wholeQuantity = (value, fallback = 0) => {
  if (value == null || value === '') return fallback;
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
};

/**
 * A plan that leaves every hour of the week open. Service listings get it when they are
 * created, so they can be booked before the seller has set weekly hours.
 *
 * @returns {Object} Sharetribe availability plan
 */
exports.openAvailabilityPlan = () => ({
  type: 'availability-plan/time',
  timezone: TIMEZONE,
  entries: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(dayOfWeek => ({
    dayOfWeek,
    startTime: '00:00',
    endTime: '00:00',
    seats: 1,
  })),
});

const stockFrom = (listing, included = []) => {
  const ref = listing.relationships?.currentStock?.data;
  if (!ref) return null;
  const stock = included.find(
    entity => entity.type === 'stock' && entity.id?.uuid === ref.id?.uuid
  );
  return stock ? Number(stock.attributes?.quantity) : null;
};

/**
 * Seller Hub pause and away mode both close the Sharetribe listing. Sharetribe has no
 * paused state, and the hub's tabs, labels, and pause toggle all read `paused`.
 *
 * @param {string} state Sharetribe listing state
 * @returns {string} Campus Connect status
 */
const statusFromSharetribe = state => {
  if (state === 'published') return 'active';
  if (state === 'closed') return 'paused';
  if (state === 'draft' || state === 'pendingApproval') return 'draft';
  return state || 'draft';
};

/** A deleted listing is closed on Sharetribe and flagged so it is not shown as paused. */
const isRemovedListing = listing => Boolean(listing?.attributes?.publicData?.removed);

const authorFrom = (listing, included = []) => {
  const authorRef = listing.relationships?.author?.data;
  if (!authorRef) return null;
  return (
    included.find(
      entity => entity.type === authorRef.type && entity.id?.uuid === authorRef.id?.uuid
    ) || null
  );
};

const imageEntity = (ref, included) =>
  included.find(entity => entity.type === ref.type && entity.id?.uuid === ref.id?.uuid);

const imagesFrom = (listing, included = []) => {
  const refs = listing.relationships?.images?.data || [];
  return refs
    .map(ref => imageEntity(ref, included))
    .filter(Boolean)
    .map(image => {
      const variants = image.attributes?.variants || {};
      const preferred =
        variants['listing-card'] ||
        variants['landscape-crop'] ||
        variants['scaled-medium'] ||
        Object.values(variants)[0];
      return preferred?.url || null;
    })
    .filter(Boolean);
};

// Largest first. A duplicate has to re-upload bytes, and the card crop is too small for that.
const IMAGE_SOURCE_VARIANTS = [
  'scaled-xlarge',
  'scaled-large',
  'default',
  'scaled-medium',
  'listing-card',
  'landscape-crop',
];

const httpsUrl = value =>
  typeof value === 'string' && value.startsWith('https://') ? value : null;

/**
 * HTTPS URLs for each listing image, in listing order. Null when that photo has no usable URL.
 * An image id can belong to only one listing, so a copy downloads these and uploads them again.
 *
 * @param {Object} listing Sharetribe listing resource
 * @param {Array<Object>} [included]
 * @returns {Array<string|null>}
 */
exports.listingImageSourceUrls = (listing, included = []) => {
  const refs = listing.relationships?.images?.data || [];
  return refs.map(ref => {
    const variants = imageEntity(ref, included)?.attributes?.variants || {};
    for (const name of IMAGE_SOURCE_VARIANTS) {
      const url = httpsUrl(variants[name]?.url);
      if (url) return url;
    }
    const ranked = Object.values(variants)
      .filter(variant => httpsUrl(variant?.url))
      .sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0));
    return httpsUrl(ranked[0]?.url);
  });
};

const initialsOf = name =>
  String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() || '')
    .join('') || '?';

/**
 * @param {Object} listing Sharetribe listing resource
 * @param {Array<Object>} [included] included author/images from the same response
 * @returns {Object} Campus Connect listing
 */
exports.toCampusListing = (listing, included = []) => {
  const attrs = listing.attributes || {};
  const publicData = attrs.publicData || {};
  const author = authorFrom(listing, included);
  const profile = author?.attributes?.profile || {};
  const sellerName =
    profile.displayName ||
    [profile.firstName, profile.lastName].filter(Boolean).join(' ') ||
    'Student';
  const priceAmount = attrs.price?.amount;
  const price =
    typeof priceAmount === 'number' ? priceAmount / MONEY_DIVISOR : Number(publicData.price) || 0;
  const images = imagesFrom(listing, included);
  // Sharetribe's stock count goes down as people buy, so it wins over the number the seller typed.
  const stock = stockFrom(listing, included);

  return {
    id: listing.id.uuid,
    kind: publicData.kind || 'product',
    category: publicData.category || 'Other',
    title: attrs.title || '',
    description: attrs.description || '',
    price,
    unit: publicData.unit || (publicData.kind === 'service' ? 'hour' : 'each'),
    seller: sellerName,
    initials: initialsOf(sellerName),
    sellerId: author?.id?.uuid || '',
    storeId: publicData.storeId || null,
    rating: publicData.rating != null ? String(publicData.rating) : 'New',
    reviews: Number(publicData.reviews) || 0,
    completed: Number(publicData.completed) || 0,
    campus: 'SDSU',
    verified: true,
    status: statusFromSharetribe(attrs.state),
    ...(publicData.awayPaused ? { awayPaused: true } : {}),
    accent: accentOf(publicData.accent, 'cobalt'),
    emoji: emojiOf(publicData.emoji, publicData.kind === 'service' ? '✨' : '📦'),
    meeting: publicData.meeting || '',
    availability: publicData.availability || '',
    merchandiseType: publicData.merchandiseType || null,
    condition: publicData.condition || null,
    quantityAvailable:
      stock != null
        ? stock
        : publicData.quantityAvailable != null
        ? Number(publicData.quantityAvailable)
        : null,
    certification: publicData.certification || null,
    collection: publicData.collection || null,
    tag: publicData.tag || null,
    images,
    photo: images[0] || null,
    listingType: attrs.publicData?.listingType || publicData.listingType || null,
    ...(publicData.kind === 'ticket'
      ? {
          eventStartsAt: publicData.eventStartsAt || null,
          venue: publicData.venue || '',
          hostConfirmed: Boolean(publicData.hostConfirmed),
        }
      : {}),
  };
};

/**
 * Store id that may be written onto a listing. Only an id in `ownedStoreIds`
 * (the signed-in seller's stores) is kept. Anything else, including a missing
 * allow-list, becomes null so publicData cannot point at someone else's shop.
 *
 * @param {string|null|undefined} storeId
 * @param {Array<string>|undefined} ownedStoreIds
 * @returns {string|null}
 */
const publicStoreId = (storeId, ownedStoreIds) => {
  if (storeId == null || storeId === '' || !Array.isArray(ownedStoreIds)) return null;
  const id = String(storeId);
  return ownedStoreIds.includes(id) ? id : null;
};

/**
 * Builds the Sharetribe ownListings create/update payload from a Campus Connect form.
 *
 * @param {Object} fields Campus Connect listing fields
 * @param {Object} [options]
 * @param {string} [options.currency]
 * @param {Array<string>} [options.ownedStoreIds] stores on the signed-in seller's profile
 * @returns {Object} Sharetribe listing attributes
 */
exports.toSharetribeAttrs = (fields, { currency = 'USD', ownedStoreIds } = {}) => {
  const kind =
    fields.kind === 'service' ? 'service' : fields.kind === 'ticket' ? 'ticket' : 'product';
  const price = Number(fields.price);
  const publicData = {
    kind,
    category: fields.category || 'Other',
    unit: fields.unit || (kind === 'service' ? fields.duration || 'hour' : 'each'),
    accent: accentOf(fields.accent, kind === 'service' ? 'lilac' : 'butter'),
    emoji: emojiOf(fields.emoji, kind === 'service' ? '✨' : '📦'),
    meeting: fields.meeting || '',
    availability: fields.availability || '',
    storeId: publicStoreId(fields.storeId, ownedStoreIds),
    collection: fields.collection || null,
    listingType: fields.listingType || kind,
    transactionProcessAlias: PROCESS_ALIAS[kind],
    unitType: UNIT_TYPE[kind],
  };

  if (kind === 'product') {
    publicData.merchandiseType = fields.merchandiseType || 'resale';
    publicData.condition = fields.condition || 'Good condition';
    // || would treat 0 as missing and save a sold-out product as still in stock.
    publicData.quantityAvailable = wholeQuantity(fields.quantityAvailable ?? fields.quantity, 1);
  }
  if (kind === 'service') {
    publicData.certification = fields.certification || null;
    publicData.duration = fields.duration || fields.unit || 'hour';
  }
  if (kind === 'ticket') {
    publicData.eventStartsAt = fields.eventStartsAt || null;
    publicData.venue = fields.venue || '';
    publicData.hostConfirmed = Boolean(fields.hostConfirmed);
  }

  const attrs = {
    title: String(fields.title || '').trim(),
    description: String(fields.description || '').trim(),
    publicData,
  };

  if (Number.isFinite(price) && price > 0) {
    attrs.price = new Money(Math.round(price * MONEY_DIVISOR), currency);
  }

  return attrs;
};

exports.accentOf = accentOf;
exports.emojiOf = emojiOf;
exports.wholeQuantity = wholeQuantity;
exports.PROCESS_ALIAS = PROCESS_ALIAS;
exports.UNIT_TYPE = UNIT_TYPE;
exports.TIMEZONE = TIMEZONE;
exports.isRemovedListing = isRemovedListing;
