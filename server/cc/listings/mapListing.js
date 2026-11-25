/**
 * Maps a Sharetribe listing (with included author and images) into the Campus Connect listing
 * shape that web/shared/api.js and the views already use.
 */

const { types } = require('sharetribe-flex-sdk');
const { TIMEZONE, toSlot, toDayLabel } = require('../time');

const { Money } = types;

const MONEY_DIVISOR = 100; // USD cents

const DEFAULT_ACCENT = { product: 'butter', service: 'lilac', ticket: 'coral' };
const DEFAULT_EMOJI = { product: '📦', service: '✨', ticket: '🎟️' };

// Which Sharetribe transaction process each kind of listing is sold through.
const PROCESS_ALIAS = {
  product: 'default-purchase/release-1',
  service: 'default-booking/release-1',
  ticket: 'cc-ticket/release-1',
};

// The unit the line items are priced in (see server/api-util/lineItems.js). A service's price
// is for one whole session, so its unit is 'fixed' rather than 'hour'.
const UNIT_TYPE = { product: 'item', service: 'fixed', ticket: 'item' };

// What the pages show for a ticket listing: who hosts the event, when and where.
const eventFields = publicData => {
  const startsAt = publicData.eventStartsAt || null;
  const slot = startsAt ? toSlot(startsAt) : null;
  const date = startsAt ? toDayLabel(startsAt) : '';
  const time = slot ? slot.time : '';
  const venue = publicData.venue || '';
  return {
    eventStartsAt: startsAt,
    // The date and clock in the form the event form's inputs take.
    eventDate: slot ? slot.date : '',
    host: publicData.host || '',
    date,
    time,
    location: venue,
    venue,
    hostConfirmed: Boolean(publicData.hostConfirmed),
    availability: [date, time].filter(Boolean).join(' · '),
    meeting: venue,
  };
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

const statusFromSharetribe = state => {
  if (state === 'published') return 'active';
  // The pages call a listing that is closed to buyers "paused".
  if (state === 'closed') return 'paused';
  if (state === 'draft' || state === 'pendingApproval') return 'draft';
  return state || 'draft';
};

const authorFrom = (listing, included = []) => {
  const authorRef = listing.relationships?.author?.data;
  if (!authorRef) return null;
  return (
    included.find(
      entity => entity.type === authorRef.type && entity.id?.uuid === authorRef.id?.uuid
    ) || null
  );
};

const imagesFrom = (listing, included = []) => {
  const refs = listing.relationships?.images?.data || [];
  return refs
    .map(ref =>
      included.find(entity => entity.type === ref.type && entity.id?.uuid === ref.id?.uuid)
    )
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
    unit:
      publicData.unit ||
      (publicData.kind === 'service' ? 'hour' : publicData.kind === 'ticket' ? 'ticket' : 'each'),
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
    accent: publicData.accent || 'cobalt',
    emoji: publicData.emoji || DEFAULT_EMOJI[publicData.kind] || DEFAULT_EMOJI.product,
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
    ...(publicData.kind === 'ticket' ? eventFields(publicData) : {}),
  };
};

/**
 * Builds the Sharetribe ownListings create/update payload from a Campus Connect form.
 *
 * @param {Object} fields Campus Connect listing fields
 * @param {Object} [options]
 * @param {string} [options.currency]
 * @returns {Object} Sharetribe listing attributes
 */
exports.toSharetribeAttrs = (fields, { currency = 'USD' } = {}) => {
  const kind =
    fields.kind === 'service' ? 'service' : fields.kind === 'ticket' ? 'ticket' : 'product';
  const price = Number(fields.price);
  const publicData = {
    kind,
    category: fields.category || 'Other',
    unit:
      fields.unit ||
      (kind === 'service' ? fields.duration || 'hour' : kind === 'ticket' ? 'ticket' : 'each'),
    accent: fields.accent || DEFAULT_ACCENT[kind],
    emoji: fields.emoji || DEFAULT_EMOJI[kind],
    // For a ticket these two are worked out from the event's time and place when it is read.
    meeting: kind === 'ticket' ? '' : fields.meeting || '',
    availability: kind === 'ticket' ? '' : fields.availability || '',
    storeId: fields.storeId || null,
    collection: fields.collection || null,
    listingType: fields.listingType || kind,
    transactionProcessAlias: PROCESS_ALIAS[kind],
    unitType: UNIT_TYPE[kind],
  };

  if (kind === 'product') {
    publicData.merchandiseType = fields.merchandiseType || 'resale';
    publicData.condition = fields.condition || 'Good condition';
    publicData.quantityAvailable = Math.max(
      0,
      Math.floor(Number(fields.quantityAvailable ?? fields.quantity)) || 1
    );
  }
  if (kind === 'service') {
    publicData.certification = fields.certification || null;
    publicData.duration = fields.duration || fields.unit || 'hour';
  }
  if (kind === 'ticket') {
    publicData.category = 'Events';
    publicData.eventStartsAt = fields.eventStartsAt || null;
    publicData.venue = String(fields.venue || '').trim();
    publicData.host = String(fields.host || '').trim();
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

exports.PROCESS_ALIAS = PROCESS_ALIAS;
exports.UNIT_TYPE = UNIT_TYPE;
exports.TIMEZONE = TIMEZONE;
