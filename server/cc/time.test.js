const { parseSlot, toSlot, durationMinutes, fromCampusTime } = require('./time');

describe('parseSlot', () => {
  it('reads a campus date and clock in standard time', () => {
    // 4:00 PM PST is midnight UTC.
    expect(parseSlot('2026-12-01', '4:00 PM').toISOString()).toBe('2026-12-02T00:00:00.000Z');
  });

  it('reads a campus date and clock in daylight time', () => {
    // 9:30 AM PDT is 16:30 UTC.
    expect(parseSlot('2026-07-04', '9:30 AM').toISOString()).toBe('2026-07-04T16:30:00.000Z');
  });

  it('reads noon, midnight and 24-hour clocks', () => {
    expect(parseSlot('2026-12-01', '12:00 PM').toISOString()).toBe('2026-12-01T20:00:00.000Z');
    expect(parseSlot('2026-12-01', '12:15 AM').toISOString()).toBe('2026-12-01T08:15:00.000Z');
    expect(parseSlot('2026-12-01', '16:00').toISOString()).toBe('2026-12-02T00:00:00.000Z');
  });

  it('returns null for anything else', () => {
    expect(parseSlot('2026-12-01', 'soon')).toBeNull();
    expect(parseSlot('next week', '4:00 PM')).toBeNull();
    expect(parseSlot('2026-12-01', '25:00')).toBeNull();
  });
});

describe('toSlot', () => {
  it('is the reverse of parseSlot', () => {
    expect(toSlot('2026-12-02T00:00:00.000Z')).toEqual({ date: '2026-12-01', time: '4:00 PM' });
    expect(toSlot(parseSlot('2026-07-04', '9:30 AM'))).toEqual({
      date: '2026-07-04',
      time: '9:30 AM',
    });
    expect(toSlot(fromCampusTime(2026, 3, 8, 0, 5))).toEqual({
      date: '2026-03-08',
      time: '12:05 AM',
    });
  });
});

describe('durationMinutes', () => {
  it('reads minutes and hours from what the seller typed', () => {
    expect(durationMinutes({ duration: '45 min session' })).toBe(45);
    expect(durationMinutes({ unit: '2 hours' })).toBe(120);
    expect(durationMinutes({ unit: '1.5 hr' })).toBe(90);
    expect(durationMinutes({ durationMinutes: 30, unit: 'hour' })).toBe(30);
  });

  it('falls back to an hour', () => {
    expect(durationMinutes({ unit: 'hour' })).toBe(60);
    expect(durationMinutes({ unit: 'session' })).toBe(60);
    expect(durationMinutes()).toBe(60);
  });
});
