/**
 * Maps a post in Postgres into the shapes the board pages use.
 */

const { accentFor, initialsOf } = require('../people');

// The colors a board card comes in.
const CARD_ACCENTS = ['coral', 'butter', 'sky', 'mint', 'lilac'];

const cardAccent = id => CARD_ACCENTS[Number(id) % CARD_ACCENTS.length] || CARD_ACCENTS[0];

const ticketPrice = price => {
  const amount = Number(price);
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
};

/**
 * What a conversation about a post is called in both people's inboxes.
 *
 * @param {Object} row board_posts row
 * @returns {string}
 */
exports.contextTitleOf = row => {
  if (row.kind !== 'ticket') return row.title;
  return row.details.ticketKind === 'resell'
    ? `${row.title} ticket · $${ticketPrice(row.details.price)}`
    : `Ticket wanted · ${row.title}`;
};

const person = (row, viewerId) => ({
  poster: row.author_name || 'Student',
  posterId: row.author_id,
  initials: initialsOf(row.author_name),
  mine: row.author_id === viewerId,
  postedAt: new Date(row.created_at).toISOString(),
});

const toJob = (row, viewerId) => {
  const { where, schedule, pay } = row.details;
  return {
    id: String(row.id),
    title: row.title,
    kicker: where,
    meta: schedule,
    price: pay,
    accent: cardAccent(row.id),
    emoji: '📌',
    summary: row.summary,
    facts: [['Schedule', schedule], ['Where', where], ['Pay', pay]],
    ...person(row, viewerId),
  };
};

const toHousing = (row, viewerId) => {
  const { place, dates, rent } = row.details;
  return {
    id: String(row.id),
    title: row.title,
    kicker: place,
    meta: dates,
    price: rent,
    accent: cardAccent(row.id),
    emoji: '🏠',
    summary: row.summary,
    facts: [['Dates', dates], ['Rent', rent], ['Place', place]],
    ...person(row, viewerId),
  };
};

const toTicketPost = (row, viewerId) => {
  const resell = row.details.ticketKind === 'resell';
  return {
    id: String(row.id),
    kind: resell ? 'resell' : 'request',
    event: row.title,
    ...(resell ? { price: ticketPrice(row.details.price) } : {}),
    name: row.author_name || 'Student',
    posterId: row.author_id,
    initials: initialsOf(row.author_name),
    accent: accentFor(row.author_id),
    mine: row.author_id === viewerId,
    postedAt: new Date(row.created_at).toISOString(),
  };
};

const MAPPERS = { job: toJob, housing: toHousing, ticket: toTicketPost };

/**
 * @param {Object} row board_posts row
 * @param {string} viewerId who is looking, so their own posts are marked
 * @returns {Object} a job or housing card, or a line in the ticket chat
 */
exports.toPost = (row, viewerId) => MAPPERS[row.kind](row, viewerId);
