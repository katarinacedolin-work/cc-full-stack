/**
 * Maps a Sharetribe listing (with included author and images) into the Campus Connect listing
 * shape that web/shared/api.js and the views already use.
 */

const { types } = require('sharetribe-flex-sdk');
const { Money } = types;

const MONEY_DIVISOR = 100; // USD cents

const statusFromSharetribe = state => {
  if (state === 'published') return 'active';
  if (state === 'closed') return 'closed';
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
    accent: publicData.accent || 'cobalt',
    emoji: publicData.emoji || (publicData.kind === 'service' ? '✨' : '📦'),
    meeting: publicData.meeting || '',
    availability: publicData.availability || '',
    merchandiseType: publicData.merchandiseType || null,
    condition: publicData.condition || null,
    quantityAvailable:
      publicData.quantityAvailable != null ? Number(publicData.quantityAvailable) : null,
    certification: publicData.certification || null,
    collection: publicData.collection || null,
    tag: publicData.tag || null,
    images,
    photo: images[0] || null,
    listingType: attrs.publicData?.listingType || publicData.listingType || null,
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
    unit: fields.unit || (kind === 'service' ? fields.duration || 'hour' : 'each'),
    accent: fields.accent || (kind === 'service' ? 'lilac' : 'butter'),
    emoji: fields.emoji || (kind === 'service' ? '✨' : '📦'),
    meeting: fields.meeting || '',
    availability: fields.availability || '',
    storeId: fields.storeId || null,
    collection: fields.collection || null,
    listingType: fields.listingType || kind,
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
