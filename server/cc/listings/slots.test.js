const { durationFromUnit, slotsFromWindows, availabilityFor } = require('./slots');

const at = iso => new Date(iso);

describe('durationFromUnit', () => {
  it('reads minutes, hours, and the bare hour default', () => {
    expect(durationFromUnit('45 min')).toBe(45);
    expect(durationFromUnit('2 hours')).toBe(120);
    expect(durationFromUnit('hour')).toBe(60);
    expect(durationFromUnit('per person · 2 hr')).toBe(120);
  });
});

describe('slotsFromWindows', () => {
  const now = at('2026-11-28T17:00:00.000Z'); // 9:00 AM Pacific

  it('slices an open window into session starts that fit', () => {
    // 10:00 AM–2:00 PM Pacific on the same day.
    const slots = slotsFromWindows(
      [{ start: at('2026-11-28T18:00:00.000Z'), end: at('2026-11-28T22:00:00.000Z') }],
      { durationMinutes: 60, now }
    );
    expect(slots).toEqual([
      { date: '2026-11-28', time: '10:00 AM' },
      { date: '2026-11-28', time: '10:30 AM' },
      { date: '2026-11-28', time: '11:00 AM' },
      { date: '2026-11-28', time: '11:30 AM' },
      { date: '2026-11-28', time: '12:00 PM' },
      { date: '2026-11-28', time: '12:30 PM' },
      { date: '2026-11-28', time: '1:00 PM' },
    ]);
  });

  it('drops times that already started and keeps the next step', () => {
    const slots = slotsFromWindows(
      [{ start: at('2026-11-28T18:00:00.000Z'), end: at('2026-11-28T22:00:00.000Z') }],
      { durationMinutes: 60, now: at('2026-11-28T19:15:00.000Z') }
    );
    expect(slots.map(slot => slot.time)).toEqual(['11:30 AM', '12:00 PM', '12:30 PM', '1:00 PM']);
  });

  it('splits a window that crosses midnight onto two dates', () => {
    const slots = slotsFromWindows(
      [{ start: at('2026-11-29T07:00:00.000Z'), end: at('2026-11-29T09:00:00.000Z') }],
      { durationMinutes: 60, now }
    );
    expect(slots).toEqual([
      { date: '2026-11-28', time: '11:00 PM' },
      { date: '2026-11-28', time: '11:30 PM' },
      { date: '2026-11-29', time: '12:00 AM' },
    ]);
  });
});

describe('availabilityFor', () => {
  const now = at('2026-11-28T17:00:00.000Z');

  it('ignores a full time slot and anything that is not a service', () => {
    const timeslots = [
      {
        attributes: {
          seats: 0,
          start: at('2026-11-28T18:00:00.000Z'),
          end: at('2026-11-28T20:00:00.000Z'),
        },
      },
      {
        attributes: {
          seats: 1,
          start: at('2026-11-28T20:00:00.000Z'),
          end: at('2026-11-28T21:00:00.000Z'),
        },
      },
    ];
    expect(availabilityFor({ kind: 'product', unit: 'each' }, timeslots, now)).toEqual({
      duration: null,
      slots: [],
    });
    expect(availabilityFor({ kind: 'service', unit: 'hour' }, timeslots, now).slots).toEqual([
      { date: '2026-11-28', time: '12:00 PM' },
    ]);
  });
});
