const { pollOnce } = require('./poll');

const DAY_MS = 24 * 60 * 60 * 1000;

const event = sequenceId => ({ attributes: { sequenceId, eventType: 'user/created' } });

const recentStart = () => {
  const startedAt = new Date();
  startedAt.setUTCDate(startedAt.getUTCDate() - 1);
  return startedAt;
};

const fakeSdk = (events, perPage = 100) => ({
  events: {
    query: jest.fn(async () => ({ data: { data: events, meta: { perPage } } })),
  },
});

const fakeCursor = (sequenceId = null, startedAt = recentStart()) => {
  const saved = [];
  const startedAts = [];
  return {
    saved,
    startedAts,
    get: async () => ({ sequenceId, startedAt }),
    set: async id => {
      saved.push(id);
    },
    setStartedAt: async next => {
      startedAts.push(next);
    },
  };
};

const expiredStartError = () =>
  Object.assign(new Error('Bad Request'), {
    status: 400,
    statusText: 'Bad Request',
    data: {
      errors: [
        {
          status: 400,
          code: 'validation-invalid-value',
          title: 'Invalid value',
          source: { path: ['createdAtStart'], type: 'query' },
        },
      ],
    },
  });

const ageMs = date => Date.now() - date.getTime();

describe('pollOnce', () => {
  it('starts from the start time when no event has been handled yet', async () => {
    const startedAt = recentStart();
    const sdk = fakeSdk([]);

    const result = await pollOnce({ sdk, cursor: fakeCursor(null, startedAt), handlers: [] });

    expect(sdk.events.query).toHaveBeenCalledWith({ createdAtStart: startedAt });
    expect(result).toEqual({ count: 0, fullPage: false });
  });

  it('moves a start time older than the live window forward, and saves it', async () => {
    const startedAt = new Date('2020-01-01T00:00:00Z');
    const sdk = fakeSdk([]);
    const cursor = fakeCursor(null, startedAt);

    await pollOnce({ sdk, cursor, handlers: [] });

    const queried = sdk.events.query.mock.calls[0][0].createdAtStart;
    expect(queried.getTime()).toBeGreaterThan(startedAt.getTime());
    expect(queried.toISOString().endsWith('T00:00:00.000Z')).toBe(true);
    expect(ageMs(queried)).toBeGreaterThanOrEqual(89 * DAY_MS);
    expect(ageMs(queried)).toBeLessThan(90 * DAY_MS);
    expect(cursor.startedAts).toEqual([queried]);
  });

  it('uses the shorter dev window when Sharetribe rejects the live one, then queries again', async () => {
    const startedAt = new Date(Date.now() - 10 * DAY_MS);
    const sdk = fakeSdk([]);
    sdk.events.query
      .mockRejectedValueOnce(expiredStartError())
      .mockResolvedValueOnce({ data: { data: [], meta: { perPage: 100 } } });
    const cursor = fakeCursor(null, startedAt);

    const result = await pollOnce({ sdk, cursor, handlers: [] });

    expect(sdk.events.query).toHaveBeenNthCalledWith(1, { createdAtStart: startedAt });
    const retried = sdk.events.query.mock.calls[1][0].createdAtStart;
    expect(ageMs(retried)).toBeGreaterThanOrEqual(6 * DAY_MS);
    expect(ageMs(retried)).toBeLessThan(7 * DAY_MS);
    expect(cursor.startedAts).toEqual([retried]);
    expect(result).toEqual({ count: 0, fullPage: false });
  });

  it('rethrows a failure that is not an expired start time', async () => {
    const sdk = fakeSdk([]);
    sdk.events.query.mockRejectedValueOnce(new Error('unavailable'));
    const cursor = fakeCursor();

    await expect(pollOnce({ sdk, cursor, handlers: [] })).rejects.toThrow('unavailable');

    expect(cursor.startedAts).toEqual([]);
  });

  it('does not move the start time once a sequence id is saved', async () => {
    const sdk = fakeSdk([]);
    sdk.events.query.mockRejectedValueOnce(expiredStartError());
    const cursor = fakeCursor(41);

    await expect(pollOnce({ sdk, cursor, handlers: [] })).rejects.toThrow('Bad Request');

    expect(sdk.events.query).toHaveBeenCalledWith({ startAfterSequenceId: 41 });
    expect(cursor.startedAts).toEqual([]);
  });

  it('continues after the last handled event', async () => {
    const sdk = fakeSdk([]);

    await pollOnce({ sdk, cursor: fakeCursor(41), handlers: [] });

    expect(sdk.events.query).toHaveBeenCalledWith({ startAfterSequenceId: 41 });
  });

  it('runs every handler for every event in order and saves each place', async () => {
    const calls = [];
    const handlers = [
      async e => calls.push(`first:${e.attributes.sequenceId}`),
      async e => calls.push(`second:${e.attributes.sequenceId}`),
    ];
    const cursor = fakeCursor(41);

    const result = await pollOnce({ sdk: fakeSdk([event(42), event(43)]), cursor, handlers });

    expect(calls).toEqual(['first:42', 'second:42', 'first:43', 'second:43']);
    expect(cursor.saved).toEqual([42, 43]);
    expect(result).toEqual({ count: 2, fullPage: false });
  });

  it('reports a full page so the caller asks for more right away', async () => {
    const sdk = fakeSdk([event(1), event(2)], 2);

    const result = await pollOnce({ sdk, cursor: fakeCursor(), handlers: [] });

    expect(result.fullPage).toBe(true);
  });

  it('stops at an event whose handler fails, without saving it or the ones after', async () => {
    const handled = [];
    const handlers = [
      async e => {
        if (e.attributes.sequenceId === 43) {
          throw new Error('handler failed');
        }
        handled.push(e.attributes.sequenceId);
      },
    ];
    const cursor = fakeCursor(41);
    const sdk = fakeSdk([event(42), event(43), event(44)]);

    await expect(pollOnce({ sdk, cursor, handlers })).rejects.toThrow('handler failed');

    expect(handled).toEqual([42]);
    expect(cursor.saved).toEqual([42]);
  });
});
