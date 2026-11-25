const { toPost, contextTitleOf } = require('./mapPost');

const row = (kind, title, details, extra = {}) => ({
  id: '12',
  kind,
  author_id: 'author-1',
  author_name: 'Alex Ruiz',
  title,
  summary: 'The details.',
  details,
  created_at: new Date('2026-11-20T18:00:00Z'),
  ...extra,
});

describe('toPost', () => {
  it('maps a job into a board card', () => {
    const job = row('job', 'Move-in helper', {
      where: 'Tenochca',
      schedule: 'Saturday morning',
      pay: '$20/hr',
    });
    expect(toPost(job, 'someone-else')).toEqual({
      id: '12',
      title: 'Move-in helper',
      kicker: 'Tenochca',
      meta: 'Saturday morning',
      price: '$20/hr',
      accent: 'sky',
      emoji: '📌',
      summary: 'The details.',
      facts: [['Schedule', 'Saturday morning'], ['Where', 'Tenochca'], ['Pay', '$20/hr']],
      poster: 'Alex Ruiz',
      posterId: 'author-1',
      initials: 'AR',
      mine: false,
      postedAt: '2026-11-20T18:00:00.000Z',
    });
  });

  it('maps a housing post, and marks it as yours when you wrote it', () => {
    const home = row('housing', 'Private room', {
      place: 'College Area',
      dates: 'Jan–May',
      rent: '$900/mo',
    });
    expect(toPost(home, 'author-1')).toMatchObject({
      kicker: 'College Area',
      meta: 'Jan–May',
      price: '$900/mo',
      emoji: '🏠',
      mine: true,
      facts: [['Dates', 'Jan–May'], ['Rent', '$900/mo'], ['Place', 'College Area']],
    });
  });

  it('only uses the colors a board card comes in', () => {
    const accents = ['1', '2', '3', '4', '5', '6', '7'].map(
      id => toPost(row('job', 'Job', {}, { id }), '').accent
    );
    expect(new Set(accents)).toEqual(new Set(['coral', 'butter', 'sky', 'mint', 'lilac']));
  });

  it('maps a ticket for sale and a ticket request into lines of the ticket chat', () => {
    expect(
      toPost(row('ticket', 'Boise State', { ticketKind: 'resell', price: 25 }), '')
    ).toMatchObject({
      id: '12',
      kind: 'resell',
      event: 'Boise State',
      price: '25',
      name: 'Alex Ruiz',
      initials: 'AR',
      mine: false,
    });
    const request = toPost(
      row('ticket', 'Open Air concert', { ticketKind: 'request' }),
      'author-1'
    );
    expect(request).toMatchObject({ kind: 'request', event: 'Open Air concert', mine: true });
    expect(request).not.toHaveProperty('price');
  });

  it('keeps the cents on a price that has them', () => {
    expect(toPost(row('ticket', 'Formal', { ticketKind: 'resell', price: 12.5 }), '').price).toBe(
      '12.50'
    );
  });

  it('falls back to "Student" for a post without a name', () => {
    expect(toPost(row('job', 'Job', {}, { author_name: '' }), '').poster).toBe('Student');
  });
});

describe('contextTitleOf', () => {
  it('names a conversation after the post', () => {
    expect(contextTitleOf(row('job', 'Move-in helper', {}))).toBe('Move-in helper');
    expect(contextTitleOf(row('housing', 'Private room', {}))).toBe('Private room');
  });

  it('says which way a ticket post goes, in words that read right for both people', () => {
    expect(contextTitleOf(row('ticket', 'Boise State', { ticketKind: 'resell', price: 25 }))).toBe(
      'Boise State ticket · $25'
    );
    expect(contextTitleOf(row('ticket', 'Comedy night', { ticketKind: 'request' }))).toBe(
      'Ticket wanted · Comedy night'
    );
  });
});
