/**
 * What a post on a board has to contain, by kind.
 */

const { httpError } = require('../auth/httpError');

const MAX_TICKET_PRICE = 10000;

// The fields of each form, with the longest answer each one takes. The pages use the same
// limits on their inputs.
const FIELDS = {
  job: { title: 60, where: 60, schedule: 60, pay: 24, summary: 240 },
  housing: { title: 60, place: 60, dates: 60, rent: 24, summary: 240 },
};

const INCOMPLETE = {
  job: 'Fill in the title, where, schedule, pay, and description.',
  housing: 'Fill in the place, neighborhood, dates, rent, and details.',
};

// How long a post stays on its board.
const DAYS_ON_BOARD = { job: 60, housing: 60, ticket: 30 };

const text = value =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const incomplete = message => httpError(400, 'post-incomplete', message);

const readForm = (kind, body) => {
  const answers = {};
  for (const [field, max] of Object.entries(FIELDS[kind])) {
    const value = text(body[field]);
    if (!value) throw incomplete(INCOMPLETE[kind]);
    if (value.length > max) {
      throw httpError(400, 'post-too-long', `Keep each answer short: ${field} is too long.`);
    }
    answers[field] = value;
  }
  const { title, summary, ...details } = answers;
  return { title, summary, details };
};

const readTicket = body => {
  const ticketKind = body.ticketKind === 'resell' ? 'resell' : 'request';
  const event = text(body.event);
  if (!event)
    throw incomplete(ticketKind === 'resell' ? 'Add the event and a price.' : 'Add the event.');
  if (event.length > 60) throw httpError(400, 'post-too-long', 'Keep the event name short.');
  if (ticketKind === 'request') return { title: event, summary: '', details: { ticketKind } };

  const amount = Number(String(body.price ?? '').replace(/[^0-9.]/g, ''));
  if (!(amount > 0)) throw incomplete('Add the event and a price.');
  if (amount > MAX_TICKET_PRICE) throw httpError(400, 'price-too-high', 'That price is too high.');
  return {
    title: event,
    summary: '',
    details: { ticketKind, price: Math.round(amount * 100) / 100 },
  };
};

/**
 * Checks what someone typed into a post form.
 *
 * @param {Object} body the request body: kind plus that form's fields
 * @returns {{ kind: string, title: string, summary: string, details: Object, days: number }}
 * @throws a 400 that says what is missing
 */
exports.readPost = (body = {}) => {
  const kind = body.kind;
  if (!Object.prototype.hasOwnProperty.call(DAYS_ON_BOARD, kind)) {
    throw httpError(400, 'unknown-board', 'That board does not exist.');
  }
  const post = kind === 'ticket' ? readTicket(body) : readForm(kind, body);
  return { kind, ...post, days: DAYS_ON_BOARD[kind] };
};

exports.isBoard = kind => Object.prototype.hasOwnProperty.call(DAYS_ON_BOARD, kind);
exports.DAYS_ON_BOARD = DAYS_ON_BOARD;
