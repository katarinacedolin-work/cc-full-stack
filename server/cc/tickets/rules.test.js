const { eventProblem, SALE_WINDOW_DAYS } = require('./rules');

const NOW = new Date('2026-11-24T20:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const inDays = days => new Date(NOW.getTime() + days * DAY_MS).toISOString();

const event = overrides => ({
  kind: 'ticket',
  eventStartsAt: inDays(10),
  venue: 'Art North studio',
  hostConfirmed: true,
  ...overrides,
});

describe('eventProblem', () => {
  it('lets a hosted event in the next few weeks be sold', () => {
    expect(eventProblem(event(), NOW)).toBeNull();
  });

  it('needs a date and time', () => {
    expect(eventProblem(event({ eventStartsAt: null }), NOW).code).toBe('event-time-required');
    expect(eventProblem(event({ eventStartsAt: 'soon' }), NOW).code).toBe('event-time-required');
  });

  it('stops sales once the event has started', () => {
    expect(eventProblem(event({ eventStartsAt: inDays(-0.01) }), NOW).code).toBe('event-started');
  });

  it('stops sales for an event too far ahead for Stripe to hold the money', () => {
    expect(eventProblem(event({ eventStartsAt: inDays(SALE_WINDOW_DAYS + 1) }), NOW).code).toBe(
      'event-too-far'
    );
    expect(eventProblem(event({ eventStartsAt: inDays(SALE_WINDOW_DAYS - 1) }), NOW)).toBeNull();
  });

  it('needs a place', () => {
    expect(eventProblem(event({ venue: '  ' }), NOW).code).toBe('venue-required');
  });

  it('needs the seller to say they host the event', () => {
    expect(eventProblem(event({ hostConfirmed: false }), NOW).code).toBe('host-required');
  });
});
