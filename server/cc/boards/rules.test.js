const { readPost } = require('./rules');

const job = {
  kind: 'job',
  title: 'Move-in helper',
  where: 'Tenochca',
  schedule: 'Saturday morning',
  pay: '$20/hr',
  summary: 'Carry boxes up two floors.',
};

describe('readPost', () => {
  it('reads a job', () => {
    expect(readPost(job)).toEqual({
      kind: 'job',
      title: 'Move-in helper',
      summary: 'Carry boxes up two floors.',
      details: { where: 'Tenochca', schedule: 'Saturday morning', pay: '$20/hr' },
      days: 60,
    });
  });

  it('reads a housing post and tidies the spacing', () => {
    const post = readPost({
      kind: 'housing',
      title: '  Private room   in a 3-bedroom ',
      place: 'College Area',
      dates: 'Jan–May',
      rent: '$900/mo',
      summary: 'Furnished.\nTwo roommates.',
    });
    expect(post.title).toBe('Private room in a 3-bedroom');
    expect(post.summary).toBe('Furnished. Two roommates.');
    expect(post.details).toEqual({ place: 'College Area', dates: 'Jan–May', rent: '$900/mo' });
  });

  it('says what is missing', () => {
    expect(() => readPost({ ...job, pay: '   ' })).toThrow(
      'Fill in the title, where, schedule, pay, and description.'
    );
    expect(() => readPost({ kind: 'housing', title: 'A room' })).toThrow(
      'Fill in the place, neighborhood, dates, rent, and details.'
    );
  });

  it('refuses an answer longer than the form allows', () => {
    expect(() => readPost({ ...job, title: 'x'.repeat(61) })).toThrow(
      expect.objectContaining({ status: 400, code: 'post-too-long' })
    );
    expect(() => readPost({ ...job, summary: 'x'.repeat(241) })).toThrow(
      expect.objectContaining({ code: 'post-too-long' })
    );
  });

  it('reads a ticket for sale, with the price as typed', () => {
    expect(
      readPost({ kind: 'ticket', ticketKind: 'resell', event: 'Boise State', price: '$25' })
    ).toEqual({
      kind: 'ticket',
      title: 'Boise State',
      summary: '',
      details: { ticketKind: 'resell', price: 25 },
      days: 30,
    });
    expect(
      readPost({ kind: 'ticket', ticketKind: 'resell', event: 'Formal', price: '12.505' }).details
        .price
    ).toBe(12.51);
  });

  it('reads a ticket request, which has no price', () => {
    expect(
      readPost({ kind: 'ticket', ticketKind: 'request', event: 'Open Air concert', price: '40' })
        .details
    ).toEqual({ ticketKind: 'request' });
  });

  it('needs an event, and a price to resell', () => {
    expect(() => readPost({ kind: 'ticket', ticketKind: 'request', event: '' })).toThrow(
      'Add the event.'
    );
    expect(() => readPost({ kind: 'ticket', ticketKind: 'resell', event: 'Game' })).toThrow(
      'Add the event and a price.'
    );
    expect(() =>
      readPost({ kind: 'ticket', ticketKind: 'resell', event: 'Game', price: 'free' })
    ).toThrow('Add the event and a price.');
    expect(() =>
      readPost({ kind: 'ticket', ticketKind: 'resell', event: 'Game', price: '99999' })
    ).toThrow(expect.objectContaining({ code: 'price-too-high' }));
  });

  it('refuses a board that does not exist', () => {
    expect(() => readPost({ kind: 'chore', title: 'Dog walk' })).toThrow(
      expect.objectContaining({ status: 400, code: 'unknown-board' })
    );
    expect(() => readPost({ kind: 'constructor' })).toThrow(
      expect.objectContaining({ code: 'unknown-board' })
    );
    expect(() => readPost()).toThrow(expect.objectContaining({ code: 'unknown-board' }));
  });
});
