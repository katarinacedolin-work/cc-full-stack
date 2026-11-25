/**
 * The rules for selling tickets.
 *
 * Only the host of an event sells tickets to it. Stripe holds a payment for at most 90 days
 * before it has to be paid out, so tickets go on sale at most 80 days before the event.
 */

const SALE_WINDOW_DAYS = 80;
// A ticket that was never scanned still pays the seller this long after the event starts.
const NO_SHOW_HOURS = 6;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Checks the event details of a ticket listing.
 *
 * @param {Object} publicData the listing's public data
 * @param {Date} [now]
 * @returns {{ code: string, message: string }|null} what is wrong, or null when it can be sold
 */
exports.eventProblem = (publicData = {}, now = new Date()) => {
  const startsAt = publicData.eventStartsAt ? new Date(publicData.eventStartsAt) : null;
  if (!startsAt || Number.isNaN(startsAt.getTime())) {
    return { code: 'event-time-required', message: 'Add the date and time of the event.' };
  }
  if (startsAt.getTime() <= now.getTime()) {
    return { code: 'event-started', message: 'This event has already started.' };
  }
  if (startsAt.getTime() - now.getTime() > SALE_WINDOW_DAYS * DAY_MS) {
    return {
      code: 'event-too-far',
      message: `Tickets can go on sale up to ${SALE_WINDOW_DAYS} days before the event.`,
    };
  }
  if (!String(publicData.venue || '').trim()) {
    return { code: 'venue-required', message: 'Add where the event is.' };
  }
  if (!publicData.hostConfirmed) {
    return {
      code: 'host-required',
      message: 'Only the host of an event can sell tickets to it. Confirm that you are hosting.',
    };
  }
  return null;
};

exports.SALE_WINDOW_DAYS = SALE_WINDOW_DAYS;
exports.NO_SHOW_HOURS = NO_SHOW_HOURS;
