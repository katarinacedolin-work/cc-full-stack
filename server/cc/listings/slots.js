/**
 * Turns Sharetribe time slots into the { date, time } openings the booking calendar already uses.
 * Times are in America/Los_Angeles, matching the availability plan on new service listings.
 */

const { TIMEZONE } = require('./mapListing');

const BOOKING_WINDOW_DAYS = 60;
const SLOT_STEP_MINUTES = 30;

/**
 * How long a service runs, from its unit ("45 min", "2 hours", "hour"). Defaults to an hour.
 *
 * @param {string} unit
 * @returns {number} minutes
 */
const durationFromUnit = unit => {
  const text = String(unit || '').toLowerCase();
  const hours = text.match(/(\d+(?:\.\d+)?)\s*(hour|hr)/);
  if (hours) return Math.round(Number(hours[1]) * 60);
  const minutes = text.match(/(\d+)\s*min/);
  return minutes ? Number(minutes[1]) : 60;
};

const zonedParts = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = type => parts.find(part => part.type === type)?.value;
  let hour = Number(value('hour'));
  if (hour === 24) hour = 0;
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    minutes: hour * 60 + Number(value('minute')),
  };
};

/** "4:00 PM" from minutes after midnight. */
const clockLabel = minutes => {
  const hour24 = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour = hour24 % 12 || 12;
  return `${hour}:${String(minute).padStart(2, '0')} ${suffix}`;
};

const clockMinutes = label => {
  const match = String(label).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return 0;
  return (
    (Number(match[1]) % 12) * 60 + Number(match[2]) + (match[3].toUpperCase() === 'PM' ? 720 : 0)
  );
};

/**
 * Next local step boundary at or after `ms`. Seconds are rounded up to the following step.
 *
 * @param {number} ms
 * @param {number} stepMinutes
 * @param {string} timeZone
 * @returns {number}
 */
const ceilToLocalStep = (ms, stepMinutes, timeZone) => {
  const date = new Date(ms);
  const floored = ms - date.getUTCSeconds() * 1000 - date.getUTCMilliseconds();
  const { minutes } = zonedParts(new Date(floored), timeZone);
  const remainder = minutes % stepMinutes;
  if (remainder === 0 && floored === ms) return ms;
  const bump = (remainder === 0 ? stepMinutes : stepMinutes - remainder) * 60 * 1000;
  return floored + bump;
};

/**
 * Bookable starts inside each open window. A start is kept when the whole session fits
 * before the window ends and it is still in the future.
 *
 * @param {Array<{start: Date|string|number, end: Date|string|number}>} windows
 * @param {Object} [options]
 * @param {number} options.durationMinutes
 * @param {number} [options.stepMinutes]
 * @param {Date} [options.now]
 * @param {string} [options.timeZone]
 * @returns {Array<{date: string, time: string}>}
 */
const slotsFromWindows = (windows, options = {}) => {
  const durationMinutes = options.durationMinutes;
  const stepMinutes = options.stepMinutes || SLOT_STEP_MINUTES;
  const timeZone = options.timeZone || TIMEZONE;
  const nowMs = (options.now || new Date()).getTime();
  if (!(durationMinutes > 0) || !(stepMinutes > 0)) return [];

  const durationMs = durationMinutes * 60 * 1000;
  const stepMs = stepMinutes * 60 * 1000;
  const seen = new Set();
  const slots = [];

  (windows || []).forEach(window => {
    const startMs = new Date(window.start).getTime();
    const endMs = new Date(window.end).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;

    let cursor = ceilToLocalStep(Math.max(startMs, nowMs + 1), stepMinutes, timeZone);
    if (cursor < startMs) cursor = ceilToLocalStep(startMs, stepMinutes, timeZone);

    while (cursor + durationMs <= endMs) {
      const { date, minutes } = zonedParts(new Date(cursor), timeZone);
      const time = clockLabel(minutes);
      const key = `${date}|${time}`;
      if (!seen.has(key)) {
        seen.add(key);
        slots.push({ date, time });
      }
      cursor += stepMs;
    }
  });

  slots.sort((a, b) => a.date.localeCompare(b.date) || clockMinutes(a.time) - clockMinutes(b.time));
  return slots;
};

const seatsOf = slot => {
  const seats = slot?.attributes?.seats ?? slot?.seats;
  return seats == null ? 1 : Number(seats);
};

/**
 * @param {Object} listing Campus Connect listing
 * @param {Array<Object>} timeslots Sharetribe timeSlot resources, or { start, end, seats }
 * @param {Date} [now]
 * @returns {{ duration: number|null, slots: Array<{date: string, time: string}> }}
 */
const availabilityFor = (listing, timeslots, now = new Date()) => {
  if (!listing || listing.kind !== 'service') return { duration: null, slots: [] };
  const duration = durationFromUnit(listing.unit);
  const windows = (timeslots || [])
    .filter(slot => seatsOf(slot) > 0)
    .map(slot => ({
      start: slot.attributes?.start ?? slot.start,
      end: slot.attributes?.end ?? slot.end,
    }));
  return {
    duration,
    slots: slotsFromWindows(windows, { durationMinutes: duration, now }),
  };
};

module.exports = {
  BOOKING_WINDOW_DAYS,
  SLOT_STEP_MINUTES,
  durationFromUnit,
  slotsFromWindows,
  availabilityFor,
};
