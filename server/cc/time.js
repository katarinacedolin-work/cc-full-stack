/**
 * Campus time. Booking slots, event times and daily totals are all in America/Los_Angeles,
 * whatever time zone the server runs in.
 */

const TIMEZONE = 'America/Los_Angeles';

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const campusParts = date => {
  const parts = {};
  partsFormatter.formatToParts(date).forEach(({ type, value }) => {
    parts[type] = Number(value);
  });
  return parts;
};

// How far campus time is ahead of UTC at that moment, in milliseconds (negative in California).
const offsetAt = date => {
  const p = campusParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
};

/**
 * @param {number} year
 * @param {number} month 1 to 12
 * @param {number} day
 * @param {number} [hour] 0 to 23
 * @param {number} [minute]
 * @returns {Date} the moment the campus clock shows that date and time
 */
const fromCampusTime = (year, month, day, hour = 0, minute = 0) => {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const guess = wall - offsetAt(new Date(wall));
  // The second pass settles the hours around a daylight saving change.
  return new Date(wall - offsetAt(new Date(guess)));
};

/**
 * @param {string} dateKey 'YYYY-MM-DD'
 * @param {string} clock '4:00 PM' or '16:00'
 * @returns {Date|null} that campus date and time, or null when either part can't be read
 */
exports.parseSlot = (dateKey, clock) => {
  const date = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const time = String(clock || '')
    .trim()
    .match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!date || !time) return null;

  let hour = Number(time[1]);
  const minute = Number(time[2]);
  const meridiem = (time[3] || '').toUpperCase();
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;

  return fromCampusTime(Number(date[1]), Number(date[2]), Number(date[3]), hour, minute);
};

const pad = number => String(number).padStart(2, '0');

/**
 * @param {Date|string} value
 * @returns {{ date: string, time: string }} the campus date ('YYYY-MM-DD') and clock ('4:00 PM')
 */
exports.toSlot = value => {
  const p = campusParts(new Date(value));
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${hour12}:${pad(p.minute)} ${p.hour < 12 ? 'AM' : 'PM'}`,
  };
};

const dayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

/**
 * @param {Date|string} value
 * @returns {string} the campus day, such as 'Sat, Nov 28'
 */
exports.toDayLabel = value => dayFormatter.format(new Date(value));

/**
 * @param {Date|string} [value] defaults to now
 * @returns {string} the campus date, 'YYYY-MM-DD'
 */
exports.campusDateKey = (value = new Date()) => exports.toSlot(value).date;

/**
 * How long one session of a service lasts. Sellers type it as text, such as "45 min".
 *
 * @param {Object} publicData the listing's public data
 * @returns {number} minutes, 60 when the text can't be read
 */
exports.durationMinutes = (publicData = {}) => {
  if (Number(publicData.durationMinutes) > 0) return Number(publicData.durationMinutes);
  const text = `${publicData.duration || ''} ${publicData.unit || ''}`.toLowerCase();
  const minutes = text.match(/(\d+)\s*min/);
  if (minutes) return Number(minutes[1]);
  const hours = text.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hour)/);
  if (hours) return Math.round(Number(hours[1]) * 60);
  return 60;
};

exports.fromCampusTime = fromCampusTime;
exports.TIMEZONE = TIMEZONE;
